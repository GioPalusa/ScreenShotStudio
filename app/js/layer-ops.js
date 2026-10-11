// Editing operations on layouts, as plain functions over the project data.
//
// No DOM and no saving in here: the editor calls these, then saves and redraws. Everything mutates the
// data it is given and says what it did, so the logic can be tested from Node.
//
// Where an edit is written ("the block"):
//   - a slide's layout block for a device:  project.slides[i].layouts[<device id or class>]
//   - or, when editing a template, that template's block:  project.templates[id].layouts[...]
// A block is { template, overrides: { <layer id>: patch | false }, layers: [...], panorama?, capture?, use? }.
// A layer that lives in the block's own `layers` is edited in place; every other layer (from a built-in
// template, or from a project template the slide uses) is edited through `overrides[id]`.

import { layoutFor, layoutKey, expandBlock, resolveLayers, layerZ, paintOrder } from './layouts.js';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const stripPrivate = (layer) => Object.fromEntries(Object.entries(layer).filter(([k]) => !k.startsWith('_')));

export const slugify = (text, fallback = 'item') =>
  String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

export function uniqueId(taken, base) {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ---------------------------------------------------------------------------
// the block an edit goes to

/** The writable layout block for a slide on a device (created when missing), or the template's block in template mode. */
export function editBlock(project, slide, deviceId, templateId = null, localeId = null) {
  if (localeId && !templateId) return ((slide.localeLayouts ??= {})[localeId] ??= {})[deviceId] ??= { scope: 'locale' };
  const device = project.devices[deviceId];
  if (templateId) {
    const tpl = project.templates?.[templateId];
    if (!tpl) throw new Error(`Unknown template “${templateId}”`);
    tpl.layouts ??= {};
    return (tpl.layouts[layoutKey(tpl, deviceId, device)] ??= { template: 'text-top' });
  }
  slide.layouts ??= {};
  return (slide.layouts[layoutKey(slide, deviceId, device)] ??= { template: slide.template ?? 'text-top' });
}

/** The slide's (or template's) block for a device as it is: nothing is created. For code that only reads. */
export function peekBlock(project, slide, deviceId, templateId = null, localeId = null) {
  if (localeId && !templateId) return slide.localeLayouts?.[localeId]?.[deviceId] ?? {};
  const device = project.devices[deviceId];
  return templateId ? layoutFor(project.templates?.[templateId], deviceId, device) : layoutFor(slide, deviceId, device);
}

/**
 * The slide as it should be drawn while a template is being edited: the same slide, but its block for this device is the
 * template's block - with the slide's own choice of screen, so the preview shows what the slide shows.
 */
export function slideForTemplateEdit(project, slide, deviceId, templateId) {
  const own = peekBlock(project, slide, deviceId);
  const virtual = { ...peekBlock(project, slide, deviceId, templateId), ...(own.capture !== undefined ? { capture: own.capture } : {}) };
  return { ...slide, localeLayouts: undefined, layouts: { ...(slide.layouts ?? {}), [deviceId]: virtual } };
}

/** Which devices read the same block as this one (a class block is shared by every device of that class). */
export function devicesSharingBlock(project, slide, deviceId) {
  const key = layoutKey(slide, deviceId, project.devices[deviceId]);
  return Object.entries(project.devices).filter(([id, d]) => layoutKey(slide, id, d) === key).map(([id]) => id);
}

/** Give one device its own copy of the (shared) block, so edits stop affecting the other devices of its class. */
export function splitBlockForDevice(project, slide, deviceId) {
  const device = project.devices[deviceId];
  slide.layouts ??= {};
  if (slide.layouts[deviceId]) return slide.layouts[deviceId];
  slide.layouts[deviceId] = clone(slide.layouts[device.layout] ?? { template: slide.template ?? 'text-top' });
  return slide.layouts[deviceId];
}

/** Freeze the visible arrangement, including decorations, while keeping localized copy live. */
export function setLayoutIndependent(project, slide, deviceId, independent, localeId = null) {
  if (!project.devices[deviceId]) throw new Error('Unknown canvas.');
  const current = localeId ? slide.localeLayouts?.[localeId]?.[deviceId] : slide.layouts?.[deviceId];
  if (Boolean(current?.independent) === independent) return;
  if (!independent) {
    if (localeId) delete slide.localeLayouts[localeId][deviceId];
    else if (current.linkedLayout) slide.layouts[deviceId] = current.linkedLayout;
    else delete slide.layouts[deviceId];
    return;
  }
  const layers = resolveLayers({ project, slide, deviceId, localeId, includeShared: false }).layers.map(layer => ({
    ...clone(stripPrivate(layer)), ...(layer._origin === 'panorama' ? { panoramaLayer: true } : {}),
  }));
  const frozen = { template: 'custom', independent: true, panorama: false, layers };
  if (localeId) ((slide.localeLayouts ??= {})[localeId] ??= {})[deviceId] = { ...frozen, scope: 'locale' };
  else {
    if (current) frozen.linkedLayout = clone(current);
    (slide.layouts ??= {})[deviceId] = frozen;
  }
}

/** Frozen decorations belong to the snapshot; toggling them must not re-add live panorama layers. */
export function setDecorationsVisible(block, visible) {
  if (block.independent) {
    for (const layer of block.layers ?? []) if (layer.panoramaLayer) {
      if (visible) delete layer.hidden; else layer.hidden = true;
    }
  } else if (visible) delete block.panorama;
  else block.panorama = false;
}

// ---------------------------------------------------------------------------
// layer edits

function tidy(block, id) {
  if (block.overrides?.[id] && typeof block.overrides[id] === 'object' && !Object.keys(block.overrides[id]).length) delete block.overrides[id];
  if (block.overrides && !Object.keys(block.overrides).length) delete block.overrides;
}

/**
 * Change properties of a layer. `layer` is the resolved layer (its `_origin` says where it lives).
 * A value of `undefined` clears the property; `null` clears it even where a template supplies a value.
 */
export function patchLayer(block, layer, patch) {
  const own = layer._origin === 'slide' || layer.panoramaLayer ? block.layers?.find((l) => l.id === layer.id) : null;
  if (own) {
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === null) delete own[k]; else own[k] = v; }
    // an override for the same layer (left from before it joined this block: Detach, Update template...) would win over what was just written
    const old = block.overrides?.[layer.id];
    if (old && typeof old === 'object') { for (const k of Object.keys(patch)) delete old[k]; tidy(block, layer.id); }
    return;
  }
  block.overrides ??= {};
  if (block.overrides[layer.id] === false || typeof block.overrides[layer.id] !== 'object' || block.overrides[layer.id] === null) block.overrides[layer.id] = {};
  const target = block.overrides[layer.id];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) target[k] = v;
    else if ((block.use || block.scope === 'locale') && layer[k] !== undefined) target[k] = null; // the template supplies a value: say "none" explicitly, or it would show through again
    else delete target[k];
  }
  tidy(block, layer.id);
}

