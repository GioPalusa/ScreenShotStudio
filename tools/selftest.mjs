#!/usr/bin/env node
// Self-test for the layout and template logic (no browser, no writes):  node tools/selftest.mjs
//
// It loads a synthetic legacy document into memory, applies the edit operations the editor uses and checks the
// invariants that matter: edits land where they should, stacking order is exact, templates never change how a
// slide looks, canvas changes keep proportions, and nothing private leaks into the data that gets saved.
// Rendering itself is checked by exporting before and after a change and comparing the PNGs.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolveLayers, makeLayer, paintOrder, layerZ, canvasMetrics } from '../app/js/layouts.js';
import * as ops from '../app/js/layer-ops.js';
import * as projectOps from '../app/js/project-ops.js';
import { measureFrameData } from '../app/js/measure.js';
import { frameKey, parseFrameKey } from '../app/js/frames.js';
import { layoutProject } from '../tests/fixtures/layout-project.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = layoutProject;
const classes = (phone) => ({ phone, tablet: { template: 'text-top' }, wide: { template: 'text-top' }, outer: { template: 'text-top' } });
/** Synthetic devices, themes and decorations with three fixture slides, so the checks do not depend on how the real slides are edited. */
const fresh = () => ({
  ...real(),
  slides: [
    { id: 'a', name: 'A', theme: 'sky', capture: 'timeline', layouts: classes({ template: 'text-top-caption' }) },
    { id: 'b', name: 'B', theme: 'red', capture: 'trips', layouts: classes({ template: 'text-bottom', overrides: { device: { cx: 647, top: 137, w: 1024 }, headline: { size: 176 } } }) },
    { id: 'c', name: 'C', theme: 'green', capture: 'worldmap', layouts: classes({ template: 'text-bullets', capture: null }) },
  ],
});
const visible = (layers) => JSON.stringify(layers.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !k.startsWith('_')))));

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (err) { console.error(`FAIL  ${name}\n${err.stack}`); process.exitCode = 1; }
};

const project0 = real();
const pick = (project, id) => project.slides.find((s) => s.id === id);

test('every real slide resolves on every device', () => {
  for (const slide of project0.slides) for (const deviceId of Object.keys(project0.devices)) {
    const r = resolveLayers({ project: project0, slide, deviceId });
    assert.ok(r.W > 0 && r.H > 0 && r.k > 0, `${slide.id}/${deviceId}`);
  }
});

test('editing a built-in layer writes an override, resetting removes it', () => {
  const project = fresh(); const slide = pick(project, 'b');
  const block = ops.editBlock(project, slide, 'iphone');
  const device = resolveLayers({ project, slide, deviceId: 'iphone' }).layers.find((l) => l.id === 'device');
  ops.patchLayer(block, device, { cx: 700 });
  assert.equal(resolveLayers({ project, slide, deviceId: 'iphone' }).layers.find((l) => l.id === 'device').cx, 700);
  ops.patchLayer(block, device, { cx: undefined });
  assert.equal(block.overrides?.device?.cx, undefined);
});

test('added layers sit on top and can be put exactly behind / in front of the device', () => {
  const project = fresh(); const slide = pick(project, 'a');
  const block = ops.editBlock(project, slide, 'iphone');
  const resolve = () => resolveLayers({ project, slide, deviceId: 'iphone' });
  let r = resolve();
  ops.addLayer(block, makeLayer('image', { cls: 'phone', W: r.W, H: r.H, id: 'image', src: 'globe.png' }), r.layers);
  assert.equal(paintOrder(resolve().layers).at(-1).id, 'image');
  r = resolve();
  ops.placeRelativeTo(block, r.layers, 'image', 'device', 'behind');
  let order = paintOrder(resolve().layers).map((l) => l.id);
  assert.equal(order.indexOf('image') + 1, order.indexOf('device'), order.join(','));
  ops.placeRelativeTo(block, resolve().layers, 'image', 'device', 'front');
  order = paintOrder(resolve().layers).map((l) => l.id);
  assert.equal(order.indexOf('device') + 1, order.indexOf('image'), order.join(','));
});

