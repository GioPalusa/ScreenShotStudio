import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedSlides, reorderSlides, renameSlide } from '../app/js/project-ops.js';
import { exportPlan } from '../app/js/export-naming.js';
const fixture = () => ({ slides: ['a', 'b', 'c'].map(id => ({ id, name: id })), locales: [{ id: 'en-US' }, { id: 'sv' }], devices: { phone: { size: [1290, 2796], target: 'iphone' } } });
const ids = (p, locale) => orderedSlides(p, locale).map(s => s.id);
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
