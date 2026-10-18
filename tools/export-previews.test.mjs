import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPreviews, exportContentsInfo } from '../app/js/export-previews.js';

test('previews prioritise primary screenshots and omit language and canvas duplicates', () => {
  const files = ['sv', 'en-US'].flatMap(locale => ['ipad', 'iphone'].flatMap(target =>
    Array.from({ length: 6 }, (_, i) => ({ locale, target, store: 'app-store', slideId: `s${i}`, sourcePosition: i + 1 }))));
  files.unshift({ locale: 'en-US', target: 'app-store-header', slideId: 'header', sourcePosition: 7, store: 'app-store' });
  const sample = exportPreviews(files);
  assert.equal(sample.locale, 'en-US'); assert.equal(sample.total, 7);
  assert.deepEqual(sample.images.map(f => f.slideId), ['s0', 's1', 's2', 's3']);
  assert.ok(sample.images.every(f => f.target === 'iphone'));
});
test('previews support creative-only exports, other locales and empty exports', () => {
  const file = { locale: 'ja', target: 'app-store-search', slide: 'Search', store: 'app-store' };
  assert.deepEqual(exportPreviews([file]).images, [file]);
  assert.equal(exportPreviews([file]).locale, 'ja');
  assert.deepEqual(exportPreviews([]).images, []);
});


test('full inventory includes every screen once and counts actual matching files', () => {
  const files = Array.from({ length: 6 }, (_, i) => ({ slideId: `s${i}`, sourcePosition: i, device: 'iphone', canvas: 'iPhone', locale: 'en-US', store: 'app-store' }));
  files.push(...files.map(file => ({ ...file, locale: 'sv' })));
  files.push({ ...files[0], device: 'ipad', canvas: 'iPad' });
  files.push({ slideId: 'sv-only', device: 'iphone', canvas: 'iPhone', locale: 'sv', store: 'app-store' });
  assert.equal(exportPreviews(files, Infinity).images.length, 7);
  assert.equal(exportPreviews(files, Infinity).images.find(file => file.slideId === 'sv-only').locale, 'sv');
  assert.deepEqual(exportContentsInfo(files), { count: 14, screenCount: 7, sizeCount: 2, locales: ['en-US', 'sv'], canvases: ['iPhone', 'iPad'] });
  assert.equal(exportPreviews([...files, { slideId: 'play', locale: 'en-US', store: 'google-play' }], Infinity, { appStoreOnly: false }).images.length, 8);
});
