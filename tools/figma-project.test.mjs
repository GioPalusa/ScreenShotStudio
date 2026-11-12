import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importFigmaClipboard } from '../host/figma-clipboard.mjs';
import { createFigmaProject } from '../host/figma-project.mjs';
import { importFigma } from '../host/figma.mjs';
import { clipboardFixture } from './fixtures/figma-clipboard.mjs';

test('native clipboard keeps text, fonts, vector commands and original dimensions without a key',async()=>{
  const data=await importFigmaClipboard(clipboardFixture()),design=data.designs[0];
  assert.equal(design.width,375);assert.equal(design.height,808);assert.ok(design.layers.some(l=>l.shape==='path'&&l.paths[0].d.includes('L100 0')));
  const text=design.layers.find(l=>l.type==='text');assert.equal(text.fontFamily,'Mulish');assert.equal(text.weight,700);assert.equal(design.texts[text.field],'Editable clipboard text');
  assert.equal(text.compositing[0].name,'Copied frame');assert.equal(text.compositing[0].sourceType,'FRAME');
  await assert.rejects(importFigmaClipboard('<script>process.exit()</script>'),/No native Figma/);
  await assert.rejects(importFigmaClipboard('(figma)YmFk(/figma)'),/fig-kiwi/);
});

test('new Figma projects contain only imported views and publish atomically',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-figma-new-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const {designs,images}=await importFigmaClipboard(clipboardFixture());
  const rows=designs.map(d=>({kind:'figma-editable',path:d.id,group:d.id,name:d.name,file:d,design:d,locale:'en-US'}));
  const destination=path.join(root,'Imported.sss');createFigmaProject(destination,{rows,images,fonts:[]});
  const doc=JSON.parse(fs.readFileSync(path.join(destination,'studio.json')));
  assert.equal(doc.slides.length,1);assert.equal(doc.slides[0].id,'copied-frame');assert.equal(Object.keys(doc.devices).length,1);assert.equal(doc.slides[0].canvasIds.length,1);assert.ok(!JSON.stringify(doc).includes('first-slide'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination,'copy/en-US.json')))._meta,{status:'draft',needsReview:['*']});
  const before=fs.readFileSync(path.join(destination,'studio.json'));assert.throws(()=>createFigmaProject(destination,{rows,images,fonts:[]}),/never overwritten/);assert.ok(before.equals(fs.readFileSync(path.join(destination,'studio.json'))));
  const failed=path.join(root,'Failed.sss');assert.throws(()=>createFigmaProject(failed,{rows:[],images,fonts:[]}));assert.ok(!fs.existsSync(failed));assert.ok(!fs.readdirSync(root).some(p=>p.startsWith('.studio-new-')));
});

test('links to small individual Figma objects import original geometry on a legal canvas',async()=>{
  const selected={id:'1:4',type:'TEXT',name:'Partial heading',size:{x:80,y:30},characters:'Hello',style:{fontFamily:'Mulish',fontSize:20},fills:[{type:'SOLID',color:{r:0,g:0,b:0}}]};
  const fetchImpl=async()=>Response.json({nodes:{'1:4':{document:selected}}});
  const args={url:'https://www.figma.com/design/Example/Test?node-id=1-4',token:'fixture-key'};
  const inspect=await importFigma(args,{fetchImpl});assert.equal(inspect.frames[0].id,'1:4');
  const load=await importFigma({...args,action:'load'},{fetchImpl});const d=load.designs[0];assert.equal(d.width,100);assert.equal(d.height,100);assert.equal(d.layers[0].size,20);assert.equal(d.layers[0].w,80);
});

test('clipboard network-only vectors keep cubic curves and ignore detached effect styles',async()=>{
  const {designs:[design]}=await importFigmaClipboard(clipboardFixture({network:true}));
  assert.equal(design.width,375);assert.equal(design.height,808);assert.equal(design.name,'Copied frame');
  const vector=design.layers.find(l=>l.shape==='path');assert.match(vector.paths[0].d,/C20 290 100 0 100 0/);assert.match(vector.paths[0].d,/L200 300/);assert.match(vector.paths[0].d,/Z/);
});


