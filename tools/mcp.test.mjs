import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createAITools } from '../host/ai-screenshots.mjs';
import { encodePNG, decodePNG } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-mcp-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, api: createAITools(root) };
}
function png() { return encodePNG({ width: 100, height: 100, channels: 3, data: Buffer.alloc(100 * 100 * 3, 128) }); }

test('MCP stdio negotiates, discovers tools, edits and returns usable errors', async t => {
  const { root } = fixture(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'tools/mcp/server.mjs'), '--workspace', root], stderr: 'pipe' });
  const client = new Client({ name: 'screenshot-studio-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 10);
  assert.ok(tools.some(t=>t.name==='add_store_images'));
  const catalog=(await client.callTool({name:'catalog',arguments:{}})).structuredContent;
  assert.equal(catalog.storeImages.tool,'add_store_images');
  assert.equal(tools.find(t => t.name === 'read_project').annotations.readOnlyHint, true);
  const created = await client.callTool({ name: 'create_project', arguments: { project: 'Demo.sss' } });
  assert.ok(created.structuredContent.revisions.studio);
  const denied = await client.callTool({ name: 'create_project', arguments: { project: '../Escape.sss' } });
  assert.equal(denied.isError, true);
  const unknown = await client.callTool({ name: 'apply_design', arguments: { project: 'Demo.sss', slide: 'unknown', devices: ['iphone'], design: 'focus', revision: created.structuredContent.revisions.studio } });
  assert.equal(unknown.isError, true);
});

test('new projects are clean; saves preserve backups, detect conflicts and require review', async t => {
  const { api, root } = fixture(t);
  const doc = await api.create_project({ project: 'Demo.sss' });
  assert.deepEqual(doc.captures, {});
  assert.deepEqual(doc.assets.art, []);
  await assert.rejects(api.create_project({ project: 'Demo.sss' }), /never overwritten/);
  const studio = structuredClone(doc.studio);
  studio.slides[0].name = 'AI storyboard';
  const saved = await api.save_document({ project: 'Demo.sss', studio, revision: doc.revisions.studio });
  assert.notEqual(saved.revision, doc.revisions.studio);
  await assert.rejects(api.save_document({ project: 'Demo.sss', studio: doc.studio, revision: doc.revisions.studio }), /409/);
  await assert.rejects(api.save_document({ project: 'Demo.sss', studio }), /expected revision/);
  assert.ok(fs.readdirSync(path.join(root, 'Demo.sss/.history/studio.json')).length);
  const copy = { _meta: { status: 'approved', needsReview: [] }, 'first-slide': { headline: 'See your progress', caption: 'One day at a time.' } };
  await api.save_copy({ project: 'Demo.sss', locale: 'en-US', copy, revision: doc.revisions['copy:en-US'] });
  const updated = await api.read_project({ project: 'Demo.sss' });
  assert.deepEqual(updated.copy['en-US']._meta, { status: 'draft', needsReview: ['*'] });
  await assert.rejects(api.save_document({ project: 'Demo.sss', studio: { ...updated.studio, locales: [{ id: 'sv' }] }, revision: updated.revisions.studio }), /archived in _removed/);
  await assert.rejects(api.save_copy({ project: 'Demo.sss', locale: '../escape', copy, revision: 'missing' }), /Add this locale/);
  studio.slides[0]._box = {};
  await assert.rejects(api.save_document({ project: 'Demo.sss', studio, revision: saved.revision }), /private renderer fields/);
});

test('media imports, designs and image content use portable document assets', async t => {
  const { api, root } = fixture(t);
  const doc = await api.create_project({ project: 'Demo.sss' });
  const source = path.join(root, 'screen.png'); fs.writeFileSync(source, png());
  const image = await api.read_image({ file: source });
  assert.equal(image.content[0].mimeType, 'image/png');
  assert.ok(Buffer.from(image.content[0].data, 'base64').equals(png()));
  await api.import_media({ project: 'Demo.sss', source, kind: 'capture', device: 'iphone', name: 'screen' });
  await assert.rejects(api.import_media({ project: 'Demo.sss', source, kind: 'capture', device: 'iphone', name: 'screen' }), /409/);
  const asset = await api.import_media({ project: 'Demo.sss', source, kind: 'art' });
  assert.ok(fs.existsSync(path.join(root, 'Demo.sss/assets/art', asset.file)));
  await api.apply_design({ project: 'Demo.sss', slide: 'first-slide', devices: ['iphone'], design: 'spotlight', revision: doc.revisions.studio });
  const updated = await api.read_project({ project: 'Demo.sss' });
  assert.ok(updated.studio.slides[0].layouts.iphone.layers.some(l => l.id === 'starter-backdrop'));
});

