// <pt-plan-workspace> — the central rendering + interaction surface.
// One transformed "world" per visible pane (raster <img> + SVG geometry
// layer share the exact same transform), so pan/zoom is a single CSS
// transform and raster/vector registration can never drift — including in
// Split view, where two independently-clipped panes share the same
// transform values and therefore stay pixel-registered across the divider.
//
// All interaction is delegated at this element's root: one pointerdown
// handler decides (via math against the document's geometry, not per-shape
// DOM listeners) whether it hit a handle, an element, or empty space, then
// drives the rest of the gesture with pointer capture. See docs/ARCHITECTURE.md.
import { PtElement, esc, bus, toast } from '../core.js';
import { iconMarkup } from '../icons/icons.js';
import { projectRepository } from '../plan/indexeddb-project-repository.js';
import { elementToPrimitives } from '../plan/primitives.js';
import { bboxOfElement, bboxUnion, elementEndpoints, hitTestElement, closestPointOnSegment, dist, angleOf } from '../plan/geometry.js';
import { computeSnap } from '../plan/snapping.js';
import { isCalibrated, inchesToPx } from '../plan/units.js';
import { cssFilterFor } from '../plan/raster-prep.js';
import './pt-context-toolbar.js';

const HANDLE_SCREEN_PX = 5;
const HIT_TOLERANCE_SCREEN = 8;
const FALLBACK_GRID_PX = 24;
const DEFAULT_DOOR_PX = 34;
const DEFAULT_WINDOW_PX = 40;

export class PtPlanWorkspace extends PtElement {
  connect() {
    this.tabIndex = 0;
    this.setAttribute('role', 'application');
    this.setAttribute('aria-roledescription', 'CAD drawing canvas');
    this.setAttribute('aria-label', 'Plan workspace');
    this.innerHTML = `
      <div class="pt-workspace-empty" data-empty>
        <div class="pt-workspace-empty-card">
          <h2>No sheet selected</h2>
          <p>Import a scanned floor plan (JPG, PNG, WebP, or PDF) or load the demo project to explore PlanTrace.</p>
          <div style="display:flex; gap:8px;">
            <button type="button" class="pt-btn pt-btn-primary" data-empty-import>${iconMarkup('upload', { size: 16 })}Import a sheet</button>
            <button type="button" class="pt-btn" data-empty-demo>Load demo project</button>
          </div>
        </div>
      </div>
      <div class="pt-viewport" data-viewport>
        <div class="pt-pane" data-pane="combined">
          <div class="pt-world" data-world="combined"><div class="pt-world-surface" data-surface="combined">
            <img class="pt-raster-img" data-raster="combined" hidden alt="">
            <svg class="pt-scene-svg" data-scene="combined"></svg>
          </div></div>
        </div>
        <div class="pt-pane" data-pane="splitRaster" hidden>
          <div class="pt-world" data-world="splitRaster"><div class="pt-world-surface" data-surface="splitRaster">
            <img class="pt-raster-img" data-raster="splitRaster" hidden alt="">
            <svg class="pt-scene-svg" data-scene="splitRaster"></svg>
          </div></div>
        </div>
        <div class="pt-pane" data-pane="splitVector" hidden>
          <div class="pt-world" data-world="splitVector"><div class="pt-world-surface" data-surface="splitVector">
            <svg class="pt-scene-svg" data-scene="splitVector"></svg>
          </div></div>
        </div>
        <div class="pt-split-divider" data-divider hidden><div class="pt-split-handle">${iconMarkup('drag', { size: 14 })}</div></div>
        <span class="pt-split-label pt-left" data-split-label-left hidden>Source</span>
        <span class="pt-split-label pt-right" data-split-label-right hidden>Reconstructed</span>
        <div class="pt-no-source-note" data-no-source hidden>No source image on this sheet</div>
        <div class="pt-rubberband" data-rubberband hidden></div>
      </div>
      <pt-context-toolbar data-context-toolbar></pt-context-toolbar>
      <div class="pt-zoom-controls">
        <button type="button" class="pt-btn pt-btn-icon" data-zoom-in aria-label="Zoom in" title="Zoom in">${iconMarkup('zoomIn')}</button>
        <button type="button" class="pt-btn pt-btn-icon" data-zoom-out aria-label="Zoom out" title="Zoom out">${iconMarkup('zoomOut')}</button>
        <button type="button" class="pt-btn pt-btn-icon" data-fit aria-label="Fit to view" title="Fit (F)">${iconMarkup('fit')}</button>
      </div>
    `;
    this._empty = this.querySelector('[data-empty]');
    this._viewport = this.querySelector('[data-viewport]');
    this._divider = this.querySelector('[data-divider]');
    this._noSource = this.querySelector('[data-no-source]');
    this._rubberband = this.querySelector('[data-rubberband]');
    this._contextToolbar = this.querySelector('[data-context-toolbar]');
    this._splitPct = 50;
    this._draft = null; // in-progress wall/dimension draw

    this.addEventListener('click', (e) => {
      if (e.target.closest('[data-empty-import]')) bus.publish('sheets.import.request', {});
      if (e.target.closest('[data-empty-demo]')) bus.publish('demo.load.request', {});
      if (e.target.closest('[data-zoom-in]')) this._zoomBy(1.25);
      if (e.target.closest('[data-zoom-out]')) this._zoomBy(0.8);
      if (e.target.closest('[data-fit]')) this.fitToView();
    }, { signal: this.abort.signal });

    bus.subscribe('workspace.zoom', (d) => this._zoomBy(d.direction > 0 ? 1.25 : 0.8), this.abort.signal);
    bus.subscribe('workspace.fit', () => this.fitToView(), this.abort.signal);
    bus.subscribe('workspace.focusElement', (d) => this._focusBox(d.box), this.abort.signal);

    this._bindPointer();
    this._bindWheel();
    this._bindKeyboard();
    this._bindSplitDrag();
  }