test('clipboard boolean groups compute editable geometry from their operands',async()=>{
  const paper=(await import('paper')).default;
  for(const [operation,area]of [['UNION',52500],['SUBTRACT',22500],['INTERSECT',7500],['XOR',45000]]){
    const {designs:[design]}=await importFigmaClipboard(clipboardFixture({booleanOperation:operation}));
    const back=design.layers.find(layer=>layer.name==='Back');assert.ok(back,'Boolean result keeps its name');assert.equal(back.shape,'path');assert.equal(back.paints[0].color,'#ff0000');
    assert.equal(design.layers.filter(layer=>layer.shape==='path').length,1,'Operands are replaced by a single editable result');
    const scope=new paper.PaperScope();new scope.Project();
    try{const item=new scope.CompoundPath({pathData:back.paths[0].d,insert:false});assert.ok(Math.abs(Math.abs(item.area)-area)<.01,operation+' preserves boolean geometry');}
    finally{scope.project.remove();}
  }
});


test('clipboard boolean operands keep skew and rotation in parent-local coordinates',async()=>{
  const {designs:[design]}=await importFigmaClipboard(clipboardFixture({booleanOperation:'UNION',booleanTransform:{m00:0,m01:-1,m02:400,m10:1,m11:.25,m12:-10}}));
  const back=design.layers.find(layer=>layer.name==='Back');
  const paper=(await import('paper')).default,scope=new paper.PaperScope();new scope.Project();
  try{
    const item=new scope.CompoundPath({pathData:back.paths[0].d,insert:false});
    assert.ok(Math.abs(Math.abs(item.area)-30000)<.01,'Affine transform preserves expected area');
    assert.ok(Math.abs(item.bounds.left-100)<.01);assert.ok(Math.abs(item.bounds.right-400)<.01);
    assert.ok(Math.abs(item.bounds.top-65)<.01);assert.ok(Math.abs(item.bounds.bottom-265)<.01);
    assert.equal(back.cx,170);assert.equal(back.cy,190,'Boolean parent offset is retained separately');
  }finally{scope.project.remove();}
});


test('clipboard reports missing image files while preserving editable text and vectors',async()=>{
  for(const mode of [true,'unsupported']){
    const data=await importFigmaClipboard(clipboardFixture({missingImage:mode}));
    assert.equal(data.missingImages.length,1);assert.deepEqual(data.missingImages[0].names,['Cover art']);
    assert.equal(data.missingImages[0].reason,mode===true?'not-embedded':'unsupported-format');
    const design=data.designs[0];assert.ok(design.layers.some(l=>l.type==='text'));assert.ok(design.layers.some(l=>l.shape==='path'));
    const image=design.layers.find(l=>l.name==='Cover art');assert.equal(image.paints[0].ref,data.missingImages[0].ref);assert.ok(design.images.includes(data.missingImages[0].ref));
  }
});


test('skipping clipboard images retains other fills, outlines and mask geometry',async()=>{
  const {skipClipboardImages}=await import('../app/js/figma-clipboard.js');
  const data=await importFigmaClipboard(clipboardFixture({missingImage:true})),design=data.designs[0],ref=data.missingImages[0].ref;
  const image=design.layers.find(l=>l.name==='Cover art'),original=structuredClone(design);
  const omitted=skipClipboardImages(design,new Set([ref]));assert.ok(!omitted.layers.some(l=>l.name==='Cover art'));assert.ok(omitted.layers.some(l=>l.type==='text'));assert.deepEqual(omitted.images,[]);assert.deepEqual(design,original);
  for(const extra of [{stroke:{color:'#112233',width:2}},{maskOnly:true},{paints:[...image.paints,{type:'solid',color:'#123456'}]}]){
    const result=skipClipboardImages({...design,layers:[{...image,...extra}]},new Set([ref]));assert.equal(result.layers.length,1);assert.ok(!result.layers[0].paints.some(p=>p.ref===ref));
  }
});
