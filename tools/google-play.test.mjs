import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLAY_TARGETS, playSizeAccepted, playCanvasDefaults } from '../app/js/google-play.js';
import { canvasIssues } from '../app/js/export-targets.js';
import { preflightSelection, preflightScene } from '../app/js/preflight.js';
import { ANDROID_FRAMES, androidGeometry } from '../app/js/android-hardware.js';
import { frameKey, parseFrameKey, frameOuterSize, frameScreenSize } from '../app/js/frames.js';
import { profilesFor } from '../app/js/profiles.js';
import { frameTarget, framesForTarget } from '../app/js/frame-matching.js';
import { newCompositionSlide, compositionHardware } from '../app/js/device-compositions.js';
import { fitStoreScreenshot } from '../app/js/layer-ops.js';
import { ExportSessions } from '../host/export-sessions.mjs';
const canvas = (target, size) => ({ target, size, label: PLAY_TARGETS[target]?.label ?? target, layout: 'phone', ...playCanvasDefaults(target, size) });
const selected = (devices, n) => preflightSelection({ devices }, Object.keys(devices), Array.from({ length: n }, (_, i) => `${i}`));

test('Google Play phone uses ranges, including boundaries and both orientations, not just presets', () => {
  for (const size of [[320, 320], [320, 640], [3840, 1920], [1000, 1500]]) assert.equal(playSizeAccepted('play-phone', size), true);
  for (const size of [[319, 640], [1080, 2400], [3841, 2000], [320.5, 640], [NaN, 400]]) assert.equal(playSizeAccepted('play-phone', size), false);
  assert.match(canvasIssues(canvas('play-phone', [1080, 2400]))[0].message, /Google Play/);
});

test('tablets and Chromebook use large-screen sizes; Wear, XR and assets have their own rules', () => {
  for (const target of ['play-tablet-7', 'play-tablet-10', 'play-chromebook']) {
    for (const size of [[1080, 1920], [7680, 4320]]) assert.equal(playSizeAccepted(target, size), true);
    for (const size of [[800, 1280], [1600, 2560], [8000, 4500]]) assert.equal(playSizeAccepted(target, size), false);
  }
  assert.equal(playSizeAccepted('play-wear', [384, 384]), true);
  assert.equal(playSizeAccepted('play-wear', [383, 383]), false);
  assert.equal(playSizeAccepted('play-wear', [384, 454]), false);
  assert.equal(playSizeAccepted('play-xr', [1920, 1200]), true);
  assert.equal(playSizeAccepted('play-xr', [1200, 1920]), false);
  assert.equal(playSizeAccepted('play-feature', [1024, 500]), true);
  assert.equal(playSizeAccepted('play-feature', [500, 1024]), false);
  assert.equal(playSizeAccepted('play-tv-banner', [1280, 720]), true);
});

test('Play counts aggregate resolutions within a device type without counting Apple or feature graphics', () => {
  const phone = canvas('play-phone', [1080, 1920]), alt = canvas('play-phone', [1440, 2560]);
  assert.deepEqual(selected({ phone }, 8), []);
  assert.match(selected({ phone, alt }, 5)[0], /10 images.*maximum 8/);
  assert.match(selected({ phone }, 1)[0], /at least 2/);
  assert.deepEqual(selected({ phone, apple: { target: 'iphone', size: [1320, 2868] } }, 8), []);
  assert.match(selected({ phone, feature: canvas('play-feature', [1024, 500]) }, 1)[0], /at least 2/);
  assert.deepEqual(selected({ feature: canvas('play-feature', [1024, 500]) }, 1), []);
  assert.match(selected({ feature: canvas('play-feature', [1024, 500]) }, 2)[0], /maximum 1/);
});

test('form-factor count requirements and Automotive orientation pairs are enforced', () => {
  assert.match(selected({ tablet: canvas('play-tablet-10', [1080, 1920]) }, 3)[0], /at least 4/);
  assert.deepEqual(selected({ tablet: canvas('play-tablet-10', [1080, 1920]) }, 4), []);
  assert.match(selected({ xr: canvas('play-xr', [1920, 1200]) }, 3)[0], /at least 4/);
  assert.match(selected({ car: canvas('play-auto', [1024, 768]) }, 4)[0], /2 portrait and 2 landscape/);
  assert.deepEqual(selected({ car: canvas('play-auto', [1024, 768]), portrait: canvas('play-auto', [800, 1280]) }, 2), []);
});

