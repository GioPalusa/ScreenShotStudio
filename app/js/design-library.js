// Original starter designs. Geometry is generated in the canvas's design space;
// stored layers remain ordinary, editable JSON, independent of the desktop host.
import { canvasMetrics, resolveLayers } from './layouts.js';
import { deviceForLayer } from './profiles.js';
import { frameScreenSize, frameOuterSize } from './frames.js';
import { slugify, uniqueId } from './layer-ops.js';

export const STARTER_DESIGNS = [
  { id: 'focus', name: 'Focus', description: 'A clear headline, a complete screen, room to breathe.' },
  { id: 'editorial', name: 'Editorial', description: 'Lead with the story. Side by side on wide canvases.' },
  { id: 'spotlight', name: 'Spotlight', description: 'A soft backdrop puts your screen in the spotlight.' },
];
export const STARTER_PALETTES = [
  { name: 'Midnight', bg: '#142039', ink: '#f5f7fb' },
  { name: 'Porcelain', bg: '#f2eee7', ink: '#243139' },
  { name: 'Mint', bg: '#dcefe5', ink: '#163c32' },
  { name: 'Orchid', bg: '#ede6f7', ink: '#38224d' },
];
const copy = value => structuredClone(value);
const SOURCE_KEYS = ['profile', 'capture', 'captureSet', 'frame', 'fit', 'align', 'radius', 'languageNeutral', 'allowUpscale'];
const sourceOf = layer => Object.fromEntries(SOURCE_KEYS.filter(key => layer?.[key] !== undefined).map(key => [key, copy(layer[key])]));

function deviceSource(project, slide, deviceId, frames) {
  const canvas = project.devices[deviceId];
  const old = resolveLayers({ project, slide, deviceId }).layers.find(l => l.type === 'device' && !l.hidden);
  const source = sourceOf(old);
  // Keep inherited capture choice at block level so locale-specific choices still work.
  if (old?._captureFrom === 'block') delete source.capture;
  const hardware = deviceForLayer(project, canvas, source);
  const frame = source.frame ?? hardware.frame ?? { type: 'plain' };
  const screen = frameScreenSize(frame, { frames, deviceSize: hardware.size }) ?? hardware.size;
  const size = frameOuterSize(frame, { frames, deviceSize: screen }) ?? screen;
  if (frame.type === 'plain') source.frame = { ...frame, screen };
  return { source, ratio: size[0] / size[1], oldId: old?.id };
}

function starterBlock(project, slide, deviceId, designId, frames, ink) {
  const { W, H } = canvasMetrics(project.devices[deviceId]);
  const { source, ratio, oldId } = deviceSource(project, slide, deviceId, frames);
  const unit = Math.min(W, H), margin = unit * 0.07;
  const text = (field, x, top, w, height, size, align = 'center') => ({
    id: field, type: 'text', field, x, capTop: top, w, boxHeight: height,
    size, minSize: size * 0.55, maxLines: field === 'headline' ? 3 : 4,
    weight: field === 'headline' ? 750 : 500, lineHeight: 1.15,
    align, block: align, anchor: 'top',
  });
  let area, headline, caption;
  if (designId === 'editorial' && W / H >= 1.2) {
    headline = text('headline', margin, H * 0.21, W * 0.37, H * 0.30, unit * 0.10, 'start');
    caption = text('caption', margin, H * 0.55, W * 0.37, H * 0.25, unit * 0.042, 'start');
    area = { x: W * 0.51, y: margin, w: W * 0.42, h: H - margin * 2 };
  } else if (designId === 'editorial') {
    headline = text('headline', margin, H * 0.055, W - margin * 2, H * 0.18, unit * 0.105, 'start');
    caption = text('caption', margin, H * 0.25, W - margin * 2, H * 0.12, unit * 0.044, 'start');
    area = { x: margin, y: H * 0.42, w: W - margin * 2, h: H * 0.52 };
  } else if (designId === 'spotlight') {
    area = { x: margin * 1.5, y: H * 0.065, w: W - margin * 3, h: H * 0.55 };
    headline = text('headline', margin, H * 0.68, W - margin * 2, H * 0.15, unit * 0.095);
    caption = text('caption', margin, H * 0.85, W - margin * 2, H * 0.10, unit * 0.04);
  } else {
    headline = text('headline', margin, H * 0.055, W - margin * 2, H * 0.17, unit * 0.105);
    area = { x: margin, y: H * 0.26, w: W - margin * 2, h: H * 0.53 };
    caption = text('caption', margin, H * 0.84, W - margin * 2, H * 0.11, unit * 0.043);
  }
  const w = Math.min(area.w, area.h * ratio), height = w / ratio;
  const device = { id: oldId ?? 'device', type: 'device', ...source, cx: area.x + area.w / 2, top: area.y + (area.h - height) / 2, w };
  // Reuse the previous device id so locale-specific screenshot choices still address it.
  if (['headline', 'caption', 'starter-backdrop'].includes(device.id)) device.id = 'device';
  const backdrop = { id: 'starter-backdrop', type: 'shape', shape: 'rect', cx: W / 2, cy: H * 0.34, w: W - margin * 1.2, h: H * 0.62, radius: unit * 0.05, fill: ink, opacity: 0.07, zOrder: 0 };
  const previous = resolveLayers({ project, slide, deviceId }).layout;
  return { template: 'custom', panorama: false, ...(previous.capture !== undefined ? { capture: previous.capture } : {}), layers: [...(designId === 'spotlight' ? [backdrop] : []), device, headline, caption] };
}

