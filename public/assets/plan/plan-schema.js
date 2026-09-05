// Normalized, versioned project document schema for PlanTrace.
//
// This module is the single source of truth for "what a valid document looks
// like." PlanDocumentStore imports normalizeDocument()/validateDocument() so
// that importing a hand-edited or foreign JSON file can never silently
// corrupt editor state — anything the normalizer can't make sense of is
// dropped (with a warning collected for the caller), never left half-shaped.
//
// See docs/PROJECT-FORMAT.md for the human-readable version of this file.

export const SCHEMA_VERSION = 1;

export const GEOMETRY_TYPES = ['wall', 'door', 'window', 'stair', 'fixture', 'dimension', 'text', 'room'];

export const REVIEW_STATUSES = ['proposed', 'verified', 'corrected', 'rejected'];

export const FINDING_SEVERITIES = ['info', 'warning', 'error'];

export const UNIT_OPTIONS = ['ft-in', 'ft', 'in', 'm', 'cm', 'mm'];

// Layer ids double as the default layer for every element of the matching
// geometry type; `source` is a pseudo-layer controlling the raster image.
export const LAYER_DEFS = [
  { id: 'walls', name: 'Walls', color: '#8b93a1' },
  { id: 'doors', name: 'Doors', color: '#e0529c' },
  { id: 'windows', name: 'Windows', color: '#3aa0e0' },
  { id: 'stairs', name: 'Stairs', color: '#c98a3a' },
  { id: 'fixtures', name: 'Fixtures', color: '#7c8b99' },
  { id: 'dimensions', name: 'Dimensions', color: '#2fae66' },
  { id: 'text', name: 'Text', color: '#9aa3ad' },
  { id: 'rooms', name: 'Room Labels', color: '#6f7d90' },
  { id: 'source', name: 'Scanned Image', color: '#ffffff' },
];

const TYPE_TO_LAYER = { wall: 'walls', door: 'doors', window: 'windows', stair: 'stairs', fixture: 'fixtures', dimension: 'dimensions', text: 'text', room: 'rooms' };