test('stacking with equal values renumbers instead of guessing', () => {
  const project = fresh(); const slide = pick(project, 'b');
  const block = ops.editBlock(project, slide, 'iphone');
  const resolve = () => resolveLayers({ project, slide, deviceId: 'iphone' });
  for (let i = 0; i < 3; i++) { const r = resolve(); ops.addLayer(block, makeLayer('shape', { cls: 'phone', W: r.W, H: r.H, id: 'shape' }), r.layers); }
  ops.moveLayerTo(block, resolve().layers, 'shape', 0);
  assert.equal(paintOrder(resolve().layers)[0].id, 'shape');
  ops.moveLayerTo(block, resolve().layers, 'shape-3', 1);
  assert.equal(paintOrder(resolve().layers)[1].id, 'shape-3');
});

test('removing: own layers are deleted, built-in ones switched off and restorable', () => {
  const project = fresh(); const slide = pick(project, 'b');
  const block = ops.editBlock(project, slide, 'iphone');
  const r = resolveLayers({ project, slide, deviceId: 'iphone' });
  ops.removeLayer(block, r.layers.find((l) => l.id === 'headline'));
  assert.deepEqual(ops.removedLayerIds(block), ['headline']);
  assert.ok(!resolveLayers({ project, slide, deviceId: 'iphone' }).layers.some((l) => l.id === 'headline'));
  ops.restoreLayer(block, 'headline');
  assert.ok(resolveLayers({ project, slide, deviceId: 'iphone' }).layers.some((l) => l.id === 'headline'));
});

test('saving a template never changes how a slide looks; templates are shared, tweaks stay local', () => {
  const project = fresh(); const slide = pick(project, 'b'); const other = pick(project, 'a');
  const devices = Object.keys(project.devices);
  const before = devices.map((d) => visible(resolveLayers({ project, slide, deviceId: d }).layers));
  const id = ops.saveAsTemplate(project, slide, 'Phone below, text at bottom');
  assert.deepEqual(devices.map((d) => visible(resolveLayers({ project, slide, deviceId: d }).layers)), before);
  assert.ok(ops.templateOf(project, slide, 'iphone'));

  ops.followTemplate(project, other, id);
  const deviceLayer = (s) => resolveLayers({ project, slide: s, deviceId: 'iphone' }).layers.find((l) => l.id === 'device');
  assert.equal(deviceLayer(other).capture, other.capture, 'keeps its own screenshot');
  const tplBlock = ops.editBlock(project, slide, 'iphone', id);
  ops.patchLayer(tplBlock, { ...deviceLayer(slide), _origin: 'builtin' }, { w: 900 });
  assert.equal(deviceLayer(slide).w, 900);
  assert.equal(deviceLayer(other).w, 900);
  ops.patchLayer(ops.editBlock(project, other, 'iphone'), deviceLayer(other), { w: 700 });
  assert.equal(deviceLayer(other).w, 700);
  assert.equal(deviceLayer(slide).w, 900);

  const looks = [slide, other].map((s) => visible(resolveLayers({ project, slide: s, deviceId: 'iphone' }).layers));
  ops.deleteTemplate(project, id);
  assert.deepEqual([slide, other].map((s) => visible(resolveLayers({ project, slide: s, deviceId: 'iphone' }).layers)), looks, 'deleting a template keeps slides as they were');
});

test('a slide pointing at a missing template still renders', () => {
  const project = fresh(); const slide = pick(project, 'b');
  slide.layouts.phone = { use: 'does-not-exist' };
  assert.ok(resolveLayers({ project, slide, deviceId: 'iphone' }).layers.length > 0);
});

test('applying a layout drops an explicit "no screenshot" marker but keeps a chosen screen', () => {
  const project = fresh(); const slide = pick(project, 'c');
  assert.equal(slide.layouts.phone.capture, null);
  ops.useBuiltinTemplate(project, slide, 'text-top');
  assert.equal(slide.layouts.phone.capture, undefined);
  slide.layouts.phone.capture = 'trips';
  ops.useBuiltinTemplate(project, slide, 'text-bottom');
  assert.equal(slide.layouts.phone.capture, 'trips');
});

