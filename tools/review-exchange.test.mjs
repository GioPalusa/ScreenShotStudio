import test from 'node:test';
import assert from 'node:assert/strict';
import { exportReviewCSV, parseReviewCSV, planReviewImport, applyReviewImport, ensureReviewIdentity, readCSV, writeCSV } from '../app/js/review-exchange.js';
import { copyNeedsReview, setFieldReview } from '../app/js/copy-review.js';
import { layerTag } from '../app/js/layer-tags.js';
import { resolveLayers } from '../app/js/layouts.js';
import { editBlock, patchLayer, setLayoutIndependent } from '../app/js/layer-ops.js';
const fixture = () => ({
  project: { reviewId: 'project-1', slides: [{ id: 'one', reviewId: 'screen-1', name: 'First', layouts: { phone: { template: 'custom', layers: [{ id: 'text', type: 'text', field: 'headline' }] } } }], locales: [{ id: 'en-US' }, { id: 'sv' }], devices: { iphone: { layout: 'phone', size: [1320, 2868] } } },
  copy: { 'en-US': { _meta: { status: 'approved', needsReview: [] }, one: { headline: 'Hello', bullets: ['One', 'Two'] } }, sv: { _meta: { status: 'draft', needsReview: ['*'] }, one: { headline: 'Hej', bullets: ['Ett', 'Två'] } } },
});
const reviewRows = ({project, copy}, change = () => {}, locales) => {
  const cells = readCSV(exportReviewCSV(project, copy, locales)), columns = cells[0];
  for (const row of cells.slice(1)) {
    const value = Object.fromEntries(columns.map((key,i) => [key,row[i]])); change(value);
    columns.forEach((key,i) => { row[i] = value[key]; });
  }
  return parseReviewCSV(writeCSV(cells));
};
const changed = f => reviewRows(f, row => { if (row.language === 'sv' && row.field === 'headline') { row.text = 'Hej världen'; row.decision = 'reviewed'; } });

test('CSV preserves quotes, multilingual text, newlines, lists and spreadsheet formula-like strings', () => {
  const values = ['hello, "world"\n世界 👋', '=HYPERLINK("x")', '+123', '-hej', '@one', "'hello", "'=literal", '\nhello', '\tstart', ''];
  assert.deepEqual(readCSV(writeCSV([values])), [values]);
  const f = fixture(); f.copy.sv.one.bullets = ['A\nB', 'C']; f.copy.sv.one.headline = values[0];
  const rows = reviewRows(f);
  assert.deepEqual(rows.find(r => r.language === 'sv' && r.field === 'bullets').incoming, ['A\nB','C']);
  assert.equal(rows.find(r => r.language === 'sv' && r.field === 'headline').incoming, values[0]);
  assert.ok(planReviewImport(f.project, f.copy, rows).every(r => r.status === 'unchanged'));
});

test('one-language export includes only that language; all includes every locale and empty custom text', () => {
  const f = fixture(); f.project.slides[0].layouts.phone.layers.push({ id: 'custom', type: 'text', field: 'custom' });
  const single = reviewRows(f, () => {}, ['sv']); assert.equal(single.length, 3); assert.ok(single.every(row => row.language === 'sv'));
  assert.equal(reviewRows(f).length, 6); assert.equal(single.find(row => row.field === 'custom').original, null);
});

test('IDs survive renaming, reordering and Save As; new screens and absent review rows stay untouched', () => {
  const f = fixture(), rows = changed(f);
  f.project.slides[0].name = 'Renamed';
  f.project.slides.unshift({ id: 'new', reviewId: 'screen-new', layouts: { phone: { template: 'custom' } } });
  f.copy.sv.new = { headline: 'Nytillkommen' };
  const plan = planReviewImport(f.project, f.copy, rows), next = applyReviewImport(f.project, f.copy, rows, plan.filter(r => r.status === 'ready'));
  assert.equal(next.copy.sv.one.headline, 'Hej världen'); assert.equal(next.copy.sv.new.headline, 'Nytillkommen');
  assert.deepEqual(next.copy['en-US'], f.copy['en-US']); assert.equal(f.copy.sv.one.headline, 'Hej');
  assert.equal(copyNeedsReview(next.copy.sv, 'one', 'headline'), false);
  assert.equal(copyNeedsReview(next.copy.sv, 'one', 'bullets'), true);
  assert.equal(copyNeedsReview(next.copy.sv, 'new'), true);
});

