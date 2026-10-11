import { adjacentSlides, previewWarnings, neighborPreferences } from '../app/js/preview-context.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setLayoutIndependent, setDecorationsVisible, editBlock, patchLayer, followTemplate } from '../app/js/layer-ops.js';
import { resolveLayers } from '../app/js/layouts.js';
import { savePalette, paletteColors } from '../app/js/design-library.js';
import { createFontCatalog, fontFamilies } from '../host/fonts.mjs';

function fixture() {
  return { devices: { phone: { layout: 'phone', size: [1320, 2868] }, other: { layout: 'phone', size: [1320, 2868] } },
    templates: { shared: { layouts: { phone: { template: 'custom', layers: [{ id: 'headline', type: 'text', field: 'headline', x: 40, rotate: 15 }, { id: 'device', type: 'device', w: 800 }] } } } },
    panorama: { phone: { route: { color: 'red' }, art: [{ id: 'globe', src: 'globe.png', w: 200 }] } },
    slides: [{ id: 'slide', capture: 'map', layouts: { phone: { use: 'shared' } }, localeLayouts: { sv: { other: { overrides: { headline: { x: 70 } }, layers: [{ id: 'extra', type: 'shape', w: 60 }] } } } }] };
}
const plain = layers => JSON.parse(JSON.stringify(layers.map(l => Object.fromEntries(Object.entries(l).filter(([k]) => !k.startsWith('_') && k !== 'panoramaLayer')))));
const scene = (project, deviceId = 'other', localeId = 'en') => resolveLayers({ project, slide: project.slides[0], deviceId, localeId });

test('canvas independence freezes template, decorations and capture through serialization; reconnect follows updates', () => {
  let p = fixture(), slide = p.slides[0];
  const before = plain(scene(p).layers);
  setLayoutIndependent(p, slide, 'other', true);
  p = JSON.parse(JSON.stringify(p)); slide = p.slides[0];
  assert.deepEqual(plain(scene(p).layers), before);
  p.templates.shared.layouts.phone.layers[0].x = 500;
  p.panorama.phone.art[0].w = 700;
  slide.capture = 'new';
  assert.deepEqual(plain(scene(p).layers), before);
  patchLayer(editBlock(p, slide, 'other'), scene(p).layers.find(l => l.id === 'headline'), { rotate: 47 });
  assert.equal(scene(p).layers.find(l => l.id === 'headline').rotate, 47);
  assert.equal(scene(p, 'phone').layers.find(l => l.id === 'headline').x, 500);
  followTemplate(p, slide, 'shared');
  assert.equal(slide.layouts.other.independent, true);
  setLayoutIndependent(p, slide, 'other', false);
  assert.equal(scene(p).layers.find(l => l.id === 'headline').x, 500);
  assert.equal(scene(p).layers.find(l => l.id === 'device').capture, 'new');
});

test('language independence freezes existing overrides and additions and edits only the local layer', () => {
  const p = fixture(), slide = p.slides[0], before = plain(scene(p, 'other', 'sv').layers);
  setLayoutIndependent(p, slide, 'other', true, 'sv');
  assert.deepEqual(plain(scene(p, 'other', 'sv').layers), before);
  p.templates.shared.layouts.phone.layers[0].x = 300;
  patchLayer(editBlock(p, slide, 'other', null, 'sv'), scene(p, 'other', 'sv').layers.find(l => l.id === 'headline'), { x: 90 });
  assert.equal(scene(p, 'other', 'sv').layers.find(l => l.id === 'headline').x, 90);
  assert.equal(scene(p).layers.find(l => l.id === 'headline').x, 300);
  setLayoutIndependent(p, slide, 'other', false, 'sv');
  assert.equal(scene(p, 'other', 'sv').layers.find(l => l.id === 'headline').x, 300);
  assert.equal(scene(p, 'other', 'sv').layers.some(l => l.id === 'extra'), false);
});

test('both independence levels compose; reconnect restores a previous exact canvas link', () => {
  const p = fixture(), slide = p.slides[0];
  slide.layouts.other = { use: 'shared', overrides: { headline: { rotate: 8 } } };
  setLayoutIndependent(p, slide, 'other', true);
  setLayoutIndependent(p, slide, 'other', true, 'sv');
  const frozen = plain(scene(p, 'other', 'sv').layers);
  p.templates.shared.layouts.phone.layers[0].x = 990;
  setLayoutIndependent(p, slide, 'other', false);
  assert.deepEqual(slide.layouts.other, { use: 'shared', overrides: { headline: { rotate: 8 } } });
  assert.deepEqual(plain(scene(p, 'other', 'sv').layers), frozen);
  setLayoutIndependent(p, slide, 'other', false, 'sv');
  assert.equal(scene(p, 'other', 'sv').layers.find(l => l.id === 'headline').rotate, 8);
});

