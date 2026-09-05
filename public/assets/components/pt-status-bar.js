// <pt-status-bar> — scale/calibration, grid size, ortho/snap toggles, live
// cursor coordinates, zoom percentage, and selected-element count.
import { PtElement, bus } from '../core.js';
import { formatInches, isCalibrated } from '../plan/units.js';

const GRID_PRESETS_IN = [1, 3, 6, 12, 24, 48];

export class PtStatusBar extends PtElement {
  connect() {
    this.innerHTML = `
      <button type="button" class="pt-status-item" data-scale style="background:none;border:none;color:inherit;font:inherit;cursor:pointer" title="Click to calibrate this sheet"></button>
      <span class="pt-status-sep"></span>
      <label class="pt-status-item">Grid <select data-grid aria-label="Grid size" style="background:transparent;border:none;color:var(--pt-panel-ink);font:inherit"></select></label>
      <span class="pt-status-sep"></span>
      <button type="button" class="pt-status-item" data-ortho style="background:none;border:none;color:inherit;font:inherit;cursor:pointer"><span class="pt-status-dot" data-ortho-dot></span>Ortho</button>
      <button type="button" class="pt-status-item" data-snap style="background:none;border:none;color:inherit;font:inherit;cursor:pointer"><span class="pt-status-dot" data-snap-dot></span>Snapping</button>
      <span class="pt-status-spacer"></span>
      <span class="pt-status-item">X: <strong data-cursor-x>—</strong></span>
      <span class="pt-status-item">Y: <strong data-cursor-y>—</strong></span>
      <span class="pt-status-sep"></span>
      <span class="pt-status-item"><strong data-zoom>100%</strong></span>
      <span class="pt-status-sep"></span>
      <span class="pt-status-item"><strong data-selected-count>0</strong> selected</span>
    `;
    this._gridSelect = this.querySelector('[data-grid]');
    GRID_PRESETS_IN.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = formatInches(v, 'ft-in');
      this._gridSelect.appendChild(opt);
    });

    this.addEventListener('click', (e) => {
      if (e.target.closest('[data-ortho]')) this._store.setOrtho(!this._store.document.settings.ortho);
      else if (e.target.closest('[data-snap]')) this._store.setSnapping(!this._store.document.settings.snapping);
      else if (e.target.closest('[data-scale]')) {
        const sheet = this._store.getActiveSheet();
        if (sheet) bus.publish('calibration.request', { sheetId: sheet.id });
      }
    }, { signal: this.abort.signal });
    this.addEventListener('change', (e) => {
      if (e.target === this._gridSelect) this._store.setGridSize(Number(this._gridSelect.value));
    }, { signal: this.abort.signal });
  }

  set store(store) {
    this._store = store;
    this._onChange = () => this.render();
    this._onCursor = () => this._renderCursor();
    store.addEventListener('change', this._onChange, { signal: this.abort.signal });
    store.addEventListener('selection', this._onChange, { signal: this.abort.signal });
    store.addEventListener('cursor', this._onCursor, { signal: this.abort.signal });
    this.render();
  }

  render() {
    if (!this.abort || !this._store) return;
    const sheet = this._store.getActiveSheet();
    const doc = this._store.document;
    const scaleBtn = this.querySelector('[data-scale]');
    scaleBtn.textContent = sheet && isCalibrated(sheet.calibration) ? `Scale ${(1 / sheet.calibration.pixelsPerUnit).toFixed(3)}px⁻¹ · calibrated` : 'Not calibrated — click to set scale';
    this._gridSelect.value = String(doc.settings.gridSize);
    this.querySelector('[data-ortho-dot]').dataset.on = String(doc.settings.ortho);
    this.querySelector('[data-snap-dot]').dataset.on = String(doc.settings.snapping);
    this.querySelector('[data-zoom]').textContent = `${Math.round((sheet?.viewport.zoom || 1) * 100)}%`;
    this.querySelector('[data-selected-count]').textContent = String(this._store.selection.size);
    this._renderCursor();
  }

  _renderCursor() {
    if (!this._store) return;
    const sheet = this._store.getActiveSheet();
    const c = this._store.cursor;
    this.querySelector('[data-cursor-x]').textContent = c && sheet ? formatInches0(c.x, sheet) : '—';
    this.querySelector('[data-cursor-y]').textContent = c && sheet ? formatInches0(c.y, sheet) : '—';
  }
}

function formatInches0(px, sheet) {
  if (!isCalibrated(sheet.calibration)) return `${Math.round(px)}px`;
  return formatInches(px / sheet.calibration.pixelsPerUnit, sheet.calibration.unit);
}

customElements.define('pt-status-bar', PtStatusBar);
