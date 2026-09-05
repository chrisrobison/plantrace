// <pt-review-summary> — the compact verification-progress ring plus counts.
// Pure presentational component: receives `.stats` (see review.js's
// computeReviewStats) and renders it. No store access of its own.
const RADIUS = 40;
const CIRC = 2 * Math.PI * RADIUS;

export class PtReviewSummary extends HTMLElement {
  set stats(stats) { this._stats = stats; this.render(); }

  render() {
    const s = this._stats || { total: 0, verified: 0, rejected: 0, needsReview: 0, errors: 0, percent: 0 };
    const offset = CIRC - (CIRC * s.percent) / 100;
    this.innerHTML = `
      <div class="pt-review-ring">
        <svg viewBox="0 0 100 100" width="92" height="92">
          <circle class="pt-review-ring-track" cx="50" cy="50" r="${RADIUS}"></circle>
          <circle class="pt-review-ring-value" cx="50" cy="50" r="${RADIUS}" stroke-dasharray="${CIRC}" stroke-dashoffset="${offset}"></circle>
        </svg>
        <div class="pt-review-ring-label"><strong>${s.percent}%</strong><span>verified</span></div>
      </div>
      <div class="pt-review-counts">
        <span class="pt-count-total"><strong>${s.total}</strong></span><span>Total elements</span>
        <span class="pt-count-verified"><strong>${s.verified}</strong></span><span>Verified</span>
        <span class="pt-count-review"><strong>${s.needsReview}</strong></span><span>Needs review</span>
        <span class="pt-count-rejected"><strong>${s.rejected}</strong></span><span>Rejected</span>
        <span class="pt-count-errors"><strong>${s.errors}</strong></span><span>Errors</span>
      </div>
    `;
  }
}
customElements.define('pt-review-summary', PtReviewSummary);
