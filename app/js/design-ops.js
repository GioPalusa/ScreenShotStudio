import { canvasForSlide } from './canvas-orientation.js';
import { resolveLayers, layoutFor } from './layouts.js';
import { withDeviceComposition } from './device-compositions.js';
import { newConnectedSeries } from './connected-series.js';
import { followTemplate, useBuiltinTemplate } from './layer-ops.js';

/** Load onto the existing screen. Copy documents and source files are never changed. */
export function withLoadedDesign(project, slide, choice) {
  const ids = choice.deviceIds;
  if (!ids?.length || ids.some(id => !project.devices[id])) throw new Error('Choose a valid canvas.');
  if (ids.some(id => layoutFor(slide, id, project.devices[id]).independent)) throw new Error('Turn off Unique design before loading a shared design.');
  if (choice.kind === 'arrangement') return withDeviceComposition(project, slide, choice);
  const next = structuredClone(slide);
  if (choice.kind === 'layout') {
    if (choice.option.kind === 'template') followTemplate(project, next, choice.option.id, { deviceIds: ids });
    else useBuiltinTemplate(project, next, choice.option.id, { deviceIds: ids });
    return next;
  }
  if (choice.kind !== 'styled') throw new Error('Choose a design.');
  const oriented = { ...project, devices: Object.fromEntries(Object.keys(project.devices).map(id => [id, canvasForSlide(project, slide, id)])) };
  const [designed] = newConnectedSeries(oriented, { ...choice, count: 1 }, () => 'preview');
  next.layouts ??= {};
  for (const id of ids) {
    const previous = resolveLayers({ project, slide, deviceId: id, includeShared: false }).layers;
    const oldDevices = previous.filter(l => l.type === 'device');
    const oldText = previous.filter(l => l.type === 'text');
    const usedText = new Set(); let deviceIndex = 0;
    const block = designed.layouts[id];
    block.layers = block.layers.flatMap(layer => {
      delete layer.seriesLayer;
      if (layer.type === 'device') {
        const prior = oldDevices[deviceIndex++];
        if (prior) for (const key of ['capture', 'captureSet', 'fit', 'align', 'languageNeutral']) {
          if (prior[key] !== undefined) layer[key] = structuredClone(prior[key]);
        }
      }
      if (layer.type === 'text') {
        const prior = oldText.find(l => l.field === layer.field && !usedText.has(l)) ?? oldText.find(l => !usedText.has(l) && !block.layers.some(n => n.type === 'text' && n.field === l.field));
        if (!prior) return [];
        usedText.add(prior); layer.field = prior.field;
      }
      return [layer];
    });
    next.layouts[id] = block;
  }
  if (designed.colors) next.colors = designed.colors;
  return next;
}
