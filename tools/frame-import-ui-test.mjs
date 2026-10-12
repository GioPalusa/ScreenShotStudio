// Real renderer regression: a DMG drop must survive same-document refreshes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { execBrowserTest as execFile } from './browser-test-runner.mjs';
import { fileURLToPath } from 'node:url';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
import { encodePNG } from './png.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-frame-import-ui-'));
const appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Test.sss');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].filter(Boolean).find(file => fs.existsSync(file));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH to run the renderer tests.');
let service, server;
try {
  fs.cpSync(path.join(root, 'app'), appPath, { recursive: true });
  createNewProject(projectPath, {});
  const data = Buffer.alloc(160 * 300 * 4);
  for (let y = 0; y < 300; y++) for (let x = 0; x < 160; x++) {
    const i = (y * 160 + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 30;
    data[i + 3] = x >= 20 && x < 140 && y >= 20 && y < 280 ? 0 : 255;
  }
  const png = encodePNG({ width: 160, height: 300, data, channels: 4 });
  fs.writeFileSync(path.join(appPath, 'frame-import-test.html'), '<!doctype html><html><body><pre id="result">PENDING</pre><script type="module" src="/app/frame-import-test.js"></script></body></html>');
  fs.writeFileSync(path.join(appPath, 'frame-import-test.js'), `
  const result = document.querySelector('#result');
  const check = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = async fn => { for (let i = 0; i < 300; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Import preview did not finish'); };
  try {
    let finishMount, mounts = 0;
    window.studioDesktop = { importFrameDmg: () => { mounts++; return new Promise(resolve => { finishMount = resolve; }); } };
    const { engine, state, loadAll, checkpoint, saveStudio, flushSaves } = await import('/app/js/store.js');
    const { buildFramesView } = await import('/app/js/ui/frames-view.js');
    await loadAll();
    const holder = document.createElement('div'); document.body.append(holder);
    const ctx = { go() { holder.replaceChildren(buildFramesView(ctx)); } };
    ctx.go();
    const drop = () => { const transfer = new DataTransfer(); transfer.items.add(new File(['fixture'], 'QA.dmg')); holder.querySelector('.frame-import-zone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); };
    drop();
    check(mounts === 1, 'The first drop must open the native importer exactly once');
    // Autosave/external updates can replace project objects and the Frames view.
    engine.data.studio = structuredClone(engine.project);
    ctx.go();
    drop();
    check(mounts === 1, 'Refreshing the view must not allow duplicate native mounts');
    finishMount({ canceled: false, files: [{ name: 'QA phone.png', bytes: new Uint8Array(${JSON.stringify([...png])}) }] });
    await waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Import selected frames' && !b.disabled));
    check([...document.querySelectorAll('h3')].some(h => h.textContent === 'Import bezel PNGs'), 'The first drop must produce its preview despite the background refresh');
    document.querySelector('.modal-foot button').click();
    await waitFor(() => Object.keys(engine.data.frames).length === 1);
    check(mounts === 1, 'Importing must not reopen the DMG');
    await waitFor(() => !document.querySelector('.modal-backdrop'));
    const name = Object.keys(engine.data.frames)[0];
    checkpoint();
    engine.project.devices.iphone.frame = { type: 'bezel', name };
    saveStudio(); await flushSaves();
    ctx.go();
    const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
    // The synthetic bezel may be grouped as Other; select its containing family.
    for (const tab of holder.querySelectorAll('.frame-families button')) {
      tab.click(); if (button('Fit and corners…')) break;
    }
    button('Fit and corners…').click();
    await waitFor(() => button('Delete frame'));
    button('Delete frame').click();
    await waitFor(() => button('Delete and use generic'));
    check(document.body.textContent.includes('including other languages and saved designs'), 'Used-frame warning explains the replacement scope');
    [...document.querySelectorAll('button')].filter(b => b.textContent === 'Cancel').at(-1).click();
    check(engine.data.frames[name], 'Cancel preserves artwork');
    check(engine.project.devices.iphone.frame.type === 'bezel', 'Cancel preserves references');
    button('Delete frame').click();
    await waitFor(() => button('Delete and use generic'));
    button('Delete and use generic').click();
    await waitFor(() => !engine.data.frames[name]);
    check(engine.project.devices.iphone.frame.type === 'generic', 'Deletion substitutes the generic frame');
    const saved = await (await fetch('/api/project')).json();
    check(saved.studio.devices.iphone.frame.type === 'generic', 'Generic replacement persisted');
    result.textContent = 'PASS: frame import, used-frame warning, cancellation, confirmed deletion and saved generic replacement';
  } catch (error) { result.textContent = 'FAIL: ' + error.message; }
  `);
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const stdout = await new Promise((resolve, reject) => execFile(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${path.join(temp, 'chrome')}`, `http://127.0.0.1:${server.address().port}/app/frame-import-test.html`], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 }, (error, output) => error ? reject(error) : resolve(output)));
  const verdict = stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1] ?? 'No test result';
  assert.match(verdict, /^PASS:/, verdict);
  assert.equal(fs.readdirSync(path.join(projectPath, 'assets/frames')).filter(file => file.endsWith('.png')).length, 0);
  console.log(verdict);
} finally {
  server?.closeAllConnections();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  service?.close(); fs.rmSync(temp, { recursive: true, force: true });
}
