// <pt-context-toolbar> — the floating drawing-tool palette over the
// workspace: Wall / Door / Window / Dimension / Erase. Selecting a tool here
// sets store.toolMode, which <pt-plan-workspace> reads to decide what a
// pointerdown on the canvas should do.
import { PtElement, esc } from '../core.js';
import { iconMarkup } from '../icons/icons.js';

const TOOLS = [
  { id: 'wall', label: 'Wall', icon: 'wall' },
  { id: 'door', label: 'Door', icon: 'door' },
  { id: 'window', label: 'Window', icon: 'window' },
  { id: 'dimension', label: 'Dimension', icon: 'dimension' },
  { id: 'erase', label: 'Erase', icon: 'erase' },
];

export class PtContextToolbar extends PtElement {
  connect() {
    this.innerHTML = TOOLS.map((t) => `<button type="button" class="pt-context-tool" data-tool="${t.id}" aria-pressed="false" title="${esc(t.label)}">${iconMarkup(t.icon, { size: 18 })}<span>${esc(t.label)}</span></button>`).join('');
    this.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (!btn || !this._store) return;
      this._store.setToolMode(this._store.toolMode === btn.dataset.tool ? 'select' : btn.dataset.tool);
    }, { signal: this.abort.signal });
  }

  set store(store) {
    this._store = store;
    this._onChange = () => this._sync();
    store.addEventListener('toolmode', this._onChange, { signal: this.abort.signal });
    this._sync();
  }

  _sync() {
    this.querySelectorAll('[data-tool]').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.tool === this._store.toolMode)));
  }
}
customElements.define('pt-context-toolbar', PtContextToolbar);
