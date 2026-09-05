// Deterministic stand-in for a future OpenCV/ML tracing service. It never
// looks at actual pixels — it lays out a plausible floor plan skeleton sized
// to the sheet's pixel dimensions, seeded from the sheet id so the same
// sheet always retraces to the same geometry (required for repeatable QA).
//
// A handful of elements are deliberately given low confidence with an
// attached finding, so a freshly-traced sheet always has something
// meaningful to review — exactly what a real vision pipeline's uncertain
// outputs would look like.
import { TraceProvider } from './trace-provider.js';

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FINDING_POOL = {
  wall: [{ code: 'wall-junction', message: 'Wall intersection may be a T-joint or cross-joint.', severity: 'warning' }],
  dimension: [{ code: 'dim-conflict', message: 'Measured distance disagrees with the drawn dimension line.', severity: 'error' }],
  door: [{ code: 'door-swing', message: 'Verify door swing direction and leaf width.', severity: 'warning' }],
  window: [{ code: 'window-type', message: 'Window type is unclear from the source scan.', severity: 'warning' }],
  room: [{ code: 'room-bounds', message: 'Room boundary may not fully close.', severity: 'warning' }],
  stair: [{ code: 'stair-run', message: 'Step count is an estimate; verify rise/run against the source.', severity: 'info' }],
  fixture: [{ code: 'fixture-kind', message: 'Fixture type guessed from silhouette; confirm against source.', severity: 'info' }],
  text: [{ code: 'text-ocr', message: 'Label text was hard to read at this resolution.', severity: 'info' }],
};

function withMaybeFinding(rng, type, spec) {
  // ~22% of elements come back uncertain, matching how a real vision service
  // would behave: mostly confident, with a meaningful tail of ambiguous cases.
  const roll = rng();
  if (roll < 0.22) {
    const pool = FINDING_POOL[type] || FINDING_POOL.wall;
    const finding = pool[Math.floor(rng() * pool.length)];
    const confidence = finding.severity === 'error' ? 0.3 + rng() * 0.2 : 0.5 + rng() * 0.25;
    return { ...spec, confidence: Math.round(confidence * 100) / 100, findings: [{ ...finding, id: undefined }] };
  }
  return { ...spec, confidence: Math.round((0.85 + rng() * 0.14) * 100) / 100 };
}

function wall(x1, y1, x2, y2, thickness = 6) { return { x1, y1, x2, y2, thickness }; }

/**
 * Build a normalized layout (in a 0..1000 x 0..760 box) for one of three
 * demo "kinds," then scale it to the sheet's actual pixel dimensions. Also
 * used, via the 'generic' kind, for any real imported sheet a user runs the
 * demo provider against — it has no idea what's actually on the scan, so it
 * proposes a plausible generic single-footprint layout sized to the image.
 */
