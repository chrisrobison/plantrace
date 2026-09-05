// Tiny inline-SVG icon set. PlanTrace avoids an icon-font/CDN dependency
// entirely (see the CDN-failure requirement in the brief) — every icon here
// is a plain, dependency-free <svg> string using currentColor, so icons
// always render even fully offline and always match the surrounding text
// color/theme.
const PATHS = {
  wordmark: '<path d="M3 4h5.5a4 4 0 0 1 0 8H6v8H3V4Zm3 3v5h2.5a2.5 2.5 0 0 0 0-5H6Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
  help: '<circle cx="12" cy="12" r="9.25"/><path d="M9.3 9.3a2.7 2.7 0 1 1 3.9 2.42c-.77.4-1.2 1-1.2 1.78v.3" stroke-linecap="round"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  undo: '<path d="M8 7 3.5 11.5 8 16" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 11.5H15a5.5 5.5 0 0 1 0 11H9" stroke-linecap="round"/>',
  redo: '<path d="M16 7l4.5 4.5L16 16" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.5 11.5H9a5.5 5.5 0 0 0 0 11h6" stroke-linecap="round"/>',
  hand: '<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11m3 .3V7a1.5 1.5 0 0 1 3 0v7.5c0 3.6-2.4 6.5-7 6.5-3.6 0-5-1.4-6.6-4L4.6 14a1.6 1.6 0 0 1 2.8-1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  cursor: '<path d="M5 3.5 18.5 10 12.5 12l-2 6.5L5 3.5Z" stroke-linejoin="round"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.3-4.3M10.5 8v5M8 10.5h5" stroke-linecap="round"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.3-4.3M8 10.5h5" stroke-linecap="round"/>',
  fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4m11-5v4a1 1 0 0 1-1 1h-4" stroke-linecap="round" stroke-linejoin="round"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16" stroke-linecap="round"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.75"/>',
  eyeOff: '<path d="M3.5 3.5l17 17" stroke-linecap="round"/><path d="M10.6 5.7A11 11 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-3.15 3.9M6.5 7.4A15 15 0 0 0 2.5 12S6 18.5 12 18.5a10 10 0 0 0 3.3-.55" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.7 10a2.75 2.75 0 0 0 3.9 3.9" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-linecap="round"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronDown: '<path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronUp: '<path d="m6 15 6-6 6 6" stroke-linecap="round" stroke-linejoin="round"/>',
  kebab: '<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/>',
  close: '<path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7" stroke-linecap="round" stroke-linejoin="round"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 4.8L4 16.4V20h3.6l5.3-5.3a4 4 0 0 0 4.8-5.4l-2.8 2.8-2-2 2.8-2.8Z" stroke-linejoin="round"/>',
  grip: '<circle cx="9" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1" fill="currentColor" stroke="none"/>',
  wall: '<rect x="3" y="10" width="18" height="4"/>',
  door: '<path d="M6 21V4h9v17" stroke-linejoin="round"/><path d="M15 4a11 11 0 0 1 5 8" stroke-linecap="round"/>',
  window: '<rect x="3.5" y="6" width="17" height="12"/><path d="M12 6v12M3.5 12h17" />',
  dimension: '<path d="M4 8v8M20 8v8M4 12h16" stroke-linecap="round"/>',
  erase: '<path d="m18 13-7.5 7.5H4V14L13.5 4.5a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L10.5 17" stroke-linejoin="round"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 2v-8.5L4 5Z" stroke-linejoin="round"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z" stroke-linejoin="round"/><path d="m3 13 9 5 9-5" stroke-linecap="round" stroke-linejoin="round"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke-linecap="round" stroke-linejoin="round"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16" stroke-linecap="round" stroke-linejoin="round"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="1.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 3.5 3.5L17 10l4 5" stroke-linejoin="round"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" stroke-linecap="round"/>',
  rotate: '<path d="M4 12a8 8 0 1 1 2.6 5.9" stroke-linecap="round"/><path d="M4 18v-5h5" stroke-linecap="round" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke-linecap="round"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none"/>',
  droplet: '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 1 1-13 0C5.5 10 12 3 12 3Z" stroke-linejoin="round"/>',
  ruler: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8v3M11 8v3M15 8v3M19 8v3" stroke-linecap="round"/>',
  stairs: '<path d="M4 20v-4h4v-4h4V8h4V4h4" stroke-linecap="round" stroke-linejoin="round"/>',
  fixture: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  text: '<path d="M5 6h14M12 6v13" stroke-linecap="round"/>',
  room: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 12h8" stroke-linecap="round"/>',
  save: '<path d="M5 4h11l3 3v13H5V4Z" stroke-linejoin="round"/><path d="M8 4v6h8V4M8 14h8v6" stroke-linejoin="round"/>',
  warning: '<path d="M12 3.5 22 20.5H2L12 3.5Z" stroke-linejoin="round"/><path d="M12 10v4" stroke-linecap="round"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>',
  error: '<circle cx="12" cy="12" r="9.25"/><path d="M12 7.5v5.5" stroke-linecap="round"/><circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9.25"/><path d="M12 11v5.5" stroke-linecap="round"/><circle cx="12" cy="7.7" r="0.9" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.3-4.3" stroke-linecap="round"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke-linecap="round"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 14h12" stroke-linecap="round"/>',
  file: '<path d="M6 2.5h8l4 4V21H6V2.5Z" stroke-linejoin="round"/><path d="M14 2.5V7h4" stroke-linejoin="round"/>',
  drag: '<circle cx="8" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="1" fill="currentColor" stroke="none"/>',
};

export function iconMarkup(name, { size = 18 } = {}) {
  const inner = PATHS[name] || PATHS.info;
  return `<svg class="pt-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false">${inner}</svg>`;
}

export const ICON_NAMES = Object.keys(PATHS);
