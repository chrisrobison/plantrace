// Pure snapping math: grid snap, endpoint/midpoint snap to nearby geometry,
// and orthogonal-angle constraint relative to a drag's origin point. Kept
// separate from geometry.js because this module encodes *editor policy*
// (tolerances, priority order) rather than shape math.

const ENDPOINT_TOLERANCE_PX = 10; // in screen px, caller divides by zoom before use

export function snapToGrid(point, gridPx) {
  if (!gridPx || gridPx <= 0) return point;
  return { x: Math.round(point.x / gridPx) * gridPx, y: Math.round(point.y / gridPx) * gridPx };
}

/** Constrain `point` so the vector from `origin` is horizontal or vertical, whichever is closer. */
export function snapOrtho(origin, point) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: point.x, y: origin.y } : { x: origin.x, y: point.y };
}

/**
 * Resolve a candidate world-space point through the editor's active snap
 * settings, in priority order: endpoint/midpoint snap, then ortho (relative
 * to `origin` when given), then grid. Returns the resolved point plus flags
 * describing what fired, so the renderer can draw snap indicators.
 */
export function computeSnap(point, { gridPx = 0, snapEnabled = true, orthoEnabled = false, origin = null, candidates = [], zoom = 1 } = {}) {
  let result = { x: point.x, y: point.y };
  let snappedToPoint = false;
  let snappedOrtho = false;
  let snappedToGridFlag = false;

  if (snapEnabled && candidates.length) {
    const tol = ENDPOINT_TOLERANCE_PX / Math.max(zoom, 0.01);
    let best = null, bestDist = tol;
    for (const c of candidates) {
      const d = Math.hypot(c.x - point.x, c.y - point.y);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    if (best) { result = { x: best.x, y: best.y }; snappedToPoint = true; }
  }

  if (!snappedToPoint && orthoEnabled && origin) {
    result = snapOrtho(origin, result);
    snappedOrtho = true;
  }

  if (!snappedToPoint && snapEnabled && gridPx > 0) {
    const gridded = snapToGrid(result, gridPx);
    if (gridded.x !== result.x || gridded.y !== result.y) snappedToGridFlag = true;
    result = gridded;
  }

  return { point: result, snappedToPoint, snappedOrtho, snappedToGrid: snappedToGridFlag };
}

/** Endpoints of every element on a sheet except those in `excludeIds`, for endpoint-snap candidates. */
export function collectSnapCandidates(elements, excludeIds, elementEndpoints) {
  const out = [];
  for (const el of elements) {
    if (excludeIds.has(el.id)) continue;
    for (const ep of elementEndpoints(el)) out.push({ x: ep.x, y: ep.y });
  }
  return out;
}
