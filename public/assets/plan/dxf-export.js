// Minimal, dependency-free ASCII DXF (AutoCAD 2000 / AC1015) writer.
// Produces a LAYER table plus LINE / LWPOLYLINE / ARC / CIRCLE / TEXT
// entities — primitives that are well-supported without a third-party DXF
// library. Rejected elements are omitted. Coordinates are flipped from the
// image's Y-down pixel space to DXF's Y-up drawing space, and are divided
// down to real-world units when the sheet has been calibrated (otherwise
// raw source pixels are written as-is, which is honest about the fact that
// nothing has been measured yet).
import { elementToPrimitives } from './primitives.js';
import { isCalibrated } from './units.js';

const DXF_LAYERS = [
  { name: 'WALLS', color: 7 },
  { name: 'DOORS', color: 6 },
  { name: 'WINDOWS', color: 5 },
  { name: 'STAIRS', color: 30 },
  { name: 'FIXTURES', color: 8 },
  { name: 'DIMENSIONS', color: 3 },
  { name: 'TEXT', color: 8 },
  { name: 'ROOMS', color: 9 },
  { name: 'SOURCE_REFERENCE', color: 1 },
];

const ELEMENT_LAYER = { wall: 'WALLS', door: 'DOORS', window: 'WINDOWS', stair: 'STAIRS', fixture: 'FIXTURES', dimension: 'DIMENSIONS', text: 'TEXT', room: 'ROOMS' };

function dxfLines(pairs) {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function normalizeMinorArc(a1, a2) {
  let d = ((a2 - a1) % 360 + 360) % 360;
  if (d > 180) return [a2, a1];
  return [a1, a2];
}

export function exportSheetToDXF(sheet) {
  const calibrated = isCalibrated(sheet.calibration);
  const unitScale = calibrated ? 1 / sheet.calibration.pixelsPerUnit : 1;
  const h = sheet.naturalHeight;
  const toCad = (x, y) => ({ x: x * unitScale, y: (h - y) * unitScale });

  const entities = [];

  const emitLine = (layer, x1, y1, x2, y2) => {
    const a = toCad(x1, y1), b = toCad(x2, y2);
    entities.push(dxfLines([[0, 'LINE'], [8, layer], [10, a.x.toFixed(4)], [20, a.y.toFixed(4)], [30, 0], [11, b.x.toFixed(4)], [21, b.y.toFixed(4)], [31, 0]]));
  };

  const emitPolyline = (layer, points, closed) => {
    const pts = points.map((p) => toCad(p.x, p.y));
    const head = [[0, 'LWPOLYLINE'], [8, layer], [90, pts.length], [70, closed ? 1 : 0]];
    const body = pts.flatMap((p) => [[10, p.x.toFixed(4)], [20, p.y.toFixed(4)]]);
    entities.push(dxfLines([...head, ...body]));
  };

  const emitArc = (layer, cx, cy, r, startDeg, endDeg) => {
    const centerCad = toCad(cx, cy);
    const p1 = toCad(cx + r * Math.cos((startDeg * Math.PI) / 180), cy + r * Math.sin((startDeg * Math.PI) / 180));
    const p2 = toCad(cx + r * Math.cos((endDeg * Math.PI) / 180), cy + r * Math.sin((endDeg * Math.PI) / 180));
    const a1raw = (Math.atan2(p1.y - centerCad.y, p1.x - centerCad.x) * 180) / Math.PI;
    const a2raw = (Math.atan2(p2.y - centerCad.y, p2.x - centerCad.x) * 180) / Math.PI;
    const [a1, a2] = normalizeMinorArc(a1raw, a2raw);
    const rCad = Math.hypot(p1.x - centerCad.x, p1.y - centerCad.y);
    entities.push(dxfLines([[0, 'ARC'], [8, layer], [10, centerCad.x.toFixed(4)], [20, centerCad.y.toFixed(4)], [30, 0], [40, rCad.toFixed(4)], [50, a1.toFixed(2)], [51, a2.toFixed(2)]]));
  };

  const emitCircle = (layer, cx, cy, r) => {
    const c = toCad(cx, cy);
    entities.push(dxfLines([[0, 'CIRCLE'], [8, layer], [10, c.x.toFixed(4)], [20, c.y.toFixed(4)], [30, 0], [40, (r * unitScale).toFixed(4)]]));
  };

  const emitText = (layer, x, y, content, size, rotation) => {
    const p = toCad(x, y);
    entities.push(dxfLines([[0, 'TEXT'], [8, layer], [10, p.x.toFixed(4)], [20, p.y.toFixed(4)], [30, 0], [40, ((size || 12) * unitScale).toFixed(3)], [1, String(content).replace(/[\r\n]+/g, ' ')], [50, (-(rotation || 0)).toFixed(2)]]));
  };

  for (const el of sheet.geometry) {
    if (el.status === 'rejected') continue;
    const layer = ELEMENT_LAYER[el.type] || 'WALLS';
    for (const prim of elementToPrimitives(el, sheet.calibration)) {
      if (prim.kind === 'line') emitLine(layer, prim.x1, prim.y1, prim.x2, prim.y2);
      else if (prim.kind === 'polyline') emitPolyline(layer, prim.points, !!prim.closed);
      else if (prim.kind === 'arc') emitArc(layer, prim.cx, prim.cy, prim.r, prim.startAngleDeg, prim.endAngleDeg);
      else if (prim.kind === 'circle') emitCircle(layer, prim.cx, prim.cy, prim.r);
      else if (prim.kind === 'text') emitText(layer, prim.x, prim.y, prim.content, prim.size, prim.rotation);
    }
  }

  // SOURCE_REFERENCE: the sheet's full pixel bounds, so the export can be
  // realigned against the original scan later even though the raster itself
  // isn't embedded.
  emitPolyline('SOURCE_REFERENCE', [{ x: 0, y: 0 }, { x: sheet.naturalWidth, y: 0 }, { x: sheet.naturalWidth, y: h }, { x: 0, y: h }], true);
  emitText('SOURCE_REFERENCE', 8, h - 8, `Source: ${sheet.originalFilename || sheet.name} — NOT construction-ready, verify against field measurements.`, 10, 0);

  const layerTable = DXF_LAYERS.map((l) => dxfLines([[0, 'LAYER'], [2, l.name], [70, 0], [62, l.color], [6, 'CONTINUOUS']])).join('\n');

  return [
    dxfLines([[0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1015'], [9, '$INSUNITS'], [70, calibrated ? 1 : 0]]),
    '0\nENDSEC',
    dxfLines([[0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, DXF_LAYERS.length]]),
    layerTable,
    '0\nENDTAB',
    '0\nENDSEC',
    dxfLines([[0, 'SECTION'], [2, 'BLOCKS']]),
    '0\nENDSEC',
    dxfLines([[0, 'SECTION'], [2, 'ENTITIES']]),
    entities.join('\n'),
    '0\nENDSEC',
    '0\nEOF',
  ].join('\n') + '\n';
}

export function downloadDXF(sheet) {
  const dxf = exportSheetToDXF(sheet);
  const blob = new Blob([dxf], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(sheet.name || 'sheet').replace(/[^a-z0-9-_]+/gi, '_')}.dxf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
