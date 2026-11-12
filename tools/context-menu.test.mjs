import test from 'node:test';
import assert from 'node:assert/strict';
import {restackSelection} from '../app/js/layer-ops.js';
import {paintOrder} from '../app/js/layouts.js';
const fixture=()=>({layers:['a','b','c','d','e'].map((id,i)=>({id,type:'shape',zOrder:i+1,_origin:'slide'}))});
const order=block=>paintOrder(block.layers).map(l=>l.id).join('');
test('selected objects move one level together and retain relative order',()=>{
 const block=fixture();restackSelection(block,block.layers,['b','c'],1);assert.equal(order(block),'adbce');
 restackSelection(block,block.layers,['b','c'],-1);assert.equal(order(block),'abcde');
 restackSelection(block,block.layers,['b','d'],1);assert.equal(order(block),'acbed');
 restackSelection(block,block.layers,['b','d'],-1);assert.equal(order(block),'abcde');
});
test('front/back placement preserves selection order and no-op placement leaves JSON unchanged',()=>{
 const block=fixture();restackSelection(block,block.layers,['d','b'],1,true);assert.equal(order(block),'acebd');
 restackSelection(block,block.layers,['d','b'],-1,true);assert.equal(order(block),'bdace');
 const before=JSON.stringify(block);assert.deepEqual(restackSelection(block,block.layers,['b','d'],-1,true),[]);assert.equal(JSON.stringify(block),before);
});
test('stacking skips hidden neighbours and excludes locked selected objects',()=>{
 const block=fixture();block.layers[1].hidden=true;block.layers[3].locked=true;
 restackSelection(block,block.layers,['a','d'],1);assert.equal(order(block),'bcade');
 assert.equal(block.layers.find(l=>l.id==='d').zOrder,4);assert.equal(block.layers.find(l=>l.id==='b').hidden,true);
});
