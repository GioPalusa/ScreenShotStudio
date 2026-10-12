// Review regressions: real edit/store operations, with an in-memory host and DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayers } from '../app/js/layouts.js';
import { followTemplate, editBlock, patchLayer, setLayoutIndependent } from '../app/js/layer-ops.js';
import { copyNeedsReview } from '../app/js/copy-review.js';
import { preflightScene } from '../app/js/preflight.js';
import { applyStarterDesign, savePalette } from '../app/js/design-library.js';

class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; this.nodeType = 1; this.children = []; this.dataset = {}; this.style = {}; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this[key] = value; }
  getContext() { return {}; }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  set textContent(value) { this.children = [{ nodeType: 3, textContent: value }]; }
  querySelectorAll(selector) {
    const match = node => selector.startsWith('[data-') ? selector.slice(6, -1) in (node.dataset ?? {}) : node.tag === selector;
    return this.children.flatMap(child => [...(match(child) ? [child] : []), ...(child.querySelectorAll?.(selector) ?? [])]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  remove() {}
}
const dom = () => ({ createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), createTextNode: text => ({ nodeType: 3, textContent: text }), addEventListener() {}, body: new Element('body'), getElementById() { return null; } });
globalThis.document = dom();
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const storeURL = new URL('../app/js/store.js', import.meta.url);
let instance = 0;
const fixture = () => ({
  projectId: 'regression-fixture', revisions: { studio: 's1', 'copy:en-US': 'c1', 'copy:sv': 'v1' },
  studio: { devices: { square: { layout: 'phone', size: [1000, 1000], capture: 'phone' } },
    locales: [{ id: 'en-US', name: 'English', lang: 'en' }, { id: 'sv', name: 'Swedish', lang: 'sv' }],
    slides: [{ id: 'a', name: 'Original', capture: 'phone-home', layouts: { square: { template: 'custom', layers: [{ id: 'extra', type: 'text', field: 'extra', x: 50, w: 200, capTop: 100 }] } } }],
  },
  copy: { 'en-US': { _meta: { status: 'approved', needsReview: [] }, a: { headline: 'Original', extra: 'Offer' } }, sv: { _meta: { status: 'approved', needsReview: [] }, a: { headline: 'Ursprunglig', extra: 'Erbjudande' } } },
  exports: [], frames: {}, captures: {}, assets: { art: [] },
});
const reply = (body, status = 200) => ({ ok: status === 200, status, json: async () => structuredClone(body) });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function harness(t) {
  let changed;
  const host = { bundle: fixture(), reads: [], writes: [], autoRead: true };
  globalThis.window = { addEventListener() {}, studioDesktop: { onChanged: fn => { changed = fn; } } };
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      const key = url === '/api/studio' ? 'studio' : `copy:${decodeURIComponent(url.split('/').at(-1))}`;
      host.writes.push({ key, revision: options.headers['if-match'], data: JSON.parse(options.body) });
      if (options.headers['if-match'] !== host.bundle.revisions[key]) return reply({ error: 'changed outside' }, 409);
      const data = JSON.parse(options.body);
      if (key === 'studio') host.bundle.studio = data; else host.bundle.copy[key.slice(5)] = data;
      host.bundle.revisions[key] += '+';
      return reply({ revision: host.bundle.revisions[key] });
    }
    if (options.method === 'DELETE' && url.startsWith('/api/frame?')) {
      const name = new URLSearchParams(url.split('?')[1]).get('name');
      host.deletedFrames ??= [];
      host.deletedFrames.push({ name, studio: structuredClone(host.bundle.studio) });
      delete host.bundle.frames[name];
      return reply({ ok: true });
    }
    assert.equal(url, '/api/project');
    if (host.autoRead) return reply(host.bundle);
    return new Promise(resolve => host.reads.push({ resolve, snapshot: structuredClone(host.bundle) }));
  };
  const store = await import(`${storeURL}?test=${++instance}`);
  store.saves.schedule = () => null; store.saves.cancel = () => {};
  await store.loadAll(); store.connectEvents(); host.autoRead = false;
  host.changed = files => changed({ type: 'changed', files });
  host.release = async index => { const read = host.reads[index]; assert.ok(read, `Missing read ${index}`); read.resolve(reply(read.snapshot)); await tick(); };
  t.after(async () => { host.autoRead = true; store.saves.discard(); await tick(); });
  return { host, store };
}