/** Non-mutating preview; exact canvas keys prevent edits leaking into a shared device family. */
export function previewStarterDesign(project, slide, { designId, deviceIds, palette = null, frames = {}, resetLocaleLayouts = false }) {
  if (!STARTER_DESIGNS.some(d => d.id === designId)) throw new Error('Choose a starter design.');
  if (!deviceIds?.length || deviceIds.some(id => !project.devices[id])) throw new Error('Choose valid canvases.');
  const next = copy(slide);
  next.layouts ??= {};
  const ink = palette?.ink ?? slide.colors?.ink ?? project.themes?.[slide.theme]?.ink ?? '#ffffff';
  for (const deviceId of new Set(deviceIds)) {
    if (next.layouts[deviceId]?.independent) continue;
    next.layouts[deviceId] = starterBlock(project, slide, deviceId, designId, frames, ink);
    if (resetLocaleLayouts) for (const variants of Object.values(next.localeLayouts ?? {})) {
      const variant = variants[deviceId];
      if (!variant || variant.independent) continue;
      // Reset geometry but retain localized screen choices, including per-layer sources.
      const device = next.layouts[deviceId].layers.find(l => l.type === 'device');
      const overrides = {};
      const patch = variant.overrides?.[device.id];
      if (patch && typeof patch === 'object') {
        const source = sourceOf(patch);
        if (Object.keys(source).length) overrides[device.id] = source;
      }
      variants[deviceId] = { ...(variant.capture !== undefined ? { capture: variant.capture } : {}), ...(Object.keys(overrides).length ? { overrides } : {}) };
    }
  }
  if (palette) next.colors = { bg: palette.bg, ink: palette.ink };
  return next;
}

/** Prepare every replacement before changing the document. The caller owns checkpoint/save. */
export function applyStarterDesign(project, { slideIds, ...options }) {
  const ids = new Set(slideIds);
  if (!ids.size || [...ids].some(id => !project.slides.some(s => s.id === id))) throw new Error('Choose valid slides.');
  const count = project.slides.filter(slide => ids.has(slide.id)).reduce((total, slide) => total + [...new Set(options.deviceIds)].filter(id => !slide.layouts?.[id]?.independent).length, 0);
  const slides = project.slides.map(slide => ids.has(slide.id) ? previewStarterDesign(project, slide, options) : slide);
  project.slides = slides;
  return count;
}

export function savePalette(project, name, colors) {
  if (!name?.trim() || ![colors.bg, colors.ink, ...(colors.swatches ?? [])].every(c => /^#[0-9a-f]{6}$/i.test(c))) throw new Error('Give the palette a name and valid colours.');
  const id = uniqueId(Object.keys(project.themes ?? {}), slugify(name, 'palette'));
  (project.themes ??= {})[id] = { name: name.trim(), bg: colors.bg, ink: colors.ink, ...(colors.swatches?.length ? { swatches: [...new Set(colors.swatches)] } : {}) };
  return id;
}

export function paletteColors(palette) {
  return [...new Set([palette?.bg, palette?.ink, ...(palette?.swatches ?? [])].filter(colour => /^#[0-9a-f]{6}$/i.test(colour)))];
}