/** Add a layer on top of the stack. Returns the stored layer. */
export function addLayer(block, layer, resolved = []) {
  // also avoid the ids of layers switched off in this block: a stale `false` would remove the new layer too
  const taken = new Set([...resolved.map((l) => l.id), ...Object.keys(block.overrides ?? {})]);
  const id = uniqueId(taken, layer.id ?? layer.type);
  const top = resolved.reduce((m, l) => Math.max(m, layerZ(l)), 0);
  const stored = { ...stripPrivate(layer), id, zOrder: layer.zOrder ?? Math.floor(top) + 1 };
  (block.layers ??= []).push(stored);
  return stored;
}

/** Remove a layer: delete it when it is the block's own, otherwise switch it off with `overrides[id] = false`. */
export function removeLayer(block, layer) {
  const i = block.layers?.findIndex((l) => l.id === layer.id) ?? -1;
  if ((layer._origin === 'slide' || layer.panoramaLayer) && i >= 0) {
    block.layers.splice(i, 1);
    if (!block.layers.length) delete block.layers;
    if (block.overrides && block.overrides[layer.id] !== false) { delete block.overrides[layer.id]; tidy(block, layer.id); }
    return;
  }
  (block.overrides ??= {})[layer.id] = false;
}

/** Ids of layers that were switched off in this block (so they can be brought back). */
export const removedLayerIds = (block) => Object.entries(block.overrides ?? {}).filter(([, v]) => v === false).map(([id]) => id);