test('starter design and saved palette restore with one undo and redo, without changing copy', async t => {
  const { store } = await harness(t), project = store.engine.project;
  const original = structuredClone(project), text = structuredClone(store.engine.data.copy);
  const token = store.checkpoint();
  applyStarterDesign(project, { designId: 'focus', slideIds: ['a'], deviceIds: ['square'], palette: { bg: '#101010', ink: '#eeeeee' } });
  savePalette(project, 'Brand', { bg: '#101010', ink: '#eeeeee' });
  const changed = structuredClone(project);
  assert.equal(store.undoIf(token), true); assert.deepEqual(store.engine.project, original);
  assert.equal(store.redo(), true); assert.deepEqual(store.engine.project, changed);
  assert.deepEqual(store.engine.data.copy, text);
});

test('preview and export resolve profile bezels consistently, while an explicit layer frame wins', async t => {
  const { store } = await harness(t), engine = store.engine;
  engine.data.frames = { tablet: { screen: { x: 10, y: 10, w: 1640, h: 2360 } } };
  const canvas = engine.project.devices.square, layer = { profile: 'ipad' };
  assert.deepEqual(engine.frameRefFor(canvas, layer), { type: 'bezel', name: 'tablet' });
  assert.deepEqual(engine.expectedCaptureSize(canvas, layer), [1640, 2360]);
  layer.frame = { type: 'plain', screen: [300, 400] };
  assert.deepEqual(engine.frameRefFor(canvas, layer), layer.frame);
  assert.deepEqual(engine.expectedCaptureSize(canvas, layer), [300, 400]);
});

test('a missing screenshot names the displayed hardware rather than the output canvas', async t => {
  const { store } = await harness(t), engine = store.engine;
  engine.composedDevice = () => null;
  const layer = { id: 'tablet', profile: 'ipad', capture: 'timeline' };
  const scene = { deviceDef: engine.project.devices.square, assets: { captures: { tablet: { missing: true } } }, warnings: [] };
  engine.drawDevice({}, scene, layer);
  assert.equal(scene.warnings[0].message, 'Screenshot “timeline” missing for iPad');
});

for (const key of ['studio', 'copy:en-US']) {
  const filename = key === 'studio' ? 'studio.json' : 'copy/en-US.json';
  const set = (s, text) => { if (key === 'studio') { s.engine.project.slides[0].name = text; s.saveStudio(); } else s.setCopy('en-US', 'a', 'headline', text); };
  const get = s => key === 'studio' ? s.engine.project.slides[0].name : s.getCopy('en-US', 'a', 'headline');
  test(`${key}: delayed external read preserves unsaved edits and conflict revision`, async t => {
    const { host, store } = await harness(t);
    const revision = store.state.revisions[key];
    host.bundle.revisions[key] = 'external'; host.changed([filename]);
    set(store, 'Local edit'); await host.release(0);
    assert.equal(get(store), 'Local edit'); assert.equal(store.state.revisions[key], revision);
    await assert.rejects(store.flushSaves(), /changed outside/);
    assert.equal(store.saves.dirty, true); assert.equal(get(store), 'Local edit');
    set(store, 'Local edit plus more'); host.autoRead = true;
    await store.resolveSaveConflict(true); await tick();
    assert.equal(get(store), 'Local edit plus more'); assert.equal(store.saves.dirty, false);
    assert.equal(host.writes.at(-1).revision, 'external');
  });
  test(`${key}: even an acknowledged edit invalidates an older in-flight read`, async t => {
    const { host, store } = await harness(t);
    host.changed([filename]); set(store, 'Saved during fetch'); await store.flushSaves();
    assert.equal(store.saves.dirty, false);
    const revision = store.state.revisions[key];
    await host.release(0);
    assert.equal(get(store), 'Saved during fetch'); assert.equal(store.state.revisions[key], revision);
    assert.equal(host.reads.length, 2, 'A fresh read is required after the edit');
    await host.release(1); assert.equal(get(store), 'Saved during fetch');
  });
}

test('external change bursts serialize reads and apply the newest queued version', async t => {
  const { host, store } = await harness(t);
  host.bundle.studio.slides[0].name = 'First'; host.changed(['studio.json']);
  host.bundle.studio.slides[0].name = 'Second'; host.changed(['studio.json']);
  assert.equal(host.reads.length, 1);
  await host.release(0); assert.equal(host.reads.length, 2);
  await host.release(1); assert.equal(store.engine.project.slides[0].name, 'Second');
});

