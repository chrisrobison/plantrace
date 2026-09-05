// Pure geometry helpers shared by the workspace renderer, hit-testing,
// snapping, and the SVG/DXF exporters. Nothing here touches the DOM or the
// document store — nothing here has side effects at all — so it can be
// exercised directly from a scratch script for verification.

export function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

export function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

export function angleOf(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }

export function rotatePoint(p, origin, deg) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = p.x - origin.x, dy = p.y - origin.y;
  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
}

export function lerp(a, b, t) { return a + (b - a) * t; }

/** Closest point on segment a-b to point p, plus the parametric t in [0,1]. */
export function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

function rectPoints(x, y, w, h, rotation = 0) {
  const corners = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (!rotation) return corners;
  const center = { x: x + w / 2, y: y + h / 2 };
  return corners.map((c) => rotatePoint(c, center, rotation));
}

/** Bounding box for one element, in world coordinates. */
export function bboxOfElement(el) {
  const g = el.geometry;
  switch (el.type) {
    case 'wall':
    case 'door':
    case 'window':
    case 'dimension':
      return { minX: Math.min(g.x1, g.x2), minY: Math.min(g.y1, g.y2), maxX: Math.max(g.x1, g.x2), maxY: Math.max(g.y1, g.y2) };
    case 'stair':
    case 'fixture': {
      const pts = rectPoints(g.x, g.y, g.w, g.h, g.rotation || 0);
      return bboxOfPoints(pts);
    }
    case 'text':
      return { minX: g.x, minY: g.y - g.size, maxX: g.x + g.content.length * g.size * 0.6, maxY: g.y };
    case 'room': {
      if (g.points && g.points.length) return bboxOfPoints(g.points);
      return { minX: g.x - 40, minY: g.y - 14, maxX: g.x + 40, maxY: g.y + 14 };
    }
    default:
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
}

export function bboxOfPoints(points) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function bboxUnion(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  return {
    minX: Math.min(...valid.map((b) => b.minX)),
    minY: Math.min(...valid.map((b) => b.minY)),
    maxX: Math.max(...valid.map((b) => b.maxX)),
    maxY: Math.max(...valid.map((b) => b.maxY)),
  };
}

/** Draggable endpoint handles for an element, as [{key, x, y}]. Empty for types with no editable endpoints (text, fixtures, stairs, rooms without a polygon). */
export function elementEndpoints(el) {
  const g = el.geometry;
  switch (el.type) {
    case 'wall':
    case 'door':
    case 'window':
    case 'dimension':
      return [{ key: 'x1y1', x: g.x1, y: g.y1 }, { key: 'x2y2', x: g.x2, y: g.y2 }];
    case 'room':
      return (g.points || []).map((p, i) => ({ key: `pt${i}`, x: p.x, y: p.y }));
    default:
      return [];
  }
}

export function setEndpoint(el, key, x, y) {
  const g = el.geometry;
  if (key === 'x1y1') { g.x1 = x; g.y1 = y; return; }
  if (key === 'x2y2') { g.x2 = x; g.y2 = y; return; }
  if (key.startsWith('pt') && g.points) {
    const idx = Number(key.slice(2));
    if (g.points[idx]) { g.points[idx] = { x, y }; }
  }
}

export function moveElementBy(el, dx, dy) {
  const g = el.geometry;
  switch (el.type) {
    case 'wall': case 'door': case 'window': case 'dimension':
      g.x1 += dx; g.y1 += dy; g.x2 += dx; g.y2 += dy; break;
    case 'stair': case 'fixture': case 'text': case 'room':
      g.x += dx; g.y += dy;
      if (g.points) g.points = g.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      break;
  }
}

/** True if `point` is within `tolerance` px of the element's rendered geometry. */
export function hitTestElement(el, point, tolerance = 6) {
  const g = el.geometry;
  switch (el.type) {
    case 'wall': case 'door': case 'window': case 'dimension': {
      const cp = closestPointOnSegment(point, { x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 });
      const halfW = el.type === 'wall' ? Math.max(tolerance, g.thickness / 2) : tolerance;
      return dist(point, cp) <= halfW;
    }
    case 'stair': case 'fixture': {
      const box = bboxOfElement(el);
      return point.x >= box.minX - tolerance && point.x <= box.maxX + tolerance && point.y >= box.minY - tolerance && point.y <= box.maxY + tolerance;
    }
    case 'text':
      return dist(point, { x: g.x, y: g.y - g.size / 2 }) <= Math.max(tolerance, g.size);
    case 'room': {
      if (g.points && g.points.length >= 3) return pointNearPolygon(point, g.points, tolerance) || pointInPolygon(point, g.points);
      return dist(point, { x: g.x, y: g.y }) <= 40;
    }
    default:
      return false;
  }
}

export function pointInPolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y, xj = points[j].x, yj = points[j].y;
    const intersect = (yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointNearPolygon(point, points, tolerance) {
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (dist(point, closestPointOnSegment(point, a, b)) <= tolerance) return true;
  }
  return false;
}

export function polygonCentroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** SVG arc path for a door swing (quarter circle) plus the leaf line, given a door element. */
export function doorSwingGeometry(door) {
  const g = door.geometry;
  const hingeAt = g.hinge === 'end' ? { x: g.x2, y: g.y2 } : { x: g.x1, y: g.y1 };
  const openAt = g.hinge === 'end' ? { x: g.x1, y: g.y1 } : { x: g.x2, y: g.y2 };
  const radius = dist(hingeAt, openAt);
  const baseAngle = angleOf(hingeAt, openAt);
  const sweep = g.swing === 'left' ? -1 : 1;
  const leafAngle = baseAngle + sweep * (Math.PI / 2);
  const leafEnd = { x: hingeAt.x + radius * Math.cos(leafAngle), y: hingeAt.y + radius * Math.sin(leafAngle) };
  const largeArc = 0;
  const sweepFlag = sweep === 1 ? 1 : 0;
  const arcPath = `M ${openAt.x} ${openAt.y} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${leafEnd.x} ${leafEnd.y}`;
  return { hingeAt, openAt, leafEnd, radius, arcPath };
}

/** Rectangle corner points for stairs/fixtures, exported for renderers + DXF/SVG export. */
export { rectPoints };

export function boxesIntersect(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}
