import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DESIGNS, STARTER_PALETTES, previewStarterDesign, applyStarterDesign, savePalette } from '../app/js/design-library.js';
import { resolveLayers, canvasMetrics } from '../app/js/layouts.js';
import { withLoadedDesign } from '../app/js/design-ops.js';
import { saveAsTemplate } from '../app/js/layer-ops.js';

const fixture = () => ({
  themes: { own: { name: 'Own', bg: '#ffffff', ink: '#123456' } },
  devices: {
    phone: { layout: 'phone', size: [1320, 2868], frame: { type: 'bezel', name: 'phone' } },
    tablet: { layout: 'tablet', size: [2064, 2752], frame: { type: 'plain', screen: [1640, 2360] } },
    watch: { layout: 'phone', size: [422, 514], designSize: [400, 487], frame: { type: 'plain', screen: [422, 514] } },
    wide: { layout: 'wide', size: [2880, 1800], frame: { type: 'plain', screen: [2880, 1800] } },
    square: { layout: 'phone', size: [1000, 1000] },
  },
  slides: [{ id: 'first', theme: 'own', capture: 'home', layouts: { phone: { template: 'text-top' } }, localeLayouts: {
    sv: { watch: { capture: 'localized', overrides: { device: { top: 900, captureSet: 'swedish', languageNeutral: true } }, layers: [{ id: 'local-note', type: 'text', field: 'note' }] } },
  } }, { id: 'second', theme: 'own' }],
});
const frames = { phone: { size: [1350, 2760], screen: { w: 1206, h: 2622 } } };
const settings = { designId: 'focus', frames, deviceIds: ['watch'] };

test('loading a complete design changes only the chosen canvas and retains screen identity and content', () => {
  const project = fixture(), slide = project.slides[0], before = structuredClone(project);
  const next = withLoadedDesign(project, slide, { kind: 'styled', designId: 'paper', deviceIds: ['tablet'], frames, includeText: true });
  assert.equal(next.id, slide.id);
  assert.equal(next.capture, slide.capture);
  assert.deepEqual(next.layouts.phone, slide.layouts.phone);
  assert.deepEqual(next.localeLayouts, slide.localeLayouts);
  assert.deepEqual(project, before, 'Loading returns a new screen without mutating the document');
  const old = resolveLayers({ project, slide, deviceId: 'tablet' }).layers;
  const layers = resolveLayers({ project, slide: next, deviceId: 'tablet' }).layers;
  assert.equal(layers.find(l => l.type === 'device').capture, 'home');
  assert.ok(layers.some(l => l.type === 'shape'));
  assert.ok(layers.filter(l => l.type === 'text').every(l => old.some(p => p.type === 'text' && p.field === l.field)), 'No new sample text fields');
  assert.ok(layers.every(l => !l.seriesLayer), 'Replacement is not linked to another series');
});

test('load distinguishes saved layouts from device-only arrangements and protects unique layouts', () => {
  const project = fixture(), slide = project.slides[0];
  const id = saveAsTemplate(project, slide, 'Reusable design');
  const saved = withLoadedDesign(project, slide, { kind: 'layout', option: { kind: 'template', id }, deviceIds: ['phone'] });
  assert.equal(saved.layouts.phone.use, id);
  const arranged = withLoadedDesign(project, slide, { kind: 'arrangement', designId: 'center', deviceIds: ['phone'], frames });
  const oldText = resolveLayers({ project, slide, deviceId: 'phone' }).layers.filter(l => l.type === 'text');
  assert.deepEqual(resolveLayers({ project, slide: arranged, deviceId: 'phone' }).layers.filter(l => l.type === 'text').map(l => l.field), oldText.map(l => l.field));
  assert.equal(arranged.colors, undefined, 'Device-only changes preserve screen colours');
  slide.layouts.phone.independent = true;
  assert.throws(() => withLoadedDesign(project, slide, { kind: 'styled', designId: 'paper', deviceIds: ['phone'], frames }), /Unique design/);
});

for (const design of STARTER_DESIGNS) test(`${design.name}: fits phone, tablet, Watch, square and landscape in design pixels`, () => {
  const project = fixture(), slide = project.slides[0], before = structuredClone(project);
  for (const id of Object.keys(project.devices)) {
    const next = previewStarterDesign(project, slide, { ...settings, designId: design.id, deviceIds: [id] });
    const { W, H } = canvasMetrics(project.devices[id]);
    const layers = resolveLayers({ project, slide: next, deviceId: id }).layers;
    assert.equal(new Set(layers.map(l => l.id)).size, layers.length);
    for (const l of layers) {
      const ratio = id === 'phone' ? 1350 / 2760 : (l.frame?.screen ?? project.devices[id].size).reduce((a, b) => a / b);
      const x = l.type === 'text' ? l.x : l.cx - l.w / 2;
      const y = l.type === 'text' ? l.capTop : l.type === 'shape' ? l.cy - l.h / 2 : l.top;
      const height = l.type === 'text' ? l.boxHeight : l.type === 'shape' ? l.h : l.w / ratio;
      assert.ok([x, y, l.w, height].every(Number.isFinite), `${id}/${l.id} is finite`);
      assert.ok(x >= 0 && y >= 0 && x + l.w <= W + 0.01 && y + height <= H + 0.01, `${id}/${l.id} fits`);
    }
  }
  assert.deepEqual(project, before, 'Preview must be read-only');
});

