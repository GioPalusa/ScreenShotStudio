import { starterProject } from './onboarding.js';
import { applyExternalImport } from './external-import.js';
import { validateDocument } from './document.js';

/** The normal bundled seed, with its example screen/canvas removed before import. */
export function figmaProjectSeed() {
  const { project, copy } = starterProject({});
  project.slides = []; project.devices = {}; project.profiles = {};
  for (const locale of Object.keys(copy)) copy[locale] = { _meta: { status: 'draft', needsReview: ['*'] } };
  return { project, copy };
}

export function projectFromFigma(rows, options) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100 || rows.some(r => r.kind !== 'figma-editable' || !r.design || !Array.isArray(r.design.layers))) throw Error('Choose 1–100 Figma views or selections.');
  const { project, copy } = figmaProjectSeed();
  const result = applyExternalImport(project, copy, rows, options);
  // Each imported screen belongs only to its selected size, avoiding blank canvases.
  for (const slide of result.project.slides) slide.canvasIds = Object.keys(slide.localeLayouts['en-US']);
  validateDocument(result.project);
  return result;
}