test('asset usage includes type-free locale/template overrides, variants and panorama; deletion is guarded', async t => {
  const { store } = await harness(t), project = store.engine.project, slide = project.slides[0];
  slide.layouts.square.layers = [{ id: 'image', type: 'art', src: 'base.png' }];
  const layer = resolveLayers({ project, slide, deviceId: 'square' }).layers[0];
  patchLayer(editBlock(project, slide, 'square', null, 'sv'), layer, { src: 'localized.png' });
  project.templates = { t: { layouts: { square: { overrides: { image: { variants: { square: 'variant.png' } }, hidden: false } } } } };
  project.panorama = { phone: { art: [{ id: 'globe', src: 'globe', variants: { square: 'wide.png' } }] } };
  assert.equal(resolveLayers({ project, slide, deviceId: 'square', localeId: 'sv' }).layers[0].src, 'localized.png');
  assert.deepEqual(store.assetUsage('localized.png'), [{ owner: 'a', deviceKey: 'sv/square', layerId: 'image' }]);
  assert.equal(store.assetUsage('variant.png')[0].owner, 'template:t');
  assert.equal(store.assetUsage('globe.png').length, 1); assert.equal(store.assetUsage('wide.png').length, 1);
  assert.deepEqual(store.assetUsage('unused.png'), []);
  await assert.rejects(store.deleteAsset('localized.png'), /still used/);
});

test('duplicating grouped text preserves translations, review flags and one-step undo/redo without field collisions', async t => {
  const { store } = await harness(t), slide = store.engine.project.slides[0];
  slide.layouts.square.layers[0].group = 'group';
  slide.layouts.square.layers.push({ id: 'shape', type: 'shape', group: 'group', cx: 100, cy: 100, w: 50, h: 50 });
  store.engine.data.copy['en-US'].a['extra-copy'] = 'Text used by another layout';
  store.engine.data.copy.sv._meta.needsReview = ['a.extra'];
  const before = structuredClone(store.engine.data);
  const layers = resolveLayers({ project: store.engine.project, slide, deviceId: 'square' }).layers;
  const added = store.duplicateEditorLayers(slide.layouts.square, layers, layers, { slideId: 'a' });
  const field = added[0].field;
  assert.notEqual(field, 'extra-copy');
  assert.equal(store.getCopy('en-US', 'a', field), 'Offer'); assert.equal(store.getCopy('sv', 'a', field), 'Erbjudande');
  assert.deepEqual(store.engine.data.copy.sv._meta.needsReview, ['a.extra', `a.${field}`]);
  assert.equal(added[0].group, added[1].group); assert.notEqual(added[0].group, 'group');
  assert.ok(store.saves.entries.has('copy:sv')); assert.ok(store.saves.entries.has('studio'));
  const after = structuredClone(store.engine.data);
  assert.equal(store.undo(), true); assert.deepEqual(store.engine.data, before); assert.equal(store.canUndo(), false);
  assert.equal(store.redo(), true); assert.deepEqual(store.engine.data, after);
});

test('template text duplication copies each following slide, arrays and English fallback independently', async t => {
  const { store } = await harness(t), project = store.engine.project;
  project.templates = { t: { layouts: { square: { template: 'custom', layers: [{ id: 'extra', type: 'text', field: 'extra' }] } } } };
  project.slides[0].layouts.square = { use: 't' };
  project.slides.push({ id: 'b', layouts: { square: { use: 't' } } }, { id: 'unrelated', layouts: { square: { template: 'custom' } } });
  store.engine.data.copy['en-US'].b = { extra: ['First', 'Second'] };
  const layers = resolveLayers({ project, slide: project.slides[0], deviceId: 'square' }).layers;
  const [added] = store.duplicateEditorLayers(project.templates.t.layouts.square, layers, layers, { slideId: 'a', templateId: 't' });
  assert.deepEqual(store.getCopy('en-US', 'b', added.field), ['First', 'Second']);
  assert.notEqual(store.getCopy('en-US', 'b', added.field), store.getCopy('en-US', 'b', 'extra'));
  assert.equal(store.getCopy('sv', 'b', added.field), undefined);
  assert.deepEqual(store.engine.copyFor('sv', 'b', added.field), { value: ['First', 'Second'], fallback: true });
  assert.equal(store.engine.data.copy['en-US'].unrelated, undefined);
});

