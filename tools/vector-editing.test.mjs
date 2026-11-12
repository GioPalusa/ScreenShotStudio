import test from 'node:test';
import assert from 'node:assert/strict';
import {reframeVectorPatch,bendVectorSegment,parseVectorPath as parse,writeVectorPath,vectorAnchors,vectorSegments,segmentPoint,moveVectorAnchor,moveVectorHandle,splitVectorSegment,deleteVectorAnchor,smoothVectorAnchor,cornerVectorAnchor,vectorToScene,sceneToVector} from '../app/js/vector-path.js';
import {shapePaints,editGradientStop,changePaintType,turnGradient,gradientAngle} from '../app/js/shape-ops.js';
const near=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-5,`${a} != ${b}`));
test('relative and shorthand paths expose real anchors and handles without changing their curves',()=>{
 const p=parse('m10 20h30v40c10 0 20 10 30 20s20 30 40 0q20 20 30 0t30 0z m-5 0l2 3');
 assert.deepEqual(p.map(c=>c.cmd),['M','L','L','C','C','Q','Q','Z','M','L']);assert.deepEqual(p[4].v,[80,90,90,110,110,80]);assert.deepEqual(parse(writeVectorPath(p)),p);
 assert.throws(()=>parse('M0 0C0 0 4'));assert.throws(()=>parse('M0 0<script>'));assert.throws(()=>parse('M0 0A1 2 0 2 0 3 4'));
});
test('dragging a closed anchor moves attached handles and keeps holes and the input untouched',()=>{
 const p=parse('M0 0C10 0 20 10 20 20C10 20 0 10 0 0Z M5 5L8 5L8 8Z'),before=writeVectorPath(p),edited=moveVectorAnchor(p,0,[4,6]);
 assert.deepEqual(edited[0].v,[4,6]);assert.deepEqual(edited[1].v.slice(0,2),[14,6]);assert.deepEqual(edited[2].v.slice(2),[4,16,4,6]);assert.deepEqual(edited.slice(4),p.slice(4));assert.equal(writeVectorPath(p),before);assert.equal(vectorAnchors(p).length,5);
 const handle=moveVectorHandle(p,1,0,[7,8]);assert.deepEqual(handle[1].v,[7,8,20,10,20,20]);
});
test('adding a point preserves cubic and quadratic curves pixel geometry',()=>{
 for(const d of ['M3 5C10 80 70 -20 100 60','M3 5Q70 -20 100 60','M0 0L10 30','M0 0A10 15 25 0 1 80 70','M10 15A100 80 25 1 0 80 70']){
  const p=parse(d),original=vectorSegments(p)[0],split=vectorSegments(splitVectorSegment(p,1,.37));
  for(let i=0;i<=100;i++){const t=i/100;near(segmentPoint(original,t),t<=.37?segmentPoint(split[0],t/.37):segmentPoint(split[1],(t-.37)/.63));}
 }
});
test('corner and smooth work on the closing edge and removal never empties a subpath',()=>{
 const p=parse('M0 0L100 0L100 100L0 100Z'),smooth=smoothVectorAnchor(p,0),first=vectorAnchors(smooth)[0];assert.equal(first.handles.length,2);assert.equal(smooth.at(-1).cmd,'Z');
 const corner=vectorAnchors(cornerVectorAnchor(smooth,0))[0];for(const h of corner.handles)near(h.point,corner.point);
 let reduced=deleteVectorAnchor(p,0);assert.equal(vectorAnchors(reduced).length,3);reduced=deleteVectorAnchor(reduced,0);assert.equal(vectorAnchors(reduced).length,2);assert.deepEqual(deleteVectorAnchor(reduced,0),reduced);
});
test('point transforms match scaled, offset, reflected, rotated and skewed imported vectors',()=>{
 const l={cx:314,cy:92,w:600,h:120,pathSize:[200,80],pathOffset:[-14,23],rotate:32,flipX:true,flipY:true,basis:[.8,.3,-.25,1.2]};for(const p of [[0,0],[-14,23],[190,90]])near(sceneToVector(l,vectorToScene(l,p)),p);
 const basic={cx:60,cy:80,w:100,h:60,pathSize:[50,30],pathOffset:[5,10]};near(vectorToScene(basic,[5,10]),[10,50]);
});
test('gradient controls preserve sibling image fills, all stops, alpha and skew',()=>{
 const layer={w:200,h:80,paints:[{type:'image',src:'asset.png',opacity:.4},{type:'linear',handles:[[.1,.2],[.8,.4],[.3,.9]],stops:[{position:0,color:'#ff000080'},{position:.3,color:'#00ff00ff'},{position:1,color:'#0000ffff'}]}]},original=structuredClone(layer);
 const edited=editGradientStop(layer,1,1,{color:'#aabbcc',opacity:.25,position:.6});assert.deepEqual(edited.paints[0],layer.paints[0]);assert.equal(edited.paints[1].stops.length,3);assert.equal(edited.paints[1].stops[1].color,'#aabbcc40');assert.deepEqual(layer,original);
 const turned={...layer,...turnGradient(layer,1,120)};assert.ok(Math.abs(gradientAngle(turned,turned.paints[1])-120)<1e-8);assert.deepEqual(turned.paints[0],layer.paints[0]);assert.equal(changePaintType(layer,1,'radial').paints[1].stops.length,3);assert.equal(shapePaints({fill:'#123456'})[0].color,'#123456');
});

