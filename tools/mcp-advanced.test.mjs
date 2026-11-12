import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAITools } from '../host/ai-screenshots.mjs';
import { createActiveProjectTools } from '../host/active-project-tools.mjs';
import { createStudioService } from '../host/service.mjs';
import { inspectLayers } from '../app/js/agent-layer-inspection.js';
import { vectorToScene, parseVectorPath } from '../app/js/vector-path.js';
import { decodePNG, encodePNG } from './png.mjs';
import { convertFigmaFrame } from '../app/js/figma-layout.js';
import { readLocalInput } from '../host/local-input.mjs';

const rect = (id, cx = 50, extra = {}) => ({ id, type: 'shape', shape: 'rect', cx, cy: 50, w: 100, h: 100, fill: '#cc3355', ...extra });
test('a stalled local file provider cannot freeze the event loop or hold imports indefinitely', async () => {
  const stat = async () => ({ isFile: () => true, size: 4 });
  let signal, ticked = false;
  const pending = readLocalInput('provider-file.ttf', 16, { timeout: 25, stat, read: async (_file, options) => { signal = options.signal; return new Promise(() => {}); } });
  const failed = assert.rejects(pending, /did not become available/);
  await new Promise(resolve => setTimeout(() => { ticked = true; resolve(); }, 1));
  assert.equal(ticked, true); await failed; assert.equal(signal.aborted, true);
  await assert.rejects(readLocalInput('growing.ttf', 16, { stat, read: async () => Buffer.alloc(17) }), /grew beyond/);
  const bytes = Buffer.from('font'); assert.deepEqual(await readLocalInput('ready.ttf', 16, { stat, read: async () => bytes }), bytes);
});
async function fixture(t, options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-native-mcp-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = createAITools(root, { fontCatalog: async () => ({ families: ['Arial'] }), ...options }), project = 'Native.sss';
  let doc = await api.create_project({ project });
  doc.studio.devices.iphone.target = 'custom'; doc.studio.devices.iphone.size = [600, 800]; delete doc.studio.devices.iphone.designSize;
  doc.studio.devices.ipad = { ...doc.studio.devices.iphone, size: [800, 1000], label: 'iPad' };
  doc.studio.locales.push({ id: 'sv-SE', name: 'Swedish', lang: 'sv-SE' });
  doc.studio.slides[0].layouts = { phone: { template: 'custom', panorama: false, layers: [rect('a'), rect('b', 100), rect('c', 300)] } };
  await api.save_document({ project, studio: doc.studio, revision: doc.revisions.studio });
  const read = () => api.read_project({ project });
  const edit = async edits => { const current = await read(); return api.edit_layers({ project, revision: current.revisions.studio, edits: edits.map(e => ({ device: 'iphone', slide: 'first-slide', ...e })) }); };
  const inspect = args => api.inspect_layers({ project, device: 'iphone', slide: 'first-slide', ...args });
  return { root, api, project, read, edit, inspect, disk: () => fs.readFileSync(path.join(root, project, 'studio.json'), 'utf8') };
}

test('discovery describes native capabilities, oriented canvases, names, hardware and exact locale edit scopes', async t => {
  const f = await fixture(t), doc = await f.read();
  const catalog = await f.api.catalog();
  assert.ok(catalog.editing.layerOperations.includes('vector')); assert.ok(catalog.editing.projectOperations.includes('shared_spacing'));
  assert.ok(catalog.editing.shadows.presets.some(p => p.id === 'glow')); assert.ok(doc.hardware);
  const result = await f.api.edit_project({ project: f.project, revision: doc.revisions.studio, edits: [{ op: 'orient_canvas', device: 'iphone', slide: 'first-slide', orientation: 'landscape' }] });
  assert.deepEqual(result.editing[0].screens[0].size, [800, 600]);
  assert.deepEqual((await f.inspect()).designSize, [800, 600]);
  const current = await f.read();
  current.studio.slides[0].localeLayouts = { 'en-US': { iphone: { independent: true, template: 'custom', panorama: false, layers: [rect('figma-card', 70, { name: 'Imported card' })] } } };
  await f.api.save_document({ project: f.project, studio: current.studio, revision: current.revisions.studio });
  assert.equal((await f.read()).editing[0].screens[0].editLocale, 'en-US');
  assert.deepEqual((await f.inspect()).editScope, { device: 'iphone', slide: 'first-slide', locale: 'en-US' });
  await assert.rejects(f.edit([{ op: 'patch', id: 'figma-card', patch: { opacity: .2 } }]), /Supply locale/);
  await f.edit([{ op: 'patch', locale: 'en-US', id: 'figma-card', patch: { opacity: .2 } }]);
  assert.equal((await f.inspect()).layers[0].data.opacity, .2);
});

