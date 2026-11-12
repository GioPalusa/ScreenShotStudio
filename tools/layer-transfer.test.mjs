import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotLayer, transferLayer, encodeLayerClipboard, decodeLayerClipboard, pasteLayerClipboard } from '../app/js/layer-transfer.js';
import { sharedLayers } from '../app/js/shared-canvas.js';
import { selectionGeometryPatches } from '../app/js/layer-ops.js';
import { selectionBounds, transformSelection } from '../app/js/selection.js';

const clippedLayer=(id,x,scopes)=>({id,type:'shape',cx:x+10,cy:20,w:20,h:20,_box:{x,y:10,w:20,h:20},compositing:structuredClone(scopes)});
const scope=(id,x=0)=>({id,clip:{matrix:[1,0,0,1,x,0],w:80,h:60,radius:8}});
test('complete nested clipping scopes follow translation, scale and rotation without mutating source data',()=>{
  const layers=[clippedLayer('a',10,[scope('outer'),scope('inner',5)]),clippedLayer('b',40,[scope('outer'),scope('inner',5)])],before=structuredClone(layers);
  const bounds=selectionBounds(layers),members=layers.map(layer=>({layer,box:layer._box}));
  const translated=selectionGeometryPatches(transformSelection(members,bounds,{...bounds,x:bounds.x+120,y:bounds.y-80}),layers);
  for(const {patch} of translated)for(const [i,s] of patch.compositing.entries())assert.deepEqual(s.clip.matrix,[1,0,0,1,i===0?120:125,-80]);
  const transformed=selectionGeometryPatches(transformSelection(members,bounds,{x:100,y:200,w:bounds.w*2,h:bounds.h*2,rot:90}),layers);
  // (0,0) maps to (190,150) under the selection's common canvas transform.
  const matrix=transformed[0].patch.compositing[0].clip.matrix;
  for(const [i,v] of [0,2,-2,0,190,150].entries())assert.ok(Math.abs(matrix[i]-v)<1e-9);
  assert.deepEqual(layers,before);
});
test('moving only an inner frame preserves its outer clipping frame and unselected siblings',()=>{
  const layers=[clippedLayer('a',10,[scope('outer'),scope('inner')]),clippedLayer('b',40,[scope('outer')])];
  const [edit]=selectionGeometryPatches([{layer:layers[0],box:{...layers[0]._box,x:30,y:50}}],layers);
  assert.deepEqual(edit.patch.compositing[0],layers[0].compositing[0]);
  assert.deepEqual(edit.patch.compositing[1].clip.matrix,[1,0,0,1,20,40]);
  const hidden={...layers[1],hidden:true,compositing:[scope('inner')]};
  assert.equal(selectionGeometryPatches([{layer:layers[0],box:{...layers[0]._box,x:30}}],[layers[0],hidden])[0].patch.compositing?.[1].clip.matrix[4]??0,0);
});
test('independent member alignment leaves their shared clip fixed; screen scopes stay separate',()=>{
  const a=clippedLayer('a',10,[scope('frame')]),b=clippedLayer('b',40,[scope('frame')]);
  const edits=selectionGeometryPatches([{layer:a,box:{...a._box,x:20}},{layer:b,box:{...b._box,x:20}}],[a,b]);
  assert.ok(edits.every(e=>!e.patch.compositing));
  a._sourceSlideId='a';b._sourceSlideId='b';
  const [edit]=selectionGeometryPatches([{layer:a,box:{...a._box,x:20}}],[a,b]);
  assert.deepEqual(edit.patch.compositing[0].clip.matrix,[1,0,0,1,10,0]);
});

