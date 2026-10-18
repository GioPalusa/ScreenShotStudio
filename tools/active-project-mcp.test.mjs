import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMCPServer } from './mcp/server.mjs';
import { createActiveProjectTools } from '../host/active-project-tools.mjs';
import { startActiveAgentLink, callActiveAgent } from '../desktop/active-agent-link.mjs';
import { createNewProject } from '../host/new-project.mjs';
import { createStudioService } from '../host/service.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-active-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const contexts = ['A', 'B'].map(name => {
    const project = path.join(root, `${name}.sss`); createNewProject(project, {});
    const service = createStudioService({ appPath: path.resolve('app'), projectPath: project, exportPath: path.join(project, 'export'), origin: 'studio://local' });
    t.after(() => service.close()); return { project, service, session: `session-${name}` };
  });
  let current = contexts[0], flush = async () => {};
  const notifications = [];
  const tools = createActiveProjectTools({ getCurrent: () => current, flush: () => flush(), changed: files => notifications.push(files) });
  return { root, contexts, tools, notifications, setCurrent: value => current = value, setFlush: value => flush = value };
}

test('reads wait for pending GUI saves and edits use the active service and notify its renderer', async t => {
  const f = fixture(t), [a] = f.contexts;
  f.setFlush(async () => {
    const studio = a.service.loadProjectBundle().studio;
    studio.slides[0].name = 'Latest unsaved editor text';
    const response = await a.service.request(new Request('studio://local/api/studio', { method: 'PUT', body: JSON.stringify(studio) }));
    assert.equal(response.status, 200);
  });
  const doc = await f.tools.invoke('read_project');
  assert.equal(doc.studio.slides[0].name, 'Latest unsaved editor text'); assert.equal(doc.project, a.project); assert.equal(doc.projectSession, a.session);
  f.setFlush(async () => {});
  doc.studio.slides[0].name = 'Agent edit';
  await f.tools.invoke('save_document', { studio: doc.studio, revision: doc.revisions.studio, projectSession: doc.projectSession });
  assert.equal(a.service.loadProjectBundle().studio.slides[0].name, 'Agent edit'); assert.deepEqual(f.notifications, [['studio.json']]);
});
test('one connection follows project switches; old sessions and explicit old paths cannot write to the new document', async t => {
  const f = fixture(t), [a, b] = f.contexts;
  const old = await f.tools.invoke('read_project'); f.setCurrent(b);
  assert.equal((await f.tools.invoke('catalog')).project, b.project);
  await assert.rejects(f.tools.invoke('save_document', { studio: old.studio, revision: old.revisions.studio, projectSession: old.projectSession }), /active project changed/);
  const current = await f.tools.invoke('read_project');
  await assert.rejects(f.tools.invoke('save_document', { project: a.project, studio: old.studio, revision: old.revisions.studio, projectSession: current.projectSession }), /follows the project/);
  assert.equal(b.service.loadProjectBundle().studio.slides[0].name, current.studio.slides[0].name);
  f.setCurrent(null);
  assert.equal((await f.tools.invoke('catalog')).project, null);
  await assert.rejects(f.tools.invoke('read_project'), /No project is open/);
});
test('failed saves and a project change during flush stop the operation before any write', async t => {
  const f = fixture(t), [a, b] = f.contexts, doc = await f.tools.invoke('read_project');
  f.setFlush(async () => { throw new Error('Unsaved conflict'); });
  await assert.rejects(f.tools.invoke('save_document', { studio: doc.studio, revision: doc.revisions.studio, projectSession: a.session }), /Unsaved conflict/);
  f.setFlush(async () => f.setCurrent(b));
  await assert.rejects(f.tools.invoke('read_project'), /changed while saving/);
  assert.deepEqual(f.notifications, []);
});
test('active tools confine images to the document or adjacent inputs and exports to its package', async t => {
  const f = fixture(t), [a, b] = f.contexts;
  fs.writeFileSync(path.join(f.root, 'unrelated.png'), 'image');
  await assert.rejects(f.tools.invoke('read_image', { file: path.join(f.root, 'unrelated.png') }), /active project/);
  await assert.rejects(f.tools.invoke('read_image', { file: path.join(b.project, 'secret.png') }), /active project/);
  await assert.rejects(f.tools.invoke('export_project', { output: path.join(f.root, 'outside'), projectSession: a.session }), /inside this .sss/);
  await assert.rejects(f.tools.invoke('create_project', { project: 'Other.sss' }), /currently open project/);
});
test('private app link resolves the live project on every request and closes without retaining an old path', async t => {
  const f = fixture(t), appData = path.join(f.root, 'app-data');
  const link = await startActiveAgentLink({ appData, invoke: f.tools.invoke }); t.after(() => link.close());
  assert.equal(fs.statSync(path.join(appData, 'active-mcp.json')).mode & 0o777, 0o600);
  assert.equal((await callActiveAgent(appData, 'read_project', {})).project, f.contexts[0].project);
  f.setCurrent(f.contexts[1]);
  assert.equal((await callActiveAgent(appData, 'read_project', {})).project, f.contexts[1].project);
  link.close(); await assert.rejects(callActiveAgent(appData, 'catalog', {}), /Open Screenshot Studio/);
});
test('active MCP schemas default to the open project and require session identity for writes', async t => {
  const f = fixture(t), server = createMCPServer(undefined, { activeApp: true, invoke: f.tools.invoke });
  const client = new Client({ name: 'active-test', version: '1' }), [a, b] = InMemoryTransport.createLinkedPair();
  t.after(() => client.close()); await server.connect(b); await client.connect(a);
  const list = (await client.listTools()).tools;
  assert.equal(list.length, 9); assert.equal(list.some(t => t.name === 'create_project'), false);
  assert.ok(!list.find(t => t.name === 'read_project').inputSchema.required?.includes('project'));
  assert.ok(list.find(t => t.name === 'save_document').inputSchema.required.includes('projectSession'));
  const first = await client.callTool({ name: 'read_project', arguments: {} }); assert.equal(first.structuredContent.project, f.contexts[0].project);
  f.setCurrent(f.contexts[1]);
  const second = await client.callTool({ name: 'read_project', arguments: {} }); assert.equal(second.structuredContent.project, f.contexts[1].project);
});

