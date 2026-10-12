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
    const store=await import('/app/js/store.js'), {engine,state,loadAll,flushSaves,undo,redo,addLocale,uploadCapture,editCopy}=store;
    const {mountStudio}=await import('/app/js/ui.js'); const {openTranslate}=await import('/app/js/ui/translate-dialog.js');
    const {openImportDesigns}=await import('/app/js/ui/import-designs.js');
    await loadAll();state.ui.locale='sv-SE';state.ui.device='iphone';state.ui.slideId=engine.project.slides[0].id;state.ui.view='languages';
    const ctx={go(){mountStudio(document.querySelector('#root'));}};ctx.go();
    check(button('Translate…').querySelector('svg'),'Translate button must have the classic translate icon');
    const before=JSON.stringify(engine.data.copy['sv-SE']),source=JSON.stringify(engine.data.copy['en-US']);
    button('Translate all…').click();await waitFor(()=>!document.querySelector('[aria-label="API key"]').disabled);check(document.querySelector('[aria-label="Target languages"]').value==='all','Translate all defaults to all target languages');check(document.querySelector('[aria-label="API key"]').type==='password','API key must be masked');
    let key=document.querySelector('[aria-label="API key"]');key.value='test-only-token';key.dispatchEvent(new Event('input',{bubbles:true}));
    check(document.querySelector('select[aria-label="Translation model"]'), 'Model choices use a dropdown');
    button('Load models from API').click();
    await waitFor(()=>document.querySelector('select[aria-label="Translation model"] option[value="gpt-fixture"]'));
    check(document.querySelector('select[aria-label="Translation model"]').value==='gpt-fixture','Fetched model becomes selected');
    button('Translate').click();
    await waitFor(()=>!document.querySelector('.translation-dialog'));
    check(engine.data.copy['sv-SE'][state.ui.slideId].headline.startsWith('SV '),'Translation must update target text');
    check(engine.data.copy['sv-SE']._meta.status==='draft' && engine.data.copy['sv-SE']._meta.needsReview.includes('*'),'Machine text needs review');
    check(JSON.stringify(engine.data.copy['en-US'])===source,'Source language unchanged');
    const meaning=document.querySelector('.lang-row[data-locale="sv-SE"] [data-meaning-review="headline"]');
    check(meaning?.textContent.includes('Manual meaning check needed'),'Unresolved meaning issue must be visible beside its field');
    check(meaning.textContent.includes('Fixture: compare the source text.') && meaning.textContent.includes('Source (en-US):'),'Show the issue and original text');
    check(document.querySelector('.lang-row[data-locale="sv-SE"] [data-meaning-review="caption"]')?.textContent.includes('Meaning check passed after correction'),'Corrected text shows a separate automatic status');
    const {buildTextPanel}=await import('/app/js/ui/text-panel.js');
    const details=buildTextPanel({slide:()=>engine.project.slides.find(s=>s.id===state.ui.slideId),locale:()=>engine.project.locales.find(l=>l.id==='sv-SE'),ctx,refresh(){},device:()=>engine.project.devices[state.ui.device],rebuildInspector(){}},{fields:['headline']}).el;
    check(details.querySelector('[data-meaning-review="headline"]')?.textContent.includes('Manual meaning check needed'),'Details shows the same unresolved meaning warning');
    const firstSlide=state.ui.slideId;
    editCopy('sv-SE',firstSlide,'headline','Manual edit');
    meaning.refreshMeaningReview();check(meaning.textContent.includes('Meaning check outdated'),'Editing invalidates the automatic result');
    undo();meaning.refreshMeaningReview();check(meaning.textContent.includes('Manual meaning check needed'),'Undo restores the meaning result');
    check(!Object.values(localStorage).some(v=>v.includes('test-only-token')) && !JSON.stringify(engine.data).includes('test-only-token'),'No key in local storage or document');
    undo();check(JSON.stringify(engine.data.copy['sv-SE'])===before,'Translation must undo as one edit');redo();await flushSaves();
    openTranslate(ctx);await waitFor(()=>!document.querySelector('[aria-label="API key"]').disabled);let dlg=document.querySelector('.translation-dialog');
    check(document.querySelector('[aria-label="Translation model"]').value==='gpt-fixture','Model choice and fetched model list survive reopening');
    // Empty scope does not call the provider; replacement is an explicit choice.
    check(button('Translate').disabled,'Missing-only translation is disabled when all text exists');
    const selects=[...dlg.querySelectorAll('select')];select(selects.find(s=>[...s.options].some(o=>o.value==='replace')),'replace');
    key=document.querySelector('[aria-label="API key"]');key.value='test-error';key.dispatchEvent(new Event('input'));const translated=JSON.stringify(engine.data.copy['sv-SE']);button('Translate').click();
    await waitFor(()=>dlg.textContent.includes('Fixture provider unavailable'));check(JSON.stringify(engine.data.copy['sv-SE'])===translated,'Provider failure must leave target unchanged');button('Cancel').click();check(!document.querySelector('[aria-label="API key"]'),'Closing discards key input');
    openTranslate(ctx);await waitFor(()=>!document.querySelector('[aria-label="API key"]').disabled);dlg=document.querySelector('.translation-dialog');select([...dlg.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='replace')),'replace');
    key=document.querySelector('[aria-label="API key"]');key.value='test-cancel';key.dispatchEvent(new Event('input'));button('Translate').click();button('Cancel').click();await new Promise(r=>setTimeout(r,300));check(JSON.stringify(engine.data.copy['sv-SE'])===translated,'Cancellation must not apply a later response');
    // Details starts with exactly the selected field, and offers an explicit wider scope.
    openTranslate(ctx,{target:'sv-SE',slideId:state.ui.slideId,fields:['headline']});await waitFor(()=>!document.querySelector('[aria-label="API key"]').disabled);dlg=document.querySelector('.translation-dialog');
    check([...dlg.querySelectorAll('select')].some(s=>s.value==='field' && s.selectedOptions[0].textContent==='Selected text'),'Selected text scope must be explicit');
    select([...dlg.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='replace')),'replace');
    check(dlg.textContent.includes('1 text field →'),'Details translates only its selected field');
    key=document.querySelector('[aria-label="API key"]');key.value='test-only-token';key.dispatchEvent(new Event('input'));button('Translate').click();await waitFor(()=>!document.querySelector('.translation-dialog'));
    await addLocale({id:'de-DE',name:'German',native:'Deutsch',lang:'de',dir:'ltr'});
    const allBefore=JSON.stringify(engine.data.copy);
    openTranslate(ctx,{target:'all'});await waitFor(()=>!document.querySelector('[aria-label="API key"]').disabled);dlg=document.querySelector('.translation-dialog');
    check([...dlg.querySelectorAll('select')].some(s=>s.value==='all' && [...s.options].some(o=>o.textContent==='All slides')),'Translate all covers every slide');
    select([...dlg.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='replace')),'replace');
    key=document.querySelector('[aria-label="API key"]');key.value='test-second-error';key.dispatchEvent(new Event('input'));button('Translate').click();
    await waitFor(()=>dlg.textContent.includes('Fixture provider unavailable'));
    check(JSON.stringify(engine.data.copy)===allBefore,'Failure in the second language keeps every language unchanged');button('Cancel').click();
    openTranslate(ctx,{target:'all'});await waitFor(()=>!document.querySelector('[aria-label="API key"]').disabled);dlg=document.querySelector('.translation-dialog');
    select([...dlg.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='replace')),'replace');
    key=document.querySelector('[aria-label="API key"]');key.value='test-only-token';key.dispatchEvent(new Event('input'));button('Translate').click();
    await waitFor(()=>!document.querySelector('.translation-dialog'));
    check(engine.data.copy['sv-SE'][state.ui.slideId].headline.startsWith('SV ') && engine.data.copy['de-DE'][state.ui.slideId].headline.startsWith('SV '),'One action translates both target languages');
    check(JSON.stringify(engine.data.copy['en-US'])===source,'Bulk translation preserves original copy');
    undo();check(JSON.stringify(engine.data.copy)===allBefore,'All languages undo in one step');redo();await flushSaves();
    const makePNG=async(w,h,color)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,w,h);return new Promise(r=>c.toBlob(r,'image/png'));};
    const red=await makePNG(100,200,'#ff0000'),blue=await makePNG(100,200,'#0000ff');
    await uploadCapture({scope:'en-US',device:'iphone',name:'fallback-check',blob:red,create:true});
    const {Engine}=await import('/app/js/render.js'), {preflightScene}=await import('/app/js/preflight.js');
    const captureEngine=new Engine(),captureProject=structuredClone(engine.project);
    const originalEngine=new Engine(),originalProject=structuredClone(engine.project);
    originalProject.locales=[{id:'en-GB',name:'English (UK)',lang:'en-GB'},{id:'ar-SA',name:'Arabic',lang:'ar',dir:'rtl'}];
    delete originalProject.sourceLocale;
    originalProject.devices={iphone:{size:[400,800],designSize:[400,800],layout:'phone'}};
    originalProject.slides=[{id:'copy-fallback',layouts:{iphone:{template:'custom',layers:[{id:'text',type:'text',field:'headline',x:20,capTop:30,w:360,size:40}]}}}];
    originalEngine.setData({...engine.data,studio:originalProject,copy:{'en-GB':{'copy-fallback':{headline:'Original UK text'}},'ar-SA':{'copy-fallback':{headline:''}}}});
    check(originalEngine.copyFor('ar-SA','copy-fallback','headline')?.value==='Original UK text','Missing translation displays the actual original language, even without en-US');
    const originalScene=originalEngine.scene('copy-fallback','iphone','ar-SA');
    await originalEngine.render(document.createElement('canvas'),originalScene,{scale:1});
    check(!originalScene.layers[0]._empty && originalScene.layers[0]._lang==='en-GB' && originalScene.layers[0]._dir==='ltr','Original-language placeholder preserves source line-breaking and direction in an RTL target');
    captureProject.devices={iphone:{label:'Test',capture:'iphone',size:[100,200],designSize:[100,200],frame:{type:'plain',screen:[100,200],radius:0}}};
    captureProject.slides=[{id:'fallback-check',layouts:{iphone:{template:'custom',layers:[{id:'device',type:'device',capture:'fallback-check',cx:50,top:0,w:100,shadow:false}]}}}];
    captureEngine.setData({...engine.data,studio:captureProject});
    const drawCapture=async()=>{captureEngine.invalidate();const s=captureEngine.scene('fallback-check','iphone','sv-SE'),c=document.createElement('canvas');await captureEngine.render(c,s,{scale:1});return {scene:s,pixel:[...c.getContext('2d').getImageData(50,100,1,1).data]};};
    let shot=await drawCapture();check(shot.pixel[0]===255 && shot.pixel[2]===0,'Original screenshot is rendered when the target has no own or standard image');
    check(!shot.scene.warnings.some(w=>w.code==='capture-missing') && !preflightScene(shot.scene,captureEngine.data).some(w=>w.code==='shared-capture'),'Fallback screenshot has no missing/shared-image warning');
    await uploadCapture({scope:'default',device:'iphone',name:'fallback-check',blob:blue,create:true});captureEngine.setData({...engine.data,studio:captureProject});
    shot=await drawCapture();check(shot.pixel[2]===255 && shot.pixel[0]===0,'Standard screenshot takes priority over original');
    await uploadCapture({scope:'sv-SE',device:'iphone',name:'fallback-check',blob:red,create:true});captureEngine.setData({...engine.data,studio:captureProject});
    shot=await drawCapture();check(shot.pixel[0]===255 && shot.pixel[2]===0,'Language-specific screenshot overrides standard');
    const nativePrefs={},nativeKeys={openai:'synthetic-keychain-key'};
    window.studioDesktop={translationSettings:async(operation,value)=>{
      if(operation==='load'){const provider=value??'openai';return {...nativePrefs[provider],provider,token:nativeKeys[provider]??''};}
      if(operation==='forget'){delete nativeKeys[value];return;}
      const {token,provider,...prefs}=value;nativePrefs[provider]=structuredClone(prefs);if(token)nativeKeys[provider]=token;
    }};
    openTranslate(ctx,{target:'all'});await waitFor(()=>!document.querySelector('[aria-label="API key"]').disabled);
    check(document.querySelector('[aria-label="API key"]').value==='synthetic-keychain-key','Native dialog restores key from Keychain bridge');
    button('Load models from API').click();await waitFor(()=>document.querySelector('[aria-label="Translation model"]').value==='gpt-fixture' && !button('Load models from API').disabled);
    button('Cancel').click();openTranslate(ctx,{target:'all'});await waitFor(()=>!document.querySelector('[aria-label="API key"]').disabled);
    check(document.querySelector('[aria-label="Translation model"]').value==='gpt-fixture','Native saved model list and selection restore');
    button('Forget saved key').click();await waitFor(()=>!document.querySelector('[aria-label="API key"]').value);check(!nativeKeys.openai,'Forget deletes key through native bridge');
    check(!JSON.stringify(nativePrefs).includes('synthetic-keychain-key') && !JSON.stringify(localStorage).includes('synthetic-keychain-key'),'Keychain key never enters preference files or browser storage');
    button('Cancel').click();delete window.studioDesktop;
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
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push({provider:body.provider,model:body.model,target:body.target,count:body.entries.length});
      if(body.token==='test-error' || body.token==='test-second-error' && body.target==='de-DE'){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:'Fixture provider unavailable'}));return;}
      if(body.token==='test-cancel')await new Promise(r=>setTimeout(r,120));
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({translations:body.entries.map(e=>({id:e.id,text:'SV '+e.text,review:e.id==='t0'?{status:'manual',corrected:false,issues:['Fixture: compare the source text.']}:{status:'passed',corrected:true,issues:[]}}))}));return;
    }
    if(req.url==='/api/translate/models'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({models:[{id:'gpt-fixture',name:'Fixture model'}]}));return;}
    service.handle(req,res,server.address().port);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const stdout=await new Promise((resolve,reject)=>execFile(chrome,['--headless','--disable-gpu','--no-sandbox','--no-first-run',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1400,1000',`http://127.0.0.1:${server.address().port}/app/integration-test.html`],{timeout:55000,maxBuffer:4*1024*1024},(error,output,stderr)=>{fs.writeFileSync('/tmp/studio-translation-import-chrome.log',stderr);fs.writeFileSync('/tmp/studio-translation-import-dom.html',output);error?reject(error):resolve(output);}));
  const verdict=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]??'No test result';assert.match(verdict,/^PASS:/,verdict);
    const saved=fs.readFileSync(path.join(projectPath,'copy/sv-SE.json'),'utf8');assert.ok(saved.includes('Imported headline'));assert.ok(JSON.parse(saved)._meta.translationReview.some(r=>r.items.some(item=>item?.status==='manual')),'Meaning reports persist in copy JSON');assert.ok(!saved.includes('test-only-token'));assert.ok(requests.length>=2);assert.equal(requests[0].model,'gpt-fixture');console.log(verdict);console.log('PASS: Translate all across every target, atomic failure/Undo, persisted model lists, Keychain bridge and forgetting keys, pixel-checked original/standard/localized screenshot fallback.');
}finally{server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());service?.close();fs.rmSync(temp,{recursive:true,force:true});}