function buildLayout(kind, rng) {
  const items = []; // {type, geometry, sourceRegionNorm?}
  const push = (type, geometry, sourceRegion) => items.push({ type, geometry, sourceRegion });

  if (kind === 'roof') {
    push('wall', wall(80, 80, 920, 80, 8));
    push('wall', wall(920, 80, 920, 680, 8));
    push('wall', wall(920, 680, 80, 680, 8));
    push('wall', wall(80, 680, 80, 80, 8));
    push('wall', wall(80, 80, 500, 40, 6)); // ridge hip lines
    push('wall', wall(920, 80, 500, 40, 6));
    push('wall', wall(80, 680, 500, 720, 6));
    push('wall', wall(920, 680, 500, 720, 6));
    push('text', { x: 460, y: 400, rotation: 0, size: 22, content: 'ROOF PLAN' });
    push('dimension', { x1: 80, y1: 40, x2: 920, y2: 40, offset: -24, label: null });
    push('dimension', { x1: 40, y1: 80, x2: 40, y2: 680, offset: -24, label: null });
    return items;
  }

  if (kind === 'second-floor') {
    // Simple 3-bedroom + bath layout.
    push('wall', wall(80, 80, 920, 80));
    push('wall', wall(920, 80, 920, 640));
    push('wall', wall(920, 640, 80, 640));
    push('wall', wall(80, 640, 80, 80));
    push('wall', wall(420, 80, 420, 640));
    push('wall', wall(680, 80, 680, 420));
    push('wall', wall(420, 420, 920, 420));
    push('wall', wall(680, 420, 680, 640));
    push('door', { x1: 420, y1: 200, x2: 420, y2: 244, swing: 'right', hinge: 'start' });
    push('door', { x1: 680, y1: 240, x2: 680, y2: 284, swing: 'left', hinge: 'start' });
    push('door', { x1: 680, y1: 470, x2: 680, y2: 514, swing: 'right', hinge: 'start' });
    push('door', { x1: 300, y1: 640, x2: 300, y2: 684, swing: 'left', hinge: 'end' });
    for (const wx of [150, 300, 500, 620, 780, 860]) push('window', { x1: wx, y1: 76, x2: wx + 48, y2: 84 });
    push('fixture', { x: 740, y: 460, w: 60, h: 34, rotation: 0, kind: 'tub', shape: 'rect' });
    push('fixture', { x: 830, y: 440, w: 24, h: 20, rotation: 0, kind: 'toilet', shape: 'rect' });
    push('room', { x: 230, y: 340, label: 'BEDROOM 1', points: [] });
    push('room', { x: 550, y: 240, label: 'BEDROOM 2', points: [] });
    push('room', { x: 800, y: 250, label: 'BATH', points: [] });
    push('room', { x: 800, y: 530, label: 'BEDROOM 3', points: [] });
    push('dimension', { x1: 80, y1: 40, x2: 920, y2: 40, offset: -24, label: null });
    push('dimension', { x1: 40, y1: 80, x2: 40, y2: 640, offset: -24, label: null });
    return items;
  }

  // 'generic' / 'first-floor' — the mockup layout: kitchen, dining, living, a
  // small bath/hall, and a stair.
  push('wall', wall(80, 100, 920, 100, 8));
  push('wall', wall(920, 100, 920, 700, 8));
  push('wall', wall(920, 700, 80, 700, 8));
  push('wall', wall(80, 700, 80, 100, 8));
  push('wall', wall(560, 100, 560, 380));
  push('wall', wall(560, 380, 920, 380));
  push('wall', wall(420, 380, 560, 380));
  push('wall', wall(420, 380, 420, 560));
  push('wall', wall(420, 560, 560, 560));
  push('wall', wall(560, 380, 560, 700));

  push('door', { x1: 640, y1: 100, x2: 684, y2: 100, swing: 'right', hinge: 'start' });
  push('door', { x1: 800, y1: 100, x2: 844, y2: 100, swing: 'left', hinge: 'end' });
  push('door', { x1: 560, y1: 300, x2: 560, y2: 344, swing: 'right', hinge: 'start' });
  push('door', { x1: 470, y1: 380, x2: 514, y2: 380, swing: 'left', hinge: 'end' });
  push('door', { x1: 420, y1: 460, x2: 420, y2: 504, swing: 'right', hinge: 'start' });
  push('door', { x1: 200, y1: 700, x2: 260, y2: 700, swing: 'left', hinge: 'start' });

  for (const wx of [140, 260, 700, 820]) push('window', { x1: wx, y1: 96, x2: wx + 56, y2: 104 });
  push('window', { x1: 916, y1: 200, x2: 924, y2: 256 });
  push('window', { x1: 916, y1: 500, x2: 924, y2: 556 });

  push('stair', { x: 560, y: 560, w: 130, h: 110, steps: 11, rotation: 0, direction: 'up' });
  push('fixture', { x: 600, y: 110, w: 70, h: 40, rotation: 0, kind: 'counter', shape: 'rect' });
  push('fixture', { x: 440, y: 400, w: 20, h: 28, rotation: 0, kind: 'toilet', shape: 'rect' });
  push('fixture', { x: 470, y: 480, w: 40, h: 24, rotation: 0, kind: 'sink', shape: 'rect' });

  push('room', { x: 700, y: 220, label: 'KITCHEN', points: [] });
  push('room', { x: 760, y: 470, label: 'DINING ROOM', points: [] });
  push('room', { x: 300, y: 500, label: 'LIVING ROOM', points: [] });
  push('room', { x: 480, y: 440, label: 'BATH', points: [] });

  push('dimension', { x1: 80, y1: 60, x2: 920, y2: 60, offset: -20, label: null });
  push('dimension', { x1: 80, y1: 720, x2: 420, y2: 720, offset: 20, label: null });
  push('dimension', { x1: 420, y1: 720, x2: 560, y2: 720, offset: 20, label: null });
  push('dimension', { x1: 560, y1: 720, x2: 760, y2: 720, offset: 20, label: null });
  push('dimension', { x1: 760, y1: 720, x2: 920, y2: 720, offset: 20, label: null });
  push('dimension', { x1: 40, y1: 100, x2: 40, y2: 700, offset: -20, label: null });
  return items;
}

export class DemoTraceProvider extends TraceProvider {
  id = 'demo-trace-v1';
  label = 'Demo Trace Provider (deterministic)';

  async trace(context) {
    const seed = hashString(`${context.sheetId}:${context.demoLayout || 'generic'}`);
    const rng = mulberry32(seed);
    const items = buildLayout(context.demoLayout || 'generic', rng);
    const norm = { w: 1000, h: 760 };
    const inset = 0.06;
    const availW = context.naturalWidth * (1 - inset * 2);
    const availH = context.naturalHeight * (1 - inset * 2);
    const scale = Math.min(availW / norm.w, availH / norm.h);
    const offX = (context.naturalWidth - norm.w * scale) / 2;
    const offY = (context.naturalHeight - norm.h * scale) / 2;
    const mapPt = (x, y) => ({ x: offX + x * scale, y: offY + y * scale });

    const elements = items.map(({ type, geometry }) => {
      const g = { ...geometry };
      for (const [ka, kb] of [['x1', 'y1'], ['x2', 'y2']]) {
        if (g[ka] !== undefined) { const p = mapPt(g[ka], g[kb]); g[ka] = p.x; g[kb] = p.y; }
      }
      if (g.x !== undefined && g.x1 === undefined) { const p = mapPt(g.x, g.y); g.x = p.x; g.y = p.y; }
      if (g.w !== undefined) g.w *= scale;
      if (g.h !== undefined) g.h *= scale;
      if (g.thickness !== undefined) g.thickness = Math.max(4, g.thickness * scale);
      if (g.offset !== undefined) g.offset *= scale;
      if (g.size !== undefined) g.size *= scale;
      if (g.points) g.points = g.points.map((p) => mapPt(p.x, p.y));
      return withMaybeFinding(rng, type, { type, geometry: g });
    });

    return {
      elements: elements.map((e) => ({
        type: e.type,
        geometry: e.geometry,
        confidence: e.confidence,
        findings: e.findings || [],
      })),
    };
  }
}

export const demoTraceProvider = new DemoTraceProvider();
