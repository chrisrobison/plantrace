// Standalone SVG export of a sheet's reconstructed geometry. Rejected
// elements are omitted; everything else is drawn colored by its review
// status so a reviewer opening the file cold can still see what's settled.
import { elementToPrimitives } from './primitives.js';
import { LAYER_DEFS } from './plan-schema.js';

const STATUS_COLOR = { verified: '#1f9d55', corrected: '#1f9d55', proposed: '#b9852f', rejected: '#c72525' };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function primitiveToSvg(p, stroke) {
  switch (p.kind) {
    case 'line':
      return `<line x1="${p.x1.toFixed(2)}" y1="${p.y1.toFixed(2)}" x2="${p.x2.toFixed(2)}" y2="${p.y2.toFixed(2)}" stroke="${stroke}" stroke-width="${p.extension ? 0.75 : 1.5}" ${p.extension ? 'stroke-dasharray="2,2"' : ''}/>`;
    case 'polyline': {
      const pts = p.points.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ');
      const tag = p.closed ? 'polygon' : 'polyline';
      return `<${tag} points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5" ${p.dashed ? 'stroke-dasharray="6,4"' : ''}/>`;
    }
    case 'arc':
      return `<path d="${p.svgPath}" fill="none" stroke="${stroke}" stroke-width="1.25"/>`;
    case 'circle':
      return `<circle cx="${p.cx.toFixed(2)}" cy="${p.cy.toFixed(2)}" r="${p.r.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;
    case 'text':
      return `<text x="${p.x.toFixed(2)}" y="${(p.y + (p.dy || 0)).toFixed(2)}" font-size="${p.size || 12}" text-anchor="${p.anchor || 'start'}" font-weight="${p.weight || 'normal'}" fill="${stroke}" font-family="ui-sans-serif, system-ui">${esc(p.content)}</text>`;
    default:
      return '';
  }
}

export function exportSheetToSVG(sheet) {
  const layerColor = new Map(LAYER_DEFS.map((l) => [l.id, l.color]));
  const width = sheet.naturalWidth;
  const height = sheet.naturalHeight;
  const groups = {};
  for (const el of sheet.geometry) {
    if (el.status === 'rejected') continue;
    const layer = el.layerId;
    const layerCol = layerColor.get(layer) || '#333';
    const stroke = STATUS_COLOR[el.status] || layerCol;
    groups[layer] = groups[layer] || [];
    for (const prim of elementToPrimitives(el, sheet.calibration)) {
      groups[layer].push(primitiveToSvg(prim, stroke));
    }
  }
  const layerGroups = Object.entries(groups).map(([id, shapes]) => `<g id="layer-${esc(id)}" data-layer="${esc(id)}">${shapes.join('\n')}</g>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${esc(sheet.name)} — PlanTrace export</title>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fbf8f1"/>
  ${layerGroups}
  <text x="12" y="${height - 12}" font-size="11" fill="#94958f" font-family="ui-sans-serif, system-ui">Reconstructed from a scanned drawing — verify against field measurements before construction use.</text>
</svg>`;
}

export function downloadSVG(sheet) {
  const svg = exportSheetToSVG(sheet);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(sheet.name || 'sheet').replace(/[^a-z0-9-_]+/gi, '_')}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
