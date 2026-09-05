// Decomposes a geometry element into a small set of drawing primitives
// (line / polyline / arc / circle / text) that both the SVG renderer, the
// SVG exporter, and the DXF exporter can consume identically. Keeping this
// one shared translation means the workspace view and the exported files can
// never silently drift apart.
import { doorSwingGeometry, dist, angleOf } from './geometry.js';
import { formatLength } from './units.js';

function wallOutline(g) {
  const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (g.thickness / 2);
  const ny = (dx / len) * (g.thickness / 2);
  return [
    { x: g.x1 + nx, y: g.y1 + ny },
    { x: g.x2 + nx, y: g.y2 + ny },
    { x: g.x2 - nx, y: g.y2 - ny },
    { x: g.x1 - nx, y: g.y1 - ny },
  ];
}

function windowTicks(g) {
  const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 5, ny = (dx / len) * 5;
  const p1 = { x: g.x1, y: g.y1 }, p2 = { x: g.x2, y: g.y2 };
  return [
    { kind: 'line', x1: p1.x - nx, y1: p1.y - ny, x2: p1.x + nx, y2: p1.y + ny, tick: true },
    { kind: 'line', x1: p2.x - nx, y1: p2.y - ny, x2: p2.x + nx, y2: p2.y + ny, tick: true },
  ];
}

/** @returns {Array<Object>} primitives in the element's world coordinates. */
export function elementToPrimitives(el, calibration) {
  const g = el.geometry;
  switch (el.type) {
    case 'wall':
      return [{ kind: 'polyline', closed: true, points: wallOutline(g) }];

    case 'window':
      return [{ kind: 'line', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }, ...windowTicks(g)];

    case 'door': {
      const { arcPath, hingeAt, leafEnd, radius } = doorSwingGeometry(el);
      const angle = angleOf(hingeAt, leafEnd) * (180 / Math.PI);
      const openAngle = angleOf(hingeAt, { x: g.hinge === 'end' ? g.x1 : g.x2, y: g.hinge === 'end' ? g.y1 : g.y2 }) * (180 / Math.PI);
      const sweep = g.swing === 'left' ? -1 : 1;
      const a1 = sweep === 1 ? openAngle : angle;
      const a2 = sweep === 1 ? angle : openAngle;
      return [
        { kind: 'line', x1: hingeAt.x, y1: hingeAt.y, x2: leafEnd.x, y2: leafEnd.y },
        { kind: 'arc', cx: hingeAt.x, cy: hingeAt.y, r: radius, startAngleDeg: a1, endAngleDeg: a2, svgPath: arcPath },
      ];
    }

    case 'stair': {
      const { x, y, w, h, steps } = g;
      const prims = [{ kind: 'polyline', closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }];
      for (let i = 1; i < steps; i++) {
        const ty = y + (h * i) / steps;
        prims.push({ kind: 'line', x1: x, y1: ty, x2: x + w, y2: ty });
      }
      prims.push({ kind: 'line', x1: x + w / 2, y1: g.direction === 'up' ? y + h - 6 : y + 6, x2: x + w / 2, y2: g.direction === 'up' ? y + 6 : y + h - 6, arrow: true });
      return prims;
    }

    case 'fixture': {
      const { x, y, w, h, shape } = g;
      if (shape === 'circle') return [{ kind: 'circle', cx: x + w / 2, cy: y + h / 2, r: Math.min(w, h) / 2 }];
      return [{ kind: 'polyline', closed: true, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }];
    }

    case 'dimension': {
      const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * g.offset, ny = (dx / len) * g.offset;
      const p1 = { x: g.x1 + nx, y: g.y1 + ny };
      const p2 = { x: g.x2 + nx, y: g.y2 + ny };
      const label = g.label || formatLength(dist({ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }), calibration);
      return [
        { kind: 'line', x1: g.x1, y1: g.y1, x2: p1.x, y2: p1.y, extension: true },
        { kind: 'line', x1: g.x2, y1: g.y2, x2: p2.x, y2: p2.y, extension: true },
        { kind: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
        { kind: 'text', x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, content: label, size: 13, anchor: 'middle', dy: -4 },
      ];
    }

    case 'text':
      return [{ kind: 'text', x: g.x, y: g.y, content: g.content, size: g.size, rotation: g.rotation, anchor: 'start' }];

    case 'room': {
      const prims = [];
      if (g.points && g.points.length >= 3) prims.push({ kind: 'polyline', closed: true, dashed: true, points: g.points });
      prims.push({ kind: 'text', x: g.x, y: g.y, content: g.label, size: 15, anchor: 'middle', weight: 'bold' });
      return prims;
    }

    default:
      return [];
  }
}
