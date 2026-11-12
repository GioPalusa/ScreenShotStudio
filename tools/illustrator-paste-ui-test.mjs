import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createStudioService} from '../host/service.mjs';
import {createNewProject} from '../host/new-project.mjs';
import {runBrowserTest} from './browser-test-runner.mjs';
import {adobeTextFixture} from './fixtures/adobe-text.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-illustrator-')),appPath=path.join(temp,'app'),projectPath=path.join(temp,'Paste.sss');
const svg=`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 2600"><defs><style>.title {fill:#fff;font-family:Arial;font-size:100px;font-weight:700}</style></defs><path d="M0 2000H800V2100H0Z" fill="#ff0000"/><text class="title" transform="translate(0 2200)"><tspan x="0" y="0">Make </tspan><tspan x="300" y="0">space</tspan><tspan x="0" y="120">for focus</tspan></text></svg>`;
let service,server,fontResolves=0;
try{
 fs.cpSync(path.resolve('app'),appPath,{recursive:true});createNewProject(projectPath,{});
 fs.writeFileSync(path.join(appPath,'illustrator-test.html'),'<!doctype html><link rel="stylesheet" href="/app/css/studio.css"><div id="root" style="height:100vh"></div><pre id="result">PENDING</pre><script type="module" src="/app/illustrator-test.js"></script>');
 fs.writeFileSync(path.join(appPath,'illustrator-test.js'),`
 const q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)},pause=()=>new Promise(r=>setTimeout(r,30)),wait=async f=>{for(let i=0;i<500;i++){if(f())return;await pause();}throw Error('Timed out: '+document.body.textContent)};
 try{
  const {engine,state,loadAll,flushSaves,undo,redo}=await import('/app/js/store.js'),{createEditor}=await import('/app/js/ui/editor.js');
  await loadAll();state.ui.view='editor';state.ui.locale='en-US';state.ui.device=Object.keys(engine.project.devices)[0];state.ui.slideId=engine.project.slides[0].id;state.ui.allScreens=false;
  const editor=createEditor({go(){},openExport(){}});q('#root').append(editor.el);editor.build();editor.activate();await wait(()=>editor.ed.scene);
  const layers=()=>engine.project.slides[0].layouts[state.ui.device].layers??[],snapshot=()=>JSON.stringify([engine.project,engine.data.copy]),original=snapshot(),count=layers().length;
  const svg=await(await fetch('/fixture.svg')).text();let nativePastes=0,reads=0;
  let clipboard={svg,text:'Make spacefor focus'};
  window.studioDesktop={readClipboard:async()=>{reads++;return clipboard;},paste:async()=>{nativePastes++;}};
  const preview=document.createElement('canvas');preview.width=preview.height=1;preview.getContext('2d').fillRect(0,0,1,1);
  const rich=await(await fetch('/adobe-text.json')).text();clipboard={adobeText:rich,text:'Clear thoughts\\u0003Make room',image:{mime:'image/png',data:preview.toDataURL().split(',')[1]}};
  await editor.ed.pasteClipboard();await wait(()=>layers().length===count+1);await flushSaves();
  let richLayer=layers().at(-1);check(richLayer.type==='text','An Illustrator text box pastes as editable text instead of its PNG preview');
  check(engine.data.copy['en-US'][state.ui.slideId][richLayer.field]==='Clear thoughts\\nMake room','Illustrator paragraphs become real editable line breaks');
  check(richLayer.fontFamily==='Arial'&&richLayer.weight===700&&richLayer.size===42&&Math.abs(richLayer.lineHeight-1.2)<.00001,'Illustrator font family, weight, size and leading remain intact');
  const richStable=snapshot();undo();await flushSaves();check(snapshot()===original,'The formatted text paste is one Undo step');redo();await flushSaves();check(snapshot()===richStable,'Formatted text Redo retains font and line breaks');undo();await flushSaves();await pause();
  const findButton=label=>[...document.querySelectorAll('button')].reverse().find(b=>b.textContent===label);
  clipboard={adobeText:await(await fetch('/adobe-text.json?missing')).text()};let pending=editor.ed.pasteClipboard();await wait(()=>q('[aria-label="Missing fonts"]'));check(snapshot()===original,'Missing Illustrator font is reviewed before any document edits');findButton('Cancel').click();await pending;check(snapshot()===original,'Cancelling Illustrator font review leaves the document untouched');
  pending=editor.ed.pasteClipboard();await wait(()=>q('[aria-label="Missing fonts"]'));findButton('Replace fonts…').click();findButton('Use replacement').click();await pending;await wait(()=>layers().length===count+1);await flushSaves();richLayer=layers().at(-1);check(richLayer.type==='text'&&richLayer.fontFamily==='system-ui'&&engine.data.copy['en-US'][state.ui.slideId][richLayer.field]==='Clear thoughts\\nMake room','An explicit missing-font replacement preserves editable Illustrator text and line breaks');undo();await flushSaves();await pause();
  clipboard={adobeText:'{invalid',image:{mime:'image/png',data:preview.toDataURL().split(',')[1]}};await editor.ed.pasteClipboard();check(snapshot()===original&&!q('[aria-label="Missing fonts"]'),'Malformed Illustrator text never silently becomes a PNG');
  clipboard={svg,text:'Make spacefor focus'};reads=0;
  await editor.ed.pasteClipboard();check(reads===1&&nativePastes===0,'Canvas paste reads the native design clipboard before relying on Chromium paste');
  await wait(()=>layers().length===count+4);await flushSaves();
  const imported=layers().slice(count),texts=imported.filter(l=>l.type==='text');
  check(imported.some(l=>l.shape==='path'),'Illustrator paths remain editable vectors');
  check(texts.length===3&&texts.every(l=>l.fontFamily==='Arial'&&l.size>0&&l.weight===700),'Positioned Illustrator text spans preserve typography as editable text');
  check(texts[2].capTop>texts[0].capTop&&texts[1].capTop===texts[0].capTop,'Explicit span positions and line breaks are retained');
  await wait(()=>editor.ed.selectionLayers().length===4);
  const {selectionBounds}=await import('/app/js/selection.js'),bounds=selectionBounds(editor.ed.selectionLayers());
  check(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.w<=editor.ed.scene.W+.1&&bounds.y+bounds.h<=editor.ed.scene.H+.1,'Illustrator artwork is centred on canvas instead of retaining empty artboard margins');
  const stable=snapshot();undo();await flushSaves();check(snapshot()===original,'Illustrator paste undoes in one step');redo();await flushSaves();check(snapshot()===stable,'Illustrator paste redoes faithfully');undo();await flushSaves();await pause();
  // Fractional font sizes and scaling must not introduce line breaks into SVG runs.
  clipboard={svg:svg.replace('100px','180.789px').replace('H800V2100','H1600V2100')};await editor.ed.pasteClipboard();await wait(()=>layers().length===count+4);await flushSaves();
  const scaledScene=engine.scene(state.ui.slideId,state.ui.device,'en-US'),scaledCanvas=document.createElement('canvas');await engine.render(scaledCanvas,scaledScene,{scale:1});
  const scaledIds=new Set(layers().slice(count).filter(l=>l.type==='text').map(l=>l.id));check(Object.entries(scaledScene.texts).filter(([id])=>scaledIds.has(id)).every(([,t])=>t.lines===1),'Fractionally scaled SVG text never gains an extra wrapped line');undo();await flushSaves();await pause();
  // File import must use the same native SVG conversion.
  await editor.ed.addImage([new File([svg],'Illustrator.svg',{type:'image/svg+xml'})]);await wait(()=>layers().length===count+4);await flushSaves();undo();await flushSaves();await pause();
  const source=document.createElement('canvas');source.width=12;source.height=8;source.getContext('2d').fillStyle='#ff0000';source.getContext('2d').fillRect(0,0,12,8);
  const webp=await new Promise(r=>source.toBlob(r,'image/webp',1));check(webp.type==='image/webp','Browser generated a real WebP fixture');
  const file=new File([webp],'Art.webp',{type:'image/webp'});
  await editor.ed.addImage([file]);await wait(()=>layers().length===count+1);await flushSaves();
  const image=layers().at(-1);check(image.type==='art'&&image.src.endsWith('.webp'),'WebP files remain portable WebP artwork');
  const scene=engine.scene(state.ui.slideId,state.ui.device,'en-US'),canvas=document.createElement('canvas');await engine.render(canvas,scene,{scale:1});
  const pixel=canvas.getContext('2d').getImageData(Math.round(image.cx),Math.round(image.cy),1,1).data;check(pixel[0]>240&&pixel[1]<15&&pixel[2]<15,'WebP renders with the correct pixels');
  undo();await flushSaves();await pause();
  const bytes=new Uint8Array(await webp.arrayBuffer());clipboard={image:{mime:'image/webp',data:btoa(String.fromCharCode(...bytes))}};
  await editor.ed.pasteClipboard();await wait(()=>layers().length===count+1);await flushSaves();check(layers().at(-1).src.endsWith('.webp'),'Native clipboard WebP pastes as artwork');undo();await flushSaves();await pause();
  const dt=new DataTransfer();dt.items.add(file);document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));await wait(()=>layers().length===count+1);await flushSaves();undo();await flushSaves();
  check(snapshot()===original,'SVG and WebP imports preserve complete Undo state');
  if(${Boolean(process.env.ILLUSTRATOR_SVG_REPRO)}){
    const realSVG=await(await fetch('/real.svg')).text();clipboard={svg:realSVG};await editor.ed.pasteClipboard();await wait(()=>layers().length>count);await flushSaves();
    const realScene=engine.scene(state.ui.slideId,state.ui.device,'en-US'),realCanvas=document.createElement('canvas');await engine.render(realCanvas,realScene,{scale:1});
    const ids=new Set(layers().slice(count).map(l=>l.id)),report=Object.entries(realScene.texts).filter(([id])=>ids.has(id));
    check(report.length>1&&report.every(([,t])=>t.lines===1),'Actual Illustrator text spans stay on their original lines after scaling');undo();await flushSaves();
  }
  if(${Boolean(process.env.ILLUSTRATOR_TEXT_REPRO)}){
    const source=await(await fetch('/real-text.json')).text(),originalText=JSON.parse(source).paragraphs.map(p=>p.text).join('\\n');clipboard={adobeText:source};await editor.ed.pasteClipboard();await wait(()=>layers().length===count+1);await flushSaves();
    const layer=layers().at(-1);check(layer.type==='text'&&layer.fontFamily==='SF Pro Rounded'&&layer.weight===700&&engine.data.copy['en-US'][state.ui.slideId][layer.field]===originalText,'Actual Illustrator text box preserves its font and two paragraphs');
    const scene=engine.scene(state.ui.slideId,state.ui.device,'en-US'),canvas=document.createElement('canvas');await engine.render(canvas,scene,{scale:1});check(scene.texts[layer.id].lines===2,'Actual Illustrator text renders on exactly two lines');undo();await flushSaves();
  }
  q('#result').textContent='PASS: Illustrator text boxes remain editable with original fonts and paragraphs; missing-font cancellation/replacement; malformed-text rejection; native SVG clipboard priority; positioned text spans; SVG/WebP file and clipboard import with rendered pixels; complete Undo/Redo';
 }catch(error){q('#result').textContent='FAIL: '+error.stack;}
 `);
 service=createStudioService({appPath,projectPath,exportPath:path.join(temp,'export')});
 server=http.createServer(async(req,res)=>{
  if(req.url==='/fixture.svg'){res.setHeader('content-type','image/svg+xml');res.end(svg);return;}
  if(req.url.startsWith('/adobe-text.json')){res.setHeader('content-type','application/json');res.end(adobeTextFixture(req.url.includes('missing')?{family:'Unavailable Illustrator font'}:{}));return;}
  if(req.url==='/real.svg'&&process.env.ILLUSTRATOR_SVG_REPRO){res.end(fs.readFileSync(process.env.ILLUSTRATOR_SVG_REPRO));return;}
  if(req.url==='/real-text.json'&&process.env.ILLUSTRATOR_TEXT_REPRO){res.end(fs.readFileSync(process.env.ILLUSTRATOR_TEXT_REPRO));return;}
  if(req.url==='/api/fonts'){res.setHeader('content-type','application/json');res.end(JSON.stringify({families:['Arial','SF Pro Rounded']}));return;}
  if(req.url==='/api/import/fonts'){fontResolves++;for await(const _ of req){}res.setHeader('content-type','application/json');res.end(JSON.stringify({fonts:[],missing:[]}));return;}
  return service.handle(req,res,server.address().port);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const {stdout}=await runBrowserTest(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-sandbox',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1400,1000',`http://127.0.0.1:${server.address().port}/app/illustrator-test.html`],{timeout:40000});
 fs.writeFileSync('/tmp/studio-illustrator-paste-dom.html',stdout);const verdict=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]??'No verdict';assert.match(verdict,/^PASS:/,verdict);assert.equal(fontResolves,2,'Only the two missing-font reviews attempt a font download');console.log(verdict);
}finally{server?.closeAllConnections();await new Promise(r=>server?server.close(r):r());service?.close();fs.rmSync(temp,{recursive:true,force:true});}