test('shadow, gradient, outline and appearance edits preserve sibling data and isolate canvas/locale variants', async t => {
  const f = await fixture(t), doc = await f.read(), variant = { scope: 'locale', overrides: { a: { opacity: .7 } } };
  doc.studio.slides[0].localeLayouts = { 'sv-SE': { iphone: variant } };
  const paints = [{ type: 'solid', color: '#112233' }, { type: 'linear', handles: [[0, .5], [1, .5]], stops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }] }];
  doc.studio.slides[0].layouts.phone.layers[0].paints = paints;
  await f.api.save_document({ project: f.project, studio: doc.studio, revision: doc.revisions.studio });
  await f.edit([
    { op: 'shadow', ids: ['a', 'b'], preset: 'soft', distance: 20, angle: 180 },
    { op: 'paint', ids: ['a'], action: 'stop', index: 1, stop: 1, color: '#00ff00', opacity: .5 },
    { op: 'paint', ids: ['a'], action: 'width', width: 8 },
    { op: 'corners', ids: ['a'], radius: 90 },
    { op: 'appearance', ids: ['b'], source: 'a' },
  ]);
  const current = await f.read(), a = (await f.inspect({ ids: ['a'] })).layers[0], b = (await f.inspect({ ids: ['b'] })).layers[0];
  assert.deepEqual(a.data.shadow, { color: '#000000', alpha: .2, blur: 32, dx: -20, dy: 0, angle: 180 });
  assert.equal(a.paints[1].stops[1].color, '#00ff0080'); assert.deepEqual(a.paints[0], paints[0]);
  assert.equal(a.data.radius, 50); assert.deepEqual(b.data.paints, a.data.paints); assert.equal(b.data.cx, 100);
  assert.deepEqual(current.studio.slides[0].layouts.phone.layers[0].paints, paints);
  assert.deepEqual(current.studio.slides[0].localeLayouts['sv-SE'].iphone, variant);
  assert.equal((await f.api.inspect_layers({ project: f.project, device: 'ipad', slide: 'first-slide', ids: ['a'] })).layers[0].data.shadow, undefined);
  await f.edit([{ op: 'shadow', ids: ['a'], enabled: false }, { op: 'shadow', ids: ['a'] }]);
  assert.equal((await f.inspect({ ids: ['a'] })).layers[0].shadow.distance, 20);
});

