import { paintOrder, layerZ } from './layouts.js';
import { patchLayer, removeLayer, addLayer, uniqueId, copyAppearance, appearancePatch, createMaskPatches, releaseMaskPatch, restackSelection } from './layer-ops.js';
import { shadowPreset, shadowFromPolar } from './shadow-ops.js';
import { cornerControls, cornerRadiusPatch } from './corner-ops.js';
import { shapePaints, editShapePaint, changePaintType, editGradientStop, turnGradient } from './shape-ops.js';
import { toolbarPaintPatch, toolbarPaints } from './toolbar-paints.js';
import { booleanShape } from './shape-boolean.js';
import { parseVectorPath, writeVectorPath, vectorAnchors, vectorSegments, moveVectorAnchor, moveVectorHandle, splitVectorSegment, deleteVectorAnchor, cornerVectorAnchor, smoothVectorAnchor, bendVectorSegment, reframeVectorPatch } from './vector-path.js';

const finite = (value, label, min = -Infinity, max = Infinity) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a finite number between ${min} and ${max}.`);
  return value;
};
const point = value => {
  if (!Array.isArray(value) || value.length !== 2 || value.some(v => !Number.isFinite(v))) throw new Error('Supply a finite [x, y] point in vector coordinates.');
  return value;
};
const choice = (value, choices) => {
  if (!choices.includes(value)) throw new Error(`Choose ${choices.join(', ')}.`);
  return value;
};

/** Operate on resolved objects through the editor's own pure operations. */
export function operateOnLayers({ block, layers, edit, ink, paper }) {
  const ids = edit.ids ?? (edit.id ? [edit.id] : []);
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('Supply unique selected layer IDs.');
  const selected = ids.map(id => {
    const layer = layers.find(l => l.id === id);
    if (!layer) throw new Error(`Unknown layer: ${id}`);
    if (layer._sourceId) throw new Error(`Layer ${id} has conflicting stored layer IDs. Rename them with save_document first.`);
    if (layer.locked) throw new Error(`Layer ${id} is locked. Unlock it with a patch first.`);
    return layer;
  });
  const apply = (layer, patch) => patchLayer(block, layer, patch);
  const allMembers = field => {
    const groups = new Set(selected.map(l => l[field]?.id ?? l[field]).filter(Boolean));
    const members = layers.filter(l => groups.has(l[field]?.id ?? l[field]));
    if (members.some(l => l.locked || l._sourceId)) throw new Error('Unlock and resolve every member before changing this group or mask.');
    return members;
  };
  switch (edit.op) {
    case 'group': {
      if (selected.length < 2 || selected.some(l => l.maskMembership)) throw new Error('Group at least two unmasked layers.');
      const group = edit.group ?? uniqueId(layers.map(l => l.group).filter(Boolean), 'group');
      if (layers.some(l => l.group === group && !ids.includes(l.id))) throw new Error('This group ID belongs to other objects. Choose a new group ID.');
      for (const layer of selected) apply(layer, { group });
      break;
    }
    case 'ungroup':
      if (selected.some(l => l.maskMembership)) throw new Error('Release the mask before ungrouping.');
      for (const layer of allMembers('group')) apply(layer, { group: undefined });
      break;
    case 'reorder':
      restackSelection(block, layers, ids, ['forward', 'front'].includes(choice(edit.direction, ['forward', 'backward', 'front', 'back'])) ? 1 : -1, ['front', 'back'].includes(edit.direction));
      break;
    case 'appearance': {
      const source = edit.source ? layers.find(l => l.id === edit.source) : null;
      if (edit.source && !source) throw new Error(`Unknown appearance source: ${edit.source}`);
      const appearance = source ? copyAppearance(source, ink) : edit.appearance;
      if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) throw new Error('Supply a source layer ID or an appearance object.');
      for (const layer of selected) apply(layer, appearancePatch(layer, appearance));
      break;
    }
    case 'shadow':
      for (const layer of selected) {
        if (edit.enabled === false) { apply(layer, { savedShadow: layer.shadow, shadow: undefined }); continue; }
        let shadow = edit.preset ? shadowPreset(edit.preset) : { ...shadowPreset('floating'), ...(layer.shadow || layer.savedShadow || {}) };
        for (const key of ['color', 'alpha', 'blur', 'dx', 'dy']) if (edit.shadow?.[key] !== undefined) {
          const value = edit.shadow[key];
          if (key !== 'color') finite(value, key, key === 'alpha' || key === 'blur' ? 0 : -Infinity, key === 'alpha' ? 1 : Infinity);
          shadow[key] = value;
        }
        if (edit.distance !== undefined || edit.angle !== undefined) shadow = shadowFromPolar(shadow, {
          ...(edit.distance !== undefined ? { distance: finite(edit.distance, 'distance', 0) } : {}),
          ...(edit.angle !== undefined ? { angle: finite(edit.angle, 'angle') } : {}),
        });
        apply(layer, { shadow });
      }
      break;
    case 'paint':
      for (const layer of selected) {
        if (!['shape', 'text'].includes(layer.type)) throw new Error('Paint edits need shape or text layers.');
        choice(edit.action, ['color', 'none', 'restore', 'swap', 'width', 'type', 'stop', 'angle', 'patch', 'add', 'remove']);
        if (['color', 'none', 'restore', 'swap', 'width'].includes(edit.action)) {
          if (edit.action === 'width') finite(edit.width, 'Outline width', 0);
          if (edit.action === 'color' && typeof edit.color !== 'string') throw new Error('Supply a paint colour.');
          if (edit.target === 'stroke' && layer.type === 'text' || edit.action === 'width' && layer.type === 'text') throw new Error('Text outlines are not supported.');
          if (edit.action === 'swap' && !toolbarPaints(layer, ink).canSwap) throw new Error('Swap needs a shape with a single solid fill.');
          apply(layer, toolbarPaintPatch(layer, edit.action, { ...edit, ink }));
          continue;
        }
        const text = layer.type === 'text';
        const target = text ? { type: 'shape', w: layer.w, h: layer.boxHeight ?? layer.size, paints: [layer.textPaint ?? { type: 'solid', color: layer.color ?? ink }] } : layer;
        const paints = shapePaints(target), index = edit.index ?? 0;
        let patch;
        if (edit.action === 'add') { if (text) throw new Error('Text supports one editable paint.'); if (!edit.paint) throw new Error('Supply a paint object.'); patch = { paints: [...paints, structuredClone(edit.paint)], gradient: undefined }; }
        else {
          if (!Number.isInteger(index) || !paints[index]) throw new Error('Choose an existing paint index.');
          if (edit.action === 'remove') { if (text) throw new Error('Use none to remove text fill.'); paints.splice(index, 1); patch = { paints, gradient: undefined }; }
          if (edit.action === 'type') patch = changePaintType(target, index, choice(edit.paintType, ['solid', 'linear', 'radial']));
          if (edit.action === 'patch') { if (!edit.paint) throw new Error('Supply a paint patch.'); patch = editShapePaint(target, index, edit.paint); }
          if (edit.action === 'stop') {
            if (!paints[index].stops?.[edit.stop]) throw new Error('Choose an existing gradient stop.');
            if (edit.opacity !== undefined) finite(edit.opacity, 'Stop opacity', 0, 1);
            if (edit.position !== undefined) finite(edit.position, 'Stop position', 0, 1);
            patch = editGradientStop(target, index, edit.stop, { color: edit.color, opacity: edit.opacity, position: edit.position });
          }
          if (edit.action === 'angle') {
            if (!['linear', 'radial'].includes(paints[index].type)) throw new Error('Choose a gradient paint before rotating its handles.');
            patch = turnGradient(target, index, finite(edit.angle, 'Gradient angle'));
          }
        }
        apply(layer, text ? { textPaint: patch.paints[0].type === 'solid' ? undefined : patch.paints[0], color: patch.paints[0].color ?? layer.color } : patch);
      }
      break;
    case 'corners':
      for (const layer of selected) {
        const controls = cornerControls(layer), key = edit.corner ?? controls[0]?.key;
        if (!controls.some(c => c.key === key)) throw new Error('Choose a live corner key from inspect_layers.');
        apply(layer, cornerRadiusPatch(layer, key, finite(edit.radius, 'Corner radius', 0), { all: edit.all ?? edit.corner === undefined }));
      }
      break;
    case 'vector': {
      if (selected.length !== 1 || selected[0].shape !== 'path') throw new Error('Select one native vector path.');
      const layer = selected[0], index = edit.path ?? 0, paths = structuredClone(layer.paths);
      if (!paths?.[index]) throw new Error('Choose an existing vector path index.');
      const commands = parseVectorPath(paths[index].d);
      choice(edit.action, ['move_anchor', 'move_handle', 'split', 'delete_anchor', 'corner', 'smooth', 'bend', 'replace']);
      if (['move_anchor', 'delete_anchor', 'corner', 'smooth'].includes(edit.action) && !vectorAnchors(commands).some(n => n.index === edit.command)) throw new Error('Choose an anchor command index from inspect_layers.');
      if (edit.action === 'move_handle' && !vectorAnchors(commands).some(n => n.handles.some(h => h.command === edit.command && h.offset === edit.offset))) throw new Error('Choose a handle command index and offset from inspect_layers.');
      if (['split', 'bend'].includes(edit.action) && !vectorSegments(commands).some(s => s.index === edit.command)) throw new Error('Choose a vector segment command index from inspect_layers.');
      let next;
      if (edit.action === 'move_anchor') next = moveVectorAnchor(commands, edit.command, point(edit.point));
      if (edit.action === 'move_handle') next = moveVectorHandle(commands, edit.command, edit.offset, point(edit.point), { linked: edit.linked ?? true });
      if (edit.action === 'split') next = splitVectorSegment(commands, edit.command, finite(edit.t ?? .5, 'Segment position', .001, .999));
      if (edit.action === 'delete_anchor') next = deleteVectorAnchor(commands, edit.command);
      if (edit.action === 'corner') next = cornerVectorAnchor(commands, edit.command);
      if (edit.action === 'smooth') next = smoothVectorAnchor(commands, edit.command);
      if (edit.action === 'bend') next = bendVectorSegment(commands, edit.command, finite(edit.t ?? .5, 'Segment position', .001, .999), point(edit.delta));
      if (edit.action === 'replace') next = parseVectorPath(edit.d);
      paths[index].d = writeVectorPath(next);
      apply(layer, { ...reframeVectorPatch(layer, paths), cornerSourcePaths: undefined, cornerRadii: undefined });
      break;
    }
    case 'mask': {
      const mask = edit.mask ? selected.find(l => l.id === edit.mask) : paintOrder(layers).filter(l => ids.includes(l.id)).at(-1);
      if (!mask) throw new Error('The mask must be among the selected IDs.');
      const id = uniqueId(layers.flatMap(l => [l.group, l.maskMembership?.id]).filter(Boolean), 'mask');
      for (const item of createMaskPatches(selected, mask, { id, sourceId: mask.id })) apply(item.layer, item.patch);
      break;
    }
    case 'unmask':
      if (!selected.some(l => l.maskMembership)) throw new Error('Select a member of an editable mask.');
      for (const layer of allMembers('maskMembership')) apply(layer, releaseMaskPatch(layer));
      break;
    case 'boolean': {
      if (!paper) throw new Error('The host must supply the native vector boolean engine.');
      const ordered = paintOrder(layers).filter(l => ids.includes(l.id)), result = booleanShape(ordered, edit.operation, paper);
      const id = edit.resultId ?? uniqueId([...layers.map(l => l.id), ...Object.keys(block.overrides ?? {})], 'combined-shape');
      if (layers.some(l => l.id === id) || block.overrides?.[id] !== undefined) throw new Error('Choose a new resultId for the combined shape.');
      for (const layer of ordered) removeLayer(block, layer);
      addLayer(block, { ...result, id, zOrder: layerZ(ordered[0]) }, layers);
      break;
    }
    default: throw new Error(`Unknown layer operation: ${edit.op}`);
  }
}
