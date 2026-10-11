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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-translation-import-')), appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Test.sss');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(file => fs.existsSync(file));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
let service, server; const requests = [];
try {
  fs.cpSync(path.join(root, 'app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  const project = JSON.parse(fs.readFileSync(path.join(projectPath, 'studio.json'))); project.locales.push({ id: 'sv-SE', name: 'Swedish', native: 'Svenska', dir: 'ltr', lang: 'sv' });
  fs.writeFileSync(path.join(projectPath, 'studio.json'), JSON.stringify(project)); fs.writeFileSync(path.join(projectPath, 'copy/sv-SE.json'), JSON.stringify({ _meta: { status: 'draft', needsReview: ['*'] } }));
  fs.writeFileSync(path.join(appPath, 'integration-test.html'), '<!doctype html><html><head><link rel="stylesheet" href="/app/css/studio.css"></head><body><div id="root" style="height:100vh"></div><pre id="result">PENDING</pre><script type="module" src="/app/integration-test.js"></script></body></html>');
  fs.writeFileSync(path.join(appPath, 'integration-test.js'), `
  const result=document.querySelector('#result'),check=(v,m)=>{if(!v)throw new Error(m)};
  const waitFor=async fn=>{for(let i=0;i<800;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out: '+document.querySelector('.modal-body')?.textContent)};
  const button=text=>[...document.querySelectorAll('button')].reverse().find(b=>b.textContent.trim()===text);
  const select=(node,value)=>{node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));};
  try {
    const store=await import('/app/js/store.js'), {engine,state,loadAll,flushSaves,undo,redo}=store;
    const {mountStudio}=await import('/app/js/ui.js'); const {openTranslate}=await import('/app/js/ui/translate-dialog.js');
    const {openImportDesigns}=await import('/app/js/ui/import-designs.js');
    await loadAll();state.ui.locale='sv-SE';state.ui.device='iphone';state.ui.slideId=engine.project.slides[0].id;state.ui.view='languages';
    const ctx={go(){mountStudio(document.querySelector('#root'));}};ctx.go();
    check(button('Translate…').querySelector('svg'),'Translate button must have the classic translate icon');
    const before=JSON.stringify(engine.data.copy['sv-SE']),source=JSON.stringify(engine.data.copy['en-US']);
    button('Translate…').click();check(document.querySelector('[aria-label="API key"]').type==='password','API key must be masked');
    let key=document.querySelector('[aria-label="API key"]');key.value='test-only-token';key.dispatchEvent(new Event('input',{bubbles:true}));button('Translate').click();
    await waitFor(()=>!document.querySelector('.translation-dialog'));
    check(engine.data.copy['sv-SE'][state.ui.slideId].headline.startsWith('SV '),'Translation must update target text');
    check(engine.data.copy['sv-SE']._meta.status==='draft' && engine.data.copy['sv-SE']._meta.needsReview.includes('*'),'Machine text needs review');
    check(JSON.stringify(engine.data.copy['en-US'])===source,'Source language unchanged');
    check(!Object.values(localStorage).some(v=>v.includes('test-only-token')) && !JSON.stringify(engine.data).includes('test-only-token'),'No key in local storage or document');
    undo();check(JSON.stringify(engine.data.copy['sv-SE'])===before,'Translation must undo as one edit');redo();await flushSaves();
    openTranslate(ctx);let dlg=document.querySelector('.translation-dialog');
    // Empty scope does not call the provider; replacement is an explicit choice.
    check(button('Translate').disabled,'Missing-only translation is disabled when all text exists');
    const selects=[...dlg.querySelectorAll('select')];select(selects.find(s=>[...s.options].some(o=>o.value==='replace')),'replace');
    key=document.querySelector('[aria-label="API key"]');key.value='test-error';key.dispatchEvent(new Event('input'));const translated=JSON.stringify(engine.data.copy['sv-SE']);button('Translate').click();
    await waitFor(()=>dlg.textContent.includes('Fixture provider unavailable'));check(JSON.stringify(engine.data.copy['sv-SE'])===translated,'Provider failure must leave target unchanged');button('Cancel').click();check(!document.querySelector('[aria-label="API key"]'),'Closing discards key input');
    openTranslate(ctx);dlg=document.querySelector('.translation-dialog');select([...dlg.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='replace')),'replace');
    key=document.querySelector('[aria-label="API key"]');key.value='test-cancel';key.dispatchEvent(new Event('input'));button('Translate').click();button('Cancel').click();await new Promise(r=>setTimeout(r,300));check(JSON.stringify(engine.data.copy['sv-SE'])===translated,'Cancellation must not apply a later response');
    // Details starts with exactly the selected field, and offers an explicit wider scope.
    openTranslate(ctx,{target:'sv-SE',slideId:state.ui.slideId,fields:['headline']});dlg=document.querySelector('.translation-dialog');
    check([...dlg.querySelectorAll('select')].some(s=>s.value==='field' && s.selectedOptions[0].textContent==='Selected text'),'Selected text scope must be explicit');
    select([...dlg.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='replace')),'replace');
    check(dlg.textContent.includes('1 text field →'),'Details translates only its selected field');
    key=document.querySelector('[aria-label="API key"]');key.value='test-only-token';key.dispatchEvent(new Event('input'));button('Translate').click();await waitFor(()=>!document.querySelector('.translation-dialog'));
    const makePNG=async(w,h,color)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,w,h);return new Promise(r=>c.toBlob(r,'image/png'));};
    const red=await makePNG(100,200,'#ff0000'),blue=await makePNG(100,200,'#0000ff');
    const originalSlides=JSON.stringify(engine.project.slides),originalDevice=JSON.stringify(engine.project.devices.iphone),count=engine.project.slides.length;
    openImportDesigns(ctx);let input=document.querySelector('[aria-label="Import design files"]'),dt=new DataTransfer();dt.items.add(new File([red],'01.png',{type:'image/png'}));dt.items.add(new File([blue],'02.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change'));
    await waitFor(()=>document.querySelectorAll('.import-design-row').length===2 && !button('Import 2 screenshots').disabled);
    check(engine.project.slides.length===count,'Preview must not mutate project');
    button('Import 2 screenshots').click();await waitFor(()=>!document.querySelector('.import-designs'));
    check(engine.project.slides.length===count+2,'Import adds slides');check(JSON.stringify(engine.project.devices.iphone)===originalDevice,'Existing canvas unchanged');
    const imported=engine.project.slides.at(-2),newId=Object.keys(engine.project.devices).find(id=>id!=='iphone'),layer=imported.localeLayouts['sv-SE'][newId].layers[0];
    check(layer.type==='art' && layer.w===100 && layer.h===200,'Imported design is an editable image at original dimensions');
    const scene=engine.scene(imported.id,newId,'sv-SE'),canvas=document.createElement('canvas');await engine.render(canvas,scene,{scale:1});const pixel=canvas.getContext('2d').getImageData(50,100,1,1).data;
    check(pixel[0]===255 && pixel[1]===0 && pixel[2]===0,'Imported image renders correct pixels');
    undo();check(JSON.stringify(engine.project.slides)===originalSlides && !engine.project.devices[newId],'Undo removes import and new canvases');redo();await flushSaves();
    // A folder containing a Framefile and a localized title creates a device plus editable copy.
    openImportDesigns(ctx);input=document.querySelector('[aria-label="Import design folder"]');dt=new DataTransfer();
    const add=(name,data,relative,type='text/plain')=>{const f=new File([data],name,{type});Object.defineProperty(f,'webkitRelativePath',{value:relative});dt.items.add(f);};
    add('Framefile.json',JSON.stringify({default:{title:{text:'Imported headline',color:'#123456'},padding:8}}),'shots/Framefile.json');add('03.png',red,'shots/sv-SE/03.png','image/png');
    input.files=dt.files;input.dispatchEvent(new Event('change'));
    await waitFor(()=>document.querySelectorAll('.import-design-row').length===1 && !button('Import 1 screenshot').disabled);
    select(document.querySelector('[aria-label="Import canvas"]'),'iphone');button('Import 1 screenshot').click();await waitFor(()=>!document.querySelector('.import-designs'));
    const s=engine.project.slides.at(-1),layers=s.localeLayouts['sv-SE'].iphone.layers;
    check(layers.some(l=>l.type==='device') && layers.some(l=>l.type==='text'),'Framefile imports device and text separately');check(engine.data.copy['sv-SE'][s.id].headline==='Imported headline','Framefile title imported');
    const rendered=engine.scene(s.id,'iphone','sv-SE');await engine.render(document.createElement('canvas'),rendered,{scale:.1});check(!rendered.warnings.some(w=>w.code==='capture-missing'),'Imported device capture resolves');await flushSaves();
    result.textContent='PASS: translation icon/dialog, target update, review, undo/redo, key isolation, provider error and cancellation; import preview, exact image pixels, canvas preservation, undo/redo, Framefile device/copy/capture and saved files';
  } catch(e){result.textContent='FAIL: '+e.stack;}
  `);
  service=createStudioService({appPath,projectPath,exportPath:path.join(temp,'export')});
  server=http.createServer(async(req,res)=>{
    if(req.url==='/api/translate'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push({provider:body.provider,count:body.entries.length});
      if(body.token==='test-error'){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:'Fixture provider unavailable'}));return;}
      if(body.token==='test-cancel')await new Promise(r=>setTimeout(r,120));
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({translations:body.entries.map(e=>({id:e.id,text:'SV '+e.text}))}));return;
    }
    service.handle(req,res,server.address().port);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const stdout=await new Promise((resolve,reject)=>execFile(chrome,['--headless','--disable-gpu','--no-sandbox','--no-first-run',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1400,1000','--virtual-time-budget=25000','--dump-dom',`http://127.0.0.1:${server.address().port}/app/integration-test.html`],{timeout:55000,maxBuffer:4*1024*1024},(error,output,stderr)=>{fs.writeFileSync('/tmp/studio-translation-import-chrome.log',stderr);fs.writeFileSync('/tmp/studio-translation-import-dom.html',output);error?reject(error):resolve(output);}));
  const verdict=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]??'No test result';assert.match(verdict,/^PASS:/,verdict);
  const saved=fs.readFileSync(path.join(projectPath,'copy/sv-SE.json'),'utf8');assert.ok(saved.includes('Imported headline'));assert.ok(!saved.includes('test-only-token'));assert.ok(requests.length>=2);console.log(verdict);
}finally{server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());service?.close();fs.rmSync(temp,{recursive:true,force:true});}
