// <pt-project-header> — the top bar: wordmark, editable project title,
// workflow nav, undo/redo, save-state indicator, the primary "Export DXF"
// action (plus a small menu for the other export/import actions), and
// settings/help.
import { PtElement, esc, bus, confirmDialog, openDialog, toast } from '../core.js';
import { iconMarkup } from '../icons/icons.js';
import { downloadDXF } from '../plan/dxf-export.js';
import './pt-workflow-nav.js';

const SAVE_LABELS = { idle: 'No changes yet', saving: 'Saving…', saved: 'Saved', error: 'Save failed' };

export class PtProjectHeader extends PtElement {
  connect() {
    this.innerHTML = `
      <div class="pt-wordmark">${iconMarkup('wall', { size: 20 })}PlanTrace</div>
      <div class="pt-topbar-sep"></div>
      <input class="pt-project-title" data-title aria-label="Project name" spellcheck="false">
      <pt-workflow-nav></pt-workflow-nav>
      <div class="pt-topbar-actions">
        <button type="button" class="pt-btn pt-btn-icon pt-btn-ghost" data-undo aria-label="Undo" title="Undo (Ctrl+Z)">${iconMarkup('undo')}</button>
        <button type="button" class="pt-btn pt-btn-icon pt-btn-ghost" data-redo aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${iconMarkup('redo')}</button>
        <span class="pt-save-indicator" data-save-indicator data-state="idle"><span class="pt-dot"></span><span data-save-label>No changes yet</span></span>
        <div class="pt-export-split">
          <button type="button" class="pt-btn pt-btn-primary" data-export-dxf>${iconMarkup('download', { size: 16 })}Export DXF</button>
          <button type="button" class="pt-btn pt-btn-primary" data-export-menu aria-label="More export options" aria-haspopup="menu">${iconMarkup('chevronDown', { size: 14 })}</button>
        </div>
        <button type="button" class="pt-btn pt-btn-icon pt-btn-ghost" data-settings aria-label="Settings" title="Settings">${iconMarkup('settings')}</button>
        <button type="button" class="pt-btn pt-btn-icon pt-btn-ghost" data-help aria-label="Help" title="Help &amp; keyboard shortcuts">${iconMarkup('help')}</button>
      </div>
    `;
    this._titleEl = this.querySelector('[data-title]');

    this.addEventListener('click', (e) => {
      if (e.target.closest('[data-undo]')) this._store?.undo();
      else if (e.target.closest('[data-redo]')) this._store?.redo();
      else if (e.target.closest('[data-export-dxf]')) this._exportDxf();
      else if (e.target.closest('[data-export-menu]')) this._openExportMenu();
      else if (e.target.closest('[data-settings]')) this._openSettings();
      else if (e.target.closest('[data-help]')) this._openHelp();
    }, { signal: this.abort.signal });

    this._titleEl.addEventListener('change', () => this._store?.renameProject(this._titleEl.value), { signal: this.abort.signal });
    this._titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._titleEl.blur(); }, { signal: this.abort.signal });
  }

  set store(store) {
    this._store = store;
    this._onChange = () => this._syncButtons();
    this._onSave = (e) => this._syncSaveIndicator(e.detail.state);
    store.addEventListener('change', this._onChange, { signal: this.abort.signal });
    store.addEventListener('savestate', this._onSave, { signal: this.abort.signal });
    this.querySelector('pt-workflow-nav').store = store;
    this._syncButtons();
  }

  _syncButtons() {
    if (!this._store) return;
    this.querySelector('[data-undo]').disabled = !this._store.canUndo();
    this.querySelector('[data-redo]').disabled = !this._store.canRedo();
    if (document.activeElement !== this._titleEl) this._titleEl.value = this._store.document.project.name;
    document.title = `${this._store.document.project.name} — PlanTrace`;
  }

  _syncSaveIndicator(state) {
    const el = this.querySelector('[data-save-indicator]');
    el.dataset.state = state;
    el.querySelector('[data-save-label]').textContent = SAVE_LABELS[state] || state;
  }

  _activeSheetOrWarn() {
    const sheet = this._store?.getActiveSheet();
    if (!sheet) toast('Import or add a sheet before exporting.', 'error');
    return sheet;
  }

  _exportDxf() {
    const sheet = this._activeSheetOrWarn();
    if (!sheet) return;
    downloadDXF(sheet);
    toast(`Exported ${sheet.name}.dxf`, 'success');
  }

  async _exportJson() {
    const { downloadProjectJSON } = await import('../plan/json-export.js');
    downloadProjectJSON(this._store.exportDocument());
    toast('Exported project.json', 'success');
  }

  async _exportSvg() {
    const sheet = this._activeSheetOrWarn();
    if (!sheet) return;
    const { downloadSVG } = await import('../plan/svg-export.js');
    downloadSVG(sheet);
    toast(`Exported ${sheet.name}.svg`, 'success');
  }

  _openExportMenu() {
    const existing = this.querySelector('.pt-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.className = 'pt-menu';
    menu.setAttribute('role', 'menu');
    menu.style.cssText = 'position:absolute; top:52px; right:118px; background:var(--pt-panel-bg-raised); border:1px solid var(--pt-panel-border); border-radius:9px; box-shadow:var(--pt-shadow); padding:6px; min-width:200px; z-index:50; display:flex; flex-direction:column; gap:2px;';
    const item = (label, iconName) => `<button type="button" role="menuitem" class="pt-btn pt-btn-ghost pt-btn-block" style="justify-content:flex-start" data-action="${label}">${iconMarkup(iconName, { size: 15 })}${esc(label)}</button>`;
    menu.innerHTML = item('Export SVG', 'download') + item('Export project JSON', 'file') + item('Import project JSON', 'upload') + item('Open Export panel', 'target');
    menu.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      menu.remove();
      if (action === 'Export SVG') this._exportSvg();
      else if (action === 'Export project JSON') this._exportJson();
      else if (action === 'Import project JSON') bus.publish('project.import.request', {});
      else if (action === 'Open Export panel') { this._store.setWorkflowStep('export'); bus.publish('export.open', {}); }
    });
    this.appendChild(menu);
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close); } };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
  }

  _openSettings() {
    const doc = this._store.document;
    const dialog = document.createElement('dialog');
    dialog.className = 'pt-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <h3>Settings</h3>
        <div class="pt-field">
          <label for="pt-set-grid">Default grid size</label>
          <select id="pt-set-grid" name="grid">
            <option value="1">1 in</option>
            <option value="3">3 in</option>
            <option value="6">6 in</option>
            <option value="12">1 ft</option>
            <option value="24">2 ft</option>
          </select>
        </div>
        <label class="pt-checkbox-row"><input type="checkbox" name="ortho"> Orthographic constraint on by default</label>
        <label class="pt-checkbox-row"><input type="checkbox" name="snap"> Snapping on by default</label>
        <div class="pt-callout pt-callout-info">${iconMarkup('info', { size: 15 })}<span>PlanTrace stores your projects locally in this browser (IndexedDB). Use Export → project JSON for a portable backup before clearing browser data.</span></div>
        <div class="pt-dialog-actions">
          <button type="button" class="pt-btn pt-btn-danger" data-clear-data>Clear all local projects…</button>
          <button type="submit" value="save" class="pt-btn pt-btn-primary" autofocus>Done</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[name="grid"]').value = String(doc.settings.gridSize);
    dialog.querySelector('[name="ortho"]').checked = doc.settings.ortho;
    dialog.querySelector('[name="snap"]').checked = doc.settings.snapping;
    dialog.querySelector('form').addEventListener('submit', () => {
      this._store.setGridSize(Number(dialog.querySelector('[name="grid"]').value));
      this._store.setOrtho(dialog.querySelector('[name="ortho"]').checked);
      this._store.setSnapping(dialog.querySelector('[name="snap"]').checked);
    });
    dialog.querySelector('[data-clear-data]').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Clear all local projects?', message: 'This permanently deletes every PlanTrace project and imported source image stored in this browser. This cannot be undone.', confirmLabel: 'Delete everything' });
      if (ok) bus.publish('data.clearAll.request', {});
      dialog.close();
    });
    openDialog(dialog, { onClose: () => dialog.remove() });
  }

  _openHelp() {
    const dialog = document.createElement('dialog');
    dialog.className = 'pt-dialog pt-wide';
    dialog.innerHTML = `
      <div class="pt-dialog-body">
        <h3>PlanTrace</h3>
        <p>Convert a scanned floor plan into reviewable CAD geometry in four steps: <strong>Prepare</strong> the sheet, run <strong>Trace</strong> to propose geometry, walk the <strong>Review</strong> queue, then <strong>Export</strong> DXF/SVG/JSON.</p>
        <div class="pt-props-grid" style="grid-template-columns:1fr 1fr;">
          <div><h4>Tools</h4><p>1 Select · 2 Pan · 3 Wall · 4 Door · 5 Window · 6 Dimension · 7 Erase</p></div>
          <div><h4>Editing</h4><p><kbd>Delete</kbd> remove selection · Arrow keys nudge · <kbd>Esc</kbd> cancel/deselect · <kbd>F</kbd> fit view</p></div>
          <div><h4>History</h4><p><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo</p></div>
          <div><h4>Review queue</h4><p><kbd>J</kbd>/<kbd>K</kbd> or <kbd>↑</kbd>/<kbd>↓</kbd> next/previous issue · <kbd>A</kbd> accept · <kbd>R</kbd> reject</p></div>
        </div>
        <p class="pt-callout pt-callout-warn">${iconMarkup('warning', { size: 15 })}<span>Reconstructed drawings are a starting point, not construction documents — always verify against field measurements.</span></p>
        <div class="pt-dialog-actions"><button type="button" class="pt-btn pt-btn-primary" data-close autofocus>Close</button></div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    openDialog(dialog, { onClose: () => dialog.remove() });
  }
}
customElements.define('pt-project-header', PtProjectHeader);
