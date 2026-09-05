// <pt-workspace-toolbar> — the strip above the workspace: active-sheet
// picker, navigation tools (pan/select), zoom controls, and the
// Before/After/Overlay/Split view-mode switch.
import { PtElement, esc, bus } from '../core.js';
import { iconMarkup } from '../icons/icons.js';

const VIEW_MODES = [
  { id: 'split', label: 'Split View', icon: 'split' },
  { id: 'before', label: 'Before' },
  { id: 'after', label: 'After' },
  { id: 'overlay', label: 'Overlay' },
];

export class PtWorkspaceToolbar extends PtElement {
  connect() {
    this.innerHTML = `
      <select class="pt-sheet-select" data-sheet-select aria-label="Active sheet"></select>
      <div class="pt-toolgroup" role="group" aria-label="Navigation tool">
        <button type="button" class="pt-btn" data-tool="pan" aria-label="Pan tool" aria-pressed="false" title="Pan (2)">${iconMarkup('hand')}</button>
        <button type="button" class="pt-btn" data-tool="select" aria-label="Select tool" aria-pressed="true" title="Select (1)">${iconMarkup('cursor')}</button>
      </div>
      <div class="pt-toolgroup" role="group" aria-label="Zoom">
        <button type="button" class="pt-btn" data-zoom-out aria-label="Zoom out">${iconMarkup('zoomOut')}</button>
        <button type="button" class="pt-btn" data-zoom-in aria-label="Zoom in">${iconMarkup('zoomIn')}</button>
        <button type="button" class="pt-btn" data-fit aria-label="Fit to view" title="Fit (F)">${iconMarkup('fit')}</button>
      </div>
      <div class="pt-view-modes" role="group" aria-label="View mode">
        ${VIEW_MODES.map((m) => `<button type="button" class="pt-btn" data-view="${m.id}" aria-pressed="false">${m.icon ? iconMarkup(m.icon, { size: 15 }) : ''}${esc(m.label)}</button>`).join('')}
      </div>
    `;
    this.addEventListener('click', (e) => {
      const toolBtn = e.target.closest('[data-tool]');
      const viewBtn = e.target.closest('[data-view]');
      if (toolBtn) this._store.setToolMode(toolBtn.dataset.tool);
      else if (viewBtn) this._store.setViewMode(viewBtn.dataset.view);
      else if (e.target.closest('[data-zoom-in]')) bus.publish('workspace.zoom', { direction: 1 });
      else if (e.target.closest('[data-zoom-out]')) bus.publish('workspace.zoom', { direction: -1 });
      else if (e.target.closest('[data-fit]')) bus.publish('workspace.fit', {});
    }, { signal: this.abort.signal });
    this.addEventListener('change', (e) => {
      if (e.target.matches('[data-sheet-select]')) this._store.setActiveSheetId(e.target.value);
    }, { signal: this.abort.signal });
  }

  set store(store) {
    this._store = store;
    this._onChange = () => this.render();
    store.addEventListener('change', this._onChange, { signal: this.abort.signal });
    store.addEventListener('toolmode', this._onChange, { signal: this.abort.signal });
    store.addEventListener('viewmode', this._onChange, { signal: this.abort.signal });
    this.render();
  }

  render() {
    if (!this.abort || !this._store) return;
    const doc = this._store.document;
    const select = this.querySelector('[data-sheet-select]');
    select.innerHTML = doc.sheets.slice().sort((a, b) => a.order - b.order).map((s) => `<option value="${esc(s.id)}" ${s.id === doc.activeSheetId ? 'selected' : ''}>${esc(s.name)}</option>`).join('') || '<option>No sheets</option>';
    select.disabled = !doc.sheets.length;
    this.querySelectorAll('[data-tool]').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.tool === this._store.toolMode)));
    this.querySelectorAll('[data-view]').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.view === this._store.viewMode)));
  }
}
customElements.define('pt-workspace-toolbar', PtWorkspaceToolbar);
