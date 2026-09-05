// TraceProvider interface. A provider's only job is to look at a prepared
// sheet and propose CAD geometry — it never touches the document store, and
// it never decides what happens to its proposals (that's Review's job). This
// boundary is what lets a future OpenCV/ML service slot in later: the app
// treats DemoTraceProvider's output exactly like it would a real service's,
// because both speak this same contract.
//
// See docs/TRACE-PROVIDER.md for the full contract description.

/**
 * @typedef {Object} TraceSheetContext
 * @property {string} sheetId
 * @property {string} sheetName
 * @property {number} naturalWidth
 * @property {number} naturalHeight
 * @property {Object} prep          - sheet.prep (rotation/crop/brightness/contrast/grayscale/opacity)
 * @property {Object} calibration   - sheet.calibration (unit/pixelsPerUnit/points/realLength)
 */

/**
 * @typedef {Object} TraceProposedElement
 * @property {'wall'|'door'|'window'|'stair'|'fixture'|'dimension'|'text'|'room'} type
 * @property {Object} geometry     - type-specific geometry in the sheet's world coordinates
 * @property {number} confidence   - 0..1
 * @property {Array<{severity:'info'|'warning'|'error', message:string, code?:string}>} [findings]
 * @property {{x:number,y:number,w:number,h:number}} [sourceRegion]
 */

export class TraceProvider {
  /** Stable identifier stored on every element this provider proposes. */
  id = 'base-trace-provider';
  /** Human-readable label shown in the UI and review queue. */
  label = 'Base Trace Provider';

  /**
   * @param {TraceSheetContext} context
   * @returns {Promise<{elements: TraceProposedElement[]}>}
   */
  // eslint-disable-next-line no-unused-vars
  async trace(context) {
    throw new Error(`${this.constructor.name} must implement trace(context)`);
  }
}

/** Simple registry so app.js can list/select available providers without hard-wiring imports elsewhere. */
export class TraceProviderRegistry {
  constructor() { this._providers = new Map(); }
  register(provider) { this._providers.set(provider.id, provider); return this; }
  get(id) { return this._providers.get(id) || null; }
  list() { return [...this._providers.values()]; }
}
