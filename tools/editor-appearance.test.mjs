import test from 'node:test';import assert from 'node:assert/strict';
import {copyAppearance,appearancePatch,encodeAppearanceClipboard,decodeAppearanceClipboard} from '../app/js/layer-ops.js';
import {distanceGuides,snapEqualSpacing} from '../app/js/selection.js';
test('appearance copy preserves paint data and visual outline width without copying identity or geometry',()=>{
 const source={id:'source',type:'shape',shape:'path',w:200,h:100,pathSize:[100,50],fill:'#112233',stroke:{width:3,color:'#abcdef'},shadow:{color:'#000000',alpha:.4,blur:12,dx:2,dy:4},paths:[{d:'M0 0L100 0L100 50Z'}]},target={id:'target',type:'shape',shape:'path',w:300,h:200,pathSize:[100,50],paths:[{d:'M0 0L50 50L100 0Z'}]};
 const appearance=copyAppearance(source),patch=appearancePatch(target,appearance);assert.equal(patch.stroke.width,2);assert.deepEqual(patch.shadow,source.shadow);assert.equal(patch.paints[0].color,'#112233');for(const key of ['id','type','shape','paths','w','h','cx','x','field'])assert.ok(!(key in patch));
 const clip=decodeAppearanceClipboard(encodeAppearanceClipboard(source,{projectId:'demo'}));assert.equal(clip.projectId,'demo');assert.deepEqual(clip.appearance,appearance);assert.equal(decodeAppearanceClipboard('{}'),null);assert.equal(decodeAppearanceClipboard('x'.repeat(1024*1024+1)),null);
});
test('text and gradient appearances stay editable and clear absent effects',()=>{
 const gradient={type:'linear',handles:[[0,0],[1,1]],stops:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff'}]},source={type:'shape',paints:[gradient]};assert.deepEqual(appearancePatch({type:'text'},copyAppearance(source)).textPaint,gradient);
 const text={type:'text',color:'#aabbcc',size:50,weight:500,field:'headline',x:20,w:300};const patch=appearancePatch({type:'text',shadow:{blur:12}},copyAppearance(text));assert.equal(patch.size,50);assert.equal(patch.shadow,undefined);assert.equal(patch.color,'#aabbcc');assert.ok(!('field'in patch));
});
test('distance guides report nearest gaps and equal spacing snaps beside or between neighbours',()=>{
 const others=[{x:0,y:0,w:100,h:100},{x:150,y:0,w:100,h:100}],moving={x:302,y:0,w:100,h:100};const result=snapEqualSpacing(moving,others,7);assert.equal(result.box.x,300);assert.ok(result.guides.filter(g=>g.equal&&g.axis==='x').length>=2);assert.ok(result.guides.some(g=>g.distance===50));assert.equal(moving.x,302);
 const between=snapEqualSpacing({x:178,y:0,w:50,h:100},[{x:0,y:0,w:100,h:100},{x:300,y:0,w:100,h:100}],7);assert.equal(between.box.x,175);assert.ok(between.guides.filter(g=>g.axis==='x').every(g=>g.equal&&g.distance===75));assert.equal(snapEqualSpacing(moving,others,0).box.x,302);
 const guides=distanceGuides({x:10,y:150,w:50,h:50},others);assert.ok(guides.some(g=>g.axis==='y'&&g.distance===50));assert.deepEqual(distanceGuides({x:0,y:0,w:10,h:10},[{x:100,y:100,w:10,h:10}]),[]);
});