test('groups, mask release and stacking use native editable members, including a shared row', async t => {
  const f = await fixture(t);
  await f.edit([{ op: 'group', ids: ['a', 'b'], group: 'cards' }, { op: 'mask', ids: ['a', 'b'], mask: 'b' }]);
  let inspected = await f.inspect();
  const mask = Object.values(inspected.masks)[0]; assert.deepEqual(mask, { mask: 'b', members: ['a', 'b'] });
  assert.equal(inspected.layers.find(l => l.id === 'a').data.compositing.at(-1).maskId, 'b');
  await f.edit([{ op: 'unmask', ids: ['a'] }]);
  inspected = await f.inspect(); assert.deepEqual(Object.keys(inspected.masks), []); assert.deepEqual(inspected.groups.cards, ['a', 'b']);
  await f.edit([{ op: 'ungroup', ids: ['a'] }, { op: 'reorder', ids: ['a'], direction: 'front' }]);
  inspected = await f.inspect(); assert.equal(inspected.layers.at(-1).id, 'a'); assert.deepEqual(Object.keys(inspected.groups), []);
  const shared = edits => edits.map(e => ({ device: 'iphone', shared: true, ...e }));
  let doc = await f.read(); await f.api.edit_layers({ project: f.project, revision: doc.revisions.studio, edits: shared([{ op: 'add', layer: rect('flow-a') }, { op: 'add', layer: rect('flow-b', 600) }, { op: 'mask', ids: ['flow-a', 'flow-b'] }, { op: 'shadow', ids: ['flow-a'], preset: 'glow' }]) });
  const row = await f.api.inspect_layers({ project: f.project, device: 'iphone', shared: true });
  assert.equal(row.layers[0].data.shadow.color, '#ffffff'); assert.equal(row.layers[1].data.maskOnly, true);
  assert.deepEqual(row.editScope, { device: 'iphone', shared: true });
  doc = await f.read(); assert.doesNotMatch(JSON.stringify(doc.studio.sharedCanvas), /_origin/);
});

test('boolean MCP edits keep vector geometry and retain the untouched source canvas', async t => {
  for (const [operation, width, cx] of [['unite', 150, 75], ['subtract', 50, 25], ['intersect', 50, 75], ['exclude', 150, 75]]) {
    const f = await fixture(t);
    await f.edit([{ op: 'boolean', ids: ['b', 'a'], operation, resultId: 'combined' }]);
    const layers = (await f.inspect()).layers, result = layers.find(l => l.id === 'combined').data;
    assert.equal(result.shape, 'path'); assert.equal(result.w, width); assert.equal(result.cx, cx); assert.equal(result.fill, '#cc3355');
    assert.ok(parseVectorPath(result.paths[0].d).some(c => c.cmd === 'Z')); assert.equal(layers.some(l => ['a', 'b'].includes(l.id)), false);
    const doc = await f.read(); assert.equal(doc.studio.slides[0].layouts.phone.layers.length, 3);
  }
});

test('vector operations expose original anchors and preserve affine geometry and unrelated paint data', async t => {
  const f = await fixture(t), layer = { id: 'curve', type: 'shape', shape: 'path', cx: 240, cy: 220, w: 300, h: 160, pathSize: [150, 80], pathOffset: [10, 20], basis: [1, .2, -.1, 1], rotate: 22,
    paths: [{ d: 'M10 20C40 20 90 100 160 100L10 100Z', rule: 'nonzero' }], paints: [{ type: 'linear', handles: [[0, 0], [1, 1]], stops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }] }] };
  await f.edit([{ op: 'add', layer }]);
  const before = (await f.inspect({ ids: ['curve'], vectors: true })).layers[0];
  assert.deepEqual(before.vector.paths[0].anchors[0].point, [10, 20]);
  const originalPoint = vectorToScene(layer, [10, 100]);
  await f.edit([{ op: 'vector', id: 'curve', action: 'move_anchor', command: 1, point: [180, 90] }]);
  const after = (await f.inspect({ ids: ['curve'], vectors: true })).layers[0];
  assert.deepEqual(after.data.basis, layer.basis); assert.equal(after.data.rotate, layer.rotate);
  const fixed = vectorToScene(after.data, [10, 100]); assert.ok(Math.hypot(fixed[0] - originalPoint[0], fixed[1] - originalPoint[1]) < 1e-6);
  assert.deepEqual(after.data.paints[0].stops, layer.paints[0].stops);
  const disk = f.disk(); await assert.rejects(f.edit([{ op: 'vector', id: 'curve', action: 'move_handle', command: 0, offset: 0, point: [1, 2] }]), /Choose a handle/); assert.equal(f.disk(), disk);
});

