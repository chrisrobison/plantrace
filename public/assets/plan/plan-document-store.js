// PlanDocumentStore — the ONLY code in PlanTrace allowed to mutate the plan
// document. Every component publishes intent by calling a method here; the
// store applies it, snapshots undo history when appropriate, and notifies
// listeners via plain DOM events. No component may reach into
// `store.document` and edit it directly — see docs/ARCHITECTURE.md.
//
// Undo/redo uses whole-document structuredClone() snapshots rather than an
// inverse-command stack: a plan is at most a few hundred elements, so
// cloning on each edit is cheap, and it is far less code — and far fewer
// ways to get an inverse operation subtly wrong — than hand-written undo for
// eight different geometry types. `transaction(label, fn)` and the explicit
// beginBatch()/endBatch() pair let a whole pointer drag collapse into one
// undo step, matching the reference architecture's process graph store.
//
// Ephemeral UI state (selection, tool mode, view mode, save-state) is kept
// OUTSIDE `this.document` on purpose: it must never enter undo history and
// should not round-trip through JSON export/import.
import { createEmptyDocument, createSheet, createElement, createId, normalizeDocument, validateDocument, defaultLayerFor } from './plan-schema.js';
import { moveElementBy, setEndpoint as setElementEndpoint, elementEndpoints } from './geometry.js';
import { computeReviewStats } from './review.js';

export class PlanDocumentStore extends EventTarget {
  constructor(doc) {
    super();
    const { doc: normalized } = normalizeDocument(doc || createEmptyDocument());
    this.document = normalized;

    // Ephemeral, never persisted / never undoable.
    this.selection = new Set();
    this.toolMode = 'select';
    this.viewMode = 'overlay';
    this.saveState = 'idle'; // idle | saving | saved | error
    this.fixTargetId = null;
    this.workflowStep = 'prepare'; // prepare | trace | review | export

    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this._batchDepth = 0;
  }