test('applying only Watch does not change the phone sharing its layout family', () => {
  const project = fixture(), second = structuredClone(project.slides[1]);
  const phone = resolveLayers({ project, slide: project.slides[0], deviceId: 'phone' });
  assert.equal(applyStarterDesign(project, { ...settings, slideIds: ['first'] }), 1);
  assert.deepEqual(resolveLayers({ project, slide: project.slides[0], deviceId: 'phone' }), phone);
  assert.deepEqual(project.slides[1], second);
  assert.equal(project.slides[0].layouts.watch.template, 'custom');
});

test('screenshot choice, profile and fit survive restyling; locale geometry is kept by default', () => {
  const project = fixture(), slide = project.slides[0];
  slide.layouts.watch = { template: 'custom', capture: 'block-screen', layers: [{ id: 'hero', type: 'device', profile: 'watch-ultra', capture: 'layer-screen', captureSet: 'custom-set', fit: 'contain', languageNeutral: true }] };
  const next = previewStarterDesign(project, slide, settings);
  const device = next.layouts.watch.layers.find(l => l.type === 'device');
  for (const key of ['id', 'profile', 'capture', 'captureSet', 'fit', 'languageNeutral']) assert.equal(device[key], slide.layouts.watch.layers[0][key]);
  assert.equal(next.layouts.watch.capture, 'block-screen');
  assert.deepEqual(next.localeLayouts, slide.localeLayouts);
  assert.equal(JSON.stringify(next).includes('"_'), false, 'No runtime fields in saved JSON');
});

test('optional locale reset removes old positions but retains localized screenshots', () => {
  const project = fixture(), next = previewStarterDesign(project, project.slides[0], { ...settings, resetLocaleLayouts: true });
  const variant = next.localeLayouts.sv.watch;
  assert.deepEqual(variant, { capture: 'localized', overrides: { device: { captureSet: 'swedish', languageNeutral: true } } });
  const device = resolveLayers({ project, slide: next, deviceId: 'watch', localeId: 'sv' }).layers.find(l => l.type === 'device');
  assert.equal(device.capture, 'localized'); assert.equal(device.captureSet, 'swedish'); assert.notEqual(device.top, 900);
});

test('batch applies palette to selected slides, leaving project themes and other slides intact', () => {
  const project = fixture(), palette = STARTER_PALETTES[1];
  const themes = structuredClone(project.themes);
  assert.equal(applyStarterDesign(project, { ...settings, slideIds: ['first', 'second'], deviceIds: ['watch', 'wide'], palette }), 4);
  assert.deepEqual(project.slides.map(s => s.colors), [{ bg: palette.bg, ink: palette.ink }, { bg: palette.bg, ink: palette.ink }]);
  assert.deepEqual(project.themes, themes);
});

test('invalid batch selection never leaves partially changed slides', () => {
  const project = fixture(), before = structuredClone(project);
  for (const options of [{ slideIds: ['first', 'missing'] }, { slideIds: ['first'], deviceIds: ['watch', 'missing'] }, { slideIds: ['first'], designId: 'missing' }]) {
    assert.throws(() => applyStarterDesign(project, { ...settings, ...options })); assert.deepEqual(project, before);
  }
});

test('named palettes are reusable without overwriting an existing palette', () => {
  const project = fixture(), colors = STARTER_PALETTES[0];
  assert.equal(savePalette(project, 'Own', colors), 'own-2');
  assert.deepEqual(project.themes.own, { name: 'Own', bg: '#ffffff', ink: '#123456' });
  assert.equal(project.themes['own-2'].bg, colors.bg);
  const before = structuredClone(project);
  assert.throws(() => savePalette(project, '', colors)); assert.throws(() => savePalette(project, 'Broken', { bg: 'no', ink: '#111111' }));
  assert.deepEqual(project, before);
});


test('batch design changes skip independent canvases and preserve independent languages', () => {
  const project = fixture(), slide = project.slides[0];
  slide.layouts.watch = { independent: true, template: 'custom', layers: [{ id: 'custom', type: 'shape', w: 80 }] };
  slide.localeLayouts.sv.wide = { independent: true, template: 'custom', layers: [{ id: 'local', type: 'shape', w: 90 }] };
  const watch = structuredClone(slide.layouts.watch), locale = structuredClone(slide.localeLayouts.sv.wide);
  const count = applyStarterDesign(project, { ...settings, slideIds: ['first'], deviceIds: ['watch', 'wide'], resetLocaleLayouts: true });
  assert.equal(count, 1);
  assert.deepEqual(project.slides[0].layouts.watch, watch);
  assert.deepEqual(project.slides[0].localeLayouts.sv.wide, locale);
});
