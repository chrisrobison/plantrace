// <pt-properties-panel> — the element property editor for whatever is
// currently selected on the active sheet. Every field commits straight to
// PlanDocumentStore; this component never mutates geometry itself.
import { PtElement, esc, titleCase } from '../core.js';
import { formatLength } from '../plan/units.js';

const TYPE_FIELDS = {
  wall: [{ key: 'thickness', label: 'Thickness (px)', type: 'number', min: 1 }],
  door: [
    { key: 'swing', label: 'Swing', type: 'select', options: ['left', 'right'] },
    { key: 'hinge', label: 'Hinge at', type: 'select', options: ['start', 'end'] },
  ],
  window: [],
  stair: [
    { key: 'steps', label: 'Step count', type: 'number', min: 2, max: 40 },
    { key: 'direction', label: 'Direction', type: 'select', options: ['up', 'down'] },
  ],
  fixture: [
    { key: 'kind', label: 'Fixture type', type: 'select', options: ['generic', 'toilet', 'sink', 'tub', 'counter'] },
    { key: 'shape', label: 'Shape', type: 'select', options: ['rect', 'circle'] },
  ],
  dimension: [{ key: 'offset', label: 'Offset (px)', type: 'number' }, { key: 'label', label: 'Label override', type: 'text' }],
  text: [{ key: 'content', label: 'Text', type: 'text' }, { key: 'size', label: 'Size (px)', type: 'number', min: 6 }],
  room: [{ key: 'label', label: 'Room label', type: 'text' }],
};

export class PtPropertiesPanel extends PtElement {
  connect() {
    this.addEventListener('change', (e) => this._onFieldChange(e), { signal: this.abort.signal });
    this.addEventListener('click', (e) => {
      const status = e.target.closest('[data-set-status]')?.dataset.setStatus;
      if (status) this._applyStatus(status);
      const layerId = e.target.closest('[data-delete]');
      if (layerId) this._deleteSelection();
    }, { signal: this.abort.signal });
  }

  set store(store) {
    this._store = store;
    this._onChange = () => this.render();
    store.addEventListener('change', this._onChange, { signal: this.abort.signal });
    store.addEventListener('selection', this._onChange, { signal: this.abort.signal });
    this.render();
  }

  _selectedElements() {
    const sheet = this._store?.getActiveSheet();
    if (!sheet) return [];
    const ids = this._store.selection;
    return sheet.geometry.filter((e) => ids.has(e.id));
  }

  render() {
    if (!this.abort || !this._store) return;
    const els = this._selectedElements();
    if (!els.length) { this.innerHTML = `<div class="pt-props-empty">Select an element on the canvas to edit its properties.</div>`; return; }
    if (els.length > 1) { this.innerHTML = this._multiSelectHtml(els); return; }
    const el = els[0];
    const sheet = this._store.getActiveSheet();
    const fields = TYPE_FIELDS[el.type] || [];
    this.innerHTML = `
      <div class="pt-props-section">
        <h4>${esc(titleCase(el.type))}</h4>
        <div class="pt-props-row"><span>Status</span><span class="pt-review-status-pill" data-status="${esc(el.status)}">${esc(el.status)}</span></div>
        <div class="pt-props-row"><span>Confidence</span><span>${Math.round(el.confidence * 100)}%</span></div>
        <div class="pt-props-row"><span>Source</span><span>${esc(el.provider.label)}</span></div>
        <div class="pt-props-row"><span>Layer</span><span>${esc(sheet.layers.find((l) => l.id === el.layerId)?.name || el.layerId)}</span></div>
        ${this._geometrySummary(el, sheet)}
      </div>
      ${fields.length ? `<div class="pt-props-section"><h4>Properties</h4>${fields.map((f) => this._fieldHtml(f, el)).join('')}</div>` : ''}
      ${el.findings.length ? `<div class="pt-props-section"><h4>Findings</h4>${el.findings.map((f) => `<div class="pt-props-row" style="align-items:flex-start"><span>${esc(f.severity)}</span><span style="flex:1; text-align:right; color:var(--pt-panel-ink-dim)">${esc(f.message)}</span></div>`).join('')}</div>` : ''}
      <div class="pt-props-section">
        <h4>Review</h4>
        <div class="pt-status-buttons">
          <button type="button" class="pt-btn pt-btn-sm" data-set-status="verified">Accept</button>
          <button type="button" class="pt-btn pt-btn-sm" data-set-status="rejected">Reject</button>
        </div>
        <button type="button" class="pt-btn pt-btn-sm pt-btn-danger pt-btn-block" data-delete>Delete element</button>
      </div>
    `;
  }

  _geometrySummary(el, sheet) {
    const g = el.geometry;
    if (['wall', 'door', 'window', 'dimension'].includes(el.type)) {
      return `<div class="pt-props-row"><span>Length</span><span>${formatLength(Math.hypot(g.x2 - g.x1, g.y2 - g.y1), sheet.calibration)}</span></div>`;
    }
    return '';
  }

  _fieldHtml(field, el) {
    const value = el.geometry[field.key];
    if (field.type === 'select') {
      return `<label class="pt-field">${esc(field.label)}<select data-field="${field.key}">${field.options.map((o) => `<option value="${o}" ${o === value ? 'selected' : ''}>${esc(titleCase(o))}</option>`).join('')}</select></label>`;
    }
    return `<label class="pt-field">${esc(field.label)}<input data-field="${field.key}" type="${field.type}" value="${esc(value ?? '')}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''}></label>`;
  }

  _multiSelectHtml(els) {
    return `<div class="pt-props-section">
      <h4>${els.length} elements selected</h4>
      <div class="pt-status-buttons">
        <button type="button" class="pt-btn pt-btn-sm" data-set-status="verified">Accept all</button>
        <button type="button" class="pt-btn pt-btn-sm" data-set-status="rejected">Reject all</button>
      </div>
      <button type="button" class="pt-btn pt-btn-sm pt-btn-danger pt-btn-block" data-delete>Delete ${els.length} elements</button>
    </div>`;
  }

  _onFieldChange(e) {
    const key = e.target.dataset.field;
    if (!key) return;
    const el = this._selectedElements()[0];
    if (!el) return;
    const sheet = this._store.getActiveSheet();
    let value = e.target.value;
    if (e.target.type === 'number') value = Number(value);
    this._store.updateElementGeometry(sheet.id, el.id, { [key]: value });
  }

  _applyStatus(status) {
    const sheet = this._store.getActiveSheet();
    const ids = this._selectedElements().map((e) => e.id);
    if (ids.length) this._store.setElementsStatus(sheet.id, ids, status);
  }

  _deleteSelection() {
    const sheet = this._store.getActiveSheet();
    const ids = this._selectedElements().map((e) => e.id);
    if (ids.length) this._store.deleteElements(sheet.id, ids);
  }
}
customElements.define('pt-properties-panel', PtPropertiesPanel);
