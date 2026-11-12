import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSceneText, textReviewReport, textContrast, reviewWidths, parseReviewColor, contrastRatio, reviewPresentation } from '../app/js/text-review.js';

const text = (id = 'headline', extra = {}) => ({ id, type: 'text', field: id, color: '#223c43', _box: { x: 70, y: 160, w: 880, h: 200 }, ...extra });
function fixture(layers = [text()]) {
  return { localeId: 'en-US', deviceId: 'ipad', slideId: 'first', deviceDef: { target: 'ipad' }, W: 1032, H: 1376, theme: { bg: '#f5f1e8', ink: '#223c43' }, layers,
    texts: Object.fromEntries(layers.filter(l => l.type === 'text').map(l => [l.id, { field: l.field, size: 90, lines: 2, lineTexts: ['Daily tasks', 'as missions'], shrink: 1, overflow: false, fallback: false }])) };
}

test('measured sizes scale with display width, not export resolution; review never mutates scenes', () => {
  const s = fixture(), before = structuredClone(s); s.k = 2;
  const r = reviewSceneText(s);
  assert.deepEqual(r.layers[0].previews, [{ width: 160, fontSize: 13.95 }, { width: 240, fontSize: 20.93 }, { width: 320, fontSize: 27.91 }]);
  assert.equal(r.layers[0].contrast.ratio, 10.38); assert.equal(r.advisories.length, 0);
  delete s.k; assert.deepEqual(s, before);
});

test('fitting tiny secondary text produces advisory data separate from technical readiness', () => {
  const s = fixture(); s.texts.headline.size = 20;
  const r = reviewSceneText(s);
  assert.equal(r.layers[0].overflow, false); assert.equal(r.advisories[0].code, 'text-small-preview');
  assert.equal(r.advisories[0].locale, 'en-US'); assert.equal(r.advisories[0].layer, 'headline');
  assert.equal(textReviewReport([r]).status, 'visual-review-required'); assert.ok(!Object.hasOwn(r, 'ready'));
});

test('contrast follows relative luminance and composites text alpha against its backdrop', () => {
  assert.equal(contrastRatio(parseReviewColor('#fff'), parseReviewColor('#000')), 21);
  const s = fixture([text('headline', { color: '#00000080' })]); s.theme.bg = '#fff';
  assert.equal(textContrast(s, s.layers[0]).status, 'review'); assert.equal(textContrast(s, s.layers[0]).ratio, 4);
  s.layers[0].color = '#000'; s.layers[0].opacity = .5; assert.equal(textContrast(s, s.layers[0]).ratio, 3.98);
});

test('known opaque plate resolves contrast; rounded, partial and gradient backdrops remain unknown', () => {
  const bg = { id: 'plate', type: 'shape', shape: 'rect', fill: '#fff', _box: { x: 0, y: 0, w: 1000, h: 1000 } };
  const s = fixture([bg, text('headline', { color: '#000' })]); s.theme.bg2 = '#123456';
  assert.equal(textContrast(s, s.layers[1]).ratio, 21);
  bg.radius = 40; assert.equal(textContrast(s, s.layers[1]).status, 'unknown');
  delete bg.radius; bg._box.w = 400; assert.equal(textContrast(s, s.layers[1]).status, 'unknown');
  bg._box.w = 1000; bg.paints = [{ type: 'linear', stops: [{ color: '#fff' }, { color: '#000' }] }];
  assert.equal(textContrast(s, s.layers[1]).status, 'unknown');
});

test('foreground overlap, group compositing and transformed glyphs cannot claim a misleading contrast pass', () => {
  const s = fixture([text(), { id: 'cover', type: 'art', _box: { x: 0, y: 0, w: 1000, h: 1000 } }]);
  assert.equal(textContrast(s, s.layers[0]).status, 'unknown');
  s.layers.pop(); s.layers[0].compositing = [{ opacity: .3 }]; assert.equal(textContrast(s, s.layers[0]).status, 'unknown');
  s.layers[0].compositing = [{ id: 'normal-group', opacity: 1 }]; assert.equal(textContrast(s, s.layers[0]).status, 'unknown');
  delete s.layers[0].compositing; s.layers[0].basis = [2, 0, 0, 1];
  assert.equal(reviewSceneText(s).layers[0].previews[0].fontSize, null);
});

test('hidden, empty, mask-only and invisible grouped text create no readability warnings', () => {
  const s = fixture([text('hidden', { hidden: true }), text('empty'), text('mask', { maskOnly: true }), text('group', { compositing: [{ opacity: 0 }] })]);
  delete s.texts.empty; assert.deepEqual(reviewSceneText(s).layers, []);
});

test('presentation distinguishes screenshots and creative placements without certifying cropping', () => {
  assert.equal(reviewPresentation({ target: 'ipad' }).kind, 'screenshot');
  const p = reviewPresentation({ target: 'app-store-header' });
  assert.equal(p.kind, 'creative-asset'); assert.equal(p.cropVerified, false); assert.match(p.specs, /creative-assets-specifications/);
  assert.equal(reviewPresentation({ target: 'custom' }).specs, null);
  assert.equal(reviewPresentation({ target: 'play-phone' }).kind, 'google-play');
});

test('diagnostic width validation rejects duplicates, nonfinite values and excessive requests', () => {
  for (const widths of [[], [160, 160], [0], [NaN], [Infinity], [160.5], [160, 240, 320, 400, 500]]) assert.throws(() => reviewWidths(widths));
  assert.deepEqual(reviewWidths([80, 1600]), [80, 1600]);
});

test('localized render data and raw shared IDs are retained without English word-count rules', () => {
  const s = fixture([text('shared:headline', { _sharedId: 'headline' })]); s.localeId = 'ar-SA';
  Object.assign(s.texts['shared:headline'], { lineTexts: ['خطط ليومك'], lines: 1, size: 25, fallback: true, shrink: .8 });
  const r = reviewSceneText(s);
  assert.equal(r.layers[0].id, 'headline'); assert.equal(r.layers[0].fallback, true);
  assert.equal(r.layers[0].shrink, .8); assert.equal(r.advisories[0].locale, 'ar-SA');
});
