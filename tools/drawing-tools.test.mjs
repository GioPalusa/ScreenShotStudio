import test from 'node:test';import assert from 'node:assert/strict';
import {dragShape,penPath,penVector} from '../app/js/drawing-ops.js';
import {parseVectorPath,vectorToScene} from '../app/js/vector-path.js';
test('shape drag supports all directions, square/circle and drawing from centre',()=>{
 assert.deepEqual(dragShape('rect',{x:80,y:100},{x:20,y:50}),{shape:'rect',cx:50,cy:75,w:60,h:50,radius:0,opacity:1});
 const circle=dragShape('ellipse',{x:80,y:100},{x:120,y:80},{shift:true,alt:true});assert.equal(circle.cx,80);assert.equal(circle.cy,100);assert.equal(circle.w,80);assert.equal(circle.h,80);
 const line=dragShape('line',{x:0,y:0},{x:80,y:30},{shift:true});const p=parseVectorPath(line.paths[0].d);assert.ok(Math.abs(p[1].v[0]-p[1].v[1])<1e-4||p[1].v[1]===0);
});
test('pen preserves curve handles and stores a tight portable native path',()=>{
 const nodes=[{point:[20,30],out:[40,10]},{point:[100,80],in:[70,60]},{point:[80,120]}],original=structuredClone(nodes),v=penVector(nodes,true);
 assert.equal(penPath(nodes),'M20 30 C40 10 70 60 100 80 L80 120');assert.equal(v.paths[0].d,'M20 30 C40 10 70 60 100 80 L80 120 L20 30 Z');assert.deepEqual(vectorToScene(v,[20,30]),[20,30]);assert.deepEqual(v.pathOffset,[20,10]);assert.deepEqual(nodes,original);assert.equal(penVector(nodes).fill,'#ffffff00');
});

import {toolbarPaints,toolbarPaintPatch,paintPreview} from '../app/js/toolbar-paints.js';
test('toolbar paint changes preserve editable gradient fills through None and JSON reopen',()=>{
 const layer={type:'shape',shape:'path',w:200,pathSize:[100,100],paths:[{d:'M0 0L100 0L50 100Z'}],paints:[{type:'linear',handles:[[0,0],[1,1]],stops:[{position:0,color:'#ff000088'},{position:1,color:'#0000ffff'}]},{type:'solid',color:'#ffff0020'}],stroke:{width:3,color:'#abcdef',align:'inside'}};
 assert.equal(toolbarPaints(layer).width,6);assert.match(paintPreview(toolbarPaints(layer).fillPaint),/^linear-gradient/);
 const none={...layer,...toolbarPaintPatch(layer,'none')};assert.deepEqual(none.paints,[]);assert.deepEqual(toolbarPaintPatch(none,'none'),{});
 const reopened=JSON.parse(JSON.stringify(none)),restored={...reopened,...toolbarPaintPatch(reopened,'restore')};assert.deepEqual(restored.paints,layer.paints);assert.deepEqual(restored.paths,layer.paths);
 const color=toolbarPaintPatch(layer,'color',{color:'#112233'});assert.equal(color.paints[0].color,'#112233');assert.deepEqual(color.paints[1],layer.paints[1]);assert.deepEqual(toolbarPaintPatch(layer,'swap'),{});
 const strokeOff={...layer,...toolbarPaintPatch(layer,'none',{target:'stroke'})};assert.equal(strokeOff.stroke.width,0);assert.deepEqual(toolbarPaintPatch(strokeOff,'restore',{target:'stroke'}).stroke,layer.stroke);
 assert.equal(toolbarPaintPatch(layer,'width',{target:'stroke',width:10}).stroke.width,5);
 assert.deepEqual(toolbarPaintPatch(layer,'width',{target:'fill',width:10}),{stroke:{...layer.stroke,width:5}});
});
test('toolbar supports text fill, preserves text gradient through None and refuses unsupported outlines',()=>{
 const layer={type:'text',textPaint:{type:'linear',handles:[[0,0],[1,0]],stops:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff'}]}};
 const none={...layer,...toolbarPaintPatch(layer,'none')};assert.equal(toolbarPaints(none).fillEnabled,false);assert.deepEqual(toolbarPaintPatch(none,'restore').textPaint,layer.textPaint);
 assert.deepEqual(toolbarPaintPatch(layer,'color',{target:'stroke',color:'#000000'}),{});assert.equal(toolbarPaintPatch(layer,'color',{color:'#123456'}).color,'#123456');
});

import {cornerControls,cornerRadiusPatch} from '../app/js/corner-ops.js';
test('live rectangle corners clamp radius and preserve separate versus all corners',()=>{
 const rect={type:'shape',shape:'rect',w:120,h:80,radius:0};assert.equal(cornerControls(rect).length,4);
 assert.deepEqual(cornerRadiusPatch(rect,'0',30).radii,[30,0,0,0]);assert.deepEqual(cornerRadiusPatch(rect,'1',200,{all:true}).radii,[40,40,40,40]);assert.equal(cornerRadiusPatch(rect,'1',-12).radii[1],0);
 assert.deepEqual(cornerControls({...rect,shape:'ellipse'}),[]);
});
test('live polygon corners keep source paths, exact circular arcs, closure and paint geometry',()=>{
 const polygon={type:'shape',shape:'path',paths:[{d:'M0 0L100 0L100 100L0 100Z',rule:'evenodd'}],paints:[{type:'linear',handles:[[0,0],[1,1]]}]};
 const controls=cornerControls(polygon);assert.equal(controls.length,4);const patch=cornerRadiusPatch(polygon,'0:0',20,{all:true}),rounded={...polygon,...patch};assert.equal((patch.paths[0].d.match(/A/g)??[]).length,4);assert.ok(patch.paths[0].d.endsWith('Z'));assert.deepEqual(patch.cornerSourcePaths,polygon.paths);assert.equal(cornerControls(rounded).length,4);assert.equal(rounded.paints,polygon.paints);
 const reopened=JSON.parse(JSON.stringify(rounded)),back=cornerRadiusPatch(reopened,'0:0',0,{all:true});assert.equal((back.paths[0].d.match(/A/g)??[]).length,0);assert.deepEqual(back.cornerSourcePaths,polygon.paths);assert.equal(back.paths[0].rule,'evenodd');
 assert.deepEqual(cornerControls({...polygon,paths:[{d:'M0 0L100 0L100 100'}]}),[]);
});
