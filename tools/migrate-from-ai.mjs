#!/usr/bin/env node
// One-off migration: pull the reusable artwork out of the old Illustrator file so
// the Studio no longer needs it.
//
//   node tools/migrate-from-ai.mjs [path/to/appstore.ai] [--work <dir>]
//
// Requires poppler (`brew install poppler`) for `pdfimages`. Already run once -
// the results remain in the private local project/assets and project/captures, so you
// should never need this again. It is kept so the provenance of every asset is
// documented and reproducible.
//
// What it extracts from AppStore/US/appstore.ai (an Illustrator file is a PDF):
//   frames/iphone-17-pro-orange.png  Apple bezel (Cosmic Orange) + alpha
//   frames/ipad-pro-11.png           Apple iPad Pro 11" bezel + alpha
//   art/globe.png                    the pixel-art globe + alpha
//   captures/default/<device>/*.png  the app screenshots used in the old slides

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from './png.mjs';
import { measureFrame } from './measure-frame.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const workFlag = args.indexOf('--work');
const aiPath = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--work') ?? path.join(root, '../US/appstore.ai'));
const work = workFlag >= 0 ? path.resolve(args[workFlag + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'ai-migrate-'));

if (workFlag < 0) {
  console.log(`Extracting images from ${aiPath} ...`);
  execFileSync('pdfimages', ['-png', aiPath, path.join(work, 'img')], { stdio: 'inherit' });
}

const load = (n) => decodePNG(fs.readFileSync(path.join(work, `img-${String(n).padStart(3, '0')}.png`)));

// pdfimages writes an image and its soft mask as two separate files.
function withMask(rgbN, maskN) {
  const rgb = load(rgbN);
  const mask = load(maskN);
  if (rgb.width !== mask.width || rgb.height !== mask.height) throw new Error(`image ${rgbN} and mask ${maskN} differ in size`);
  for (let i = 0; i < rgb.width * rgb.height; i++) rgb.data[i * 4 + 3] = mask.data[i * 4];
  return rgb;
}

const write = (rel, buf) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  console.log('wrote', rel, `(${(buf.length / 1024).toFixed(0)} KB)`);
};

// --- frames (bezel + alpha) ------------------------------------------------
const FRAMES = {
  'iphone-17-pro-orange': [1, 2],
  'ipad-pro-11': [11, 12],
};
for (const [name, [rgbN, maskN]] of Object.entries(FRAMES)) {
  const img = withMask(rgbN, maskN);
  const png = encodePNG({ width: img.width, height: img.height, data: img.data, channels: 4 });
  write(`project/assets/frames/${name}.png`, png);
  const meta = measureFrame(png);
  write(`project/assets/frames/${name}.json`, Buffer.from(JSON.stringify(meta, null, 2) + '\n'));
  console.log('  ', name, JSON.stringify(meta));
}

// --- art -------------------------------------------------------------------
{
  const globe = withMask(3, 4);
  write('project/assets/art/globe.png', encodePNG({ width: globe.width, height: globe.height, data: globe.data, channels: 4 }));
}

// --- captures (app screenshots, as used in the old slides) -----------------
// iPhone only: the three iPad pages in this particular .ai were later reused for
// a different app (lightning radar), so their screenshots are not Map my day's.
// Names describe the *screen*, not the slide, so a capture can be reused anywhere.
// (Page order in the .ai differs from the exported appstore-NN.png order.)
const CAPTURES = {
  iphone: { timeline: 0, progress: 25, memories: 30, trips: 33, worldmap: 48, 'trip-memory': 51 },
};
for (const [device, shots] of Object.entries(CAPTURES)) {
  for (const [name, n] of Object.entries(shots)) {
    const img = load(n);
    write(`project/captures/default/${device}/${name}.png`, encodePNG({ width: img.width, height: img.height, data: img.data, channels: 3 }));
  }
}
console.log('Done.');
