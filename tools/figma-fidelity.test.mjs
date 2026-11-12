import test from 'node:test';
import assert from 'node:assert/strict';
import {convertFigmaFrame} from '../app/js/figma-layout.js';
const frame=children=>({id:'1:1',type:'FRAME',name:'Fidelity regression',size:{x:375,y:812},children});
test('skewed and reflected Figma stroke geometry shares the fill transform',()=>{
 const d=convertFigmaFrame(frame([{id:'1:2',name:'Phone bezel',type:'VECTOR',size:{x:100,y:200},relativeTransform:[[1,.4,40],[0,-1,250]],fills:[{type:'SOLID',color:{r:0,g:0,b:0}}],strokes:[{type:'SOLID',color:{r:1,g:1,b:1}}],fillGeometry:[{path:'M0 0 L100 0 L100 200 Z'}],strokeGeometry:[{path:'M0 0 L100 0 L100 200 Z'}]}]));
 const [fill,outline]=d.layers;assert.deepEqual(outline.basis,fill.basis,'An outlined stroke must not lose the affine reflection/skew of its fill');assert.ok(outline.basis);assert.equal(fill.type,'shape');assert.equal(outline.shape,'path');
});
test('Figma layer blur travels with editable vector geometry',()=>{
 const d=convertFigmaFrame(frame([{id:'1:2',type:'ELLIPSE',name:'Soft colour',size:{x:100,y:100},relativeTransform:[[1,0,40],[0,1,250]],fills:[{type:'SOLID',color:{r:1,g:0,b:1}}],effects:[{type:'LAYER_BLUR',visible:true,radius:100}]}]));
 assert.equal(d.layers[0].blur,100,'A soft Figma colour field must retain its layer blur');assert.equal(d.layers[0].shape,'ellipse');assert.ok(!d.warnings.some(w=>w.includes('blur')));
});
