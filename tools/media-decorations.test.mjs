import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureUsage, captureItems, screenshotCollections, imageUsage } from '../app/js/media.js';
import { resolveLayers, paintOrder } from '../app/js/layouts.js';
import { patchLayer, editBlock, geometryPatch, duplicateLayer, removeLayer, moveLayerTo, setLayoutIndependent, scaleLayerGeometry } from '../app/js/layer-ops.js';
import { decorationBounds } from '../app/js/decorations.js';
import { projectName, projectFilename, isProjectFile, PROJECT_EXTENSIONS } from '../app/js/project-file.js';
import { isTextEditing, creationShortcut } from '../app/js/shortcuts.js';
import { createStudioService } from '../host/service.mjs';
import { encodePNG } from './png.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = () => ({ version: 2, devices: { phone: { label: 'Phone canvas', layout: 'phone', size: [1000, 2000], capture: 'iphone' } }, locales: [{ id: 'en-US', name: 'English' }, { id: 'sv', name: 'Swedish' }], panorama: { phone: { offsets: [0, 1000], route: { d: 'M0 50 L2000 50' }, art: [{ id: 'globe', src: 'globe', matrix: [2, 0, 0, 2, 50, 70] }] } }, slides: [{ id: 'one', capture: 'map', layouts: { phone: { template: 'custom', layers: [{ id: 'device', type: 'device', w: 300, hidden: true }] } } }, { id: 'two', layouts: { phone: { template: 'custom' } } }] });
const layers = (p, slide = 0, localeId = 'en-US') => resolveLayers({ project: p, slide: p.slides[slide], deviceId: 'phone', localeId }).layers;
const captures = () => ({ default: { iphone: { map: { file: 'map.png' }, spare: { file: 'spare.png' } } }, sv: { iphone: { map: { file: 'map.png' } } } });

test('live decoration edits and stacking are scoped to this slide and locale', () => {
  const p = fixture(), globe = layers(p).find(l => l.id === 'globe');
  globe._decorationBase = decorationBounds(globe, 100, 200); globe._box = { ...globe._decorationBase, rot: 0 };
  const block = editBlock(p, p.slides[0], 'phone');
  patchLayer(block, globe, geometryPatch(globe, { ...globe._box, x: 120, rot: 45 }));
  assert.equal(layers(p).find(l => l.id === 'globe').decorationBox.x, 120);
  assert.equal(layers(p, 1).find(l => l.id === 'globe').decorationBox, undefined);
  const local = editBlock(p, p.slides[0], 'phone', null, 'sv');
  patchLayer(local, globe, { hidden: true });
  assert.equal(layers(p, 0, 'sv').find(l => l.id === 'globe').hidden, true);
  assert.equal(layers(p).find(l => l.id === 'globe').hidden, undefined);
  moveLayerTo(block, layers(p), 'route', layers(p).length);
  assert.equal(paintOrder(layers(p)).at(-1).id, 'route');
  removeLayer(block, layers(p).find(l => l.id === 'globe'));
  assert.equal(layers(p).some(l => l.id === 'globe'), false);
  assert.equal(layers(p, 1).some(l => l.id === 'globe'), true);
});

test('frozen decorations remain editable and duplicates preserve their panorama transform', () => {
  const p = fixture(); setLayoutIndependent(p, p.slides[0], 'phone', true);
  const block = editBlock(p, p.slides[0], 'phone'), globe = layers(p).find(l => l.id === 'globe');
  globe._decorationBase = decorationBounds(globe, 100, 200); globe._box = { ...globe._decorationBase, rot: 0 };
  patchLayer(block, globe, geometryPatch(globe, { ...globe._box, y: 200 }));
  assert.equal(layers(JSON.parse(JSON.stringify(p))).find(l => l.id === 'globe').decorationBox.y, 200);
  const duplicate = duplicateLayer(block, globe, layers(p));
  assert.deepEqual(duplicate.matrix, globe.matrix); assert.equal(duplicate.panoramaOffset, globe.panoramaOffset);
  assert.equal(duplicate.decorationBox.x, globe._box.x + 48); assert.equal(duplicate._box, undefined);
  patchLayer(block, layers(p).find(l => l.id === duplicate.id), { name: 'Second globe' });
  assert.equal(block.layers.find(l => l.id === duplicate.id).name, 'Second globe');
  const copied = scaleLayerGeometry(globe, { W: 1000, H: 2000 }, { W: 500, H: 500 });
  assert.equal(copied.decorationBox.w, globe._box.w / 2);
  assert.equal(copied.decorationBox.y, globe._box.y / 4);
  removeLayer(block, layers(p).find(l => l.id === 'globe'));
  assert.equal(block.layers.some(l => l.id === 'globe'), false);
});

