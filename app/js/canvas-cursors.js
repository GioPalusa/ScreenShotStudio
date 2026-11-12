// Original canvas artwork, inspired by familiar desktop pointers. No system assets.
// CSS pixels: keep the visible arrow compact, independent of Retina density.
export const CANVAS_CURSOR_SIZE = 24;
const hotspot = values => values.map(value => Math.round(value * CANVAS_CURSOR_SIZE / 32));
const arrow = 'M3 2v20l4.8-4.8 4.1 8.4 3.3-1.6-4.1-8.3H18Z';
const badge = d => `<path d="${d}" fill="none" stroke="#111" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`;
const marks = {
  select: '', point: '',
  move: 'M23 16v12m-6-6h12m-6-6-2 2m2-2 2 2m-8 4 2-2m-2 2 2 2m10-2-2-2m2 2-2 2m-4 4-2-2m2 2 2-2',
  rectangle: 'M19 18h10v9H19Z', ellipse: 'M29 22.5a5 4.5 0 1 1-10 0 5 4.5 0 1 1 10 0',
  line: 'M19 27l9-9', pen: 'M19 27l1-7 7-3-1 7-7 3m0 0 4-5m-1-1 2 2',
  'pen-close': 'M19 27l1-7 7-3-1 7-7 3m0 0 4-5M29 27a2 2 0 1 1-4 0 2 2 0 1 1 4 0',
  bend: 'M18 26c2-11 10-11 11 0m-12 0h2m9 0h2',
  'add-point': 'M19 23h10m-5-5v10', 'remove-point': 'M19 23h10',
  handle: 'M19 26l9-8m-10 7h3v3h-3Zm9-8h3v3h-3Z',
  gradient: 'M19 26l9-8m-10 7h3v3h-3Zm9-8h3v3h-3Z M22 23l3-3',
  corner: 'M19 27v-4a5 5 0 0 1 5-5h5',
  rotate: 'M20 20a5 5 0 1 1-1 5m1-8v4h4',
};
function outlined(content) {
  return `<g stroke="white" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round">${content}</g><g stroke="#111" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${content}</g>`;
}
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_CURSOR_SIZE}" height="${CANVAS_CURSOR_SIZE}" viewBox="0 0 32 32">${body}</svg>`;
export const CANVAS_CURSORS = Object.fromEntries(Object.entries(marks).map(([name, mark]) => {
  const pointer = `<path d="${arrow}" fill="#111" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><path d="${arrow}" fill="#111" stroke="#111" stroke-width=".65" stroke-linejoin="round"/>`;
  // A narrow white halo keeps the small glyph legible on both light and dark art.
  const symbol = mark ? `<path d="${mark}" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>${badge(mark)}` : '';
  return [name, { svg: svg(pointer + symbol), hotspot: hotspot([3, 2]), fallback: 'default' }];
}));
for (const [name, angle] of [['resize-ew', 0], ['resize-ns', 90], ['resize-nwse', 45], ['resize-nesw', -45]]) {
  CANVAS_CURSORS[name] = { svg: svg(`<g transform="rotate(${angle} 16 16)">${outlined('<path d="M5 16h22m-22 0 5-5m-5 5 5 5m17-5-5-5m5 5-5 5" fill="none"/>')}</g>`), hotspot: hotspot([16, 16]), fallback: name.slice(7) + '-resize' };
}
const hands = {
  grab: 'M10 17V8a2 2 0 0 1 4 0v7-10a2 2 0 0 1 4 0v10-8a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v11c0 5-3 8-8 8h-2c-3 0-5-2-7-5l-4-6a2 2 0 0 1 3-3l2 2Z',
  grabbing: 'M9 17v-4a2 2 0 0 1 4 0v-3a2 2 0 0 1 4 0v-1a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v10c0 5-3 8-8 8h-2c-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-3l1 1Z',
};
for (const [name, d] of Object.entries(hands)) CANVAS_CURSORS[name] = { svg: svg(outlined(`<path d="${d}" fill="white"/>`)), hotspot: hotspot([16, 16]), fallback: name };
export function canvasCursor(name) {
  const cursor = CANVAS_CURSORS[name] ?? CANVAS_CURSORS.select;
  return `url("data:image/svg+xml,${encodeURIComponent(cursor.svg)}") ${cursor.hotspot.join(' ')}, ${cursor.fallback}`;
}
export function installCanvasCursors(canvas) {
  for (const name of Object.keys(CANVAS_CURSORS)) canvas.style.setProperty(`--cursor-${name}`, canvasCursor(name));
}