test('undoing a duplicate preserves review flags for subsequent edits on another slide', async t => {
  const { store } = await harness(t), project = store.engine.project, slide = project.slides[0];
  const layers = resolveLayers({ project, slide, deviceId: 'square' }).layers;
  store.duplicateEditorLayers(slide.layouts.square, layers, layers, { slideId: 'a' });
  store.setCopy('en-US', 'b', 'headline', 'Needs independent review');
  store.undo();
  assert.equal(store.getCopy('en-US', 'b', 'headline'), 'Needs independent review');
  assert.deepEqual(store.engine.data.copy['en-US']._meta.needsReview, ['b.headline']);
  store.redo();
  assert.deepEqual(store.engine.data.copy['en-US']._meta.needsReview, ['b.headline']);
});

test('template application preserves matching device sources and locale choices, but discards removed devices', () => {
  const project = fixture().studio, slide = project.slides[0];
  project.devices.other = { ...project.devices.square };
  const devices = [{ id: 'watch', type: 'device', profile: 'watch-ultra', capture: 'watch-workout', captureSet: 'my-watch' }, { id: 'device', type: 'device', capture: 'phone-trips' }, { id: 'removed', type: 'device', capture: 'old' }];
  slide.layouts.square = { template: 'custom', layers: devices };
  slide.layouts.other = structuredClone(slide.layouts.square);
  slide.localeLayouts = { sv: { square: { overrides: { watch: { capture: 'sv-workout' } } } } };
  project.templates = { t: { layouts: { square: { template: 'text-top', layers: [{ id: 'watch', type: 'device', profile: 'watch-ultra', cx: 800 }, { id: 'new', type: 'device', capture: 'new-default' }] } } } };
  const other = structuredClone(slide.layouts.other), locale = structuredClone(slide.localeLayouts);
  followTemplate(project, slide, 't', { deviceIds: ['square'] });
  const layers = resolveLayers({ project, slide, deviceId: 'square' }).layers;
  assert.equal(layers.find(l => l.id === 'watch').capture, 'watch-workout');
  assert.equal(layers.find(l => l.id === 'watch').captureSet, 'my-watch');
  assert.equal(layers.find(l => l.id === 'watch').cx, 800, 'New template geometry still applies');
  assert.equal(layers.find(l => l.id === 'device').capture, 'phone-trips');
  assert.equal(layers.find(l => l.id === 'new').capture, 'new-default');
  assert.equal(slide.layouts.square.overrides.removed, undefined);
  assert.deepEqual(slide.layouts.other, other); assert.deepEqual(slide.localeLayouts, locale);
  assert.equal(resolveLayers({ project, slide, deviceId: 'square', localeId: 'sv' }).layers.find(l => l.id === 'watch').capture, 'sv-workout');
  followTemplate(project, slide, 't');
  assert.equal(resolveLayers({ project, slide, deviceId: 'square' }).layers.find(l => l.id === 'device').capture, 'phone-trips');
});

test('editing reviewed copy exposes review action immediately, then approval clears final-export warning', async t => {
  // Use the same store module as the real inspector, not the isolated race-test instances.
  const store = await import(storeURL.href);
  const { buildTextPanel } = await import('../app/js/ui/text-panel.js');
  const originalDocument = globalThis.document;
  globalThis.document = dom();
  store.saves.schedule = () => null; store.saves.cancel = () => {};
  t.after(() => { store.saves.discard(); globalThis.document = originalDocument; });
  const bundle = fixture(); bundle.studio.slides[0].layouts.square.layers.push({ id: 'headline', type: 'text', field: 'headline' }); bundle.studio.sourceLocale = 'sv'; store.engine.setData({ studio: bundle.studio, copy: bundle.copy });
  const ed = { slide: () => store.engine.project.slides[0], locale: () => store.engine.project.locales[0], refresh() {}, rebuildInspector() {} };
  const panel = buildTextPanel(ed).el;
  const action = () => panel.querySelectorAll('button').find(button => button.textContent === 'Mark reviewed');
  assert.equal(action(), undefined);
  const textarea = panel.querySelector('textarea'); textarea.value = 'Changed headline'; textarea.dispatchEvent(new Event('input'));
  assert.ok(action(), 'Approval action must appear without leaving or rebuilding the text inspector');
  assert.equal(panel.querySelector('textarea'), textarea, 'Typing must keep the existing field');
  const scene = { warnings: [], slide: ed.slide(), layers: [{ id: 'headline', type: 'text', field: 'headline', _layout: {}, _box: { x: 0, y: 0, w: 200, h: 80 } }], fonts: {}, W: 1000, H: 1000, k: 1, deviceDef: bundle.studio.devices.square, localeId: 'en-US', slideId: 'a' };
  assert.deepEqual(preflightScene(scene, store.engine.data).map(w => w.code), ['copy-review']);
  // Suppress only toast lifetime timers; invoke the actual button handler.
  t.mock.method(globalThis, 'setTimeout', () => 0);
  action().dispatchEvent(new Event('click'));
  assert.equal(copyNeedsReview(store.engine.data.copy['en-US']), false);
  assert.deepEqual(preflightScene(scene, store.engine.data), []);
});

