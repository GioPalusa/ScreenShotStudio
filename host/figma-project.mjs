import crypto from 'node:crypto';
import path from 'node:path';
import { atomicWrite } from './files.mjs';
import { createProjectPackage } from './new-project.mjs';
import { saveProjectFonts } from './project-fonts.mjs';
import { projectFromFigma } from '../app/js/figma-project.js';

export function createFigmaProject(destination, input) {
  if (!input || JSON.stringify(input).length > 200 * 1024 * 1024 || !Array.isArray(input.rows) || !input.images || typeof input.images !== 'object') throw Error('Invalid or oversized Figma project.');
  let result;
  createProjectPackage(destination, staging => {
    const assets = Object.create(null); let total = 0;
    for (const [ref, image] of Object.entries(input.images)) {
      if (typeof image.data !== 'string' || image.data.length > 45 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw Error('Invalid Figma image.');
      const bytes = Buffer.from(image.data, 'base64'); total += bytes.length;
      if (bytes.length > 32 * 1024 * 1024 || total > 128 * 1024 * 1024) throw Error('Figma images exceed the import limit.');
      const ext = bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' ? 'png' : bytes[0] === 255 && bytes[1] === 216 ? 'jpg' : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'webp' : null;
      if (!ext) throw Error('A Figma image is not PNG, JPEG or WebP.');
      const file = `figma-${crypto.createHash('sha256').update(bytes).digest('hex')}.${ext}`;
      atomicWrite(path.join(staging,'assets','art',file),bytes); assets[ref] = file;
    }
    const fonts = input.fonts?.length ? saveProjectFonts(staging, input.fonts) : [];
    result = projectFromFigma(input.rows, { assets, fonts });
    return { project: result.project, copy: result.copy };
  });
  return { slideId: result.slides[0], device: result.deviceId };
}
