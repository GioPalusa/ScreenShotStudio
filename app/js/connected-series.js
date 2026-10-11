// One design space with real gaps between export tiles. The gap is omitted from the PNGs,
// so a frame continues at the right angle when the store puts space between the images.
import { canvasMetrics } from './layouts.js';
import { compositionHardware } from './device-compositions.js';
import { PLAY_TARGETS } from './google-play.js';
import { uniqueId, slugify, patchLayer } from './layer-ops.js';
import { storyTemplate, storyGeometry } from './story-templates.js';

export const SERIES_GAP = .06;
export const CONNECTED_DESIGNS = [
  { id: 'bridge', name: 'Bridge', note: 'Upright frames and a flowing backdrop' },
  { id: 'ribbon', name: 'Ribbon', note: 'Leaning devices on a sweeping ribbon' },
  { id: 'rise', name: 'Rise', note: 'A rising sequence of screens and colour' },
  { id: 'orbit', name: 'Orbit', note: 'Alternating angles with oversized circles' },
  { id: 'horizon', name: 'Horizon', note: 'Horizontal frames across a calm band' },
  { id: 'wave', name: 'Wave', note: 'A playful rhythm of devices and curves' },
];
export const connectedDesign = id => {
  const design = CONNECTED_DESIGNS.find(d => d.id === id) ?? storyTemplate(id);
  if (!design) throw new Error('Choose a connected design.');
  return design;
};
const bounds = b => {
  const angle = (b.rotate ?? 0) * Math.PI / 180;
  const w = Math.abs(b.w * Math.cos(angle)) + Math.abs(b.h * Math.sin(angle));
  const h = Math.abs(b.w * Math.sin(angle)) + Math.abs(b.h * Math.cos(angle));
  return { left: b.cx - w / 2, right: b.cx + w / 2, top: b.cy - h / 2, bottom: b.cy + h / 2 };
};

/** Pure, shared geometry for the gallery and the editable document. gap is a fraction of tile width. */
export function connectedGeometry({ designId, count, W, H, ratio, gap = SERIES_GAP, palette = {}, includeText = true }) {
  connectedDesign(designId);
  if (!Number.isInteger(count) || count < (storyTemplate(designId) ? 1 : 2) || count > 5) throw new Error('Choose one to five screens for templates, or two to five for connected layouts.');
  if (![W, H, ratio].every(n => Number.isFinite(n) && n > 0) || !Number.isFinite(gap) || gap < .02 || gap > .16) throw new Error('Invalid series dimensions or gap.');
  if (storyTemplate(designId)) return storyGeometry({ designId, count, W, H, ratio, gap, includeText, palette: Object.keys(palette).length ? palette : undefined });
  const pitch = W * (1 + gap), total = W * count + W * gap * (count - 1);
  const offsets = Array.from({ length: count }, (_, i) => i * pitch);
  const accent = palette.swatches?.find(c => c !== palette.bg && c !== palette.ink) ?? palette.ink ?? '#243139';
  const shapes = [], devices = [];
  const shape = (id, cx, cy, w, h, extra = {}) => shapes.push({ id, type: 'shape', shape: 'ellipse', cx, cy, w, h, fill: accent, opacity: .13, allowCrop: true, ...extra });
  const pose = (id, cx, y, height, rotate, captureIndex) => {
    const angle = rotate * Math.PI / 180;
    const h = Math.min(H * height, W * 1.26 / (Math.abs(ratio * Math.cos(angle)) + Math.abs(Math.sin(angle))), H * .86 / (Math.abs(ratio * Math.sin(angle)) + Math.abs(Math.cos(angle))));
    const b = { id, cx, cy: H * y, w: h * ratio, h, rotate, captureIndex };
    const extent = bounds(b), half = (extent.bottom - extent.top) / 2;
    b.cy = Math.min(H - half - H * .04, Math.max(half + H * .04, b.cy));
    devices.push(b);
  };
  if (designId === 'bridge') shape('backdrop', total / 2, H * .70, total * 1.12, H * .98);
  if (designId === 'ribbon') shape('ribbon', total / 2, H * .63, total * 1.2, H * .31, { shape: 'rect', rotate: -7, radius: H * .15, opacity: .19 });
  if (designId === 'rise') shape('slope', total / 2, H * .72, total * 1.5, H * .55, { shape: 'rect', rotate: -Math.atan2(H * .33, total) * 180 / Math.PI, opacity: .18 });
  if (designId === 'horizon') shape('band', total / 2, H * .55, total * 1.1, H * .44, { shape: 'rect', opacity: .12 });
  for (let i = 0; i < count - 1; i++) {
    const seam = offsets[i] + W + W * gap / 2, t = count === 2 ? .5 : i / (count - 2);
    const y = designId === 'rise' ? .70 - .34 * t : designId === 'wave' ? (i % 2 ? .40 : .65) : designId === 'orbit' ? (i % 2 ? .42 : .61) : .56;
    const rotate = designId === 'ribbon' ? -14 : designId === 'rise' ? -9 : designId === 'orbit' ? (i % 2 ? 14 : -14) : designId === 'horizon' ? 90 : designId === 'wave' ? (i % 2 ? -20 : 20) : 0;
    if (designId === 'orbit') shape(`orbit-${i}`, seam, H * y, W * 1.48, H * .75, { opacity: i % 2 ? .08 : .17 });
    if (designId === 'wave') shape(`wave-${i}`, seam, H * (i % 2 ? .80 : .25), W * 2.2, H * .65, { opacity: .14 });
    pose(`bridge-${i + 1}`, seam, y, designId === 'horizon' ? .78 : .72, rotate, i);
  }
  // End caps carry the first and final capture; all seams retain a large split device.
  pose('start', W * .29, designId === 'rise' ? .39 : .28, .34, designId === 'ribbon' ? -14 : -6, 0);
  pose('end', offsets.at(-1) + W * .71, designId === 'rise' ? .72 : .78, .34, designId === 'ribbon' ? -14 : 6, count - 1);
  return { W, H, gap, pitch, total, offsets, shapes, devices };
}