export function restoreLayer(block, id) {
  if (block.overrides?.[id] === false) { delete block.overrides[id]; tidy(block, id); }
}

/** A copy of a layer, nudged down and to the right, just above the original. Returns the stored copy. */
export function duplicateLayer(block, layer, resolved, { fields = [] } = {}) {
  const copy = stripPrivate(layer);
  if (layer._decorationBase) {
    copy.panoramaLayer = true;
    copy.decorationBox = { ...layer._box, x: layer._box.x + 48, y: layer._box.y + 48 };
  } else delete copy.panoramaOffset;
  const taken = new Set([...resolved.map((l) => l.id), ...Object.keys(block.overrides ?? {})]);
  copy.id = uniqueId(taken, `${layer.id.replace(/-\d+$/, '')}-copy`);
  if (copy.name) copy.name = `${copy.name} copy`;
  if (copy.type === 'text' && !['headline', 'caption', 'bullets'].includes(copy.field)) copy.field = uniqueId([...fields, ...resolved.map(l => l.field)], copy.id); // independent text, without overwriting another layout's field
  const nudge = layer._decorationBase ? 0 : 48;
  if (typeof copy.cx === 'number') copy.cx += nudge;
  if (typeof copy.cy === 'number') copy.cy += nudge;
  if (copy.type === 'device') copy.top = (typeof copy.top === 'number' ? copy.top : layer._top ?? layer._box?.y ?? 0) + nudge;
  if (copy.type === 'text' && (copy.anchor ?? 'top') === 'top') copy.capTop = (typeof copy.capTop === 'number' ? copy.capTop : layer._box?.y ?? 0) + nudge;
  if (typeof copy.baseline === 'number') copy.baseline += nudge;
  if (typeof copy.x === 'number' && copy.type === 'text') copy.x += nudge;
  copy.zOrder = layerZ(layer) + 0.01;
  copy.locked = undefined;
  const stored = JSON.parse(JSON.stringify(copy));
  (block.layers ??= []).push(stored);
  return stored;
}

/** Duplicate a selection and its localized text together, including all slides affected by a template edit. */
export function duplicateLayers(block, layers, resolved, copy, slideIds) {
  const all = [...resolved], added = [], changedLocales = new Set(), groups = new Map();
  const takenGroups = new Set(resolved.map(l => l.group).filter(Boolean));
  const fields = new Set(Object.values(copy).flatMap(doc => slideIds.flatMap(id => Object.keys(doc[id] ?? {}))));
  for (const layer of layers) {
    const stored = duplicateLayer(block, layer, all, { fields });
    if (layer.group) {
      if (!groups.has(layer.group)) {
        const group = uniqueId(takenGroups, `${layer.group}-copy`);
        groups.set(layer.group, group); takenGroups.add(group);
      }
      stored.group = groups.get(layer.group);
    }
    if (stored.type === 'text' && stored.field !== layer.field) {
      fields.add(stored.field);
      for (const [locale, doc] of Object.entries(copy)) for (const id of slideIds) {
        if (doc[id]?.[layer.field] === undefined) continue; // Keep English fallback rather than inventing a translation.
        doc[id][stored.field] = clone(doc[id][layer.field]);
        const pending = doc._meta?.needsReview;
        if (pending?.includes(`${id}.${layer.field}`)) doc._meta.needsReview = [...new Set([...pending, `${id}.${stored.field}`])];
        changedLocales.add(locale);
      }
    }
    all.push(stored); added.push(stored);
  }
  return { layers: added, changedLocales: [...changedLocales] };
}

// ---------------------------------------------------------------------------
// stacking order

/**
 * Move a layer to a position in the back-to-front order (0 = very back). Usually only the moved layer gets a new
 * `zOrder` (a value between its new neighbours); when its neighbours leave no room the layers around it are
 * renumbered. Decorations follow the same ordering as other layers. `resolved` are all layers of the scene.
 * Returns the ids whose zOrder changed.
 */
