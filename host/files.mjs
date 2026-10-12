import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isProjectFile } from '../app/js/project-file.js';

export const revision = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'missing';
export function atomicWrite(file, data, { backupRoot = null, expected = null } = {}) {
  if (backupRoot) assertInside(backupRoot, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.studio-lock`;
  const claim = `${lock}.${crypto.randomUUID()}.tmp`;
  // Publish an already complete PID file atomically. A crash cannot leave an empty lock.
  fs.writeFileSync(claim, String(process.pid), { flag: 'wx' });
  try {
    try { fs.linkSync(claim, lock); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      let alive = false;
      if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code !== 'ESRCH'; } }
      // Older app versions could leave an incomplete lock. Give an in-flight writer time to finish.
      if (!(pid > 0) && Date.now() - fs.statSync(lock).mtimeMs < 30000) alive = true;
      if (alive) throw Object.assign(new Error('Another window is saving this file. Retrying shortly.'), { status: 423 });
      fs.unlinkSync(lock);
      try { fs.linkSync(claim, lock); }
      catch (e) { if (e.code === 'EEXIST') throw Object.assign(new Error('Another window is saving this file. Retrying shortly.'), { status: 423 }); throw e; }
    }
    try { return writeLocked(file, data, { backupRoot, expected }); }
    finally { fs.unlinkSync(lock); }
  } finally { fs.unlinkSync(claim); }
}
function writeLocked(file, data, { backupRoot, expected }) {
  if (expected !== null && revision(file) !== expected) throw Object.assign(new Error('This file changed outside this window. Your edits are retained. Resolve the conflict before saving.'), { status: 409 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buffer)) return revision(file);
  if (backupRoot && fs.existsSync(file)) {
    const rel = path.relative(backupRoot, file);
    const dir = path.join(backupRoot, '.history', rel);
    assertInside(backupRoot, path.join(dir, 'backup'));
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, path.join(dir, `${Date.now()}-${crypto.randomUUID()}.bak`));
  }
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx'); fs.writeFileSync(fd, buffer); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    fs.renameSync(tmp, file);
    // Persist the directory entry as well as its contents where the platform supports it.
    try { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch { /* unsupported directory fsync */ }
  } finally { if (fd !== undefined && fd !== null) fs.closeSync(fd); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  return revision(file);
}
export function copyProject(from, to, { replace = false } = {}) {
  const src = fs.realpathSync(from), dest = path.resolve(to);
  const checkDestination = () => {
    if (!fs.existsSync(dest)) return false;
    if (!replace) throw new Error('Choose a new project name. Existing projects are never overwritten.');
    if (!isProjectFile(dest) || !fs.lstatSync(dest).isDirectory() || !fs.existsSync(path.join(dest, 'studio.json')) || !fs.lstatSync(path.join(dest, 'studio.json')).isFile()) throw new Error('Choose an existing Screenshot Studio project to replace.');
    return true;
  };
  checkDestination();
  let existing = path.dirname(dest);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const physicalDest = path.resolve(fs.realpathSync(existing), path.relative(existing, dest));
  if (physicalDest === src || physicalDest.startsWith(src + path.sep)) throw new Error('Save the copy outside the current project.');
  if (dest.startsWith(src + path.sep)) throw new Error('Save the copy outside the current project.');
  if (src.startsWith(physicalDest + path.sep)) throw new Error('Save the copy outside a folder containing the current project.');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(dest), '.studio-copy-'));
  let preserveStaging = false;
  try {
    fs.cpSync(src, staging, { recursive: true, filter: p => {
      if (fs.lstatSync(p).isSymbolicLink()) throw new Error('Project files cannot be symbolic links.');
      return p === src || (!['.history', '.versions', 'export', '.DS_Store'].includes(path.basename(p)) && !p.endsWith('.studio-lock') && !p.endsWith('.tmp'));
    } });
    if (checkDestination()) {
      const previous = path.join(staging, '.versions', `replaced-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`);
      fs.mkdirSync(path.dirname(previous));
      fs.renameSync(dest, previous);
      try { fs.renameSync(staging, dest); }
      catch (error) {
        try { fs.renameSync(previous, dest); }
        catch {
          preserveStaging = true;
          throw new Error(`The copy could not be saved. The previous project is preserved at ${previous}.`, { cause: error });
        }
        throw error;
      }
    } else fs.renameSync(staging, dest);
  } finally { if (!preserveStaging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true }); }
}

export function assertInside(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid project path.');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Project files cannot be symbolic links.');
  }
}
