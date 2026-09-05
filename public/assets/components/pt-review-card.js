// <pt-review-card> — one compact issue card in the review queue: confidence
// badge, localized geometry preview, description, and Accept/Fix/Reject.
// Purely presentational — dispatches bubbling CustomEvents and lets
// <pt-review-panel> talk to the store, so this component has no store
// dependency of its own and stays trivially reusable/testable.
import { PtElement, esc } from '../core.js';
import { iconMarkup } from '../icons/icons.js';
import { elementToPrimitives } from '../plan/primitives.js';
import { bboxOfElement } from '../plan/geometry.js';
import { issueTitle, issueDescription } from '../plan/review.js';

export class PtReviewCard extends PtElement {
  connect() {
    this.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      const elementId = this._data.element.id;
      if (action) { e.stopPropagation(); this.dispatchEvent(new CustomEvent(`review-${action}`, { bubbles: true, detail: { elementId } })); }
      else this.dispatchEvent(new CustomEvent('review-select', { bubbles: true, detail: { elementId } }));
    }, { signal: this.abort.signal });
    this.render();
  }

  set data(data) { this._data = data; this.render(); }

  render() {
    if (!this.abort || !this._data) return;
    const { element: el, index, selected, calibration } = this._data;
    const pct = Math.round(el.confidence * 100);
    const tier = pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low';
    this.setAttribute('data-selected', String(!!selected));
    this.className = 'pt-review-card';
    this.setAttribute('tabindex', '0');
    this.setAttribute('role', 'button');
    const isTerminal = el.status !== 'proposed';
    this.innerHTML = `
      <div class="pt-review-card-top">
        <span class="pt-review-card-title">${esc(issueTitle(el))}</span>
        <span class="pt-review-card-index">#${index + 1}</span>
      </div>
      <div class="pt-review-card-top">
        <span class="pt-confidence-badge" data-tier="${tier}">AI confidence: ${pct}%</span>
        ${isTerminal ? `<span class="pt-review-status-pill" data-status="${esc(el.status)}">${esc(el.status)}</span>` : ''}
      </div>
      <div class="pt-review-card-body">
        <p class="pt-review-card-desc">${esc(issueDescription(el))}</p>
        <div class="pt-review-preview" aria-hidden="true">${this._preview(el, calibration)}</div>
      </div>
      ${isTerminal ? '' : `<div class="pt-review-card-actions">
        <button type="button" class="pt-btn pt-btn-sm pt-btn-secondary" data-action="accept">${iconMarkup('check', { size: 13 })}Accept</button>
        <button type="button" class="pt-btn pt-btn-sm pt-btn-secondary" data-action="fix">${iconMarkup('wrench', { size: 13 })}Fix</button>
        <button type="button" class="pt-btn pt-btn-sm pt-btn-secondary" data-action="reject">${iconMarkup('close', { size: 13 })}Reject</button>
      </div>`}
    `;
  }

  _preview(el, calibration) {
    try {
      const box = bboxOfElement(el);
      const pad = Math.max(10, (box.maxX - box.minX) * 0.2, (box.maxY - box.minY) * 0.2);
      const vb = `${box.minX - pad} ${box.minY - pad} ${Math.max(1, box.maxX - box.minX + pad * 2)} ${Math.max(1, box.maxY - box.minY + pad * 2)}`;
      const prims = elementToPrimitives(el, calibration).map((p) => this._primSvg(p, el.type)).join('');
      return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><rect x="${box.minX - pad}" y="${box.minY - pad}" width="${Math.max(1, box.maxX - box.minX + pad * 2)}" height="${Math.max(1, box.maxY - box.minY + pad * 2)}" fill="#f4efe3"/>${prims}</svg>`;
    } catch { return ''; }
  }

  _primSvg(p, type) {
    const stroke = type === 'door' ? '#c23f95' : type === 'window' ? '#2f8fce' : '#4b5563';
    if (p.kind === 'line') return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${stroke}" stroke-width="3"/>`;
    if (p.kind === 'polyline') return `<${p.closed ? 'polygon' : 'polyline'} points="${p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}" fill="${p.closed && type === 'wall' ? stroke : 'none'}" stroke="${stroke}" stroke-width="2"/>`;
    if (p.kind === 'arc') return `<path d="${p.svgPath}" fill="none" stroke="${stroke}" stroke-width="2.5"/>`;
    if (p.kind === 'circle') return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="none" stroke="${stroke}" stroke-width="2.5"/>`;
    return '';
  }
}
customElements.define('pt-review-card', PtReviewCard);
