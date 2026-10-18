import { EXPORT_TARGETS } from './export-targets.js';
import { addDevice, insertSlideAfter } from './project-ops.js';
import { uniqueId } from './layer-ops.js';

export const STORE_IMAGE_SETS = {
  'app-store': { label: 'App Store images', targets: ['app-store-search', 'app-store-header'] },
  'google-play': { label: 'Google Play feature graphic', targets: ['play-feature'] },
};

export function existingStoreImage(project, target) {
  return Object.entries(project.devices).find(([, device]) => device.screenScope === 'store-image' && device.target === target);
}

/** Adds missing store images without touching existing artwork or ordinary screenshots. */
export function addStoreImages(project, { store, sizes = {}, afterId, theme }, makeId) {
  const set = STORE_IMAGE_SETS[store];
  if (!set) throw new Error('Choose App Store or Google Play.');
  // Validate the complete request before changing the document.
  for (const target of set.targets) {
    const size = sizes[target] ?? EXPORT_TARGETS[target].formats[0].size;
    if (!EXPORT_TARGETS[target].formats.some(f => f.size.join('x') === size.join('x'))) throw new Error(`Unsupported size for ${target}.`);
  }
  const images = [];
  for (const target of set.targets) {
    const spec = EXPORT_TARGETS[target];
    let [deviceId] = existingStoreImage(project, target) ?? [];
    if (!deviceId) {
      deviceId = addDevice(project, { label: spec.label, short: spec.label, target, size: sizes[target] ?? spec.formats[0].size, layout: 'wide', frame: { type: 'plain' }, screenScope: 'store-image' });
    }
    let slide = project.slides.find(s => s.canvasIds?.includes(deviceId));
    if (!slide) {
      const id = uniqueId(project.slides.map(s => s.id), target);
      slide = { id, reviewId: makeId(), name: spec.label, theme: theme ?? project.slides[0].theme, canvasIds: [deviceId], layouts: { [deviceId]: { template: 'custom', panorama: false, independent: true, layers: [] } } };
      insertSlideAfter(project, slide, afterId ?? project.slides.at(-1).id);
    }
    afterId = slide.id;
    images.push({ deviceId, slideId: slide.id });
  }
  return images;
}
