// <pt-prepare-panel> — the Prepare step: rotate/crop/adjust the active
// sheet's source image, set calibration + drawing units, and kick off the
// (demo) trace provider. Preparation transforms are nondestructive: the
// original uploaded file never changes; rotation/crop are baked into a
// derived asset (see raster-prep.js) and brightness/contrast/grayscale are
// applied live via CSS filters that can be changed any time.
import { PtElement, esc, bus, toast, confirmDialog } from '../core.js';
import { iconMarkup } from '../icons/icons.js';
import { projectRepository } from '../plan/indexeddb-project-repository.js';
import { bakePreparedRaster, cssFilterFor } from '../plan/raster-prep.js';
import { UNIT_LABELS, isCalibrated } from '../plan/units.js';
import { demoTraceProvider } from '../plan/demo-trace-provider.js';

const ADJUSTMENTS = [
  { key: 'brightness', label: 'Brightness', min: 40, max: 160, icon: 'sun' },
  { key: 'contrast', label: 'Contrast', min: 40, max: 160, icon: 'contrast' },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 100, icon: 'droplet' },
  { key: 'opacity', label: 'Source opacity', min: 0, max: 100, icon: 'image' },
];

export class PtPreparePanel extends PtElement {
  connect() {
    this.innerHTML = `
      <div class="pt-prepare-layout">
        <div class="pt-prepare-canvas" data-canvas>
          <div class="pt-prepare-empty" data-empty hidden>
            <h2>No sheet selected</h2>
            <p>Import a scan or add a blank sheet to begin preparing it for tracing.</p>
            <button type="button" class="pt-btn pt-btn-primary" data-import>${iconMarkup('upload', { size: 16 })}Import a sheet</button>
          </div>
          <div data-image-wrap style="position:relative; display:inline-block; line-height:0;">
            <img data-preview-img alt="" style="max-width:70vw; max-height:75vh;">
            <div data-crop-overlay style="position:absolute; inset:0; cursor:crosshair;" hidden>
              <div data-crop-rect style="position:absolute; border:2px dashed var(--pt-accent); background:rgba(52,195,214,.15); display:none;"></div>
            </div>
          </div>
          <p data-no-image class="pt-callout pt-callout-info" hidden>${iconMarkup('info', { size: 15 })}<span>This sheet has no source image (a vector-only sheet). Rotate/crop/brightness apply to imported scans only.</span></p>
        </div>
        <div class="pt-prepare-sidebar" data-sidebar>
          <div><h3>Rotate</h3>
            <div class="pt-rotate-row">
              <button type="button" class="pt-btn" data-rotate="-90">${iconMarkup('rotate', { size: 15 })} -90°</button>
              <button type="button" class="pt-btn" data-rotate="90" style="transform:scaleX(-1)">${iconMarkup('rotate', { size: 15 })}<span style="display:inline-block;transform:scaleX(-1)">+90°</span></button>
            </div>
          </div>
          <div><h3>Crop</h3>
            <button type="button" class="pt-btn pt-btn-block" data-crop-toggle>${iconMarkup('crop', { size: 15 })}Crop visible area…</button>
            <div data-crop-actions hidden style="display:flex; gap:6px; margin-top:8px;">
              <button type="button" class="pt-btn pt-btn-primary" style="flex:1" data-crop-apply>Apply</button>
              <button type="button" class="pt-btn" style="flex:1" data-crop-cancel>Cancel</button>
            </div>
            <button type="button" class="pt-btn pt-btn-sm pt-btn-secondary pt-btn-block" style="margin-top:6px" data-crop-clear>Clear crop</button>
          </div>
          <div><h3>Adjust</h3>
            ${ADJUSTMENTS.map((a) => `<div class="pt-slider-row">${iconMarkup(a.icon, { size: 14 })}<span style="width:96px">${esc(a.label)}</span><input type="range" class="pt-slider" data-adjust="${a.key}" min="${a.min}" max="${a.max}"><span class="pt-slider-value" data-adjust-value="${a.key}"></span></div>`).join('')}
          </div>
          <div><h3>Calibration</h3>
            <div class="pt-calibration-summary" data-calibration-summary></div>
            <button type="button" class="pt-btn pt-btn-block" data-calibrate style="margin-top:8px">${iconMarkup('ruler', { size: 15 })}Set known dimension…</button>
          </div>
          <div><h3>Drawing units</h3>
            <select class="pt-field" data-unit style="width:100%; background:var(--pt-panel-bg); border:1px solid var(--pt-panel-border); border-radius:6px; padding:7px; color:var(--pt-panel-ink);">
              ${Object.entries(UNIT_LABELS).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}
            </select>
          </div>
          <div><h3>Trace</h3>
            <button type="button" class="pt-btn pt-btn-primary pt-btn-block" data-run-trace>${iconMarkup('target', { size: 15 })}Run Demo Trace Provider</button>
            <p style="font-size:12px; color:var(--pt-panel-ink-dim); margin-top:6px;">Proposes walls, doors, windows, fixtures, and dimensions for review. Re-running replaces this sheet's existing geometry.</p>
          </div>
        </div>
      </div>
    `;
    this._img = this.querySelector('[data-preview-img]');
    this._cropOverlay = this.querySelector('[data-crop-overlay]');
    this._cropRect = this.querySelector('[data-crop-rect]');
    this._cropping = false;
    this._objectUrl = null;

    this.addEventListener('click', (e) => {
      if (e.target.closest('[data-import]')) bus.publish('sheets.import.request', {});
      else if (e.target.closest('[data-rotate]')) this._rotate(Number(e.target.closest('[data-rotate]').dataset.rotate));
      else if (e.target.closest('[data-crop-toggle]')) this._toggleCrop();
      else if (e.target.closest('[data-crop-apply]')) this._applyCrop();
      else if (e.target.closest('[data-crop-cancel]')) this._cancelCrop();
      else if (e.target.closest('[data-crop-clear]')) this._clearCrop();
      else if (e.target.closest('[data-calibrate]')) { const s = this._store.getActiveSheet(); if (s) bus.publish('calibration.request', { sheetId: s.id }); }
      else if (e.target.closest('[data-run-trace]')) this._runTrace();
    }, { signal: this.abort.signal });

    this.addEventListener('change', (e) => {
      if (e.target.matches('[data-unit]')) { const s = this._store.getActiveSheet(); if (s) this._store.setDrawingUnit(s.id, e.target.value); }
    }, { signal: this.abort.signal });

    let batchOpen = false;
    this.addEventListener('pointerdown', (e) => { if (e.target.matches('[data-adjust]') && !batchOpen) { this._store.beginBatch('Adjust image'); batchOpen = true; } }, { signal: this.abort.signal });
    this.addEventListener('input', (e) => {
      if (!e.target.matches('[data-adjust]')) return;
      const sheet = this._store.getActiveSheet();
      if (!sheet) return;
      this._store.updateSheetPrep(sheet.id, { [e.target.dataset.adjust]: Number(e.target.value) });
      this.querySelector(`[data-adjust-value="${e.target.dataset.adjust}"]`).textContent = e.target.dataset.adjust === 'brightness' || e.target.dataset.adjust === 'contrast' ? `${e.target.value}%` : `${e.target.value}%`;
    }, { signal: this.abort.signal });
    window.addEventListener('pointerup', () => { if (batchOpen) { this._store.endBatch(); batchOpen = false; } }, { signal: this.abort.signal });

    this._bindCropDrag();
  }

