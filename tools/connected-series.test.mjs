import test from 'node:test';
import { STORY_TEMPLATES, storyCopyFor, addStoryCopy } from '../app/js/story-templates.js';
import { copyNeedsReview } from '../app/js/copy-review.js';
import assert from 'node:assert/strict';
import { CONNECTED_DESIGNS, connectedGeometry, newConnectedSeries, patchConnectedLayer } from '../app/js/connected-series.js';
import { resolveLayers, paintOrder } from '../app/js/layouts.js';
import { validateDocument } from '../app/js/document.js';

const fixture = () => ({ version: 2, themes: { brand: { bg: '#f2eee7', ink: '#243139', swatches: ['#f2eee7', '#243139', '#d58b68'] } },
  locales: [{ id: 'en-US' }, { id: 'sv' }], devices: {
    phone: { label: 'Phone', layout: 'phone', size: [1320, 2868], capture: 'iphone', frame: { type: 'plain', screen: [1206, 2622] } },
    tablet: { label: 'Tablet', layout: 'tablet', size: [2064, 2752], designSize: [1032, 1376], capture: 'ipad', frame: { type: 'plain', screen: [1640, 2360] } },
  }, slides: [{ id: 'old', theme: 'brand', capture: 'original' }] });
const ids = () => { let n = 0; return () => `review-${++n}`; };

test('sample copy needs review without changing existing approved copy', () => {
  const project = fixture(), slides = newConnectedSeries(project, { designId: 'paper', count: 3 }, ids());
  project.slides.push(...slides);
  const copy = { 'en-US': { _meta: { status: 'approved', needsReview: [] }, old: { headline: 'Approved text' } } };
  addStoryCopy(project, copy, slides, 'en-US');
  assert.equal(copy['en-US'].old.headline, 'Approved text');
  assert.equal(copyNeedsReview(copy['en-US'], 'old', 'headline'), false);
  assert.equal(copy['en-US']._meta.status, 'draft');
  for (const slide of slides) for (const field of ['headline', 'headlineAccent', 'caption', 'eyebrow']) assert.equal(copyNeedsReview(copy['en-US'], slide.id, field), true);
  addStoryCopy(project, copy, slides, 'sv');
  assert.deepEqual(copy.sv._meta, { status: 'draft', needsReview: ['*'] });
});

for (const design of CONNECTED_DESIGNS) test(`${design.name}: every seam has a split frame with an omitted gap for 2–5 tiles`, () => {
  for (const count of [2, 3, 4, 5]) for (const [W, H, ratio] of [[1320, 2868, .46], [2064, 2752, .72], [1600, 900, 1.6], [422, 514, .82]]) {
    const geometry = connectedGeometry({ designId: design.id, count, W, H, ratio, gap: .08 });
    assert.equal(geometry.offsets.length, count); assert.equal(geometry.devices.length, count + 1); assert.ok(geometry.shapes.length);
    for (let i = 0; i < count - 1; i++) {
      const device = geometry.devices[i], a = device.rotate * Math.PI / 180;
      const rw = Math.abs(device.w * Math.cos(a)) + Math.abs(device.h * Math.sin(a));
      const rh = Math.abs(device.w * Math.sin(a)) + Math.abs(device.h * Math.cos(a));
      assert.ok(device.cx - rw / 2 < geometry.offsets[i] + W - W * .05);
      assert.ok(device.cx + rw / 2 > geometry.offsets[i + 1] + W * .05);
      assert.ok(device.cy - rh / 2 >= H * .039 && device.cy + rh / 2 <= H * .961);
      assert.ok(Math.abs(geometry.offsets[i + 1] - geometry.offsets[i] - W - W * .08) < .001);
    }
  }
});

test('six designs remain distinct for every series length', () => {
  for (const count of [2, 3, 4, 5]) {
    const variants = CONNECTED_DESIGNS.map(d => connectedGeometry({ designId: d.id, count, W: 1320, H: 2868, ratio: .46 }));
    assert.equal(new Set(variants.map(v => JSON.stringify([v.devices, v.shapes]))).size, 6);
  }
});

