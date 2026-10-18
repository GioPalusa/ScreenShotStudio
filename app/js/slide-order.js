import { CREATIVE_TARGETS, exportTarget } from './export-targets.js';

/** Restricted store images appear only on their own canvases. Legacy screens keep every ordinary canvas. */
export function slideSupportsCanvas(project, slide, deviceId) {
  return slide?.canvasIds ? slide.canvasIds.includes(deviceId) : project.devices[deviceId]?.screenScope !== 'store-image';
}

/** One project-wide screen list; each screen resolves to a compatible output canvas. */
export function screenCanvasId(project, slide, preferred, screenshotCanvas = null) {
  const available = Object.keys(project.devices).filter(id => slideSupportsCanvas(project, slide, id));
  return available.includes(preferred) ? preferred : available.includes(screenshotCanvas) ? screenshotCanvas : available[0];
}

/** Store artwork stays first; each group follows the language's order, inheriting the original by default. */
export function orderedSlides(project, localeId, deviceId = null) {
  const original = project.locales?.find(l => l.id === project.sourceLocale)?.id ?? project.locales?.[0]?.id;
  const order = project.slideOrders?.[localeId] ?? project.slideOrders?.[original] ?? [];
  const remaining = new Map((project.slides ?? []).map(slide => [slide.id, slide]));
  const result = [];
  for (const id of order) {
    if (remaining.has(id)) { result.push(remaining.get(id)); remaining.delete(id); }
  }
  const slides = [...result, ...remaining.values()].sort((a, b) => Number(isStoreSlide(project, b)) - Number(isStoreSlide(project, a)));
  return deviceId ? slides.filter(slide => slideSupportsCanvas(project, slide, deviceId)) : slides;
}

/** Dedicated store artwork stays separate from screenshot rows. */
export function isStoreCanvas(device) {
  return Boolean(device && (device.screenScope === 'store-image' || CREATIVE_TARGETS[exportTarget(device)] || ['play-feature', 'play-tv-banner'].includes(exportTarget(device))));
}
export function isStoreSlide(project, slide) {
  return Boolean(slide?.canvasIds?.length && slide.canvasIds.every(id => isStoreCanvas(project.devices[id])));
}
export function orderedCanvases(project) {
  return Object.entries(project.devices).sort(([, a], [, b]) => Number(isStoreCanvas(b)) - Number(isStoreCanvas(a)));
}
export function isPhoneCanvas(device) {
  if (!device || isStoreCanvas(device)) return false;
  const target = exportTarget(device);
  return ['iphone', 'play-phone'].includes(target) || (['custom', 'unknown'].includes(target) && device.layout === 'phone');
}
export function phoneCanvasId(project, preferred, remembered) {
  const phones = Object.keys(project.devices).filter(id => isPhoneCanvas(project.devices[id]));
  return phones.includes(preferred) ? preferred : phones.includes(remembered) ? remembered : phones[0];
}
