// <pt-import-dialog> — import JPG/PNG/WebP/PDF source sheets. Each dropped
// file is validated, routed through the source-adapter boundary (raster
// formats decode immediately; PDF explains why it can't yet — see
// source-adapters.js), and turned into a new sheet right away, so the
// dialog can stay open while more files are added.
import { PtElement, esc, bus, openDialog, toast } from '../core.js';
import { iconMarkup } from '../icons/icons.js';
import { validateFile, getSourceAdapter, ACCEPT_ATTR } from '../plan/source-adapters.js';
import { projectRepository } from '../plan/indexeddb-project-repository.js';
import { readProjectJSONFile } from '../plan/json-export.js';

export class PtImportDialog extends PtElement {
  connect() {
    bus.subscribe('sheets.import.request', () => this.open(), this.abort.signal);
    bus.subscribe('project.import.request', () => this.open({ jsonOnly: true }), this.abort.signal);
  }

  set store(store) { this._store = store; }

  open({ jsonOnly = false } = {}) {
    const dialog = document.createElement('dialog');
    dialog.className = 'pt-dialog pt-wide';
    dialog.innerHTML = `
      <div class="pt-dialog-body">
        <h3>${jsonOnly ? 'Import project JSON' : 'Import sheets'}</h3>
        ${jsonOnly ? '<p>Choose a PlanTrace project JSON file exported from this or another browser. This replaces the current project.</p>' : '<p>Drop JPG, PNG, WebP, or PDF files here, or choose files. Each becomes a new sheet.</p>'}
        <div class="pt-dropzone" data-dropzone tabindex="0" role="button" aria-label="Drop files or activate to choose files">
          ${iconMarkup('upload', { size: 26 })}
          <strong>Drop files here</strong>
          <span>or</span>
          <button type="button" class="pt-btn pt-btn-primary" data-choose>Choose files</button>
          <input type="file" data-file-input hidden ${jsonOnly ? 'accept=".json,application/json"' : `accept="${ACCEPT_ATTR}" multiple`}>
        </div>
        ${jsonOnly ? '' : '<button type="button" class="pt-btn pt-btn-secondary pt-btn-block" data-blank-sheet">Start a blank sheet (no source image)</button>'}
        <div class="pt-import-list" data-results></div>
        <div class="pt-dialog-actions"><button type="button" class="pt-btn pt-btn-primary" data-done>Done</button></div>
      </div>`;
    document.body.appendChild(dialog);
    const dropzone = dialog.querySelector('[data-dropzone]');
    const input = dialog.querySelector('[data-file-input]');
    const results = dialog.querySelector('[data-results]');

    dialog.querySelector('[data-choose]').addEventListener('click', () => input.click());
    dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    dialog.querySelector('[data-blank-sheet]')?.addEventListener('click', () => {
      const sheet = this._store.addSheet({ name: `Sheet ${this._store.document.sheets.length + 1}` });
      this._logResult(results, sheet.name, true, 'Blank sheet created.');
    });
    dialog.querySelector('[data-done]').addEventListener('click', () => dialog.close());

    ['dragenter', 'dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.dataset.active = 'true'; }));
    ['dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.dataset.active = 'false'; }));
    dropzone.addEventListener('drop', (e) => this._handleFiles([...(e.dataTransfer?.files || [])], results, jsonOnly));
    input.addEventListener('change', () => this._handleFiles([...input.files], results, jsonOnly));

    openDialog(dialog, { onClose: () => dialog.remove() });
  }

  _logResult(container, label, ok, message) {
    const row = document.createElement('div');
    row.className = `pt-import-row ${ok ? '' : 'pt-import-row-warn'}`;
    row.innerHTML = `${iconMarkup(ok ? 'check' : 'warning', { size: 14 })}<span><strong>${esc(label)}</strong> — ${esc(message)}</span>`;
    container.prepend(row);
    return row;
  }

  /** A placeholder row shown while a file uploads to the server (real network latency now, unlike the old IndexedDB-only path) — replaced in place once the upload settles. */
  _logPending(container, label, message) {
    const row = document.createElement('div');
    row.className = 'pt-import-row';
    row.innerHTML = `<span class="pt-spinner" style="width:14px;height:14px;flex:none;"></span><span><strong>${esc(label)}</strong> — ${esc(message)}</span>`;
    container.prepend(row);
    return row;
  }

  _finishRow(row, ok, label, message) {
    row.className = `pt-import-row ${ok ? '' : 'pt-import-row-warn'}`;
    row.innerHTML = `${iconMarkup(ok ? 'check' : 'warning', { size: 14 })}<span><strong>${esc(label)}</strong> — ${esc(message)}</span>`;
  }

  async _handleFiles(files, results, jsonOnly) {
    for (const file of files) {
      if (jsonOnly) { await this._importJson(file, results); continue; }
      await this._importSheet(file, results);
    }
  }

  async _importJson(file, results) {
    try {
      const raw = await readProjectJSONFile(file);
      const { warnings } = this._store.importDocument(raw);
      this._logResult(results, file.name, true, warnings.length ? `Imported with ${warnings.length} warning(s).` : 'Project imported.');
      warnings.forEach((w) => toast(w, 'info'));
    } catch (err) {
      this._logResult(results, file.name, false, err.message || 'Import failed.');
    }
  }

  async _importSheet(file, results) {
    const validation = validateFile(file);
    if (!validation.ok) { this._logResult(results, file.name, false, validation.message); return; }
    const adapter = getSourceAdapter(file.type);
    if (!adapter.supported) { this._logResult(results, file.name, false, adapter.message); return; }
    const row = this._logPending(results, file.name, 'Uploading…');
    try {
      const { blob, width, height } = await adapter.decode(file);
      const assetId = await projectRepository.saveAsset(blob, { filename: file.name, mimeType: file.type, width, height });
      const sheet = this._store.addSheet({ name: file.name.replace(/\.[^.]+$/, ''), originalFilename: file.name, assetId, naturalWidth: width, naturalHeight: height });
      this._finishRow(row, true, sheet.name, `Imported (${width}×${height}px).`);
      bus.publish('sheets.imported', { sheetId: sheet.id });
    } catch (err) {
      this._finishRow(row, false, file.name, err.message || 'Could not import this file.');
    }
  }
}
customElements.define('pt-import-dialog', PtImportDialog);