test('deleted/recreated screens with reused visible IDs are skipped; a different project is rejected', () => {
  const f = fixture(), rows = changed(f); f.project.slides[0].reviewId = 'replacement';
  assert.ok(planReviewImport(f.project, f.copy, rows).every(r => r.status === 'skipped'));
  f.project.reviewId = 'other'; assert.throws(() => planReviewImport(f.project, f.copy, rows), /different project/);
});

test('removed languages and missing fields are skipped', () => {
  const f = fixture(), rows = changed(f); f.project.locales = [{ id:'sv' }]; delete f.copy.sv.one.bullets; delete f.copy['en-US'].one.bullets;
  const plan = planReviewImport(f.project, f.copy, rows);
  assert.equal(plan.filter(r => r.status === 'skipped').length, 3);
});

test('concurrent project text, review decisions and English changes produce unchecked conflicts', () => {
  const f = fixture(), rows = changed(f); f.copy.sv.one.headline = 'Newer local text';
  let plan = planReviewImport(f.project, f.copy, rows); assert.equal(plan.find(r => r.language === 'sv' && r.field === 'headline').status, 'conflict');
  f.copy.sv.one.headline = 'Hej'; f.copy['en-US'].one.headline = 'Different source';
  plan = planReviewImport(f.project, f.copy, rows); assert.match(plan.find(r => r.status === 'conflict').reason, /English source/);
  const kept = applyReviewImport(f.project, f.copy, rows, []); assert.deepEqual(kept.copy, f.copy);
  assert.equal(applyReviewImport(f.project, f.copy, rows, plan.filter(r => r.status === 'conflict')).copy.sv.one.headline, 'Hej världen');
});

test('a stale import preview never overwrites edits made while the preview was open', () => {
  const f = fixture(), rows = changed(f), selected = planReviewImport(f.project, f.copy, rows).filter(r => r.status === 'ready');
  f.copy.sv.one.headline = 'Changed after preview';
  assert.throws(() => applyReviewImport(f.project, f.copy, rows, selected), /preview was open/);
  assert.equal(f.copy.sv.one.headline, 'Changed after preview');
});

test('editing reviewed text without an explicit reviewer decision flags Check, and re-import is idempotent', () => {
  const f = fixture(), rows = reviewRows(f, row => { if (row.language === 'en-US' && row.field === 'headline') row.text = 'Changed'; });
  const plan = planReviewImport(f.project, f.copy, rows), result = applyReviewImport(f.project, f.copy, rows, plan.filter(r => r.status === 'ready'));
  assert.equal(copyNeedsReview(result.copy['en-US'], 'one', 'headline'), true);
  setFieldReview(f.project, result.copy, 'en-US', 'one', 'headline', false);
  assert.ok(planReviewImport(f.project, result.copy, rows).every(r => r.status === 'unchanged'));
});

test('empty translations are explicit deletions; missing rows never delete text', () => {
  const f = fixture(), rows = reviewRows(f, row => { if (row.language === 'sv' && row.field === 'headline') row.text = ''; });
  const plan = planReviewImport(f.project, f.copy, rows), item = plan.find(row => row.deletion);
  assert.equal(item.status, 'ready');
  const result = applyReviewImport(f.project, f.copy, rows, [item]);
  assert.equal(result.copy.sv.one.headline, undefined); assert.deepEqual(result.copy.sv.one.bullets, ['Ett','Två']);
});

