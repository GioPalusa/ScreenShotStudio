// Portable object snapshots and ownership changes. No DOM, clipboard or filesystem access.
import { addLayer, removeLayer, geometryPatch, uniqueId, slugify } from './layer-ops.js';
import { offsetLayer } from './shared-canvas.js';

const clone = value => JSON.parse(JSON.stringify(value));
const clean = layer => Object.fromEntries(Object.entries(layer).filter(([key]) => !key.startsWith('_')));
export const LAYER_CLIPBOARD_MIME = 'application/x-screenshot-studio-layers+json';
const FORMAT = 'Screenshot Studio objects';

/** The view supplies the default; an explicit containment choice survives view changes. */
export const screenScopeFor = (layer, allScreens) => Boolean(layer._sharedId) || Boolean(allScreens && layer.screenScope !== 'local');

/** Local objects keep their owner. Shared objects can be contained on the screen nearest their centre. */
export function screenTileForLayer(tiles, layer) {
  const owner = tiles.find(tile => tile.slide.id === layer._sourceSlideId);
  if (owner) return owner;
  const x = layer._box ? layer._box.x + layer._box.w / 2 : layer.cx ?? layer.x ?? 0;
  return tiles.reduce((best, tile) => !best || Math.abs(tile.x + tile.W / 2 - x) < Math.abs(best.x + best.W / 2 - x) ? tile : best, null);
}

/** Freeze flow positions and inherited appearance before changing the object's canvas. */
export function snapshotLayer(layer, { frame, captureSet, color } = {}) {
  const frozen = { ...clean(layer), ...(layer._box ? geometryPatch(layer, layer._box) : {}) };
  if (layer.type === 'text') {
    frozen.x = layer._box?.x ?? layer.x;
    frozen.color ??= color;
    if ((layer.anchor ?? 'top') === 'top') frozen.capTop = layer._box?.y ?? layer.capTop;
  }
  if (layer.type === 'device') { frozen.frame ??= frame; frozen.captureSet ??= captureSet; }
  if (layer._decorationBase) frozen.panoramaLayer = true;
  delete frozen.seriesLayer;
  return clone(frozen);
}

/** Move, rather than duplicate: suppress inherited layers and remove owned layers. */
export function transferLayer({ sourceBlock, sourceLayer, targetBlock, snapshot, dx = 0, copySlideId, localeId, resolved = [] }) {
  const next = offsetLayer(snapshot, dx);
  next.id = uniqueId((targetBlock.layers ?? []).map(l => l.id), slugify(sourceLayer.id, next.type));
  if (next.type === 'text') next.copySlideId = next.copySlideId ?? copySlideId;
  if (localeId) next.localeId = localeId; else delete next.localeId;
  removeLayer(sourceBlock, sourceLayer);
  if (sourceLayer._sharedId) sourceBlock.layers ??= [];
  return addLayer(targetBlock, next, [...resolved, ...(targetBlock.layers ?? [])]);
}

/** Older connected designs store one fragment per screen; sharing replaces the whole linked object. */
export function removeConnectedFragments(project, slide, deviceId, layer, localeId) {
  const removed = [];
  if (!slide.series || !layer.seriesLayer || slide.layouts?.[deviceId]?.independent || localeId) return removed;
  for (const other of project.slides) {
    if (other === slide || other.series?.id !== slide.series.id) continue;
    const block = other.layouts?.[deviceId];
    if (!block || block.independent) continue;
    const fragment = block.layers?.find(l => l.id === layer.id && l.seriesLayer);
    if (fragment) { removeLayer(block, { ...fragment, _origin: 'slide' }); removed.push(other.id); }
  }
  return removed;
}

