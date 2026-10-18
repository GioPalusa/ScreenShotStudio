// Shared objects have one owner, in row coordinates. All-screens edits can transfer local objects here.
import { canvasForSlide } from './canvas-orientation.js';
import { EXPORT_TARGETS, exportTarget } from './export-targets.js';
import { orderedSlides } from './slide-order.js';

// Studio preview allowances, not store specifications. Store layouts vary by viewing context.
export const SCREEN_SPACING_PRESETS = [
  { id: 'app-store', label: 'App Store', gap: .06 },
  { id: 'google-play', label: 'Google Play', gap: .04 },
];
export const SHARED_GAP = SCREEN_SPACING_PRESETS[0].gap;
function defaultSpacing(project, deviceId) {
  const preset = SCREEN_SPACING_PRESETS[EXPORT_TARGETS[exportTarget(project.devices[deviceId])]?.store === 'google-play' ? 1 : 0];
  return { gap: preset.gap, gapPreset: preset.id, layers: [] };
}
export const sharedLayerId = id => `shared:${id}`;
export function sharedBlock(project, deviceId, create = false) {
  if (create) { project.sharedCanvas ??= {}; project.sharedCanvas[deviceId] ??= defaultSpacing(project, deviceId); }
  return project.sharedCanvas?.[deviceId] ?? defaultSpacing(project, deviceId);
}

export function sharedSpacing(project, deviceId) {
  const block = sharedBlock(project, deviceId), gap = block.gap ?? SHARED_GAP;
  const matching = SCREEN_SPACING_PRESETS.find(p => p.gap === gap);
  return { gap, preset: block.gapPreset === 'custom' ? 'custom' : matching?.id ?? 'custom' };
}

export function setSharedSpacing(project, deviceId, preset, customGap) {
  const gap = preset === 'custom' ? customGap : SCREEN_SPACING_PRESETS.find(p => p.id === preset)?.gap;
  if (!Number.isFinite(gap) || gap < 0 || gap > 1) return false;
  Object.assign(sharedBlock(project, deviceId, true), { gap, gapPreset: preset });
  return true;
}

export function sharedGeometry(project, deviceId, localeId) {
  const base = project.devices[deviceId], k = base.size[0] / (base.designSize?.[0] ?? base.size[0]);
  const slides = orderedSlides(project, localeId, deviceId);
  const gap = (base.designSize?.[0] ?? base.size[0]) * (sharedBlock(project, deviceId).gap ?? SHARED_GAP);
  let x = 0;
  const tiles = slides.map(slide => {
    const device = canvasForSlide(project, slide, deviceId), W = device.size[0] / k, H = device.size[1] / k;
    const tile = { slide, x, W, H }; x += W + gap; return tile;
  });
  return { tiles, W: Math.max(1, x - gap), H: Math.max(...tiles.map(t => t.H)), k, gap };
}

/** Translate geometry without changing dimensions, flow references or the stored source. */
export function offsetLayer(layer, dx) {
  const out = { ...layer };
  for (const key of ['cx', 'x']) if (Number.isFinite(out[key])) out[key] += dx;
  if (out.decorationBox) out.decorationBox = { ...out.decorationBox, x: out.decorationBox.x + dx };
  if (out._box) out._box = { ...out._box, x: out._box.x + dx };
  return out;
}

export function sharedLayers(project, deviceId, localeId, slideId = null) {
  const tile = slideId ? sharedGeometry(project, deviceId, localeId).tiles.find(t => t.slide.id === slideId) : null;
  if (slideId && !tile) return [];
  return (sharedBlock(project, deviceId).layers ?? []).filter(layer => !layer.localeId || layer.localeId === localeId).map(layer => ({
    ...offsetLayer(layer, -(tile?.x ?? 0)), id: sharedLayerId(layer.id),
    _origin: 'shared', _sharedId: layer.id, _offsetX: -(tile?.x ?? 0), allowCrop: true,
  }));
}

/** Both single-screen and all-screen edits arrive in displayed coordinates. */
export function patchSharedLayer(project, deviceId, layer, patch) {
  const source = sharedBlock(project, deviceId).layers?.find(l => l.id === layer._sharedId);
  if (!source) return false;
  const local = offsetLayer(patch, -(layer._offsetX ?? 0));
  for (const [key, value] of Object.entries(local)) {
    if (key.startsWith('_') || key === 'id') continue;
    if (value == null) delete source[key]; else source[key] = value;
  }
  return true;
}

export function boxIntersects(box, W, H) {
  if (!box) return true; // Missing assets still need a useful warning.
  const a = (box.rot ?? 0) * Math.PI / 180;
  const w = Math.abs(box.w * Math.cos(a)) + Math.abs(box.h * Math.sin(a));
  const h = Math.abs(box.w * Math.sin(a)) + Math.abs(box.h * Math.cos(a));
  const x = box.x + box.w / 2, y = box.y + box.h / 2;
  return x + w / 2 > 0 && x - w / 2 < W && y + h / 2 > 0 && y - h / 2 < H;
}