test('canvas changes: scaling keeps the design, "keep" keeps pixel sizes', () => {
  const project = fresh(); const slide = pick(project, 'a');
  const headline = () => resolveLayers({ project, slide, deviceId: 'iphone' }).layers.find((l) => l.id === 'headline').size;
  const size0 = headline();
  projectOps.resizeDevice(project, 'iphone', [1350, 2900], { mode: 'scale' });
  const m = canvasMetrics(project.devices.iphone);
  assert.equal(m.W, 1320); assert.ok(Math.abs(m.k - 1350 / 1320) < 1e-9); assert.ok(Math.abs(m.H - 2900 / m.k) < 1e-6);
  assert.equal(headline(), size0);
  projectOps.resizeDevice(project, 'iphone', [1320, 2868], { mode: 'scale' });
  assert.equal(project.devices.iphone.designSize, undefined);
  projectOps.resizeDevice(project, 'iphone', [1400, 2868], { mode: 'keep' });
  assert.equal(canvasMetrics(project.devices.iphone).k, 1);
  const id = projectOps.addDevice(project, { label: 'iPhone 6.3″', size: [1206, 2622], layout: 'phone', capture: 'iphone', frame: project.devices.iphone.frame, reuseFrom: 'iphone' });
  assert.ok(Math.abs(canvasMetrics(project.devices[id]).k - 1206 / 1400) < 1e-9);
  projectOps.removeDevice(project, id);
  assert.ok(!project.devices[id]);
});

test('moving and resizing writes the same data from every source', () => {
  const box = { x: 100, y: 200, w: 800, h: 1600, rot: 12 };
  assert.deepEqual(ops.geometryPatch({ type: 'device' }, box), { cx: 500, top: 200, w: 800, rotate: 12 });
  assert.deepEqual(ops.geometryPatch({ type: 'device' }, { ...box, rot: 0 }), { cx: 500, top: 200, w: 800, rotate: undefined });
  assert.deepEqual(ops.geometryPatch({ type: 'text', x: 40, w: 1240, anchor: 'bottom' }, { x: 40, y: 2400, w: 1240, h: 300, rot: 0 }), { baseline: 2700 });
});

test('no private fields in data written by the editor', () => {
  const project = fresh(); const slide = pick(project, 'b');
  const block = ops.editBlock(project, slide, 'iphone');
  const r = resolveLayers({ project, slide, deviceId: 'iphone' });
  ops.addLayer(block, makeLayer('image', { cls: 'phone', W: r.W, H: r.H, id: 'image', src: 'globe.png' }), r.layers);
  ops.duplicateLayer(block, resolveLayers({ project, slide, deviceId: 'iphone' }).layers.find((l) => l.id === 'image'), resolveLayers({ project, slide, deviceId: 'iphone' }).layers);
  ops.saveAsTemplate(project, slide, 'with image');
  assert.ok(!/"_[a-zA-Z]+"\s*:/.test(JSON.stringify(project)), 'a "_field" leaked into studio.json');
});

test('frame references round-trip through their keys', () => {
  for (const ref of [{ type: 'bezel', name: 'x-y' }, { type: 'plain' }, { type: 'duo', display: 'inner', orientation: 'portrait', finish: 'night-sky' }, { type: 'duo', display: 'outer', finish: 'star-white' }]) {
    assert.equal(frameKey(parseFrameKey(frameKey(ref))), frameKey(ref));
  }
});

test('synthetic bezel measurement finds its transparent screen', () => {
  const width = 80, height = 120, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i + 3] = x >= 10 && x < 70 && y >= 12 && y < 108 ? 0 : 255;
  }
  const measured = measureFrameData({ width, height, data });
  for (const [key, value] of Object.entries({ x: 10, y: 12, w: 60, h: 96 })) assert.equal(measured.screen[key], value);
});

// ---------------------------------------------------------------------------
// regressions found in review

const resolveOn = (project, slide, deviceId = 'iphone') => resolveLayers({ project, slide, deviceId }).layers;
const layerOf = (project, slide, id, deviceId = 'iphone') => resolveOn(project, slide, deviceId).find((l) => l.id === id);

/** A project where slide "b" follows a template that has an image and a rotated device. */
function projectWithTemplate() {
  const project = fresh();
  const slide = pick(project, 'a');
  const block = ops.editBlock(project, slide, 'iphone');
  const r = resolveLayers({ project, slide, deviceId: 'iphone' });
  ops.addLayer(block, makeLayer('image', { cls: 'phone', W: r.W, H: r.H, id: 'image', src: 'globe.png' }), r.layers);
  ops.patchLayer(block, layerOf(project, slide, 'device'), { rotate: 12, opacity: 0.8, shadow: { color: '#000000', blur: 40, dy: 20 } });
  const id = ops.saveAsTemplate(project, slide, 'Tilted with image');
  ops.followTemplate(project, pick(project, 'b'), id);
  return { project, id, tplSlide: slide, slide: pick(project, 'b') };
}

