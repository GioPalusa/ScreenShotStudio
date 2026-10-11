import { layoutProject } from '../tests/fixtures/layout-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SaveQueue } from '../app/js/save-queue.js';
import { atomicWrite, revision, copyProject } from '../host/files.mjs';
import { ExportSessions } from '../host/export-sessions.mjs';
import { createStudioService } from '../host/service.mjs';
import { migrateDocument } from '../app/js/document.js';
import { addDevice, deviceProfileUsage, removeDeviceProfile } from '../app/js/project-ops.js';
import { resolveLayers } from '../app/js/layouts.js';
import { editBlock, patchLayer, geometryPatch, scaleLayerGeometry } from '../app/js/layer-ops.js';
import { deviceForLayer, profilesFor, availableProfilesFor, profileChoices } from '../app/js/profiles.js';
import { arrangeSelection, selectionBounds, transformSelection } from '../app/js/selection.js';
import { preflightScene, preflightSelection } from '../app/js/preflight.js';
import { layoutText } from '../app/js/text.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = layoutProject;
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const queue = opts => new SaveQueue({ schedule: () => 1, cancel: () => {}, ...opts });

test('removing a library device preserves existing hardware across localized designs and templates', () => {
  const project = { devices: { phone: { size: [1320, 2868], capture: 'phone' } }, slides: [{ id: 'one', layouts: { phone: { layers: [{ profile: 'iphone' }] } }, localeLayouts: { sv: { phone: { overrides: { hero: { profile: 'iphone' } } } } } }], templates: { reuse: { layouts: { phone: { layers: [{ profile: 'iphone' }] } } } } };
  const frames = { real: { screen: { w: 1206, h: 2622 } } };
  const layer = { profile: 'iphone' }, before = deviceForLayer(project, project.devices.phone, layer, frames);
  assert.deepEqual(deviceProfileUsage(project, 'iphone').map(use => [use.type, use.count]), [['screen', 2], ['template', 1]]);
  assert.equal(removeDeviceProfile(project, 'iphone', frames), true);
  assert.equal(availableProfilesFor(project, frames).iphone, undefined);
  assert.deepEqual(deviceForLayer(project, project.devices.phone, layer, frames), before);
  assert.match(profileChoices(project, frames, 'iphone')[0][1], /removed from library/);
  assert.ok(!profileChoices(project, frames).some(([id]) => id === 'iphone'));
  assert.deepEqual(deviceForLayer(JSON.parse(JSON.stringify(project)), project.devices.phone, layer, {}), before);
  assert.equal(removeDeviceProfile(project, 'iphone', frames), false);
  assert.ok(availableProfilesFor({}).iphone, 'removal must not affect another project');
});

test('unused custom library devices are removed without affecting output canvases', () => {
  const project = { devices: { custom: { size: [500, 700] } }, profiles: { mine: { label: 'Mine', screen: [400, 600], capture: 'mine', frame: { type: 'plain' } } }, slides: [] };
  const canvases = structuredClone(project.devices);
  assert.equal(removeDeviceProfile(project, 'mine'), true);
  assert.equal(project.profiles.mine, undefined);
  assert.equal(profilesFor(project).mine, undefined);
  assert.deepEqual(project.devices, canvases);
  assert.deepEqual(project.removedProfiles, ['mine']);
});

test('default timers retain the browser receiver instead of calling Window methods on SaveQueue', async t => {
  const validReceiver = receiver => assert.ok(receiver === undefined || receiver === globalThis, 'Illegal invocation of a Window timer');
  let scheduled = 0;
  t.mock.method(globalThis, 'setTimeout', function () { validReceiver(this); scheduled++; return 1; });
  t.mock.method(globalThis, 'clearTimeout', function () { validReceiver(this); });
  const writes = [];
  const q = new SaveQueue({ write: async (_key, data) => writes.push(data) });
  q.enqueue('copy:en-US', { headline: 'Edited' });
  assert.equal(scheduled, 1);
  await q.flush(); assert.deepEqual(writes, [{ headline: 'Edited' }]); assert.equal(q.dirty, false);
});

