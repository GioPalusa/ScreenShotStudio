// Visual proof from the production exporter. Synthetic app screens never enter the starter.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STORY_TEMPLATES, storyCopyFor } from '../app/js/story-templates.js';
import { newConnectedSeries } from '../app/js/connected-series.js';
import { validateDocument } from '../app/js/document.js';
import { decodePNG, encodePNG } from './png.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const proof=path.resolve(process.argv[2]??'/tmp/studio-template-proof');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-template-proof-'));
const write=(folder,file,value)=>{const target=path.join(folder,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value));};
const exportProject=(folder,label)=>{
  const output=path.join(temp,label);
  validateDocument(JSON.parse(fs.readFileSync(path.join(folder,'studio.json'))));
  execFileSync(process.execPath,['studio.mjs','export','--project',folder,'--output',output,'--strict'],{cwd:root,stdio:'pipe',timeout:120000});
  const run=path.join(output,fs.readdirSync(output)[0]);
  return {run,manifest:JSON.parse(fs.readFileSync(path.join(run,'manifest.json')))};
};
try {
  fs.mkdirSync(proof,{recursive:true});
  const source=path.join(temp,'Sources.sss');
  const doc={version:2,fonts:{default:{family:'system-ui'}},themes:{demo:{bg:'#f5f6f3',ink:'#202c25'}},locales:[{id:'en-US',name:'English',dir:'ltr',lang:'en'}],devices:{screen:{target:'custom',label:'Sample screen',size:[400,800],layout:'phone',capture:'phone',frame:{type:'plain',screen:[400,800]}}},slides:[]};
  const copy={_meta:{status:'approved',needsReview:[]}};
  for(let i=0;i<5;i++) {
    const layers=[],values={};
    const shape=(id,cx,cy,w,h,fill,extra={})=>layers.push({id,type:'shape',shape:'rect',cx,cy,w,h,fill,...extra});
    const text=(id,value,x,y,w,size,weight=500)=>{values[id]=value;layers.push({id,type:'text',field:id,x,capTop:y,w,size,minSize:size,boxHeight:size*1.3,maxLines:1,weight,align:'start',block:'start',anchor:'top'});};
    text('time','9:41',36,20,100,13,650);text('brand','YOUR SPACE',36,89,320,11,600);
    text('title',['A good day.','Your collection.','A new perspective.','A little inspiration.','Made for you.'][i],36,118,328,29,700);
    shape('landscape',200,286,328,210,'#ccdbbf',{radius:18,gradient:{from:['#d9e4ca','#dfd6c4','#cbdce3'][i%3],to:['#91aa75','#b8a68c','#8da5b6'][i%3],toAlpha:1,angle:120}});
    shape('sun',290,219,48,48,'#f9f9e5',{shape:'ellipse'});
    shape('hill',171,335,261,89,'#70896f',{shape:'ellipse',opacity:.32});
    text('section','Make time for you',36,425,328,20,650);text('caption','A little inspiration for your everyday.',36,456,328,12,400);
    for(let n=0;n<2;n++) { const y=512+n*103;shape(`card-${n}`,200,y+36,328,83,'#ffffff',{radius:12});shape(`icon-${n}`,69,y+36,43,46,n?'#e8e5dc':'#dce8dd',{radius:8});text(`card-title-${n}`,n?'Saved for later':'Daily collection',108,y+19,205,14,600);text(`card-caption-${n}`,n?'All your favourites':'A fresh perspective',108,y+42,205,11,400); }
    for(let n=0;n<4;n++) shape(`tab-${n}`,82+n*78,754,13,13,n?'#bec7bf':'#56725c',{shape:'ellipse'});
    shape('home',200,787,112,4,'#202c25',{radius:2});
    const id=`sample-${i}`;doc.slides.push({id,theme:'demo',layouts:{screen:{template:'custom',panorama:false,layers}}});copy[id]=values;
  }
  write(source,'studio.json',doc);write(source,'copy/en-US.json',copy);
  const sources=exportProject(source,'source-export');
  const project=path.join(temp,'Templates.sss');
  doc.slides=[];doc.profiles={phone:{label:'Phone',capture:'phone',screen:[400,800],frame:{type:'generic',screen:[400,800]}}};
  doc.devices={phone:{label:'Phone',target:'custom',size:[400,800],layout:'phone',capture:'phone',frame:{type:'generic',screen:[400,800]}},tablet:{label:'Tablet',target:'custom',size:[600,800],layout:'tablet',capture:'phone',frame:{type:'generic',screen:[400,800]}},wide:{label:'Landscape',target:'custom',size:[960,600],layout:'wide',capture:'phone',frame:{type:'generic',screen:[400,800]}}};
  fs.mkdirSync(path.join(project,'captures/default/phone'),{recursive:true});
  for(const file of sources.manifest.files) fs.copyFileSync(path.join(sources.run,file.path),path.join(project,`captures/default/phone/${file.slideId}.png`));
  let seq=0;
  for(const design of STORY_TEMPLATES) for(const count of [2,3,4,5]) doc.slides.push(...newConnectedSeries(doc,{designId:design.id,count,gap:.06,profileId:'phone',captures:Array.from({length:count},(_,i)=>({name:`sample-${i}`,set:'phone'}))},()=>`proof-${++seq}`));
  write(project,'studio.json',doc);write(project,'copy/en-US.json',{_meta:{status:'approved',needsReview:[]},...Object.fromEntries(doc.slides.map(s=>[s.id,storyCopyFor(s)]))});
  const {run,manifest}=exportProject(project,'template-export');
  assert.equal(manifest.files.length,336);assert.deepEqual(manifest.report.warnings,[]);
  // Retain the exact export pixels; the 6% spaces below simulate the store gutter.
  for(const design of STORY_TEMPLATES) for(const count of [2,3,4,5]) {
    const width=count*400+(count-1)*24,height=800,data=Buffer.alloc(width*height*4,255);
    for(let i=0;i<count;i++) {
      const slide=doc.slides.find(s=>s.series.designId===design.id&&s.series.index===i&&s.series.count===count);
      const file=manifest.files.find(f=>f.slideId===slide.id&&f.device==='phone');
      const png=decodePNG(fs.readFileSync(path.join(run,file.path)));
      for(let y=0;y<height;y++) data.set(png.data.subarray(y*400*4,(y+1)*400*4),(y*width+i*424)*4);
    }
    fs.writeFileSync(path.join(proof,`${design.id}-${count}.png`),encodePNG({width,height,data,channels:3}));
  }
  fs.writeFileSync(path.join(proof,'index.html'),`<!doctype html><meta charset="utf-8"><title>Screenshot Studio · Template proofs</title><style>body{margin:0;padding:40px;background:#eae8e3;color:#242827;font:16px system-ui}main{max-width:1248px;margin:auto}h1{font-size:32px;letter-spacing:-1px}section{margin:48px 0}img{width:100%;display:block}p{color:#626863}</style><main><h1>Screenshot Studio · Template proofs</h1><p>Actual RGB exports with original example app screens. 2–5 slides per set; 6% simulated store gap. All 336 phone, tablet and landscape exports passed strict preflight.</p>${STORY_TEMPLATES.map(d=>`<section><h2>${d.name}</h2>${[2,3,4,5].map(n=>`<details ${n===3?'open':''}><summary>${n} slides</summary><img src="${d.id}-${n}.png" alt="${d.name}, ${n} coordinated screens"></details>`).join('')}</section>`).join('')}</main>`);
  console.log(`Visual proof: 336 RGB exports, zero warnings. ${proof}/index.html`);
} finally {fs.rmSync(temp,{recursive:true,force:true});}
