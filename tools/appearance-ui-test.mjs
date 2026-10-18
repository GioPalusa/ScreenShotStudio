// Real CSS and app surfaces; no changes to a user's documents or preferences.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
import { runBrowserTest } from './browser-test-runner.mjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-appearance-'));
const appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Test.sss');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(fs.existsSync);
let service, server;
try {
  fs.cpSync(path.resolve('app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  fs.writeFileSync(path.join(appPath, 'appearance-test.html'), '<html><head><script src="/app/js/appearance.js"></script><link rel="stylesheet" href="/app/css/studio.css"></head><body><div id="root"></div><pre id="result">PENDING</pre><script type="module" src="/app/appearance-test.js"></script></body></html>');
  fs.writeFileSync(path.join(appPath, 'appearance-test.js'), `
    import {engine,loadAll} from '/app/js/store.js';
    import {mountStudio} from '/app/js/ui.js';
    const check=(v,m)=>{if(!v)throw Error(m)}, wait=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout')};
    const lum=hex=>{const c=hex.trim().slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722};
    const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
    const contrastCheck=()=>{const style=getComputedStyle(document.documentElement),v=name=>style.getPropertyValue(name);for(const surface of ['--bg','--panel','--panel-2'])for(const ink of ['--text','--muted','--link'])check(contrast(v(ink),v(surface))>=4.5,ink+' must remain readable on '+surface);check(contrast(v('--accent'),v('--accent-ink'))>=4.5,'Primary action text passes contrast')};
    try {
      await loadAll();mountStudio(document.querySelector('#root'));await document.fonts.ready;
      check(matchMedia('(prefers-color-scheme: dark)').matches,'Test starts with a dark OS');
      check(document.documentElement.dataset.theme==='dark','System starts dark'); contrastCheck();
      const doc=JSON.stringify(engine.project), scene=engine.scene(engine.project.slides[0].id,Object.keys(engine.project.devices)[0],engine.project.locales[0].id);
      const render=async()=>{const c=document.createElement('canvas');await engine.render(c,scene,{scale:.05});return c.toDataURL()};
      const artwork=await render(), topbar=document.querySelector('.topbar'), thumb=document.querySelector('.thumb[aria-selected="true"]');
      const field=document.createElement('textarea');field.value='Keep my input';document.body.append(field);field.focus();field.setSelectionRange(2,5);
      const appearance=document.querySelector('[aria-label="Appearance"]');appearance.value='light';appearance.dispatchEvent(new Event('change'));
      await wait(()=>document.documentElement.dataset.theme==='light');contrastCheck();
      check(document.activeElement===field && field.selectionStart===2 && field.selectionEnd===5,'Changing appearance preserves focus and selection');
      check(document.querySelector('.topbar')===topbar && document.querySelector('.thumb[aria-selected="true"]')===thumb,'Appearance does not rebuild the editor');
      check(getComputedStyle(document.body).backgroundColor==='rgb(247, 245, 242)','Explicit light overrides the dark OS');
      const welcome=window.open('/app/welcome.html');check(welcome,'Welcome test window opens');
      await wait(()=>welcome.document?.querySelector('[aria-label="Appearance"]'));
      check(welcome.document.documentElement.dataset.theme==='light','Welcome loads the persisted mode');
      appearance.value='dark';appearance.dispatchEvent(new Event('change'));
      await wait(()=>welcome.document.documentElement.dataset.theme==='dark');contrastCheck();
      check(welcome.document?.querySelector('[aria-label="Appearance"]').value==='dark','Other windows update their appearance controls');
      const about=window.open('/app/about.html');check(about,'About test window opens');
      await wait(()=>about.document?.querySelector('.palusa-logo.dark')?.complete);
      check(about.getComputedStyle(about.document.querySelector('.palusa-logo.light')).display==='none','Original logo hides on dark surfaces');
      check(about.getComputedStyle(about.document.querySelector('.palusa-logo.dark')).display!=='none','Supplied white logo appears on dark surfaces');
      check(await render()===artwork,'Screenshot pixels do not change with app appearance');
      check(JSON.stringify(engine.project)===doc,'Appearance never edits project palettes');
      welcome.close();about.close();
      document.querySelector('#result').textContent='PASS: System, explicit overrides, contrast, persisted and synchronized Welcome/About, correct dark logo, unchanged DOM focus and screenshot pixels';
    }catch(error){document.querySelector('#result').textContent='FAIL: '+error.stack;}
  `);
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { stdout } = await runBrowserTest(chrome, ['--headless', '--disable-gpu', '--force-dark-mode', '--disable-popup-blocking', '--no-first-run', '--no-sandbox', `--user-data-dir=${path.join(temp,'chrome')}`, '--window-size=1480,950', `http://127.0.0.1:${server.address().port}/app/appearance-test.html`], { timeout: 40000 });
  const verdict = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'No result';
  assert.match(verdict, /^PASS:/, verdict); console.log(verdict);
} finally {
  server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); service?.close(); fs.rmSync(temp, { recursive: true, force: true });
}
