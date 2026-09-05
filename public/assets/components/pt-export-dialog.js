// <pt-export-dialog> — the Export step: DXF/SVG per sheet, whole-project
// JSON export/import, and the discreet "not construction-ready" warning
// required by the brief.
import { PtElement, esc, bus, openDialog, toast } from '../core.js';
import { iconMarkup } from '../icons/icons.js';
import { downloadDXF } from '../plan/dxf-export.js';
import { downloadSVG } from '../plan/svg-export.js';
import { downloadProjectJSON } from '../plan/json-export.js';

export class PtExportDialog extends PtElement {
  connect() { bus.subscribe('export.open', () => this.open(), this.abort.signal); }
  set store(store) { this._store = store; }

  open() {
    const doc = this._store.document;
    const dialog = document.createElement('dialog');
    dialog.className = 'pt-dialog pt-wide';
    dialog.innerHTML = `
      <div class="pt-dialog-body">
        <h3>Export</h3>
        <p class="pt-callout pt-callout-warn">${iconMarkup('warning', { size: 15 })}<span>Reconstructed drawings are a starting point only — verify every dimension and connection against field measurements before using them for construction.</span></p>
        <div class="pt-props-section">
          <h4>Per-sheet CAD export</h4>
          <div class="pt-import-list" data-sheet-rows>
            ${doc.sheets.map((s) => `
              <div class="pt-import-row" style="justify-content:space-between">
                <span><strong>${esc(s.name)}</strong> — ${s.geometry.length} elements</span>
                <span style="display:flex; gap:6px;">
                  <button type="button" class="pt-btn pt-btn-sm pt-btn-primary" data-dxf="${esc(s.id)}">${iconMarkup('download', { size: 13 })}DXF</button>
                  <button type="button" class="pt-btn pt-btn-sm" data-svg="${esc(s.id)}">${iconMarkup('download', { size: 13 })}SVG</button>
                </span>
              </div>`).join('') || '<div class="pt-review-empty">No sheets yet.</div>'}
          </div>
        </div>
        <div class="pt-props-section">
          <h4>Whole project</h4>
          <div style="display:flex; gap:8px;">
            <button type="button" class="pt-btn pt-btn-block" data-export-json>${iconMarkup('file', { size: 15 })}Export project JSON</button>
            <button type="button" class="pt-btn pt-btn-block" data-import-json>${iconMarkup('upload', { size: 15 })}Import project JSON</button>
          </div>
          <p style="font-size:12px; color:var(--pt-panel-ink-dim)">JSON is a full, portable backup of every sheet, layer, and reviewed element — use it to move a project between browsers or as a safety copy.</p>
        </div>
        <div class="pt-dialog-actions"><button type="button" class="pt-btn pt-btn-primary" data-close autofocus>Close</button></div>
      </div>`;
    document.body.appendChild(dialog);

    dialog.addEventListener('click', (e) => {
      const dxfId = e.target.closest('[data-dxf]')?.dataset.dxf;
      const svgId = e.target.closest('[data-svg]')?.dataset.svg;
      if (dxfId) { downloadDXF(this._store.getSheet(dxfId)); toast('DXF exported.', 'success'); }
      else if (svgId) { downloadSVG(this._store.getSheet(svgId)); toast('SVG exported.', 'success'); }
      else if (e.target.closest('[data-export-json]')) { downloadProjectJSON(this._store.exportDocument()); toast('Project JSON exported.', 'success'); }
      else if (e.target.closest('[data-import-json]')) { dialog.close(); bus.publish('project.import.request', {}); }
      else if (e.target.closest('[data-close]')) dialog.close();
    });
    openDialog(dialog, { onClose: () => dialog.remove() });
  }
}
customElements.define('pt-export-dialog', PtExportDialog);