export function moveLayerTo(block, resolved, id, toIndex) {
  const ordered = paintOrder(resolved);
  const moving = ordered.find((l) => l.id === id);
  if (!moving || moving.locked) return [];
  const rest = ordered.filter((l) => l !== moving);
  const at = Math.max(0, Math.min(toIndex, rest.length));
  const below = rest[at - 1];
  const above = rest[at];

  let z = null;
  if (!below && !above) z = layerZ(moving);
  else if (!below) z = layerZ(above) - 1;
  else if (!above) z = layerZ(below) + 1;
  else if (layerZ(below) < layerZ(above)) z = Math.round(((layerZ(below) + layerZ(above)) / 2) * 1e6) / 1e6;
  if (z !== null && (z > layerZ(below ?? moving) || !below) && (z < layerZ(above ?? moving) || !above)) {
    if (Math.abs(z - layerZ(moving)) < 1e-9) return [];
    patchLayer(block, moving, { zOrder: z });
    return [id];
  }

  // No room between the neighbours: give every movable layer in the affected run a fresh value.
  const sequence = [...rest.slice(0, at), moving, ...rest.slice(at)];
  const fixed = (l) => Boolean(l.locked);
  const next = new Map();
  for (let i = 0; i < sequence.length;) {
    if (fixed(sequence[i])) { i++; continue; }
    let j = i;
    while (j < sequence.length && !fixed(sequence[j])) j++;
    const lo = i > 0 ? layerZ(sequence[i - 1]) : null;
    const hi = j < sequence.length ? layerZ(sequence[j]) : null;
    const count = j - i;
    for (let k = 0; k < count; k++) {
      let value;
      if (lo === null && hi === null) value = k;
      else if (lo === null) value = hi - (count - k);
      else if (hi === null) value = lo + (k + 1);
      else value = lo + ((k + 1) * (hi - lo)) / (count + 1);
      next.set(sequence[i + k], Math.round(value * 1e6) / 1e6);
    }
    i = j;
  }
  const changed = [];
  for (const [layer, value] of next) {
    if (Math.abs(value - layerZ(layer)) < 1e-9) continue;
    patchLayer(block, layer, { zOrder: value });
    changed.push(layer.id);
  }
  return changed;
}

/** Index of a layer in the back-to-front order. */
export const stackIndex = (resolved, id) => paintOrder(resolved).findIndex((l) => l.id === id);

/** Move a layer one step (+1 forward / -1 backward). Hidden layers are stepped over: passing something you cannot see would change nothing. */
export function stepLayer(block, resolved, id, delta) {
  const ordered = paintOrder(resolved);
  const index = ordered.findIndex((l) => l.id === id);
  if (index < 0) return [];
  const dir = Math.sign(delta) || 1;
  let steps = Math.abs(delta) || 1;
  let target = index;
  while (steps > 0 && target + dir >= 0 && target + dir < ordered.length) {
    target += dir;
    if (!ordered[target].hidden) steps--;
  }
  return moveLayerTo(block, resolved, id, target);
}

/** Put a layer directly behind / in front of another one (e.g. "behind the device"). */
export function placeRelativeTo(block, resolved, id, otherId, where = 'behind') {
  const ordered = paintOrder(resolved).filter((l) => l.id !== id);
  const otherIndex = ordered.findIndex((l) => l.id === otherId);
  if (otherIndex < 0) return [];
  return moveLayerTo(block, resolved, id, where === 'behind' ? otherIndex : otherIndex + 1);
}

// ---------------------------------------------------------------------------
// templates

/**
 * Patches that target layers living in `layers` are written into those layers, so each layer has one place where it is
 * edited (a leftover override would otherwise keep winning over later edits). Returns the layers and the overrides that remain.
 */
function foldOverrides(layers, overrides) {
  const rest = { ...(overrides ?? {}) };
  const out = [];
  for (const layer of layers) {
    const patch = rest[layer.id];
    if (patch === false) { delete rest[layer.id]; continue; } // switched off: gone
    const merged = { ...layer };
    if (patch && typeof patch === 'object') {
      for (const [k, v] of Object.entries(patch)) { if (v === null) delete merged[k]; else merged[k] = v; }
      delete rest[layer.id];
    }
    out.push(merged);
  }
  return { layers: out, overrides: rest };
}

