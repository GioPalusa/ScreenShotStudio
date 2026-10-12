import { resolveLayers } from './layouts.js';

export const safeCopyKey = key => typeof key === 'string' && key.length > 0 && !key.startsWith('_') && !['__proto__', 'prototype', 'constructor'].includes(key);

/** Only fields referenced by text layers, including empty fields and cross-screen references. */
export function copyFields(project, copy, slide, localeId) {
  const keys = new Set();
  for (const owner of project.slides) for (const deviceId of Object.keys(project.devices ?? {})) {
    for (const layer of resolveLayers({ project, slide: owner, deviceId, localeId }).layers) if (layer.type === 'text' && (layer.copySlideId ?? owner.id) === slide.id && safeCopyKey(layer.field)) keys.add(layer.field);
  }
  const order = ['headline', 'caption', 'bullets'];
  return [...keys].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}
