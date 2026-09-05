// <pt-sheet-thumbnail> — a live preview of one sheet: its source raster when
// it has one, otherwise a lightweight vector sketch built straight from the
// sheet's own geometry (so it never goes stale the way a cached bitmap
// thumbnail would).
import { PtElement, esc } from '../core.js';
import { projectRepository } from '../plan/indexeddb-project-repository.js';

export class PtSheetThumbnail extends PtElement {
  connect() { this.render(); }
  disconnect() { if (this._objectUrl) URL.revokeObjectURL(this._objectUrl); }

  set sheet(sheet) { this._sheet = sheet; this.render(); }

  async render() {
    const sheet = this._sheet;
    if (!this.abort || !sheet) return;
    if (sheet.assetId) {
      this.innerHTML = `<div class="pt-sheet-thumb-frame"><span class="pt-sheet-empty">Loading…</span></div>`;
      try {
        const asset = await projectRepository.loadAsset(sheet.assetId);
        if (this._sheet !== sheet) return; // sheet changed while awaiting
        if (!asset) throw new Error('missing asset');
        if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
        this._objectUrl = URL.createObjectURL(asset.blob);
        this.innerHTML = `<div class="pt-sheet-thumb-frame"><img src="${esc(this._objectUrl)}" alt="" style="filter:brightness(${sheet.prep.brightness}%) contrast(${sheet.prep.contrast}%) grayscale(${sheet.prep.grayscale}%)"></div>`;
      } catch {
        this.innerHTML = `<div class="pt-sheet-thumb-frame"><span class="pt-sheet-empty">Image unavailable</span></div>`;
      }
      return;
    }
    if (!sheet.geometry.length) {
      this.innerHTML = `<div class="pt-sheet-thumb-frame"><span class="pt-sheet-empty">No source image<br>Empty sheet</span></div>`;
      return;
    }
    this.innerHTML = `<div class="pt-sheet-thumb-frame">${this._buildSketchSvg(sheet)}</div>`;
  }

  _buildSketchSvg(sheet) {
    const lines = [];
    for (const el of sheet.geometry) {
      const g = el.geometry;
      if (el.type === 'wall' || el.type === 'window') lines.push(`<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" />`);
      else if (el.type === 'stair' || el.type === 'fixture') lines.push(`<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" />`);
    }
    return `<svg viewBox="0 0 ${sheet.naturalWidth} ${sheet.naturalHeight}" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="${sheet.naturalWidth}" height="${sheet.naturalHeight}" fill="#f4efe3"/>
      <g fill="none" stroke="#5a6473" stroke-width="6">${lines.join('')}</g>
    </svg>`;
  }
}
customElements.define('pt-sheet-thumbnail', PtSheetThumbnail);
