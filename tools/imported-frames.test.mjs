import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { starterProject } from '../app/js/onboarding.js';
import { createNewProject } from '../host/new-project.mjs';
import { createStudioService } from '../host/service.mjs';
import { encodePNG } from './png.mjs';
import { allFrames, BUILTIN_FRAMES } from '../app/js/frames.js';
import { profilesFor, BUILTIN_PROFILES, deviceForLayer } from '../app/js/profiles.js';
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
const { Engine } = await import('../app/js/render.js');
const appPath = path.resolve('app');
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-imported-frames-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const png = encodePNG({ width: 80, height: 140, data: Buffer.alloc(80 * 140 * 4, 255), channels: 4 });
const meta = { size: [80, 140], screen: { x: 10, y: 10, w: 60, h: 120, radius: 8, mode: 'hole' }, label: 'My imported phone' };
const harness = t => {
  const projectPath = path.join(temp(t), 'Test.sss');
  createNewProject(projectPath, { target: 'iphone' });
  const service = createStudioService({ appPath, projectPath, exportPath: path.join(projectPath, 'export'), origin: 'studio://local' });
  t.after(() => service.close());
  const request = (url, method = 'GET', body, headers = {}) => service.request(new Request(`studio://local${url}`, { method, headers, ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}) }));
  return { projectPath, service, request };
};

test('Apple starters use a generic frame without bundled bezel references or artwork', t => {
  const dir = temp(t);
  for (const target of ['iphone', 'ipad', 'watch', 'mac', 'tv', 'vision']) {
    const dest = path.join(dir, `${target}.sss`);
    createNewProject(dest, { target });
    const doc = JSON.parse(fs.readFileSync(path.join(dest, 'studio.json')));
    assert.equal(doc.devices[target].frame.type, 'generic');
    assert.deepEqual(doc.devices[target].frame.screen, doc.devices[target].size);
    assert.doesNotMatch(JSON.stringify(doc), /"type":"bezel"/);
    assert.equal(fs.existsSync(path.join(dest, 'assets')), false);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync('starter/studio.json')), starterProject().project);
  assert.equal(fs.existsSync(path.join(appPath, 'assets/frames')), false);
});

test('new projects never offer bundled Duo artwork or profiles, while saved Duo layouts remain readable', () => {
  const fresh = starterProject().project;
  assert.ok(BUILTIN_FRAMES.every(option => option.ref.type !== 'duo'));
  assert.ok(Object.values(BUILTIN_PROFILES).every(profile => profile.frame.type !== 'duo'));
  assert.ok(allFrames().every(option => option.ref.type !== 'duo'));
  assert.equal(profilesFor(fresh)['duo-inner'], undefined);
  const legacy = structuredClone(fresh);
  legacy.slides[0].layouts.iphone.layers[0].profile = 'duo-inner';
  const profile = deviceForLayer(legacy, legacy.devices.iphone, legacy.slides[0].layouts.iphone.layers[0]);
  assert.deepEqual(profile.frame, { type: 'duo', display: 'inner', orientation: 'landscape', finish: 'star-white' });
  assert.deepEqual(profile.size, [2853, 2007]);
  const imported = { 'my-duo': { ...meta, label: 'My imported Duo' } };
  assert.ok(allFrames(imported).some(option => option.ref.name === 'my-duo'));
});

test('frame import saves portable PNG and metadata, refuses name collisions, and preserves existing data', async t => {
  const { projectPath, service, request } = harness(t);
  assert.deepEqual(service.loadProjectBundle().frames, {});
  assert.equal((await request('/api/frame?name=my-frame', 'POST', png)).status, 200);
  assert.equal((await request('/api/frame-meta?name=my-frame', 'PUT', meta)).status, 200);
  assert.equal((await request('/api/frame?name=my-frame', 'POST', png)).status, 409);
  assert.deepEqual(fs.readFileSync(path.join(projectPath, 'assets/frames/my-frame.png')), png);
  assert.deepEqual(service.loadProjectBundle().frames['my-frame'], meta);
  const engine = new Engine(); engine.setData(service.loadProjectBundle());
  assert.match(engine.assetUrl('frames', 'my-frame'), /^\/project\/assets\/frames\/my-frame.png/);
});

test('older portable documents retain their previously bundled Apple artwork through load, save and export', async t => {
  const { projectPath, service, request } = harness(t), name = 'studio-iphone-18-pro-black-portrait';
  await request(`/api/frame?name=${name}`, 'POST', png);
  await request(`/api/frame-meta?name=${name}`, 'PUT', meta);
  const bundle = service.loadProjectBundle();
  bundle.studio.devices.iphone.frame = { type: 'bezel', name };
  assert.equal((await request('/api/studio', 'PUT', bundle.studio, { 'if-match': bundle.revisions.studio })).status, 200);
  const run = await (await request('/api/export/start', 'POST', { mode: 'draft', selection: {} })).json();
  assert.deepEqual(run.bundle.frames[name], meta);
  const frozen = await request(`${run.projectURL}/assets/frames/${name}.png`);
  assert.equal(frozen.status, 200);
  assert.deepEqual(Buffer.from(await frozen.arrayBuffer()), png);
  assert.deepEqual(fs.readFileSync(path.join(projectPath, `assets/frames/${name}.png`)), png);
  await request('/api/export/abort', 'POST', { id: run.id });
});

test('installed frames are shared across projects and used artwork survives a move without the library', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-library-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const library = path.join(root, 'app-data', 'frames');
  const first = path.join(root, 'First.sss'), second = path.join(root, 'Second.sss');
  createNewProject(first, {}); createNewProject(second, {});
  const make = projectPath => createStudioService({ appPath, projectPath, exportPath: path.join(projectPath, 'export'), frameLibraryPath: library, origin: 'studio://local' });
  const service = make(first); t.after(() => service.close());
  const png = encodePNG({ width: 20, height: 40, channels: 4, data: Buffer.alloc(20 * 40 * 4, 255) });
  const meta = { size: [20, 40], screen: { x: 2, y: 4, w: 16, h: 32, radius: 2 } };
  assert.equal((await service.request(new Request('studio://local/api/frame?name=shared', { method: 'POST', body: png }))).status, 200);
  assert.equal((await service.request(new Request('studio://local/api/frame-meta?name=shared', { method: 'PUT', body: JSON.stringify(meta) }))).status, 200);
  assert.ok(fs.existsSync(path.join(library, 'shared.png')));
  assert.equal(fs.existsSync(path.join(first, 'assets/frames/shared.png')), false);
  const other = make(second); t.after(() => other.close());
  const bundle = other.loadProjectBundle(); assert.deepEqual(bundle.frames.shared, meta);
  assert.equal((await other.request(new Request('studio://local/project/assets/frames/shared.png'))).status, 200);
  bundle.studio.devices[Object.keys(bundle.studio.devices)[0]].frame = { type: 'bezel', name: 'shared' };
  assert.equal((await other.request(new Request('studio://local/api/studio', { method: 'PUT', body: JSON.stringify(bundle.studio) }))).status, 200);
  assert.ok(fs.readFileSync(path.join(second, 'assets/frames/shared.png')).equals(png));
  fs.rmSync(library, { recursive: true });
  const portable = createStudioService({ appPath, projectPath: second, exportPath: path.join(second, 'export'), origin: 'studio://local' }); t.after(() => portable.close());
  assert.deepEqual(portable.loadProjectBundle().frames.shared, meta);
  assert.equal((await portable.request(new Request('studio://local/project/assets/frames/shared.png'))).status, 200);
});