test('invalid batches, mask members, private fields, locked layers and stale revisions save nothing', async t => {
  const f = await fixture(t), original = f.disk();
  for (const edit of [
    { op: 'corners', ids: ['a'], radius: NaN },
    { op: 'boolean', ids: ['a', 'c'], operation: 'intersect' },
    { op: 'shadow', ids: ['a'], preset: 'unknown' },
    { op: 'group', ids: ['a', 'missing'] },
    { op: 'paint', ids: ['a'], action: 'stop', stop: 12 },
    { op: 'appearance', ids: ['a'], appearance: { shadow: { _secret: 'bad' } } },
  ]) { await assert.rejects(f.edit([{ op: 'patch', id: 'a', patch: { opacity: .2 } }, edit])); assert.equal(f.disk(), original); }
  const doc = await f.read(); await f.edit([{ op: 'patch', id: 'b', patch: { locked: true } }]);
  await assert.rejects(f.edit([{ op: 'shadow', ids: ['a', 'b'], preset: 'soft' }]), /locked/);
  await assert.rejects(f.api.edit_layers({ project: f.project, revision: doc.revisions.studio, edits: [{ op: 'remove', device: 'iphone', slide: 'first-slide', id: 'a' }] }), /409/);
  await f.edit([{ op: 'patch', id: 'b', patch: { locked: false } }, { op: 'mask', ids: ['a', 'b'] }, { op: 'patch', id: 'b', patch: { locked: true } }]);
  const masked = f.disk(); await assert.rejects(f.edit([{ op: 'unmask', ids: ['a'] }]), /every member/); assert.equal(f.disk(), masked);
});

test('project operations isolate templates, retain locale orders, and fail an invalid structural batch atomically', async t => {
  const f = await fixture(t); let doc = await f.read();
  doc.studio.slides.push({ ...structuredClone(doc.studio.slides[0]), id: 'second', name: 'Second' });
  await f.api.save_document({ project: f.project, studio: doc.studio, revision: doc.revisions.studio }); doc = await f.read();
  const saved = await f.api.edit_project({ project: f.project, revision: doc.revisions.studio, edits: [
    { op: 'save_template', slide: 'first-slide', name: 'Cards' },
    { op: 'shared_spacing', device: 'iphone', preset: 'google-play' },
    { op: 'reorder_slide', slide: 'second', relativeTo: 'first-slide', after: false, locale: 'en-US' },
    { op: 'add_canvas', canvas: { label: 'Wide campaign', size: [1200, 800], reuseFrom: 'ipad' } },
  ] });
  assert.equal(saved.results[0].template, 'cards'); assert.equal(saved.results[3].device, 'wide-campaign');
  doc = await f.read(); assert.equal(doc.studio.sharedCanvas.iphone.gap, .04);
  assert.deepEqual(doc.studio.slideOrders['en-US'], ['second', 'first-slide']); assert.deepEqual(doc.studio.slideOrders['sv-SE'], ['first-slide', 'second']);
  await f.api.edit_project({ project: f.project, revision: doc.revisions.studio, edits: [{ op: 'apply_template', slide: 'second', template: 'cards', devices: ['iphone'] }] });
  doc = await f.read(); assert.equal(doc.studio.slides[1].layouts.iphone.use, 'cards'); assert.equal(doc.studio.slides[1].layouts.phone.use, undefined);
  const before = f.disk(); await assert.rejects(f.api.edit_project({ project: f.project, revision: doc.revisions.studio, edits: [{ op: 'rename_slide', slide: 'second', name: 'Changed' }, { op: 'orient_canvas', device: 'unknown', slide: 'second', orientation: 'landscape' }] }), /Unknown canvas/); assert.equal(f.disk(), before);
});