test('after Detach, edits to a layer the slide had tweaked take effect (no stale override wins)', () => {
  const { project, slide } = projectWithTemplate();
  const block = ops.editBlock(project, slide, 'iphone');
  ops.patchLayer(block, layerOf(project, slide, 'image'), { cx: 300, zOrder: 9 });       // tweak on top of the template
  ops.detachTemplate(project, slide);
  const own = ops.editBlock(project, slide, 'iphone');
  assert.ok(own.layers.some((l) => l.id === 'image'), 'the image is now the slide\'s own');
  assert.equal(own.overrides?.image, undefined, 'the tweak was folded into the layer');
  ops.patchLayer(own, layerOf(project, slide, 'image'), { cx: 800 });
  assert.equal(layerOf(project, slide, 'image').cx, 800);
});

test('"Update template from this slide" and "Save as template" fold tweaks too', () => {
  const { project, id, slide } = projectWithTemplate();
  const block = ops.editBlock(project, slide, 'iphone');
  ops.patchLayer(block, layerOf(project, slide, 'image'), { cx: 321 });
  ops.updateTemplateFromSlide(project, id, slide);
  const tplBlock = ops.editBlock(project, slide, 'iphone', id);
  assert.equal(tplBlock.layers.find((l) => l.id === 'image').cx, 321);
  assert.equal(tplBlock.overrides?.image, undefined);
  assert.equal(layerOf(project, slide, 'image').cx, 321);
});

test('a value the template supplies can be cleared on a following slide', () => {
  const { project, slide } = projectWithTemplate();
  const block = ops.editBlock(project, slide, 'iphone');
  const device = () => layerOf(project, slide, 'device');
  assert.equal(device().rotate, 12);
  ops.patchLayer(block, device(), { rotate: undefined, opacity: undefined, shadow: undefined });
  assert.equal(device().rotate, undefined);
  assert.equal(device().opacity, undefined);
  assert.equal(device().shadow, undefined);
});

test('saving a template keeps the screens of extra devices with the slide', () => {
  const project = fresh(); const slide = pick(project, 'a');
  const block = ops.editBlock(project, slide, 'iphone');
  const r = resolveLayers({ project, slide, deviceId: 'iphone' });
  ops.addLayer(block, makeLayer('device', { cls: 'phone', W: r.W, H: r.H, id: 'device', capture: 'trips' }), r.layers);
  assert.equal(layerOf(project, slide, 'device-2').capture, 'trips');
  ops.saveAsTemplate(project, slide, 'Two phones');
  assert.equal(layerOf(project, slide, 'device-2').capture, 'trips');
  assert.equal(layerOf(project, slide, 'device').capture, 'timeline');
});

test('Detach and Delete only touch the template concerned, on the devices that follow it', () => {
  const project = fresh(); const slide = pick(project, 'a');
  const idA = ops.saveAsTemplate(project, slide, 'A');
  const idB = ops.saveAsTemplate(project, pick(project, 'b'), 'B');
  slide.layouts.tablet = { use: idB };            // phone follows A, tablet follows B
  ops.detachTemplate(project, slide, { templateId: idA });
  assert.ok(!slide.layouts.phone.use && slide.layouts.tablet.use === idB);
  slide.layouts.phone = { use: idA };
  ops.deleteTemplate(project, idA);
  assert.equal(slide.layouts.tablet.use, idB, 'the other template is still followed');
});

test('a slide layer and a template layer with the same id both draw (ids stay unique in a scene)', () => {
  const { project, id, slide } = projectWithTemplate();
  const block = ops.editBlock(project, slide, 'iphone');
  (block.layers ??= []).push({ id: 'image', type: 'art', src: 'other.png', cx: 100, cy: 100, w: 100 });
  const ids = resolveOn(project, slide).map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(','));
  assert.equal(resolveOn(project, slide).filter((l) => l.type === 'art' && l._origin !== 'panorama').map((l) => l.src).sort().join(), 'globe.png,other.png');
  assert.ok(id);
});

test('re-adding something that was removed does not resurrect or erase the wrong layer', () => {
  const project = fresh(); const slide = pick(project, 'b');
  const block = ops.editBlock(project, slide, 'iphone');
  ops.removeLayer(block, layerOf(project, slide, 'headline'));
  const r = resolveLayers({ project, slide, deviceId: 'iphone' });
  const added = ops.addLayer(block, makeLayer('headline', { cls: 'phone', W: r.W, H: r.H }), r.layers);
  assert.notEqual(added.id, 'headline', 'a new id: the removed one stays reserved');
  assert.ok(resolveOn(project, slide).some((l) => l.id === added.id));
  ops.removeLayer(block, resolveOn(project, slide).find((l) => l.id === added.id));
  assert.ok(!resolveOn(project, slide).some((l) => l.type === 'text' && l.field === 'headline'), 'the built-in headline stays removed');
});

