// Builds the built-in showcase project shown on first run: three synthetic,
// vector-only sheets (no raster — see README "Demo content": we were not
// given actual blueprint scans, only a UI mockup, so this follows the
// brief's documented fallback of a small synthetic vector demo). Each sheet
// is run through the very same DemoTraceProvider a real import would use,
// then most elements are pre-marked verified so the Review workflow has
// something to demonstrate immediately instead of opening on an empty queue.
import { createEmptyDocument, createSheet, createElement, defaultLayerFor, createId } from './plan-schema.js';
import { demoTraceProvider } from './demo-trace-provider.js';
import { bboxOfElement, bboxUnion } from './geometry.js';

const SHEET_SPECS = [
  { name: 'Roof Plan', demoLayout: 'roof' },
  { name: 'First Floor', demoLayout: 'first-floor' },
  { name: 'Second Floor', demoLayout: 'second-floor' },
];

const ASSUMED_BUILDING_WIDTH_INCHES = 52 * 12; // "52'-0"" outer span, matching the mockup

export async function createDemoProject() {
  const doc = createEmptyDocument('800 Green Street');
  doc.settings.gridSize = 1;
  doc.settings.gridUnit = 'in';

  for (const [i, spec] of SHEET_SPECS.entries()) {
    const sheet = createSheet({ name: spec.name, naturalWidth: 1700, naturalHeight: 1300, order: i });

    const context = {
      sheetId: sheet.id,
      sheetName: sheet.name,
      naturalWidth: sheet.naturalWidth,
      naturalHeight: sheet.naturalHeight,
      prep: sheet.prep,
      calibration: sheet.calibration,
      demoLayout: spec.demoLayout,
    };
    const result = await demoTraceProvider.trace(context);
    const elements = result.elements.map((raw) => createElement(raw.type, raw.geometry, {
      layerId: defaultLayerFor(raw.type),
      confidence: raw.confidence,
      status: raw.findings?.length ? 'proposed' : 'verified',
      provider: { id: demoTraceProvider.id, label: demoTraceProvider.label },
      findings: (raw.findings || []).map((f) => ({ ...f, id: createId('finding') })),
    }));

    const wallBox = bboxUnion(elements.filter((e) => e.type === 'wall').map(bboxOfElement));
    const pixelsPerUnit = wallBox ? (wallBox.maxX - wallBox.minX) / ASSUMED_BUILDING_WIDTH_INCHES : null;
    sheet.calibration = { unit: 'ft-in', pixelsPerUnit, points: null, realLength: null };
    sheet.geometry = elements;
    doc.sheets.push(sheet);
  }

  doc.activeSheetId = doc.sheets[1].id; // First Floor, matching the mockup's default view
  return doc;
}
