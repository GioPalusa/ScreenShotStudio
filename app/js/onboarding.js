import { STARTER_PALETTES, previewStarterDesign } from './design-library.js';
import { EXPORT_TARGETS } from './export-targets.js';
import { validateDocument } from './document.js';
import { playCanvasDefaults } from './google-play.js';
import { genericFrame } from './generic-frame.js';
export const WELCOME_PALETTES = STARTER_PALETTES.map((p, i) => ({ ...p, swatches: [['#f0a66a'], ['#c9704e'], ['#38846b'], ['#9c63c7']][i] }));
export const GET_STARTED = [
  ['Choose your canvas', 'Setup → Canvases has ready-made App Store and Google Play formats. Add another format when you need it.'],
  ['Bring in your screenshots', 'Drop a screenshot onto the device, or upload in Media. In Screenshot → Frame, choose No frame, Generic frame or a matching imported frame. Browse all frames offers other devices. Setup → Frames shows where to download Apple bezels and drop the DMG.'],
  ['Make it yours', 'Select a layer to edit its Details. Use ＋ Add screens for new screens, Design → Load design to change the current screen, and Save this design to reuse its layout.'],
  ['Add languages', 'Translate lets you add languages, review copy and exchange text files with a reviewer. Unique design keeps a layout separate when needed.'],
  ['Check and export', 'Run Export checks, resolve missing screenshots and review flags, then export. Images are numbered by format and slide inside a dated folder.'],
];
export function starterProject({ target = 'iphone', palette = WELCOME_PALETTES[0] } = {}) {
  if (!Object.hasOwn(EXPORT_TARGETS, target) || target === 'custom') throw new Error('Choose a store destination.');
  if (!palette || typeof palette.name !== 'string' || !palette.name.trim() || palette.name.length > 60 || !Array.isArray(palette.swatches ?? []) || (palette.swatches ?? []).length > 8 || ![palette.bg, palette.ink, ...(palette.swatches ?? [])].every(c => /^#[0-9a-f]{6}$/i.test(c))) throw new Error('Choose valid colours and a palette name.');
  const spec = EXPORT_TARGETS[target], size = [...spec.formats[0].size], defaults = playCanvasDefaults(target, size);
  if (!spec.store) defaults.frame = genericFrame({ screen: size, family: target });
  const project = { version: 2, fonts: { default: { family: 'system-ui' } }, themes: { starter: { name: palette.name.trim(), bg: palette.bg, ink: palette.ink, swatches: [...(palette.swatches ?? [])] } }, profiles: {}, locales: [{ id: 'en-US', name: 'English (US)', native: 'English', dir: 'ltr' }], devices: { [target]: { label: spec.label, short: spec.label, target, size, layout: spec.layout, capture: defaults.capture || target, frame: defaults.frame } }, slides: [{ id: 'first-slide', name: 'Your first slide', theme: 'starter', capture: 'screen', layouts: { [target]: { template: 'custom', panorama: false } } }] };
  project.slides[0] = previewStarterDesign(project, project.slides[0], { designId: 'focus', deviceIds: [target] });
  validateDocument(project);
  return { project, copy: { 'en-US': { _meta: { status: 'draft', needsReview: ['*'] }, 'first-slide': { headline: 'Your app, at a glance', caption: 'Add a screenshot and tell your story.' } } } };
}
/** Explicit opens win; a missing last project returns to Welcome, not an older document. */
export function startupProject({ explicit = null, recent = [] } = {}, exists = () => false) {
  if (typeof explicit === 'string' && explicit) return explicit;
  const latest = Array.isArray(recent) ? recent[0] : null;
  if (typeof latest !== 'string' || !latest) return null;
  try { return exists(latest) ? latest : null; } catch { return null; }
}