test('font import validates bytes, embeds faces portably, reports missing families and rejects stale writes before assets', async t => {
  const f = await fixture(t, { resolveFonts: async families => ({ fonts: [], missing: families }) }), font = path.join(f.root, 'font.ttf');
  fs.copyFileSync(new URL('./fixtures/fonts/Mulish.ttf', import.meta.url), font);
  const before = await f.read(); const result = await f.api.import_fonts({ project: f.project, revision: before.revisions.studio, sources: ['font.ttf'] });
  assert.equal(result.fonts[0].family, 'Mulish'); assert.equal(result.fonts[0].weight, '200 1000');
  assert.ok(fs.existsSync(path.join(f.root, f.project, 'assets/fonts', result.fonts[0].file)));
  assert.equal((await f.read()).studio.fonts.files[0].file, result.fonts[0].file);
  await assert.rejects(f.api.import_fonts({ project: f.project, revision: before.revisions.studio, sources: ['font.ttf'] }), /409/);
  await f.edit([{ op: 'add', layer: { id: 'title', type: 'text', field: 'headline', x: 10, capTop: 10, w: 500, size: 60, fontFamily: 'Mulish' } }]);
  const catalog = await f.api.font_catalog({ project: f.project, search: 'Mulish' }); assert.deepEqual(catalog.installed, []); assert.equal(catalog.embedded[0].family, 'Mulish'); assert.deepEqual(catalog.missing, []); assert.equal(catalog.usage.length, 2);
  const current = await f.read(), disk = f.disk();
  const missing = await f.api.import_fonts({ project: f.project, revision: current.revisions.studio, families: ['Private font'] }); assert.deepEqual(missing.missing, ['Private font']); assert.equal(f.disk(), disk);
  fs.writeFileSync(path.join(f.root, 'invalid.ttf'), 'bad bytes'); await assert.rejects(f.api.import_fonts({ project: f.project, revision: current.revisions.studio, sources: ['invalid.ttf'] }), /valid OpenType/); assert.equal(f.disk(), disk);
});

test('Figma preparation returns collision-safe native and copy plans without applying either, then those plans save visibly', async t => {
  const f = await fixture(t), source = path.join(f.root, 'figma.json');
  const frame = { id: '1:1', type: 'FRAME', name: 'Cards', size: { x: 300, y: 400 }, fills: [], children: [
    { id: '1:2', type: 'RECTANGLE', name: 'Figma card', size: { x: 200, y: 150 }, relativeTransform: [[1, 0, 20], [0, 1, 30]], fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: .2 } }] },
    { id: '1:3', type: 'TEXT', name: 'Figma title', size: { x: 200, y: 50 }, relativeTransform: [[1, 0, 25], [0, 1, 50]], characters: 'Editable from Figma', style: { fontFamily: 'Mulish', fontSize: 28, fontWeight: 600 }, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] },
  ] };
  fs.writeFileSync(source, JSON.stringify(frame));
  const frames = await f.api.prepare_design_import({ project: f.project, source: 'figma.json', action: 'inspect' }); assert.equal(frames.frames[0].id, '1:1');
  const doc = await f.read(), disk = f.disk();
  const plan = await f.api.prepare_design_import({ project: f.project, source: 'figma.json', action: 'prepare', device: 'iphone', slide: 'first-slide', locale: 'sv-SE', revision: doc.revisions.studio });
  assert.equal(plan.applied, false); assert.equal(plan.edits.length, 2); assert.equal(f.disk(), disk); assert.deepEqual((await f.read()).copy, doc.copy);
  assert.ok(plan.edits.every(e => e.locale === 'sv-SE')); assert.ok(plan.edits.some(e => e.layer.type === 'text')); assert.deepEqual(plan.fonts, ['Mulish']);
  await f.api.edit_layers({ project: f.project, edits: plan.edits, revision: plan.revision });
  await f.api.save_copy({ project: f.project, locale: 'sv-SE', copy: plan.copy, revision: plan.copyRevision });
  const inspected = await f.inspect({ locale: 'sv-SE' }); assert.equal(inspected.layers.find(l => l.type === 'text').text.value, 'Editable from Figma');
  const updated = await f.read(); assert.equal(updated.copy['sv-SE']._meta.status, 'draft'); assert.equal(updated.studio.slides[0].layouts.phone.layers.length, 3);
  const second = await f.api.prepare_design_import({ project: f.project, source: 'figma.json', action: 'prepare', device: 'iphone', slide: 'first-slide', locale: 'sv-SE', revision: updated.revisions.studio });
  assert.ok(second.edits.every(e => !plan.edits.some(old => old.layer.id === e.layer.id)));
  await assert.rejects(f.api.prepare_design_import({ project: f.project, source: '../escape.json', action: 'inspect' }), /Invalid project path/);
});