test('invalid CSV, duplicate rows, wrong versions, bad lists and prototype fields reject the entire file', () => {
  const f = fixture(), csv = exportReviewCSV(f.project, f.copy), cells = readCSV(csv);
  assert.throws(() => parseReviewCSV('hello'), /not a Screenshot/);
  assert.throws(() => readCSV('"never closed'), /quoted cell/);
  assert.throws(() => parseReviewCSV(writeCSV([...cells,cells[1]])), /duplicate/);
  for (const [key, value] of [['format','2'], ['field','__proto__'], ['decision','maybe'], ['original_json','{}'], ['original_check','maybe'], ['type','number']]) {
    const bad = structuredClone(cells); bad[1][bad[0].indexOf(key)] = value; assert.throws(() => parseReviewCSV(writeCSV(bad)));
  }
});

test('field Check can be cleared on a draft without approving other texts, then added again', () => {
  const f = fixture();
  setFieldReview(f.project, f.copy, 'sv','one','headline',false);
  assert.equal(copyNeedsReview(f.copy.sv,'one','headline'), false); assert.equal(copyNeedsReview(f.copy.sv,'one','bullets'), true);
  setFieldReview(f.project, f.copy, 'sv','one','bullets',false); assert.equal(copyNeedsReview(f.copy.sv), false);
  setFieldReview(f.project, f.copy, 'sv','one','headline',true); assert.equal(copyNeedsReview(f.copy.sv), true);
});

test('review identities are stable and cloned screen identities are repaired', () => {
  const f = fixture(); let serial = 0;
  assert.equal(ensureReviewIdentity(f.project, () => `id${++serial}`), false);
  f.project.slides.push({...structuredClone(f.project.slides[0]), id:'copy'});
  assert.equal(ensureReviewIdentity(f.project, () => `id${++serial}`), true);
  assert.equal(f.project.slides[0].reviewId,'screen-1'); assert.equal(f.project.slides[1].reviewId,'id1');
});

test('decoration tags are editable, removable, scoped and preserved in independent layouts', () => {
  const f = fixture(), slide = f.project.slides[0];
  slide.layouts.phone.layers = [{id:'globe',type:'art',src:'globe',panoramaLayer:true}];
  const resolve = () => resolveLayers({project:f.project,slide,deviceId:'iphone'}).layers[0];
  let layer = resolve(); assert.equal(layerTag(layer),'decoration');
  patchLayer(editBlock(f.project,slide,'iphone'),layer,{tag:'brand'}); assert.equal(layerTag(resolve()),'brand');
  patchLayer(editBlock(f.project,slide,'iphone'),resolve(),{tag:''}); assert.equal(layerTag(resolve()),'');
  setLayoutIndependent(f.project,slide,'iphone',true); assert.equal(layerTag(resolve()),''); assert.equal(resolve().panoramaLayer,true);
});

test('semicolon CSV from regional spreadsheet settings uses the same stable review rows',()=>{
  const f=fixture(),csv=exportReviewCSV(f.project,f.copy),cells=readCSV(csv);
  const regional=cells.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(';')).join('\r\n');
  assert.deepEqual(parseReviewCSV(regional),parseReviewCSV(csv));
});

// The language workbench displays this slide's review status, while export checks remain global.
test('reviewing every field on a slide clears its badge without approving other slides', () => {
  const project = { devices: {}, slides: [{ id: 'one' }, { id: 'two' }] };
  const copy = { sv: { _meta: { status: 'draft', needsReview: ['*'] }, one: { headline: 'Hej', caption: 'Text' }, two: { headline: 'Nästa' } } };
  setFieldReview(project, copy, 'sv', 'one', 'headline', false);
  assert.equal(copyNeedsReview(copy.sv, 'one'), true);
  setFieldReview(project, copy, 'sv', 'one', 'caption', false);
  assert.equal(copyNeedsReview(copy.sv, 'one'), false);
  assert.equal(copyNeedsReview(copy.sv, 'two'), true);
  assert.equal(copyNeedsReview(copy.sv), true);
  setFieldReview(project, copy, 'sv', 'one', 'caption', true);
  assert.equal(copyNeedsReview(copy.sv, 'one'), true);
});
