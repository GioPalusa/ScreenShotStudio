// A gallery of layouts - the built-in ones and the project's own templates - each previewed with the
// current slide's text and screenshot, so you see what you would get before choosing.

import { engine } from '../store.js';
import { TEMPLATE_LABELS, layoutFor } from '../layouts.js';
import { templateUsage, keepCapture } from '../layer-ops.js';

/** Layouts you can choose from: [{ kind: 'builtin' | 'template', id, label, note }]. */
export function layoutOptions() {
  const builtin = Object.entries(TEMPLATE_LABELS).map(([id, label]) => ({ kind: 'builtin', id, label, note: 'built in' }));
  const own = Object.entries(engine.project.templates ?? {}).map(([id, t]) => ({ kind: 'template', id, label: t.name ?? id, note: `${templateUsage(engine.project, id).length} slide${templateUsage(engine.project, id).length === 1 ? '' : 's'}` }));
  return [...own, ...builtin];
}

/** The slide as it would look with an option chosen on one device (for previews). */
export function slideWithOption(slide, deviceId, option) {
  const device = engine.project.devices[deviceId];
  const current = layoutFor(slide, deviceId, device);
  const block = { ...(option.kind === 'builtin' ? { template: option.id } : { use: option.id }), ...keepCapture(current) };
  return { ...slide, layouts: { ...(slide.layouts ?? {}), [deviceId]: block } };
}
