// Production export plus pixel checks on both sides of every split frame.
import fs from 'node:fs';
import { STORY_TEMPLATES, storyCopyFor } from '../app/js/story-templates.js';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONNECTED_DESIGNS, newConnectedSeries, connectedGeometry } from '../app/js/connected-series.js';
import { encodePNG, decodePNG } from './png.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-series-render-'));
const project = path.join(temp, 'Project.sss'), output = path.join(temp, 'export');
const write = (file, value) => { const dest = path.join(project, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
try {
  const doc = { version: 2, fonts: { default: { family: 'system-ui' } }, themes: { brand: { bg: '#f2eee7', ink: '#243139' } }, locales: [{ id: 'en-US', name: 'English', lang: 'en', dir: 'ltr' }, { id: 'sv', name: 'Swedish', lang: 'sv', dir: 'ltr' }], devices: { phone: { label: 'Phone', target: 'custom', size: [400, 800], layout: 'phone', capture: 'phone', frame: { type: 'plain', screen: [400, 800], radius: 0 } } }, slides: [] };
  for (const locale of doc.locales) {
    write(`copy/${locale.id}.json`, { _meta: { status: 'approved', needsReview: [] } });
    for (let i = 0; i < 5; i++) {
      const data = Buffer.alloc(400 * 800 * 4);
      for (let y = 0; y < 800; y++) for (let x = 0; x < 400; x++) {
        const at = (y * 400 + x) * 4; data[at] = 40 + Math.floor(x / 2); data[at + 1] = 30 + Math.floor(y / 4); data[at + 2] = 40 + i * 35 + (locale.id === 'sv' ? 15 : 0); data[at + 3] = 255;
      }
      write(`captures/${locale.id}/phone/screen-${i}.png`, encodePNG({ width: 400, height: 800, data, channels: 3 }));
    }
  }
  const sets = []; let sequence = 0;
  for (const design of [...CONNECTED_DESIGNS, ...STORY_TEMPLATES]) for (const count of [2, 3, 4, 5]) {
    const options = { designId: design.id, count, gap: .08, theme: 'brand', palette: doc.themes.brand, sourceDeviceId: 'phone', captures: Array.from({ length: count }, (_, i) => ({ name: `screen-${i}`, set: 'phone' })) };
    const slides = newConnectedSeries(doc, options, () => `identity-${++sequence}`);
    doc.slides.push(...slides); sets.push({ slides, geometry: connectedGeometry({ ...options, W: 400, H: 800, ratio: .5 }) });
  }
  for (const design of STORY_TEMPLATES) for (const includeText of [true, false]) {
    const options = { designId: design.id, count: 1, includeText, captures: [{ name: 'screen-0', set: 'phone' }] };
    doc.slides.push(...newConnectedSeries(doc, options, () => `identity-${++sequence}`));
  }
  for (const locale of doc.locales) write(`copy/${locale.id}.json`, { _meta: { status: 'approved', needsReview: [] }, ...Object.fromEntries(doc.slides.filter(s => storyCopyFor(s)).map(s => [s.id, storyCopyFor(s)])) });
  write('studio.json', doc);
  execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', output, '--strict'], { cwd: root, stdio: 'pipe' });
  const run = path.join(output, fs.readdirSync(output)[0]), manifest = JSON.parse(fs.readFileSync(path.join(run, 'manifest.json')));
  assert.equal(manifest.files.length, 424); assert.deepEqual(manifest.report.warnings, []);
  for (const locale of doc.locales) for (const { slides, geometry } of sets) for (const b of geometry.devices.filter(b => b.seam != null || /^bridge-\d+$/.test(b.id))) {
    const seam = b.seam ?? Number(b.id.split('-')[1]) - 1, angle = b.rotate * Math.PI / 180;
    for (const [tile, x] of [[seam, 388], [seam + 1, 12]]) {
      const file = manifest.files.find(f => f.locale === locale.id && f.slideId === slides[tile].id), bytes = fs.readFileSync(path.join(run, file.path)), image = decodePNG(bytes);
      assert.equal(bytes[25], 2); assert.deepEqual([image.width, image.height], [400, 800]);
      const y = Math.round(b.seam == null ? b.cy : Math.min(b.cy, 800 * .61)), dx = geometry.offsets[tile] + x + .5 - b.cx, dy = y + .5 - b.cy;
      const u = (Math.cos(angle) * dx + Math.sin(angle) * dy) / b.w + .5, v = (-Math.sin(angle) * dx + Math.cos(angle) * dy) / b.h + .5;
      const expected = [40 + Math.floor(u * 400 / 2), 30 + Math.floor(v * 800 / 4), 40 + b.captureIndex * 35 + (locale.id === 'sv' ? 15 : 0)];
      const actual = pixel(image, x, y);
      assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) <= 3), `${slides[tile].name} ${locale.id}: split source pixels ${actual} should be ${expected}`);
    }
  }
  // Missing captures must reject a complete run before any PNGs are published.
  doc.slides = newConnectedSeries(doc, { designId: 'bridge', count: 2 }, () => `missing-${++sequence}`); write('studio.json', doc);
  const missingOutput = path.join(temp, 'missing-export');
  assert.throws(() => execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', missingOutput, '--strict'], { cwd: root, stdio: 'pipe' }), error => error.status === 2);
  assert.equal(fs.existsSync(missingOutput) ? fs.readdirSync(missingOutput).length : 0, 0);
  console.log('Design gallery: 424 final RGB PNGs including single-screen templates with and without text; all fourteen designs × 2–5 slides × two languages; intentional split frames match the source across the omitted gap; missing captures reject publication.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