test('active-app native edits reject old sessions and notify the existing editor after a successful save', async t => {
  const f = await fixture(t), project = path.join(f.root, f.project), service = createStudioService({ appPath: path.resolve('app'), projectPath: project, exportPath: path.join(project, 'export'), origin: 'studio://local' });
  t.after(() => service.close()); const notifications = [];
  const active = createActiveProjectTools({ getCurrent: () => ({ project, service, session: 'native-session' }), flush: async () => {}, changed: files => notifications.push(files), fontCatalog: async () => ({ families: [] }) });
  const doc = await active.invoke('read_project');
  for (const name of ['inspect_layers', 'edit_project', 'font_catalog', 'import_fonts', 'prepare_design_import', 'arrange_layers']) await assert.rejects(active.invoke(name, { projectSession: 'old' }), /active project changed/);
  const result = await active.invoke('edit_layers', { projectSession: 'native-session', revision: doc.revisions.studio, edits: [{ op: 'shadow', device: 'iphone', slide: 'first-slide', ids: ['a'], preset: 'soft' }] });
  assert.equal(result.projectSession, 'native-session'); assert.deepEqual(notifications, [['studio.json']]);
  assert.equal((await active.invoke('inspect_layers', { projectSession: 'native-session', device: 'iphone', slide: 'first-slide' })).layers[0].data.shadow.blur, 32);
});

test('remote Figma preparation uses the injected saved connection and keeps image fills native', async t => {
  const calls = [], design = convertFigmaFrame({id:'1:1',type:'FRAME',name:'Image card',size:{x:300,y:400},children:[{id:'1:2',type:'RECTANGLE',name:'Photo',size:{x:300,y:400},fills:[{type:'IMAGE',imageRef:'photo',scaleMode:'FILL'}]}]});
  const image = encodePNG({width:300,height:400,channels:3,data:Buffer.alloc(300*400*3,128)});
  const f = await fixture(t,{figmaRequest:async input=>{calls.push(input);return input.action==='inspect'?{frames:[{id:'1:1',width:300,height:400}],version:'pinned'}:{designs:[{id:'1:1',...design}],images:{photo:{mime:'image/png',data:image.toString('base64')}}};}});
  const doc = await f.read(), disk=f.disk();
  await f.api.prepare_design_import({project:f.project,url:'https://www.figma.com/design/demo/Card',action:'inspect'});
  const plan = await f.api.prepare_design_import({project:f.project,url:'https://www.figma.com/design/demo/Card',action:'prepare',ids:['1:1'],version:'pinned',device:'iphone',slide:'first-slide',revision:doc.revisions.studio});
  assert.deepEqual(calls.map(c=>c.action),['inspect','load']);assert.equal(calls[1].version,'pinned');assert.ok(calls.every(c=>!('token'in c)));
  assert.equal(plan.edits[0].layer.type,'shape');assert.equal(plan.edits[0].layer.paints[0].type,'image');assert.equal(plan.edits[0].layer.paints[0].ref,undefined);
  assert.ok(fs.existsSync(path.join(f.root,f.project,'assets/art',plan.edits[0].layer.paints[0].src)));
  assert.equal(f.disk(),disk);assert.deepEqual((await f.read()).copy,doc.copy);
});