  set store(store) {
    this._store = store;
    this._onChange = () => this.render();
    store.addEventListener('change', this._onChange, { signal: this.abort.signal });
    this.render();
  }

  disconnect() { if (this._objectUrl) URL.revokeObjectURL(this._objectUrl); }

  async render() {
    if (!this.abort || !this._store) return;
    const sheet = this._store.getActiveSheet();
    this.querySelector('[data-empty]').hidden = !!sheet;
    this.querySelector('[data-sidebar]').style.visibility = sheet ? 'visible' : 'hidden';
    this.querySelector('[data-image-wrap]').style.visibility = sheet && sheet.assetId ? 'visible' : 'hidden';
    this.querySelector('[data-no-image]').hidden = !sheet || !!sheet.assetId;
    if (!sheet) return;

    ADJUSTMENTS.forEach((a) => {
      const input = this.querySelector(`[data-adjust="${a.key}"]`);
      if (document.activeElement !== input) input.value = String(sheet.prep[a.key]);
      this.querySelector(`[data-adjust-value="${a.key}"]`).textContent = `${sheet.prep[a.key]}%`;
    });
    this.querySelector('[data-unit]').value = sheet.calibration.unit;
    this.querySelector('[data-calibration-summary]').textContent = isCalibrated(sheet.calibration)
      ? `Calibrated: ${(sheet.calibration.pixelsPerUnit).toFixed(2)} px/in`
      : 'Not calibrated yet — dimensions will display in pixels until you set a known length.';

    const assetId = sheet.preparedAssetId || sheet.assetId;
    if (assetId && assetId !== this._lastAssetId) {
      this._lastAssetId = assetId;
      const asset = await projectRepository.loadAsset(assetId);
      if (asset && this._lastAssetId === assetId) {
        if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
        this._objectUrl = URL.createObjectURL(asset.blob);
        this._img.src = this._objectUrl;
      }
    }
    this._img.style.filter = cssFilterFor(sheet.prep);
    this._img.style.opacity = String(sheet.prep.opacity / 100);
  }

  async _rotate(delta) {
    const sheet = this._store.getActiveSheet();
    if (!sheet?.assetId) return toast('This sheet has no source image to rotate.', 'error');
    const original = await projectRepository.loadAsset(sheet.assetId);
    if (!original) return toast('Original image could not be loaded.', 'error');
    const nextRotation = ((sheet.prep.rotation + delta) % 360 + 360) % 360;
    try {
      const { blob, width, height } = await bakePreparedRaster(original.blob, { rotation: nextRotation, crop: null });
      const oldPrepared = sheet.preparedAssetId;
      const newId = await projectRepository.saveAsset(blob, { filename: `${sheet.name}-prepared.png`, mimeType: 'image/png', width, height });
      this._store.updateSheetPrep(sheet.id, { rotation: nextRotation, crop: null }, { naturalWidth: width, naturalHeight: height, preparedAssetId: newId });
      if (oldPrepared) projectRepository.removeAsset(oldPrepared).catch(() => {});
      if (sheet.geometry.length) toast('Rotated. Existing traced geometry may no longer align — consider re-running Trace.', 'info');
    } catch {
      toast('Could not rotate this image.', 'error');
    }
  }

