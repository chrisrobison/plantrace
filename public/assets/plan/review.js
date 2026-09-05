// Pure calculations behind the Review panel: verification percentage,
// counts, filtering, and sort order. Kept separate from the store and from
// <pt-review-panel> so the numbers on screen can be unit-tested/eyeballed
// against a plain array of elements with no DOM or store involved.
import { GEOMETRY_TYPES } from './plan-schema.js';

export function hasErrorFinding(el) {
  return (el.findings || []).some((f) => f.severity === 'error');
}

export function computeReviewStats(elements) {
  const total = elements.length;
  const verified = elements.filter((e) => e.status === 'verified' || e.status === 'corrected').length;
  const rejected = elements.filter((e) => e.status === 'rejected').length;
  const needsReview = elements.filter((e) => e.status === 'proposed').length;
  const errors = elements.filter((e) => e.status === 'proposed' && hasErrorFinding(e)).length;
  const percent = total ? Math.round((verified / total) * 100) : 0;
  return { total, verified, rejected, needsReview, errors, percent };
}

/**
 * @param {Array} elements
 * @param {{type?:string, status?:string, maxConfidence?:number, query?:string}} filter
 */
export function filterIssues(elements, filter = {}) {
  return elements.filter((el) => {
    if (filter.type && filter.type !== 'all' && el.type !== filter.type) return false;
    if (filter.status && filter.status !== 'all' && el.status !== filter.status) return false;
    if (typeof filter.maxConfidence === 'number' && el.confidence > filter.maxConfidence) return false;
    if (filter.query) {
      const q = filter.query.toLowerCase();
      const label = issueTitle(el).toLowerCase();
      const msg = (el.findings[0]?.message || '').toLowerCase();
      if (!label.includes(q) && !msg.includes(q) && !el.type.includes(q)) return false;
    }
    return true;
  });
}

export function sortIssuesByConfidence(elements) {
  return [...elements].sort((a, b) => a.confidence - b.confidence);
}

const TYPE_LABELS = { wall: 'Wall', door: 'Door', window: 'Window', stair: 'Stair', fixture: 'Fixture', dimension: 'Dimension', text: 'Text', room: 'Room label' };

/** Human title for an issue card: the first finding's summary, or a generic per-type fallback. */
export function issueTitle(el) {
  if (el.findings?.[0]) {
    const code = el.findings[0].code || '';
    if (code === 'wall-junction') return 'Uncertain wall junction';
    if (code === 'dim-conflict') return 'Dimension conflict';
    if (code === 'door-swing') return 'Door swing detected';
    if (code === 'window-type') return 'Window type unclear';
    if (code === 'room-bounds') return 'Room boundary unclear';
    if (code === 'stair-run') return 'Stair run estimated';
    if (code === 'fixture-kind') return 'Fixture type guessed';
    if (code === 'text-ocr') return 'Label text unclear';
  }
  return `${TYPE_LABELS[el.type] || el.type} proposed`;
}

export function issueDescription(el) {
  return el.findings?.[0]?.message || `Review this proposed ${TYPE_LABELS[el.type]?.toLowerCase() || el.type} for accuracy.`;
}

export { GEOMETRY_TYPES as REVIEW_TYPE_OPTIONS };
