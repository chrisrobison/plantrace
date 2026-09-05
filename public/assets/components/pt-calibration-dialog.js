// <pt-calibration-dialog> — "identify a known dimension by selecting two
// points and entering its real-world length." Point-picking happens
// directly on the (non-modal) workspace canvas — see pt-plan-workspace's
// 'calibrate' tool mode — because a modal <dialog> would block exactly the
// canvas clicks this feature needs. Once two points come back over the bus,
// this component opens a small modal just to ask for the real length.
import { PtElement, bus, esc, openDialog, toast } from '../core.js';
import { parseLengthInput, UNIT_LABELS } from '../plan/units.js';

export class PtCalibrationDialog extends PtElement {
  connect() {
    bus.subscribe('calibration.request', (d) => this._begin(d.sheetId), this.abort.signal);
    bus.subscribe('calibration.pointsReady', (d) => this._askLength(d), this.abort.signal);
  }

  set store(store) { this._store = store; }

  _begin(sheetId) {
    this._store.setActiveSheetIdIfNeeded(sheetId);
    this._store.setToolMode('calibrate');
    toast('Click the two ends of a known dimension on the drawing (e.g. an exterior wall). Press Escape to cancel.', 'info');
  }

  _askLength({ sheetId, pointA, pointB }) {
    const sheet = this._store.getSheet(sheetId);
    const pxDist = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
    const dialog = document.createElement('dialog');
    dialog.className = 'pt-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <h3>Set known dimension</h3>
        <p>You measured ${pxDist.toFixed(1)}px on the sheet. Enter its real-world length to calibrate this sheet's scale.</p>
        <div class="pt-field">
          <label for="pt-cal-unit">Unit</label>
          <select id="pt-cal-unit" name="unit">${Object.entries(UNIT_LABELS).map(([id, label]) => `<option value="${id}" ${id === sheet.calibration.unit ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
        </div>
        <div class="pt-field">
          <label for="pt-cal-length">Real-world length</label>
          <input id="pt-cal-length" name="length" placeholder="e.g. 12'-6&quot; or 3.8" autofocus required>
        </div>
        <div class="pt-dialog-actions">
          <button type="submit" value="cancel" class="pt-btn pt-btn-secondary">Cancel</button>
          <button type="submit" value="save" class="pt-btn pt-btn-primary">Set scale</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    dialog.querySelector('form').addEventListener('submit', (e) => {
      if (e.submitter?.value === 'cancel') return;
      const unit = dialog.querySelector('#pt-cal-unit').value;
      const inches = parseLengthInput(dialog.querySelector('#pt-cal-length').value, unit);
      if (!inches || inches <= 0) {
        e.preventDefault();
        toast('Could not parse that length. Try a format like 12\'-6" or 3.8.', 'error');
        return;
      }
      this._store.setCalibration(sheetId, { pointA, pointB, realLengthInches: inches, unit });
      toast('Calibration set.', 'success');
    });
    openDialog(dialog, { onClose: () => dialog.remove() });
  }
}
customElements.define('pt-calibration-dialog', PtCalibrationDialog);
