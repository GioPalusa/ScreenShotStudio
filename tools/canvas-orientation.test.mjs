import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasForSlide, setCanvasOrientation, canvasOrientationOptions } from '../app/js/canvas-orientation.js';
import { resolveLayers, canvasMetrics } from '../app/js/layouts.js';
import { exportPlan } from '../app/js/export-naming.js';
import { preflightSelection } from '../app/js/preflight.js';
import { canvasSizeOptions, existingStoreCanvas } from '../app/js/presets.js';
const fixture = () => ({ locales: [{id:'en-US'}, {id:'sv'}], themes: { light:{bg:'#fff',ink:'#000'} }, devices: {
 duo:{label:'Duo',target:'iphone',size:[2007,2853],designSize:[669,951],layout:'phone',capture:'duo-inner',frame:{type:'plain',screen:[2007,2853]}},
}, slides:['a','b'].map(id=>({id,theme:'light',layouts:{duo:{template:'custom',panorama:false,layers:[{id:'device',type:'device',cx:200,top:20,w:150,rotate:12,capture:'home'}]}}})) });
test('one row resolves portrait and landscape without changing device content, IDs or other slides',()=>{
 const p=fixture(), before=structuredClone(p);
 assert.equal(canvasForSlide(p,p.slides[0],'duo'),p.devices.duo);
 assert.equal(setCanvasOrientation(p,p.slides[1],'duo','landscape'),true);
 assert.deepEqual(canvasForSlide(p,p.slides[0],'duo').size,[2007,2853]);
 const landscape=canvasForSlide(p,p.slides[1],'duo');
 assert.deepEqual(landscape.size,[2853,2007]); assert.deepEqual(landscape.designSize,[951,669]);
 assert.equal(canvasMetrics(landscape).k,3);
 assert.deepEqual(p.devices,before.devices); assert.deepEqual(p.slides[1].layouts,before.slides[1].layouts);
 const scene=resolveLayers({project:p,slide:p.slides[1],deviceId:'duo'}); assert.equal(scene.W,951); assert.equal(scene.H,669);
 assert.equal(scene.layers[0].rotate,12);
 const restored=JSON.parse(JSON.stringify(p)); assert.deepEqual(canvasForSlide(restored,restored.slides[1],'duo').size,[2853,2007]);

});
test('mixed orientation export retains one section and sequence, with per-image dimensions',()=>{
 const p=fixture();setCanvasOrientation(p,p.slides[1],'duo','landscape');
 const plan=exportPlan(p); assert.deepEqual(plan.map(j=>j.position),[1,2,1,2]);
 assert.equal(new Set(plan.map(j=>j.sectionId)).size,1);
 assert.deepEqual(plan.map(j=>j.size),[[2007,2853],[2853,2007],[2007,2853],[2853,2007]]);
 assert.match(plan[1].filename,/^2853x2007__/); assert.deepEqual(preflightSelection(p,['duo']),[]);
});
test('unsupported orientations cannot be chosen or slip past preflight when loaded from disk',()=>{
 const p=fixture(); p.devices.duo={label:'Watch',target:'watch',size:[422,514]};
 assert.deepEqual(canvasOrientationOptions(p.devices.duo),['portrait']);
 assert.throws(()=>setCanvasOrientation(p,p.slides[0],'duo','landscape'),/not supported/);
 p.slides[0].canvasOrientations={duo:'landscape'};
 assert.ok(preflightSelection(p,['duo']).some(w=>w.includes('514 × 422')));
});
test('store size selection does not create a second row for a rotated format',()=>{
 const p=fixture(); assert.equal(existingStoreCanvas(p.devices,'iphone',[2853,2007]),'duo');
 const options=canvasSizeOptions('iphone'); assert.equal(options.filter(([id])=>['2007x2853','2853x2007'].includes(id)).length,1);
 assert.ok(canvasSizeOptions('iphone',[2853,2007]).some(([id])=>id==='2853x2007'));
});
test('fixed Automotive formats cannot be replaced by swapping width and height',()=>{
 const p=fixture(); p.devices.duo={target:'play-auto',size:[800,1280]};
 assert.deepEqual(canvasOrientationOptions(p.devices.duo),['portrait']);
 assert.throws(()=>setCanvasOrientation(p,p.slides[0],'duo','landscape'),/not supported/);
});