  _toggleCrop() {
    this._cropping = !this._cropping;
    this._cropOverlay.hidden = !this._cropping;
    this.querySelector('[data-crop-actions]').hidden = !this._cropping;
    this._cropRect.style.display = 'none';
    this._pendingCropRect = null;
  }
  _cancelCrop() { this._cropping = false; this._cropOverlay.hidden = true; this.querySelector('[data-crop-actions]').hidden = true; }

  _bindCropDrag() {
    this._cropOverlay.addEventListener('pointerdown', (e) => {
      const rect = this._cropOverlay.getBoundingClientRect();
      const start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this._cropRect.style.display = 'block';
      this._cropOverlay.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const cur = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
        const x = Math.max(0, Math.min(start.x, cur.x)), y = Math.max(0, Math.min(start.y, cur.y));
        const w = Math.min(rect.width, Math.abs(cur.x - start.x)), h = Math.min(rect.height, Math.abs(cur.y - start.y));
        Object.assign(this._cropRect.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        this._pendingCropRect = { x, y, w, h, containerW: rect.width, containerH: rect.height };
      };
      const up = () => { this._cropOverlay.removeEventListener('pointermove', move); this._cropOverlay.removeEventListener('pointerup', up); };
      this._cropOverlay.addEventListener('pointermove', move, { signal: this.abort.signal });
      this._cropOverlay.addEventListener('pointerup', up, { signal: this.abort.signal, once: true });
    }, { signal: this.abort.signal });
  }

  async _applyCrop() {
    const sheet = this._store.getActiveSheet();
    const r = this._pendingCropRect;
    if (!sheet?.assetId || !r || r.w < 4 || r.h < 4) return this._cancelCrop();
    const scaleX = sheet.naturalWidth / r.containerW;
    const scaleY = sheet.naturalHeight / r.containerH;
    const prevCrop = sheet.prep.crop;
    const newRectInCurrentSpace = { x: r.x * scaleX, y: r.y * scaleY, w: r.w * scaleX, h: r.h * scaleY };
    const composedCrop = { x: (prevCrop?.x || 0) + newRectInCurrentSpace.x, y: (prevCrop?.y || 0) + newRectInCurrentSpace.y, w: newRectInCurrentSpace.w, h: newRectInCurrentSpace.h };
    const original = await projectRepository.loadAsset(sheet.assetId);
    if (!original) return toast('Original image could not be loaded.', 'error');
    try {
      const { blob, width, height } = await bakePreparedRaster(original.blob, { rotation: sheet.prep.rotation, crop: composedCrop });
      const oldPrepared = sheet.preparedAssetId;
      const newId = await projectRepository.saveAsset(blob, { filename: `${sheet.name}-prepared.png`, mimeType: 'image/png', width, height });
      this._store.updateSheetPrep(sheet.id, { crop: composedCrop }, { naturalWidth: width, naturalHeight: height, preparedAssetId: newId });
      if (oldPrepared) projectRepository.removeAsset(oldPrepared).catch(() => {});
      toast('Crop applied.', 'success');
    } catch {
      toast('Could not crop this image.', 'error');
    }
    this._cancelCrop();
  }

  async _clearCrop() {
    const sheet = this._store.getActiveSheet();
    if (!sheet?.assetId || !sheet.prep.crop) return;
    const original = await projectRepository.loadAsset(sheet.assetId);
    if (!original) return;
    const { blob, width, height } = await bakePreparedRaster(original.blob, { rotation: sheet.prep.rotation, crop: null });
    const oldPrepared = sheet.preparedAssetId;
    const newId = await projectRepository.saveAsset(blob, { filename: `${sheet.name}-prepared.png`, mimeType: 'image/png', width, height });
    this._store.updateSheetPrep(sheet.id, { crop: null }, { naturalWidth: width, naturalHeight: height, preparedAssetId: newId });
    if (oldPrepared) projectRepository.removeAsset(oldPrepared).catch(() => {});
  }

  async _runTrace() {
    const sheet = this._store.getActiveSheet();
    if (!sheet) return;
    if (sheet.geometry.length) {
      const ok = await confirmDialog({ title: 'Replace existing geometry?', message: `This sheet already has ${sheet.geometry.length} traced elements. Running the trace provider again replaces all of them with a fresh proposal.`, confirmLabel: 'Run trace', danger: false });
      if (!ok) return;
    }
    const count = await this._store.runTraceProvider(sheet.id, demoTraceProvider, {});
    toast(`Traced ${count} elements. Review them in the Review tab.`, 'success');
    this._store.setWorkflowStep('trace');
  }
}
customElements.define('pt-prepare-panel', PtPreparePanel);
