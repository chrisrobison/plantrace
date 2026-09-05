// <pt-layer-panel> — per-sheet layer visibility/color, plus the source-image
// opacity slider shared with the Prepare step (same underlying
// sheet.prep.opacity value, so the two controls can never disagree).
import { PtElement, esc } from '../core.js';
import { iconMarkup } from '../icons/icons.js';

export class PtLayerPanel extends PtElement {
  connect() {
    this.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-toggle-layer]');
      if (btn) {
        const sheet = this._store.getActiveSheet();
        const layer = sheet.layers.find((l) => l.id === btn.dataset.toggleLayer);
        this._store.setLayerVisibility(sheet.id, layer.id, !layer.visible);
      }
    }, { signal: this.abort.signal });
    this.addEventListener('input', (e) => {
      const sheet = this._store.getActiveSheet();
      if (!sheet) return;
      if (e.target.matches('[data-layer-color]')) this._store.setLayerColor(sheet.id, e.target.dataset.layerColor, e.target.value);
      if (e.target.matches('[data-opacity]')) this._store.setSourceOpacity(sheet.id, Number(e.target.value));
    }, { signal: this.abort.signal });
  }

  set store(store) {
    this._store = store;
    this._onChange = () => this.render();
    store.addEventListener('change', this._onChange, { signal: this.abort?.signal });
    this.render();
  }

  render() {
    if (!this.abort) return;
    const sheet = this._store?.getActiveSheet();
    if (!sheet) { this.innerHTML = `<div class="pt-sidebar-empty">No sheet selected.</div>`; return; }
    const source = sheet.layers.find((l) => l.id === 'source');
    const rows = sheet.layers.filter((l) => l.id !== 'source').map((layer) => `
      <div class="pt-layer-row" data-hidden="${!layer.visible}">
        <button type="button" class="pt-layer-visible-btn" data-toggle-layer="${esc(layer.id)}" aria-pressed="${layer.visible}" aria-label="Toggle ${esc(layer.name)} visibility">${iconMarkup(layer.visible ? 'eye' : 'eyeOff', { size: 16 })}</button>
        <input type="color" data-layer-color="${esc(layer.id)}" value="${esc(layer.color)}" class="pt-layer-swatch" style="padding:0; border:none; background:none;" aria-label="${esc(layer.name)} color" title="${esc(layer.name)} color">
        <span class="pt-layer-name">${esc(layer.name)}</span>
      </div>`).join('');
    this.innerHTML = `
      <div class="pt-layer-row" data-hidden="${!source.visible}">
        <button type="button" class="pt-layer-visible-btn" data-toggle-layer="source" aria-pressed="${source.visible}" aria-label="Toggle scanned image visibility">${iconMarkup(source.visible ? 'eye' : 'eyeOff', { size: 16 })}</button>
        <span class="pt-layer-swatch" style="background:${esc(source.color)}"></span>
        <span class="pt-layer-name">Scanned Image</span>
      </div>
      <div class="pt-opacity-row">
        <input type="range" class="pt-slider" data-opacity min="0" max="100" step="1" value="${sheet.prep.opacity}" aria-label="Scanned image opacity">
        <span class="pt-opacity-value">${sheet.prep.opacity}%</span>
      </div>
      ${rows}
    `;
  }
}
customElements.define('pt-layer-panel', PtLayerPanel);