  // ── Change plumbing ──────────────────────────────────────────────────────
  _emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  _pushUndo(label) {
    this.undoStack.push({ label, snapshot: structuredClone(this.document) });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Undoable mutation. Nested transactions/batches collapse into the outermost undo step. */
  transaction(label, fn) {
    if (!this._batchDepth) this._pushUndo(label);
    this._batchDepth++;
    try { fn(this.document); } finally {
      this._batchDepth--;
      this.dirty = true;
      this._emit('change', { label });
    }
  }

  /** Explicit open/close pair for interactions spanning multiple discrete calls (a pointer drag). */
  beginBatch(label) { if (!this._batchDepth) this._pushUndo(label); this._batchDepth++; }
  endBatch() { this._batchDepth = Math.max(0, this._batchDepth - 1); this.dirty = true; this._emit('change'); }

  /** Persisted but intentionally non-undoable (viewport pan/zoom, active sheet, save bookkeeping). */
  _mutate(fn) { fn(this.document); this.dirty = true; this._emit('change'); }

  undo() {
    if (!this.undoStack.length) return;
    const entry = this.undoStack.pop();
    this.redoStack.push({ label: entry.label, snapshot: structuredClone(this.document) });
    this.document = entry.snapshot;
    this._pruneSelection();
    this.dirty = true;
    this._emit('change', { label: `Undo ${entry.label}` });
  }

  redo() {
    if (!this.redoStack.length) return;
    const entry = this.redoStack.pop();
    this.undoStack.push({ label: entry.label, snapshot: structuredClone(this.document) });
    this.document = entry.snapshot;
    this._pruneSelection();
    this.dirty = true;
    this._emit('change', { label: `Redo ${entry.label}` });
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  markClean() { this.dirty = false; }

  setSaveState(state) { this.saveState = state; this._emit('savestate', { state }); }

  // ── Project ──────────────────────────────────────────────────────────────
  renameProject(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    this.transaction('Rename project', (doc) => { doc.project.name = trimmed; doc.project.updatedAt = new Date().toISOString(); });
  }

  loadDocument(doc) {
    const { doc: normalized } = normalizeDocument(doc);
    this.document = normalized;
    this.selection = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this._emit('change', { label: 'Load project' });
    this._emit('selection');
  }

  /** Validate + normalize an arbitrary parsed-JSON import. Throws with a readable message if hopeless. */
  importDocument(raw) {
    const { valid, errors } = validateDocument(raw);
    if (!valid && (!raw || typeof raw !== 'object')) throw new Error(`Invalid project file: ${errors.join(' ')}`);
    const { doc: normalized, warnings } = normalizeDocument(raw);
    this.loadDocument(normalized);
    return { warnings };
  }

  exportDocument() { return structuredClone(this.document); }

  // ── Sheets ───────────────────────────────────────────────────────────────
  getSheet(id) { return this.document.sheets.find((s) => s.id === id) || null; }
  getActiveSheet() { return this.getSheet(this.document.activeSheetId); }

  addSheet(overrides = {}) {
    const sheet = createSheet({ ...overrides, order: this.document.sheets.length });
    this.transaction('Add sheet', (doc) => { doc.sheets.push(sheet); doc.activeSheetId = sheet.id; });
    this.selection = new Set();
    this._emit('selection');
    return sheet;
  }

  removeSheet(id) {
    this.transaction('Delete sheet', (doc) => {
      const idx = doc.sheets.findIndex((s) => s.id === id);
      if (idx === -1) return;
      doc.sheets.splice(idx, 1);
      if (doc.activeSheetId === id) doc.activeSheetId = doc.sheets[Math.min(idx, doc.sheets.length - 1)]?.id || null;
    });
    this.selection = new Set();
    this._emit('selection');
  }

  renameSheet(id, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    this.transaction('Rename sheet', (doc) => { const s = doc.sheets.find((x) => x.id === id); if (s) s.name = trimmed; });
  }

  reorderSheets(orderedIds) {
    this.transaction('Reorder sheets', (doc) => {
      const byId = new Map(doc.sheets.map((s) => [s.id, s]));
      const next = orderedIds.map((id) => byId.get(id)).filter(Boolean);
      next.forEach((s, i) => { s.order = i; });
      doc.sheets = next;
    });
  }

  setActiveSheetId(id) {
    if (this.document.activeSheetId === id) return;
    this._mutate((doc) => { doc.activeSheetId = id; });
    this.selection = new Set();
    this.fixTargetId = null;
    this._emit('selection');
  }

  // ── Preparation transforms ───────────────────────────────────────────────
  /**
   * @param {string} sheetId
   * @param {Object} patch prep fields to merge (rotation/crop/brightness/contrast/grayscale/opacity)
   * @param {{naturalWidth?:number, naturalHeight?:number, preparedAssetId?:string|null}} [sheetPatch]
   *        pass when rotation/crop change the sheet's working pixel dimensions or baked derivative
   *        (see raster-prep.js) — applied in the same undo step so geometry authored against the old
   *        dimensions and the dimension change never land in separate undo states.
   */
  updateSheetPrep(sheetId, patch, sheetPatch) {
    this.transaction('Adjust preparation', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      if (!s) return;
      s.prep = { ...s.prep, ...patch };
      if (sheetPatch) Object.assign(s, sheetPatch);
    });
  }

  setSourceOpacity(sheetId, opacity) { this.updateSheetPrep(sheetId, { opacity: Math.max(0, Math.min(100, opacity)) }); }

  setCalibration(sheetId, { pointA, pointB, realLengthInches, unit }) {
    const pixelsPerUnit = computePixelsPerUnitFromInches(pointA, pointB, realLengthInches);
    this.transaction('Set calibration', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      if (!s) return;
      s.calibration = { unit: unit || s.calibration.unit, pixelsPerUnit, points: [pointA, pointB], realLength: realLengthInches };
    });
  }

