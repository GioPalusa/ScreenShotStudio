import { resolveLayers, canvasMetrics, paintOrder, layerZ } from './layouts.js';
import { canvasForSlide } from './canvas-orientation.js';
import { sharedBlock, sharedGeometry } from './shared-canvas.js';
import { slideSupportsCanvas, isStoreCanvas } from './slide-order.js';
import { cornerControls } from './corner-ops.js';
import { shapePaints } from './shape-ops.js';
import { shadowPolar } from './shadow-ops.js';
import { parseVectorPath, vectorAnchors, vectorSegments } from './vector-path.js';

const data = value => Array.isArray(value) ? value.map(data) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, data(v)])) : value;

export function inspectLayers(bundle, { device, slide: slideId, locale, shared = false, ids, vectors = false }) {
  const project = bundle.studio, source = project.sourceLocale ?? project.locales[0]?.id;
  locale ??= source;
  if (!project.devices[device]) throw new Error(`Unknown canvas: ${device}`);
  if (!project.locales.some(l => l.id === locale)) throw new Error(`Unknown locale: ${locale}`);
  const slide = project.slides.find(s => s.id === slideId);
  if (shared ? slideId || isStoreCanvas(project.devices[device]) : !slide || !slideSupportsCanvas(project, slide, device)) throw new Error(shared ? 'Choose a shared screenshot row without a slide.' : 'Choose a screen on this canvas.');
  const canvas = shared ? project.devices[device] : canvasForSlide(project, slide, device), metrics = canvasMetrics(canvas);
  const row = sharedGeometry(project, device, locale);
  let layers = shared ? sharedBlock(project, device).layers : resolveLayers({ project, slide, deviceId: device, localeId: locale, includeShared: false }).layers;
  if (ids) {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !layers.some(l => l.id === id))) throw new Error('Choose valid, unique layer IDs in this scope.');
    layers = layers.filter(l => ids.includes(l.id));
  }
  const groups = Object.create(null), masks = Object.create(null);
  const inspected = paintOrder(layers).map(layer => {
    if (layer.group) (groups[layer.group] ??= []).push(layer.id);
    if (layer.maskMembership) (masks[layer.maskMembership.id] ??= { mask: layer.maskMembership.maskId, members: [] }).members.push(layer.id);
    const item = { id: layer.id, type: layer.type, name: layer.name ?? layer.id, editable: !layer._sourceId,
      origin: shared ? 'shared' : layer._origin, zOrder: layerZ(layer), data: data(layer) };
    if (layer.type === 'text') {
      const textSlide = layer.copySlideId ?? slideId, textLocale = layer.localeId ?? locale;
      const filled = value => value != null && !(typeof value === 'string' && !value.trim()) && !(Array.isArray(value) && value.every(v => !String(v).trim()));
      const from = [...new Set([textLocale, source, 'en-US'])].find(id => filled(bundle.copy?.[id]?.[textSlide]?.[layer.field]));
      item.text = { field: layer.field, slide: textSlide, locale: textLocale, value: from ? bundle.copy[from][textSlide][layer.field] : '', from: from ?? null, fallback: Boolean(from && from !== textLocale) };
    }
    if (layer.type === 'shape') { item.paints = shapePaints(layer); item.corners = cornerControls(layer); }
    if (layer.shadow) item.shadow = { ...layer.shadow, ...shadowPolar(layer.shadow) };
    if (vectors && layer.shape === 'path') item.vector = { pathSize: layer.pathSize, pathOffset: layer.pathOffset, coordinateSpace: 'Original path coordinates; keep pathSize/pathOffset/basis. Use point arrays here, not canvas pixels.', paths: layer.paths.map((path, index) => {
      try { const commands = parseVectorPath(path.d); return { index, anchors: vectorAnchors(commands), segments: vectorSegments(commands) }; }
      catch (error) { return { index, error: error.message }; }
    }) };
    return item;
  });
  return { device, ...(slide ? { slide: slide.id } : {}), locale, shared, revision: bundle.revisions.studio,
    editScope: shared ? { device, shared: true } : { device, slide: slide.id, ...(slide.localeLayouts?.[locale]?.[device] ? { locale } : {}) },
    coordinateSpace: shared ? 'shared row design pixels' : 'screen design pixels', size: canvas.size,
    designSize: shared ? [row.W, row.H] : [metrics.W, metrics.H], outputScale: metrics.k,
    row: { gap: row.gap, tiles: row.tiles.map(t => ({ slide: t.slide.id, x: t.x, width: t.W, height: t.H })) },
    layers: inspected, groups, masks,
    next: 'Use edit_layers with this revision and scope. For measured bounds and text fit use preview_project(details=true); data here is resolved layout data before text/font/image measurement.' };
}
