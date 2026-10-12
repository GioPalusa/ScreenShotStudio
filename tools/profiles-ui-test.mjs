// Device library editing and safe, project-scoped removal through the real UI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { execBrowserTest as execFile } from './browser-test-runner.mjs';
import { fileURLToPath } from 'node:url';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-profiles-ui-')), appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Test.sss');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean).find(file => fs.existsSync(file));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
let service, server;
try {
  fs.cpSync(path.join(root, 'app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  fs.writeFileSync(path.join(appPath, 'profiles-ui-test.html'), `<!doctype html><html><head><link rel="stylesheet" href="/app/css/studio.css"></head><body><div id="root"></div><pre id="result">PENDING</pre><script type="module">
  const result = document.querySelector('#result'), check = (v, m) => { if (!v) throw new Error(m); };
  const waitFor = async fn => { for (let i = 0; i < 500; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Timed out waiting for UI'); };
  const button = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name);
  try {
    const { engine, state, loadAll, flushSaves, undo, redo } = await import('/app/js/store.js');
    const { mountStudio } = await import('/app/js/ui.js');
    const { availableProfilesFor, deviceForLayer } = await import('/app/js/profiles.js');
    await loadAll();
    state.ui.view='setup';state.ui.setupTab='profiles';state.ui.locale='en-US';state.ui.device=Object.keys(engine.project.devices)[0];state.ui.slideId=engine.project.slides[0].id;
    const slide=engine.project.slides[0],layer=slide.layouts[state.ui.device].layers.find(l=>l.type==='device');layer.profile='iphone';
    const beforeDevice=deviceForLayer(engine.project,engine.project.devices[state.ui.device],layer,engine.data.frames),before=JSON.stringify(engine.project);
    mountStudio(document.querySelector('#root'));
    const topDialog=()=>[...document.querySelectorAll('[role="dialog"]')].at(-1);
    const action=name=>[...topDialog().querySelectorAll('button')].find(b=>b.textContent.trim()===name);
    const edit=id=>document.querySelector('[data-profile="'+id+'"] button').click();
    check(document.querySelectorAll('.profile-card').length>5,'Device library must show image/name cards');
    check(!document.querySelector('.setup-body input') && !document.querySelector('.setup-body select'),'Device settings must stay hidden until Edit');
    edit('iphone');
    document.querySelector('[aria-label="Device name"]').value='Canceled phone';document.querySelector('[aria-label="Screen width in pixels"]').value='1000';
    action('Cancel').click();check(JSON.stringify(engine.project)===before,'Cancel must discard every pending setting');
    edit('iphone');
    document.querySelector('[aria-label="Device name"]').value='My phone';document.querySelector('[aria-label="Screen width in pixels"]').value='1250';
    action('Save changes').click();
    check(engine.project.profiles.iphone.label==='My phone' && engine.project.profiles.iphone.screen[0]===1250,'Save must apply all device settings');
    check(document.querySelector('[data-profile="iphone"]').textContent.includes('My phone'),'The card must refresh after Save');
    undo();check(JSON.stringify(engine.project)===before,'Device editing must undo as one change');
    edit('iphone');action('Remove…').click();
    check(topDialog().textContent.includes('Your first slide') && topDialog().textContent.includes('keep their appearance'),'Removing a used device must explain usage and preservation');
    action('Cancel').click();check(availableProfilesFor(engine.project).iphone,'Canceled removal must retain the device');
    action('Remove…').click();action('Remove device').click();
    await waitFor(()=>!document.querySelector('[data-profile="iphone"]'));
    check(!availableProfilesFor(engine.project).iphone,'Removed devices must disappear from library choices');
    check(JSON.stringify(deviceForLayer(engine.project,engine.project.devices[state.ui.device],layer,engine.data.frames))===JSON.stringify(beforeDevice),'Already placed device appearance must survive removal');
    await flushSaves();
    const saved=await(await fetch('/api/project')).json();check(saved.studio.removedProfiles?.includes('iphone'),'Removal must persist');
    undo();check(document.querySelector('[data-profile="iphone"]'),'Undo must restore the library card');
    redo();check(!document.querySelector('[data-profile="iphone"]'),'Redo must remove the library card again');undo();
    button('＋ Add device').click();document.querySelector('[aria-label="Device name"]').value='Custom phone';action('Add device').click();
    const id=Object.entries(engine.project.profiles).find(([id,p])=>p.label==='Custom phone')?.[0];check(id,'Add device must create a custom library entry');
    edit(id);action('Remove…').click();action('Remove device').click();
    await waitFor(()=>!document.querySelector('[data-profile="'+id+'"]'));
    check(!engine.project.profiles[id] && !document.querySelector('[data-profile="'+id+'"]'),'Unused custom devices must be deleted');
    await flushSaves();
    result.textContent='PASS: compact image/name library, settings on Edit, Cancel, atomic Save/Undo, used-device removal warning and preservation, project-scoped choices, persistence, custom creation and removal';
  } catch (e) { result.textContent = 'FAIL: ' + e.stack; }
  </script></body></html>`);
  const testPage = path.join(appPath, 'profiles-ui-test.html'), html = fs.readFileSync(testPage, 'utf8');
  const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  fs.writeFileSync(path.join(appPath, 'profiles-ui-test.js'), inline[1]);
  fs.writeFileSync(testPage, html.replace(inline[0], '<script type="module" src="/app/profiles-ui-test.js"></script>'));
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const stdout = await new Promise((resolve, reject) => execFile(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${path.join(temp, 'chrome')}`, `--window-size=${process.env.PROFILES_TEST_WIDTH ?? 1100},800`, `http://127.0.0.1:${server.address().port}/app/profiles-ui-test.html`], { timeout: 40000, maxBuffer: 4 * 1024 * 1024 }, (error, output, stderr) => { fs.writeFileSync('/tmp/studio-profiles-ui-chrome.log', stderr); fs.writeFileSync('/tmp/studio-profiles-ui-dom.html', output); error ? reject(error) : resolve(output); }));
  const verdict = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'No test result'; assert.match(verdict, /^PASS:/, verdict);

  console.log(verdict);
} finally { server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); service?.close(); fs.rmSync(temp, { recursive: true, force: true }); }