const text = { id:'headline', type:'text', field:'headline', x:20, capTop:{after:'title',gap:40}, w:300, size:60, _box:{x:20,y:180,w:300,h:80}, _origin:'template' };
test('object snapshots freeze flow and inherited appearance and strip rendering state', () => {
  const saved=snapshotLayer(text,{color:'#000000'});
  assert.equal(saved.capTop,180);assert.equal(saved.color,'#000000');assert.ok(!('_box' in saved));
  text._box.y=190;assert.equal(saved.capTop,180);text._box.y=180;
  const device=snapshotLayer({id:'phone',type:'device',top:{after:'headline'},_box:{x:50,y:220,w:200,h:400}},{frame:{type:'plain',screen:[400,800]},captureSet:'iphone'});
  assert.equal(device.top,220);assert.equal(device.cx,150);assert.equal(device.captureSet,'iphone');assert.deepEqual(device.frame.screen,[400,800]);
});
test('transferring inherited objects suppresses the source and keeps one shared owner', () => {
  const source={}, target={layers:[]};
  const layer=transferLayer({sourceBlock:source,sourceLayer:text,targetBlock:target,snapshot:snapshotLayer(text),dx:424,copySlideId:'a'});
  assert.equal(source.overrides.headline,false);assert.equal(target.layers.length,1);assert.equal(layer.x,444);assert.equal(layer.copySlideId,'a');
  const destination={layers:[]};
  transferLayer({sourceBlock:target,sourceLayer:{...layer,_origin:'slide'},targetBlock:destination,snapshot:layer,dx:-424});
  assert.equal(target.layers,undefined);assert.equal(destination.layers[0].x,20);
});
test('localized objects remain in their language after sharing', () => {
  const project={devices:{phone:{size:[400,800]}},slides:[{id:'a'}],sharedCanvas:{phone:{layers:[{id:'x',type:'shape',localeId:'sv'}]}}};
  assert.equal(sharedLayers(project,'phone','en-US').length,0);assert.equal(sharedLayers(project,'phone','sv').length,1);
});
test('clipboard pastes use immutable geometry, fresh IDs, groups, and independent text in every locale', () => {
  const entries=[{layer:{...snapshotLayer(text),group:'group'},text:{'en-US':{value:'Original',needsReview:false},sv:{value:'Original svenska',needsReview:true}}},
    {layer:{id:'photo',type:'art',src:'art.png',cx:200,cy:300,w:100,aspect:1,group:'group'},text:{}}];
  const payload=encodeLayerClipboard(entries,{projectId:'project',allScreens:false,originX:424});
  entries[0].text['en-US'].value='Changed';
  const data=decodeLayerClipboard(payload),copy={'en-US':{a:{headline:'Hello'},_meta:{status:'approved'}},sv:{a:{},_meta:{status:'draft',needsReview:['*']}}},block={layers:[]};
  const options={block,resolved:[],copy,slideIds:['a'],shared:true,dx:48,dy:24};
  const first=pasteLayerClipboard(data,options),second=pasteLayerClipboard(data,options);
  assert.equal(new Set(block.layers.map(l=>l.id)).size,4);assert.notEqual(first.layers[0].field,'headline');
  assert.equal(copy['en-US'].a[first.layers[0].field],'Original');assert.equal(copy['en-US'].a.headline,'Hello');
  assert.equal(copy.sv.a[first.layers[0].field],'Original svenska');assert.equal(copy.sv._meta.status,'draft');
  assert.equal(first.layers[0].group,first.layers[1].group);assert.notEqual(first.layers[0].group,second.layers[0].group);
  assert.equal(first.layers[0].x,68);assert.equal(first.layers[0].capTop,204);assert.equal(first.layers[1].cy,324);
  assert.equal(data.entries[1].layer.cy,300);assert.equal(first.layers[0].copySlideId,'a');
  const local=pasteLayerClipboard(data,{...options,block:{layers:[]},shared:false,slideIds:['b']});assert.equal(local.layers[0].copySlideId,undefined);
});
test('clipboard decoder ignores ordinary text, unsupported payloads and prototype keys', () => {
  for(const input of ['hello','{}','null',JSON.stringify({format:'Screenshot Studio objects',version:999}),' {"__proto__":{}}']) assert.equal(decodeLayerClipboard(input),null);
});

test('older series fragments transfer as one object while independent designs opt out', async () => {
  const { removeConnectedFragments } = await import('../app/js/layer-transfer.js');
  const layer={id:'phone',type:'device',seriesLayer:true},slides=['a','b','c'].map(id=>({id,series:{id:'series'},layouts:{phone:{layers:[structuredClone(layer)]}}}));
  slides[2].layouts.phone.independent=true;
  removeConnectedFragments({slides},slides[0],'phone',layer);
  assert.equal(slides[1].layouts.phone.layers,undefined);assert.equal(slides[2].layouts.phone.layers.length,1);
});
test('containing shared text moves its text reference to the destination in every language', async () => {
  const { containTextSource } = await import('../app/js/layer-transfer.js');
  const layer={id:'headline',type:'text',field:'headline',copySlideId:'a'};
  const copy={'en-US':{a:{headline:'Hello'},b:{headline:'Existing'}},sv:{a:{headline:'Hej'},_meta:{status:'draft',needsReview:['a.headline']}}};
  assert.deepEqual(containTextSource(layer,copy,'b'),['en-US','sv']);assert.equal(layer.copySlideId,undefined);
  assert.equal(copy['en-US'].b.headline,'Existing');assert.equal(copy['en-US'].b[layer.field],'Hello');
  assert.ok(copy.sv._meta.needsReview.includes('b.'+layer.field));
  delete copy['en-US'].a;assert.equal(copy['en-US'].b[layer.field],'Hello');
});

test('screen edge defaults follow the view and explicit containment overrides All screens', async () => {
  const { screenScopeFor } = await import('../app/js/layer-transfer.js');
  assert.equal(screenScopeFor({},true),true);
  assert.equal(screenScopeFor({},false),false);
  assert.equal(screenScopeFor({screenScope:'local'},true),false);
  assert.equal(screenScopeFor({screenScope:'local'},false),false);
  assert.equal(screenScopeFor({_sharedId:'image'},false),true,'Existing shared objects remain linked when opening one screen');
});
test('containing an object in All screens chooses its owner or nearest screen in row coordinates', async () => {
  const { screenTileForLayer } = await import('../app/js/layer-transfer.js');
  const tiles=[{slide:{id:'a'},x:0,W:400},{slide:{id:'b'},x:430,W:800},{slide:{id:'c'},x:1260,W:400}];
  assert.equal(screenTileForLayer(tiles,{_sourceSlideId:'a',cx:900}),tiles[0],'Local ownership does not change by dragging');
  assert.equal(screenTileForLayer(tiles,{_box:{x:720,w:250}}),tiles[1]);
  assert.equal(screenTileForLayer(tiles,{cx:1500}),tiles[2]);
  assert.equal(screenTileForLayer(tiles,{cx:-100}),tiles[0]);
});

test('containing the last shared object leaves a valid empty shared layer list', () => {
  const source={layers:[{id:'image',type:'art',cx:500,cy:200,w:100}]}, target={layers:[]};
  const layer={...source.layers[0],_origin:'slide',_sharedId:'image'};
  transferLayer({sourceBlock:source,sourceLayer:layer,targetBlock:target,snapshot:snapshotLayer(layer),dx:-424});
  assert.deepEqual(source.layers,[]);assert.equal(target.layers[0].cx,76);
});