test('arrangement uses measured text/device geometry and rejects renderer revision drift', async t => {
  let revisions;
  const f = await fixture(t, { exportProject: async input => ({ report: { checked: 1, issues: [] }, selection: { locales: input.locales, devices: input.devices, slides: input.slides }, revisions, scenes: [{ device: 'iphone', slide: 'first-slide', locale: 'en-US', designSize: [600, 800], layers: [{ id: 'a', scope: {}, bounds: { x: 30, y: 40, w: 100, h: 100, rot: 0 } }, { id: 'b', scope: {}, bounds: { x: 80, y: 250, w: 100, h: 100, rot: 0 } }] }] }) });
  const doc = await f.read(); revisions = doc.revisions;
  const aligned = await f.api.arrange_layers({ project: f.project, device: 'iphone', slide: 'first-slide', ids: ['a', 'b'], operation: 'left', revision: revisions.studio });
  assert.equal(aligned.arranged, 2); assert.deepEqual((await f.inspect({ ids: ['a', 'b'] })).layers.map(l => l.data.cx), [80, 80]);
  const disk = f.disk(); await assert.rejects(f.api.arrange_layers({ project: f.project, device: 'iphone', slide: 'first-slide', ids: ['a', 'b'], operation: 'top', revision: aligned.revision }), /changed while measuring/); assert.equal(f.disk(), disk);
});

test('text inspection matches blank translation and legacy English fallback without mutating source data', () => {
  const studio = { devices: { phone: { size: [600, 800], layout: 'phone' } }, sourceLocale: 'sv-SE', locales: [{ id: 'sv-SE' }, { id: 'de-DE' }, { id: 'en-US' }], slides: [{ id: 'one', layouts: { phone: { template: 'custom', panorama: false, layers: [{ id: 'title', type: 'text', field: 'headline', x: 0, capTop: 0, w: 100, size: 20 }] } } }] };
  const bundle = { studio, revisions: { studio: 'revision' }, copy: { 'sv-SE': { one: { headline: '' } }, 'de-DE': { one: { headline: '  ' } }, 'en-US': { one: { headline: 'Legacy fallback' } } } };
  const before = JSON.stringify(bundle), text = inspectLayers(bundle, { device: 'phone', slide: 'one', locale: 'de-DE' }).layers[0].text;
  assert.equal(text.value, 'Legacy fallback'); assert.equal(text.from, 'en-US'); assert.equal(text.fallback, true); assert.equal(JSON.stringify(bundle), before);
});

test('real renderer measures native edits, aligns text and exports boolean/masked geometry as RGB', { skip: !process.env.STUDIO_MCP_RENDER_TEST }, async t => {
  const f = await fixture(t);
  await f.edit([{ op: 'boolean', ids: ['b', 'a'], operation: 'subtract', resultId: 'cut' }]);
  const exported = await f.api.export_project({ project: f.project, devices: ['iphone'], locales: ['en-US'] });
  const png = fs.readFileSync(exported.files[0].absolutePath), image = decodePNG(png);
  assert.equal(png[25], 2); assert.deepEqual([image.width, image.height], [600, 800]);
  const pixel = (x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
  assert.deepEqual(pixel(25, 50), [204, 51, 85]); assert.notDeepEqual(pixel(75, 50), [204, 51, 85]);
  await f.edit([{ op: 'add', layer: { id: 'title', type: 'text', field: 'headline', x: 150, capTop: 200, w: 350, size: 44, minSize: 30, boxHeight: 120 } }]);
  let doc = await f.read();
  await f.api.arrange_layers({ project: f.project, revision: doc.revisions.studio, device: 'iphone', slide: 'first-slide', ids: ['title', 'cut'], operation: 'left' });
  const preview = await f.api.preview_project({ project: f.project, locales: ['en-US'], devices: ['iphone'], details: true });
  const scene = preview.structuredContent.scenes[0];
  assert.deepEqual(scene.size, [600, 800]); assert.ok(scene.layers.find(l => l.id === 'title').text.lines > 0);
  assert.equal(scene.layers.find(l => l.id === 'title').bounds.x, scene.layers.find(l => l.id === 'cut').bounds.x);
  doc = await f.read(); assert.equal(preview.structuredContent.revisions.studio, doc.revisions.studio);
  await f.edit([{ op: 'mask', ids: ['c', 'cut'], mask: 'cut' }]);
  const masked = await f.api.preflight_project({ project: f.project, locales: ['en-US'], devices: ['iphone'], details: true });
  assert.ok(masked.scenes[0].layers.some(l => l.id === 'cut'));
});