test('series creation is additive plain JSON, with stable identities and matching capture collections', () => {
  const project = fixture(), before = structuredClone(project);
  const slides = newConnectedSeries(project, { designId: 'wave', count: 5, gap: .08, palette: project.themes.brand, sourceDeviceId: 'phone', captures: Array.from({ length: 5 }, (_, i) => ({ name: `screen-${i}`, set: 'iphone' })) }, ids());
  assert.deepEqual(project, before); assert.equal(slides.length, 5);
  assert.equal(new Set(slides.map(s => s.reviewId)).size, 5); assert.equal(new Set(slides.map(s => s.series.id)).size, 1);
  validateDocument({ ...project, slides: [...project.slides, ...slides] });
  for (const deviceId of Object.keys(project.devices)) for (let i = 0; i < 4; i++) {
    const left = slides[i].layouts[deviceId].layers.find(l => l.id === `bridge-${i + 1}`), right = slides[i + 1].layouts[deviceId].layers.find(l => l.id === left.id);
    const W = project.devices[deviceId].designSize?.[0] ?? project.devices[deviceId].size[0];
    assert.ok(Math.abs(left.cx - right.cx - W * 1.08) < .001);
    assert.equal(left.capture, `screen-${i}`); assert.equal(right.capture, left.capture); assert.equal(left.captureSet, undefined);
    assert.equal(left.top, right.top); assert.equal(left.w, right.w); assert.equal(left.rotate, right.rotate); assert.equal(left.allowCrop, true);
  }
  assert.equal(JSON.stringify(slides).includes('"_'), false);
});

test('missing captures remain unassigned, explicit hardware uses chosen capture sets and IDs do not collide', () => {
  const project = fixture(), first = newConnectedSeries(project, { designId: 'bridge', count: 2, profileId: 'iphone', sourceDeviceId: 'phone', captures: [{ name: 'home', set: 'other' }] }, ids());
  const frame = first[0].layouts.tablet.layers.find(l => l.id === 'bridge-1');
  assert.equal(frame.profile, 'iphone'); assert.equal(frame.captureSet, 'other');
  assert.equal(first[1].layouts.phone.layers.find(l => l.id === 'end').capture, null);
  project.slides.push(...first);
  const second = newConnectedSeries(project, { designId: 'bridge', count: 2 }, ids());
  assert.ok(second.every(slide => !project.slides.some(s => s.id === slide.id)));
  assert.equal(resolveLayers({ project, slide: second[1], deviceId: 'phone' }).layers.find(l => l.id === 'end').capture, null);
});

test('linked fragments follow geometry and screenshot edits, respecting unique designs and language scope', () => {
  const project = fixture(), slides = newConnectedSeries(project, { designId: 'ribbon', count: 3, gap: .1 }, ids());
  project.slides.push(...slides);
  const layer = slides[0].layouts.phone.layers.find(l => l.id === 'bridge-1');
  patchConnectedLayer(project, slides[0], 'phone', layer, { cx: 1450, top: 250, w: 700, rotate: 19, capture: 'changed', captureSet: 'new-set' });
  const other = slides[1].layouts.phone.layers.find(l => l.id === layer.id);
  assert.ok(Math.abs(other.cx - (1450 - 1320 * 1.1)) < .001);
  assert.equal(other.top, 250); assert.equal(other.w, 700); assert.equal(other.rotate, 19); assert.equal(other.capture, 'changed');
  slides[1].layouts.phone.independent = true;
  const before = structuredClone(other);
  patchConnectedLayer(project, slides[0], 'phone', layer, { capture: 'unique' }); assert.deepEqual(other, before);
  delete slides[1].layouts.phone.independent;
  patchConnectedLayer(project, slides[0], 'phone', layer, { capture: 'swedish' }, 'sv'); assert.deepEqual(other, before);
});

test('invalid counts, gaps and designs fail before any project mutation', () => {
  const project = fixture(), before = structuredClone(project);
  for (const count of [1, 6, 2.5]) assert.throws(() => newConnectedSeries(project, { designId: 'bridge', count }, ids()));
  for (const gap of [0, -.1, .2, NaN]) assert.throws(() => newConnectedSeries(project, { designId: 'bridge', count: 2, gap }, ids()));
  assert.throws(() => newConnectedSeries(project, { designId: 'missing', count: 2 }, ids())); assert.deepEqual(project, before);
});

