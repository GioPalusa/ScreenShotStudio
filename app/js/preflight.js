import { canvasForSlide } from './canvas-orientation.js';
import { slideSupportsCanvas } from './slide-order.js';
import { PLAY_TARGETS, playSelectionIssues } from './google-play.js';
import { deviceForLayer } from './profiles.js';
import { copyNeedsReview, localeNeedsReview } from './copy-review.js';
import { EXPORT_TARGETS, acceptedFormat, canvasIssues, exportTarget } from './export-targets.js';

export const WATCH_SIZES = EXPORT_TARGETS.watch.formats.map(f => f.size);

export function sceneHasContent(scene) {
  return scene.layers.some(l => l.type !== 'route' && l._origin !== 'panorama' && l._box && (l.type !== 'text' || l._layout) && (l.opacity ?? 1) > 0);
}

export function preflightScene(scene, bundle, { fontAvailable = () => true, checkCanvas = true } = {}) {
  const warnings = [...scene.warnings.filter(w => w.level !== 'info')];
  const add = (code, message, layer) => warnings.push({ code, message, level: 'warn', ...(layer ? { layer: layer.id } : {}) });
  const { slide, layers, deviceDef, localeId, slideId } = scene;
  const textLayers = layers.filter(l => l.type === 'text' && l._layout);
  if (textLayers.length && textLayers.some(l => (bundle.studio ? localeNeedsReview(bundle.studio, bundle.copy, localeId, l.copySlideId ?? slideId, l.field) : copyNeedsReview(bundle.copy[localeId], l.copySlideId ?? slideId, l.field)))) add('copy-review', 'Text is awaiting language review.');
  if (!sceneHasContent(scene) && !slide.exportChecks?.allowEmpty) add('empty', 'This canvas has no visible content.');
  for (const layer of layers) {
    if (layer.type === 'text' && !layer._layout) add('empty-text', `Text field “${layer.field}” is empty.`, layer);
    const box = layer._box;
    if (!box || layer._origin === 'panorama' || layer.type === 'route') continue;
    const angle = (box.rot ?? 0) * Math.PI / 180;
    const rw = Math.abs(box.w * Math.cos(angle)) + Math.abs(box.h * Math.sin(angle));
    const rh = Math.abs(box.w * Math.sin(angle)) + Math.abs(box.h * Math.cos(angle));
    const x = box.x + box.w / 2 - rw / 2, y = box.y + box.h / 2 - rh / 2;
    if (!layer.allowCrop && (x < -1 || y < -1 || x + rw > scene.W + 1 || y + rh > scene.H + 1)) add('outside-canvas', 'Layer extends outside the canvas. Confirm intentional cropping in Layers.', layer);
    if (layer.type === 'text') {
      if (!fontAvailable(layer.fontFamily || scene.fonts.family)) add('font-missing', `Font unavailable: ${layer.fontFamily || scene.fonts.family}`, layer);
    }
    const capture = scene.assets?.captures?.[layer.id];
    const img = layer.type === 'art' ? scene.assets?.art?.[layer.id] : capture?.image;
    const xScale = img ? (layer._screenDrawn?.w ?? box.w) * scene.k / img.naturalWidth : 0;
    const yScale = img ? (layer._screenDrawn?.h ?? box.h) * scene.k / img.naturalHeight : 0;
    const scale = layer.fit === 'contain' ? Math.min(xScale, yScale) : Math.max(xScale, yScale);
    if (img && !layer.allowUpscale && scale > 1.1) add('upscaled-image', 'Image is enlarged more than 10%. Use a larger source or confirm enlargement in Layers.', layer);
  }
  const play = PLAY_TARGETS[exportTarget(deviceDef)];
  if (play?.rule === 'large' && textLayers.length) add('play-added-text', 'Google Play large-screen screenshots should show the app without added text. Remove text layers for this export target.');
  if (play?.raw) {
    const visible = layers.filter(l => !l.hidden && (l.opacity ?? 1) > 0);
    const layer = visible[0], box = layer?._box;
    const ref = layer?.frame ?? deviceForLayer(bundle.studio ?? {}, deviceDef, layer ?? {}, bundle.frames ?? {}).frame ?? { type: 'plain' };
    const radii = layer?._radii ?? [layer?.radius ?? ref.radius ?? 1];
    const raw = visible.length === 1 && layer.type === 'device' && ref.type === 'plain' && box &&
      Math.abs(box.x) < .01 && Math.abs(box.y) < .01 && Math.abs(box.w - scene.W) < .01 && Math.abs(box.h - scene.H) < .01 &&
      !(box.rot ?? 0) && (layer.opacity ?? 1) === 1 && !layer.shadow && (Array.isArray(radii) ? radii : [radii]).every(r => r === 0);
    if (!raw) add('play-raw-screenshot', `Google Play ${play.label} needs one full-canvas screenshot with no frame, masking, rotation or additional layers. Use Screenshot → Fit to store canvas.`);
    const image = scene.assets?.captures?.[layer?.id]?.image;
    if (raw && image && Math.abs(image.naturalWidth / image.naturalHeight - scene.W / scene.H) > .001) add('play-raw-aspect', 'The source screenshot must have the same proportions as the store canvas.');
  }
  if (checkCanvas) warnings.push(...canvasIssues(deviceDef));
  return warnings;
}

