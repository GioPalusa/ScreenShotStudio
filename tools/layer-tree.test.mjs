import test from 'node:test';
import assert from 'node:assert/strict';
import { layerTree, pointOnArtboard } from '../app/js/layer-tree.js';
import { groupLayerPatches, patchLayer } from '../app/js/layer-ops.js';
import { pasteLayerClipboard } from '../app/js/layer-transfer.js';

const layer = (id, extra = {}) => ({ id, type: 'shape', shape: 'rect', cx: 50, cy: 50, w: 20, h: 20, ...extra });
const scene = () => ({ allScreens: true, slideId: 'a', tiles: [{ slide: { id: 'a', name: 'First' }, x: 0, W: 100, H: 200 }, { slide: { id: 'b', name: 'Second' }, x: 110, W: 100, H: 100 }], allLayers: [] });

test('layers are separated by artboard in storyboard order, with shared objects in their own section', () => {
  const s = scene(); s.allLayers = [layer('b', { _sourceSlideId: 'b', zOrder: 9 }), layer('shared:s', { _sharedId: 's' }), layer('a-back', { _sourceSlideId: 'a' }), layer('a-front', { _sourceSlideId: 'a', zOrder: 2 })];
  const original = structuredClone(s);
  const tree = layerTree(s);
  assert.deepEqual(tree.map(n => n.name), ['1. First', '2. Second', 'Across screens']);
  assert.deepEqual(tree.map(n => n.layers.map(l => l.id)), [['a-front', 'a-back'], ['b'], ['shared:s']]);
  assert.deepEqual(s, original, 'organising the panel never changes render order or document data');
});

test('named groups and nested imported frames stay distinct across artboards', () => {
  const s = scene();
  const scopes = [{ id: 'root', name: 'Imported screen', sourceType: 'FRAME' }, { id: 'details', name: 'Phone details' }];
  s.allLayers = [layer('one', { _sourceSlideId: 'a', group: 'manual', groupName: 'Phone', compositing: scopes }), layer('two', { _sourceSlideId: 'a', group: 'manual', groupName: 'Phone', compositing: scopes }), layer('three', { _sourceSlideId: 'b', compositing: scopes })];
  const tree = layerTree(s), group = tree[0].children[0];
  assert.equal(group.name, 'Phone'); assert.equal(group.layers.length, 2);
  assert.equal(group.children[0].name, 'Imported screen');
  assert.equal(group.children[0].children[0].name, 'Phone details');
  assert.notEqual(group.children[0].id, tree[1].children[0].id);
});

test('grouping, rename, clipboard duplication and ungroup preserve geometry and independent groups', () => {
  const block = { layers: [layer('one'), layer('two')] };
  for (const { layer, patch } of groupLayerPatches(block.layers, { id: 'g', name: 'Phone' })) patchLayer(block, { ...layer, _origin: 'slide' }, patch);
  const pasted = pasteLayerClipboard({ entries: block.layers.map(layer => ({ layer })) }, { block, resolved: block.layers.slice(), copy: {}, slideIds: ['a'], shared: false, dy: 0 });
  assert.equal(pasted.layers[0].groupName, 'Phone');
  assert.equal(pasted.layers[0].group, pasted.layers[1].group); assert.notEqual(pasted.layers[0].group, 'g');
  for (const { layer, patch } of groupLayerPatches(block.layers.slice(0, 2), { ungroup: true })) patchLayer(block, { ...layer, _origin: 'slide' }, patch);
  assert.equal(block.layers[0].group, undefined); assert.equal(block.layers[0].groupName, undefined);
  assert.equal(block.layers[0].cx, 50); assert.equal(pasted.layers[0].groupName, 'Phone');
});

test('empty storyboard, gaps and space below shorter artboards are outside artboards', () => {
  const s = scene();
  for (const point of [{ x: -1, y: 50 }, { x: 105, y: 50 }, { x: 150, y: 150 }, { x: 50, y: -1 }, { x: 211, y: 0 }]) assert.equal(pointOnArtboard(s, point), false);
  for (const point of [{ x: 50, y: 150 }, { x: 150, y: 50 }]) assert.equal(pointOnArtboard(s, point), true);
  assert.equal(pointOnArtboard({ W: 100, H: 200 }, { x: 101, y: 50 }), false);
});
