import { clipboardFixture } from './fixtures/figma-clipboard.mjs';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
import { fontInfo } from '../host/project-fonts.mjs';
import { importFigma } from '../host/figma.mjs';
import { encodePNG } from './png.mjs';
import { runBrowserTest } from './browser-test-runner.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/figma-native.json',import.meta.url))),frame=fixture.document.children[0].children[0];
frame.children.find(n=>n.type==='TEXT').style.fontFamily='Mulish';
const fontBytes=fs.readFileSync(new URL('./fixtures/fonts/Mulish.ttf',import.meta.url)),fontLicense=fs.readFileSync(new URL('./fixtures/fonts/OFL.txt',import.meta.url),'utf8');
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(f=>fs.existsSync(f));assert.ok(chrome);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-native-figma-')),appPath=path.join(temp,'app'),projectPath=path.join(temp,'Native.sss');
const pixels=Buffer.alloc(4*4*4,255);for(let i=0;i<pixels.length;i+=4)pixels[i+2]=0;const png=encodePNG({width:4,height:4,data:pixels});
let service,server,disableAutoFonts=false;
try{
  fs.cpSync(path.join(root,'app'),appPath,{recursive:true});createNewProject(projectPath,{});
  fs.writeFileSync(path.join(appPath,'native-test.html'),'<!doctype html><link rel="stylesheet" href="/app/css/studio.css"><div id="root"></div><pre id="result">PENDING</pre><script type="module" src="/app/native-test.js"></script>');
  fs.writeFileSync(path.join(appPath,'native-test.js'),`
  const result=document.querySelector('#result'),check=(v,m)=>{if(!v)throw new Error(m)},button=text=>[...document.querySelectorAll('button')].reverse().find(b=>b.textContent.trim()===text);
  const wait=async fn=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out: '+document.body.textContent)};
  try{
    const store=await import('/app/js/store.js'),{engine,state,loadAll,flushSaves,undo,redo,editCopy}=store;
    const {mountStudio}=await import('/app/js/ui.js'),{openImportFigma}=await import('/app/js/ui/import-figma.js');
    const {parseSVG}=await import('/app/js/svg-import.js');
    await loadAll();state.ui.locale='en-US';state.ui.device='iphone';state.ui.slideId=engine.project.slides[0].id;state.ui.view='editor';
    const ctx={go(route={}){Object.assign(state.ui,route);mountStudio(document.getElementById('root'));}};ctx.go();
    const original=JSON.stringify(engine.project);
    openImportFigma(ctx,{url:'https://www.figma.com/design/TestFile/Design?node-id=1-1'});
    const token=document.querySelector('[aria-label="Figma access token"]');check(token.type==='password','Key must be masked');token.value='test-only-figma-key';token.dispatchEvent(new Event('input'));
    button('Load views').click();await wait(()=>document.querySelector('input[type="checkbox"][value="1:1"]'));
    button('Preview selected views').click();await wait(()=>button('Import 1 view')&&!button('Import 1 view').disabled);
    check(JSON.stringify(engine.project)===original,'Preview must not mutate project');
    check(document.body.textContent.includes('editable text layers')&&document.body.textContent.includes('vector layers'),'Preview must report native types');
    check(!JSON.stringify(engine.data).includes('test-only-figma-key')&&!JSON.stringify(localStorage).includes('test-only-figma-key'),'No key in document/storage');
    button('Import 1 view').click();await wait(()=>!document.querySelector('[aria-label="Figma access token"]'));await flushSaves();
    const slide=engine.project.slides.at(-1),device=state.ui.device;
    check(engine.project.fonts.files.some(f=>f.family==='Mulish'&&f.license),'Font files and license are part of the import');
    check(slide.localeLayouts['en-US'][device].layers.some(l=>l.shape==='path'),'Vector must be stored as path data');
    const render=async()=>{const canvas=document.createElement('canvas'),scene=engine.scene(slide.id,device,'en-US');await engine.render(canvas,scene,{scale:1});return {canvas,scene,pixel:(x,y)=>[...canvas.getContext('2d').getImageData(x,y,1,1).data].slice(0,3).join(',')};};
    let shot=await render();
    check([...document.fonts].some(f=>f.family.includes('Studio document font')&&f.status==='loaded'),'Embedded font loaded without installing it on the Mac');
    const {Engine}=await import('/app/js/render.js'),{preflightScene}=await import('/app/js/preflight.js'),{fontAvailable}=await import('/app/js/ui/export.js');
    check(!preflightScene(shot.scene,engine.data,{fontAvailable,checkCanvas:false}).some(w=>w.code==='font-missing'),'Preflight recognises the embedded original font');
    const reopened=new Engine();reopened.setData(await store.api('/api/project'));const repeat=document.createElement('canvas');await reopened.render(repeat,reopened.scene(slide.id,device,'en-US'),{scale:1});check(repeat.toDataURL()===shot.canvas.toDataURL(),'Saved font produces identical pixels when reopened');
    const broken=new Engine();broken.setData({...engine.data,studio:structuredClone(engine.project)});broken.project.fonts.files[0].file='missing.ttf';const invalid=broken.scene(slide.id,device,'en-US');await broken.render(document.createElement('canvas'),invalid,{scale:.1});check(invalid.warnings.some(w=>w.code==='font-missing'&&w.level==='error'),'Missing embedded font is a technical export error');check(shot.canvas.width===320&&shot.canvas.height===560,'Original dimensions retained');
    check(shot.pixel(50,140)==='0,255,0','Native rectangle renders');check(shot.pixel(210,160)==='0,0,255','Native vector renders');
    check(shot.pixel(100,250)===shot.pixel(30,250)&&Math.abs(Number(shot.pixel(100,250).split(',')[1])-127)<=2,'Ancestor opacity must apply once across overlapping children: '+shot.pixel(100,250)+' single '+shot.pixel(30,250));
    check(shot.pixel(60,390)==='255,0,0'&&shot.pixel(130,390)==='255,255,255','Editable vector mask must clip content');
    check(shot.pixel(250,390)==='255,255,0','Original image fill is portable');
    button('Browse layers').click();[...document.querySelectorAll('.layer-row')].find(r=>r.querySelector('.layer-name')?.textContent==='Blue vector').click();[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='Details').click();await wait(()=>document.querySelector('[aria-label="Vector path 1"]'));
    const pathInput=document.querySelector('[aria-label="Vector path 1"]');pathInput.value='M0 0H100V100H0Z';pathInput.dispatchEvent(new Event('change'));await flushSaves();shot=await render();check(shot.pixel(165,110)==='0,0,255','Vector path editor changes actual geometry');undo();await flushSaves();
    const text=shot.scene.layers.find(l=>l.type==='text');editCopy('en-US',slide.id,text.field,'Changed in Studio');shot=await render();check(shot.scene.layers.find(l=>l.id===text.id)._copy.value==='Changed in Studio','Text is actually editable');undo();await flushSaves();
    undo();check(JSON.stringify(engine.project)===original,'Full native import undoes as one edit');redo();await flushSaves();ctx.go({view:'editor',slideId:slide.id,device});await wait(()=>document.querySelector('.document-details'));
    // SVG remains native geometry, including real text when present and a native clip.
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><clipPath id="c"><rect width="64" height="128"/></clipPath></defs><g clip-path="url(#c)"><path d="M0 0H128V128H0Z" fill="#ff0000"/></g><text x="8" y="24" font-family="Arial" font-size="16">Hello</text></svg>';
    const native=parseSVG(svg);check(native.layers.some(l=>l.shape==='path')&&native.layers.some(l=>l.type==='text'),'SVG paths and text remain native');check(native.layers.some(l=>l.maskOnly),'SVG clip is an editable vector mask');
    const gradientSVG=parseSVG('<svg width="128" height="128" viewBox="0 0 64 64"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10" y1="10" x2="50" y2="10"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><path d="M10 10H50V50H10Z" fill="url(#g)"/></svg>');
    const gp=gradientSVG.layers.find(l=>l.shape==='path');check(gp.w===80&&gp.cx===60&&gp.paints[0].handles[0][0]===0&&gp.paints[0].handles[1][0]===1,'SVG viewBox and user-space gradients must retain geometry');
    const count=engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.length;
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:(()=>{const d=new DataTransfer();d.setData('text/plain',svg);return d;})(),bubbles:true,cancelable:true}));
    await wait(()=>engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.length>count);await flushSaves();
    check(engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.some(l=>l.shape==='path'&&l.paths[0].d==='M0 0H128V128H0Z'),'Cmd+V adds editable SVG paths');
    // CSS property paste opens an in-app review and modifies the selected native object.
    const data=new DataTransfer();data.setData('text/plain','opacity: 0.5;');document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    await wait(()=>button('Apply properties'));button('Apply properties').click();await flushSaves();
    check(engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.some(l=>l.opacity===.5),'CSS properties apply to native selection');
    const beforePNG=engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.length,png=await(await fetch('/fixture.png')).blob(),images=new DataTransfer();images.items.add(new File([png],'Figma selection.png',{type:'image/png'}));
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:images,bubbles:true,cancelable:true}));await wait(()=>engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.length===beforePNG+1);await flushSaves();
    check(engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.at(-1).type==='art','PNG paste must be an image layer, not replace a device capture');
    const links=new DataTransfer();links.setData('text/plain','https://www.figma.com/design/TestFile/Template?node-id=1-1');document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:links,bubbles:true,cancelable:true}));
    await wait(()=>document.querySelector('[aria-label="Figma link"]'));check(document.querySelector('[aria-label="Figma link"]').value.includes('node-id=1-1'),'Selection link opens the internal import dialog');button('Cancel').click();
    // Native Figma Cmd+C/Cmd+V carries real text and paths, without API authentication.
    const nativeHTML=await(await fetch('/native-clipboard.html')).text(),nativeTransfer=new DataTransfer();nativeTransfer.setData('text/html',nativeHTML);
    const beforeNative=engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.length;
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:nativeTransfer,bubbles:true,cancelable:true}));
    await wait(()=>button('Paste editable selection')&&!button('Paste editable selection').disabled);
    check(!document.querySelector('[aria-label="Figma access token"]'),'Native clipboard does not ask for an API key');
    button('Paste editable selection').click();await wait(()=>!document.querySelector('.modal-backdrop'));await flushSaves();
    const nativeLayers=engine.project.slides.at(-1).localeLayouts['en-US'][device].layers;
    check(nativeLayers.length===beforeNative+3,'Native Figma clipboard inserts all three native layers');
    check(nativeLayers.slice(-3).some(l=>l.type==='text'&&engine.data.copy['en-US'][slide.id][l.field]==='Editable clipboard text'),'Clipboard text remains editable text');
    undo();await flushSaves();check(engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.length===beforeNative,'Native paste is one undoable edit');
    // Missing SVG fonts require an explicit choice and cancellation must not mutate the project.
    const beforeMissing=JSON.stringify(engine.project),missingSVG=svg.replace('Arial','Missing Fixture Font');
    const sendSVG=()=>{const d=new DataTransfer();d.setData('text/plain',missingSVG);document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));};
    sendSVG();await wait(()=>document.querySelector('[aria-label="Missing fonts"]'));check(JSON.stringify(engine.project)===beforeMissing,'Missing-font review does not mutate document');check(document.querySelectorAll('[aria-label="Missing fonts"] .font-requirement button,[aria-label="Missing fonts"] .font-requirement select').length===0&&document.querySelectorAll('[aria-label="Missing fonts"] select').length===1,'Font rows have no per-font actions and one shared replacement selector');button('Cancel').click();await new Promise(r=>setTimeout(r,100));check(JSON.stringify(engine.project)===beforeMissing,'Cancelled font review leaves document unchanged');
    sendSVG();await wait(()=>document.querySelector('[aria-label="Replacement font"]'));button('Replace fonts…').click();document.querySelector('[aria-label="Replacement font"]').value='Arial';button('Use replacement').click();await wait(()=>engine.project.slides.at(-1).localeLayouts['en-US'][device].layers.some(l=>l.fontFamily==='Arial'));await flushSaves();
    check(!JSON.stringify(engine.project).includes('Missing Fixture Font'),'Replacement is persisted instead of silent browser fallback');undo();await flushSaves();
    // Full Figma preview and import apply the replacement to editable text.
    openImportFigma(ctx,{url:'https://www.figma.com/design/MissingFile/Design?node-id=1-1'});document.querySelector('[aria-label="Figma access token"]').value='test-only-figma-key';button('Load views').click();await wait(()=>document.querySelector('input[value="1:1"]'));button('Preview selected views').click();await wait(()=>document.querySelector('[aria-label="Missing fonts"]'));button('Replace fonts…').click();button('Use replacement').click();await wait(()=>button('Import 1 view')&&!button('Import 1 view').disabled);check(document.querySelector('canvas[aria-label^="Figma preview"]'),'Replacement has a rendered Figma preview');button('Import 1 view').click();await wait(()=>!document.querySelector('.modal-backdrop'));await flushSaves();
    const imported=engine.project.slides.at(-1),replacementText=imported.localeLayouts['en-US'][state.ui.device].layers.find(l=>l.type==='text');check(replacementText.fontFamily==='system-ui'&&replacementText.field,'Figma replacement remains editable native text');
    // Original font files can be added directly inside the warning dialog.
    await fetch('/disable-auto-fonts');const {importFontControls}=await import('/app/js/ui/import-fonts.js');
    const controls=importFontControls({active:()=>true,existing:[]});document.body.append(controls.el);const fontLayers=[{type:'text',fontFamily:'Mulish',weight:400}];await controls.resolve(fontLayers);const review=controls.reviewMissing();await wait(()=>document.querySelector('[aria-label="Missing fonts"]'));
    const fontFile=await(await fetch('/fixture.ttf')).blob(),dt=new DataTransfer();dt.items.add(new File([fontFile],'Mulish.ttf'));const picker=document.querySelector('[aria-label="Missing fonts"] input[type=file]');picker.files=dt.files;picker.dispatchEvent(new Event('change'));await wait(()=>button('Continue')&&!button('Continue').hidden&&!button('Continue').disabled);check(document.querySelector('[aria-label="Missing fonts"] .font-requirement[data-family="Mulish"]').dataset.status==='resolved','Resolved family stays visible after successful upload');button('Continue').click();check(await review,'Original font review accepted');check(controls.replaceLayers(fontLayers)[0].fontFamily==='Mulish'&&controls.files.some(f=>f.family==='Mulish'),'Original family retained with uploaded font');const savedFonts=await controls.save();check(savedFonts.some(f=>f.file&&f.family==='Mulish'),'Uploaded original font saved portably');controls.close();controls.el.remove();
    for(const partial of [true,false]){
      const needs=[{type:'text',fontFamily:'Unmatched Fixture Font',weight:700},...(partial?fontLayers:[])],c=importFontControls({active:()=>true,existing:[]});document.body.append(c.el);await c.resolve(needs);const pendingReview=c.reviewMissing();await wait(()=>document.querySelector('[aria-label="Missing fonts"]'));const dialog=document.querySelector('[aria-label="Missing fonts"]'),upload=dialog.querySelector('input[type=file]'),files=new DataTransfer();files.items.add(new File([fontFile],'Mulish.ttf'));upload.files=files.files;upload.dispatchEvent(new Event('change'));await wait(()=>dialog.querySelector('.font-upload-results').textContent.includes('Mulish')&&!upload.disabled);
      const rows=[...dialog.querySelectorAll('.font-requirement')];check(rows.find(r=>r.dataset.family==='Unmatched Fixture Font').dataset.status==='missing','Unmatched font remains explicitly missing after upload');check(!c.ready&&button('Continue').hidden,'A non-matching or partial upload does not unlock original-font confirmation');
      if(partial)check(rows.find(r=>r.dataset.family==='Mulish').dataset.status==='resolved'&&rows.length===2,'Partial upload keeps both resolved and unresolved families visible');else check(dialog.querySelector('.font-upload-results').textContent.includes('does not match'),'Wrong font file reports that it covers no requested face');
      button('Cancel').click();check(!(await pendingReview),'Incomplete font review cancels');c.close();c.el.remove();
    }
    const {fontPicker}=await import('/app/js/ui/font-picker.js');const fp=fontPicker({value:'system-ui',inherited:'system-ui',onChange:()=>{}});document.body.append(fp);const fontSelect=fp.querySelector('select');check(!fontSelect.disabled&&fontSelect.selectedOptions[0].textContent==='System font','System choice works before the font catalogue returns');fontSelect.value='';fontSelect.dispatchEvent(new Event('change'));await wait(()=>[...fontSelect.options].some(o=>o.value==='Arial'));check(fontSelect.value==='','Async catalogue preserves a selection made while loading');fp.remove();
    // Repeated pastes need independent group and mask IDs; malformed SVG must never execute.
    let rejected=false;try{parseSVG('<svg width="100" height="100"><script>window.unsafe=true</script></svg>');}catch{rejected=true;}check(rejected&&!window.unsafe,'SVG scripts rejected');
    result.textContent='PASS: in-app Figma connection/selection/preview/import, editable text/shapes/vectors, masks and group opacity, portable image fills, save/Undo/Redo, SVG and CSS clipboard, key isolation and portable fonts with identical reopened pixels; native Figma clipboard text and vectors; missing-font cancellation, SVG/Figma replacements and original-font upload with complete, partial and unmatched coverage';
  }catch(error){result.textContent='FAIL: '+error.stack;}
  `);
  service=createStudioService({appPath,projectPath,exportPath:path.join(temp,'export')});
  server=http.createServer(async(req,res)=>{
    if(req.url==='/disable-auto-fonts'){disableAutoFonts=true;res.end('ok');return;}
    if(req.url==='/fixture.ttf'){res.setHeader('content-type','font/ttf');res.end(fontBytes);return;}
    if(req.url==='/native-clipboard.html'){res.setHeader('content-type','text/plain');res.end(clipboardFixture());return;}
    if(req.url==='/fixture.png'){res.setHeader('content-type','image/png');res.end(png);return;}
    if(req.url==='/api/import/fonts'){const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));if(input.action==='resolve'){res.setHeader('content-type','application/json');res.end(JSON.stringify({fonts:disableAutoFonts||input.families.includes('Missing Fixture Font')?[]:[{...fontInfo(fontBytes),data:fontBytes.toString('base64'),license:fontLicense,source:'Google Fonts fixture'}],missing:[]}));return;}req=Object.assign((await import('node:stream')).Readable.from([Buffer.from(JSON.stringify(input))]),{url:req.url,method:req.method,headers:req.headers});}
    if(req.url==='/api/fonts'){res.setHeader('content-type','application/json');res.end(JSON.stringify({families:['Arial']}));return;}
    if(req.url==='/api/import/figma'){
      try{const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));const sourceFrame=structuredClone(frame);if(input.url.includes('MissingFile'))sourceFrame.children.find(n=>n.type==='TEXT').style.fontFamily='Missing Fixture Font';const data=await importFigma(input,{fetchImpl:async url=>url.includes('/nodes?')?Response.json({name:'Fixture',version:'123',nodes:{'1:1':{document:sourceFrame}}}):url.endsWith('/images')?Response.json({meta:{images:{'test-image':'https://s3-alpha.figma.com/test.png'}}}):new Response(png)});res.setHeader('content-type','application/json');res.end(JSON.stringify(data));}catch(error){res.writeHead(error.status??500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}return;
    }
    service.handle(req,res,server.address().port);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {stdout}=await runBrowserTest(chrome,['--headless','--disable-gpu','--no-sandbox','--no-first-run',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1400,1000',`http://127.0.0.1:${server.address().port}/app/native-test.html`],{timeout:40000});
  fs.writeFileSync('/tmp/studio-figma-native-dom.html',stdout);const verdict=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]??'No result';assert.match(verdict,/^PASS:/,verdict);
  const saved=fs.readFileSync(path.join(projectPath,'studio.json'),'utf8');assert.ok(!saved.includes('test-only-figma-key'));console.log(verdict);
}finally{server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());service?.close();fs.rmSync(temp,{recursive:true,force:true});}
