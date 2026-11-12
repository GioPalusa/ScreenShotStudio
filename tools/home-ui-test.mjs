import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createStudioService } from '../host/service.mjs';
import { createRecentPreviews, recentPreviewId } from '../host/recent-previews.mjs';
import { createNewProject } from '../host/new-project.mjs';
import { runBrowserTest } from './browser-test-runner.mjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-home-ui-')), appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Home.sss');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(fs.existsSync);
let service, server, previews;
try {
  fs.cpSync(path.resolve('app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  const doc=JSON.parse(fs.readFileSync(path.join(projectPath,'studio.json'))),slide={id:'imported',name:'Imported design',theme:'starter'};doc.slides.push(slide);doc.devices.imported=structuredClone(doc.devices.iphone);
  slide.localeLayouts={'en-US':{imported:{independent:true,template:'custom',panorama:false,layers:[{id:'background',type:'shape',shape:'path',paths:[{d:'M0 0H1100V2400H0Z'}],pathSize:[1100,2400],cx:550,cy:1200,w:1100,h:2400,fill:'#764fca'},{id:'title',type:'text',field:'title',x:80,capTop:140,w:940,size:90,minSize:90,color:'#ffffff'}]}}};
  fs.writeFileSync(path.join(projectPath,'studio.json'),JSON.stringify(doc));fs.writeFileSync(path.join(projectPath,'copy/en-US.json'),JSON.stringify({[slide.id]:{title:'Real project preview'}}));
  fs.writeFileSync(path.join(appPath, 'home-test.html'), '<!doctype html><link rel="stylesheet" href="/app/css/studio.css"><link rel="stylesheet" href="/app/css/welcome.css"><div id="root"></div><pre id="result">PENDING</pre><script type="module" src="/app/home-test.js"></script>');
  fs.writeFileSync(path.join(appPath, 'home-test.js'), `
    const result=document.querySelector('#result'),check=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout: '+document.body.textContent)};
    const actions=[], commands=[], created=[];
    document.documentElement.dataset.theme='dark';
    window.studioDesktop={action:async name=>actions.push(name),recentProjects:async()=>Array.from({length:7},(_,i)=>({name:'Project '+i,path:'/Projects/Project '+i+'.sss',screens:i+1,canvases:2,languages:3,modified:'2026-11-12T10:00:00Z',previewURL:'/recent/${recentPreviewId(projectPath)}'})),onFlush(){},onCommand:fn=>commands.push(fn),createProject:async value=>{created.push(value);return {canceled:true}}};
    try {
      await import('/app/js/ui/welcome.js');await wait(()=>document.querySelectorAll('.home-project').length===7);
      check(!document.querySelector('.home-projects').hidden&&document.querySelector('.welcome-grid').hidden,'Home opens with recent projects, not the new-project form');
      await wait(()=>document.querySelector('.home-cover')?.complete);
      check(document.querySelector('.home-cover').naturalWidth===960,'Project cards contain actual rendered previews');
      const sample=document.createElement('canvas');sample.width=sample.height=1;sample.getContext('2d').drawImage(document.querySelector('.home-cover'),480,300,1,1,0,0,1,1);const rgb=sample.getContext('2d').getImageData(0,0,1,1).data;check(Math.abs(rgb[0]-118)<5&&Math.abs(rgb[1]-79)<5&&Math.abs(rgb[2]-202)<5,'Cover prioritises the real imported design canvas over an empty starter canvas: '+[...rgb]);
      const originalPreview=document.querySelector('.home-cover').src,darkSurface=getComputedStyle(document.querySelector('.home-project')).backgroundColor;
      document.documentElement.dataset.theme='light';check(getComputedStyle(document.querySelector('.home-project')).backgroundColor!==darkSurface,'Light appearance changes the gallery surface');check(document.querySelector('.home-cover').src===originalPreview,'Appearance preserves actual project artwork');document.documentElement.dataset.theme='dark';
      const search=document.querySelector('[aria-label="Search projects"]');search.value='Project 4';search.dispatchEvent(new Event('input'));check(document.querySelectorAll('.home-project').length===1,'Search filters the project gallery');
      search.value='No match';search.dispatchEvent(new Event('input'));check(document.body.textContent.includes('No matching projects'),'Search has an honest empty state');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='Clear search').click();check(document.querySelectorAll('.home-project').length===7,'Clearing search restores all projects');
      const sort=document.querySelector('[aria-label="Sort projects"]');sort.value='name';sort.dispatchEvent(new Event('change'));check(document.querySelector('.home-project strong').textContent==='Project 0','Sorting works');
      check(document.querySelector('.home-sidebar')&&getComputedStyle(document.querySelector('.home-project-list')).display==='grid','Home uses a sidebar and project grid');
      const content=document.querySelector('.home-content');check(content.scrollWidth<=content.clientWidth,'Gallery fits the available window width');
      document.querySelectorAll('.home-project')[4].click();check(actions.at(-1)==='recent:/Projects/Project 4.sss','Every recent project can reopen');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='＋ New project…').click();
      check(!document.querySelector('.welcome-grid').hidden&&document.querySelector('.home-projects').hidden,'New project opens palette-led creation');
      document.querySelector('[aria-label="Project name"]').value='Home test';[...document.querySelectorAll('button')].find(b=>b.textContent==='Create project…').click();await wait(()=>created.length);
      check(created[0].name==='Home test'&&created[0].palette.bg,'New project retains name and palette');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='‹ All projects').click();check(!document.querySelector('.home-projects').hidden,'Back returns to project overview');
      // Check the document logo and actual command handlers used by the native File menu.
      const {loadAll}=await import('/app/js/store.js'),{mountStudio}=await import('/app/js/ui.js');await loadAll();mountStudio(document.querySelector('#root'));
      document.querySelector('[aria-label="Home · Screenshot Studio"]').click();await wait(()=>actions.at(-1)==='welcome');
      commands.at(-1)('import:figma');await wait(()=>document.querySelector('[aria-label="Figma link"]'));
      check(document.querySelector('.modal-backdrop'),'File → Import opens the internal Figma dialog');
      result.textContent='PASS: Home gallery with real previews, search and empty state, sorting, recent projects, new-project palette flow, logo navigation and File import command';
    } catch(error){result.textContent='FAIL: '+error.stack;}
  `);
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  previews=createRecentPreviews({appPath,recentPaths:()=>[projectPath]});
  server = http.createServer(async(req, res) => {if(req.url.startsWith('/recent/')){const response=await previews.request(new Request('studio://local'+req.url));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}return service.handle(req, res, server.address().port);});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { stdout } = await runBrowserTest(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${path.join(temp, 'chrome')}`, `--window-size=${process.env.HOME_TEST_VIEWPORT || '1400,1000'}`, `http://127.0.0.1:${server.address().port}/app/home-test.html`], { timeout: 30000 });
  const verdict = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'No result'; fs.writeFileSync('/tmp/studio-home-ui-dom.html', stdout); assert.match(verdict, /^PASS:/, verdict); console.log(verdict);
} finally { server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); service?.close(); previews?.close(); fs.rmSync(temp, { recursive: true, force: true }); }
