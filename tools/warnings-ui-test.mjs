// Regression test for editor warning popups and language-scoped Overview warning lists.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-warnings-ui-')), appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Test.sss');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean).find(file => fs.existsSync(file));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
let service, server;
try {
  fs.cpSync(path.join(root, 'app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  fs.writeFileSync(path.join(appPath, 'warnings-ui-test.html'), `<!doctype html><html><head><link rel="stylesheet" href="/app/css/studio.css"></head><body><div id="root"></div><pre id="result">PENDING</pre><script type="module">
  const result = document.querySelector('#result'), check = (v, m) => { if (!v) throw new Error(m); };
  const waitFor = async fn => { for (let i = 0; i < 500; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Timed out waiting for UI'); };
  const button = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name);
  try {
    const { engine, state, loadAll } = await import('/app/js/store.js');
    const { mountStudio } = await import('/app/js/ui.js');
    // Use the eager rendering fallback: headless virtual time may pause intersection delivery.
    // The actual observer/scrolling path is covered by overview-ui-test and native UI QA.
    delete window.IntersectionObserver;
    await loadAll();
    const first=engine.project.slides[0],device=Object.keys(engine.project.devices)[0];
    engine.project.slides.push({id:'clean',name:'Ready screen',theme:first.theme,layouts:{[device]:{template:'custom',panorama:false,layers:[{id:'shape',type:'shape',shape:'rect',x:100,y:100,w:300,h:300,fill:'#fff'}]}}});
    engine.project.locales.push({id:'sv',native:'Svenska',name:'Swedish',lang:'sv',dir:'ltr'});
    engine.data.copy.sv={_meta:{status:'draft',needsReview:['*']}};
    state.ui.view='editor';state.ui.locale='sv';state.ui.device=device;state.ui.slideId=first.id;state.ui.overviewZoom=100;state.ui.overviewMode='language';
    const snapshot=JSON.stringify(engine.data);
    mountStudio(document.querySelector('#root'));
    const badge=()=>document.querySelector('.stage-bar .warning-button');
    await waitFor(()=>badge()?.textContent.includes('3'));
    check(!document.querySelector('.stage-bar').textContent.includes('missing for'),'Editor must not show long inline warnings');
    check(badge().getBoundingClientRect().width<75,'Editor warning control must remain compact');
    badge().click();
    const popup=document.querySelector('[role="dialog"]');
    check(popup?.getAttribute('aria-label')==='Screen warnings','Warning badge must open a dialog');
    check(popup.querySelectorAll('.warning-list li').length===3,'Popup must show every current-screen warning');
    check(popup.textContent.includes('Svenska') && popup.textContent.includes(first.name),'Popup must identify the current language and screen');
    check(popup.textContent.includes('No Swedish text for “headline” - showing English'),'Popup must show full warning text without ellipsis');
    check(popup.querySelectorAll('.err').length===1 && popup.querySelectorAll('.warn').length===2,'Missing captures and translation warnings must retain their severities');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    check(!document.querySelector('[role="dialog"]') && document.activeElement===badge(),'Escape must dismiss warnings and restore keyboard focus');
    const language=document.querySelector('[aria-label="Language"]');language.value='en-US';language.dispatchEvent(new Event('change',{bubbles:true}));
    check(!badge(),'Changing language must clear the previous report while rendering');
    await waitFor(()=>badge()?.textContent.includes('1'));
    badge().click();check(!document.querySelector('[role="dialog"]').textContent.includes('No Swedish'),'English popup must not retain Swedish warnings');
    document.querySelector('[role="dialog"] [aria-label="Close"]').click();
    document.querySelector('.rail-list [data-id="clean"]').click();
    await waitFor(()=>document.querySelector('.stage-bar').textContent.includes('Check export'));
    check(!badge(),'Warning-free screens must not retain the preceding badge');
    document.querySelector('.rail-list [data-id="'+first.id+'"]').click();await waitFor(()=>badge());
    badge().click();button('View in Overview').click();
    await waitFor(()=>document.querySelector('.overview-warnings .warning-list'));
    check(state.ui.view==='overview' && !document.querySelector('[role="dialog"]'),'Popup action must navigate to Overview and close');
    const firstWarnings=document.querySelector('.overview-screen-warnings[data-slide-id="'+first.id+'"]');
    check(firstWarnings.textContent.includes('Screenshot “screen” missing for iPhone'),'Overview must expose full warning text without opening a popup');
    check(document.querySelector('.overview-screen-warnings[data-slide-id="clean"]').hidden,'Clean screens must not show an empty warning section');
    button('All languages').click();
    await waitFor(()=>document.querySelector('[data-locale="sv"] .warning-list li.warn'));
    const english=document.querySelector('[data-locale="en-US"]'),swedish=document.querySelector('[data-locale="sv"]');
    check(!english.querySelector('.overview-warnings').textContent.includes('Swedish'),'Overview warnings must stay in the correct language row');
    check(swedish.querySelectorAll('.warning-list li').length===3,'Swedish row must show its capture and translation warnings');
    button('Fit to width').click();
    const viewport=document.querySelector('.overview-viewport'),warningBox=swedish.querySelector('.overview-warnings');
    check(warningBox.getBoundingClientRect().width>viewport.clientWidth-2 && warningBox.scrollWidth<=warningBox.clientWidth,'Warning text must remain readable at Fit to width');
    document.querySelector('[aria-label="Overview zoom percent"]').value='200';document.querySelector('[aria-label="Overview zoom percent"]').dispatchEvent(new Event('change',{bubbles:true}));
    viewport.scrollLeft=200;
    check(Math.abs(warningBox.getBoundingClientRect().left-viewport.getBoundingClientRect().left)<2,'Overview warnings must stay visible when previews scroll sideways');
    swedish.querySelector('.overview-screen-warnings .screen-name').click();
    await waitFor(()=>badge()?.textContent.includes('3'));
    check(state.ui.view==='editor' && state.ui.locale==='sv' && state.ui.slideId===first.id,'Overview warning link must open its screen and language');
    check(JSON.stringify(engine.data)===snapshot,'Inspecting warnings must never alter project content');
    result.textContent='PASS: compact warning control, complete severity-aware popup, Escape/focus, current screen/language scoping, clean-screen reset, full Overview warning groups, readable zoom/scroll and navigation without document mutation';
  } catch (e) { result.textContent = 'FAIL: ' + e.stack; }
  </script></body></html>`);
  const testPage = path.join(appPath, 'warnings-ui-test.html'), html = fs.readFileSync(testPage, 'utf8');
  const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  fs.writeFileSync(path.join(appPath, 'warnings-ui-test.js'), inline[1]);
  fs.writeFileSync(testPage, html.replace(inline[0], '<script type="module" src="/app/warnings-ui-test.js"></script>'));
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const stdout = await new Promise((resolve, reject) => execFile(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${path.join(temp, 'chrome')}`, `--window-size=${process.env.WARNINGS_TEST_WIDTH ?? 1100},800`, '--virtual-time-budget=15000', '--dump-dom', `http://127.0.0.1:${server.address().port}/app/warnings-ui-test.html`], { timeout: 40000, maxBuffer: 4 * 1024 * 1024 }, (error, output, stderr) => { fs.writeFileSync('/tmp/studio-warnings-ui-chrome.log', stderr); fs.writeFileSync('/tmp/studio-warnings-ui-dom.html', output); error ? reject(error) : resolve(output); }));
  const verdict = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'No test result'; assert.match(verdict, /^PASS:/, verdict);

  console.log(verdict);
} finally { server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); service?.close(); fs.rmSync(temp, { recursive: true, force: true }); }
