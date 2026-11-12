import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNewProject } from '../host/new-project.mjs';
import { createRecentPreviews, recentPreviewId } from '../host/recent-previews.mjs';

test('Home previews read only recent documents and local artwork without writing or publishing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-recent-preview-')), project = path.join(root, 'Artwork.sss');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createNewProject(project, {});
  fs.mkdirSync(path.join(project, 'assets/art'), { recursive: true });
  fs.writeFileSync(path.join(project, 'assets/art/example.png'), 'original artwork');
  let paths = [project];
  const previews = createRecentPreviews({ appPath: path.resolve('app'), recentPaths: () => paths }); t.after(() => previews.close());
  const inventory = () => fs.readdirSync(project, { recursive: true }).filter(p => fs.statSync(path.join(project,p)).isFile()).map(p => [p, fs.readFileSync(path.join(project,p)).toString('base64')]);
  const before = inventory(), prefix = `studio://local/recent/${recentPreviewId(project)}`;
  const bundle = await previews.request(new Request(prefix + '/bundle'));
  assert.equal(bundle.status, 200); const data = await bundle.json(); assert.ok(data.studio.slides.length); assert.equal(data.exports, undefined);
  const asset = await previews.request(new Request(prefix + '/project/assets/art/example.png'));
  assert.equal(await asset.text(), 'original artwork');
  for (const url of [prefix + '/api/studio', prefix + '/project/studio.json', prefix + '/project/assets/..%2f..%2fcopy/en-US.json', prefix.replace('studio://local', 'https://evil.example') + '/bundle']) assert.equal((await previews.request(new Request(url))).status, 404);
  assert.equal((await previews.request(new Request(prefix + '/bundle', { method: 'POST' }))).status, 404);
  assert.deepEqual(inventory(), before); assert.ok(!fs.existsSync(path.join(project, 'export')));
  paths = []; assert.equal((await previews.request(new Request(prefix + '/bundle'))).status, 404);
});
