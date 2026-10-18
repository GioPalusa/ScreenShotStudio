/** Restricted store images appear only on their own canvases. Legacy screens keep every ordinary canvas. */
export function slideSupportsCanvas(project, slide, deviceId) {
  return slide?.canvasIds ? slide.canvasIds.includes(deviceId) : project.devices[deviceId]?.screenScope !== 'store-image';
}

/** One project-wide screen list; each screen resolves to a compatible output canvas. */
export function screenCanvasId(project, slide, preferred, screenshotCanvas = null) {
  const available = Object.keys(project.devices).filter(id => slideSupportsCanvas(project, slide, id));
  return available.includes(preferred) ? preferred : available.includes(screenshotCanvas) ? screenshotCanvas : available[0];
}

/** Languages without an explicit order follow the original language's current order. */
export function orderedSlides(project, localeId, deviceId = null) {
  const original = project.locales?.find(l => l.id === project.sourceLocale)?.id ?? project.locales?.[0]?.id;
  const order = project.slideOrders?.[localeId] ?? project.slideOrders?.[original] ?? [];
  const remaining = new Map((project.slides ?? []).map(slide => [slide.id, slide]));
  const result = [];
  for (const id of order) {
    if (remaining.has(id)) { result.push(remaining.get(id)); remaining.delete(id); }
  }
  const slides = [...result, ...remaining.values()];
  return deviceId ? slides.filter(slide => slideSupportsCanvas(project, slide, deviceId)) : slides;
}
