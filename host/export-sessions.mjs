import { PLAY_TARGETS } from '../app/js/google-play.js';
import { exportPlan, exportTimestamp } from '../app/js/export-naming.js';
import { exportGuide } from './export-guide.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite, copyProject, revision } from './files.mjs';

const inventory = root => {
  const result = {};
  const walk = (dir, prefix = '') => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name.endsWith('.studio-lock') || item.name.endsWith('.tmp')) continue;
      if (['.history', '.versions', 'export', '.DS_Store'].includes(item.name)) continue;
      if (item.isSymbolicLink()) throw new Error('Projects must contain local files, not symbolic links.');
      const rel = prefix + item.name, file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file, `${rel}/`); else result[rel] = revision(file);
    }
  };
  walk(root); return result;
};
export class ExportSessions {
  constructor(project, output) { this.project = project; this.output = output; this.sessions = new Map(); }
  start(mode, selection, output = this.output) {
    const started = new Date(), localStarted = exportTimestamp(started);
    const id = `${localStarted}_${crypto.randomUUID().slice(0, 8)}`;
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-studio-export-'));
    const source = path.join(temp, 'source');
    try {
      const before = inventory(this.project);
      copyProject(this.project, source);
      const copied = inventory(source), after = inventory(this.project);
      if (JSON.stringify(before) !== JSON.stringify(copied) || JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Project files changed while preparing export. Please try again.');
      const run = { id, source, temp, output, staging: path.join(output, `.partial-${id}`), mode, selection, files: [], started: started.toISOString(), localStarted, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, sourceHashes: copied };
      const project = JSON.parse(fs.readFileSync(path.join(source, 'studio.json'), 'utf8'));
      run.plan = new Map(exportPlan(project, selection).map(file => [file.requestPath, file]));
      this.sessions.set(id, run); return run;
    } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
  }
  get(id) { const run = this.sessions.get(id); if (!run) throw Object.assign(new Error('Export session is no longer available.'), { status: 404 }); return run; }
  write(id, relativePath, png, size) {
    const run = this.get(id);
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.png$/.test(relativePath) || relativePath.includes('..')) throw new Error('Invalid export path.');
    const info = run.plan.get(relativePath);
    if (!info) throw new Error('This image is not part of the selected export.');
    if (run.files.some(f => f.path === info.path)) throw new Error('This image was already written.');
    if (size.some((n, i) => n !== info.size[i]) || size.length !== 2) throw new Error('Image dimensions do not match the frozen canvas.');
    const target = info.target;
    const limit = PLAY_TARGETS[target]?.maxBytes;
    if (limit && png.length > limit) throw new Error(`Google Play ${PLAY_TARGETS[target].label}: image exceeds ${limit / 1024 / 1024} MB. Try a smaller accepted canvas size.`);
    atomicWrite(path.join(run.staging, info.path), png);
    const { requestPath, ...metadata } = info;
    const file = { ...metadata, bytes: png.length, sha256: crypto.createHash('sha256').update(png).digest('hex') };
    run.files.push(file);
    return file;
  }
  finish(id, report) {
    const run = this.get(id);
    const manifest = { format: 2, appVersion: '0.2.0', mode: run.mode, started: run.started, localStarted: run.localStarted, timeZone: run.timeZone, completed: new Date().toISOString(), selection: run.selection, sourceHashes: run.sourceHashes, files: run.files, report };
    if (run.mode === 'final' && (report.warnings?.length || report.skipped?.length)) throw new Error('Final export still has unresolved checks.');
    if (run.mode === 'final' && run.files.length !== run.plan.size) throw new Error('Final export is incomplete.');
    atomicWrite(path.join(run.staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
    atomicWrite(path.join(run.staging, 'UPLOAD-GUIDE.html'), exportGuide(manifest));
    const destination = path.join(run.output, `${run.mode}-${id}`);
    fs.renameSync(run.staging, destination);
    this.abort(id);
    return destination;
  }
  abort(id) {
    const run = this.sessions.get(id); if (!run) return;
    fs.rmSync(run.temp, { recursive: true, force: true });
    fs.rmSync(run.staging, { recursive: true, force: true }); this.sessions.delete(id);
  }
  close() { for (const id of this.sessions.keys()) this.abort(id); }
}