test('review status covers draft, wildcard, whole-slide and per-field changes without blocking unrelated slides', () => {
  assert.equal(copyNeedsReview(undefined), true);
  for (const key of ['*', 'a', 'a.headline']) {
    const doc = { _meta: { status: 'approved', needsReview: [key] } };
    assert.equal(copyNeedsReview(doc), true); assert.equal(copyNeedsReview(doc, 'a'), true);
    assert.equal(copyNeedsReview(doc, 'b'), key === '*');
  }
  assert.equal(copyNeedsReview({ _meta: { status: 'approved', needsReview: [] } }), false);
});


test('independent layouts and extra palette colours survive save, undo and redo', async t => {
  const { store } = await harness(t), project = store.engine.project;
  const before = structuredClone(project);
  const token = store.checkpoint();
  setLayoutIndependent(project, project.slides[0], 'square', true);
  setLayoutIndependent(project, project.slides[0], 'square', true, 'sv');
  savePalette(project, 'Season', { bg: '#fafafa', ink: '#123456', swatches: ['#ff9900'] });
  const after = structuredClone(project);
  store.saveStudio(); await store.flushSaves();
  assert.equal(store.undoIf(token), true); assert.deepEqual(store.engine.project, before);
  assert.equal(store.redo(), true); assert.deepEqual(store.engine.project, after);
});

test('image and frame deletion guards include the saved layout used when reconnecting', async t => {
  const { store } = await harness(t);
  store.engine.project.slides[0].layouts.square = { independent: true, template: 'custom', layers: [], linkedLayout: { template: 'custom', layers: [{ id: 'art', src: 'retained.png' }, { id: 'device', frame: { type: 'bezel', name: 'retained' } }] } };
  assert.equal(store.assetUsage('retained.png').length, 1);
  assert.equal(store.frameUsage('retained').length, 1);
  await assert.rejects(store.deleteAsset('retained.png'), /still used/);
});

const { createInspectorMemory } = await import('../app/js/ui/inspector-state.js');
test('inspector repaints retain scroll and disclosure state separately for each editing context', () => {
  const memory = createInspectorMemory();
  const panel = (top, open) => ({ scrollTop: top, sections: [{ dataset: { section: 'export' }, open }], querySelectorAll() { return this.sections; } });
  const before = panel(684, true);
  memory.capture('project-a/slide-a/layers/image', before);
  const rebuilt = panel(0, false);
  memory.restore('project-a/slide-a/layers/image', rebuilt);
  assert.equal(rebuilt.scrollTop, 684); assert.equal(rebuilt.sections[0].open, true);
  const another = panel(0, false);
  memory.restore('project-b/slide-a/layers/image', another);
  assert.equal(another.scrollTop, 0); assert.equal(another.sections[0].open, false);
  rebuilt.scrollTop = 230; rebuilt.sections[0].open = false;
  memory.capture('project-a/slide-a/layers/image', rebuilt);
  memory.restore('project-a/slide-a/layers/image', before);
  assert.equal(before.scrollTop, 230); assert.equal(before.sections[0].open, false);
});

test('compact font menu preserves missing fonts and changes only after user selection', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => reply({ families: ['Arial', 'Helvetica'] });
  const { fontPicker } = await import('../app/js/ui/font-picker.js');
  const changes = [];
  const picker = fontPicker({ value: 'Uninstalled Brand Font', inherited: 'system-ui', onChange: value => changes.push(value) });
  await tick();
  assert.equal(picker.querySelectorAll('select').length, 1);
  assert.equal(picker.querySelectorAll('input').length, 0);
  const select = picker.querySelector('select');
  assert.equal(select.value, 'Uninstalled Brand Font'); assert.equal(select.disabled, false);
  assert.ok(select.textContent.includes('Uninstalled Brand Font (not installed)'));
  assert.deepEqual(changes, []);
  select.value = 'Arial'; select.dispatchEvent(new Event('change'));
  select.value = ''; select.dispatchEvent(new Event('change'));
  assert.deepEqual(changes, ['Arial', undefined]);
});