  setDrawingUnit(sheetId, unit) {
    this.transaction('Set drawing units', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      if (s) s.calibration = { ...s.calibration, unit };
    });
  }

  setViewport(sheetId, patch) {
    this._mutate((doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      if (s) s.viewport = { ...s.viewport, ...patch };
    });
  }

  // ── Layers ───────────────────────────────────────────────────────────────
  setLayerVisibility(sheetId, layerId, visible) {
    this.transaction('Toggle layer visibility', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      const layer = s?.layers.find((l) => l.id === layerId);
      if (layer) layer.visible = visible;
    });
  }

  setLayerColor(sheetId, layerId, color) {
    this.transaction('Set layer color', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      const layer = s?.layers.find((l) => l.id === layerId);
      if (layer) layer.color = color;
    });
  }

  // ── Editor settings (grid/snap/ortho) — persisted, not undo-tracked ──────
  setGridSize(inches) { this._mutate((doc) => { doc.settings.gridSize = Math.max(0.125, inches); }); }
  setSnapping(enabled) { this._mutate((doc) => { doc.settings.snapping = !!enabled; }); }
  setOrtho(enabled) { this._mutate((doc) => { doc.settings.ortho = !!enabled; }); }

  // ── Tool / view mode (ephemeral) ─────────────────────────────────────────
  setToolMode(mode) { if (this.toolMode === mode) return; this.toolMode = mode; this._emit('toolmode', { mode }); }
  setViewMode(mode) { if (this.viewMode === mode) return; this.viewMode = mode; this._emit('viewmode', { mode }); }
  setWorkflowStep(step) { if (this.workflowStep === step) return; this.workflowStep = step; this._emit('workflowstep', { step }); }

  /** Ephemeral cursor world-position, for the status bar's coordinate readout. Not persisted, not undoable, no dirty flag. */
  setCursor(point) { this.cursor = point; this._emit('cursor'); }

  // ── Selection (ephemeral) ────────────────────────────────────────────────
  select(ids, { additive = false } = {}) {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this._emit('selection');
  }

  toggleSelect(id) {
    if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
    this._emit('selection');
  }

  clearSelection() { if (!this.selection.size) return; this.selection.clear(); this._emit('selection'); }
  selectedIds() { return [...this.selection]; }

  _pruneSelection() {
    const sheet = this.getActiveSheet();
    const ids = new Set(sheet ? sheet.geometry.map((e) => e.id) : []);
    this.selection = new Set([...this.selection].filter((id) => ids.has(id)));
    this._emit('selection');
  }

  // ── Geometry ─────────────────────────────────────────────────────────────
  addElement(sheetId, type, geometry, overrides = {}) {
    const el = createElement(type, geometry, overrides);
    this.transaction('Add element', (doc) => { doc.sheets.find((s) => s.id === sheetId)?.geometry.push(el); });
    return el;
  }

  deleteElements(sheetId, ids) {
    const idSet = new Set(ids);
    this.transaction('Delete', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      if (s) s.geometry = s.geometry.filter((e) => !idSet.has(e.id));
    });
    for (const id of idSet) this.selection.delete(id);
    this._emit('selection');
  }

  moveElements(sheetId, ids, dx, dy) {
    this.transaction('Move', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      if (!s) return;
      for (const el of s.geometry) if (ids.includes(el.id)) { moveElementBy(el, dx, dy); this._maybeMarkCorrected(el); }
    });
  }

  setEndpoint(sheetId, elementId, key, x, y) {
    this.transaction('Adjust geometry', (doc) => {
      const s = doc.sheets.find((x2) => x2.id === sheetId);
      const el = s?.geometry.find((e) => e.id === elementId);
      if (!el) return;
      setElementEndpoint(el, key, x, y);
      this._maybeMarkCorrected(el);
    });
  }

  updateElementGeometry(sheetId, elementId, patch) {
    this.transaction('Edit geometry', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      const el = s?.geometry.find((e) => e.id === elementId);
      if (!el) return;
      el.geometry = { ...el.geometry, ...patch };
      this._maybeMarkCorrected(el);
    });
  }

  updateElementMeta(sheetId, elementId, patch) {
    this.transaction('Edit element', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      const el = s?.geometry.find((e) => e.id === elementId);
      if (!el) return;
      if (patch.layerId) el.layerId = patch.layerId;
      if (patch.confidence !== undefined) el.confidence = patch.confidence;
    });
  }

  _maybeMarkCorrected(el) {
    if (this.fixTargetId === el.id && el.status === 'proposed') el.status = 'corrected';
  }

  // ── Review workflow ──────────────────────────────────────────────────────
  setElementStatus(sheetId, elementId, status) {
    this.transaction(`Mark ${status}`, (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      const el = s?.geometry.find((e) => e.id === elementId);
      if (el) el.status = status;
    });
    if (this.fixTargetId === elementId) this.fixTargetId = null;
  }

  setElementsStatus(sheetId, ids, status) {
    const idSet = new Set(ids);
    this.transaction(`Mark ${status} (${ids.length})`, (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      if (!s) return;
      for (const el of s.geometry) if (idSet.has(el.id)) el.status = status;
    });
  }

  acceptAllAboveConfidence(sheetId, threshold) {
    const sheet = this.getSheet(sheetId);
    if (!sheet) return 0;
    const ids = sheet.geometry.filter((e) => e.status === 'proposed' && e.confidence >= threshold).map((e) => e.id);
    if (ids.length) this.setElementsStatus(sheetId, ids, 'verified');
    return ids.length;
  }

  /** Enter "fix" mode for one element: select it and flag it so the next geometry edit auto-promotes it to 'corrected'. */
  beginFix(sheetId, elementId) {
    this.setActiveSheetIdIfNeeded(sheetId);
    this.fixTargetId = elementId;
    this.select([elementId]);
    this.setToolMode('select');
    this._emit('fix', { elementId });
  }

  setActiveSheetIdIfNeeded(sheetId) { if (sheetId && this.document.activeSheetId !== sheetId) this.setActiveSheetId(sheetId); }

  getReviewStats(sheetId) {
    const sheet = this.getSheet(sheetId);
    return computeReviewStats(sheet ? sheet.geometry : []);
  }

  // ── Trace provider integration ───────────────────────────────────────────
  /** Replace a sheet's geometry with a provider's fresh proposals. See docs/TRACE-PROVIDER.md. */
  async runTraceProvider(sheetId, provider, options = {}) {
    const sheet = this.getSheet(sheetId);
    if (!sheet) return;
    const context = {
      sheetId: sheet.id,
      sheetName: sheet.name,
      naturalWidth: sheet.naturalWidth,
      naturalHeight: sheet.naturalHeight,
      prep: sheet.prep,
      calibration: sheet.calibration,
      ...options,
    };
    const result = await provider.trace(context);
    const elements = (result.elements || []).map((raw) => createElement(raw.type, raw.geometry, {
      layerId: defaultLayerFor(raw.type),
      confidence: raw.confidence,
      status: 'proposed',
      provider: { id: provider.id, label: provider.label },
      sourceRegion: raw.sourceRegion || null,
      findings: (raw.findings || []).map((f) => ({ ...f, id: createId('finding') })),
    }));
    this.transaction('Run trace provider', (doc) => {
      const s = doc.sheets.find((x) => x.id === sheetId);
      if (s) s.geometry = elements;
    });
    this.selection = new Set();
    this._emit('selection');
    return elements.length;
  }
}

function computePixelsPerUnitFromInches(pointA, pointB, realLengthInches) {
  const px = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  if (px <= 0 || !realLengthInches || realLengthInches <= 0) return null;
  return px / realLengthInches;
}

export { elementEndpoints };
