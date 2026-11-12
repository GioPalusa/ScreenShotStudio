import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fontInfo, resolveGoogleFonts, saveProjectFonts } from '../host/project-fonts.mjs';
import { recentProjectSummaries } from '../host/recent-projects.mjs';
import { importMenu } from '../desktop/import-menu.mjs';
import { validateDocument } from '../app/js/document.js';
import { starterProject } from '../app/js/onboarding.js';
import { applyExternalImport } from '../app/js/external-import.js';
import { ExportSessions } from '../host/export-sessions.mjs';
const bytes = fs.readFileSync(new URL('./fixtures/fonts/Mulish.ttf', import.meta.url));
const license = fs.readFileSync(new URL('./fixtures/fonts/OFL.txt', import.meta.url), 'utf8');

test('portable fonts retain family, variable weights, licensing and frozen export bytes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fonts-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(fontInfo(bytes), { family: 'Mulish', weight: '200 1000', style: 'normal', extension: 'ttf' });
  for (const data of [Buffer.from('not a font'), bytes.subarray(0, 100)]) assert.throws(() => fontInfo(data), /valid OpenType/);
  const fonts = saveProjectFonts(root, [{ data: bytes.toString('base64'), license, source: 'Google Fonts' }]);
  assert.ok(fs.readFileSync(path.join(root, 'assets/fonts', fonts[0].file)).equals(bytes));
  assert.equal(fs.readFileSync(path.join(root, 'assets/fonts', fonts[0].license), 'utf8'), license);
  assert.ok(!JSON.stringify(fonts).includes(bytes.toString('base64').slice(0, 100)));
  const { project, copy } = starterProject({});
  const design = { width: 375, height: 808, layers: [{ id: 'text', type: 'text', fontFamily: 'Mulish', field: 'title', size: 24, w: 200, x: 0, capTop: 0 }], texts: { title: 'Original type' } };
  const result = applyExternalImport(project, copy, [{ kind: 'figma-editable', path: 'frame', name: 'Font test', group: 'frame', locale: 'en-US', file: design, design }], { assets: {}, fonts });
  assert.deepEqual(result.project.fonts.files, fonts); assert.equal(project.fonts.files, undefined); validateDocument(result.project);
  fs.writeFileSync(path.join(root, 'studio.json'), JSON.stringify(result.project));
  const sessions = new ExportSessions(root, path.join(root, 'export'));
  const run = sessions.start('draft', { locales: ['en-US'], devices: [result.deviceId], slides: [result.slides[0]] });
  try { assert.ok(fs.readFileSync(path.join(run.source, 'assets/fonts', fonts[0].file)).equals(bytes)); }
  finally { fs.rmSync(run.temp, { recursive: true, force: true }); }
  const broken = structuredClone(result.project); broken.fonts.files[0].file = '../secret.ttf'; assert.throws(() => validateDocument(broken), /font/);
});

test('Google font resolution is fixed-source, includes licensing, checks family identity and isolates missing fonts', async () => {
  const calls = [], fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/ofl/mulish/METADATA.pb')) return new Response('name: "Mulish"\nfonts {\n  filename: "Mulish[wght].ttf"\n}');
    if (url.endsWith('/ofl/mulish/OFL.txt')) return new Response(license);
    if (url.endsWith('/ofl/mulish/Mulish%5Bwght%5D.ttf')) return new Response(bytes);
    return new Response('', { status: 404 });
  };
  const result = await resolveGoogleFonts(['Mulish', 'Private family'], { fetchImpl });
  assert.equal(result.fonts[0].family, 'Mulish'); assert.equal(result.fonts[0].license, license); assert.deepEqual(result.missing, ['Private family']);
  assert.ok(calls.every(c => c.url.startsWith('https://raw.githubusercontent.com/google/fonts/main/') && c.options.redirect === 'error' && !c.options.headers));
  assert.deepEqual((await resolveGoogleFonts(['Missing'], { fetchImpl })).missing, ['Missing']);
});

test('Home overview survives missing projects and File imports dispatch to the document', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-home-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, 'My app.sss'); fs.mkdirSync(folder); const { project } = starterProject({}); fs.writeFileSync(path.join(folder, 'studio.json'), JSON.stringify(project));
  const rows = recentProjectSummaries([folder, path.join(root, 'missing.sss')]);
  assert.equal(rows.length, 1); assert.equal(rows[0].screens, 1); assert.equal(rows[0].canvases, 1); assert.equal(rows[0].languages, 1); assert.equal(rows[0].name, 'My app');
  const commands = [], menu = importMenu({ enabled: true, send: c => commands.push(c) }); menu.submenu.forEach(item => item.click());
  assert.deepEqual(commands, ['import:figma', 'import:designs', 'import:fonts']); assert.ok(importMenu({ enabled: false, send() {} }).submenu.slice(1).every(item => !item.enabled));
});