/** A contained text layer must not depend on a different screen continuing to exist. */
export function containTextSource(layer, copy, slideId) {
  if (layer.type !== 'text' || !layer.copySlideId) return [];
  const sourceId = layer.copySlideId, sourceField = layer.field;
  delete layer.copySlideId;
  if (sourceId === slideId) return [];
  layer.field = uniqueId(Object.values(copy).flatMap(doc => Object.keys(doc[slideId] ?? {})), `${slugify(layer.id)}-text`);
  const changed = [];
  for (const [locale, doc] of Object.entries(copy)) {
    if (doc[sourceId]?.[sourceField] === undefined) continue;
    (doc[slideId] ??= {})[layer.field] = clone(doc[sourceId][sourceField]);
    if (doc._meta?.needsReview?.includes(`${sourceId}.${sourceField}`)) doc._meta.needsReview.push(`${slideId}.${layer.field}`);
    changed.push(locale);
  }
  return changed;
}

export function encodeLayerClipboard(entries, { projectId, allScreens, originX = 0 }) {
  return JSON.stringify({ format: FORMAT, version: 1, projectId, allScreens, originX, entries });
}
export function decodeLayerClipboard(text) {
  if (!text || text.length > 8_000_000) return null;
  try {
    const data = JSON.parse(text, (key, value) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key) || key.startsWith('_')) throw Error('Invalid key');
      return value;
    });
    if (data.format !== FORMAT || data.version !== 1 || typeof data.projectId !== 'string' ||
        typeof data.allScreens !== 'boolean' || !Number.isFinite(data.originX) ||
        !Array.isArray(data.entries) || !data.entries.length || data.entries.length > 500) return null;
    const types = ['text', 'art', 'device', 'shape', 'route'];
    if (!data.entries.every(e => e?.layer && types.includes(e.layer.type) && typeof e.layer.id === 'string' &&
        (!e.text || Object.values(e.text).every(t => t && (typeof t.value === 'string' || Array.isArray(t.value) && t.value.every(v => typeof v === 'string')))))) return null;
    return data;
  } catch { return null; }
}

/** Every paste gets new IDs, groups and independent localized text fields. */
export function pasteLayerClipboard(data, { block, resolved, copy, slideIds, shared, dx = 0, dy = 24 }) {
  const layers = [], changedLocales = new Set(), groups = new Map();
  const taken = new Set([...resolved.map(l => l.id), ...(block.layers ?? []).map(l => l.id), ...Object.keys(block.overrides ?? {})]);
  const groupIds = new Set([...resolved, ...(block.layers ?? [])].map(l => l.group).filter(Boolean));
  const fields = new Set(Object.values(copy).flatMap(doc => slideIds.flatMap(id => Object.keys(doc[id] ?? {}))));
  for (const entry of data.entries) {
    const layer = offsetLayer(clone(entry.layer), dx);
    layer.id = uniqueId(taken, `${slugify(layer.id, layer.type)}-copy`); taken.add(layer.id);
    if (layer.name) layer.name += ' copy';
    for (const key of ['cy', 'top', 'capTop', 'baseline']) if (Number.isFinite(layer[key])) layer[key] += dy;
    if (layer.decorationBox) layer.decorationBox.y += dy;
    delete layer.locked; delete layer.localeId; delete layer.copySlideId; delete layer.zOrder; delete layer.screenScope;
    if (layer.group) {
      if (!groups.has(layer.group)) { const group = uniqueId(groupIds, `${slugify(layer.group)}-copy`); groups.set(layer.group, group); groupIds.add(group); }
      layer.group = groups.get(layer.group);
    }
    if (layer.type === 'text') {
      layer.field = uniqueId(fields, layer.id); fields.add(layer.field);
      if (shared) layer.copySlideId = slideIds[0];
      for (const [locale, doc] of Object.entries(copy)) {
        const text = entry.text?.[locale]; if (!text) continue;
        for (const id of slideIds) {
          (doc[id] ??= {})[layer.field] = clone(text.value);
          if (text.needsReview) {
            doc._meta ??= {}; doc._meta.status = 'draft';
            doc._meta.needsReview = [...new Set([...(doc._meta.needsReview ?? []), `${id}.${layer.field}`])];
          }
        }
        changedLocales.add(locale);
      }
    }
    layers.push(addLayer(block, layer, [...resolved, ...layers]));
  }
  return { layers, changedLocales: [...changedLocales] };
}