test('seven failed saves remain dirty and recoverable until a write is acknowledged', async () => {
  let fail = true, status, recovery;
  const q = queue({ write: async () => { if (fail) throw new Error('disk full'); }, changed: value => { status = value; }, persist: value => { recovery = value; } });
  q.enqueue('studio', { value: 42 });
  for (let i = 0; i < 7; i++) await assert.rejects(q.flush(), /disk full/);
  assert.equal(q.dirty, true); assert.equal(status.failed, true); assert.equal(status.lastSaved, null);
  assert.deepEqual(recovery[0].data, { value: 42 });
  fail = false; await q.flush(); assert.equal(q.dirty, false); assert.equal(status.failed, false); assert.equal(recovery.length, 0);
});
test('edits made during a save are serialized and the newest value is written', async () => {
  let release;
  const written = [];
  const q = queue({ write: async (_key, data) => { written.push(data); if (written.length === 1) await new Promise(r => { release = r; }); } });
  const original = { n: 1 }; q.enqueue('studio', original); original.n = 99;
  const pending = q.flush(); q.enqueue('studio', { n: 2 }); release(); await pending;
  assert.deepEqual(written, [{ n: 1 }, { n: 2 }]); assert.equal(q.dirty, false);
});
test('failed visibility flush retains the entry and schedules retry', async () => {
  let retries = 0;
  const q = queue({ schedule: () => ++retries, write: async () => { throw new Error('offline'); } });
  q.enqueue('copy:sv', { title: 'Hej' }); await assert.rejects(q.flush({ keepalive: true }));
  assert.equal(q.entries.size, 1); assert.equal(retries, 2);
});
test('conflicts are retained without automatic overwrite', async () => {
  let calls = 0;
  const q = queue({ write: async () => { calls++; throw Object.assign(new Error('conflict'), { status: 409 }); } });
  q.enqueue('studio', {}); await assert.rejects(q.flush(), /conflict/); assert.equal(calls, 1); assert.equal(q.dirty, true);
});
test('atomic saves reject stale revisions and retain the exact previous bytes', t => {
  const root = temp(t), file = path.join(root, 'studio.json');
  atomicWrite(file, '{"a":1}'); const old = revision(file);
  atomicWrite(file, '{"a":2}', { backupRoot: root, expected: old });
  assert.throws(() => atomicWrite(file, '{"a":3}', { backupRoot: root, expected: old }), /changed outside/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":2}');
  const backup = fs.readdirSync(path.join(root, '.history/studio.json'))[0];
  assert.equal(fs.readFileSync(path.join(root, '.history/studio.json', backup), 'utf8'), '{"a":1}');
  assert.equal(fs.existsSync(`${file}.studio-lock`), false);
});
test('a live writer lock prevents overlapping writes; stale locks can recover', t => {
  const root = temp(t), file = path.join(root, 'studio.json');
  fs.writeFileSync(`${file}.studio-lock`, String(process.pid));
  assert.throws(() => atomicWrite(file, 'new'), /Another window/);
  fs.writeFileSync(`${file}.studio-lock`, '99999999');
  atomicWrite(file, 'recovered'); assert.equal(fs.readFileSync(file, 'utf8'), 'recovered');
  fs.writeFileSync(`${file}.studio-lock`, '');
  fs.utimesSync(`${file}.studio-lock`, new Date(0), new Date(0));
  atomicWrite(file, 'empty lock recovered'); assert.equal(fs.readFileSync(file, 'utf8'), 'empty lock recovered');
});
test('symlinked project paths cannot write outside the project', t => {
  const root = temp(t), outside = temp(t);
  fs.symlinkSync(outside, path.join(root, 'copy'));
  assert.throws(() => atomicWrite(path.join(root, 'copy/sv.json'), '{}', { backupRoot: root }), /symbolic links/);
  assert.equal(fs.readdirSync(outside).length, 0);
});
test('Save As cannot recursively copy into a symlinked descendant', t => {
  const root = temp(t), source = path.join(root, 'source'); fs.mkdirSync(source);
  fs.symlinkSync(source, path.join(root, 'alias'));
  assert.throws(() => copyProject(source, path.join(root, 'alias/copy')), /outside the current project/);
  assert.deepEqual(fs.readdirSync(source), []);
});
test('v1 projects migrate without changing layouts and newer versions are refused', () => {
  const before = fixture(), migrated = migrateDocument(before);
  assert.equal(migrated.version, 2); assert.deepEqual(migrated.slides, before.slides); assert.deepEqual(migrated.devices, before.devices);
  assert.throws(() => migrateDocument({ ...before, version: 999 }), /newer/);
  assert.throws(() => migrateDocument({ ...before, slides: [] }), /at least one slide/);
});
test('new custom canvases are empty even when a matching family already has layouts', () => {
  const project = fixture();
  const id = addDevice(project, { label: 'Watch', size: [422, 514], layout: 'phone', capture: 'watch' });
  for (const slide of project.slides) assert.deepEqual(resolveLayers({ project, slide, deviceId: id }).layers, []);
});
test('Watch and phone layers have independent sources on the same output canvas', () => {
  const p = fixture(), canvas = p.devices.iphone;
  assert.equal(deviceForLayer(p, canvas, { profile: 'watch-ultra' }).capture, 'watch-ultra');
  assert.deepEqual(deviceForLayer(p, canvas, { profile: 'watch-ultra' }).size, [422, 514]);
  assert.equal(deviceForLayer(p, canvas, { profile: 'iphone', captureSet: 'custom' }).capture, 'custom');
  assert.deepEqual(deviceForLayer(p, canvas), canvas);
});
test('displayed devices use matching project bezels, preferring the configured canvas frame', () => {
  const project = fixture(), canvas = project.devices.iphone;
  const meta = (w, h) => ({ screen: { x: 0, y: 0, w, h } });
  const frames = { 'a-phone': meta(1206, 2622), 'iphone-17-pro-orange': meta(1206, 2622), 'ipad-pro-11': meta(1640, 2360), 'watch-ultra': meta(422, 514), 'tv-or-vision': meta(3840, 2160) };
  const before = structuredClone(project);
  const phone = deviceForLayer(project, canvas, { profile: 'iphone' }, frames);
  assert.deepEqual(phone.frame, { type: 'bezel', name: 'iphone-17-pro-orange' });
  const ipad = deviceForLayer(project, canvas, { profile: 'ipad' }, frames);
  assert.deepEqual(ipad.frame, { type: 'bezel', name: 'ipad-pro-11' });
  assert.equal(ipad.capture, 'ipad'); assert.deepEqual(ipad.size, [1640, 2360]);
  assert.deepEqual(profilesFor(project, frames)['watch-ultra'].frame, { type: 'bezel', name: 'watch-ultra' });
  assert.equal(profilesFor(project, frames)['watch-series'].frame.type, 'plain', 'A differently sized Watch bezel must not be substituted');
  assert.equal(profilesFor(project, frames).vision.frame.type, 'plain', 'Shared screen dimensions cannot distinguish TV from Vision hardware');
  assert.deepEqual(project, before, 'Default discovery must not mutate a saved project');
  phone.frame.name = 'changed'; assert.deepEqual(project, before);
});
test('explicit device profile frames, including screenshot-only, override automatic bezel matching', () => {
  const project = fixture(), frames = { 'ipad-pro-11': { screen: { w: 1640, h: 2360 } } };
  project.profiles = { ipad: { label: 'My tablet', screen: [1640, 2360], capture: 'tablet', frame: { type: 'plain', radius: 10 } } };
  assert.deepEqual(deviceForLayer(project, project.devices.iphone, { profile: 'ipad' }, frames).frame, { type: 'plain', radius: 10 });
  assert.deepEqual(deviceForLayer(project, project.devices.iphone, {}, frames), project.devices.iphone, 'Canvas default remains unchanged');
});
test('language geometry overrides leave the shared layout and other languages intact', () => {
  const project = fixture(), slide = project.slides[0];
  const shared = resolveLayers({ project, slide, deviceId: 'iphone' }).layers;
  const layer = shared.find(l => l.type === 'device');
  patchLayer(editBlock(project, slide, 'iphone', null, 'sv'), layer, { cx: 123, rotate: 22 });
  const resolve = localeId => resolveLayers({ project, slide, deviceId: 'iphone', localeId }).layers.find(l => l.id === layer.id);
  assert.equal(resolve('sv').cx, 123); assert.equal(resolve('en-US').cx, layer.cx);
  delete slide.localeLayouts.sv.iphone; assert.equal(resolve('sv').cx, layer.cx);
});
test('text can resize vertically and rotate without forcing height during a move', () => {
  const layer = { type: 'text', x: 0, w: 200, _box: { x: 0, y: 0, w: 200, h: 50 } };
  const resized = geometryPatch(layer, { x: 0, y: 0, w: 200, h: 90, rot: 30 });
  assert.equal(resized.boxHeight, 90); assert.equal(resized.rotate, 30);
  assert.equal(geometryPatch(layer, { x: 10, y: 10, w: 200, h: 50 }).boxHeight, undefined);
  assert.equal(scaleLayerGeometry({ ...layer, boxHeight: 90 }, { W: 400, H: 800 }, { W: 800, H: 1600 }).boxHeight, 180);
});
test('manual text height includes glyphs on a single line, not only baseline distances', () => {
  const ctx = { font: '', measureText(text) { const size = Number(/([0-9.]+)px/.exec(this.font)[1]); return { width: text.length * size * 0.5, actualBoundingBoxAscent: size * 0.7, actualBoundingBoxDescent: size * 0.2 }; } };
  const tooShort = layoutText(ctx, 'Hello', { family: 'system-ui', size: 100, minSize: 50, boxW: 1000, heightIncludesGlyphs: true, maxHeight: 20 });
  assert.equal(tooShort.overflow, true);
  const fits = layoutText(ctx, 'Hello', { family: 'system-ui', size: 100, minSize: 20, boxW: 1000, heightIncludesGlyphs: true, maxHeight: 40 });
  assert.equal(fits.overflow, false); assert.ok(fits.size < 45);
});
test('alignment and equal spacing preserve layer sizes and locked layers', () => {
  const layers = [0, 40, 100].map((x, i) => ({ id: String(i), _box: { x, y: i * 20, w: 20, h: 10 } }));
  const spaced = arrangeSelection(layers, 'distribute-x', {});
  assert.deepEqual(spaced.map(p => p.box.x), [0, 50, 100]);
  const aligned = arrangeSelection(layers, 'top', {}); assert.deepEqual(aligned.map(p => p.box.y), [0, 0, 0]);
  layers[1].locked = true; assert.equal(arrangeSelection(layers, 'left', {}).length, 2);
});
test('group scaling and rotation preserve relative geometry and angles', () => {
  const layers = [0, 100].map(x => ({ _box: { x, y: 0, w: 50, h: 50, rot: 0 } }));
  const start = selectionBounds(layers);
  const transformed = transformSelection(layers.map(layer => ({ layer, box: layer._box })), start, { ...start, w: 300, h: 100, rot: 90 });
  assert.deepEqual(transformed.map(t => [t.box.w, t.box.h, t.box.rot]), [[100, 100, 90], [100, 100, 90]]);
  assert.ok(Math.abs(transformed[0].box.x - transformed[1].box.x) < 0.001);
  assert.ok(Math.abs(transformed[1].box.y - transformed[0].box.y - 200) < 0.001);
});
test('aligning rotated layers uses visible edges and is idempotent', () => {
  const layers = [{ _box: { x: 0, y: 0, w: 100, h: 100, rot: 45 } }, { _box: { x: 200, y: 0, w: 100, h: 100, rot: 0 } }];
  const first = arrangeSelection(layers, 'left', {});
  for (const { layer, box } of first) layer._box = box;
  assert.ok(Math.abs(selectionBounds([layers[0]]).x - selectionBounds([layers[1]]).x) < 0.001);
  const second = arrangeSelection(layers, 'left', {});
  for (const { layer, box } of second) assert.deepEqual(box, layer._box);
});
test('preflight catches blank output, review status, clipping and Watch sizes', () => {
  const scene = { warnings: [], slide: {}, layers: [], W: 422, H: 514, k: 1, slideId: 'design', localeId: 'sv', deviceDef: { target: 'watch', size: [400, 500] } };
  let warnings = preflightScene(scene, { copy: {} }); assert.deepEqual(warnings.map(w => w.code), ['empty', 'watch-size']);
  scene.deviceDef.size = [422, 514]; scene.layers = [{ id: 'headline', type: 'text', _layout: {}, _box: { x: -5, y: 0, w: 100, h: 20 }, fontFamily: 'missing' }]; scene.fonts = {};
  warnings = preflightScene(scene, { copy: {} }, { fontAvailable: () => false });
  assert.deepEqual(warnings.map(w => w.code), ['copy-review', 'outside-canvas', 'font-missing']);
  assert.equal(preflightSelection({ devices: { a: { target: 'watch', size: [422, 514] }, b: { target: 'watch', size: [416, 496] } } }, ['a', 'b']).length, 1);
});
test('preflight detects enlargement caused by vertical fill/crop', () => {
  const scene = { warnings: [], slide: {}, layers: [{ id: 'photo', type: 'art', fit: 'cover', _box: { x: 0, y: 0, w: 100, h: 1000 } }], W: 100, H: 1000, k: 1, slideId: 'design', localeId: 'en-US', deviceDef: { size: [100, 1000] }, assets: { art: { photo: { naturalWidth: 1000, naturalHeight: 100 } } } };
  assert.deepEqual(preflightScene(scene, { copy: {} }).map(w => w.code), ['upscaled-image']);
});
test('export freezes source files and publishes a unique manifest with only this run', t => {
  const root = temp(t), source = path.join(root, 'source'), output = path.join(root, 'output');
  const doc = { label: 'before', locales: [{ id: 'en-US' }], devices: { iphone: { target: 'custom', size: [10, 20] } }, slides: [{ id: 'one' }, { id: 'two' }] };
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'studio.json'), JSON.stringify(doc));
  const sessions = new ExportSessions(source, output); t.after(() => sessions.close());
  const first = sessions.start('draft', { slides: ['one'] }); fs.writeFileSync(path.join(source, 'studio.json'), JSON.stringify({ ...doc, label: 'after' }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(first.source, 'studio.json'), 'utf8')).label, 'before');
  sessions.write(first.id, 'en-US/iphone/01-one.png', Buffer.from('png'), [10, 20]);
  const folder = sessions.finish(first.id, { warnings: [] });
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json')));
  assert.equal(manifest.files.length, 1); assert.equal(manifest.files[0].size[1], 20); assert.equal(fs.existsSync(first.temp), false);
  const second = sessions.start('final', { slides: ['two'] }); sessions.write(second.id, 'en-US/iphone/02-two.png', Buffer.from('png2'), [10, 20]);
  assert.throws(() => sessions.finish(second.id, { warnings: ['missing capture'] }), /unresolved/);
  sessions.abort(second.id); assert.deepEqual(fs.readdirSync(output), [path.basename(folder)]);
});
test('desktop protocol loads the project and performs revision-checked writes without HTTP', async t => {
  const root = temp(t), project = path.join(root, 'document'); fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'studio.json'), JSON.stringify(fixture()));
  const service = createStudioService({ appPath: path.join(ROOT, 'app'), projectPath: project, exportPath: path.join(root, 'export'), origin: 'studio://local' }); t.after(() => service.close());
  const result = await service.request(new Request('studio://local/api/project')); assert.equal(result.status, 200);
  const bundle = await result.json(); bundle.studio.slides[0].name = 'Changed';
  const save = () => service.request(new Request('studio://local/api/studio', { method: 'PUT', headers: { 'if-match': bundle.revisions.studio }, body: JSON.stringify(bundle.studio) }));
  assert.equal((await save()).status, 200); assert.equal((await save()).status, 409);
  assert.equal((await service.request(new Request('studio://evil/api/project'))).status, 403);
});
test('candidate validation rejects damaged text documents before native project switching', t => {
  const root = temp(t); fs.mkdirSync(path.join(root, 'copy'));
  fs.writeFileSync(path.join(root, 'studio.json'), JSON.stringify(fixture())); fs.writeFileSync(path.join(root, 'copy/en-US.json'), '{bad');
  const service = createStudioService({ appPath: path.join(ROOT, 'app'), projectPath: root, exportPath: path.join(root, 'export') });
  assert.throws(() => service.loadProjectBundle(), SyntaxError);
});
test('frozen project assets can be read through the desktop scheme including canonical temp paths', async t => {
  const root = temp(t), project = path.join(root, 'project'); fs.mkdirSync(path.join(project, 'assets/art'), { recursive: true });
  fs.writeFileSync(path.join(project, 'studio.json'), JSON.stringify(fixture())); fs.writeFileSync(path.join(project, 'assets/art/test.png'), 'frozen-image');
  const service = createStudioService({ appPath: path.join(ROOT, 'app'), projectPath: project, exportPath: path.join(root, 'export'), origin: 'studio://local' }); t.after(() => service.close());
  const response = await service.request(new Request('studio://local/api/export/start', { method: 'POST', body: JSON.stringify({ mode: 'draft', selection: {} }) }));
  const run = await response.json(); assert.equal(response.status, 200);
  fs.writeFileSync(path.join(project, 'assets/art/test.png'), 'newer-image');
  const asset = await service.request(new Request(`studio://local${run.projectURL}/assets/art/test.png`));
  assert.equal(asset.status, 200); assert.equal(await asset.text(), 'frozen-image');
});
