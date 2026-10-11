import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { starterProject, startupProject, WELCOME_PALETTES } from '../app/js/onboarding.js';
import { createNewProject } from '../host/new-project.mjs';
import { createStudioService } from '../host/service.mjs';
import { canvasIssues } from '../app/js/export-targets.js';
import { resolveLayers } from '../app/js/layouts.js';
test('starter projects use only the selected palette, editable neutral content and accepted store sizes', () => {
  for (const target of ['iphone','ipad','watch','play-phone','play-tablet-7']) {
    const palette = { name: 'My colours', bg: '#fefefe', ink: '#212121', swatches: ['#ff5522'] };
    const { project, copy } = starterProject({ target, palette });
    assert.deepEqual(project.themes, { starter: palette });
    assert.deepEqual(canvasIssues(project.devices[target]), []);
    assert.deepEqual(resolveLayers({ project, slide: project.slides[0], deviceId: target }).layers.map(l => l.type).sort(), ['device','text','text']);
    assert.equal(copy['en-US']._meta.status, 'draft');
    assert.doesNotMatch(JSON.stringify({project,copy}), /map.?my.?day|globe|timeline|trip-memory/i);
    palette.bg = '#000000'; assert.equal(project.themes.starter.bg, '#fefefe');
  }
});
test('normal launch reopens the latest project while explicit documents take precedence', () => {
  assert.equal(startupProject({}, () => true), null);
  assert.equal(startupProject({explicit:'opened.sss',recent:['recent.sss']}, () => true), 'opened.sss');
  assert.equal(startupProject({explicit:'missing.sss',recent:['recent.sss']}, () => false), 'missing.sss', 'Explicit open must not silently switch documents');
  assert.equal(startupProject({recent:['recent.sss','older.sss']}, () => true), 'recent.sss');
  assert.equal(startupProject({recent:['legacy.screenshotstudio']}, () => true), 'legacy.screenshotstudio');
  assert.equal(startupProject({recent:['gone.sss','recent.sss']}, p => p==='recent.sss'), null);
  assert.equal(startupProject({recent:['gone.sss']}, () => false), null);
  assert.equal(startupProject({recent:['unreadable.sss']}, () => { throw new Error('Unavailable volume'); }), null);
  for (const recent of [null, {}, 'bad', [null], ['']]) assert.equal(startupProject({recent}, () => true), null);
});
test('new project palette survives disk reload without bundled Apple bezels, screenshots or artwork', t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-onboarding-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const dest=path.join(temp,'Example.sss'), palette=structuredClone(WELCOME_PALETTES[2]);
  createNewProject(dest,{target:'iphone',palette});
  const service=createStudioService({appPath:path.resolve('app'),projectPath:dest,exportPath:path.join(dest,'export')});t.after(()=>service.close());
  const loaded=service.loadProjectBundle();assert.deepEqual(loaded.studio.themes.starter,palette);assert.deepEqual(loaded.captures,{});assert.deepEqual(loaded.frames,{});assert.deepEqual(loaded.assets.art,[]);
  assert.equal(fs.existsSync(path.join(dest,'assets')),false); assert.equal(loaded.studio.devices.iphone.frame.type,'generic');
  const before=fs.readFileSync(path.join(dest,'studio.json'),'utf8');assert.throws(()=>createNewProject(dest,{}),/never overwritten/);assert.equal(fs.readFileSync(path.join(dest,'studio.json'),'utf8'),before);
});
test('invalid palette or destination is rejected before creating project files', t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-onboarding-invalid-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const dest=path.join(temp,'Invalid.sss');
  assert.throws(()=>createNewProject(dest,{palette:{name:'Bad',bg:'red',ink:'#ffffff'}}),/valid colours/);assert.equal(fs.existsSync(dest),false);
  assert.throws(()=>starterProject({target:'missing'}),/store destination/);
});

