// Regression test for the Overview scroll container, multilingual rows and persisted zoom.
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-overview-ui-')), appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Test.sss');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean).find(file => fs.existsSync(file));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
let service, server;
try {
  fs.cpSync(path.join(root, 'app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  fs.writeFileSync(path.join(appPath, 'overview-ui-test.html'), `<!doctype html><html><head><link rel="stylesheet" href="/app/css/studio.css"></head><body><div id="root"></div><pre id="result">PENDING</pre><script type="module">
  const result = document.querySelector('#result'), check = (v, m) => { if (!v) throw new Error(m); };
  const waitFor = async fn => { for (let i = 0; i < 500; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Timed out waiting for UI'); };
  const button = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name);
  try {
    result.textContent = 'Loading modules';
    const { engine, state, loadAll, flushSaves } = await import('/app/js/store.js');
    const { mountStudio } = await import('/app/js/ui.js');
    result.textContent = 'Loading project'; await loadAll(); state.ui.view = 'editor'; state.ui.locale = 'en-US'; state.ui.device = Object.keys(engine.project.devices)[0]; state.ui.slideId = engine.project.slides[0].id;

    const { createOverview } = await import('/app/js/ui/overview.js');
    const seed = engine.project.slides[0];
    engine.project.slides = Array.from({length:8},(_,i)=>({...structuredClone(seed),id:'slide-'+i,name:'Screen '+(i+1),...(i===1?{canvasOrientations:{[state.ui.device]:'landscape'}}:{})}));
    engine.project.locales.push({id:'sv',native:'Svenska',name:'Swedish',lang:'sv',dir:'ltr'});
    engine.data.copy.sv = structuredClone(engine.data.copy['en-US']);
    state.ui.overviewMode='language';state.ui.overviewZoom=100;state.ui.view='overview';
    const snapshot=JSON.stringify(engine.project);
    mountStudio(document.querySelector('#root'));
    const viewport=()=>document.querySelector('.overview-viewport');
    await waitFor(()=>viewport()?.clientWidth>0 && document.querySelector('.strip canvas')?.style.width);
    const firstWidth=parseFloat(document.querySelector('.strip canvas').style.width);
    check(viewport().scrollWidth>viewport().clientWidth+500,'Wide row must overflow inside its viewport');
    check(document.querySelector('.app').getBoundingClientRect().width<=innerWidth+1,'Wide row must not expand the app outside the window');
    viewport().scrollLeft=250;check(viewport().scrollLeft===250,'Horizontal scrolling must work');
    button('All languages').click();
    const rows=[...document.querySelectorAll('.overview-language')];check(rows.length===2,'Each language needs its own row');
    check(rows[1].getBoundingClientRect().top>rows[0].getBoundingClientRect().bottom,'Language rows must stack vertically');
    for(const row of rows)check(parseFloat(row.querySelector('canvas').style.width)===firstWidth,'All languages must keep the same preview size');
    check(viewport().scrollHeight>viewport().clientHeight,'Multiple language rows must scroll vertically');
    const field=document.querySelector('[aria-label="Overview zoom percent"]');
    field.value='137';field.dispatchEvent(new Event('change',{bubbles:true}));
    check(Math.abs(parseFloat(rows[0].querySelector('canvas').style.width)-firstWidth*1.37)<.1,'Custom zoom must scale previews');
    check(state.ui.overviewZoom===137,'Custom zoom must persist');
    check(JSON.parse(localStorage.getItem('mmd-studio-ui-v1')).overviewZoom===137,'Zoom must survive reopening');
    viewport().scrollLeft=350;viewport().scrollTop=100;
    const anchorCanvas=rows[0].querySelectorAll('canvas')[1],oldRect=anchorCanvas.getBoundingClientRect(),viewRect=viewport().getBoundingClientRect();
    const point={clientX:viewRect.left+viewport().clientWidth*.5,clientY:viewRect.top+80};
    const anchor={x:(point.clientX-oldRect.left)/oldRect.width,y:(point.clientY-oldRect.top)/oldRect.height};
    const pinch=new WheelEvent('wheel',{...point,ctrlKey:true,deltaY:-2.5,bubbles:true,cancelable:true});
    viewport().dispatchEvent(pinch);check(pinch.defaultPrevented,'Overview must consume pinch without zooming the page');
    const newRect=anchorCanvas.getBoundingClientRect();
    check(Math.abs(newRect.width-oldRect.width*Math.exp(.025))<.15,'Overview pinch must scale continuously');
    check(Math.abs(newRect.left+anchor.x*newRect.width-point.clientX)<1.5 && Math.abs(newRect.top+anchor.y*newRect.height-point.clientY)<1.5,'Overview pinch must preserve the point under the pointer');
    const pan=new WheelEvent('wheel',{deltaX:2.75,deltaY:1.5,bubbles:true,cancelable:true});viewport().dispatchEvent(pan);
    check(!pan.defaultPrevented,'Ordinary trackpad panning must remain native in Overview');
    await new Promise(r=>setTimeout(r,200));
    check(state.ui.overviewZoom>137 && state.ui.overviewZoom<141,'Pinch zoom must be remembered after the gesture');
    check(rows[0].querySelector('canvas').style.width===rows[1].querySelector('canvas').style.width,'Pinch must keep every language at the same scale');
    viewport().scrollLeft=0;document.querySelector('[aria-label="Scroll screenshots right"]').click();
    await waitFor(()=>viewport().scrollLeft>0);
    button('Fit to width').click();
    await waitFor(()=>viewport().scrollWidth<=viewport().clientWidth+2);
    check(viewport().scrollLeft===0,'Fit must reset horizontal scroll');
    const beforeFit=parseFloat(rows[0].querySelector('canvas').style.width);
    document.querySelector('#root').style.width='600px';
    // Exercise the same resize notification delivered by the native window.
    window.dispatchEvent(new Event('resize'));
    await waitFor(()=>parseFloat(rows[0].querySelector('canvas').style.width)<beforeFit);
    check(viewport().scrollWidth<=viewport().clientWidth+2,'Fit must recompute when the window area shrinks');
    check(rows[0].querySelector('canvas').style.width===rows[1].querySelector('canvas').style.width,'Fit must be shared across all languages');
    button('This language').click();
    check(document.querySelectorAll('.overview-language').length===1,'Single language mode must return to one row');
    check(state.ui.overviewZoom==='fit','Changing languages must keep zoom');
    check(JSON.stringify(engine.project)===snapshot,'Zoom and scrolling must never alter document content');
    result.textContent='PASS: contained horizontal scroll, vertical language rows at equal size, custom zoom and persistence, anchored pinch and native pan, navigation buttons, responsive Fit to width, no document mutation';
  } catch (e) { result.textContent = 'FAIL: ' + e.stack; }
  </script></body></html>`);
  const testPage = path.join(appPath, 'overview-ui-test.html'), html = fs.readFileSync(testPage, 'utf8');
  const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  fs.writeFileSync(path.join(appPath, 'overview-ui-test.js'), inline[1]);
  fs.writeFileSync(testPage, html.replace(inline[0], '<script type="module" src="/app/overview-ui-test.js"></script>'));
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const stdout = await new Promise((resolve, reject) => execFile(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${path.join(temp, 'chrome')}`, `--window-size=${process.env.OVERVIEW_TEST_WIDTH ?? 1100},800`, `http://127.0.0.1:${server.address().port}/app/overview-ui-test.html`], { timeout: 40000, maxBuffer: 4 * 1024 * 1024 }, (error, output, stderr) => { fs.writeFileSync('/tmp/studio-overview-ui-chrome.log', stderr); fs.writeFileSync('/tmp/studio-overview-ui-dom.html', output); error ? reject(error) : resolve(output); }));
  const verdict = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'No test result'; assert.match(verdict, /^PASS:/, verdict);

  console.log(verdict);
} finally { server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); service?.close(); fs.rmSync(temp, { recursive: true, force: true }); }
