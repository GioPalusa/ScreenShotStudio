import test from 'node:test';
import assert from 'node:assert/strict';
import { addStoreImages } from '../app/js/store-images.js';
import { orderedSlides, screenCanvasId } from '../app/js/slide-order.js';
import { addDevice, removeDevice } from '../app/js/project-ops.js';
import { exportPlan } from '../app/js/export-naming.js';
import { preflightSelection } from '../app/js/preflight.js';
import { sharedGeometry } from '../app/js/shared-canvas.js';
import { validateDocument } from '../app/js/document.js';
const fixture = () => ({ version: 2, themes: { base: { bg: '#ffffff', ink: '#222222' } }, locales: [{ id: 'en-US' }, { id: 'sv' }], devices: { phone: { label: 'Phone', size: [1290,2796], layout: 'phone', target: 'iphone' } }, slides: [{ id: 'first', theme: 'base', layouts: { phone: { template: 'custom' } } }], slideOrders: { sv: ['first'] } });
const add = (p, store = 'app-store', sizes) => addStoreImages(p, { store, sizes, afterId: 'first' }, () => 'review-id');
test('App Store creates two isolated editable canvases, preserving screenshots and locale order', () => {
 const p = fixture(), original = structuredClone(p.slides[0]);
 const images = add(p, 'app-store', { 'app-store-search': [1920,1280], 'app-store-header': [3840,1646] });
 assert.equal(images.length, 2); assert.deepEqual(p.slides[0], original); validateDocument(p);
 assert.deepEqual(orderedSlides(p,'sv','phone').map(s=>s.id),['first']);
 for (const image of images) {
  assert.deepEqual(orderedSlides(p,'sv',image.deviceId).map(s=>s.id),[image.slideId]);
  assert.deepEqual(sharedGeometry(p,image.deviceId,'sv').tiles.map(t=>t.slide.id),[image.slideId]);
  assert.equal(p.slides.find(s=>s.id===image.slideId).layouts[image.deviceId].template,'custom');
 }
 const plan = exportPlan(p);
 assert.equal(plan.length,6); assert.deepEqual(plan.filter(j=>j.locale==='en-US').map(j=>j.size),[[1290,2796],[1920,1280],[3840,1646]]);
 assert.deepEqual(preflightSelection(p,Object.keys(p.devices)),[]);
 assert.equal(exportPlan(p,{devices:['phone'],slides:[images[0].slideId]}).length,0);
});
test('Google Play creates only one 1024 × 500 feature graphic, and repeated additions preserve artwork', () => {
 const p = fixture(); add(p); const [image] = add(p,'google-play');
 const slide = p.slides.find(s=>s.id===image.slideId); slide.layouts[image.deviceId].layers.push({id:'art',type:'shape',x:0,y:0,w:20,h:20});
 const before=JSON.stringify(p); assert.deepEqual(add(p,'google-play'),[image]); assert.equal(JSON.stringify(p),before);
 assert.deepEqual(p.devices[image.deviceId].size,[1024,500]);
 assert.equal(exportPlan(p).length,8); assert.deepEqual(preflightSelection(p,Object.keys(p.devices)),[]);
});
test('invalid format fails before any mutation; scope survives JSON, duplicate canvas and removal', () => {
 const p=fixture(), before=JSON.stringify(p);
 assert.throws(()=>add(p,'app-store',{'app-store-header':[100,100]}),/Unsupported/); assert.equal(JSON.stringify(p),before);
 const [image]=add(p); const restored=JSON.parse(JSON.stringify(p)); validateDocument(restored);
 const id=addDevice(restored,{label:'Variant',target:'app-store-search',size:[3840,2560],reuseFrom:image.deviceId});
 assert.deepEqual(orderedSlides(restored,'sv',id).map(s=>s.id),[image.slideId]);
 removeDevice(restored,image.deviceId); validateDocument(restored); assert.equal(orderedSlides(restored,'sv',id)[0].id,image.slideId);
 removeDevice(restored,id); validateDocument(restored); assert.ok(!restored.slides.some(s=>s.id===image.slideId));
});

test('one project-wide list selects the correct canvas and remembers the screenshot format',()=>{
 const p=fixture(),[search,header]=add(p);
 p.devices.tablet={...p.devices.phone,label:'Tablet',size:[2064,2752]};
 const original=p.slides.find(s=>s.id==='first'),searchSlide=p.slides.find(s=>s.id===search.slideId),headerSlide=p.slides.find(s=>s.id===header.slideId);
 assert.equal(orderedSlides(p,'sv').length,3);
 assert.equal(screenCanvasId(p,searchSlide,'tablet'),search.deviceId);
 assert.equal(screenCanvasId(p,headerSlide,search.deviceId,'tablet'),header.deviceId);
 assert.equal(screenCanvasId(p,original,header.deviceId,'tablet'),'tablet');
 assert.equal(screenCanvasId(p,original,'phone','tablet'),'phone');
 assert.equal(screenCanvasId(p,original,'removed','removed'),'phone');
 assert.equal(exportPlan(p,{locales:['sv']}).length,4,'Navigation does not create extra exported combinations');
});