test('a new device that reuses another also gets that device\'s own layouts', () => {
  const project = fresh();
  for (const slide of project.slides) slide.layouts.iphone = { template: 'text-bottom', overrides: { headline: { anchor: 'bottom' } } };
  const id = projectOps.addDevice(project, { label: 'iPhone 6.3″', size: [1206, 2622], layout: 'phone', capture: 'iphone', frame: project.devices.iphone.frame, reuseFrom: 'iphone' });
  assert.deepEqual(project.slides[0].layouts[id], project.slides[0].layouts.iphone);
  assert.notEqual(project.slides[0].layouts[id], project.slides[0].layouts.iphone, 'a copy, not the same object');
});

test('text that follows the headline falls back to the top margin when the headline is gone', () => {
  const project = fresh(); const slide = pick(project, 'a');
  const caption = resolveOn(project, slide, 'ipad').find((l) => l.id === 'caption');
  assert.equal(typeof caption.capTop.min, 'number');
  const bullets = resolveOn(project, pick(project, 'c'), 'iphone').find((l) => l.id === 'bullets');
  assert.equal(typeof bullets.capTop.min, 'number');
});

test('stepping a layer forward skips hidden layers; a copy of an extra text layer has its own text', () => {
  const project = fresh(); const slide = pick(project, 'b');
  const block = ops.editBlock(project, slide, 'iphone');
  const r = resolveLayers({ project, slide, deviceId: 'iphone' });
  const t = ops.addLayer(block, makeLayer('text', { cls: 'phone', W: r.W, H: r.H, id: 'text' }), r.layers);
  assert.equal(t.field, 'text');
  const copy = ops.duplicateLayer(block, resolveOn(project, slide).find((l) => l.id === t.id), resolveOn(project, slide));
  assert.notEqual(copy.field, t.field);
  const device = layerOf(project, slide, 'device');
  ops.patchLayer(block, layerOf(project, slide, 'headline'), { hidden: true });
  const before = paintOrder(resolveOn(project, slide)).map((l) => l.id);
  ops.stepLayer(block, resolveOn(project, slide), 'device', 1);
  const after = paintOrder(resolveOn(project, slide)).map((l) => l.id);
  assert.notDeepEqual(before, after, 'it moved past something you can see');
  assert.ok(device);
});

test('editing a template shows the slide\'s own screen and never creates blocks just by looking', () => {
  const { project, id, slide } = projectWithTemplate();
  slide.layouts.phone.capture = 'worldmap';
  const originalDevice = layerOf(project, slide, 'device');
  ops.patchLayer(ops.editBlock(project, slide, 'iphone', null, 'sv'), originalDevice, { cx: 999 });
  const tpl = project.templates[id];
  delete tpl.layouts.wide;
  const keysBefore = Object.keys(tpl.layouts).join();
  const view = ops.slideForTemplateEdit(project, slide, 'duo-inner', id);
  assert.equal(Object.keys(tpl.layouts).join(), keysBefore, 'nothing was created in the template');
  const viewIphone = ops.slideForTemplateEdit(project, slide, 'iphone', id);
  assert.equal(layerOf(project, viewIphone, 'device').capture, 'worldmap');
  assert.notEqual(resolveLayers({ project, slide: viewIphone, deviceId: 'iphone', localeId: 'sv' }).layers.find(l => l.id === 'device').cx, 999, 'slide language tweaks do not obscure editing the shared template');
  assert.equal(resolveLayers({ project, slide, deviceId: 'iphone', localeId: 'sv' }).layers.find(l => l.id === 'device').cx, 999, 'the original language tweak is preserved');
  assert.ok(view);
});

test('a frame whose screen is open to the outside is refused, not guessed', () => {
  const W = 40, H = 40, data = new Uint8Array(W * H * 4); // opaque grey with a transparent strip from the middle to the left edge
  for (let i = 0; i < W * H; i++) { data[i * 4] = 90; data[i * 4 + 1] = 90; data[i * 4 + 2] = 90; data[i * 4 + 3] = 255; }
  for (let x = 0; x <= 20; x++) for (let y = 15; y < 25; y++) data[(y * W + x) * 4 + 3] = 0;
  assert.throws(() => measureFrameData({ width: W, height: H, data }), /edge of the image/);
});

console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}.`);