/** A block as plain data: any `use` is expanded, tweaks are folded into the layers they belong to and private fields are dropped. */
export function flattenBlock(project, block, deviceId, device, { forTemplate = false, fallbackTemplate = 'text-top' } = {}) {
  const expanded = expandBlock(project, block ?? {}, deviceId, device);
  const { layers, overrides } = foldOverrides(expanded.layers ?? [], expanded.overrides);
  const out = { template: expanded.template ?? fallbackTemplate };
  if (Object.keys(overrides).length) out.overrides = clone(overrides);
  if (layers.length) {
    out.layers = layers.map((l) => {
      const layer = clone(stripPrivate(l));
      if (forTemplate) delete layer.capture; // which app screen a device shows belongs to the slide, not the template
      return layer;
    });
  }
  if (expanded.panorama === false) out.panorama = false;
  return out;
}

/**
 * Which app screen a slide shows stays with the slide when its layout changes. An explicit `null` ("no screenshot")
 * is dropped: it only meant "this layout has no device", and the new layout may well have one.
 */
export const keepCapture = (block) => (typeof block?.capture === 'string' ? { capture: block.capture } : {});

/** The layout keys (device id or class) a slide uses across all devices, each with one representative device. */
function blockKeys(project, slide) {
  const keys = new Map();
  for (const [deviceId, device] of Object.entries(project.devices)) {
    const key = layoutKey(slide, deviceId, device);
    if (!keys.has(key)) keys.set(key, { deviceId, device });
  }
  return keys;
}

/** Screens chosen for individual device layers (a second device on the slide), per layout key. They belong to the slide, not to a template. */
function layerCaptures(project, slide) {
  const found = {};
  for (const [key, { deviceId }] of blockKeys(project, slide)) {
    for (const layer of resolveLayers({ project, slide, deviceId, includeShared: false }).layers) {
      if (layer.type !== 'device') continue;
      const source = {};
      if (layer._captureFrom !== 'block' && typeof layer.capture === 'string') source.capture = layer.capture;
      if (typeof layer.captureSet === 'string') source.captureSet = layer.captureSet;
      if (Object.keys(source).length) (found[key] ??= {})[layer.id] = source;
    }
  }
  return found;
}

function restoreLayerCaptures(project, slide, found) {
  const keys = blockKeys(project, slide);
  for (const [key, caps] of Object.entries(found)) {
    const block = slide.layouts?.[key];
    if (!block?.use) continue;
    const { deviceId } = keys.get(key);
    const matching = new Set(resolveLayers({ project, slide, deviceId, includeShared: false }).layers.filter(l => l.type === 'device').map(l => l.id));
    for (const [id, source] of Object.entries(caps)) if (matching.has(id)) Object.assign(((block.overrides ??= {})[id] ??= {}), source);
  }
}

/** Slides (ids) whose layout follows a template. */
export function templateUsage(project, templateId) {
  return project.slides.filter((s) => Object.values(s.layouts ?? {}).some((b) => b?.use === templateId)).map((s) => s.id);
}

/**
 * Save a slide's layout (all devices) as a project template and make the slide follow it, so later
 * edits to the template reach every slide that uses it. Returns the template id.
 */
export function saveAsTemplate(project, slide, name) {
  project.templates ??= {};
  const id = uniqueId(Object.keys(project.templates), slugify(name, 'template'));
  const tpl = { name: name.trim() || id, layouts: {} };
  for (const [key, { deviceId, device }] of blockKeys(project, slide)) {
    tpl.layouts[key] = flattenBlock(project, layoutFor(slide, deviceId, device), deviceId, device, { forTemplate: true, fallbackTemplate: slide.template });
  }
  project.templates[id] = tpl;
  followTemplate(project, slide, id);
  return id;
}

