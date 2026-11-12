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