test('decoration bounds match affine artwork and resized, rotated panorama images', () => {
  assert.deepEqual(decorationBounds({ matrix: [2, 0, 0, 3, 40, 80], panoramaOffset: 100, panoramaScale: 0.5, panoramaDy: 20 }, 100, 200), { x: -30, y: 60, w: 100, h: 300 });
  const b = decorationBounds({ cx: 300, cy: 400, w: 200, rotate: 90, panoramaOffset: 100, panoramaScale: 2, panoramaDy: 10 }, 800, 400);
  for (const [k, v] of Object.entries({ x: 300, y: 610, w: 200, h: 400 })) assert.ok(Math.abs(b[k] - v) < 0.001);
});

test('gallery picks effective language captures and protects hidden and dormant references', () => {
  const p = fixture(), files = captures();
  assert.deepEqual(captureItems(files, 'sv').map(i => i.key).sort(), ['capture:default:iphone:spare', 'capture:sv:iphone:map']);
  assert.equal(captureUsage(p, files, { scope: 'default', set: 'iphone', name: 'map' }).length, 1);
  assert.equal(captureUsage(p, files, { scope: 'sv', set: 'iphone', name: 'map' }).length, 1);
  assert.equal(captureUsage(p, files, { scope: 'default', set: 'iphone', name: 'spare' }).length, 0);
  p.templates = { dormant: { layouts: { phone: { layers: [{ type: 'device', capture: 'spare', captureSet: 'iphone' }] } } } };
  assert.ok(captureUsage(p, files, { scope: 'default', set: 'iphone', name: 'spare' }).length);
  assert.equal(screenshotCollections(p, files).find(s => s.id === 'iphone').label, 'Phone canvas');
  assert.ok(imageUsage(p, 'globe.png').length);
  p.slides[0].layouts.phone.linkedLayout = { layers: [{ id: 'art', src: 'kept.png' }] };
  assert.ok(imageUsage(p, 'kept.png').length);
});

test('native project filenames default to sss and retain legacy compatibility', () => {
  assert.deepEqual(PROJECT_EXTENSIONS, ['sss', 'screenshotstudio']);
  for (const name of ['Launch.sss', 'Launch.SSS', 'Launch.screenshotstudio']) {
    assert.equal(isProjectFile(name), true); assert.equal(projectName(name), 'Launch'); assert.equal(projectFilename(name), 'Launch.sss');
  }
  assert.equal(projectFilename('Launch'), 'Launch.sss'); assert.equal(isProjectFile('Launch.json'), false);
});

test('creation shortcuts exclude command chords, repeats and text editing', () => {
  assert.equal(creationShortcut({ key: 't' }), 'text'); assert.equal(creationShortcut({ key: 'I' }), 'image');
  for (const flag of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'repeat']) assert.equal(creationShortcut({ key: 't', [flag]: true }), null);
  for (const tagName of ['TEXTAREA', 'SELECT']) assert.equal(isTextEditing({ tagName }), true);
  assert.equal(isTextEditing({ tagName: 'INPUT', type: 'number' }), true);
  assert.equal(isTextEditing({ isContentEditable: true }), true);
  assert.equal(isTextEditing({ tagName: 'BUTTON' }), false);
});

test('media host rejects duplicate imports and in-use deletion, archives unused captures', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-media-')); t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const p = fixture(); p.themes = {}; p.fonts = {};
  fs.writeFileSync(path.join(project, 'studio.json'), JSON.stringify(p));
  const service = createStudioService({ appPath: path.join(root, 'app'), projectPath: project, exportPath: path.join(project, 'export'), origin: 'studio://local' }); t.after(() => service.close());
  const png = encodePNG({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]), channels: 3 });
  const request = (name, method, extra = '') => service.request(new Request(`studio://local/api/capture?scope=default&device=iphone&name=${name}${extra}`, { method, ...(method === 'POST' ? { body: png } : {}) }));
  assert.equal((await request('map', 'POST', '&create=1')).status, 200);
  assert.equal((await request('map', 'POST', '&create=1')).status, 409);
  assert.equal((await request('map', 'DELETE', '&unused=1')).status, 409);
  assert.ok(fs.existsSync(path.join(project, 'captures/default/iphone/map.png')));
  assert.equal((await request('spare', 'POST', '&create=1')).status, 200);
  assert.equal((await request('spare', 'DELETE', '&unused=1')).status, 200);
  assert.equal(fs.existsSync(path.join(project, 'captures/default/iphone/spare.png')), false);
  assert.ok(fs.existsSync(path.join(project, '.history')));
  const response = await service.request(new Request('studio://local/api/asset?name=globe.png', { method: 'DELETE' }));
  assert.equal(response.status, 409);
});
