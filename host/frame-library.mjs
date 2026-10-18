import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, assertInside } from './files.mjs';
import { resolveLayers } from '../app/js/layouts.js';
import { frameReferences } from '../app/js/frame-ops.js';

/** The installed library belongs to the app; documents retain only artwork they use. */
export class FrameLibrary {
  constructor(project, library = null) { this.project = path.join(project, 'assets', 'frames'); this.library = library; }
  metadata(directory) {
    const result = {};
    if (directory && fs.existsSync(directory)) for (const file of fs.readdirSync(directory)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(file) || file.includes('..')) continue;
      const meta = path.join(directory, file), png = meta.replace(/\.json$/, '.png');
      assertInside(directory, meta); assertInside(directory, png);
      if (!fs.existsSync(png)) continue;
      try { result[file.slice(0, -5)] = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch { /* Incomplete imports are not usable frames. */ }
    }
    return result;
  }
  all() { return { ...this.metadata(this.library), ...this.metadata(this.project) }; }
  rootFor(name) { return fs.existsSync(path.join(this.project, `${name}.png`)) ? this.project : this.library ?? this.project; }
  writeRoot() { return this.library ?? this.project; }
  installLegacy() {
    if (!this.library) return;
    for (const name of Object.keys(this.metadata(this.project))) {
      if (fs.existsSync(path.join(this.library, `${name}.png`))) continue;
      for (const ext of ['png', 'json']) atomicWrite(path.join(this.library, `${name}.${ext}`), fs.readFileSync(path.join(this.project, `${name}.${ext}`)));
    }
  }
  retainUsed(project) {
    const frames = this.all(), profiles = new Set(Object.keys(project.profiles ?? {}));
    for (const slide of project.slides ?? []) for (const deviceId of Object.keys(project.devices ?? {})) for (const locale of project.locales ?? []) {
      for (const layer of resolveLayers({ project, slide, deviceId, localeId: locale.id }).layers) if (layer.profile) profiles.add(layer.profile);
    }
    for (const name of Object.keys(frames)) if (frameReferences(project, name, frames).some(use => !use.profileId || profiles.has(use.profileId))) {
      const root = this.rootFor(name);
      if (root === this.project) continue;
      for (const ext of ['png', 'json']) {
        const file = path.join(root, `${name}.${ext}`); assertInside(root, file);
        atomicWrite(path.join(this.project, `${name}.${ext}`), fs.readFileSync(file));
      }
    }
  }
}