test('bending preserves endpoints, other subpaths and moves the grabbed curve point exactly',()=>{
 for(const d of ['M0 0L100 0','M0 0Q40 90 100 0','M0 0C20 70 80 -20 100 0']){const original=parse(d+' M200 200L210 210'),segment=vectorSegments(original)[0],before=segmentPoint(segment,.4),changed=bendVectorSegment(original,1,.4,[12,28]),bent=vectorSegments(changed)[0];near(bent.from,segment.from);near(bent.to,segment.to);near(segmentPoint(bent,.4),[before[0]+12,before[1]+28]);assert.deepEqual(changed.slice(2),original.slice(2));}
 const closed=bendVectorSegment(parse('M0 0L100 0L100 100Z'),3,.5,[10,20]);assert.equal(closed.at(-1).cmd,'Z');assert.equal(closed[3].cmd,'C');assert.equal(vectorAnchors(closed).length,3);
});

test('linked handles stay opposite while preserving the other handle length; independent handles stay independent',()=>{
 const commands=parse('M0 0C20 0 30 40 50 40C70 40 80 80 100 80'),linked=moveVectorHandle(commands,1,2,[50,20],{linked:true}),node=vectorAnchors(linked)[1];assert.deepEqual(node.handles.map(h=>h.point),[[50,20],[50,60]]);assert.deepEqual(moveVectorHandle(commands,1,2,[50,20])[2].v.slice(0,2),[70,40]);assert.deepEqual(commands[2].v.slice(0,2),[70,40]);
});
test('editing bounds follow a bent path without moving geometry or its affine gradient',()=>{
 const layer={cx:180,cy:90,w:100,h:1,pathSize:[100,1],pathOffset:[0,0],basis:[1,.2,-.3,1],rotate:35,paints:[{type:'linear',handles:[[0,.5],[1,.5],[0,1.5]],stops:[{position:0,color:'#000000'},{position:1,color:'#ffffff'}]}]},paths=[{d:'M0 0C25 -60 75 -60 100 0'}],patch=reframeVectorPatch(layer,paths),next={...layer,...patch};assert.ok(next.h>40);for(const p of [[0,0],[50,-45],[100,0]])near(vectorToScene(layer,p),vectorToScene(next,p));
 for(let i=0;i<3;i++){const old=layer.paints[0].handles[i],now=next.paints[0].handles[i];near(vectorToScene(layer,[old[0]*100,old[1]]),vectorToScene(next,[now[0]*next.pathSize[0]+next.pathOffset[0],now[1]*next.pathSize[1]+next.pathOffset[1]]));}
});
