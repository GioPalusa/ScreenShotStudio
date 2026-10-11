#!/usr/bin/env node
// Measures a device-bezel PNG and writes <name>.json next to it.
//
//   node tools/measure-frame.mjs project/assets/frames/my-bezel.png
//
// The bezel is a PNG whose screen is either a transparent hole (Apple's product bezels) or a flat colour in
// the middle of the picture. We find that region and record:
//   size        full pixel size of the PNG
//   screen      { x, y, w, h }  where the screenshot goes
//               radius          corner radius of the screen in pixels (the screenshot is clipped to it)
//               mode            "hole" (screenshot painted behind the bezel) or "overlay" (painted on top)
//   silhouette  bounding box of everything opaque -> the visible device
//
// The same measuring runs in the studio when you add a frame under Setup → Frames, where you can fine-tune it.
// An existing "label" in the JSON is kept.

import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png.mjs';
import { measureFrameData } from '../app/js/measure.js';

export const measureFrame = (pngBuffer) => measureFrameData(decodePNG(pngBuffer));

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/measure-frame.mjs <bezel.png>');
    process.exit(1);
  }
  const out = file.replace(/\.png$/i, '.json');
  const meta = measureFrame(fs.readFileSync(file));
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* new frame */ }
  const merged = { ...(previous.label ? { label: previous.label } : {}), ...meta };
  fs.writeFileSync(out, JSON.stringify(merged, null, 2) + '\n');
  console.log(`${path.basename(file)} -> ${path.basename(out)}`);
  console.log(JSON.stringify(merged));
}
