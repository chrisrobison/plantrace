// <pt-workflow-nav> — Prepare / Trace / Review / Export step navigation.
// "Done" state is derived from the document itself (has sheets, has traced
// geometry, review queue is empty) rather than tracked separately, so it can
// never drift out of sync with what's actually true.
import { PtElement, esc, bus } from '../core.js';
import { iconMarkup } from '../icons/icons.js';
import { computeReviewStats } from '../plan/review.js';

const STEPS = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'trace', label: 'Trace' },
  { id: 'review', label: 'Review' },
  { id: 'export', label: 'Export' },
];

export class PtWorkflowNav extends PtElement {
  connect() {
    this.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-step]');
      if (!btn) return;
      const step = btn.dataset.step;
      // Export isn't a persistent workspace view the way the other three
      // steps are — it's a one-shot action (open the export options), so it
      // deliberately does not change store.workflowStep / the active-step
      // highlight.
      if (step === 'export') bus.publish('export.open', {});
      else this._store?.setWorkflowStep(step);
    }, { signal: this.abort.signal });
    this.render();
  }

  set store(store) {
    this._store?.removeEventListener('change', this._onChange);
    this._store?.removeEventListener('workflowstep', this._onChange);
    this._store = store;
    this._onChange = () => this.render();
    store.addEventListener('change', this._onChange, { signal: this.abort?.signal });
    store.addEventListener('workflowstep', this._onChange, { signal: this.abort?.signal });
    this.render();
  }

  _stepStatus(id) {
    const doc = this._store?.document;
    const sheet = this._store?.getActiveSheet();
    let done = false;
    if (id === 'prepare') done = !!(doc && doc.sheets.length);
    else if (id === 'trace') done = !!(sheet && sheet.geometry.length);
    else if (id === 'review') {
      if (sheet && sheet.geometry.length) done = computeReviewStats(sheet.geometry).needsReview === 0;
    }
    if (this._store?.workflowStep === id) return 'active';
    return done ? 'done' : 'pending';
  }

  render() {
    if (!this.abort) return;
    this.innerHTML = STEPS.map((step, i) => {
      const status = this._stepStatus(step.id);
      const dotContent = status === 'done' ? iconMarkup('check', { size: 12 }) : '';
      const connector = i < STEPS.length - 1 ? '<span class="pt-workflow-connector" aria-hidden="true"></span>' : '';
      return `<button type="button" class="pt-workflow-step" data-step="${step.id}" data-status="${status}" aria-current="${status === 'active' ? 'step' : 'false'}">
        <span class="pt-step-dot">${dotContent}</span>${esc(step.label)}
      </button>${connector}`;
    }).join('');
  }
}
customElements.define('pt-workflow-nav', PtWorkflowNav);
