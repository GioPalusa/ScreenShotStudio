import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';
import {createStudioService} from '../host/service.mjs';import {createNewProject} from '../host/new-project.mjs';import {createFigmaProject} from '../host/figma-project.mjs';import {importFigma} from '../host/figma.mjs';import {fontInfo} from '../host/project-fonts.mjs';import {runBrowserTest} from './browser-test-runner.mjs';import {encodePNG} from './png.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-figma-home-')),appPath=path.join(temp,'app'),projectPath=path.join(temp,'Seed.sss'),created=[];
const fontBytes=fs.readFileSync(new URL('./fixtures/fonts/Mulish.ttf',import.meta.url)),license=fs.readFileSync(new URL('./fixtures/fonts/OFL.txt',import.meta.url),'utf8');
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/figma-native.json',import.meta.url))),frame=fixture.document.children[0].children[0];
frame.children.find(n=>n.type==='TEXT').style.fontFamily='Mulish';
const second=structuredClone(frame);second.id='2:1';second.name='Second view';
const partial={id:'9:9',type:'TEXT',name:'Partial text',size:{x:80,y:30},characters:'Partial import',style:{fontFamily:'Mulish',fontSize:20},fills:[{type:'SOLID',color:{r:0,g:0,b:0}}]};
const nodes={'1:1':frame,'2:1':second,'9:9':partial},png=encodePNG({width:4,height:4,data:Buffer.alloc(64,255)});
let service,server,picks=0;
try{
 fs.cpSync(path.resolve('app'),appPath,{recursive:true});createNewProject(projectPath,{});
 fs.writeFileSync(path.join(appPath,'figma-home-test.html'),'<!doctype html><link rel="stylesheet" href="/app/css/studio.css"><link rel="stylesheet" href="/app/css/welcome.css"><div id="root"></div><pre id="result">PENDING</pre><script type="module" src="/app/figma-home-test.js"></script>');
 fs.writeFileSync(path.join(appPath,'figma-home-test.js'),`
 const check=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let i=0;i<1500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timeout: '+document.body.textContent)},button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
 window.studioDesktop={recentProjects:async()=>[],onFlush(){},onCommand(){},createFigmaProject:async input=>{const r=await fetch('/test/create',{method:'POST',body:JSON.stringify(input)});return r.json();}};
 try{
  const {engine}=await import('/app/js/store.js');await import('/app/js/ui/welcome.js');check(engine.project===null,'Home has no active document');
  button('Import from Figma…').click();document.querySelector('[aria-label="Figma link"]').value='https://www.figma.com/design/Test/File';document.querySelector('[aria-label="Figma access token"]').value='fixture-key';button('Load views').click();
  await wait(()=>button('Select all'));button('Select all').click();button('Preview selected views').click();await wait(()=>button('Create project with 2 views…')&&!button('Create project with 2 views…').disabled);
  check(engine.project===null,'Preview does not create or activate a project');
  button('Create project with 2 views…').click();await wait(()=>document.body.textContent.includes('Nothing was created.'));check(!button('Create project with 2 views…').disabled,'Save cancellation preserves the preview and selection');
  button('Create project with 2 views…').click();await wait(async()=>false).catch(()=>{});
 }catch(error){if(!String(error).includes('Timeout'))document.querySelector('#result').textContent='FAIL: '+error.stack;}
 `);
 // Complete the async creation checks without relying on native navigation in this browser harness.
 const script=fs.readFileSync(path.join(appPath,'figma-home-test.js'),'utf8').replace("await wait(async()=>false).catch(()=>{});",`await wait(()=>window.createdCount===1);button('Cancel').click();
  button('Import from Figma…').click();document.querySelector('[aria-label="Figma link"]').value='https://www.figma.com/design/Test/File?node-id=9-9';document.querySelector('[aria-label="Figma access token"]').value='fixture-key';button('Load views').click();await wait(()=>document.querySelector('input[value="9:9"]'));button('Preview selected views').click();await wait(()=>button('Create project with 1 view…')&&!button('Create project with 1 view…').disabled);button('Create project with 1 view…').click();await wait(()=>window.createdCount===2);
  check(engine.project===null,'New-project import never modifies the existing renderer document');button('Cancel').click();
  let expiredPreview=true;const authRequests=[];
  window.studioDesktop.figmaSettings=async()=>({stored:true,expired:false,invalid:false});
  window.studioDesktop.figmaImport=async input=>{authRequests.push(input);if(input.action==='load'&&expiredPreview&&!input.token)return {ok:false,status:401,code:'figma-auth',error:'Expired fixture key'};const response=await fetch('/api/import/figma',{method:'POST',body:JSON.stringify({...input,token:input.token||'fixture-key'})});return {ok:response.ok,result:await response.json()};};
  button('Import from Figma…').click();await wait(()=>document.body.textContent.includes('Key saved in macOS Keychain'));document.querySelector('[aria-label="Figma link"]').value='https://www.figma.com/design/Test/File';button('Load views').click();await wait(()=>button('Select all'));button('Select all').click();button('Preview selected views').click();await wait(()=>document.body.textContent.includes('file and selection are retained'));
  check(document.querySelectorAll('input[type=checkbox][value]:checked').length===2,'Expired-key recovery preserves selected views');
  const lifetime=document.querySelector('[aria-label="Figma key lifetime"]'),date=document.querySelector('[aria-label="Figma key expiry date"]');
  check([...lifetime.options].map(o=>o.textContent).join('|')==='1 day|7 days|30 days|90 days|Custom date','All requested token lifetimes are offered');
  for(const days of ['1','7','30','90']){lifetime.value=days;lifetime.dispatchEvent(new Event('change'));check(Boolean(date.value)&&date.closest('label').hidden,'Preset lifetime computes expiry and hides custom date');}
  lifetime.value='custom';lifetime.dispatchEvent(new Event('change'));check(!date.closest('label').hidden,'Custom date opens the date picker');
  lifetime.value='7';lifetime.dispatchEvent(new Event('change'));document.querySelector('[aria-label="Figma access token"]').value='replacement-qa';expiredPreview=false;button('Preview selected views').click();await wait(()=>button('Create project with 2 views…')&&!button('Create project with 2 views…').disabled);
  check(document.querySelector('[aria-label="Figma access token"]').value==='','Validated key is cleared from the renderer field');check(authRequests.at(-1).expiresAt&&authRequests.at(-1).ids.length===2,'Replacement retries the same selection with expiry metadata');
  document.querySelector('#result').textContent='PASS: Home Figma import, full selection, native previews/fonts, cancelled save retry, new project creation, partial selection and Keychain expiry/replacement UI';`)
 .replace("return r.json();", "const data=await r.json();if(data.created)window.createdCount=(window.createdCount??0)+1;return data;");fs.writeFileSync(path.join(appPath,'figma-home-test.js'),script);
 service=createStudioService({appPath,projectPath,exportPath:path.join(temp,'export'),allowFontWrites:false});
 server=http.createServer(async(req,res)=>{
  if(req.url==='/test/create'){const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));res.setHeader('content-type','application/json');if(++picks===1){res.end(JSON.stringify({canceled:true}));return;}const destination=path.join(temp,`Imported-${created.length}.sss`);createFigmaProject(destination,input);created.push(destination);res.end(JSON.stringify({created:true}));return;}
  if(req.url==='/api/import/figma'){const chunks=[];for await(const c of req)chunks.push(c);try{const data=await importFigma(JSON.parse(Buffer.concat(chunks)),{fetchImpl:async value=>{const url=new URL(value);if(url.pathname.endsWith('/images'))return Response.json({meta:{images:{'test-image':'https://s3-alpha.figma.com/test.png'}}});if(url.hostname==='s3-alpha.figma.com')return new Response(png);if(url.pathname.endsWith('/nodes'))return Response.json({name:'Fixture',version:'v1',nodes:Object.fromEntries(url.searchParams.get('ids').split(',').map(id=>[id,{document:nodes[id]}]))});return Response.json({name:'Fixture',version:'v1',document:{type:'DOCUMENT',children:[{type:'CANVAS',children:[frame,second]}]}});}});res.setHeader('content-type','application/json');res.end(JSON.stringify(data));}catch(error){res.writeHead(error.status??500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}return;}
  if(req.url==='/api/import/fonts'){const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));assert.equal(input.action,'resolve','Home never saves media/fonts into the bundled starter');res.setHeader('content-type','application/json');res.end(JSON.stringify({fonts:[{...fontInfo(fontBytes),data:fontBytes.toString('base64'),license,source:'Fixture'}],missing:[]}));return;}
  return service.handle(req,res,server.address().port);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(fs.existsSync);
 const {stdout}=await runBrowserTest(chrome,['--headless','--disable-gpu','--no-sandbox','--no-first-run',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1400,1000',`http://127.0.0.1:${server.address().port}/app/figma-home-test.html`],{timeout:40000});
 const verdict=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]??'No result';fs.writeFileSync('/tmp/studio-figma-home-dom.html',stdout);assert.match(verdict,/^PASS:/,verdict);assert.equal(created.length,2);
 const full=JSON.parse(fs.readFileSync(path.join(created[0],'studio.json'))),part=JSON.parse(fs.readFileSync(path.join(created[1],'studio.json')));assert.equal(full.slides.length,2);assert.equal(part.slides.length,1);assert.equal(Object.keys(full.devices).length,1);assert.deepEqual(Object.values(part.devices)[0].size,[100,100]);assert.ok(full.fonts.files.length);assert.ok(!JSON.stringify(full).includes('fixture-key'));assert.ok(!full.slides.some(s=>s.id==='first-slide'));console.log(verdict);
}finally{server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());service?.close();fs.rmSync(temp,{recursive:true,force:true});}