/** Point a slide's blocks at a template, keeping which app screens the slide shows. Returns the layout keys that now follow it. */
export function followTemplate(project, slide, templateId, { deviceIds = null } = {}) {
  const tpl = project.templates[templateId];
  const captures = layerCaptures(project, slide);
  slide.layouts ??= {};
  const applied = [];
  for (const [key, { deviceId, device }] of blockKeys(project, slide)) {
    if (deviceIds && !deviceIds.some((d) => layoutKey(slide, d, project.devices[d]) === key)) continue;
    if (!Object.keys(layoutFor(tpl, deviceId, device)).length) continue; // the template has nothing for this device
    const current = slide.layouts[key];
    if (current?.independent) continue;
    slide.layouts[key] = { use: templateId, ...keepCapture(current) };
    applied.push(key);
  }
  restoreLayerCaptures(project, slide, Object.fromEntries(applied.map(key => [key, captures[key] ?? {}])));
  return applied;
}

/** Use one of the built-in templates for a slide (dropping its own tweaks). */
export function useBuiltinTemplate(project, slide, templateName, { deviceIds = null } = {}) {
  slide.layouts ??= {};
  for (const [key] of blockKeys(project, slide)) {
    if (deviceIds && !deviceIds.some((d) => layoutKey(slide, d, project.devices[d]) === key)) continue;
    const current = slide.layouts[key];
    if (current?.independent) continue;
    slide.layouts[key] = { template: templateName, ...keepCapture(current) };
  }
}

/**
 * Stop following a template: copy what it contributes into the slide, so the slide looks the same but is on its own.
 * With `templateId`, only the layouts that follow that template are detached.
 */
export function detachTemplate(project, slide, { templateId = null } = {}) {
  for (const [key, { deviceId, device }] of blockKeys(project, slide)) {
    const block = slide.layouts?.[key];
    if (!block?.use || (templateId && block.use !== templateId)) continue;
    const flat = flattenBlock(project, block, deviceId, device, { fallbackTemplate: slide.template });
    if (block.capture !== undefined) flat.capture = block.capture;
    slide.layouts[key] = flat;
  }
}

/** Replace a template's contents with this slide's current layout; the slide keeps following it. */
export function updateTemplateFromSlide(project, templateId, slide) {
  const tpl = project.templates[templateId];
  const captures = layerCaptures(project, slide);
  const layouts = {};
  for (const [key, { deviceId, device }] of blockKeys(project, slide)) {
    layouts[key] = flattenBlock(project, layoutFor(slide, deviceId, device), deviceId, device, { forTemplate: true, fallbackTemplate: slide.template });
  }
  tpl.layouts = layouts;
  followTemplate(project, slide, templateId);
  restoreLayerCaptures(project, slide, captures);
}

/** Delete a template; slides that followed it keep their look (they are detached first). */
export function deleteTemplate(project, templateId) {
  for (const slide of project.slides) {
    if (Object.values(slide.layouts ?? {}).some((b) => b?.use === templateId)) detachTemplate(project, slide, { templateId });
  }
  delete project.templates[templateId];
  if (!Object.keys(project.templates).length) delete project.templates;
}

export function renameTemplate(project, templateId, name) {
  project.templates[templateId].name = name.trim() || project.templates[templateId].name;
}

export function duplicateTemplate(project, templateId) {
  const src = project.templates[templateId];
  const id = uniqueId(Object.keys(project.templates), `${templateId}-copy`);
  project.templates[id] = { ...clone(src), name: `${src.name} copy` };
  return id;
}

/** Which template a slide follows on a device (id), or null. */
export function templateOf(project, slide, deviceId) {
  const block = layoutFor(slide, deviceId, project.devices[deviceId]);
  return block?.use && project.templates?.[block.use] ? block.use : null;
}

// ---------------------------------------------------------------------------
// copying a layer to the other devices

/** Scale a layer's geometry from one canvas to another (by relative position and width). */
export function scaleLayerGeometry(layer, from, to) {
  const out = clone(stripPrivate(layer));
  const kx = to.W / from.W;
  const ky = to.H / from.H;
  const k = kx;
  if (layer._decorationBase) {
    out.panoramaLayer = true;
    const b = layer._box;
    out.decorationBox = { ...b, x: b.x * kx, y: b.y * ky, w: b.w * k, h: b.h * k };
    return out; // the original affine/panorama transform remains the source coordinate system
  }
  for (const key of ['cx', 'x']) if (typeof out[key] === 'number') out[key] *= kx;
  for (const key of ['cy', 'top', 'capTop', 'baseline']) if (typeof out[key] === 'number') out[key] *= ky;
  for (const key of ['w', 'h', 'size', 'minSize', 'maxHeight', 'boxHeight']) if (typeof out[key] === 'number') out[key] *= k;
  return out;
}

