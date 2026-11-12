// Exercise the actual text inspector, export gating and diagnostic review dialog.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
import { runBrowserTest } from './browser-test-runner.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-text-review-ui-'));
const appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Text.sss');
let service, server;
try {
  fs.cpSync(path.resolve('app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  const file = path.join(projectPath, 'studio.json'), studio = JSON.parse(fs.readFileSync(file));
  studio.devices = { image: { label: 'Review image', target: 'custom', size: [1000, 1000], layout: 'phone' } };
  studio.slides = [{ id: 'first', name: 'Readable promise', theme: Object.keys(studio.themes)[0], layouts: { image: { template: 'custom', panorama: false, layers: [
    { id: 'headline', type: 'text', field: 'headline', x: 80, capTop: 80, w: 840, size: 80, minSize: 80, maxLines: 1 },
    { id: 'caption', type: 'text', field: 'caption', x: 80, capTop: 300, w: 840, size: 20, minSize: 20, maxLines: 1 },
  ] } } }];
  fs.writeFileSync(file, JSON.stringify(studio));
  fs.writeFileSync(path.join(projectPath, 'copy/en-US.json'), JSON.stringify({ _meta: { status: 'draft', needsReview: ['*'] }, first: { headline: 'Plan your day', caption: 'Secondary details' } }));
  fs.writeFileSync(path.join(appPath, 'text-review-test.html'), '<html><body><pre id="result">PENDING</pre><script type="module" src="/app/text-review-test.js"></script></body></html>');
  fs.writeFileSync(path.join(appPath, 'text-review-test.js'), `
    import {loadAll,engine} from '/app/js/store.js';
    import {buildTextPanel} from '/app/js/ui/text-panel.js';
    import {openExport,runExport} from '/app/js/ui/export.js';
    const assert=(ok,message)=>{if(!ok)throw Error(message)};
    const wait=async(fn)=>{const end=Date.now()+10000;while(!fn()){if(Date.now()>end)throw Error('Timed out: '+fn);await new Promise(r=>setTimeout(r,20));}return fn()};
    try{
      await loadAll();
      const slide=engine.project.slides[0],locale=engine.project.locales[0];
      const panel=buildTextPanel({slide:()=>slide,locale:()=>locale,device:()=>engine.project.devices.image,ctx:{}},{fields:['headline','caption']});
      document.body.append(panel.el);
      const scene=engine.scene('first','image','en-US');await engine.render(document.createElement('canvas'),scene);panel.afterRender(scene);
      assert(panel.el.querySelector('[data-readability="caption"]').classList.contains('warn'),'Small caption gets readability advice');
      assert(panel.el.querySelector('[data-fit="caption"]').textContent.includes('Fits'),'Caption still fits technically');
      assert(panel.el.querySelector('[data-readability="headline"]').textContent.includes('12.8 px at 160 px'),'Inspector uses rendered display size');
      const result=await runExport({locales:['en-US'],devices:['image'],slides:[slide],preflightOnly:true,mode:'final'});
      assert(result.issues.length===0,'Readability does not create technical errors');
      assert(result.textReview.advisories.some(a=>a.layer==='caption'),'Export exposes the advisory');
      openExport({});
      const button=await wait(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Review text at small sizes…'));
      assert([...document.querySelectorAll('button')].some(b=>b.textContent==='Export images'&&!b.disabled),'Advice leaves export enabled');
      button.click();
      await wait(()=>document.querySelector('img[alt*="240 pixel"]'));
      const picker=document.querySelector('select[aria-label="Diagnostic image width"]');
      picker.value='160';picker.dispatchEvent(new Event('change'));
      const image=await wait(()=>document.querySelector('img[alt*="160 pixel"]'));
      assert(image.width===1440,'Diagnostic contact sheet retains nominal width');
      assert(document.body.textContent.includes('3.2 px'),'Review dialog shows tiny supporting text');
      document.querySelector('#result').textContent='PASS: measured inspector advice, independent export readiness, actual diagnostic dialog and width switching';
    }catch(error){document.querySelector('#result').textContent='FAIL: '+error.stack;}
  `);
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const { stdout } = await runBrowserTest(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-sandbox', `--user-data-dir=${path.join(temp, 'chrome')}`, `http://127.0.0.1:${server.address().port}/app/text-review-test.html`], { timeout: 40000 });
  assert.match(stdout, /PASS: measured inspector advice/);
  console.log('PASS: text readability in real inspector/export dialog, independent technical gates and diagnostic width switching');
} finally {
  server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve());
  service?.close(); fs.rmSync(temp, { recursive: true, force: true });
}
