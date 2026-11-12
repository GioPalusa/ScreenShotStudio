import test from 'node:test';import assert from 'node:assert/strict';import paper from 'paper';
import {booleanShape,canCombineShapes,shapePathData} from '../app/js/shape-boolean.js';
import {createMaskPatches,releaseMaskPatch} from '../app/js/layer-ops.js';import {pasteLayerClipboard} from '../app/js/layer-transfer.js';
import {vectorToScene,parseVectorPath,vectorMatrix} from '../app/js/vector-path.js';
const rect=(id,cx=50)=>({id,type:'shape',shape:'rect',cx,cy:50,w:100,h:100,fill:'#ff0000'});
test('boolean operations keep native editable curves and expected bounds',()=>{
 const a=rect('a'),b=rect('b',100),original=JSON.stringify([a,b]);for(const [operation,width,cx]of [['unite',150,75],['subtract',50,25],['intersect',50,75],['exclude',150,75]]){const out=booleanShape([a,b],operation,paper);assert.equal(out.shape,'path');assert.equal(out.w,width);assert.equal(out.cx,cx);assert.ok(parseVectorPath(out.paths[0].d).some(c=>c.cmd==='Z'));}assert.equal(JSON.stringify([a,b]),original);
 const curved=booleanShape([{...a,shape:'ellipse'},b],'unite',paper);assert.ok(parseVectorPath(curved.paths[0].d).some(c=>c.cmd==='C'));
 assert.equal(canCombineShapes([a,{...b,shape:'path',paths:[{d:'M0 0L100 0'}]}]),false);assert.throws(()=>booleanShape([a,rect('far',300)],'intersect',paper),/No shape remains/);
});
test('boolean geometry preserves affine transforms and world gradient coordinates',()=>{
 const a={...rect('a'),rotate:25,basis:[1,.2,.3,1],paints:[{type:'linear',handles:[[0,0],[1,1]],stops:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff'}]}]},b=rect('b',180),out=booleanShape([a,b],'unite',paper);
 for(let i=0;i<2;i++){const original=vectorToScene(a,[a.paints[0].handles[i][0]*a.w,a.paints[0].handles[i][1]*a.h]),h=out.paints[0].handles[i],actual=vectorToScene(out,[out.pathOffset[0]+h[0]*out.pathSize[0],out.pathOffset[1]+h[1]*out.pathSize[1]]);assert.ok(Math.hypot(actual[0]-original[0],actual[1]-original[1])<1e-5);}
 assert.deepEqual(out.basis,a.basis);assert.equal(out.rotate,25);assert.ok(out.pathSize[0]>100);
});
test('mask creation/release retains editable source metadata and clipboard retargets references',()=>{
 const a={...rect('a'),group:'old',compositing:[{id:'ancestor',opacity:.8}]},b={...rect('b'),shape:'ellipse'},layers=[a,b],patches=createMaskPatches(layers,b,{id:'mask-1',sourceId:'b'}),masked=patches.map(({layer,patch})=>({...layer,...patch}));
 assert.equal(masked[1].maskOnly,true);assert.equal(masked[0].compositing.at(-1).maskId,'b');for(let i=0;i<2;i++)assert.equal(JSON.stringify({...masked[i],...releaseMaskPatch(masked[i])}),JSON.stringify(layers[i]));
 const block={layers:[]},result=pasteLayerClipboard({entries:masked.map(layer=>({layer,text:{}}))},{block,resolved:masked,copy:{'en-US':{}},slideIds:['one'],dx:24,dy:24}),mask=result.layers.find(l=>l.maskOnly),content=result.layers.find(l=>!l.maskOnly);assert.equal(content.compositing.at(-1).maskId,mask.id);assert.notEqual(content.maskMembership.id,'mask-1');assert.equal(content.maskMembership.id,content.compositing.at(-1).id);
 const single=pasteLayerClipboard({entries:[{layer:masked[1],text:{}}]},{block:{layers:[]},resolved:masked,copy:{'en-US':{}},slideIds:['one'],dx:0,dy:0}).layers[0];assert.equal(single.maskOnly,undefined);assert.equal(single.maskMembership,undefined);
});
