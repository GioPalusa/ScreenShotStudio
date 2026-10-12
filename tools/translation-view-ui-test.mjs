// Translation grouping regression: selection, editing, review and persisted preferences.
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-translation-view-ui-')), appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Test.sss');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean).find(file => fs.existsSync(file));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
let service, server;
try {
  fs.cpSync(path.join(root, 'app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  fs.writeFileSync(path.join(appPath, 'translation-view-ui-test.html'), `<!doctype html><html><head><link rel="stylesheet" href="/app/css/studio.css"></head><body><div id="root"></div><pre id="result">PENDING</pre><script type="module">
  const result = document.querySelector('#result'), check = (v, m) => { if (!v) throw new Error(m); };
  const waitFor = async fn => { for (let i = 0; i < 500; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Timed out waiting for UI'); };
  const button = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name);
  try {
    result.textContent = 'Loading modules';
    const { engine, state, loadAll, flushSaves } = await import('/app/js/store.js');
    const { mountStudio } = await import('/app/js/ui.js');
    result.textContent = 'Loading project'; await loadAll(); state.ui.view = 'editor'; state.ui.locale = 'en-US'; state.ui.device = Object.keys(engine.project.devices)[0]; state.ui.slideId = engine.project.slides[0].id;

    const seed = engine.project.slides[0];
    engine.project.slides = Array.from({length:3},(_,i)=>({...structuredClone(seed),id:'slide-'+i,name:'Screen '+(i+1)}));
    engine.project.locales.push({id:'sv',native:'Svenska',name:'Swedish',lang:'sv',dir:'ltr'});
    engine.data.copy.sv = {_meta:{status:'draft',needsReview:['*']}};
    for(const slide of engine.project.slides) {
      engine.data.copy['en-US'][slide.id]={headline:'Original '+slide.id};
      engine.data.copy.sv[slide.id]={headline:'Swedish '+slide.id};
    }
    state.ui.slideId='slide-0';state.ui.view='languages';state.ui.translateMode='screen';
    const snapshot=JSON.stringify(engine.project);
    mountStudio(document.querySelector('#root'));
    const rows=()=>[...document.querySelectorAll('.lang-row')];
    check(rows().length===2,'Per screen lists all languages');
    document.querySelectorAll('.translate-screen')[1].click();
    check(rows().every(r=>r.dataset.slide==='slide-1'),'Selecting a screen updates all language rows');
    button('Per language').click();
    check(rows().length===3,'Per language lists every screen');
    check(rows().every(r=>r.dataset.locale==='en-US'),'All screens use selected language');
    check(JSON.parse(localStorage.getItem('mmd-studio-ui-v1')).translateMode==='language','Grouping survives reopening');
    document.querySelectorAll('.translate-language')[1].click();
    check(rows().every(r=>r.dataset.locale==='sv'),'Language selector updates every screen');
    check(rows()[2].querySelector('.name').textContent==='Screen 3','Rows identify their screen');
    const ta=rows()[2].querySelector('textarea');ta.value='Edited third screen';ta.dispatchEvent(new Event('input',{bubbles:true}));
    check(engine.data.copy.sv['slide-2'].headline==='Edited third screen','Editing targets the correct screen and language');
    check(engine.data.copy.sv['slide-0'].headline==='Swedish slide-0','Other screens remain untouched');
    rows()[2].querySelector('button').click();
    check(state.ui.view==='editor'&&state.ui.locale==='sv'&&state.ui.slideId==='slide-2','Open in editor selects row screen and language');
    button('Translate').click();
    check(rows().length===3&&button('Per language').getAttribute('aria-pressed')==='true','Returning preserves grouping');
    rows()[0].querySelector('.translate-button').click();
    await waitFor(()=>document.querySelector('.modal select'));
    const selects=[...document.querySelectorAll('.modal select')];
    check(selects.some(s=>s.value==='slide'),'Row translation defaults to one screen');
    button('Cancel').click();
    button('Mark design reviewed').click();
    check(rows().every(r=>r.querySelector('.chip').textContent==='✓ Reviewed'),'Review design applies to every screen of selected language');
    button('Per screen').click();
    check(rows().length===2&&rows().every(r=>r.dataset.slide==='slide-2'),'Switching back keeps selected screen');
    check(rows()[1].querySelector('textarea').value==='Edited third screen','Edits appear in both grouping modes');
    check(JSON.parse(localStorage.getItem('mmd-studio-ui-v1')).translateMode==='screen','Updated grouping persists');
    check(JSON.stringify(engine.project)===snapshot,'Grouping never changes design data');
    await flushSaves();
    result.textContent='PASS: screen/language grouping, selection, persistence, correct text editing and editor navigation, row translation and design review';
  } catch (e) { result.textContent = 'FAIL: ' + e.stack; }
  </script></body></html>`);
  const testPage = path.join(appPath, 'translation-view-ui-test.html'), html = fs.readFileSync(testPage, 'utf8');
  const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  fs.writeFileSync(path.join(appPath, 'translation-view-ui-test.js'), inline[1]);
  fs.writeFileSync(testPage, html.replace(inline[0], '<script type="module" src="/app/translation-view-ui-test.js"></script>'));
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const stdout = await new Promise((resolve, reject) => execFile(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${path.join(temp, 'chrome')}`, `--window-size=${process.env.OVERVIEW_TEST_WIDTH ?? 1100},800`, `http://127.0.0.1:${server.address().port}/app/translation-view-ui-test.html`], { timeout: 40000, maxBuffer: 4 * 1024 * 1024 }, (error, output, stderr) => { fs.writeFileSync('/tmp/studio-translation-view-ui-chrome.log', stderr); fs.writeFileSync('/tmp/studio-translation-view-ui-dom.html', output); error ? reject(error) : resolve(output); }));
  const verdict = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'No test result'; assert.match(verdict, /^PASS:/, verdict);

  console.log(verdict);
} finally { server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); service?.close(); fs.rmSync(temp, { recursive: true, force: true }); }
