// Unit conversion and formatting. `calibration.pixelsPerUnit` is always
// pixels-per-INCH regardless of the sheet's chosen display unit — a single
// universal base avoids a class of bugs where switching the display unit
// (say ft-in -> meters) would otherwise require silently reinterpreting an
// already-computed scale factor.

const MM_PER_INCH = 25.4;
const METRIC_UNITS = new Set(['m', 'cm', 'mm']);

/** True once two calibration points and a real length have produced a scale factor. */
export function isCalibrated(calibration) {
  return !!(calibration && calibration.pixelsPerUnit && calibration.pixelsPerUnit > 0);
}

/** Pixels -> inches (the universal base unit), or null if uncalibrated. */
export function pxToInches(px, calibration) {
  if (!isCalibrated(calibration)) return null;
  return px / calibration.pixelsPerUnit;
}

export function inchesToPx(inches, calibration) {
  if (!isCalibrated(calibration)) return null;
  return inches * calibration.pixelsPerUnit;
}

/** Format a pixel length using the sheet's calibration + display unit; falls back to a raw px label when uncalibrated. */
export function formatLength(px, calibration) {
  if (!isCalibrated(calibration)) return `${Math.round(px)}px`;
  return formatInches(pxToInches(px, calibration), calibration.unit);
}

/** Format an inches value per a display unit (ft-in / ft / in / m / cm / mm). */
export function formatInches(inches, unit) {
  if (METRIC_UNITS.has(unit)) {
    const mm = inches * MM_PER_INCH;
    if (unit === 'mm') return `${Math.round(mm)} mm`;
    if (unit === 'cm') return `${(mm / 10).toFixed(1)} cm`;
    return `${(mm / 1000).toFixed(2)} m`;
  }
  if (unit === 'in') return `${round1(inches)}"`;
  if (unit === 'ft') return `${round1(inches / 12)}'`;
  // ft-in, the mockup's format: 12'-6"
  const feet = Math.floor(inches / 12);
  const rem = Math.round(inches - feet * 12);
  if (rem === 12) return `${feet + 1}'-0"`;
  return `${feet}'-${rem}"`;
}

function round1(n) { return Math.round(n * 10) / 10; }

/**
 * Parse user input in the given display unit into inches (the base unit).
 * Accepts `12'-6"`, `12.5'`, `150"`, `3.2m`, `320cm`, `4000mm`, or a bare
 * number (interpreted per `unit`). Returns null if unparseable.
 */
export function parseLengthInput(str, unit) {
  const s = String(str || '').trim();
  if (!s) return null;
  if (METRIC_UNITS.has(unit)) {
    const m = s.match(/^(-?[\d.]+)\s*(mm|cm|m)?$/i);
    if (!m) return null;
    const value = parseFloat(m[1]);
    if (!Number.isFinite(value)) return null;
    const u = (m[2] || unit).toLowerCase();
    const mm = u === 'mm' ? value : u === 'cm' ? value * 10 : value * 1000;
    return mm / MM_PER_INCH;
  }
  const inchOnly = s.match(/^(-?\d+(?:\.\d+)?)\s*"$/);
  const feetOnly = s.match(/^(-?\d+(?:\.\d+)?)\s*'$/);
  const ftIn = s.match(/^(-?\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (inchOnly) return parseFloat(inchOnly[1]);
  if (feetOnly) return parseFloat(feetOnly[1]) * 12;
  if (s.includes("'") && ftIn) return (parseFloat(ftIn[1]) || 0) * 12 + (parseFloat(ftIn[2] || '0') || 0);
  const plain = parseFloat(s);
  if (!Number.isFinite(plain)) return null;
  return unit === 'ft' ? plain * 12 : plain; // 'in' or bare ft-in number treated as inches
}

/** Given two world points and a real-world length + display unit, compute pixelsPerUnit (pixels per inch). */
export function computePixelsPerUnit(pointA, pointB, realLength, unit) {
  const px = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  const inches = METRIC_UNITS.has(unit) ? (realLength * (unit === 'mm' ? 1 : unit === 'cm' ? 10 : 1000)) / MM_PER_INCH : (unit === 'ft' ? realLength * 12 : realLength);
  if (px <= 0 || !inches || inches <= 0) return null;
  return px / inches;
}

export const UNIT_LABELS = { 'ft-in': "Feet & Inches (12'-6\")", ft: 'Decimal Feet', in: 'Inches', m: 'Meters', cm: 'Centimeters', mm: 'Millimeters' };