test('confirmed replacement creates a fresh project and retains the complete previous project as a version', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-replace-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dest = path.join(root, 'Same name.sss');
  createNewProject(dest, { target: 'iphone', palette: WELCOME_PALETTES[0] });
  const before = fs.readFileSync(path.join(dest, 'studio.json'));
  fs.mkdirSync(path.join(dest, 'captures/iphone'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'captures/iphone/old.png'), 'old capture');
  fs.mkdirSync(path.join(dest, '.history')); fs.writeFileSync(path.join(dest, '.history/old.bak'), 'old backup');
  createNewProject(dest, { target: 'ipad', palette: WELCOME_PALETTES[1] }, { replace: true });
  const fresh = JSON.parse(fs.readFileSync(path.join(dest, 'studio.json')));
  assert.deepEqual(Object.keys(fresh.devices), ['ipad']);
  assert.deepEqual(fresh.themes.starter, WELCOME_PALETTES[1]);
  assert.equal(fs.existsSync(path.join(dest, 'captures')), false);
  const versions = fs.readdirSync(path.join(dest, '.versions')); assert.equal(versions.length, 1);
  const previous = path.join(dest, '.versions', versions[0]);
  assert.deepEqual(fs.readFileSync(path.join(previous, 'studio.json')), before);
  assert.equal(fs.readFileSync(path.join(previous, 'captures/iphone/old.png'), 'utf8'), 'old capture');
  assert.equal(fs.readFileSync(path.join(previous, '.history/old.bak'), 'utf8'), 'old backup');
  assert.deepEqual(fs.readdirSync(root), ['Same name.sss']);
});

test('invalid replacement options leave the existing project untouched', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-replace-invalid-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dest = path.join(root, 'Same name.sss'); createNewProject(dest, {});
  const before = fs.readFileSync(path.join(dest, 'studio.json'));
  assert.throws(() => createNewProject(dest, { target: 'missing' }, { replace: true }), /store destination/);
  assert.deepEqual(fs.readFileSync(path.join(dest, 'studio.json')), before);
  assert.deepEqual(fs.readdirSync(root), ['Same name.sss']);
});

test('failed replacement publication restores the previous project', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-replace-failed-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dest = path.join(root, 'Same name.sss'); createNewProject(dest, {});
  const before = fs.readFileSync(path.join(dest, 'studio.json'));
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === dest && path.basename(from).startsWith('.studio-new-')) throw new Error('Simulated publication failure');
    return rename(from, to);
  });
  assert.throws(() => createNewProject(dest, { target: 'ipad' }, { replace: true }), /publication failure/);
  assert.deepEqual(fs.readFileSync(path.join(dest, 'studio.json')), before);
  assert.deepEqual(fs.readdirSync(root), ['Same name.sss']);
});

test('failed rollback keeps the previous project at the reported recovery path', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-replace-recovery-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dest = path.join(root, 'Same name.sss'); createNewProject(dest, {});
  const before = fs.readFileSync(path.join(dest, 'studio.json'));
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === dest) throw new Error('Simulated destination failure');
    return rename(from, to);
  });
  assert.throws(() => createNewProject(dest, { target: 'ipad' }, { replace: true }), /previous project is preserved/);
  const staging = path.join(root, fs.readdirSync(root).find(name => name.startsWith('.studio-new-')));
  const previous = path.join(staging, '.versions', fs.readdirSync(path.join(staging, '.versions'))[0]);
  assert.deepEqual(fs.readFileSync(path.join(previous, 'studio.json')), before);
});

test('replacement rejects unrelated folders and links to another project', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-replace-path-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'Original.sss'); createNewProject(source, {});
  const link = path.join(root, 'Linked.sss'); fs.symlinkSync(source, link);
  assert.throws(() => createNewProject(link, {}, { replace: true }), /existing Screenshot Studio project/);
  const unrelated = path.join(root, 'Unrelated.sss'); fs.mkdirSync(unrelated); fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'keep');
  assert.throws(() => createNewProject(unrelated, {}, { replace: true }), /existing Screenshot Studio project/);
  assert.equal(fs.readFileSync(path.join(unrelated, 'keep.txt'), 'utf8'), 'keep');
  assert.ok(fs.existsSync(path.join(source, 'studio.json')));
});