let _idCounter = 0;
export function createId(prefix = 'id') {
  _idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${(_idCounter % 1296).toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function defaultLayerFor(type) {
  return TYPE_TO_LAYER[type] || 'walls';
}

export function createDefaultLayers() {
  return LAYER_DEFS.map((def) => ({ ...def, visible: true, locked: false }));
}

export function createDefaultPrep() {
  return { rotation: 0, crop: null, brightness: 100, contrast: 100, grayscale: 0, opacity: 100 };
}

export function createDefaultCalibration() {
  return { unit: 'ft-in', pixelsPerUnit: null, points: null, realLength: null };
}

export function createSheet(overrides = {}) {
  return {
    id: overrides.id || createId('sheet'),
    name: overrides.name || 'Untitled Sheet',
    order: overrides.order ?? 0,
    originalFilename: overrides.originalFilename || null,
    assetId: overrides.assetId || null,
    // Set only when rotation/crop require a baked derivative of the
    // original (see raster-prep.js); null means "display the original
    // asset as-is," which is the common no-rotation/no-crop case.
    preparedAssetId: overrides.preparedAssetId || null,
    naturalWidth: overrides.naturalWidth || 1600,
    naturalHeight: overrides.naturalHeight || 1200,
    prep: { ...createDefaultPrep(), ...(overrides.prep || {}) },
    calibration: { ...createDefaultCalibration(), ...(overrides.calibration || {}) },
    viewport: { x: 0, y: 0, zoom: 1, ...(overrides.viewport || {}) },
    layers: overrides.layers || createDefaultLayers(),
    geometry: overrides.geometry || [],
    thumbnail: overrides.thumbnail || null,
  };
}

export function createElement(type, geometry, overrides = {}) {
  return {
    id: overrides.id || createId('el'),
    type,
    layerId: overrides.layerId || defaultLayerFor(type),
    geometry,
    confidence: overrides.confidence ?? 1,
    status: overrides.status || 'proposed',
    provider: overrides.provider || { id: 'manual', label: 'Manual entry' },
    sourceRegion: overrides.sourceRegion || null,
    findings: overrides.findings || [],
  };
}

export function createProject(name = 'Untitled Project') {
  const now = new Date().toISOString();
  return { id: createId('proj'), name, createdAt: now, updatedAt: now };
}

export function createEmptyDocument(name = 'Untitled Project') {
  return {
    version: SCHEMA_VERSION,
    project: createProject(name),
    sheets: [],
    activeSheetId: null,
    settings: { gridSize: 12, gridUnit: 'in', snapping: true, ortho: true },
  };
}

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function normalizeFinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const severity = FINDING_SEVERITIES.includes(raw.severity) ? raw.severity : 'info';
  const message = typeof raw.message === 'string' ? raw.message : '';
  if (!message) return null;
  return { id: typeof raw.id === 'string' ? raw.id : createId('finding'), severity, message, code: typeof raw.code === 'string' ? raw.code : '' };
}

function normalizeGeometryFor(type, raw) {
  const num = (v, d = 0) => (isFiniteNum(v) ? v : d);
  switch (type) {
    case 'wall':
      return { x1: num(raw?.x1), y1: num(raw?.y1), x2: num(raw?.x2, 100), y2: num(raw?.y2), thickness: num(raw?.thickness, 6) };
    case 'door':
      return { x1: num(raw?.x1), y1: num(raw?.y1), x2: num(raw?.x2, 36), y2: num(raw?.y2), swing: raw?.swing === 'left' ? 'left' : 'right', hinge: raw?.hinge === 'end' ? 'end' : 'start' };
    case 'window':
      return { x1: num(raw?.x1), y1: num(raw?.y1), x2: num(raw?.x2, 36), y2: num(raw?.y2) };
    case 'stair':
      return { x: num(raw?.x), y: num(raw?.y), w: num(raw?.w, 40), h: num(raw?.h, 120), steps: Math.max(2, Math.round(num(raw?.steps, 10))), rotation: num(raw?.rotation, 0), direction: raw?.direction === 'down' ? 'down' : 'up' };
    case 'fixture':
      return { x: num(raw?.x), y: num(raw?.y), w: num(raw?.w, 30), h: num(raw?.h, 20), rotation: num(raw?.rotation, 0), kind: typeof raw?.kind === 'string' ? raw.kind : 'generic', shape: raw?.shape === 'circle' ? 'circle' : 'rect' };
    case 'dimension':
      return { x1: num(raw?.x1), y1: num(raw?.y1), x2: num(raw?.x2, 100), y2: num(raw?.y2), offset: num(raw?.offset, 24), label: typeof raw?.label === 'string' ? raw.label : null };
    case 'text':
      return { x: num(raw?.x), y: num(raw?.y), rotation: num(raw?.rotation, 0), size: num(raw?.size, 14), content: typeof raw?.content === 'string' ? raw.content : 'Text' };
    case 'room':
      return { x: num(raw?.x), y: num(raw?.y), label: typeof raw?.label === 'string' ? raw.label : 'Room', points: Array.isArray(raw?.points) ? raw.points.filter((p) => isFiniteNum(p?.x) && isFiniteNum(p?.y)).map((p) => ({ x: p.x, y: p.y })) : [] };
    default:
      return null;
  }
}

export function normalizeElement(raw) {
  if (!raw || typeof raw !== 'object' || !GEOMETRY_TYPES.includes(raw.type)) return null;
  const geometry = normalizeGeometryFor(raw.type, raw.geometry);
  if (!geometry) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('el'),
    type: raw.type,
    layerId: typeof raw.layerId === 'string' ? raw.layerId : defaultLayerFor(raw.type),
    geometry,
    confidence: isFiniteNum(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 1,
    status: REVIEW_STATUSES.includes(raw.status) ? raw.status : 'proposed',
    provider: raw.provider && typeof raw.provider === 'object' ? { id: String(raw.provider.id || 'unknown'), label: String(raw.provider.label || raw.provider.id || 'Unknown') } : { id: 'manual', label: 'Manual entry' },
    sourceRegion: raw.sourceRegion && isFiniteNum(raw.sourceRegion.x) ? { x: raw.sourceRegion.x, y: raw.sourceRegion.y, w: raw.sourceRegion.w, h: raw.sourceRegion.h } : null,
    findings: Array.isArray(raw.findings) ? raw.findings.map(normalizeFinding).filter(Boolean) : [],
  };
}

export function normalizeSheet(raw, index, warnings) {
  if (!raw || typeof raw !== 'object') { warnings.push(`Sheet at index ${index} was not an object; skipped.`); return null; }
  const layers = Array.isArray(raw.layers) && raw.layers.length
    ? createDefaultLayers().map((def) => {
        const found = raw.layers.find((l) => l && l.id === def.id);
        return found ? { ...def, visible: found.visible !== false, locked: !!found.locked, color: typeof found.color === 'string' ? found.color : def.color } : def;
      })
    : createDefaultLayers();
  const geometry = Array.isArray(raw.geometry)
    ? raw.geometry.map(normalizeElement).filter(Boolean)
    : [];
  if (Array.isArray(raw.geometry) && geometry.length !== raw.geometry.length) {
    warnings.push(`Sheet "${raw.name || index}" had ${raw.geometry.length - geometry.length} invalid geometry entr${raw.geometry.length - geometry.length === 1 ? 'y' : 'ies'} dropped.`);
  }
  return createSheet({
    id: typeof raw.id === 'string' && raw.id ? raw.id : undefined,
    name: typeof raw.name === 'string' && raw.name ? raw.name : `Sheet ${index + 1}`,
    order: isFiniteNum(raw.order) ? raw.order : index,
    originalFilename: typeof raw.originalFilename === 'string' ? raw.originalFilename : null,
    assetId: typeof raw.assetId === 'string' ? raw.assetId : null,
    preparedAssetId: typeof raw.preparedAssetId === 'string' ? raw.preparedAssetId : null,
    naturalWidth: isFiniteNum(raw.naturalWidth) && raw.naturalWidth > 0 ? raw.naturalWidth : 1600,
    naturalHeight: isFiniteNum(raw.naturalHeight) && raw.naturalHeight > 0 ? raw.naturalHeight : 1200,
    prep: raw.prep,
    calibration: raw.calibration && UNIT_OPTIONS.includes(raw.calibration.unit) ? raw.calibration : undefined,
    viewport: raw.viewport,
    layers,
    geometry,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : null,
  });
}

/**
 * Normalize an arbitrary parsed-JSON value into a valid document.
 * Never throws; anything unusable is dropped and reported in `warnings`.
 */
export function normalizeDocument(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object') {
    warnings.push('Document root was not an object; created a new empty project.');
    return { doc: createEmptyDocument(), warnings };
  }
  const project = raw.project && typeof raw.project === 'object'
    ? { id: typeof raw.project.id === 'string' ? raw.project.id : createId('proj'), name: typeof raw.project.name === 'string' && raw.project.name ? raw.project.name : 'Untitled Project', createdAt: typeof raw.project.createdAt === 'string' ? raw.project.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString() }
    : createProject();
  const sheets = Array.isArray(raw.sheets) ? raw.sheets.map((s, i) => normalizeSheet(s, i, warnings)).filter(Boolean) : [];
  const activeSheetId = sheets.some((s) => s.id === raw.activeSheetId) ? raw.activeSheetId : (sheets[0]?.id || null);
  const settings = {
    gridSize: isFiniteNum(raw.settings?.gridSize) && raw.settings.gridSize > 0 ? raw.settings.gridSize : 12,
    gridUnit: typeof raw.settings?.gridUnit === 'string' ? raw.settings.gridUnit : 'in',
    snapping: raw.settings?.snapping !== false,
    ortho: raw.settings?.ortho !== false,
  };
  if (!sheets.length && Array.isArray(raw.sheets) && raw.sheets.length) {
    warnings.push('No sheets survived validation; every sheet entry was invalid.');
  }
  return { doc: { version: SCHEMA_VERSION, project, sheets, activeSheetId, settings }, warnings };
}

/** Structural validity check (used before accepting an imported file). Returns {valid, errors}. */
export function validateDocument(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') errors.push('Document is not an object.');
  else {
    if (!doc.project || typeof doc.project.name !== 'string') errors.push('Missing project.name.');
    if (!Array.isArray(doc.sheets)) errors.push('sheets must be an array.');
  }
  return { valid: errors.length === 0, errors };
}

export function cloneDocument(doc) {
  return structuredClone(doc);
}