test('layer drag handles reorder through the real edit operation and refuse locked layers', async () => {
  const { buildLayersPanel } = await import('../app/js/ui/layers-panel.js');
  const layers = [{ id: 'a', type: 'shape', zOrder: 0 }, { id: 'b', type: 'shape', zOrder: 1, locked: true }, { id: 'c', type: 'shape', zOrder: 2 }];
  const block = { template: 'custom', layers: structuredClone(layers) };
  let mutations = 0;
  const ed = { scene: { allLayers: layers }, selectedId: null, selectedIds: new Set(), selectionLayers: () => [], peekBlock: () => block, layerById: id => layers.find(layer => layer.id === id), restack: fn => { mutations++; fn(block); } };
  const panel = buildLayersPanel(ed).el;
  const all = node => [node, ...(node.children ?? []).flatMap(all)];
  const rows = all(panel).filter(node => node.className?.startsWith('layer-row'));
  const rowA = rows.find(row => row.dataset.id === 'a'), rowC = rows.find(row => row.dataset.id === 'c');
  assert.equal(rowA.draggable, 'false');
  const grip = rowA.children[0]; grip.focus = () => {};
  assert.equal(grip.draggable, 'false');
  const documentBefore = globalThis.document;
  document.removeEventListener = () => {};
  const list = rows[0].children ? all(panel).find(node => node.className === 'layer-list') : null;
  list.contains = node => rows.includes(node);
  for (const row of rows) row.classList = { add() {}, remove() {} };
  rowA.isConnected = true;
  rowC.getBoundingClientRect = () => ({ top: 0 }); rowC.offsetHeight = 36;
  rowC.closest = () => rowC;
  panel.getBoundingClientRect = () => ({ top: 0, bottom: 600 });
  document.elementFromPoint = () => rowC;
  const event = (type, clientY) => Object.assign(new Event(type, { cancelable: true }), { button: 0, pointerId: 1, clientY, clientX: 20 });
  grip.dispatchEvent(event('pointerdown', 100));
  grip.dispatchEvent(event('pointermove', 10));
  assert.equal(mutations, 0, 'dragging must not save an intermediate order');
  grip.dispatchEvent(event('pointerup', 10));
  assert.equal(mutations, 1); assert.equal(block.overrides.a.zOrder, 3);
  const lockedGrip = rows.find(row => row.dataset.id === 'b').children[0];
  lockedGrip.dispatchEvent(event('pointerdown', 100));
  lockedGrip.dispatchEvent(event('pointermove', 10));
  lockedGrip.dispatchEvent(event('pointerup', 10));
  assert.equal(mutations, 1);
  grip.dispatchEvent(event('pointerdown', 100));
  grip.dispatchEvent(event('pointermove', 10));
  grip.dispatchEvent(event('pointercancel', 10));
  grip.dispatchEvent(event('pointerup', 10));
  assert.equal(mutations, 1, 'cancelled gestures must not change the document');
  delete documentBefore.elementFromPoint;

});

test('original-language selection persists and restores through undo and redo', async t => {
  const { store, host } = await harness(t);
  store.setOriginalLocale('sv');
  assert.equal(store.engine.project.sourceLocale, 'sv');
  await store.flushSaves(); assert.equal(host.bundle.studio.sourceLocale, 'sv');
  store.undo(); assert.equal(store.engine.project.sourceLocale, undefined);
  store.redo(); assert.equal(store.engine.project.sourceLocale, 'sv');
});

