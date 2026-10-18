import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedSlides, reorderSlides, renameSlide } from '../app/js/project-ops.js';
import { orderedCanvases, phoneCanvasId, screenshotCanvasId } from '../app/js/slide-order.js';
import { exportPlan } from '../app/js/export-naming.js';
const fixture = () => ({ slides: ['a', 'b', 'c'].map(id => ({ id, name: id })), locales: [{ id: 'en-US' }, { id: 'sv' }], devices: { phone: { size: [1290, 2796], target: 'iphone' } } });
const ids = (p, locale) => orderedSlides(p, locale).map(s => s.id);
test('shared editing follows iPad and remembers it while a store image is selected', () => {
 const p = fixture(); p.devices.ipad = { target: 'ipad', layout: 'tablet', size: [2064,2752] };
 p.devices.header = { target: 'app-store-header', screenScope: 'store-image', size: [3840,1646] };
 assert.equal(screenshotCanvasId(p, 'ipad', 'phone'), 'ipad');
 assert.equal(screenshotCanvasId(p, 'header', 'ipad'), 'ipad');
 delete p.devices.phone;
 assert.equal(screenshotCanvasId(p, 'missing', 'missing'), 'ipad');
 delete p.devices.ipad; assert.equal(screenshotCanvasId(p, 'header'), undefined);
});
test('languages inherit original order live until explicitly reordered', () => {
 const p = fixture(); p.locales.push({id:'ar-SA'});
 p.slideOrders={'en-US':['c','a','b']};
 assert.deepEqual(ids(p,'ar-SA'),['c','a','b']);
 assert.equal(p.slideOrders['ar-SA'],undefined,'Inheritance does not write an independent order');
 p.slideOrders['en-US']=['b','c','a'];
 assert.deepEqual(ids(p,'ar-SA'),['b','c','a']);
 reorderSlides(p,'a','b',false,'sv');
 assert.deepEqual(ids(p,'sv'),['a','b','c']);
 assert.deepEqual(ids(p,'ar-SA'),['b','c','a']);
 p.sourceLocale='sv';
 assert.deepEqual(ids(p,'ar-SA'),['a','b','c']);
});
test('explicit original-language-only reorder preserves inherited target orders',()=>{
 const p=fixture();p.slideOrders={'en-US':['c','a','b']};
 reorderSlides(p,'b','c',false,'en-US');
 assert.deepEqual(ids(p,'en-US'),['b','c','a']);
 assert.deepEqual(ids(p,'sv'),['c','a','b']);
});
test('language ordering persists independently and all languages adopts the chosen order', () => {
 const p = fixture(); reorderSlides(p, 'c', 'a', false, 'sv');
 assert.deepEqual(ids(p, 'sv'), ['c','a','b']); assert.deepEqual(ids(p, 'en-US'), ['a','b','c']);
 assert.deepEqual(p.slides.map(s=>s.id), ['a','b','c']);
 reorderSlides(p, 'b', 'c', true, 'sv', true);
 assert.deepEqual(ids(p, 'sv'), ['c','b','a']); assert.deepEqual(ids(p, 'en-US'), ['c','b','a']);
 assert.deepEqual(ids(JSON.parse(JSON.stringify(p)), 'sv'), ['c','b','a']);
});
test('stale and duplicate IDs are ignored and new screens remain visible', () => {
 const p = fixture(); p.slideOrders = { sv: ['c','missing','c'] };
 assert.deepEqual(ids(p,'sv'), ['c','a','b']);
 assert.equal(reorderSlides(p,'missing','a',false,'sv'),false);
});
test('rename preserves identity and export filenames follow each language order', () => {
 const p = fixture(); reorderSlides(p,'c','a',false,'sv');
 assert.equal(renameSlide(p,'c','  New screen  '),true); assert.equal(p.slides[2].id,'c');
 assert.equal(renameSlide(p,'c','  '),false);
 const jobs=exportPlan(p).filter(j=>j.locale==='sv');
 assert.deepEqual(jobs.map(j=>j.slideId), ['c','a','b']);
 assert.match(jobs[0].filename,/__01__new-screen.png$/);
 assert.equal(jobs[0].requestPath,'sv/phone/03-c.png');
});

test('store artwork stays first while each group retains its language order', () => {
 const p=fixture();
 p.devices.search={target:'app-store-search',screenScope:'store-image'};
 p.devices.header={target:'app-store-header',screenScope:'store-image'};
 p.slides.push({id:'search',canvasIds:['search']},{id:'header',canvasIds:['header']});
 p.slideOrders={'en-US':['c','header','a','search','b'],sv:['b','search','a','header','c']};
 const saved=JSON.stringify(p);
 assert.deepEqual(ids(p,'en-US'),['header','search','c','a','b']);
 assert.deepEqual(ids(p,'sv'),['search','header','b','a','c']);
 assert.deepEqual(orderedSlides(p,'sv','phone').map(s=>s.id),['b','a','c']);
 assert.deepEqual(orderedCanvases(p).map(([id])=>id),['search','header','phone']);
 assert.equal(JSON.stringify(p),saved,'Reading order preserves saved documents');
});
test('shared editing chooses a phone and remembers it across store and tablet selections', () => {
 const p=fixture();
 p.devices.android={target:'play-phone'};p.devices.tablet={target:'ipad',layout:'tablet'};
 p.devices.search={target:'app-store-search'};p.devices.watch={target:'watch',layout:'phone'};
 assert.equal(phoneCanvasId(p,'android','phone'),'android');
 assert.equal(phoneCanvasId(p,'search','android'),'android');
 assert.equal(phoneCanvasId(p,'tablet','android'),'android');
 assert.equal(phoneCanvasId(p,'watch','missing'),'phone');
 delete p.devices.phone;delete p.devices.android;
 assert.equal(phoneCanvasId(p,'tablet','missing'),undefined);
 p.devices.custom={target:'custom',layout:'phone'};
 assert.equal(phoneCanvasId(p,'search'), 'custom');
});