test('MCP store images follow the open project with session checks and editor notification', async t=>{
 const f=fixture(t),[a,b]=f.contexts;
 const server=createMCPServer(undefined,{activeApp:true,invoke:f.tools.invoke});
 const client=new Client({name:'store-test',version:'1'}),[local,remote]=InMemoryTransport.createLinkedPair();
 t.after(()=>client.close());await server.connect(remote);await client.connect(local);
 const schema=(await client.listTools()).tools.find(t=>t.name==='add_store_images');
 assert.ok(schema.inputSchema.required.includes('projectSession'));assert.ok(schema.inputSchema.required.includes('revision'));
 const doc=(await client.callTool({name:'read_project',arguments:{}})).structuredContent;
 const args={store:'app-store',revision:doc.revisions.studio,projectSession:doc.projectSession};
 const added=await client.callTool({name:'add_store_images',arguments:args});assert.ok(!added.isError,JSON.stringify(added));assert.equal(added.structuredContent.images.length,2);
 assert.equal(a.service.loadProjectBundle().studio.slides.length,3);assert.deepEqual(f.notifications,[['studio.json']]);
 f.setCurrent(b);const rejected=await client.callTool({name:'add_store_images',arguments:args});assert.equal(rejected.isError,true);assert.equal(b.service.loadProjectBundle().studio.slides.length,1);
 f.setCurrent(null);assert.equal((await f.tools.invoke('catalog')).storeImages.tool,'add_store_images');
});