export function preflightSelection(project, devices, slides = project.slides ?? []) {
  const warnings = [], buckets = new Map();
  const selected = [...new Set(devices)].map(id => project.devices[id]);
  for (const id of new Set(devices)) {
    const device = project.devices[id];
    warnings.push(...canvasIssues(device).map(issue => `${device.label ?? 'Canvas'}: ${issue.message}`));
    const target = exportTarget(device), format = acceptedFormat(device);
    if (target === 'custom' || target === 'unknown' || PLAY_TARGETS[target]) continue;
    // Different resolutions and orientations can belong to the same App Store display size.
    const bucket = `${target}:${EXPORT_TARGETS[target]?.placementType ? 'creative' : target === 'watch' ? 'watch' : format?.label ?? device.size.join('x')}`;
    const entry = buckets.get(bucket) ?? { label: `${EXPORT_TARGETS[target].label}${target === 'watch' ? '' : ` · ${format?.label ?? device.size.join(' × ')}`}`, count: 0, max: EXPORT_TARGETS[target]?.placementType ? 1 : 10 };
    entry.count += new Set(slides.filter(s => slideSupportsCanvas(project, typeof s === 'string' ? project.slides?.find(slide => slide.id === s) : s, id)).map(s => typeof s === 'string' ? s : s.id)).size;
    buckets.set(bucket, entry);
  }
  const effectiveSelection = [];
  const selectedSlides = [...new Map(slides.map(s => [typeof s === 'string' ? s : s.id, s])).values()];
  for (const id of new Set(devices)) for (const entry of selectedSlides) {
    const slide = typeof entry === 'string' ? project.slides?.find(s => s.id === entry) : entry;
    if (!slideSupportsCanvas(project, slide, id)) continue;
    const effective = canvasForSlide(project, slide, id);
    effectiveSelection.push(effective);
    if (effective !== project.devices[id]) warnings.push(...canvasIssues(effective).map(issue => `${effective.label ?? 'Canvas'} · ${slide.name ?? slide.id}: ${issue.message}`));
  }
  for (const { label, count, max } of buckets.values()) if (count > max) warnings.push(`${label}: ${count} images per language selected. App Store Connect allows up to ${max} per ${max === 1 ? 'placement' : 'display size'}. Select fewer slides or canvases.`);
  warnings.push(...playSelectionIssues(effectiveSelection, 1));
  const watch = [...selected, ...effectiveSelection].filter(d => exportTarget(d) === 'watch');
  if (new Set(watch.map(d => d.size.join('x'))).size > 1) warnings.push('Apple Watch submissions must use one screenshot size consistently across languages. Select one Watch canvas.');
  return warnings;
}
