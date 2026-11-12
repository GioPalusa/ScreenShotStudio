import { recentPreviewId } from './recent-previews.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { projectName } from '../app/js/project-file.js';

/** A lightweight home overview; broken/missing packages never prevent Home opening. */
export function recentProjectSummaries(paths) {
  return paths.slice(0, 12).flatMap(folder => {
    try {
      if (typeof folder !== 'string') return [];
      const file = path.join(folder, 'studio.json'), stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || fs.lstatSync(file).isSymbolicLink()) return [];
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      return [{ path: folder, name: projectName(path.basename(folder)), previewURL: `/recent/${recentPreviewId(folder)}`, screens: Array.isArray(doc.slides) ? doc.slides.length : 0, languages: Array.isArray(doc.locales) ? doc.locales.length : 0, canvases: Object.keys(doc.devices ?? {}).length, modified: stat.mtime.toISOString() }];
    } catch { return []; }
  });
}
