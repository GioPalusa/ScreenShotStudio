// Export through the production pipeline; compare pixels against flattened per-screen references.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePNG, decodePNG } from './png.mjs';
import { sharedLayers, patchSharedLayer } from '../app/js/shared-canvas.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shared-render-'));
const project = path.join(temp, 'Test.sss');
const write = (file, data) => { const target = path.join(project, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, Buffer.isBuffer(data) ? data : JSON.stringify(data)); };
const image = (w, h, blue) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = Math.floor(x / 2); data[i + 1] = Math.floor(y / 2); data[i + 2] = blue; data[i + 3] = 255; }
  return encodePNG({ width: w, height: h, data, channels: 3 });
};
const pixel = (im, x, y) => [...im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 3)];
const exportDoc = (doc, name) => {
  write('studio.json', doc); const output = path.join(temp, name);
  execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', output, '--strict'], { cwd: root, stdio: 'pipe' });
  const run = path.join(output, fs.readdirSync(output)[0]);
  const manifest = JSON.parse(fs.readFileSync(path.join(run, 'manifest.json')));
  assert.deepEqual(manifest.report.warnings, []);
  return manifest.files.map(f => { const bytes = fs.readFileSync(path.join(run, f.path)); assert.equal(bytes[25], 2); return { ...f, image: decodePNG(bytes) }; });
};
try {
  const doc = { version: 2, fonts: { default: { family: 'system-ui' } }, themes: { white: { bg: '#ffffff', ink: '#111111' } },
    locales: [{ id: 'en-US', name: 'English', lang: 'en' }, { id: 'sv', name: 'Swedish', lang: 'sv' }],
    devices: { phone: { label: 'Phone', size: [400, 800], target: 'custom', layout: 'phone', capture: 'phone', frame: { type: 'plain', screen: [120, 240], radius: 0 } } },
    slides: ['a', 'b', 'c'].map(id => ({ id, theme: 'white', ...(id === 'c' ? { canvasOrientations: { phone: 'landscape' } } : {}), layouts: { phone: { template: 'custom', panorama: false, layers: [
      { id: 'ground', zOrder: -1, type: 'shape', shape: 'rect', cx: 200, cy: 400, w: 400, h: 800, fill: '#ffffff', allowCrop: true },
      ...(id === 'a' ? [{ id: 'local', type: 'art', src: 'bridge.png', cx: 412, cy: 100, w: 200, aspect: 2, allowCrop: true }] : []),
    ] } } })),
    sharedCanvas: { phone: { gap: .06, layers: [
      { id: 'bridge', type: 'art', src: 'bridge.png', variants: { sv: 'bridge-sv.png' }, aspect: 1, cx: 412, cy: 400, w: 400, allowCrop: true },
      { id: 'device', type: 'device', capture: 'capture', cx: 412, top: 560, w: 120, allowCrop: true, zOrder: 2 },
      { id: 'ribbon', type: 'shape', shape: 'rect', cx: 836, cy: 150, w: 400, h: 80, rotate: 18, fill: '#3599aa', allowCrop: true },
    ] } },
  };
  write('assets/art/bridge.png', image(400, 400, 80)); write('assets/art/bridge-sv.png', image(400, 400, 150));
  for (const locale of doc.locales) {
    write(`copy/${locale.id}.json`, { _meta: { status: 'approved', needsReview: [] } });
    write(`captures/${locale.id}/phone/capture.png`, image(120, 240, 110));
  }
  const actual = exportDoc(doc, 'shared'); assert.equal(actual.length, 6);
  for (const locale of doc.locales) {
    const a = actual.find(f => f.locale === locale.id && f.slideId === 'a').image, b = actual.find(f => f.locale === locale.id && f.slideId === 'b').image;
    assert.deepEqual(pixel(a, 390, 400), [89, 100, locale.id === 'sv' ? 150 : 80]);
    assert.deepEqual(pixel(b, 10, 400), [111, 100, locale.id === 'sv' ? 150 : 80]);
    assert.notDeepEqual(pixel(a, 390, 100), [255, 255, 255]); assert.deepEqual(pixel(b, 10, 100), [255, 255, 255]);
    assert.deepEqual(pixel(a, 390, 650), [19, 45, 110]); assert.deepEqual(pixel(b, 10, 650), [41, 45, 110]);
    const c = actual.find(f => f.locale === locale.id && f.slideId === 'c').image;
    assert.deepEqual([c.width, c.height], [800, 400]);
  }
  const flat = structuredClone(doc);
  for (const slide of flat.slides) slide.layouts.phone.layers.push(...sharedLayers(doc, 'phone', 'en-US', slide.id).map(l => Object.fromEntries(Object.entries(l).filter(([key]) => !key.startsWith('_')))));
  delete flat.sharedCanvas;
  // Flattening intentionally adds out-of-bounds objects to each tile; their crops are allowed.
  const reference = exportDoc(flat, 'flat');
  for (const file of actual) assert.deepEqual(file.image.data, reference.find(f => f.slideId === file.slideId && f.locale === file.locale).image.data, `${file.slideId}/${file.locale} exact pixels`);
  patchSharedLayer(doc, 'phone', sharedLayers(doc, 'phone', 'en-US', 'b')[0], { cx: 38 });
  const moved = exportDoc(doc, 'moved');
  for (const id of ['a','b']) assert.notDeepEqual(moved.find(f => f.slideId === id).image.data, actual.find(f => f.slideId === id).image.data);
  doc.sharedCanvas.phone.layers[0].src = 'missing.png'; delete doc.sharedCanvas.phone.layers[0].variants; write('studio.json', doc);
  assert.throws(() => execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', path.join(temp, 'missing'), '--strict'], { cwd: root, stdio: 'pipe' }), e => e.status === 2);
  console.log('PASS: 18 production RGB PNGs, exact per-pixel agreement, omitted 6% gap, localized shared images, split devices, rotated shapes, landscape tile, isolated local overflow, edits from either screen and strict missing-image rejection.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
