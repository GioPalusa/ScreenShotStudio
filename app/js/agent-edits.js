// Targeted agent edits use the same layout operations as the editor.
import { resolveLayers } from './layouts.js';
import { editBlock, splitBlockForDevice, patchLayer, addLayer, removeLayer } from './layer-ops.js';
import { sharedBlock, patchSharedLayer } from './shared-canvas.js';
import { isStoreCanvas, orderedSlides, slideSupportsCanvas } from './slide-order.js';

const plain = value => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('_')) throw new Error('Use plain layer data without private fields.');
    plain(child);
  }
};

export function editingInventory(project) {
  return Object.entries(project.devices).map(([id, device]) => ({
    id, label: device.label, size: device.size, designSize: device.designSize ?? device.size,
    captureCollection: device.capture, shared: !isStoreCanvas(device),
    sharedLayers: (project.sharedCanvas?.[id]?.layers ?? []).map(l => ({ id: l.id, type: l.type })),
    screens: orderedSlides(project, project.sourceLocale ?? project.locales[0]?.id, id).map(slide => ({
      id: slide.id, name: slide.name, capture: slide.capture,
      layers: resolveLayers({ project, slide, deviceId: id, includeShared: false }).layers.map(l => ({ id: l.id, type: l.type, editable: !l._sourceId, ...(l.field ? { field: l.field } : {}) })),
    })),
  }));
}

/** Return a modified clone: a bad batch cannot partially change the caller's document. */
export function editLayers(studio, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 200) throw new Error('Supply 1–200 layer edits.');
  plain(edits);
  const project = structuredClone(studio);
  for (const edit of edits) {
    const device = project.devices[edit.device];
    if (!device) throw new Error(`Unknown canvas: ${edit.device}`);
    if (!['add', 'patch', 'remove'].includes(edit.op)) throw new Error('Choose add, patch or remove.');
    if (edit.locale && !project.locales.some(l => l.id === edit.locale)) throw new Error(`Unknown locale: ${edit.locale}`);
    if (edit.patch && ['id', 'type'].some(key => key in edit.patch)) throw new Error('Keep layer identity and type; add a new layer to replace it.');
    let block, layers;
    if (edit.shared) {
      if (edit.slide || edit.locale || isStoreCanvas(device)) throw new Error('Shared edits use a screenshot canvas and row coordinates, without slide or locale.');
      block = sharedBlock(project, edit.device, true); layers = block.layers ??= [];
    } else {
      const slide = project.slides.find(s => s.id === edit.slide);
      if (!slide || !slideSupportsCanvas(project, slide, edit.device)) throw new Error(`Choose a screen on canvas ${edit.device}.`);
      // Materialize a class layout so a targeted iPad edit cannot affect another canvas.
      if (!edit.locale) splitBlockForDevice(project, slide, edit.device);
      block = editBlock(project, slide, edit.device, null, edit.locale);
      layers = resolveLayers({ project, slide, deviceId: edit.device, localeId: edit.locale, includeShared: false }).layers;
    }
    if (edit.op === 'add') {
      if (!edit.layer?.id || !['text', 'device', 'art', 'shape', 'route'].includes(edit.layer.type)) throw new Error('Add a layer with an ID and a supported type.');
      if (layers.some(l => l.id === edit.layer.id) || block.overrides?.[edit.layer.id] !== undefined) throw new Error(`Layer ID already exists: ${edit.layer.id}`);
      addLayer(block, structuredClone(edit.layer), layers);
    } else {
      const layer = layers.find(l => l.id === edit.id);
      if (!layer) throw new Error(`Unknown layer: ${edit.id}`);
      if (layer._sourceId) throw new Error(`Layer ${edit.id} has a generated ID because stored layer IDs conflict. Rename the conflicting layers with save_document, then read_project again before targeted edits.`);
      if (edit.op === 'remove') {
        removeLayer(block, { ...layer, _origin: edit.shared ? 'slide' : layer._origin });
        if (edit.shared) block.layers ??= [];
      }
      else {
        if (!edit.patch || typeof edit.patch !== 'object' || Array.isArray(edit.patch)) throw new Error('Supply a layer patch.');
        if (edit.shared) patchSharedLayer(project, edit.device, { _sharedId: layer.id }, edit.patch);
        else patchLayer(block, layer, edit.patch);
      }
    }
  }
  return project;
}
