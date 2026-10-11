import { resolveLayers } from './layouts.js';

export const safeCopyKey = key => typeof key === 'string' && key.length > 0 && !key.startsWith('_') && !['__proto__', 'prototype', 'constructor'].includes(key);

/** Includes empty text layers as well as stored copy that is used on another canvas. */
export function copyFields(project, copy, slide, localeId) {
  const keys = new Set(['headline']);
  for (const loc of ['en-US', localeId]) for (const key of Object.keys(copy[loc]?.[slide.id] ?? {})) if (safeCopyKey(key)) keys.add(key);
  for (const deviceId of Object.keys(project.devices)) {
    for (const layer of resolveLayers({ project, slide, deviceId, localeId }).layers) if (layer.type === 'text' && (!layer.copySlideId || layer.copySlideId === slide.id) && safeCopyKey(layer.field)) keys.add(layer.field);
  }
  const order = ['headline', 'caption', 'bullets'];
  return [...keys].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}