test('Android frame references survive serialization; screen and outer sizes agree in every orientation', () => {
  for (const { ref } of ANDROID_FRAMES) {
    assert.equal(frameKey(parseFrameKey(frameKey(ref))), frameKey(ref));
    assert.deepEqual(frameScreenSize(ref), androidGeometry(ref).screen);
    assert.deepEqual(frameOuterSize(ref), androidGeometry(ref).size);
    assert.ok(frameOuterSize(ref).every((n, i) => n > frameScreenSize(ref)[i]));
  }
});

test('Android hardware remains independent of Play output format and gets appropriate recommendations', () => {
  const phone = canvas('play-phone', [1080, 1920]), project = { devices: { phone } };
  const target = frameTarget(project, phone);
  assert.deepEqual(target.screen, [1080, 2400]);
  assert.equal(target.family, 'android-phone');
  assert.ok(framesForTarget(target).filter(f => f.fit.kind === 'exact').every(f => f.ref.type === 'android' && f.ref.model === 'phone' && f.ref.orientation === 'portrait'));
  assert.equal(framesForTarget(target).filter(f => f.fit.kind === 'exact').length, 2);
  assert.equal(profilesFor(project)['android-foldable'].frame.type, 'android');
  assert.ok(compositionHardware(project, 'android-foldable').ratio > 1);
  assert.equal(playCanvasDefaults('play-wear', [454, 454]).frame.radius, 0);
});

function rawScene() {
  return { warnings: [], W: 454, H: 454, k: 1, localeId: 'en-US', slideId: 'intro', slide: {}, deviceDef: canvas('play-wear', [454, 454]),
    layers: [{ id: 'device', type: 'device', capture: 'screen', frame: { type: 'plain', screen: [454, 454], radius: 0 }, _box: { x: 0, y: 0, w: 454, h: 454, rot: 0 }, _radii: [0, 0, 0, 0] }] };
}
test('Wear preflight rejects hardware, text, masking and inset screenshots even with crop overrides', () => {
  const bundle = { studio: { devices: {} }, copy: {} }, good = rawScene();
  assert.deepEqual(preflightScene(good, bundle), []);
  for (const mutate of [s => s.layers[0].frame = { type: 'android', model: 'watch' }, s => s.layers[0]._radii = [227, 227, 227, 227], s => { s.layers[0]._box.w = 400; s.layers[0].allowCrop = true; }, s => s.layers.push({ id: 'extra', type: 'shape' })]) {
    const scene = structuredClone(good); mutate(scene);
    assert.ok(preflightScene(scene, bundle).some(w => w.code === 'play-raw-screenshot'));
  }
});

test('fit-to-store keeps screenshot identity/source and removes other layers in one serializable operation', () => {
  const layer = { id: 'device', type: 'device', _origin: 'slide', capture: 'screen', captureSet: 'android-watch', rotate: 12 };
  const extra = { id: 'text', type: 'text', _origin: 'slide' };
  const block = { layers: [{ ...layer }, { ...extra }], panorama: true };
  fitStoreScreenshot(block, [layer, extra], layer, { W: 400, H: 400, size: [454, 454] });
  assert.equal(block.layers.length, 1); assert.equal(block.layers[0].capture, 'screen');
  assert.equal(block.layers[0].captureSet, 'android-watch'); assert.equal(block.layers[0].w, 400);
  assert.equal(block.layers[0].rotate, 0); assert.equal(block.layers[0].frame.radius, 0); assert.equal(block.panorama, false);
});

test('new compositions start Wear and Automotive canvases without invalid device frames', () => {
  const project = { themes: { plain: { bg: '#ffffff' } }, devices: { wear: canvas('play-wear', [454, 454]), phone: canvas('play-phone', [1080, 1920]) }, slides: [] };
  const slide = newCompositionSlide(project, { designId: 'duet', profileId: 'android-phone' }, () => 'review-id');
  assert.equal(slide.layouts.wear.layers.length, 1); assert.equal(slide.layouts.wear.layers[0].frame.type, 'plain');
  assert.equal(slide.layouts.wear.layers[0].radius, 0); assert.equal(slide.layouts.wear.panorama, false);
});

test('XR byte limits are enforced before the host stages any output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-play-byte-test-'));
  try {
    const project = path.join(root, 'project'); fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'studio.json'), JSON.stringify({ locales: [{ id: 'en-US' }], slides: [{ id: 'one' }], devices: { xr: canvas('play-xr', [1920, 1200]) } }));
    const sessions = new ExportSessions(project, path.join(root, 'export'));
    const run = sessions.start('final', {});
    assert.throws(() => sessions.write(run.id, 'en-US/xr/01-one.png', Buffer.alloc(8 * 1024 * 1024 + 1), [1920, 1200]), /exceeds 8 MB/);
    assert.equal(run.files.length, 0); assert.equal(fs.existsSync(run.staging), false); sessions.close();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
