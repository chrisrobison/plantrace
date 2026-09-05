// <pt-review-panel> — the right sidebar: review summary, Issues/Properties
// tabs, filter/sort controls, the accept-above-threshold action, and
// keyboard-driven next/previous issue navigation. This is the centerpiece
// panel per the brief — most of PlanTrace's review workflow lives here.
import { PtElement, esc, bus } from '../core.js';
import { iconMarkup } from '../icons/icons.js';
import { computeReviewStats, filterIssues, sortIssuesByConfidence } from '../plan/review.js';
import { bboxOfElement } from '../plan/geometry.js';
import './pt-review-summary.js';
import './pt-review-card.js';
import './pt-properties-panel.js';

const TYPE_OPTIONS = ['all', 'wall', 'door', 'window', 'stair', 'fixture', 'dimension', 'text', 'room'];

export class PtReviewPanel extends PtElement {
  connect() {
    this._tab = 'issues';
    this._filter = { type: 'all', status: 'proposed' };
    this._threshold = 0.8;
    this.innerHTML = `
      <div class="pt-review-header"><h2>Review Queue</h2><button type="button" class="pt-btn pt-btn-icon pt-btn-ghost" data-collapse aria-label="Collapse panel">${iconMarkup('close', { size: 14 })}</button></div>
      <pt-review-summary></pt-review-summary>
      <div class="pt-tabs" role="tablist">
        <button type="button" class="pt-tab" role="tab" data-tab="issues" aria-selected="true">Issues</button>
        <button type="button" class="pt-tab" role="tab" data-tab="properties" aria-selected="false">Properties</button>
      </div>
      <div data-tab-panel="issues">
        <div class="pt-review-toolbar">
          <select data-filter-type aria-label="Filter by type"></select>
          <select data-filter-status aria-label="Filter by status">
            <option value="proposed">Needs review</option>
            <option value="all">All statuses</option>
            <option value="verified">Verified</option>
            <option value="corrected">Corrected</option>
            <option value="rejected">Rejected</option>
          </select>
          <button type="button" class="pt-btn pt-btn-icon" data-sort aria-label="Sort lowest confidence first" aria-pressed="true" title="Sort lowest confidence first">${iconMarkup('filter', { size: 15 })}</button>
        </div>
        <div class="pt-review-threshold">
          <span>Accept all ≥</span>
          <input type="range" min="0" max="100" value="80" data-threshold aria-label="Confidence threshold">
          <span data-threshold-value>80%</span>
          <button type="button" class="pt-btn pt-btn-sm" data-accept-threshold>Apply</button>
        </div>
        <div class="pt-review-nav-hint"><kbd>J</kbd>/<kbd>K</kbd> next/prev · <kbd>A</kbd> accept · <kbd>R</kbd> reject</div>
        <div class="pt-review-list" data-list></div>
      </div>
      <pt-properties-panel data-tab-panel="properties" hidden></pt-properties-panel>
    `;
    TYPE_OPTIONS.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t === 'all' ? 'All types' : t[0].toUpperCase() + t.slice(1) + 's';
      this.querySelector('[data-filter-type]').appendChild(opt);
    });
    this._sortLowFirst = true;

    this.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) return this._setTab(tabBtn.dataset.tab);
      if (e.target.closest('[data-collapse]')) return this.dispatchEvent(new CustomEvent('panel-collapse', { bubbles: true }));
      if (e.target.closest('[data-sort]')) { this._sortLowFirst = !this._sortLowFirst; e.target.closest('[data-sort]').setAttribute('aria-pressed', String(this._sortLowFirst)); return this._renderList(); }
      if (e.target.closest('[data-accept-threshold]')) return this._acceptThreshold();
    }, { signal: this.abort.signal });

    this.addEventListener('change', (e) => {
      if (e.target.matches('[data-filter-type]')) { this._filter.type = e.target.value; this._renderList(); }
      if (e.target.matches('[data-filter-status]')) { this._filter.status = e.target.value; this._renderList(); }
    }, { signal: this.abort.signal });
    this.addEventListener('input', (e) => {
      if (e.target.matches('[data-threshold]')) { this._threshold = Number(e.target.value) / 100; this.querySelector('[data-threshold-value]').textContent = `${e.target.value}%`; }
    }, { signal: this.abort.signal });

    this.addEventListener('review-select', (e) => this._selectAndCenter(e.detail.elementId), { signal: this.abort.signal });
    this.addEventListener('review-accept', (e) => this._accept(e.detail.elementId), { signal: this.abort.signal });
    this.addEventListener('review-fix', (e) => this._fix(e.detail.elementId), { signal: this.abort.signal });
    this.addEventListener('review-reject', (e) => this._reject(e.detail.elementId), { signal: this.abort.signal });

    this.addEventListener('keydown', (e) => this._onKeydown(e), { signal: this.abort.signal });
  }

  set store(store) {
    this._store = store;
    this._onChange = () => this.render();
    store.addEventListener('change', this._onChange, { signal: this.abort.signal });
    store.addEventListener('selection', this._onChange, { signal: this.abort.signal });
    this.querySelector('pt-properties-panel').store = store;
    this.render();
  }

  _setTab(tab) {
    this._tab = tab;
    this.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    this.querySelector('[data-tab-panel="issues"]').hidden = tab !== 'issues';
    this.querySelector('[data-tab-panel="properties"]').hidden = tab !== 'properties';
  }

  render() {
    if (!this.abort || !this._store) return;
    const sheet = this._store.getActiveSheet();
    this.querySelector('pt-review-summary').stats = computeReviewStats(sheet ? sheet.geometry : []);
    this._renderList();
  }

  _currentIssues() {
    const sheet = this._store.getActiveSheet();
    if (!sheet) return [];
    let list = filterIssues(sheet.geometry, this._filter);
    if (this._sortLowFirst) list = sortIssuesByConfidence(list);
    return list;
  }

  _renderList() {
    if (this._tab !== 'issues' && this._tab !== undefined) { /* keep list fresh even if hidden */ }
    const list = this.querySelector('[data-list]');
    const sheet = this._store.getActiveSheet();
    if (!sheet) { list.innerHTML = `<div class="pt-review-empty">No sheet selected.</div>`; return; }
    const issues = this._currentIssues();
    this.querySelector('[data-tab="issues"]').textContent = `Issues (${issues.length})`;
    if (!issues.length) { list.innerHTML = `<div class="pt-review-empty">No matching elements. Try a different filter.</div>`; return; }
    const existingIds = new Set([...list.children].map((c) => c.dataset.cardFor));
    const wantedIds = new Set(issues.map((el) => el.id));
    [...list.children].forEach((c) => { if (!wantedIds.has(c.dataset.cardFor)) c.remove(); });
    issues.forEach((el, i) => {
      let card = list.querySelector(`[data-card-for="${CSS.escape(el.id)}"]`);
      if (!card) { card = document.createElement('pt-review-card'); card.dataset.cardFor = el.id; list.appendChild(card); }
      if (list.children[i] !== card) list.insertBefore(card, list.children[i] || null);
      card.data = { element: el, index: i, selected: this._store.selection.has(el.id), calibration: sheet.calibration };
    });
  }

  _selectAndCenter(elementId) {
    const sheet = this._store.getActiveSheet();
    const el = sheet.geometry.find((e) => e.id === elementId);
    if (!el) return;
    this._store.select([elementId]);
    bus.publish('workspace.focusElement', { elementId, box: bboxOfElement(el) });
  }

  _accept(elementId) { const sheet = this._store.getActiveSheet(); this._store.setElementStatus(sheet.id, elementId, 'verified'); }
  _reject(elementId) { const sheet = this._store.getActiveSheet(); this._store.setElementStatus(sheet.id, elementId, 'rejected'); }
  _fix(elementId) {
    const sheet = this._store.getActiveSheet();
    this._store.beginFix(sheet.id, elementId);
    this._selectAndCenter(elementId);
    this._setTab('properties');
  }

  _acceptThreshold() {
    const sheet = this._store.getActiveSheet();
    if (!sheet) return;
    const n = this._store.acceptAllAboveConfidence(sheet.id, this._threshold);
    bus.publish('toast.show', { message: n ? `Accepted ${n} element${n === 1 ? '' : 's'} at or above ${Math.round(this._threshold * 100)}% confidence.` : 'No proposed elements meet that threshold.', tone: n ? 'success' : 'info' });
  }

  _onKeydown(e) {
    if (this._tab !== 'issues') return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const issues = this._currentIssues();
    if (!issues.length) return;
    const currentId = [...this._store.selection][0];
    let idx = issues.findIndex((el) => el.id === currentId);
    if (e.key.toLowerCase() === 'j' || e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(issues.length - 1, idx + 1); this._selectAndCenter(issues[idx].id); }
    else if (e.key.toLowerCase() === 'k' || e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); this._selectAndCenter(issues[idx].id); }
    else if (e.key.toLowerCase() === 'a' && idx >= 0) { e.preventDefault(); this._accept(issues[idx].id); }
    else if (e.key.toLowerCase() === 'r' && idx >= 0) { e.preventDefault(); this._reject(issues[idx].id); }
  }
}
customElements.define('pt-review-panel', PtReviewPanel);
