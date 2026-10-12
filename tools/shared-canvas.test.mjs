import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedBlock, sharedGeometry, sharedLayers, patchSharedLayer, sharedSpacing, setSharedSpacing } from '../app/js/shared-canvas.js';
import { resolveLayers } from '../app/js/layouts.js';
import { setLayoutIndependent } from '../app/js/layer-ops.js';
import { imageUsage } from '../app/js/media.js';
import { frameReferences } from '../app/js/frame-ops.js';
import { removeDevice } from '../app/js/project-ops.js';

const fixture = () => ({ devices: { phone: { size: [800, 1600], designSize: [400, 800], layout: 'phone' } },
  slides: ['a', 'b', 'c'].map(id => ({ id, layouts: { phone: { template: 'custom', layers: [] } } })),
  sharedCanvas: { phone: { gap: .06, layers: [{ id: 'image', type: 'art', src: 'bridge.png', cx: 412, cy: 400, w: 300, aspect: 1 }] } } });

test('linked language previews keep shared text and devices on the same screens after original reorder', () => {
  const p = fixture(); p.locales=[{id:'en-GB'},{id:'ar-SA'}];
  p.slideOrders={'en-GB':['a','c','b']};
  p.sharedCanvas.phone.layers.push({id:'title',type:'text',field:'headline',copySlideId:'c',x:450,capTop:50,w:300});
  const before=structuredClone(p);
  for(const slide of p.slides) {
    const scene=localeId=>resolveLayers({project:p,slide,deviceId:'phone',localeId}).layers;
    assert.deepEqual(scene('ar-SA'),scene('en-GB'));
  }
  assert.deepEqual(sharedGeometry(p,'phone','ar-SA'),sharedGeometry(p,'phone','en-GB'));
  assert.deepEqual(p,before,'Preview resolution never rewrites user layouts');
});

test('row geometry uses actual orientations, a real gap and each language order', () => {
  const p = fixture(); p.slides[1].canvasOrientations = { phone: 'landscape' }; p.slideOrders = { sv: ['c', 'b', 'a'] };
  const row = sharedGeometry(p, 'phone', 'sv');
  assert.deepEqual(row.tiles.map(t => [t.slide.id, t.x, t.W, t.H]), [['c', 0, 400, 800], ['b', 424, 800, 400], ['a', 1248, 400, 800]]);
  assert.equal(row.W, 1648); assert.equal(row.H, 800); assert.equal(row.k, 2);
});
test('one stored object projects into both screens and edits in either direction update its source', () => {
  const p = fixture(), first = sharedLayers(p, 'phone', 'en', 'a')[0], second = sharedLayers(p, 'phone', 'en', 'b')[0];
  assert.equal(first.cx, 412); assert.equal(second.cx, -12);
  patchSharedLayer(p, 'phone', second, { cx: 38, w: 420, rotate: 12 });
  assert.equal(sharedLayers(p, 'phone', 'en', 'a')[0].cx, 462);
  assert.equal(sharedLayers(p, 'phone', 'en', 'b')[0].w, 420);
  patchSharedLayer(p, 'phone', sharedLayers(p, 'phone', 'en')[0], { cx: 600, opacity: .5 });
  assert.equal(sharedLayers(p, 'phone', 'en', 'b')[0].cx, 176);
  assert.equal(p.sharedCanvas.phone.layers.length, 1);
  assert.ok(!JSON.stringify(p).includes('_shared')); assert.ok(!JSON.stringify(p).includes('_offset'));
});
test('local overflow stays local and unique designs do not clone shared objects', () => {
  const p = fixture(); p.slides[0].layouts.phone.layers.push({ id: 'local', type: 'art', cx: 420, cy: 200, w: 500 });
  assert.ok(!resolveLayers({ project: p, slide: p.slides[1], deviceId: 'phone' }).layers.some(l => l.id === 'local'));
  setLayoutIndependent(p, p.slides[0], 'phone', true, 'en');
  assert.ok(!p.slides[0].localeLayouts.en.phone.layers.some(l => l.id.startsWith('shared:')));
  assert.equal(resolveLayers({ project: p, slide: p.slides[0], deviceId: 'phone', localeId: 'en' }).layers.filter(l => l._sharedId).length, 1);
});
test('shared media participates in reference protection and canvas removal', () => {
  const p = fixture(); sharedBlock(p, 'phone').layers.push({ id: 'phone', type: 'device', frame: { type: 'bezel', name: 'frame' } });
  assert.equal(imageUsage(p, 'bridge.png').length, 1); assert.equal(frameReferences(p, 'frame').length, 1);
  removeDevice(p, 'phone'); assert.equal(p.sharedCanvas.phone, undefined);
});

test('spacing defaults follow the canvas store while existing geometry stays unchanged', () => {
  const p = fixture(); p.devices.phone.target = 'play-phone';
  assert.deepEqual(sharedSpacing(p, 'phone'), { gap: .06, preset: 'app-store' });
  delete p.sharedCanvas;
  assert.deepEqual(sharedSpacing(p, 'phone'), { gap: .04, preset: 'google-play' });
  assert.equal(sharedGeometry(p, 'phone', 'en').gap, 16);
  assert.equal(p.sharedCanvas, undefined, 'Reading defaults does not modify the document');
  p.devices.phone.target = 'iphone';
  assert.deepEqual(sharedSpacing(p, 'phone'), { gap: .06, preset: 'app-store' });
});

test('custom spacing keeps its choice at preset values and changes the projected crop without moving sources', () => {
  const p = fixture(), original = structuredClone(p.sharedCanvas.phone.layers);
  assert.equal(setSharedSpacing(p, 'phone', 'google-play'), true);
  assert.equal(sharedLayers(p, 'phone', 'en', 'b')[0].cx, -4);
  assert.equal(setSharedSpacing(p, 'phone', 'custom', .075), true);
  assert.equal(sharedGeometry(p, 'phone', 'en').gap, 30);
  assert.equal(sharedLayers(p, 'phone', 'en', 'b')[0].cx, -18);
  assert.equal(setSharedSpacing(p, 'phone', 'custom', .06), true);
  assert.deepEqual(sharedSpacing(JSON.parse(JSON.stringify(p)), 'phone'), { gap: .06, preset: 'custom' });
  assert.equal(setSharedSpacing(p, 'phone', 'custom', 0), true);
  assert.equal(sharedGeometry(p, 'phone', 'en').gap, 0);
  assert.equal(setSharedSpacing(p, 'phone', 'custom', .5), true);
  assert.equal(sharedGeometry(p, 'phone', 'en').gap, 200);
  for (const gap of [-1, 1.1, NaN, Infinity]) assert.equal(setSharedSpacing(p, 'phone', 'custom', gap), false);
  assert.equal(setSharedSpacing(p, 'phone', 'invalid'), false);
  assert.deepEqual(p.sharedCanvas.phone.layers, original);
});
