import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {createStudioService} from '../host/service.mjs';import {createProjectPackage} from '../host/new-project.mjs';import {starterProject} from '../app/js/onboarding.js';import {genericFrame} from '../app/js/generic-frame.js';import {encodePNG} from './png.mjs';import {runBrowserTest} from './browser-test-runner.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shadow-ui-')),appPath=path.join(temp,'app'),projectPath=path.join(temp,'Shadows.sss'),data=starterProject({});
data.project.devices.iphone.size=[600,600];data.project.themes.starter.bg='#ffffff';
const layers=[
 {id:'shape',name:'Solid shape',type:'shape',shape:'rect',cx:250,cy:250,w:100,h:100,fill:'#2288cc'},
 {id:'vector',name:'Outline vector',type:'shape',shape:'path',cx:250,cy:250,w:100,h:100,pathSize:[100,100],paths:[{d:'M0 0L100 0L100 100L0 100Z'}],paints:[],stroke:{color:'#2288cc',width:8}},
 {id:'text',name:'Text',type:'text',field:'headline',x:180,w:240,capTop:200,size:50,color:'#2288cc',maxLines:1},
 {id:'route',name:'Route',type:'route',d:'M160 240L300 240',dx:0,dy:0,scale:1,width:12,dash:[],opacity:1,color:'#2288cc'},
 {id:'art',name:'Image',type:'art',src:'graphic.png',cx:250,cy:250,w:100,h:100},
 {id:'device',name:'Device',type:'device',frame:genericFrame({screen:[100,200]}),capture:'sample',cx:250,top:150,w:100},
];
data.project.slides=layers.map(l=>({id:l.id,name:l.name,theme:'starter',layouts:{iphone:{template:'custom',panorama:false,layers:[l]}}}));data.copy['en-US']={_meta:{status:'draft',needsReview:['*']},text:{headline:'Shadow'}};
let service,server;
try{
 fs.cpSync(path.join(root,'app'),appPath,{recursive:true});createProjectPackage(projectPath,()=>data);
 const pixels=Buffer.alloc(100*200*3);for(let i=0;i<pixels.length;i+=3){pixels[i]=34;pixels[i+1]=136;pixels[i+2]=204;}const png=encodePNG({width:100,height:200,data:pixels,channels:3});
 fs.mkdirSync(path.join(projectPath,'assets/art'),{recursive:true});fs.writeFileSync(path.join(projectPath,'assets/art/graphic.png'),png);fs.mkdirSync(path.join(projectPath,'captures/en-US/iphone'),{recursive:true});fs.writeFileSync(path.join(projectPath,'captures/en-US/iphone/sample.png'),png);
 fs.writeFileSync(path.join(appPath,'shadow-test.html'),'<!doctype html><link rel="stylesheet" href="/app/css/studio.css"><div id="root"></div><pre id="result">PENDING</pre><script type="module" src="/app/shadow-test.js"></script>');
 fs.writeFileSync(path.join(appPath,'shadow-test.js'),`
 const q=s=>document.querySelector(s),out=q('#result'),check=(v,m)=>{if(!v)throw Error(m)},tick=()=>new Promise(r=>setTimeout(r,120)),wait=async f=>{for(let i=0;i<100;i++){if(f())return;await tick();}throw Error('Timeout');};
 try{
  const store=await import('/app/js/store.js'),{engine,state,loadAll,flushSaves,undo}=store,{mountStudio}=await import('/app/js/ui.js');await loadAll();state.ui.locale='en-US';state.ui.device='iphone';state.ui.slideId='shape';state.ui.view='editor';state.ui.allScreens=false;state.ui.tab='details';mountStudio(q('#root'));await wait(()=>q('.thumb'));await tick();
  const change=async(label,value,event='change')=>{const input=q('[aria-label="'+label+'"]');check(input,'Missing '+label);input.value=value;input.dispatchEvent(new Event(event,{bubbles:true}));await tick();};
  const render=async id=>{const c=document.createElement('canvas');await engine.render(c,engine.scene(id,'iphone','en-US'),{scale:1});return c.toDataURL();};
  for(const id of ['shape','vector','text','route','art','device']){
   q('.thumb[data-id="'+id+'"]').click();await tick();await wait(()=>q('.document-details'));[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='Layers').click();await tick();q('.layer-row').click();await tick();[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='Details').click();await tick();
   const layer=()=>engine.project.slides.find(s=>s.id===id).layouts.iphone.layers[0],original=JSON.stringify(layer()),baseline=await render(id);check(q('[aria-label="Add shadow"]'),'Shadow available on '+id);q('[aria-label="Add shadow"]').click();await tick();
   await change('Shadow colour','#cc2266','input');await change('Shadow opacity',75);await change('Shadow blur',0);await change('Shadow X offset',30);await change('Shadow Y offset',20);check(layer().shadow.color==='#cc2266'&&layer().shadow.alpha===.75&&layer().shadow.dx===30&&layer().shadow.dy===20,'All shadow settings retained for '+id);check(await render(id)!==baseline,'Shadow visibly changes rendered '+id);
   const saved=JSON.stringify(layer().shadow);q('[aria-label="Remove shadow"]').click();await tick();check(!layer().shadow&&JSON.stringify(layer().savedShadow)===saved,'Removing shadow preserves settings for '+id);check(await render(id)===baseline,'Removing shadow restores identical pixels for '+id);undo();await tick();check(JSON.stringify(layer().shadow)===saved,'Undo restores shadow on '+id);
   q('[aria-label="Shadow X offset"]').click();check(q('[aria-label="Shadow X offset"]').getAttribute('aria-expanded')==='true','Offset popup opens on '+id);check(Number(q('[aria-label="Shadow X offset slider"]').min)===-100,'Signed offset slider uses practical negative range');await change('Shadow X offset exact value',-12.5);check(layer().shadow.dx===-12.5,'Negative exact offset supported on '+id);q('[aria-label="Shadow X offset exact value"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await flushSaves();
  }
  const reopened=await store.api('/api/project');check(JSON.stringify(reopened.studio)===JSON.stringify(engine.project),'All shadows save and reopen exactly');out.textContent='PASS: shadows on shapes, outline-only vectors, text, routes, images and devices; rendered pixel changes/removal parity; colour/opacity/blur/signed XY controls; expandable exact input; removal/Undo and portable save';
 }catch(e){out.textContent='FAIL: '+e.stack;}
 `);
 service=createStudioService({appPath,projectPath,exportPath:path.join(temp,'export')});server=http.createServer((req,res)=>service.handle(req,res,server.address().port));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const {stdout}=await runBrowserTest('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-sandbox',`--user-data-dir=${path.join(temp,'chrome')}`,'--window-size=1600,1100',`http://127.0.0.1:${server.address().port}/app/shadow-test.html`],{timeout:60000});fs.writeFileSync('/tmp/studio-shadow-ui-dom.html',stdout);const verdict=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]??'No result';assert.match(verdict,/^PASS:/,verdict);console.log(verdict);
}finally{server?.closeAllConnections();await new Promise(r=>server?server.close(r):r());service?.close();fs.rmSync(temp,{recursive:true,force:true});}
