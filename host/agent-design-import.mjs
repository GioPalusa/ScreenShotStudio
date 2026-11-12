import path from 'node:path';
import { importFigma } from './figma.mjs';
import { importFigmaClipboard } from './figma-clipboard.mjs';
import { figmaFrames, findFigmaNode, convertFigmaFrame, scaleFigmaLayers } from '../app/js/figma-layout.js';
import { canvasForSlide } from '../app/js/canvas-orientation.js';
import { resolveLayers, canvasMetrics, paintOrder } from '../app/js/layouts.js';
import { slideSupportsCanvas } from '../app/js/slide-order.js';
import { pasteLayerClipboard } from '../app/js/layer-transfer.js';

/** Prepare a reviewable native edit. Keys never enter tool arguments or returned data. */
export async function prepareDesignImport(bundle, input, { readLocal, importImage, figmaRequest } = {}) {
  const { action = 'inspect', url, source, format = 'figma-json', ids = [] } = input;
  if (!['inspect', 'prepare'].includes(action) || Boolean(url) === Boolean(source)) throw new Error('Supply one Figma URL or one local source file, and choose inspect or prepare.');
  if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('Choose up to 100 unique Figma frame IDs.');
  let designs, images = {}, frames, version;
  if (url) {
    const request = figmaRequest ?? (value => {
      if (!process.env.FIGMA_ACCESS_TOKEN) throw new Error('Connect Figma in the Mac app first. Standalone MCP can use FIGMA_ACCESS_TOKEN from its environment.');
      return importFigma({ ...value, token: process.env.FIGMA_ACCESS_TOKEN });
    });
    const result = await request({ url, action: action === 'inspect' ? 'inspect' : 'load', ids, ...(input.version ? { version: input.version } : {}) });
    if (action === 'inspect') return result;
    ({ designs, images } = result);
  } else if (format === 'figma-clipboard') {
    const result = await importFigmaClipboard((await readLocal(source, 32 * 1024 * 1024)).toString('utf8'));
    ({ designs, images } = result);
    frames = designs.map(d => ({ id: d.id, name: d.name, width: d.width, height: d.height }));
  } else if (format === 'figma-json') {
    let data;
    try { data = JSON.parse((await readLocal(source, 32 * 1024 * 1024)).toString('utf8')); } catch (error) { if (error instanceof SyntaxError) throw new Error('The Figma source file is not valid JSON.'); throw error; }
    if (data?.type) data = { document: data };
    frames = figmaFrames(data); version = data.version;
    if (!frames.length) throw new Error('No Figma frames found. Supply a Figma REST file, nodes response or frame JSON.');
    if (action === 'prepare') {
      const selected = ids.length ? ids : frames.length === 1 ? [frames[0].id] : [];
      if (selected.length !== 1) throw new Error('Prepare one frame for one destination screen. Choose an ID from inspect first.');
      designs = selected.map(id => { const node = findFigmaNode(data, id); if (!node) throw new Error(`Unknown Figma frame: ${id}`); return { id, ...convertFigmaFrame(node, { minSize: 1 }) }; });
    }
  } else throw new Error('Choose figma-json or figma-clipboard. SVG can be pasted as native layers in the Mac app.');
  if (action === 'inspect') return { frames, ...(version ? { version } : {}), next: 'Prepare one selected frame for a destination device/slide/locale.' };
  if (designs?.length !== 1) throw new Error('Prepare one Figma frame for each destination screen.');
  const project = bundle.studio, locale = input.locale ?? project.sourceLocale ?? project.locales[0].id;
  const slide = project.slides.find(s => s.id === input.slide), device = project.devices[input.device];
  if (!device || !slide || !slideSupportsCanvas(project, slide, input.device)) throw new Error('Choose a destination screen on an existing canvas.');
  if (!project.locales.some(l => l.id === locale)) throw new Error('Choose an existing destination language.');
  const design = designs[0];
  if (!design.layers.length || design.layers.length > 200) throw new Error('Prepare 1–200 native layers at a time. Import larger selections through the Mac app.');
  const refs = [...new Set(design.images ?? [])], assets = Object.create(null), pending = [];
  // Validate every source before publishing any new image assets.
  for (const ref of refs) {
    if (input.images?.[ref]) {
      const file = input.images[ref]; pending.push({ ref, bytes: await readLocal(file, 32 * 1024 * 1024), name: path.basename(file) });
    } else if (images[ref]) pending.push({ ref, bytes: Buffer.from(images[ref].data, 'base64'), name: `figma-${pending.length + 1}.${images[ref].mime === 'image/jpeg' ? 'jpg' : images[ref].mime === 'image/webp' ? 'webp' : 'png'}` });
    else throw new Error(`Figma image ${ref} is missing. Supply images[ref] as a local file path or use the Figma URL.`);
  }
  for (const image of pending) assets[image.ref] = (await importImage(image.bytes, image.name)).file;
  const { W, H } = canvasMetrics(canvasForSlide(project, slide, input.device));
  const layers = paintOrder(scaleFigmaLayers(design, W, H, assets));
  const copy = structuredClone(bundle.copy), resolved = resolveLayers({ project, slide, deviceId: input.device, localeId: locale, includeShared: false }).layers;
  copy[locale] ??= {};
  const block = { layers: [] };
  const pasted = pasteLayerClipboard({ entries: layers.map(layer => ({ layer, text: layer.type === 'text' ? { [locale]: { value: design.texts[layer.field] ?? '', needsReview: true } } : {} })) }, { block, resolved, copy, slideIds: [slide.id], shared: false, dx: 0, dy: 0 });
  for (const layer of pasted.layers) if (layer.name?.endsWith(' copy')) layer.name = layer.name.slice(0, -5);
  copy[locale]._meta = { status: 'draft', needsReview: ['*'] };
  return { prepared: true, applied: false, revision: bundle.revisions.studio, copyRevision: bundle.revisions[`copy:${locale}`] ?? 'missing',
    destination: { device: input.device, slide: slide.id, locale, designSize: [W, H] },
    edits: pasted.layers.map(layer => ({ op: 'add', device: input.device, slide: slide.id, locale, layer })),
    copy: copy[locale], assets, warnings: design.warnings ?? [],
    fonts: [...new Set(layers.filter(l => l.type === 'text').map(l => l.fontFamily).filter(Boolean))],
    next: 'Review warnings and font_catalog. Apply edits with edit_layers and this studio revision, then save_copy for the destination locale with copyRevision. Both saves acknowledge their own revisions; reread and reconcile conflicts. Preview the affected screen with details=true. Image assets are imported; layouts and copy have not yet changed.' };
}