  disconnect() { this._revokeRasterUrl(); }

  set store(store) {
    this._store = store;
    this._contextToolbar.store = store;
    this._onChange = () => this._scheduleRender();
    ['change', 'selection', 'toolmode', 'viewmode', 'fix'].forEach((evt) => store.addEventListener(evt, this._onChange, { signal: this.abort.signal }));
    this.render();
  }

  _scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.render(); });
  }

  // ── Raster asset resolution ─────────────────────────────────────────────
  _revokeRasterUrl() { if (this._rasterUrl) { URL.revokeObjectURL(this._rasterUrl); this._rasterUrl = null; } }

  async _syncRaster(sheet) {
    const assetId = sheet.preparedAssetId || sheet.assetId;
    if (!assetId) { this._revokeRasterUrl(); this._rasterKey = null; this._scheduleRender(); return; }
    if (this._rasterKey === assetId) return;
    this._rasterKey = assetId;
    try {
      const asset = await projectRepository.loadAsset(assetId);
      if (this._rasterKey !== assetId || !asset) return;
      this._revokeRasterUrl();
      this._rasterUrl = URL.createObjectURL(asset.blob);
    } catch {
      this._rasterUrl = null;
    }
    this._scheduleRender();
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  render() {
    if (!this._store) return;
    const sheet = this._store.getActiveSheet();
    this._empty.hidden = !!sheet;
    this._viewport.style.visibility = sheet ? 'visible' : 'hidden';
    this._contextToolbar.hidden = !sheet;
    if (!sheet) return;

    this._syncRaster(sheet);
    const mode = this._store.viewMode;
    const isSplit = mode === 'split';
    this.querySelector('[data-pane="combined"]').hidden = isSplit;
    this.querySelector('[data-pane="splitRaster"]').hidden = !isSplit;
    this.querySelector('[data-pane="splitVector"]').hidden = !isSplit;
    this._divider.hidden = !isSplit;
    this.querySelector('[data-split-label-left]').hidden = !isSplit || !sheet.assetId;
    this.querySelector('[data-split-label-right]').hidden = !isSplit;
    this._noSource.hidden = !!sheet.assetId || (!isSplit && mode === 'after');
    this._noSource.style.top = isSplit ? '48px' : '10px';

    const vp = sheet.viewport;
    const transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;

    if (isSplit) {
      this.querySelector('[data-world="splitRaster"]').style.transform = transform;
      this.querySelector('[data-world="splitVector"]').style.transform = transform;
      this._renderPane('splitRaster', sheet, { showRaster: true, showGeometry: false });
      this._renderPane('splitVector', sheet, { showRaster: false, showGeometry: true });
      this.querySelector('[data-pane="splitRaster"]').style.clipPath = `inset(0 ${100 - this._splitPct}% 0 0)`;
      this.querySelector('[data-pane="splitVector"]').style.clipPath = `inset(0 0 0 ${this._splitPct}%)`;
      this._divider.style.left = `${this._splitPct}%`;
    } else {
      this.querySelector('[data-world="combined"]').style.transform = transform;
      this._renderPane('combined', sheet, { showRaster: mode !== 'after', showGeometry: mode !== 'before' });
    }
  }

  _renderPane(key, sheet, { showRaster, showGeometry }) {
    const img = this.querySelector(`[data-raster="${key}"]`);
    if (img) {
      if (showRaster && this._rasterUrl) {
        img.hidden = false;
        img.src = this._rasterUrl;
        img.style.width = `${sheet.naturalWidth}px`;
        img.style.height = `${sheet.naturalHeight}px`;
        img.style.filter = cssFilterFor(sheet.prep);
        const sourceLayer = sheet.layers.find((l) => l.id === 'source');
        img.style.opacity = sourceLayer?.visible === false ? '0' : String(sheet.prep.opacity / 100);
      } else {
        img.hidden = true;
      }
    }
    const svg = this.querySelector(`[data-scene="${key}"]`);
    svg.setAttribute('width', sheet.naturalWidth);
    svg.setAttribute('height', sheet.naturalHeight);
    svg.setAttribute('viewBox', `0 0 ${sheet.naturalWidth} ${sheet.naturalHeight}`);
    svg.innerHTML = this._buildSceneMarkup(sheet, showGeometry);
    const surface = this.querySelector(`[data-surface="${key}"]`);
    surface.style.width = `${sheet.naturalWidth}px`;
    surface.style.height = `${sheet.naturalHeight}px`;
  }

  _gridPx(sheet) {
    const doc = this._store.document;
    return isCalibrated(sheet.calibration) ? inchesToPx(doc.settings.gridSize, sheet.calibration) : FALLBACK_GRID_PX;
  }

  _buildSceneMarkup(sheet, showGeometry) {
    const gridPx = this._gridPx(sheet);
    const majorEvery = 5;
    const defs = `<defs>
      <pattern id="pt-grid-minor" width="${gridPx}" height="${gridPx}" patternUnits="userSpaceOnUse">
        <path d="M ${gridPx} 0 L 0 0 0 ${gridPx}" fill="none" stroke="var(--pt-canvas-grid-minor)" stroke-width="1"/>
      </pattern>
      <pattern id="pt-grid-major" width="${gridPx * majorEvery}" height="${gridPx * majorEvery}" patternUnits="userSpaceOnUse">
        <rect width="${gridPx * majorEvery}" height="${gridPx * majorEvery}" fill="url(#pt-grid-minor)"/>
        <path d="M ${gridPx * majorEvery} 0 L 0 0 0 ${gridPx * majorEvery}" fill="none" stroke="var(--pt-canvas-grid-major)" stroke-width="1"/>
      </pattern>
    </defs>`;
    const grid = `<rect x="0" y="0" width="${sheet.naturalWidth}" height="${sheet.naturalHeight}" fill="url(#pt-grid-major)"/>`;
    if (!showGeometry) return defs + grid;

    const layerVis = new Map(sheet.layers.map((l) => [l.id, l.visible]));
    const geometryHtml = sheet.geometry.filter((el) => layerVis.get(el.layerId) !== false).map((el) => this._elementSvg(el, sheet)).join('');
    const zoom = sheet.viewport.zoom || 1;
    const selectionHtml = showGeometry ? this._selectionSvg(sheet, zoom) : '';
    const draftHtml = this._draftSvg(sheet);
    const calibHtml = this._calibDraft ? `<circle class="pt-snap-marker" cx="${this._calibDraft.points[0].x}" cy="${this._calibDraft.points[0].y}" r="${6 / zoom}" fill="none" stroke="var(--pt-amber)" stroke-width="${2 / zoom}"/>` : '';
    return `${defs}${grid}<g class="pt-geometry-layer">${geometryHtml}</g><g class="pt-interaction-layer">${selectionHtml}${draftHtml}${calibHtml}</g>`;
  }

  _elementSvg(el, sheet) {
    const prims = elementToPrimitives(el, sheet.calibration);
    const body = prims.map((p) => this._primitiveSvg(p, el.type)).join('');
    const selected = this._store.selection.has(el.id);
    const ambiguous = el.status === 'proposed' && el.findings.length > 0;
    const fixing = this._store.fixTargetId === el.id;
    const title = `${el.type} — ${el.status} (${Math.round(el.confidence * 100)}% confidence)`;
    return `<g class="pt-el" role="img" aria-label="${esc(title)}" data-el-id="${esc(el.id)}" data-type="${esc(el.type)}" data-status="${esc(el.status)}" data-ambiguous="${ambiguous}" data-selected="${selected}" data-fixing="${fixing}"><title>${esc(title)}</title>${body}</g>`;
  }

  _primitiveSvg(p, type) {
    const cls = {
      wall: { polyline: 'pt-el-wall' },
      window: { line: 'pt-el-window pt-status-target', tick: 'pt-el-window-tick' },
      door: { leaf: 'pt-el-door-leaf pt-status-target', arc: 'pt-el-door-arc pt-status-target' },
      stair: { outline: 'pt-el-stair-outline pt-status-target', tread: 'pt-el-stair-tread' },
      fixture: { shape: 'pt-el-fixture pt-status-target' },
      dimension: { main: 'pt-el-dimension-line pt-status-target', ext: 'pt-el-dimension-ext', text: 'pt-el-dimension-text' },
      text: { text: 'pt-el-text pt-status-target' },
      room: { outline: 'pt-el-room-outline', text: 'pt-el-room-label pt-status-target' },
    };
    if (p.kind === 'polyline') {
      const pts = p.points.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
      const tag = p.closed ? 'polygon' : 'polyline';
      let className = type === 'wall' ? cls.wall.polyline : type === 'stair' ? cls.stair.outline : type === 'fixture' ? cls.fixture.shape : type === 'room' ? cls.room.outline : 'pt-el-room-outline';
      return `<${tag} class="${className}" points="${pts}"/>`;
    }
    if (p.kind === 'circle') return `<circle class="${cls.fixture.shape}" cx="${p.cx}" cy="${p.cy}" r="${p.r}"/>`;
    if (p.kind === 'arc') return `<path class="${cls.door.arc}" d="${p.svgPath}"/>`;
    if (p.kind === 'text') {
      const className = type === 'dimension' ? cls.dimension.text : type === 'room' ? cls.room.text : cls.text.text;
      return `<text class="${className}" x="${p.x}" y="${p.y + (p.dy || 0)}" font-size="${p.size || 12}" text-anchor="${p.anchor || 'start'}" font-weight="${p.weight || 600}" ${p.rotation ? `transform="rotate(${p.rotation} ${p.x} ${p.y})"` : ''}>${esc(p.content)}</text>`;
    }
    // line
    if (type === 'window') return `<line class="${p.tick ? cls.window.tick : cls.window.line}" x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"/>`;
    if (type === 'door') return `<line class="${cls.door.leaf}" x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"/>`;
    if (type === 'stair') return `<line class="${cls.stair.tread}" x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"/>`;
    if (type === 'dimension') return `<line class="${p.extension ? cls.dimension.ext : cls.dimension.main}" x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"/>`;
    return `<line class="pt-el-window-tick" x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"/>`;
  }

  _selectionSvg(sheet, zoom) {
    const ids = this._store.selectedIds ? this._store.selectedIds() : [...this._store.selection];
    if (!ids.length) return '';
    const boxes = ids.map((id) => sheet.geometry.find((e) => e.id === id)).filter(Boolean).map(bboxOfElement);
    const box = bboxUnion(boxes);
    let boxHtml = '';
    if (box && ids.length > 1) boxHtml = `<rect class="pt-selection-box" x="${box.minX - 6}" y="${box.minY - 6}" width="${box.maxX - box.minX + 12}" height="${box.maxY - box.minY + 12}"/>`;
    let handlesHtml = '';
    if (this._store.toolMode === 'select') {
      const r = HANDLE_SCREEN_PX / zoom;
      for (const id of ids) {
        const el = sheet.geometry.find((e) => e.id === id);
        if (!el) continue;
        for (const h of elementEndpoints(el)) {
          handlesHtml += `<circle class="pt-handle" data-el-id="${esc(el.id)}" data-handle-key="${esc(h.key)}" cx="${h.x}" cy="${h.y}" r="${r}"/>`;
        }
      }
    }
    return boxHtml + handlesHtml;
  }

  _draftSvg() {
    if (!this._draft || !this._draft.points?.length) return '';
    const pts = this._draft.points;
    const last = pts[pts.length - 1];
    const cursor = this._draft.cursor || last;
    const all = [...pts, cursor];
    const line = all.map((p) => `${p.x},${p.y}`).join(' ');
    return `<polyline class="pt-draft-line" points="${line}"/>`;
  }

  // ── Coordinates ──────────────────────────────────────────────────────────
  _toWorld(clientX, clientY) {
    const rect = this.getBoundingClientRect();
    const sheet = this._store.getActiveSheet();
    const vp = sheet.viewport;
    return { x: (clientX - rect.left - vp.x) / vp.zoom, y: (clientY - rect.top - vp.y) / vp.zoom };
  }

  _isOnRasterSideOfSplit(clientX) {
    if (this._store.viewMode !== 'split') return false;
    const rect = this.getBoundingClientRect();
    return clientX - rect.left < (rect.width * this._splitPct) / 100;
  }

  // ── Zoom / fit (called by toolbar + internally) ─────────────────────────
  _zoomBy(factor) {
    const sheet = this._store.getActiveSheet();
    if (!sheet) return;
    const rect = this.getBoundingClientRect();
    this._zoomAt(rect.width / 2 + rect.left, rect.height / 2 + rect.top, sheet.viewport.zoom * factor);
  }

  _zoomAt(clientX, clientY, nextZoom) {
    const sheet = this._store.getActiveSheet();
    const rect = this.getBoundingClientRect();
    const zoom = Math.max(0.05, Math.min(8, nextZoom));
    const vp = sheet.viewport;
    const px = clientX - rect.left, py = clientY - rect.top;
    const worldX = (px - vp.x) / vp.zoom, worldY = (py - vp.y) / vp.zoom;
    this._store.setViewport(sheet.id, { zoom, x: px - worldX * zoom, y: py - worldY * zoom });
  }

  /** Center + gently zoom in on a world-space bbox — used by the review queue's "click to center" and Fix. */
  _focusBox(box) {
    const sheet = this._store?.getActiveSheet();
    if (!sheet || !box) return;
    const rect = this.getBoundingClientRect();
    const pad = 120;
    const w = Math.max(1, box.maxX - box.minX + pad * 2);
    const h = Math.max(1, box.maxY - box.minY + pad * 2);
    const targetZoom = Math.max(0.3, Math.min(2.5, Math.min(rect.width / w, rect.height / h)));
    const zoom = Math.max(targetZoom, Math.min(sheet.viewport.zoom, targetZoom * 1.6));
    this._store.setViewport(sheet.id, {
      zoom,
      x: rect.width / 2 - ((box.minX + box.maxX) / 2) * zoom,
      y: rect.height / 2 - ((box.minY + box.maxY) / 2) * zoom,
    });
  }

  fitToView() {
    const sheet = this._store?.getActiveSheet();
    if (!sheet) return;
    const rect = this.getBoundingClientRect();
    const selected = this._store.selectedIds();
    let box;
    if (selected.length) box = bboxUnion(sheet.geometry.filter((e) => selected.includes(e.id)).map(bboxOfElement));
    if (!box) box = sheet.geometry.length ? bboxUnion(sheet.geometry.map(bboxOfElement)) : { minX: 0, minY: 0, maxX: sheet.naturalWidth, maxY: sheet.naturalHeight };
    const pad = 40;
    const w = Math.max(1, box.maxX - box.minX + pad * 2);
    const h = Math.max(1, box.maxY - box.minY + pad * 2);
    const zoom = Math.max(0.05, Math.min(4, Math.min(rect.width / w, rect.height / h)));
    this._store.setViewport(sheet.id, {
      zoom,
      x: rect.width / 2 - ((box.minX + box.maxX) / 2) * zoom,
      y: rect.height / 2 - ((box.minY + box.maxY) / 2) * zoom,
    });
  }

  // ── Wheel: plain = pan, ctrl/cmd = zoom-at-cursor ───────────────────────
  _bindWheel() {
    this.addEventListener('wheel', (e) => {
      const sheet = this._store?.getActiveSheet();
      if (!sheet) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        this._zoomAt(e.clientX, e.clientY, sheet.viewport.zoom * (1 - e.deltaY * 0.012));
      } else {
        this._store.setViewport(sheet.id, { x: sheet.viewport.x - e.deltaX, y: sheet.viewport.y - e.deltaY });
      }
    }, { passive: false, signal: this.abort.signal });
  }

  // ── Split divider drag ───────────────────────────────────────────────────
  _bindSplitDrag() {
    this._divider.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._divider.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const rect = this.getBoundingClientRect();
        this._splitPct = Math.max(5, Math.min(95, ((ev.clientX - rect.left) / rect.width) * 100));
        this.render();
      };
      const up = () => { this._divider.removeEventListener('pointermove', move); this._divider.removeEventListener('pointerup', up); };
      this._divider.addEventListener('pointermove', move, { signal: this.abort.signal });
      this._divider.addEventListener('pointerup', up, { signal: this.abort.signal, once: true });
    }, { signal: this.abort.signal });
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  _bindKeyboard() {
    const toolKeys = { '1': 'select', '2': 'pan', '3': 'wall', '4': 'door', '5': 'window', '6': 'dimension', '7': 'erase' };
    this.addEventListener('keydown', (e) => {
      if (!this._store) return;
      const sheet = this._store.getActiveSheet();
      if (!sheet) return;
      if (toolKeys[e.key]) { this._store.setToolMode(toolKeys[e.key]); return; }
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) { this.fitToView(); return; }
      if (e.key === 'Escape') { this._draft = null; this._store.clearSelection(); this.render(); return; }
      const selected = this._store.selectedIds();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) { e.preventDefault(); this._store.deleteElements(sheet.id, selected); return; }
      if (e.key.startsWith('Arrow') && selected.length) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * (this._gridPx(sheet) / 8);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this._store.moveElements(sheet.id, selected, dx, dy);
      }
    }, { signal: this.abort.signal });
  }

  // ── Pointer interaction ──────────────────────────────────────────────────
  _bindPointer() {
    this.addEventListener('pointerdown', (e) => {
      if (!this._store) return;
      const sheet = this._store.getActiveSheet();
      if (!sheet || e.button === 2) return;
      this.focus();
      const tool = this._store.toolMode;
      const world = this._toWorld(e.clientX, e.clientY);

      if (e.button === 1 || tool === 'pan') return this._beginPan(e, sheet);
      if (this._isOnRasterSideOfSplit(e.clientX)) return this._beginPan(e, sheet); // reference side: pan only

      if (tool === 'select') return this._handleSelectPointerDown(e, sheet, world);
      if (tool === 'erase') return this._handleErase(sheet, world);
      if (tool === 'wall') return this._handleWallClick(e, sheet, world);
      if (tool === 'dimension') return this._handleDimensionClick(e, sheet, world);
      if (tool === 'door') return this._handleInsert(sheet, world, 'door', DEFAULT_DOOR_PX);
      if (tool === 'window') return this._handleInsert(sheet, world, 'window', DEFAULT_WINDOW_PX);
      if (tool === 'calibrate') return this._handleCalibrateClick(sheet, world);
    }, { signal: this.abort.signal });

    this.addEventListener('pointermove', (e) => {
      if (!this._store?.getActiveSheet()) return;
      const world = this._toWorld(e.clientX, e.clientY);
      this._store.setCursor(world);
      if (this._draft) { this._draft.cursor = this._snapForDraft(this._store, world, this._draft.points.at(-1)); this._scheduleRender(); }
    }, { signal: this.abort.signal });
  }

  _snapForDraft(store, world, origin) {
    const sheet = store.getActiveSheet();
    const settings = store.document.settings;
    const candidates = [];
    for (const el of sheet.geometry) for (const h of elementEndpoints(el)) candidates.push(h);
    const { point } = computeSnap(world, { gridPx: this._gridPx(sheet), snapEnabled: settings.snapping, orthoEnabled: settings.ortho, origin, candidates, zoom: sheet.viewport.zoom });
    return point;
  }

  _beginPan(e, sheet) {
    e.preventDefault();
    this.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const startVp = { ...sheet.viewport };
    const move = (ev) => this._store.setViewport(sheet.id, { x: startVp.x + (ev.clientX - start.x), y: startVp.y + (ev.clientY - start.y) });
    const up = () => { this.removeEventListener('pointermove', move); this.removeEventListener('pointerup', up); };
    this.addEventListener('pointermove', move, { signal: this.abort.signal });
    this.addEventListener('pointerup', up, { signal: this.abort.signal, once: true });
  }

  _findHandleAt(sheet, world) {
    if (this._store.toolMode !== 'select') return null;
    const zoom = sheet.viewport.zoom || 1;
    const tol = (HANDLE_SCREEN_PX + 4) / zoom;
    for (const id of this._store.selectedIds()) {
      const el = sheet.geometry.find((e) => e.id === id);
      if (!el) continue;
      for (const h of elementEndpoints(el)) if (dist(world, h) <= tol) return { el, key: h.key };
    }
    return null;
  }

  _findElementAt(sheet, world) {
    const zoom = sheet.viewport.zoom || 1;
    const tol = HIT_TOLERANCE_SCREEN / zoom;
    const layerVis = new Map(sheet.layers.map((l) => [l.id, l.visible]));
    for (let i = sheet.geometry.length - 1; i >= 0; i--) {
      const el = sheet.geometry[i];
      if (layerVis.get(el.layerId) === false) continue;
      if (hitTestElement(el, world, tol)) return el;
    }
    return null;
  }

  _handleSelectPointerDown(e, sheet, world) {
    const handle = this._findHandleAt(sheet, world);
    if (handle) return this._beginHandleDrag(e, sheet, handle);
    const el = this._findElementAt(sheet, world);
    if (el) return this._beginElementDrag(e, sheet, el);
    this._beginBoxSelect(e, sheet);
  }

  _beginHandleDrag(e, sheet, handle) {
    e.preventDefault();
    this.setPointerCapture(e.pointerId);
    this._store.select([handle.el.id]);
    const otherEndpoint = elementEndpoints(handle.el).find((h) => h.key !== handle.key);
    this._store.beginBatch('Adjust geometry');
    const move = (ev) => {
      const world = this._toWorld(ev.clientX, ev.clientY);
      const settings = this._store.document.settings;
      const candidates = [];
      for (const other of sheet.geometry) if (other.id !== handle.el.id) for (const h of elementEndpoints(other)) candidates.push(h);
      const { point } = computeSnap(world, { gridPx: this._gridPx(sheet), snapEnabled: settings.snapping, orthoEnabled: settings.ortho, origin: otherEndpoint, candidates, zoom: sheet.viewport.zoom });
      this._store.setEndpoint(sheet.id, handle.el.id, handle.key, point.x, point.y);
    };
    const up = () => { this._store.endBatch(); this.removeEventListener('pointermove', move); this.removeEventListener('pointerup', up); };
    this.addEventListener('pointermove', move, { signal: this.abort.signal });
    this.addEventListener('pointerup', up, { signal: this.abort.signal, once: true });
  }

  _beginElementDrag(e, sheet, el) {
    e.preventDefault();
    this.setPointerCapture(e.pointerId);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!this._store.selection.has(el.id)) this._store.select([el.id], { additive });
    const ids = this._store.selectedIds();
    let last = this._toWorld(e.clientX, e.clientY);
    let moved = false;
    this._store.beginBatch('Move');
    const move = (ev) => {
      const world = this._toWorld(ev.clientX, ev.clientY);
      const settings = this._store.document.settings;
      let dx = world.x - last.x, dy = world.y - last.y;
      if (settings.snapping) {
        const gridPx = this._gridPx(sheet);
        const snapped = { x: Math.round((last.x + dx) / gridPx) * gridPx, y: Math.round((last.y + dy) / gridPx) * gridPx };
        dx = snapped.x - last.x; dy = snapped.y - last.y;
      }
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) { moved = true; this._store.moveElements(sheet.id, ids, dx, dy); last = { x: last.x + dx, y: last.y + dy }; }
    };
    const up = () => {
      this._store.endBatch();
      if (!moved && !additive) this._store.select([el.id]);
      this.removeEventListener('pointermove', move); this.removeEventListener('pointerup', up);
    };
    this.addEventListener('pointermove', move, { signal: this.abort.signal });
    this.addEventListener('pointerup', up, { signal: this.abort.signal, once: true });
  }

  _beginBoxSelect(e, sheet) {
    e.preventDefault();
    this.setPointerCapture(e.pointerId);
    const additive = e.shiftKey;
    const startClient = { x: e.clientX, y: e.clientY };
    const startWorld = this._toWorld(e.clientX, e.clientY);
    if (!additive) this._store.clearSelection();
    this._rubberband.hidden = false;
    const rect0 = this.getBoundingClientRect();
    const move = (ev) => {
      const x = Math.min(startClient.x, ev.clientX) - rect0.left, y = Math.min(startClient.y, ev.clientY) - rect0.top;
      const w = Math.abs(ev.clientX - startClient.x), h = Math.abs(ev.clientY - startClient.y);
      Object.assign(this._rubberband.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const worldNow = this._toWorld(ev.clientX, ev.clientY);
      const box = { minX: Math.min(startWorld.x, worldNow.x), minY: Math.min(startWorld.y, worldNow.y), maxX: Math.max(startWorld.x, worldNow.x), maxY: Math.max(startWorld.y, worldNow.y) };
      const ids = sheet.geometry.filter((el) => { const b = bboxOfElement(el); return b.minX < box.maxX && b.maxX > box.minX && b.minY < box.maxY && b.maxY > box.minY; }).map((el) => el.id);
      this._store.select(ids, { additive });
    };
    const up = () => { this._rubberband.hidden = true; this.removeEventListener('pointermove', move); this.removeEventListener('pointerup', up); };
    this.addEventListener('pointermove', move, { signal: this.abort.signal });
    this.addEventListener('pointerup', up, { signal: this.abort.signal, once: true });
  }

  _handleErase(sheet, world) {
    const el = this._findElementAt(sheet, world);
    if (el) this._store.deleteElements(sheet.id, [el.id]);
  }

  _handleWallClick(e, sheet, world) {
    if (this._draft && e.detail === 2) { this._draft = null; this.render(); return; } // double-click ends the chain
    const origin = this._draft?.points.at(-1) || null;
    const settings = this._store.document.settings;
    const candidates = [];
    for (const el of sheet.geometry) for (const h of elementEndpoints(el)) candidates.push(h);
    const { point } = computeSnap(world, { gridPx: this._gridPx(sheet), snapEnabled: settings.snapping, orthoEnabled: settings.ortho, origin, candidates, zoom: sheet.viewport.zoom });
    if (!this._draft) { this._draft = { type: 'wall', points: [point] }; this.render(); return; }
    const start = this._draft.points.at(-1);
    if (dist(start, point) > 0.5) this._store.addElement(sheet.id, 'wall', { x1: start.x, y1: start.y, x2: point.x, y2: point.y, thickness: 6 }, { provider: { id: 'manual', label: 'Manual entry' }, status: 'verified' });
    this._draft.points.push(point);
  }

  _handleDimensionClick(e, sheet, world) {
    const settings = this._store.document.settings;
    const candidates = [];
    for (const el of sheet.geometry) for (const h of elementEndpoints(el)) candidates.push(h);
    const origin = this._draft?.points.at(-1) || null;
    const { point } = computeSnap(world, { gridPx: this._gridPx(sheet), snapEnabled: settings.snapping, orthoEnabled: settings.ortho, origin, candidates, zoom: sheet.viewport.zoom });
    if (!this._draft) { this._draft = { type: 'dimension', points: [point] }; this.render(); return; }
    const start = this._draft.points[0];
    this._store.addElement(sheet.id, 'dimension', { x1: start.x, y1: start.y, x2: point.x, y2: point.y, offset: 24, label: null }, { provider: { id: 'manual', label: 'Manual entry' }, status: 'verified' });
    this._draft = null;
  }

  _handleInsert(sheet, world, type, sizePx) {
    const nearest = this._nearestWall(sheet, world);
    let geometry;
    if (nearest) {
      const { wall, point } = nearest;
      const angle = angleOf({ x: wall.geometry.x1, y: wall.geometry.y1 }, { x: wall.geometry.x2, y: wall.geometry.y2 });
      const half = Math.min(sizePx, dist({ x: wall.geometry.x1, y: wall.geometry.y1 }, { x: wall.geometry.x2, y: wall.geometry.y2 }) * 0.4) / 2;
      geometry = { x1: point.x - Math.cos(angle) * half, y1: point.y - Math.sin(angle) * half, x2: point.x + Math.cos(angle) * half, y2: point.y + Math.sin(angle) * half };
    } else {
      geometry = { x1: world.x - sizePx / 2, y1: world.y, x2: world.x + sizePx / 2, y2: world.y };
    }
    if (type === 'door') geometry = { ...geometry, swing: 'right', hinge: 'start' };
    this._store.addElement(sheet.id, type, geometry, { provider: { id: 'manual', label: 'Manual entry' }, status: 'verified' });
  }

  _handleCalibrateClick(sheet, world) {
    if (!this._calibDraft) { this._calibDraft = { points: [world] }; this.render(); return; }
    const pointA = this._calibDraft.points[0];
    this._calibDraft = null;
    this._store.setToolMode('select');
    bus.publish('calibration.pointsReady', { sheetId: sheet.id, pointA, pointB: world });
  }

  _nearestWall(sheet, world) {
    let best = null, bestDist = 60 / (sheet.viewport.zoom || 1);
    for (const el of sheet.geometry) {
      if (el.type !== 'wall') continue;
      const cp = closestPointOnSegment(world, { x: el.geometry.x1, y: el.geometry.y1 }, { x: el.geometry.x2, y: el.geometry.y2 });
      const d = dist(world, cp);
      if (d < bestDist) { bestDist = d; best = { wall: el, point: cp }; }
    }
    return best;
  }
}

customElements.define('pt-plan-workspace', PtPlanWorkspace);
