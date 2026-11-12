// Organisation only: the renderer's paint order and document geometry stay intact.
import { paintOrder } from './layouts.js';

export const layerOwner = (layer, slideId) => layer._sharedId ? 'shared' : `screen:${layer._sourceSlideId ?? slideId}`;

export function layerTree(scene) {
  const sections = (scene.allScreens ? scene.tiles : [{ slide: scene.slide }]).map(({ slide }, i) => ({
    id: `screen:${slide.id}`, name: `${i + 1}. ${slide.name ?? slide.id}`, kind: 'screen', owner: `screen:${slide.id}`, children: [], layers: [],
  }));
  const shared = { id: 'shared', name: 'Across screens', kind: 'shared', owner: 'shared', children: [], layers: [] };
  const byOwner = new Map(sections.map(section => [section.owner, section]));
  byOwner.set('shared', shared);
  for (const layer of paintOrder(scene.allLayers).reverse()) {
    let parent = byOwner.get(layerOwner(layer, scene.slideId));
    if (!parent) continue;
    parent.layers.push(layer);
    const folders = [
      ...(layer.group ? [{ id: `group:${layer.group}`, name: layer.groupName || 'Group', kind: 'group' }] : []),
      ...(layer.compositing ?? []).filter(scope => !scope.maskId).map(scope => ({ id: `figma:${scope.id}`, name: scope.name || (scope.clip ? 'Frame' : 'Group'), kind: 'figma' })),
    ];
    for (const folder of folders) {
      let child = parent.children.find(child => child.kind !== 'layer' && child.key === folder.id);
      if (!child) { child = { ...folder, key: folder.id, id: `${parent.id}/${folder.id}`, children: [], layers: [] }; parent.children.push(child); }
      child.layers.push(layer); parent = child;
    }
    parent.children.push({ id: layer.id, kind: 'layer', layer });
  }
  return [...sections, ...(shared.layers.length ? [shared] : [])];
}

/** Compact MCP view of the same tree; every leaf ID remains usable in edit_layers. */
export function layerHierarchy(layers, slide = null) {
  const scene = { slide: slide ?? { id: 'row', name: 'Row' }, slideId: slide?.id ?? 'row', allLayers: slide ? layers : layers.map(layer => ({ ...layer, _sharedId: layer.id })) };
  const summary = node => node.kind === 'layer' ? { kind: 'layer', id: node.id } : {
    id: node.id, name: node.name, kind: node.kind, layerIds: node.layers.map(layer => layer.id), children: node.children.map(summary),
  };
  return layerTree(scene).filter(node => slide || node.kind === 'shared').map(summary);
}

export function pointOnArtboard(scene, point) {
  if (!scene || point.y < 0) return false;
  return scene.allScreens
    ? scene.tiles.some(tile => point.x >= tile.x && point.x <= tile.x + tile.W && point.y <= tile.H)
    : point.x >= 0 && point.x <= scene.W && point.y <= scene.H;
}
