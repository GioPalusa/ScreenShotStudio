import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
import { clipboardFixture } from './fixtures/figma-clipboard.mjs';
import { encodePNG } from './png.mjs';
import { runBrowserTest } from './browser-test-runner.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-figma-paste-')),appPath=path.join(temp,'app'),projectPath=path.join(temp,'Paste.sss');
const png=encodePNG({width:4,height:4,data:Buffer.alloc(64,255)});
let service,server,writes=0;
try{
  fs.cpSync(path.resolve('app'),appPath,{recursive:true});createNewProject(projectPath,{});
  fs.writeFileSync(path.join(appPath,'paste-test.html'),'<!doctype html><link rel="stylesheet" href="/app/css/studio.css"><div id="root" style="height:100vh"></div><pre id="result">PENDING</pre><script type="module" src="/app/paste-test.js"></script>');
  fs.writeFileSync(path.join(appPath,'paste-test.js'),`
    const q=s=>document.querySelector(s),button=t=>[...document.querySelectorAll('button')].reverse().find(b=>b.textContent===t),check=(v,m)=>{if(!v)throw Error(m)},pause=()=>new Promise(r=>setTimeout(r,40)),wait=async f=>{for(let i=0;i<300;i++){if(f())return;await pause();}throw Error('Timed out: '+document.body.textContent)};
    try{
      const store=await import('/app/js/store.js'),{engine,state,loadAll,flushSaves,undo,redo}=store,{createEditor}=await import('/app/js/ui/editor.js');
      await loadAll();state.ui.view='editor';state.ui.locale='en-US';state.ui.device=Object.keys(engine.project.devices)[0];state.ui.slideId=engine.project.slides[0].id;state.ui.allScreens=false;
      const editor=createEditor({go(){},openExport(){}});q('#root').append(editor.el);editor.build();editor.activate();await wait(()=>editor.ed.scene);
      const layers=()=>engine.project.slides[0].layouts[state.ui.device].layers??[],snapshot=()=>JSON.stringify([engine.project,engine.data.copy]);
      const original=snapshot(),count=layers().length;
      const paste=async kind=>{
        document.activeElement?.blur();
        const html=await(await fetch('/clipboard?kind='+kind)).text(),data=new DataTransfer();data.setData('text/html',html);
        document.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
      };
      const complete=async expected=>{await wait(()=>layers().length===count+expected);await flushSaves();check(!q('.modal-backdrop'),'Paste finishes without an import modal');};
      const reset=async()=>{undo();await flushSaves();check(snapshot()===original,'The whole paste undoes in one step');await wait(()=>editor.ed.scene);await pause();};
      await paste('complete');await complete(3);check(layers().some(l=>l.type==='text')&&layers().some(l=>l.shape==='path'),'Direct paste keeps text and vectors editable');
      await wait(()=>editor.ed.selectionLayers().length===3&&editor.ed.selectionLayers().every(l=>l._box));
      const {selectionBounds,transformSelection}=await import('/app/js/selection.js');
      const selected=editor.ed.selectionLayers(),bounds=selectionBounds(selected),pastedFrame=layers().find(l=>l.id===selected[0].id),clip=structuredClone(pastedFrame.compositing.find(s=>s.clip).clip);
      const renderSelection=async()=>{const scene=engine.scene(state.ui.slideId,state.ui.device,'en-US'),ids=editor.ed.selectedIds,canvas=document.createElement('canvas');scene.layers=scene.layers.filter(l=>ids.has(l.id));scene.allLayers=scene.layers;await engine.render(canvas,scene,{scale:1});return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);};
      const beforeMove=await renderSelection();
      editor.ed.applyGroup(transformSelection(selected.map(layer=>({layer,box:{...layer._box}})),bounds,{...bounds,x:bounds.x+120,y:bounds.y-80}));
      const movedClip=pastedFrame.compositing.find(s=>s.clip).clip;
      check(movedClip.matrix[4]===clip.matrix[4]+120&&movedClip.matrix[5]===clip.matrix[5]-80,'Moving the whole pasted selection moves its clipping frame with the artwork');
      const afterMove=await renderSelection();let mismatches=0;
      for(let y=Math.max(80,Math.ceil(bounds.y));y<Math.min(beforeMove.height,bounds.y+bounds.h);y+=3)for(let x=Math.max(0,Math.ceil(bounds.x));x<Math.min(beforeMove.width-120,bounds.x+bounds.w);x+=3){const a=(y*beforeMove.width+x)*4,b=((y-80)*afterMove.width+x+120)*4;for(let c=0;c<4;c++)if(beforeMove.data[a+c]!==afterMove.data[b+c]){mismatches++;break;}}
      check(!mismatches,'Translated pasted artwork retains identical rendered pixels, including text and frame clipping');
      editor.handleKey(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await flushSaves();
      check(pastedFrame.compositing.find(s=>s.clip).clip.matrix[4]===movedClip.matrix[4]+1,'Arrow-key movement moves the full clipping frame');undo();await flushSaves();
      await wait(()=>editor.ed.selectionLayers().length===3);await pause();
      const overlay=editor.ed.overlay,frame=editor.ed.selectionLayers().find(l=>l.name?.startsWith('Copied frame')),oldBox={...frame._box},oldClip=structuredClone(frame.compositing.find(s=>s.clip).clip),rect=overlay.getBoundingClientRect(),k=editor.ed.stageWidth/editor.ed.scene.W;
      overlay.setPointerCapture=()=>{};overlay.releasePointerCapture=()=>{};
      const pointer=(type,x,y)=>overlay.dispatchEvent(new PointerEvent(type,{pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,ctrlKey:true,bubbles:true,cancelable:true})),px=rect.left+(oldBox.x+5)*k,py=rect.top+(oldBox.y+oldBox.h-5)*k;
      pointer('pointerdown',px,py);pointer('pointermove',px+17,py+11);pointer('pointermove',px+37,py+21);pointer('pointerup',px+37,py+21);await flushSaves();
      const dragged=layers().find(l=>l.id===frame.id),draggedClip=dragged.compositing.find(s=>s.clip).clip;
      check(Math.abs((dragged.cx-frame.cx)-(draggedClip.matrix[4]-oldClip.matrix[4]))<.06&&Math.abs((dragged.cy-frame.cy)-(draggedClip.matrix[5]-oldClip.matrix[5]))<.06,'Mouse dragging keeps clipping aligned across successive pointer moves');
      check(Math.abs(dragged.cx-frame.cx-37/k)<.06,'Mouse test really moves the entire pasted view');undo();await flushSaves();
      await reset();redo();await complete(3);await reset();
      await paste('missing');await wait(()=>q('[aria-label="Missing images"]'));check(!q('[aria-label="Paste from Figma"]'),'Only the missing-resource dialog appears');check(snapshot()===original,'Missing image review makes no document edits');button('Cancel').click();await pause();check(snapshot()===original,'Cancel leaves the project untouched');
      await paste('missing');await wait(()=>q('[aria-label="Missing images"]'));button('Skip missing images').click();await complete(3);check(!layers().some(l=>l.name?.startsWith('Cover art')),'Skipping drops the unavailable image layer');await reset();
      await paste('missing');await wait(()=>q('[aria-label="Missing images"]'));
      const attach=async(file)=>{const input=q('[aria-label="Attach image Cover art"]'),dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change'));await pause();};
      await attach(new File(['bad'],'broken.png',{type:'image/png'}));await wait(()=>q('[aria-label="Missing images"]').textContent.includes('could not be read'));check(button('Continue paste').disabled,'Invalid image does not unlock paste');check(snapshot()===original,'Invalid file does not edit the project');
      const blob=await(await fetch('/fixture.png')).blob();await attach(new File([blob],'replacement.png',{type:'image/png'}));await wait(()=>!button('Continue paste').disabled);button('Continue paste').click();await complete(4);
      const image=layers().find(l=>l.name?.startsWith('Cover art'));check(image.paints[0].src&&!image.paints[0].ref,'Attached image is stored as portable artwork');
      const scene=engine.scene(state.ui.slideId,state.ui.device,'en-US'),canvas=document.createElement('canvas');const report=await engine.render(canvas,scene,{scale:.1});
      check(!report.warnings.some(w=>w.code==='asset-missing'),'Attached replacement renders without a missing asset');await reset();
      await paste('missing');await wait(()=>q('[aria-label="Missing images"]'));q('[aria-label="Skip image Cover art"]').click();check(!button('Continue paste').disabled,'An explicit per-image skip is accepted');button('Continue paste').click();await complete(3);await reset();
      await paste('unsupported');await wait(()=>q('[aria-label="Missing images"]'));check(q('[aria-label="Missing images"]').textContent.includes('replacement'),'Unsupported image format offers replacement or skip');button('Skip missing images').click();await complete(3);await reset();
      await fetch('/missing-font');await paste('complete');await wait(()=>q('[aria-label="Missing fonts"]'));check(!q('[aria-label="Paste from Figma"]'),'Missing font opens only font review');check(snapshot()===original,'Font review has no destination edits');button('Cancel').click();await pause();check(snapshot()===original,'Cancelling missing fonts leaves destination untouched');
      await paste('complete');await wait(()=>q('[aria-label="Missing fonts"]'));button('Replace fonts…').click();button('Use replacement').click();await complete(3);check(layers().some(l=>l.type==='text'&&l.fontFamily==='system-ui'),'Font replacement pastes directly after the font choice');await reset();
      q('#result').textContent='PASS: direct native Figma paste; clipping follows mouse and keyboard movement with identical rendered pixels; only missing image/font dialogs; attachment, invalid-image retry, per-image/all-image skip, unsupported format, cancellation without edits, editable text/vectors, portable replacement image and one-step Undo';
    }catch(error){q('#result').textContent='FAIL: '+error.stack;}
  `);
  let missingFont=false;
  service=createStudioService({appPath,projectPath,exportPath:path.join(temp,'export')});
  server=http.createServer(async(req,res)=>{
    if(req.method==='PUT')writes++;
    if(req.url.startsWith('/clipboard?')){const kind=new URL(req.url,'http://local').searchParams.get('kind');res.end(clipboardFixture({missingImage:kind==='missing'?true:kind==='unsupported'?'unsupported':false}));return;}
    if(req.url==='/fixture.png'){res.setHeader('content-type','image/png');res.end(png);return;}
    if(req.url==='/missing-font'){missingFont=true;res.end('ok');return;}
    if(req.url==='/api/fonts'){res.setHeader('content-type','application/json');res.end(JSON.stringify({families:missingFont?['Arial']:['Arial','Mulish']}));return;}
    if(req.url==='/api/import/fonts'){for await(const _ of req){}res.setHeader('content-type','application/json');res.end(JSON.stringify({fonts:[],missing:[]}));return;}
    return service.handle(req,res,server.address().port);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {stdout}=await runBrowserTest(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-sandbox',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1400,1000',`http://127.0.0.1:${server.address().port}/app/paste-test.html`],{timeout:40000});
  fs.writeFileSync('/tmp/studio-figma-paste-dom.html',stdout);const verdict=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]??'No verdict';assert.match(verdict,/^PASS:/,verdict);assert.ok(writes>0);console.log(verdict);
}finally{server?.closeAllConnections();await new Promise(r=>server?server.close(r):r());service?.close();fs.rmSync(temp,{recursive:true,force:true});}