/** Additive only: existing slides, copy, assets and panorama are never touched. */
export function newConnectedSeries(project, options, makeId) {
  const design = connectedDesign(options.designId), count = options.count;
  if (!options.palette && design.palette) options = { ...options, palette: design.palette };
  if (!Number.isInteger(count) || count < (storyTemplate(options.designId) ? 1 : 2) || count > 5) throw new Error('Choose one to five screens for templates, or two to five for connected layouts.');
  const gap = options.gap ?? SERIES_GAP;
  if (!Number.isFinite(gap) || gap < .02 || gap > .16) throw new Error('Invalid series gap.');
  const seriesId = makeId();
  const taken = new Set(project.slides.map(s => s.id));
  const slides = Array.from({ length: count }, (_, i) => {
    const id = uniqueId(taken, slugify(`${design.name}-${i + 1}`, 'series')); taken.add(id);
    return { id, reviewId: makeId(), name: count === 1 ? design.name : `${design.name} · ${i + 1}/${count}`, theme: options.theme ?? Object.keys(project.themes ?? {})[0], capture: null,
      ...(options.palette ? { colors: { bg: options.palette.bg, ink: options.palette.ink } } : {}),
      series: { id: seriesId, designId: design.id, index: i, count, ...(options.includeText === false ? { includeText: false } : {}), gap: options.gap ?? SERIES_GAP }, layouts: {} };
  });
  for (const [deviceId, canvas] of Object.entries(project.devices)) {
    const { W, H } = canvasMetrics(canvas), { ratio, profile } = compositionHardware(project, options.profileId, options.frames, deviceId);
    const geometry = connectedGeometry({ ...options, W, H, ratio });
    for (const [i, slide] of slides.entries()) {
      const offset = geometry.offsets[i], capture = options.captures?.[i];
      if (geometry.panels) { slide.colors = { ...geometry.panels[i].colors }; slide.series.role = geometry.panels[i].role; }
      if (PLAY_TARGETS[canvas.target]?.raw) {
        slide.layouts[deviceId] = { template: 'custom', panorama: false, layers: [{ id: 'device', type: 'device', capture: capture?.name ?? null,
          frame: { type: 'plain', screen: [...canvas.size], radius: 0 }, radius: 0, cx: W / 2, top: 0, w: W }] };
        continue;
      }
      const localShapes = list => list.filter(s => s.tile == null || s.tile === i).map(({ tile, ...s }) => ({ ...s, cx: s.cx - offset, ...(tile == null ? { seriesLayer: true } : {}) }));
      const layers = localShapes(geometry.shapes);
      for (const b of geometry.devices) {
        if ((b.tile != null && b.tile !== i) || (b.tiles && !b.tiles.includes(i))) continue;
        const extent = bounds(b);
        if (extent.right <= offset || extent.left >= offset + W) continue;
        const item = options.captures?.[b.captureIndex];
        // Match canvas uses corresponding capture collections on the other output formats.
        const set = item?.set && (options.profileId || item.set !== project.devices[options.sourceDeviceId]?.capture) ? item.set : undefined;
        layers.push({ id: b.id, type: 'device', name: `${profile.label} · ${b.captureIndex + 1}`, ...(b.tile == null ? { seriesLayer: true } : {}),
          capture: item?.name ?? null, ...(set ? { captureSet: set } : {}), ...(options.profileId ? { profile: options.profileId } : {}),
          ...(profile.frame?.type === 'plain' ? { frame: { ...profile.frame, screen: [...profile.screen] } } : {}),
          cx: b.cx - offset, top: b.cy - b.h / 2, w: b.w, rotate: b.rotate, ...(b.shadow ? { shadow: { ...b.shadow } } : {}), allowCrop: true });
      }
      layers.push(...localShapes(geometry.foregroundShapes ?? []));
      for (const { tile, ...text } of geometry.texts ?? []) if (tile === i) layers.push(text);
      slide.layouts[deviceId] = { template: 'custom', panorama: false, layers };
    }
  }
  return slides;
}

/** Keep the fragments of a shared layer aligned while editing. Unique designs opt out. */
export function patchConnectedLayer(project, slide, deviceId, layer, patch, localeId = null) {
  if (!slide.series || !layer.seriesLayer || slide.layouts?.[deviceId]?.independent || localeId) return;
  const { W } = canvasMetrics(project.devices[deviceId]);
  for (const other of project.slides) {
    if (other === slide || other.series?.id !== slide.series.id) continue;
    const block = other.layouts?.[deviceId];
    if (!block || block.independent) continue;
    const fragment = block.layers?.find(l => l.id === layer.id && l.seriesLayer);
    if (!fragment) continue;
    const next = { ...patch };
    if (Number.isFinite(next.cx)) next.cx += (slide.series.index - other.series.index) * W * (1 + slide.series.gap);
    patchLayer(block, { ...fragment, _origin: 'slide' }, next);
  }
}