/** Whether a layer is something the user created (an image, shape, extra device or text) as opposed to a template slot. */
export const isUserLayer = (layer) => layer._origin === 'slide' || layer._origin === 'template';

// ---------------------------------------------------------------------------
// names

export function layerLabel(layer, { captureLabel } = {}) {
  if (layer.name) return layer.name;
  switch (layer.type) {
    case 'text': return { headline: 'Headline', caption: 'Sub text', bullets: 'Bullet list' }[layer.field] ?? `Text “${layer.field}”`;
    case 'device': return captureLabel ? `Device · ${captureLabel}` : 'Device';
    case 'art': {
      if (layer.panoramaOffset !== undefined) return layer.id === 'globe' ? 'Globe' : `Decoration · ${layer.id}`;
      return String(layer.src ?? 'Image').replace(/-[0-9a-f]{6}(?=\.)/, '').replace(/^.*\//, '');
    }
    case 'shape': return layer.shape === 'ellipse' ? 'Ellipse' : 'Rectangle';
    case 'route': return 'Dashed route';
    default: return layer.id;
  }
}

// ---------------------------------------------------------------------------
// moving and sizing on the stage

/**
 * The properties that place a layer in a box { x, y, w, h, rot } (design pixels, rot in degrees about the
 * box centre). Used by dragging, resizing, the number fields and the arrow keys, so they all write the same data.
 * Text boxes only move and change width; their height follows the text.
 */
export function geometryPatch(layer, nb, { vertical = true } = {}) {
  if (layer._decorationBase) return { decorationBox: { x: nb.x, y: nb.y, w: nb.w, h: nb.h, rot: nb.rot ?? 0 } };
  const r = (v) => Math.round(v * 10) / 10;
  const cx = nb.x + nb.w / 2;
  const cy = nb.y + nb.h / 2;
  const rotate = nb.rot ? r(nb.rot) : undefined; // undefined removes the property
  switch (layer.type) {
    case 'device':
      return { cx: r(cx), top: r(nb.y), w: r(nb.w), rotate };
    case 'art': {
      const natural = layer._natural ?? layer.aspect;
      const free = natural && Math.abs(nb.w / nb.h - natural) / natural > 0.003;
      return { cx: r(cx), cy: r(cy), w: r(nb.w), h: free ? r(nb.h) : undefined, rotate };
    }
    case 'shape':
      return { cx: r(cx), cy: r(cy), w: r(nb.w), h: r(nb.h), rotate };
    case 'text': {
      const patch = {};
      if (Math.abs((nb.rot ?? 0) - (layer.rotate ?? 0)) > 0.05) patch.rotate = nb.rot;
      if (layer._box && Math.abs(nb.h - layer._box.h) > 0.05) patch.boxHeight = nb.h;
      if (Math.abs(nb.x - layer.x) > 0.05) patch.x = r(nb.x);
      if (Math.abs(nb.w - layer.w) > 0.05) patch.w = r(nb.w);
      if (vertical) {
        if ((layer.anchor ?? 'top') === 'bottom') patch.baseline = r(nb.y + nb.h);
        else patch.capTop = r(nb.y);
      }
      return patch;
    }
    default:
      return {};
  }
}

/** Turn the selected capture into an unframed store screenshot, retaining its source and ID. */
export function fitStoreScreenshot(block, layers, layer, { W, H, size }) {
  for (const other of layers) if (other.id !== layer.id) removeLayer(block, other);
  block.panorama = false;
  patchLayer(block, layer, { frame: { type: 'plain', screen: [...size], radius: 0 }, radius: 0,
    cx: W / 2, top: 0, w: W, rotate: 0, opacity: 1, shadow: false, fit: 'fill', below: undefined, gap: undefined });
}