test('custom palette retains extra colours without aliasing and validates before any mutation', () => {
  const p = {}, swatches = ['#fa0033', '#55ff11', '#fa0033'];
  const id = savePalette(p, 'Launch', { bg: '#ffffff', ink: '#000000', swatches });
  swatches[0] = '#000000';
  assert.deepEqual(paletteColors(p.themes[id]), ['#ffffff', '#000000', '#fa0033', '#55ff11']);
  const before = structuredClone(p);
  assert.throws(() => savePalette(p, 'Invalid', { bg: '#ffffff', ink: '#000000', swatches: ['oops'] }));
  assert.deepEqual(p, before);
});

test('font discovery returns active family names without font paths or duplicates', () => {
  const report = { SPFontsDataType: [{ path: '/private/font.ttf', typefaces: [{ family: 'Zeta' }, { family: 'Arial' }, { family: 'Arial' }, { family: '.Private' }, { family: 'Bad', valid: 'no' }] }, { enabled: 'no', typefaces: [{ family: 'Disabled' }] }] };
  assert.deepEqual(fontFamilies(report), ['Arial', 'Zeta']);
});

test('font catalog coalesces requests, refreshes and retries after failure', async () => {
  let calls = 0, time = 0, fail = false;
  const read = createFontCatalog({ platform: 'darwin', now: () => time, execute: async (command, args, options) => {
    calls++; assert.equal(command, '/usr/sbin/system_profiler'); assert.deepEqual(args, ['SPFontsDataType', '-json']); assert.equal(options.timeout, 30000);
    if (fail) throw new Error('Unavailable');
    return { stdout: '{"SPFontsDataType":[]}' };
  } });
  await Promise.all([read(), read()]); assert.equal(calls, 1);
  time = 61000; fail = true; await assert.rejects(read());
  fail = false; await read(); assert.equal(calls, 3);
  const unavailable = createFontCatalog({ platform: 'linux', execute: () => { throw new Error('Must not run'); } });
  assert.match((await unavailable()).unavailable, /macOS/);
});


test('toggling frozen decorations never duplicates or reconnects the live panorama', () => {
  const p = fixture(), slide = p.slides[0];
  setLayoutIndependent(p, slide, 'other', true, 'sv');
  const block = editBlock(p, slide, 'other', null, 'sv');
  setDecorationsVisible(block, false);
  assert.equal(scene(p, 'other', 'sv').layers.filter(layer => layer._origin === 'panorama' && !layer.hidden).length, 0);
  p.panorama.phone.art[0].w = 900;
  setDecorationsVisible(block, true);
  const layers = scene(p, 'other', 'sv').layers;
  assert.equal(layers.filter(layer => layer.id === 'globe').length, 1);
  assert.equal(layers.find(layer => layer.id === 'globe').w, 200);
  assert.equal(layers.filter(layer => layer._origin === 'panorama' && !layer.hidden).length, 2);
});

test('preview warning badges group scaled text and retain each explanation', () => {
  const badges = previewWarnings([
    { code: 'shrunk', level: 'warn', message: 'Headline scaled' },
    { code: 'shrunk', level: 'warn', message: 'Caption scaled' },
    { code: 'capture-missing', level: 'error', message: 'Capture missing' },
    { code: 'other', level: 'info', message: 'Informational' },
  ]);
  assert.equal(badges.length, 2);
  assert.equal(badges[0].label, 'No screenshot');
  assert.equal(badges[1].label, 'Text scaled to fit');
  assert.equal(badges[1].message, 'Headline scaled\nCaption scaled');
});

test('adjacent slide previews follow order without wrapping at the ends', () => {
  const slides = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(adjacentSlides(slides, 'b'), [slides[0], slides[2]]);
  assert.deepEqual(adjacentSlides(slides, 'a'), [null, slides[1]]);
  assert.deepEqual(adjacentSlides(slides, 'c'), [slides[1], null]);
  assert.deepEqual(adjacentSlides(slides, 'missing'), [null, null]);
  assert.deepEqual(adjacentSlides([slides[0]], 'a'), [null, null]);
});

test('neighbor preferences default to visible at 70 percent and preserve zero opacity', () => {
  assert.deepEqual(neighborPreferences({}), { visible: true, opacity: 70 });
  assert.deepEqual(neighborPreferences({ showNeighbors: false, neighborOpacity: 0 }), { visible: false, opacity: 0 });
  assert.equal(neighborPreferences({ neighborOpacity: 130 }).opacity, 100);
  assert.equal(neighborPreferences({ neighborOpacity: -10 }).opacity, 0);
  assert.equal(neighborPreferences({ neighborOpacity: NaN }).opacity, 70);
});
