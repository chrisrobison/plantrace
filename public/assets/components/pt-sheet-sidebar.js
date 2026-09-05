// <pt-sheet-sidebar> — the SHEETS list (add/select/rename/reorder/delete)
// plus the LAYERS section for the active sheet.
import { PtElement, esc, bus, confirmDialog } from '../core.js';
import { iconMarkup } from '../icons/icons.js';
import './pt-sheet-thumbnail.js';
import './pt-layer-panel.js';

export class PtSheetSidebar extends PtElement {
  connect() {
    this.innerHTML = `
      <div class="pt-panel-heading"><span>Sheets</span><button type="button" class="pt-btn pt-btn-icon pt-btn-ghost" data-add-sheet aria-label="Add sheet" title="Import a new sheet">${iconMarkup('plus')}</button></div>
      <div class="pt-sheet-list" data-sheet-list></div>
      <div class="pt-panel-heading" data-layers-toggle role="button" tabindex="0" aria-expanded="true"><span>Layers</span>${iconMarkup('chevronDown', { size: 14 })}</div>
      <pt-layer-panel class="pt-layer-panel-body"></pt-layer-panel>
    `;
    this._list = this.querySelector('[data-sheet-list]');
    this._layerPanel = this.querySelector('pt-layer-panel');
    this._layersToggle = this.querySelector('[data-layers-toggle]');

    this.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-sheet]')) bus.publish('sheets.import.request', {});
      const card = e.target.closest('.pt-sheet-card');
      if (card && !e.target.closest('input, button')) this._store.setActiveSheetId(card.dataset.sheetId);
      const menuBtn = e.target.closest('[data-sheet-menu]');
      if (menuBtn) { e.stopPropagation(); this._openSheetMenu(menuBtn); }
      if (e.target.closest('[data-layers-toggle]')) this._toggleLayers();
    }, { signal: this.abort.signal });

    this._layersToggle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleLayers(); } }, { signal: this.abort.signal });

    this.addEventListener('change', (e) => {
      if (e.target.matches('[data-sheet-name]')) {
        const card = e.target.closest('.pt-sheet-card');
        this._store.renameSheet(card.dataset.sheetId, e.target.value);
      }
    }, { signal: this.abort.signal });

    this._bindDragReorder();
  }

  set store(store) {
    this._store = store;
    this._onChange = () => this.render();
    store.addEventListener('change', this._onChange, { signal: this.abort.signal });
    this._layerPanel.store = store;
    this.render();
  }

  _toggleLayers() {
    const expanded = this._layersToggle.getAttribute('aria-expanded') === 'true';
    this._layersToggle.setAttribute('aria-expanded', String(!expanded));
    this._layerPanel.hidden = expanded;
    this._layersToggle.querySelector('.pt-icon').style.transform = expanded ? '' : 'rotate(180deg)';
  }

  render() {
    if (!this.abort || !this._store) return;
    const doc = this._store.document;
    if (!doc.sheets.length) {
      this._list.innerHTML = `<div class="pt-sidebar-empty">No sheets yet. Import a scan to get started.</div>`;
      return;
    }
    this._list.innerHTML = doc.sheets.slice().sort((a, b) => a.order - b.order).map((sheet) => `
      <div class="pt-sheet-card" draggable="true" data-sheet-id="${esc(sheet.id)}" data-active="${sheet.id === doc.activeSheetId}" role="button" tabindex="0" aria-current="${sheet.id === doc.activeSheetId}">
        <pt-sheet-thumbnail></pt-sheet-thumbnail>
        <div class="pt-sheet-card-foot">
          <span class="pt-drag-handle" aria-hidden="true">${iconMarkup('drag', { size: 14 })}</span>
          <input class="pt-sheet-name-input" data-sheet-name value="${esc(sheet.name)}" aria-label="Sheet name">
          <button type="button" class="pt-btn pt-btn-icon pt-btn-ghost pt-sheet-card-menu" data-sheet-menu aria-label="Sheet options" aria-haspopup="menu">${iconMarkup('kebab', { size: 14 })}</button>
        </div>
      </div>`).join('');
    this._list.querySelectorAll('pt-sheet-thumbnail').forEach((el, i) => {
      el.sheet = doc.sheets.slice().sort((a, b) => a.order - b.order)[i];
    });
  }

  _openSheetMenu(anchor) {
    document.querySelector('.pt-menu')?.remove();
    const sheetId = anchor.closest('.pt-sheet-card').dataset.sheetId;
    const menu = document.createElement('div');
    menu.className = 'pt-menu';
    menu.setAttribute('role', 'menu');
    const rect = anchor.getBoundingClientRect();
    menu.style.cssText = `position:fixed; top:${rect.bottom + 4}px; left:${Math.max(8, rect.right - 170)}px; background:var(--pt-panel-bg-raised); border:1px solid var(--pt-panel-border); border-radius:9px; box-shadow:var(--pt-shadow); padding:6px; min-width:160px; z-index:60; display:flex; flex-direction:column; gap:2px;`;
    menu.innerHTML = `
      <button type="button" role="menuitem" class="pt-btn pt-btn-ghost pt-btn-block" style="justify-content:flex-start" data-menu-action="rename">${iconMarkup('text', { size: 15 })}Rename</button>
      <button type="button" role="menuitem" class="pt-btn pt-btn-ghost pt-btn-block" style="justify-content:flex-start" data-menu-action="calibrate">${iconMarkup('ruler', { size: 15 })}Calibrate…</button>
      <button type="button" role="menuitem" class="pt-btn pt-btn-ghost pt-btn-block" style="justify-content:flex-start; color:var(--pt-red)" data-menu-action="delete">${iconMarkup('trash', { size: 15 })}Delete sheet</button>
    `;
    document.body.appendChild(menu);
    menu.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-menu-action]')?.dataset.menuAction;
      menu.remove();
      if (action === 'rename') this.querySelector(`[data-sheet-id="${sheetId}"] [data-sheet-name]`)?.focus();
      else if (action === 'calibrate') { this._store.setActiveSheetId(sheetId); bus.publish('calibration.request', { sheetId }); }
      else if (action === 'delete') {
        const sheet = this._store.getSheet(sheetId);
        const ok = await confirmDialog({ title: `Delete "${sheet.name}"?`, message: 'This removes the sheet, its traced geometry, and its source image from this project. This cannot be undone.' });
        if (ok) {
          const { projectRepository } = await import('../plan/indexeddb-project-repository.js');
          if (sheet.assetId) projectRepository.removeAsset(sheet.assetId).catch(() => {});
          this._store.removeSheet(sheetId);
        }
      }
    });
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', close); } };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
  }

  _bindDragReorder() {
    let draggedId = null;
    this.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.pt-sheet-card');
      if (!card) return;
      draggedId = card.dataset.sheetId;
      e.dataTransfer.effectAllowed = 'move';
    }, { signal: this.abort.signal });
    this.addEventListener('dragover', (e) => {
      const card = e.target.closest('.pt-sheet-card');
      if (!card || !draggedId) return;
      e.preventDefault();
      card.classList.add('pt-drag-over');
    }, { signal: this.abort.signal });
    this.addEventListener('dragleave', (e) => { e.target.closest('.pt-sheet-card')?.classList.remove('pt-drag-over'); }, { signal: this.abort.signal });
    this.addEventListener('drop', (e) => {
      const card = e.target.closest('.pt-sheet-card');
      this.querySelectorAll('.pt-drag-over').forEach((c) => c.classList.remove('pt-drag-over'));
      if (!card || !draggedId || card.dataset.sheetId === draggedId) return;
      e.preventDefault();
      const ids = [...this._list.querySelectorAll('.pt-sheet-card')].map((c) => c.dataset.sheetId);
      const from = ids.indexOf(draggedId);
      const to = ids.indexOf(card.dataset.sheetId);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      this._store.reorderSheets(ids);
      draggedId = null;
    }, { signal: this.abort.signal });
  }
}
customElements.define('pt-sheet-sidebar', PtSheetSidebar);