test('workspace traversal, symlinks, nested documents and invalid exports are rejected', async t => {
  const { api, root } = fixture(t);
  await assert.rejects(api.create_project({ project: '../Escape.sss' }), /Invalid project path/);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'escape'));
  await assert.rejects(api.create_project({ project: 'escape/Escape.sss' }), /symbolic links/);
  await api.create_project({ project: 'Demo.sss' });
  await assert.rejects(api.create_project({ project: 'Demo.sss/Nested.sss' }), /outside existing project/);
  await assert.rejects(api.export_project({ project: 'Demo.sss', output: 'Demo.sss/output' }), /outside project/);
  await assert.rejects(api.export_project({ project: 'Demo.sss', mode: 'final', allowPlaceholders: true }), /Final exports/);
  await assert.rejects(api.export_project({ project: 'Demo.sss', slides: ['unknown'] }), /valid, unique slide/);
  await assert.rejects(api.export_project({ project: 'Demo.sss', locales: [] }), /valid, unique locale/);
  await assert.rejects(api.read_image({ file: '../private.png' }), /Invalid project path/);
});

test('real renderer exports draft/final RGB and rejects final with missing captures', { skip: !process.env.STUDIO_MCP_RENDER_TEST }, async t => {
  const { api, root } = fixture(t);
  await api.create_project({ project: 'Demo.sss' });
  const draft = await api.export_project({ project: 'Demo.sss', allowPlaceholders: true });
  assert.equal(draft.files.length, 1);
  const buffer = fs.readFileSync(draft.files[0].absolutePath);
  assert.equal(buffer[25], 2, 'PNG colour type is RGB');
  assert.deepEqual([decodePNG(buffer).width, decodePNG(buffer).height], [1320, 2868]);
  assert.equal(JSON.parse(fs.readFileSync(draft.manifest)).mode, 'draft');
  await assert.rejects(api.export_project({ project: 'Demo.sss', mode: 'final' }), /Export failed/);
  const publishedFinals = fs.readdirSync(path.join(root, 'exports')).flatMap(dir => fs.readdirSync(path.join(root, 'exports', dir))).filter(name => name.startsWith('final-'));
  assert.deepEqual(publishedFinals, []);
  const screen = path.join(root, 'capture.png');
  fs.writeFileSync(screen, encodePNG({ width: 1320, height: 2868, channels: 3, data: Buffer.alloc(1320 * 2868 * 3, 128) }));
  await api.import_media({ project: 'Demo.sss', source: screen, kind: 'capture', device: 'iphone', name: 'screen' });
  const final = await api.export_project({ project: 'Demo.sss', mode: 'final' });
  assert.equal(final.files.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(final.manifest)).mode, 'final');
  assert.deepEqual(final.report.warnings, []);
});

test('store image tool exposes presets and atomically adds editable pairs with revisions', async t => {
 const {api}=fixture(t),doc=await api.create_project({project:'Store.sss'});
 const catalog=await api.catalog();assert.deepEqual(catalog.storeImages.sets['app-store'].targets,['app-store-search','app-store-header']);
 assert.equal(catalog.targets['play-feature'].formats[0].size.join('x'),'1024x500');
 const args={project:'Store.sss',store:'app-store',sizes:{'app-store-search':[1920,1280],'app-store-header':[3840,1646]},revision:doc.revisions.studio};
 const result=await api.add_store_images(args);assert.equal(result.images.length,2);assert.ok(result.revision);
 const updated=await api.read_project({project:'Store.sss'});assert.deepEqual(updated.studio.slides[0],doc.studio.slides[0]);
 assert.ok(result.images.every(i=>updated.studio.slides.find(s=>s.id===i.slideId).canvasIds.includes(i.deviceId)));
 await assert.rejects(api.add_store_images(args),/409/);
 await assert.rejects(api.add_store_images({...args,store:'google-play',sizes:{'play-feature':[100,100]},revision:result.revision}),/Unsupported size/);
 await assert.rejects(api.add_store_images({...args,afterSlide:'missing',revision:result.revision}),/Unknown slide/);
 assert.deepEqual((await api.read_project({project:'Store.sss'})).studio,updated.studio);
 const again=await api.add_store_images({...args,revision:result.revision});assert.deepEqual(again.images,result.images);
 const play=await api.add_store_images({project:'Store.sss',store:'google-play',revision:again.revision});assert.equal(play.images.length,1);
 assert.deepEqual((await api.read_project({project:'Store.sss'})).studio.devices[play.images[0].deviceId].size,[1024,500]);
});
