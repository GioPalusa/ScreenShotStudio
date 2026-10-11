// Portable document schema. `devices` remains the wire name for output canvases in v2.
// Displayed hardware is a separate per-layer profile; old projects keep their appearance.
export const DOCUMENT_VERSION = 2;
export function validateDocument(doc) {
  if (!doc || !Array.isArray(doc.slides) || !doc.devices || !Array.isArray(doc.locales)) throw new Error('A project needs slides, canvases and languages.');
  if ((doc.version ?? 1) > DOCUMENT_VERSION) throw new Error('This project was made with a newer Screenshot Studio. Update the app before opening it.');
  if (!Object.keys(doc.devices).length || !doc.locales.length) throw new Error('Keep at least one canvas and one language.');
  if (!doc.slides.length || !doc.themes || typeof doc.themes !== 'object') throw new Error('Keep at least one slide and a theme collection.');
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..') && !['__proto__', 'prototype', 'constructor'].includes(value);
  const localeIds = new Set();
  for (const locale of doc.locales) { if (!safeId(locale.id) || localeIds.has(locale.id.toLowerCase())) throw new Error('Language IDs must be unique.'); localeIds.add(locale.id.toLowerCase()); }
  for (const [id, profile] of Object.entries(doc.profiles ?? {})) if (!safeId(id) || !safeId(profile.capture) || !Array.isArray(profile.screen) || profile.screen.length !== 2 || !profile.screen.every(v => Number.isInteger(v) && v >= 100 && v <= 12000)) throw new Error(`Invalid device profile: ${id}`);
  const ids = new Set();
  for (const slide of doc.slides) { if (!safeId(slide.id) || ids.has(slide.id)) throw new Error('Slide IDs must be unique.'); ids.add(slide.id); }
  for (const [id, d] of Object.entries(doc.devices)) {
    if (!safeId(id) || !Array.isArray(d.size) || d.size.length !== 2 || !d.size.every(n => Number.isInteger(n) && n >= 100 && n <= 12000)) throw new Error(`Invalid canvas: ${id}`);
  }
  for (const [id, block] of Object.entries(doc.sharedCanvas ?? {})) {
    if (!doc.devices[id] || !Array.isArray(block.layers) || (block.gap != null && (!Number.isFinite(block.gap) || block.gap < 0 || block.gap > 1)) || (block.gapPreset != null && !['app-store', 'google-play', 'custom'].includes(block.gapPreset))) throw new Error(`Invalid shared canvas: ${id}`);
    const layerIds = new Set();
    for (const layer of block.layers) {
      if (!safeId(layer.id) || layerIds.has(layer.id)) throw new Error('Shared layer IDs must be unique.');
      layerIds.add(layer.id);
    }
  }
  return doc;
}
export function migrateDocument(input) {
  const doc = structuredClone(validateDocument(input));
  doc.version = DOCUMENT_VERSION;
  doc.profiles ??= {};
  return doc;
}
