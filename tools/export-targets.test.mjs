import { canvasSizeOptions, existingStoreCanvas } from '../app/js/presets.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPORT_TARGETS, acceptedFormat, canvasIssues, exportTarget } from '../app/js/export-targets.js';
import { SIZE_PRESETS } from '../app/js/presets.js';
import { preflightSelection } from '../app/js/preflight.js';
import { addDevice, resizeDevice } from '../app/js/project-ops.js';
import { validateDocument, migrateDocument } from '../app/js/document.js';

const canvas = (target, size, label = target) => ({ target, size, label });

test('presets and export policy agree for every platform and orientation', () => {
  for (const { target, items } of SIZE_PRESETS) for (const [, w, h] of items) {
    assert.deepEqual(canvasIssues(canvas(target, [w, h])), [], `${target}: ${w} × ${h}`);
    assert.ok(acceptedFormat(canvas(target, [w, h])));
  }
  assert.equal(new Set(SIZE_PRESETS.map(p => p.target)).size, Object.keys(EXPORT_TARGETS).length);
});

test('accepts supported phone and tablet resolutions in both orientations', () => {
  for (const [target, size] of [['iphone', [1320, 2868]], ['iphone', [2007, 2853]], ['iphone', [1398, 2034]], ['ipad', [2064, 2752]], ['ipad', [1488, 2266]]]) {
    assert.deepEqual(canvasIssues(canvas(target, size)), []);
    assert.deepEqual(canvasIssues(canvas(target, [...size].reverse())), []);
  }
});

test('keeps cropped legacy screenshots exact instead of blindly swapping dimensions', () => {
  assert.deepEqual(canvasIssues(canvas('iphone', [1136, 600])), []);
  assert.equal(canvasIssues(canvas('iphone', [1096, 640]))[0].code, 'iphone-size');
  assert.deepEqual(canvasIssues(canvas('ipad', [2048, 1496])), []);
  assert.equal(canvasIssues(canvas('ipad', [2008, 1536]))[0].code, 'ipad-size');
});

test('rejects wrong platform sizes and fixed-orientation rotations', () => {
  for (const [target, size] of [['watch', [514, 422]], ['mac', [1800, 2880]], ['tv', [1080, 1920]], ['vision', [1920, 1080]], ['ipad', [1320, 2868]], ['iphone', [1000, 1000]]]) {
    assert.equal(canvasIssues(canvas(target, size))[0].code, `${target}-size`);
  }
  assert.deepEqual(canvasIssues(canvas('custom', [1000, 1000])), []);
});

test('infers legacy declared platforms without guessing from size or the displayed frame', () => {
  for (const [name, target] of [['iPhone 6.9″ Display', 'iphone'], ['iPad 13″', 'ipad'], ['Apple Watch', 'watch'], ['MacBook', 'mac'], ['Apple TV', 'tv'], ['Apple Vision Pro', 'vision']]) {
    assert.equal(exportTarget({ appStore: name }), target);
    assert.equal(exportTarget({ target: 'app-store', label: name }), target);
  }
  assert.equal(exportTarget({ label: 'iPhone', size: [1320, 2868] }), 'custom');
  assert.equal(exportTarget({ appStore: 'Other App Store', size: [1320, 2868], frame: { type: 'watch' } }), 'unknown');
  assert.equal(exportTarget({ target: 'custom', appStore: 'Apple Watch' }), 'custom');
  assert.equal(exportTarget({ target: 'future-platform', label: 'iPhone' }), 'unknown');
  assert.equal(canvasIssues({ target: 'app-store', size: [1000, 1000] })[0].code, 'export-target');
});

test('selection checks use only selected canvases and report size errors once', () => {
  const project = { devices: { valid: canvas('watch', [422, 514]), invalid: canvas('iphone', [1000, 1000]) } };
  assert.deepEqual(preflightSelection(project, ['valid']), []);
  assert.equal(preflightSelection(project, ['invalid', 'invalid']).length, 1);
  assert.equal(preflightSelection(project, ['invalid'], ['one', 'two']).length, 1);
});

test('counts images per display size and language, including alternate canvas resolutions', () => {
  const project = { devices: { phone: canvas('iphone', [1320, 2868]), second: canvas('iphone', [2796, 1290]), tablet: canvas('ipad', [2064, 2752]), custom: canvas('custom', [800, 800]) } };
  const slides = Array.from({ length: 10 }, (_, i) => ({ id: `${i}` }));
  assert.deepEqual(preflightSelection(project, ['phone', 'tablet'], slides), []);
  assert.match(preflightSelection(project, ['phone', 'second'], slides)[0], /20 images per language/);
  assert.match(preflightSelection(project, ['phone'], [...slides, { id: 'extra' }])[0], /11 images/);
  assert.deepEqual(preflightSelection(project, ['custom'], [...slides, { id: 'extra' }]), []);
  assert.deepEqual(preflightSelection(project, ['phone'], [...slides, slides[0]]), []);
});

test('Watch size consistency also applies to old project definitions', () => {
  const project = { devices: { a: { appStore: 'Apple Watch', size: [422, 514] }, b: canvas('watch', [416, 496]) } };
  assert.match(preflightSelection(project, ['a', 'b'])[0], /one screenshot size/);
  assert.deepEqual(preflightSelection(project, ['a']), []);
});

test('adding and resizing preserves explicit targets through a project round trip', () => {
  const project = { version: 2, themes: {}, devices: {}, locales: [{ id: 'en-US' }], slides: [{ id: 'intro' }] };
  const watch = addDevice(project, { label: 'Watch', target: 'watch', size: [422, 514], layout: 'phone' });
  const custom = addDevice(project, { label: 'iPhone campaign', size: [1080, 1080], layout: 'phone' });
  resizeDevice(project, watch, [416, 496]);
  const restored = migrateDocument(JSON.parse(JSON.stringify(project)));
  assert.equal(exportTarget(restored.devices[watch]), 'watch');
  assert.equal(exportTarget(restored.devices[custom]), 'custom');
  assert.deepEqual(restored.devices[watch].size, [416, 496]);
  assert.deepEqual(canvasIssues(restored.devices[watch]), []);
  assert.doesNotThrow(() => validateDocument(restored));
});

test('store formats retain existing dimensions without offering manual replacements', () => {
  const size = [1234, 2345];
  const options = canvasSizeOptions('iphone', size);
  assert.equal(options[0][0], '1234x2345');
  assert.match(options[0][1], /Current format/);
  assert.ok(options.some(([id]) => id === '1320x2868'));
  assert.equal(canvasSizeOptions('iphone', [1320, 2868]).filter(([id]) => id === '1320x2868').length, 1);
  assert.deepEqual(size, [1234, 2345]);
});

test('existing store canvas matches platform and dimensions, including legacy Apple targets', () => {
  const devices = { phone: { appStore: 'iPhone', size: [1320, 2868] }, google: { target: 'play-phone', size: [1080, 1920] }, custom: { target: 'custom', size: [1080, 1920] } };
  assert.equal(existingStoreCanvas(devices, 'iphone', [1320, 2868]), 'phone');
  assert.equal(existingStoreCanvas(devices, 'play-phone', [1080, 1920]), 'google');
  assert.equal(existingStoreCanvas(devices, 'iphone', [2868, 1320]), 'phone');
  assert.equal(existingStoreCanvas(devices, 'custom', [1080, 1920]), null);
});
