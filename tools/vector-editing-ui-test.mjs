import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createStudioService} from '../host/service.mjs';import {createProjectPackage} from '../host/new-project.mjs';import {starterProject} from '../app/js/onboarding.js';import {convertFigmaFrame} from '../app/js/figma-layout.js';import {runBrowserTest} from './browser-test-runner.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-vector-ui-')),appPath=path.join(temp,'app'),projectPath=path.join(temp,'Vectors.sss');
const data=starterProject({});data.project.devices.iphone.size=[600,600];data.project.slides[0].name='Editable imported vector';const imported=convertFigmaFrame({id:'1:1',type:'FRAME',name:'Test',size:{x:600,y:600},children:[{id:'1:2',name:'Imported curve',type:'VECTOR',size:{x:600,y:600},relativeTransform:[[1,0,0],[0,1,0]],fillGeometry:[{path:'M100 150C170 50 380 100 440 200L420 400L150 430Z'}],fills:[{type:'GRADIENT_LINEAR',gradientHandlePositions:[{x:0,y:.5},{x:1,y:.5},{x:0,y:1.5}],gradientStops:[{position:0,color:{r:.93,g:.13,b:.33,a:1}},{position:.4,color:{r:.47,g:.2,b:.93,a:1}},{position:1,color:{r:.27,g:.8,b:1,a:1}}]}]}]});imported.layers[0].stroke={color:'#112233',width:4};imported.layers[0].name='Imported curve';data.project.slides[0].layouts.iphone.layers=imported.layers;
let service,server;
try{
 fs.cpSync(path.join(root,'app'),appPath,{recursive:true});createProjectPackage(projectPath,()=>data);
 if(process.env.VECTOR_NATIVE_FIXTURE){createProjectPackage(process.env.VECTOR_NATIVE_FIXTURE,()=>data);console.log('Native fixture created.');}
 fs.writeFileSync(path.join(appPath,'vector-test.html'),'<!doctype html><link rel="stylesheet" href="/app/css/studio.css"><div id="root"></div><pre id="result">PENDING</pre><script type="module" src="/app/vector-test.js"></script>');
 fs.writeFileSync(path.join(appPath,'vector-test.js'),`
 const out=document.querySelector('#result'),check=(v,m)=>{if(!v)throw Error(m)},button=text=>[...document.querySelectorAll('button')].reverse().find(b=>b.textContent.trim()===text),q=s=>document.querySelector(s);
 const tick=()=>new Promise(r=>setTimeout(r,120));const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await tick();}throw Error('Timed out: '+document.body.textContent);};
 try{
  const store=await import('/app/js/store.js'),{engine,state,loadAll,flushSaves,undo,redo}=store,{mountStudio}=await import('/app/js/ui.js');
  await loadAll();state.ui.locale='en-US';state.ui.device='iphone';state.ui.slideId=engine.project.slides[0].id;state.ui.view='editor';state.ui.allScreens=false;state.ui.tab='details';mountStudio(q('#root'));await wait(()=>button('Browse layers'));
  const stored=()=>engine.project.slides[0].layouts.iphone.layers[0],original=JSON.stringify(stored()),path=()=>stored().paths[0].d;
  button('Browse layers').click();q('.layer-row').click();[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='Details').click();await wait(()=>button('Edit points'));check(!q('[data-section="vector-code"]').open,'SVG code is hidden by default');
  button('Edit points').click();await wait(()=>q('[aria-label="Point 1 · path 1"]'));check(q('[aria-label="Vector points"]'),'Point toolbar visible');
  const overlay=q('.overlay');overlay.setPointerCapture=()=>{};overlay.releasePointerCapture=()=>{};
  const send=(el,type,x,y,options={})=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,...options}));
  const drag=(selector,dx,dy)=>{const el=q(selector),r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;send(el,'pointerdown',x,y);send(overlay,'pointermove',x+dx,y+dy);send(overlay,'pointerup',x+dx,y+dy);};
  const before=path();drag('[aria-label="Point 1 · path 1"]',32,20);check(path()!==before,'Dragging canvas anchor changes native path');await flushSaves();await tick();
  const afterAnchor=path();check(q('[aria-label="Outgoing curve handle"]'),'Selected anchor exposes real curve handles');drag('[aria-label="Outgoing curve handle"]',15,-25);check(path()!==afterAnchor,'Dragging curve handle changes curve');await tick();
  const curve=path();button('Corner').click();check(path()!==curve,'Corner collapses attached handles');button('Smooth').click();check(path()!==curve,'Smooth recomputes adjacent handles');check(q('[aria-label="Vector points"]'),'Toolbar click stays in point editing');
  const {parseVectorPath,vectorAnchors,vectorSegments,segmentPoint,vectorToScene}=await import('/app/js/vector-path.js');
  let resolved=engine.scene(state.ui.slideId,'iphone','en-US').layers.find(l=>l.id===stored().id),commands=parseVectorPath(path()),count=vectorAnchors(commands).length,segment=vectorSegments(commands).find(s=>s.cmd==='L'),p=vectorToScene(resolved,segmentPoint(segment,.5)),r=overlay.getBoundingClientRect(),scale=r.width/600;
  overlay.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+p[0]*scale,clientY:r.top+p[1]*scale}));check(vectorAnchors(parseVectorPath(path())).length===count+1,'Double-click edge adds a point');
  button('Delete point').click();check(vectorAnchors(parseVectorPath(path())).length===count,'Delete point removes anchor without deleting vector');
  const toolbar=q('.vector-toolbar'),bar=toolbar.getBoundingClientRect();
  check(!overlay.contains(toolbar)&&bar.bottom<=q('.stage-workspace').getBoundingClientRect().top+1,'Point tools are docked outside the canvas');
  overlay.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:20,deltaY:12}));
  check(Math.abs(q('.vector-toolbar').getBoundingClientRect().top-bar.top)<1,'Panning cannot move point tools over artwork');
  overlay.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:-20,deltaY:-12}));
  resolved=engine.scene(state.ui.slideId,'iphone','en-US').layers.find(l=>l.id===stored().id);commands=parseVectorPath(path());segment=vectorSegments(commands).find(s=>s.cmd==='C');p=vectorToScene(resolved,segmentPoint(segment,.5));r=overlay.getBoundingClientRect();scale=r.width/600;
  const originalCurve=path(),curveCount=vectorAnchors(commands).length,edge=q('[data-vector-kind="segment"][data-command="'+segment.index+'"]'),x=r.left+p[0]*scale,y=r.top+p[1]*scale;
  send(edge,'pointerdown',x,y,{shiftKey:true});send(overlay,'pointerup',x,y,{shiftKey:true});
  check(vectorAnchors(parseVectorPath(path())).length===curveCount+1,'Shift-click a cubic segment adds a point');
  const insertedCurve=path();undo();await tick();check(path()===originalCurve,'One Undo restores curve before insertion');redo();await tick();check(path()===insertedCurve,'Redo restores inserted point');
  const anchor=q('.vector-node.active'),ar=anchor.getBoundingClientRect(),ax=ar.left+ar.width/2,ay=ar.top+ar.height/2;
  send(anchor,'pointerdown',ax,ay,{altKey:true});send(overlay,'pointerup',ax,ay,{altKey:true});
  check(vectorAnchors(parseVectorPath(path())).length===curveCount,'Option-click an anchor removes only that point');
  undo();await tick();check(path()===insertedCurve,'One Undo restores removed point');
  const cancelAnchor=q('[data-vector-kind="anchor"][data-command="'+segment.index+'"]'),cr=cancelAnchor.getBoundingClientRect();send(cancelAnchor,'pointerdown',cr.left+12,cr.top+12,{altKey:true});send(overlay,'pointercancel',cr.left+12,cr.top+12,{altKey:true});check(path()===insertedCurve,'Cancelled Option-click never deletes a point');
  const selected=q('.vector-node.active');selected.focus();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));check(vectorAnchors(parseVectorPath(path())).length===curveCount,'Delete removes the selected anchor without removing the vector');
  const press=key=>window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  const hoverEdge=()=>{
   const l=engine.scene(state.ui.slideId,'iphone','en-US').layers.find(l=>l.id===stored().id),seg=vectorSegments(parseVectorPath(path())).find(s=>s.cmd==='C'),v=vectorToScene(l,segmentPoint(seg,.5)),rect=overlay.getBoundingClientRect(),k=rect.width/600,node=q('[data-vector-kind="segment"][data-command="'+seg.index+'"]'),x=rect.left+v[0]*k,y=rect.top+v[1]*k;
   send(node,'pointermove',x,y);return {node,x,y};
  };
  const {CANVAS_CURSORS,CANVAS_CURSOR_SIZE}=await import('/app/js/canvas-cursors.js');
  const cursorIs=(node,name)=>getComputedStyle(node).cursor.includes(encodeURIComponent(CANVAS_CURSORS[name].svg));
  for(const entry of Object.values(CANVAS_CURSORS)){const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(entry.svg);await image.decode();check(image.naturalWidth===CANVAS_CURSOR_SIZE&&image.naturalHeight===CANVAS_CURSOR_SIZE&&entry.hotspot.every(n=>n>=0&&n<CANVAS_CURSOR_SIZE),'Cursor artwork decodes at a valid size and hotspot');}
  const cursorPath=path(),hover=hoverEdge();press('Shift');
  check(cursorIs(hover.node,'add-point'),'Held Shift shows the add-point cursor without pointer movement');
  check(!q('.vector-pointer-badge'),'Cursor symbols are integrated into the artwork');
  window.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));check(cursorIs(hover.node,'bend'),'Releasing Shift restores segment cursor');
  const hoverAnchor=q('[data-vector-kind="anchor"]'),ha=hoverAnchor.getBoundingClientRect();send(hoverAnchor,'pointermove',ha.left+12,ha.top+12);press('Alt');
  check(cursorIs(hoverAnchor,'remove-point'),'Held Option shows the remove-point cursor');
  window.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt',bubbles:true}));check(cursorIs(hoverAnchor,'point'),'Releasing Option restores point cursor');check(path()===cursorPath,'Cursor feedback never edits geometry');
  press('Alt');window.dispatchEvent(new Event('blur'));check(cursorIs(hoverAnchor,'point'),'Losing focus resets modifier cursor');
  for(const node of [q('.topbar button'),q('.drawing-tool'),q('.vector-toolbar button'),q('.inspector button')])check(!getComputedStyle(node).cursor.includes('data:image/svg'),'Chrome and inspector retain system cursors');
  const {showContextMenu}=await import('/app/js/ui/context-menu.js');
  showContextMenu({clientX:hover.x,clientY:hover.y,preventDefault(){},stopPropagation(){}},[{label:'Cursor scope check',run(){}}]);
  check(!getComputedStyle(q('.context-menu button')).cursor.includes('data:image/svg'),'Canvas context menus retain system cursors');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  press('+');check(q('[title="Add point (+)"]').getAttribute('aria-pressed')==='true','Plus selects add-point tool instead of zooming');
  resolved=engine.scene(state.ui.slideId,'iphone','en-US').layers.find(l=>l.id===stored().id);segment=vectorSegments(parseVectorPath(path())).find(s=>s.cmd==='C');p=vectorToScene(resolved,segmentPoint(segment,.5));r=overlay.getBoundingClientRect();scale=r.width/600;
  const addEdge=q('[data-vector-kind="segment"][data-command="'+segment.index+'"]'),xx=r.left+p[0]*scale,yy=r.top+p[1]*scale;
  send(addEdge,'pointermove',xx,yy);check(cursorIs(addEdge,'add-point'),'Add tool shows its canvas cursor');send(addEdge,'pointerdown',xx,yy);send(overlay,'pointerup',xx,yy);check(vectorAnchors(parseVectorPath(path())).length===curveCount+1,'Plus followed by click inserts a point');
  press('-');const removePoint=q('.vector-node.active'),rr=removePoint.getBoundingClientRect();send(removePoint,'pointermove',rr.left+12,rr.top+12);check(cursorIs(removePoint,'remove-point'),'Remove tool shows its canvas cursor');send(removePoint,'pointerdown',rr.left+12,rr.top+12);send(overlay,'pointerup',rr.left+12,rr.top+12);check(vectorAnchors(parseVectorPath(path())).length===curveCount,'Minus followed by click removes a point');
  press('a');check(q('[title="Select points (A)"]').getAttribute('aria-pressed')==='true','A returns to moving points');
  button('Done').click();check(!q('[aria-label="Vector points"]'),'Done exits mode');
  check(q('.vector-toolbar-host').hidden,'Dock closes after point editing');check(!q('.vector-pointer-badge'),'Ending point editing clears the badge');
  const change=(label,value)=>{const el=q('[aria-label="'+label+'"]');check(el,'Missing '+label);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
  check(stored().paints[0].stops.length===3,'Imported multistop gradient retained');change('Stop 2 position',55);check(stored().paints[0].stops[1].position===.55,'Gradient stop position updates');change('Stop 2 opacity',60);check(stored().paints[0].stops[1].color.endsWith('99'),'Gradient opacity updates');
  button('Add colour').click();await tick();check(stored().paints[0].stops.length===4,'Add colour adds a gradient stop');
  button('Edit gradient on canvas').click();await wait(()=>q('[aria-label="Gradient end"]'));const handles=JSON.stringify(stored().paints[0].handles);drag('[aria-label="Gradient end"]',-35,28);check(JSON.stringify(stored().paints[0].handles)!==handles,'Canvas gradient handle changes gradient');await tick();button('Done').click();
  change('Outline width',12);change('Outline alignment','inside');check(stored().stroke.width===12&&stored().stroke.align==='inside','Ordinary outline controls update native stroke: '+JSON.stringify(stored().stroke)+' pathSize '+JSON.stringify(stored().pathSize)+' w '+stored().w);change('Layer blur pixels',14);check(stored().blur===14,'Numeric blur updates layer');const blur=q('[aria-label="Layer blur"]');blur.value=23;blur.dispatchEvent(new Event('input',{bubbles:true}));check(stored().blur===23,'Blur slider updates layer');
  await flushSaves();const final=JSON.stringify(stored());check(final!==original,'Real edits stored');const reopened=await store.api('/api/project');check(JSON.stringify(reopened.studio.slides[0].layouts.iphone.layers[0])===final,'Save/reopen preserves editable geometry and paints');
  undo();await flushSaves();check(stored().blur===undefined,'Undo returns to the original blur');redo();await flushSaves();check(stored().blur===23,'Redo restores blur');
  const {Engine}=await import('/app/js/render.js'),render=async eng=>{const canvas=document.createElement('canvas');await eng.render(canvas,eng.scene(state.ui.slideId,'iphone','en-US'),{scale:1});return canvas.toDataURL();},reloaded=new Engine();reloaded.setData(await store.api('/api/project'));check(await render(engine)===await render(reloaded),'Reopened document renders identical pixels');
  out.textContent='PASS: imported vector anchor/curve-handle drags, corner/smooth, edge insertion, point deletion, gradient stop/opacity/add/canvas handles, outline, blur slider, Undo/Redo and identical saved/reopened pixels';
 }catch(e){out.textContent='FAIL: '+e.stack;}
 `);
 service=createStudioService({appPath,projectPath,exportPath:path.join(temp,'export')});server=http.createServer((req,res)=>service.handle(req,res,server.address().port));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const {stdout}=await runBrowserTest('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-sandbox',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1600,1100',`http://127.0.0.1:${server.address().port}/app/vector-test.html`],{timeout:40000});fs.writeFileSync('/tmp/studio-vector-ui-dom.html',stdout);const verdict=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]??'No result';assert.match(verdict,/^PASS:/,verdict);console.log(verdict);
}finally{server?.closeAllConnections();await new Promise(r=>server?server.close(r):r());service?.close();fs.rmSync(temp,{recursive:true,force:true});}
