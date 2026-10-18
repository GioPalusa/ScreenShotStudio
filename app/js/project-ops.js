// Project-level edits as plain functions (no DOM, no saving): changing a device's canvas, adding and removing devices.

import { slugify, uniqueId } from './layer-ops.js';
import { availableProfilesFor } from './profiles.js';
import { orderedSlides } from './slide-order.js';
export { orderedSlides } from './slide-order.js';

export function deviceProfileUsage(project, profileId) {
  const count = value => {
    if (!value || typeof value !== 'object') return 0;
    return (value.profile === profileId ? 1 : 0) + Object.values(value).reduce((sum, child) => sum + count(child), 0);
  };
  return [...Object.entries(project.sharedCanvas ?? {}).map(([id, block]) => ({ type: 'shared', id, name: 'All screens', count: count(block) })), ...(project.slides ?? []).map(slide => ({ type: 'screen', id: slide.id, name: slide.name ?? slide.id, count: count(slide) })),
    ...Object.entries(project.templates ?? {}).map(([id, template]) => ({ type: 'template', id, name: template.name ?? id, count: count(template) }))].filter(item => item.count);
}

/** Remove a library choice in this document, preserving hardware used by existing layouts. */
export function removeDeviceProfile(project, profileId, frames = {}) {
  const profile = availableProfilesFor(project, frames)[profileId];
  if (!profile) return false;
  if (deviceProfileUsage(project, profileId).length) {
    project.profiles ??= {};
    project.profiles[profileId] = structuredClone(profile);
  } else if (project.profiles) delete project.profiles[profileId];
  project.removedProfiles = [...new Set([...(project.removedProfiles ?? []), profileId])];
  return true;
}

/**
 * Give a device a new canvas size. Layouts are written for a design width; two ways to carry them over:
 *   "scale" - the design is scaled with the canvas: everything keeps its proportions (the usual choice when
 *             Apple moves from, say, 1290 to 1320 px wide);
 *   "keep"  - every measurement stays the same number of exported pixels, so a wider canvas just has more room.
 */
export function resizeDevice(project, deviceId, size, { mode = 'scale' } = {}) {
  const d = project.devices[deviceId];
  const oldWidth = d.size[0];
  const [width, height] = size.map((n) => Math.max(1, Math.round(n)));
  const designWidth = d.designSize?.[0] ?? oldWidth;
  const k = oldWidth / designWidth;
  const nextDesignWidth = mode === 'keep' ? width / k : designWidth;
  if (Math.abs(nextDesignWidth - width) < 0.5) delete d.designSize;
  else d.designSize = [Math.round(nextDesignWidth * 100) / 100, Math.round((nextDesignWidth * height) / width)];
  d.size = [width, height];
}

/** Add a device. With `reuseFrom` it shares that device's layouts, scaled to the new width. Returns the new id. */
export function addDevice(project, { label, short, size, layout, capture, frame, appStore, target = 'custom', reuseFrom = null, screenScope = null }) {
  const id = uniqueId(Object.keys(project.devices), slugify(short || label, 'device'));
  const device = {
    label, short: short || label, size: size.map((n) => Math.round(n)), layout, capture: capture || id,
    frame: structuredClone(frame ?? { type: 'plain' }), target,
    ...(appStore ? { appStore } : {}),
    ...(screenScope ? { screenScope } : {}),
  };
  if (reuseFrom && project.devices[reuseFrom]) {
    const donor = project.devices[reuseFrom];
    if (donor.screenScope) device.screenScope = donor.screenScope;
    device.layout = donor.layout;
    const designWidth = donor.designSize?.[0] ?? donor.size[0];
    if (device.size[0] !== designWidth) device.designSize = [designWidth, Math.round((designWidth * device.size[1]) / device.size[0])];
    if (project.sharedCanvas?.[reuseFrom]) project.sharedCanvas[id] = structuredClone(project.sharedCanvas[reuseFrom]);
    // a layout the donor has for itself alone (rather than for its whole family) comes along too
    for (const owner of [...project.slides, ...Object.values(project.templates ?? {})]) {
      if (owner.canvasIds?.includes(reuseFrom)) owner.canvasIds.push(id);
      if (owner.layouts?.[reuseFrom]) owner.layouts[id] = structuredClone(owner.layouts[reuseFrom]);
    }
  }
  if (!reuseFrom && !screenScope) {
    for (const slide of project.slides) { slide.layouts ??= {}; slide.layouts[id] = { template: 'custom', panorama: false }; }
  }
  project.devices[id] = device;
  return id;
}

/** Remove a device and any layout written for it specifically (layouts shared by class are left alone). */
export function removeDevice(project, id) {
  delete project.devices[id];
  for (const slide of project.slides) if (slide.canvasIds) slide.canvasIds = slide.canvasIds.filter(canvasId => canvasId !== id);
  const removed = project.slides.filter(slide => slide.canvasIds?.length === 0).map(slide => slide.id);
  project.slides = project.slides.filter(slide => !removed.includes(slide.id));
  for (const locale of Object.keys(project.slideOrders ?? {})) project.slideOrders[locale] = project.slideOrders[locale].filter(slideId => !removed.includes(slideId));
  if (project.sharedCanvas) delete project.sharedCanvas[id];
  for (const slide of project.slides) if (slide.canvasOrientations) delete slide.canvasOrientations[id];
  for (const slide of project.slides) { if (slide.layouts?.[id]) delete slide.layouts[id]; for (const variants of Object.values(slide.localeLayouts ?? {})) delete variants[id]; }
  for (const tpl of Object.values(project.templates ?? {})) if (tpl.layouts?.[id]) delete tpl.layouts[id];
}

/** Locale order is presentation metadata; slide identities and connected layouts stay intact. */
/** Insert a new screen beside its source in the default order and every custom language order. */
export function insertSlideAfter(project, slide, afterId) {
  const index = project.slides.findIndex(s => s.id === afterId);
  if (index < 0 || project.slides.some(s => s.id === slide.id)) return false;
  for (const localeId of Object.keys(project.slideOrders ?? {})) {
    const order = orderedSlides(project, localeId).map(s => s.id);
    order.splice(order.indexOf(afterId) + 1, 0, slide.id);
    project.slideOrders[localeId] = order;
  }
  project.slides.splice(index + 1, 0, slide);
  return true;
}

export function reorderSlides(project, fromId, toId, after, localeId, allLanguages = false) {
  const slides = orderedSlides(project, localeId);
  if (fromId === toId || !slides.some(s => s.id === fromId) || !slides.some(s => s.id === toId)) return false;
  const [moved] = slides.splice(slides.findIndex(s => s.id === fromId), 1);
  slides.splice(slides.findIndex(s => s.id === toId) + Number(after), 0, moved);
  project.slideOrders ??= {};
  const original = project.locales?.find(l => l.id === project.sourceLocale)?.id ?? project.locales?.[0]?.id;
  // An explicit "This language only" move must preserve other languages' current
  // order, including those that had followed the original implicitly.
  if (!allLanguages && localeId === original) for (const locale of project.locales) {
    if (locale.id !== localeId && !project.slideOrders[locale.id]) project.slideOrders[locale.id] = orderedSlides(project, locale.id).map(s => s.id);
  }
  const locales = allLanguages ? project.locales.map(l => l.id) : [localeId];
  for (const id of locales) project.slideOrders[id] = slides.map(s => s.id);
  return true;
}

export function renameSlide(project, id, name) {
  const slide = project.slides.find(s => s.id === id);
  const value = String(name ?? '').trim();
  if (!slide || !value || value === slide.name) return false;
  slide.name = value;
  return true;
}