test('manual Check and a reviewed import persist and undo as separate complete actions', async t => {
  const { store } = await harness(t);
  const { exportReviewCSV, readCSV, writeCSV, parseReviewCSV, planReviewImport } = await import('../app/js/review-exchange.js');
  store.engine.project.slides[0].layouts.square.layers.push({ id: 'headline', type: 'text', field: 'headline' });
  store.setTextCheck('sv', 'a', 'headline', true);
  assert.equal(store.needsReview('sv','a','headline'), true);
  store.undo(); assert.equal(store.needsReview('sv','a','headline'), false);
  store.redo(); assert.equal(store.needsReview('sv','a','headline'), true);
  await store.prepareReviewExport();
  const exportedId = store.engine.project.slides[0].reviewId;
  const cells = readCSV(exportReviewCSV(store.engine.project, store.engine.data.copy, ['sv']));
  const row = cells.find(row => row[cells[0].indexOf('field')] === 'headline');
  row[cells[0].indexOf('text')] = 'Granskad text'; row[cells[0].indexOf('decision')] = 'reviewed';
  const rows = parseReviewCSV(writeCSV(cells));
  const before = structuredClone(store.engine.data.copy);
  store.importReviewedCopy(rows, planReviewImport(store.engine.project, store.engine.data.copy, rows).filter(row => row.status === 'ready'));
  assert.equal(store.getCopy('sv','a','headline'), 'Granskad text'); assert.equal(store.needsReview('sv','a','headline'), false);
  await store.flushSaves();
  store.undo(); assert.deepEqual(store.engine.data.copy, before); assert.equal(store.engine.project.slides[0].reviewId, exportedId);
  store.redo(); assert.equal(store.getCopy('sv','a','headline'), 'Granskad text');
  store.editCopy('sv','a','extra','Later typing');
  store.undo(); assert.equal(store.getCopy('sv','a','extra'),'Erbjudande'); assert.equal(store.getCopy('sv','a','headline'),'Granskad text');
});

test('neighbor visibility and opacity persist as UI preferences without saving project data', async () => {
  const values = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const first = await import(`${storeURL.href}?neighbors=${++instance}`);
    first.state.ui.showNeighbors = false;
    first.state.ui.neighborOpacity = 35;
    first.rememberUI();
    const reopened = await import(`${storeURL.href}?neighbors=${++instance}`);
    reopened.restoreUI();
    assert.equal(reopened.state.ui.showNeighbors, false);
    assert.equal(reopened.state.ui.neighborOpacity, 35);
    assert.equal(reopened.state.saving, 0);
  } finally { globalThis.localStorage = previous; }
});


test('deleting a used bezel saves generic replacements before deletion and keeps undo safe', async t => {
  const { store, host } = await harness(t);
  host.autoRead = true;
  const p = store.engine.project;
  const bezel = () => ({ type: 'bezel', name: 'retained' });
  store.engine.data.frames.retained = { screen: { w: 1206, h: 2622 } };
  host.bundle.frames.retained = structuredClone(store.engine.data.frames.retained);
  p.devices.square.frame = bezel();
  p.profiles = { custom: { screen: [1206, 2622], frame: bezel() } };
  p.templates = { shared: { layouts: { square: { overrides: { phone: { frame: bezel() } } } } } };
  p.slides[0].localeLayouts = { sv: { square: { layers: [{ id: 'phone', frame: bezel() }] } } };
  p.slides[0].layouts.square.linkedLayout = { layers: [{ id: 'saved', frame: bezel() }] };
  store.checkpoint();
  await store.deleteFrame('retained');
  assert.equal(host.deletedFrames.length, 1);
  assert.equal(JSON.stringify(host.deletedFrames[0].studio).includes('retained'), false);
  assert.equal(store.frameUsage('retained').length, 0);
  assert.deepEqual(p.devices.square.frame, { type: 'generic', screen: [1206, 2622] });
  assert.equal(p.profiles.iphone.frame.type, 'generic', 'auto-selected hardware also gets generic');
  assert.equal(p.templates.shared.layouts.square.overrides.phone.frame.type, 'generic');
  assert.equal(p.slides[0].localeLayouts.sv.square.layers[0].frame.type, 'generic');
  assert.equal(p.slides[0].layouts.square.linkedLayout.layers[0].frame.type, 'generic');
  store.undo();
  assert.equal(store.frameUsage('retained').length, 0);
  store.redo();
  assert.equal(store.frameUsage('retained').length, 0);
});

test('failed replacement save leaves the bezel file available', async t => {
  const { store, host } = await harness(t);
  store.engine.project.devices.square.frame = { type: 'bezel', name: 'retained' };
  store.engine.data.frames.retained = { screen: { w: 800, h: 1200 } };
  host.bundle.revisions.studio = 'outside-edit';
  await assert.rejects(store.deleteFrame('retained'), /changed outside/);
  assert.equal(host.deletedFrames, undefined);
});