// Editorial sets vary structure and color, while intentional split frames stay linked.
for (const design of STORY_TEMPLATES) test(`${design.name}: varied editable panels for 2–5 slides`, () => {
  for (const count of [2, 3, 4, 5]) {
    const project = fixture(), before = structuredClone(project);
    const slides = newConnectedSeries(project, { designId: design.id, count }, ids());
    assert.deepEqual(project, before);
    validateDocument({ ...project, slides });
    assert.equal(new Set(slides.map(s => s.series.role)).size, count);
    assert.ok(new Set(slides.map(s => s.colors.bg)).size >= 2);
    for (const [i, slide] of slides.entries()) {
      assert.ok(storyCopyFor(slide).headline && storyCopyFor(slide).caption);
      for (const block of Object.values(slide.layouts)) {
        const texts = block.layers.filter(l => l.type === 'text');
        assert.equal(texts.length, 4); assert.ok(texts.every(l => !l.seriesLayer && !('tile' in l)));
        assert.ok(block.layers.some(l => l.type === 'device'));
        const ordered = paintOrder(block.layers), card = ordered.findIndex(l => l.name === 'feature card');
        if (card >= 0) assert.ok(card > ordered.findIndex(l => l.type === 'device'));
      }
      assert.equal(slide.series.index, i);
    }
    assert.ok(!JSON.stringify(slides).includes('"tile"'));
    for (const [W,H,ratio] of [[1320,2868,.46], [2064,2752,.72], [1600,900,1.6], [422,514,.82]]) {
      const g = connectedGeometry({ designId: design.id, count, W, H, ratio, gap: .16 });
      assert.equal(new Set(g.devices.map(b => b.captureIndex)).size, count, 'Every imported capture is used');
      const signatures = g.panels.map((p, i) => JSON.stringify(g.texts.filter(t => t.tile === i).map(t => [t.x,t.capTop,t.size,t.w])));
      if (W <= H * 1.15) assert.equal(new Set(signatures).size, count, 'Each page has its own hierarchy');
      for (const t of g.texts) {
        assert.ok(t.x >= 0 && t.x + t.w <= W);
        assert.ok(t.capTop >= 0 && t.capTop + t.boxHeight <= H, `${design.id} ${t.tile} ${t.field} stays inside the canvas`);
      }
      for (const b of g.devices.filter(b => b.seam != null)) {
        const a=b.rotate*Math.PI/180, halfW=(Math.abs(b.w*Math.cos(a))+Math.abs(b.h*Math.sin(a)))/2;
        assert.ok(b.cx-halfW < g.offsets[b.seam]+W && b.cx+halfW > g.offsets[b.seam+1]);
        assert.deepEqual(b.tiles, [b.seam,b.seam+1]);
      }
    }
    // Cropped local phones may not accidentally leak into the next canvas.
    const geometry = connectedGeometry({ designId: design.id, count, W: 1320, H: 2868, ratio: .46 });
    for (const b of geometry.devices.filter(b => b.tile != null)) {
      for (let i=0;i<count;i++) assert.equal(slides[i].layouts.phone.layers.some(l => l.id === b.id), i === b.tile);
    }
  }
});

test('story split frames keep the omitted gap and linked edits on contrasting panels', () => {
  const project = fixture();
  const slides = newConnectedSeries(project, { designId: 'pulse', count: 3, gap: .12 }, ids());
  project.slides.push(...slides);
  const left = slides[0].layouts.phone.layers.find(l => l.id === 'bridge-screen-0');
  const right = slides[1].layouts.phone.layers.find(l => l.id === left.id);
  assert.ok(left.seriesLayer && right.seriesLayer);
  assert.ok(Math.abs(left.cx - right.cx - 1320 * 1.12) < .001);
  assert.equal(slides[2].layouts.phone.layers.some(l => l.id === left.id), false);
  patchConnectedLayer(project, slides[0], 'phone', left, { cx: 1200, capture: 'edited' });
  assert.equal(right.capture, 'edited');
  assert.ok(Math.abs(right.cx - (1200 - 1320 * 1.12)) < .001);
});

for (const design of STORY_TEMPLATES) test(`${design.name}: single-screen designs with and without text`, () => {
  for (const includeText of [true, false]) {
    const project = fixture(), before = structuredClone(project);
    const slides = newConnectedSeries(project, { designId: design.id, count: 1, includeText }, ids());
    assert.equal(slides.length, 1); assert.deepEqual(project, before);
    for (const block of Object.values(slides[0].layouts)) {
      assert.equal(block.layers.filter(l => l.type === 'device').length, 1, 'single screen has one deliberate hero device');
      assert.equal(block.layers.some(l => l.type === 'text'), includeText);
      assert.ok(block.layers.some(l => l.type === 'shape'));
    }
    assert.equal(Boolean(storyCopyFor(slides[0])), includeText);
  }
});

test('text-free series retain artwork and linked devices without sample copy', () => {
  const project = fixture();
  for (const design of STORY_TEMPLATES) for (const count of [2,3,4,5]) {
    const slides = newConnectedSeries(project, { designId: design.id, count, includeText: false }, ids());
    for (const slide of slides) {
      assert.equal(storyCopyFor(slide), null);
      assert.ok(Object.values(slide.layouts).every(block => block.layers.every(l => l.type !== 'text')));
    }
  }
});
