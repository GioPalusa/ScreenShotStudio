import { captureUsage, imageUsage } from '../app/js/media.js';
import { projectName } from '../app/js/project-file.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { encodePNG } from '../tools/png.mjs';
import { inspectUploadExport, readExportImage } from './app-store-connect.mjs';
import { exportGuide } from './export-guide.mjs';
import { uploadChecks } from '../app/js/upload-checks.js';
import { exportPreviews, exportContentsInfo } from '../app/js/export-previews.js';
import { FrameLibrary } from './frame-library.mjs';
import { ExportSessions } from './export-sessions.mjs';
import { atomicWrite, revision, assertInside } from './files.mjs';
import { migrateDocument, validateDocument } from '../app/js/document.js';
import { installedFonts } from './fonts.mjs';
import { translateText, listTranslationModels } from './translation.mjs';
import { readImportArchive } from './import-archive.mjs';

export function createStudioService({ appPath, projectPath, exportPath, frameLibraryPath = null, origin = null, createThumbnail = null, onExportLog = line => console.log(line), onChange = () => {} }) {
const ROOT = path.dirname(appPath), APP = appPath, PROJECT = projectPath, EXPORT = exportPath;
const sessions = new ExportSessions(PROJECT, EXPORT);
const frameLibrary = new FrameLibrary(PROJECT, frameLibraryPath);
frameLibrary.installLegacy();
const exportDestinations = new Map();
// Called only by the trusted native directory picker, never by a renderer path.
function authorizeExportDestination(directory) {
  const selected = fs.realpathSync(directory);
  if (!fs.statSync(selected).isDirectory()) throw new Error('Choose an export folder.');
  const project = fs.realpathSync(PROJECT);
  if (selected === project || selected.startsWith(project + path.sep)) throw new Error('Choose an export folder outside the project package.');
  const token = crypto.randomUUID();
  exportDestinations.clear(); exportDestinations.set(token, selected);
  return { token, path: selected };
}
let latestExport = EXPORT;
const completedExports = new Set();
function uploadExportPath(exportPath) {
  if (!completedExports.has(exportPath) && !savedExportRuns().some(run => run.path === exportPath)) throw new Error('Choose the saved export folder in Upload before uploading.');
  return exportPath;
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

// ---------------------------------------------------------------------------
// helpers

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const safe = (s) => typeof s === 'string' && SAFE.test(s) && !s.includes('..');

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(data);
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

async function readBody(req, limit = 256 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJSONBody(req, limit = 8 * 1024 * 1024) {
  const text = (await readBody(req, limit)).toString('utf8');
  try { return JSON.parse(text); } catch { throw httpError(400, 'The request body is not valid JSON'); }
}

const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

// What we did to the project ourselves, so the file watcher doesn't bounce it back at the browser.
//  - a file we wrote is recognised by the size and time it has afterwards: an edit from anywhere else, even a moment later, differs;
//  - directories, moves and deletions are muted for a moment (they carry no content to lose).
const recentWrites = new Map();
const ownWrites = new Map();
const signatureOf = (file) => { try { const st = fs.statSync(file); return `${st.size}:${Math.round(st.mtimeMs)}`; } catch { return null; } };
function noteOwnWrite(file, { includeSelf = true } = {}) {
  // fs.watch also reports the parent directories of a changed file, so remember those too
  const now = Date.now();
  for (let dir = includeSelf ? file : path.dirname(file); dir.startsWith(PROJECT) && dir !== path.dirname(PROJECT); dir = path.dirname(dir)) recentWrites.set(dir, now);
}
function writeProjectFile(file, data, expected = null) {
  assertInside(PROJECT, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  noteOwnWrite(file, { includeSelf: false });
  atomicWrite(file, data, { backupRoot: PROJECT, expected });
  ownWrites.set(file, signatureOf(file));
}
const prettyJSON = (obj) => JSON.stringify(obj, null, 2) + '\n';

function rejectLinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw httpError(400, 'Project files cannot be symbolic links.');
    if (entry.isDirectory() && !['.history', '.versions', 'export'].includes(entry.name)) rejectLinks(path.join(dir, entry.name));
  }
}

function listCaptures() {
  const out = {};
  const base = path.join(PROJECT, 'captures');
  if (!fs.existsSync(base)) return out;
  for (const scope of fs.readdirSync(base)) {
    const scopeDir = path.join(base, scope);
    if (!fs.statSync(scopeDir).isDirectory()) continue;
    for (const device of fs.readdirSync(scopeDir)) {
      const devDir = path.join(scopeDir, device);
      if (!fs.statSync(devDir).isDirectory()) continue;
      for (const f of fs.readdirSync(devDir)) {
        if (!/\.(png|jpe?g)$/i.test(f)) continue;
        const stat = fs.statSync(path.join(devDir, f));
        ((out[scope] ??= {})[device] ??= {})[f.replace(/\.[^.]+$/, '')] = { file: f, mtime: Math.round(stat.mtimeMs) };
      }
    }
  }
  return out;
}

// Images the studio accepts as layers. The type comes from the file's own bytes, not its name.
function detectImageExt(buf) {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.subarray(0, 3).toString() === 'GIF') return 'gif';
  const text = buf.toString('utf8');
  if (/<svg[\s>]/i.test(text.slice(0, 4096)) && isSafeSVG(text)) return 'svg';
  return null;
}

/**
 * An SVG here is only ever drawn as a picture, but the file is also served back to the browser, so anything that could
 * run code, pull in another file or smuggle markup through an entity is refused (a designer's exported SVG has none of it).
 */
function isSafeSVG(text) {
  const t = text.replace(/\u0000/g, '');
  if (/<!doctype|<!entity|<\?xml-stylesheet|<\s*\/?\s*(?:[a-z0-9_-]+:)?(?:script|foreignobject|iframe|embed|object)\b|javascript:|vbscript:|data:text\/html|\son[a-z]+\s*=/i.test(t)) return false;
  // references to anything outside the file (the file itself may embed images as data:image/...)
  if (/(?:xlink:)?href\s*=\s*["']?\s*(?!#|data:image\/)[^"'\s>]/i.test(t)) return false;
  if (/url\(\s*["']?\s*(?!#|data:image\/)[^)"'\s]/i.test(t)) return false;
  if (/@import/i.test(t)) return false;
  return true;
}
const slug = (text) => String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function listAssets() {
  const dir = path.join(PROJECT, 'assets', 'art');
  const art = [];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(f)) continue;
      const stat = fs.statSync(path.join(dir, f));
      art.push({ file: f, bytes: stat.size, mtime: Math.round(stat.mtimeMs) });
    }
  }
  return { art: art.sort((a, b) => b.mtime - a.mtime) };
}

const REMOVED_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._-]*__[0-9TZ-]+$/;          // <language id>__<time>, the id as safe() allows it
const removedFolderId = (folder) => folder.slice(0, folder.lastIndexOf('__'));

/** Languages taken out of the project: their text and screenshots wait in project/_removed/<id>__<time>/ until restored. */
function listRemovedLocales() {
  const dir = path.join(PROJECT, '_removed');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => REMOVED_FOLDER.test(f))
    .map((folder) => ({ folder, id: removedFolderId(folder), entry: readJSON(path.join(dir, folder, 'locale.json'), null), mtime: Math.round(fs.statSync(path.join(dir, folder)).mtimeMs) }))
    .sort((a, b) => b.mtime - a.mtime);
}

function archiveDelete(file) {
  if (!fs.existsSync(file)) return;
  assertInside(PROJECT, file);
  const backup = path.join(PROJECT, '.history', path.relative(PROJECT, file), `${Date.now()}-${crypto.randomUUID()}.bak`);
  assertInside(PROJECT, backup); atomicWrite(backup, fs.readFileSync(file));
  noteOwnWrite(file); fs.unlinkSync(file);
}

function moveFile(from, to) {
  assertInside(PROJECT, from); assertInside(PROJECT, to);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  noteOwnWrite(from);
  noteOwnWrite(to);
  fs.renameSync(from, to);
}

function savedExportRuns() {
  const archive = path.join(PROJECT, 'export');
  if (!fs.existsSync(archive)) return [];
  // MCP isolates invocations under export/ai-…/ (and an optional output subfolder).
  // Stop at a completed run so its locale/image directories aren't searched.
  const pending = [archive], roots = [];
  while (pending.length) {
    const directory = pending.pop();
    try {
      assertInside(PROJECT, directory);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const child = path.join(directory, entry.name);
        if (/^(draft|final)-[A-Za-z0-9_-]+$/.test(entry.name)) roots.push(child);
        else pending.push(child);
      }
    } catch { /* Incomplete, inaccessible or linked export folders stay outside discovery. */ }
  }
  return roots.flatMap(root => {
    try {
      assertInside(PROJECT, path.join(root, 'manifest.json'));
      const manifest = readJSON(path.join(root, 'manifest.json'), null);
      if (!manifest?.completed || !Array.isArray(manifest.files)) return [];
      const files = manifest.files.filter(file => file.store === 'app-store');
      const { errors, warnings } = uploadChecks(manifest.report ?? {});
      if (!files.length) errors.push({ level: 'error', message: 'This export contains no App Store images.' });
      const sample = exportPreviews(manifest.files);
      const previews = sample.images.map(file => ({ label: file.slide ?? file.filename, locale: file.locale, canvas: file.canvas, size: file.size,
        src: `/api/export-preview?${new URLSearchParams({ run: path.relative(archive, root), file: file.path })}` }));
      return [{ ...exportContentsInfo(manifest.files), path: root, name: path.basename(root), count: manifest.files.length, locales: [...new Set(manifest.files.map(f => f.locale))], canvases: [...new Set(manifest.files.map(f => f.canvas))], completed: manifest.completed, errors, warnings, appStoreCount: files.length, previews, previewLocale: sample.locale, previewTotal: sample.total }];
    } catch { return []; }
  }).sort((a, b) => b.completed.localeCompare(a.completed));
}

// Called only after a native picker has granted access to a completed export.
function retainSavedExport(directory) {
  if (savedExportRuns().some(run => run.path === directory)) return directory;
  const checked = inspectUploadExport(directory);
  if (checked.errors.length) throw new Error('Fix the technical errors before importing this export.');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const archive = path.join(PROJECT, 'export');
  const name = `${manifest.mode}-imported-${checked.manifestHash.slice(0, 16)}`;
  const destination = path.join(archive, name);
  assertInside(PROJECT, destination);
  if (fs.existsSync(destination)) return destination;
  fs.mkdirSync(archive, { recursive: true });
  const staging = fs.mkdtempSync(path.join(archive, '.partial-import-'));
  try {
    for (const file of manifest.files) {
      const bytes = readExportImage(directory, file);
      const target = path.join(staging, file.path); assertInside(staging, target);
      atomicWrite(target, bytes);
    }
    atomicWrite(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
    atomicWrite(path.join(staging, 'UPLOAD-GUIDE.html'), exportGuide(manifest));
    fs.renameSync(staging, destination);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  return destination;
}

function listExports() {
  const out = [];
  const walk = (dir, rel = '') => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) walk(p, path.join(rel, f));
      else if (f.endsWith('.png')) out.push({ path: path.join(rel, f), bytes: stat.size, mtime: Math.round(stat.mtimeMs) });
    }
  };
  walk(EXPORT);
  return out;
}

function loadProjectBundle() {
  rejectLinks(PROJECT);
  const studio = migrateDocument(JSON.parse(fs.readFileSync(path.join(PROJECT, 'studio.json'), 'utf8')));
  const copy = {};
  const copyDir = path.join(PROJECT, 'copy');
  if (fs.existsSync(copyDir)) {
    for (const f of fs.readdirSync(copyDir)) if (f.endsWith('.json')) copy[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(copyDir, f), 'utf8'));
  }
  const frames = frameLibrary.all();
  // `api` tells the browser app which endpoints this server has (2: images, frames, language removal)
  return { api: 3, projectId: crypto.createHash('sha256').update(PROJECT).digest('hex').slice(0, 16), name: projectName(path.basename(PROJECT)), revisions: { studio: revision(path.join(PROJECT, 'studio.json')), ...Object.fromEntries(Object.keys(copy).map(id => [`copy:${id}`, revision(path.join(copyDir, `${id}.json`))])) }, studio, copy, frames, captures: listCaptures(), assets: listAssets(), removed: listRemovedLocales(), exports: listExports() };
}

// ---------------------------------------------------------------------------
// live reload (server-sent events)

const clients = new Set();
function broadcast(event) {
  onChange(event);
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
}
let watcher = null;
let watchTimer = null;
const pending = new Set();
function startWatching() {
  try {
    watcher = fs.watch(PROJECT, { recursive: true }, (_evt, filename) => {
      if (!filename || filename.endsWith('.DS_Store') || filename.startsWith('.') || filename.startsWith('export/') || filename.endsWith('.tmp') || filename.endsWith('.studio-lock')) return;
      const full = path.join(PROJECT, filename);
      const signature = ownWrites.get(full);
      if (signature) { if (signatureOf(full) === signature) return; ownWrites.delete(full); } // still exactly what we wrote: not news
      const ours = recentWrites.get(full);
      if (ours && Date.now() - ours < 1500) return;
      pending.add(filename);
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        broadcast({ type: 'changed', files: [...pending] });
        pending.clear();
      }, 250);
    });
  } catch (err) {
    console.warn('File watching unavailable:', err.message);
  }
}

// ---------------------------------------------------------------------------
// export bookkeeping (used by the headless CLI)

const exportLog = { written: 0, warnings: [], errors: [], done: null };

// ---------------------------------------------------------------------------
// request handling

function allowedHost(req, port) {
  if (origin && req.headers.host === 'local') return true;
  const host = req.headers.host ?? '';
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
function allowedOrigin(req, port) {
  const requestOrigin = req.headers.origin;
  if (origin && requestOrigin === origin) return true;
  if (!requestOrigin) return true; // same-origin GETs and curl
  return requestOrigin === `http://127.0.0.1:${port}` || requestOrigin === `http://localhost:${port}`;
}

async function handle(req, res, port) {
  if (!allowedHost(req, port)) { res.writeHead(403); return res.end('Forbidden host'); }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD' && !allowedOrigin(req, port)) { res.writeHead(403); return res.end('Forbidden origin'); }

  // ----- API
  if (url.pathname.startsWith('/api/')) {
    try {
      return await api(req, res, url, method);
    } catch (err) {
      if (!err.status) console.error(err); // a mistake in the request (400, 413...) is not a server problem
      return json(res, err.status ?? 500, { error: String(err.message ?? err) });
    }
  }

  // ----- static
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') {
    // Redirect (rather than serve in place) so the page's relative css/js URLs resolve under /app/.
    res.writeHead(302, { location: `/app/index.html${url.search}` });
    return res.end();
  }
  const snapshot = /^\/snapshot\/([^/]+)\/(.*)$/.exec(rel);
  if (snapshot) {
    try { const run = sessions.get(snapshot[1]); const file = path.resolve(run.source, snapshot[2]);
      if (!file.startsWith(run.source + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.realpathSync(file).startsWith(fs.realpathSync(run.source) + path.sep)) throw new Error('Not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); return res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); return res.end('Not found'); }
  }
  const base = rel.startsWith('/project/') ? PROJECT : rel.startsWith('/app/') ? APP : null;
  if (!base) { res.writeHead(404); return res.end('Not found'); }
  const sub = rel.replace(/^\/(project|app)\//, '');
  let file = path.resolve(base, sub);
  let fileBase = base;
  const frame = /^assets\/frames\/([A-Za-z0-9][A-Za-z0-9._-]*\.png)$/.exec(sub);
  if (base === PROJECT && frame && !fs.existsSync(file) && frameLibraryPath && !frame[1].includes('..')) { fileBase = frameLibraryPath; file = path.join(fileBase, frame[1]); }
  if (!file.startsWith(fileBase + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(fileBase) + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    ...(ext === '.html' ? { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'" } : {}),
    // an SVG opened directly must never run scripts in the studio's origin
    ...(ext === '.svg' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
  });
  if (method === 'HEAD') return res.end();
  res.end(fs.readFileSync(file));
}

async function api(req, res, url, method) {
  const p = url.pathname;
  if (method !== 'GET' || p === '/api/project') rejectLinks(PROJECT);

  if (p === '/api/project' && method === 'GET') return json(res, 200, loadProjectBundle());
  if (p === '/api/fonts' && method === 'GET') return json(res, 200, await installedFonts());
  if (p === '/api/import/archive' && method === 'POST') return json(res, 200, readImportArchive(await readBody(req, 64 * 1024 * 1024)));
  if (['/api/translate', '/api/translate/models'].includes(p) && method === 'POST') {
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    try {
      const input = await readJSONBody(req, 192 * 1024);
      return json(res, 200, await (p.endsWith('/models') ? listTranslationModels : translateText)(input, { signal: req.signal ? AbortSignal.any([controller.signal, req.signal]) : controller.signal }));
    }
    finally { res.removeListener('close', cancel); }
  }

  if (p === '/api/events' && method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/studio' && method === 'PUT') {
    const body = await readJSONBody(req, 8 * 1024 * 1024);
    if (!body || typeof body !== 'object' || !Array.isArray(body.slides) || !body.devices || !Array.isArray(body.locales)) {
      return json(res, 400, { error: 'studio.json must have slides, devices and locales' });
    }
    validateDocument(body);
    const file = path.join(PROJECT, 'studio.json');
    const expected = req.headers['if-match'] ?? null;
    if (expected !== null && revision(file) !== expected) throw httpError(409, 'This file changed outside this window. Your edits are retained. Resolve the conflict before saving.');
    frameLibrary.retainUsed(body);
    writeProjectFile(file, prettyJSON(body), expected);
    return json(res, 200, { ok: true, revision: revision(file) });
  }

  let m;
  if ((m = p.match(/^\/api\/copy\/([^/]+)$/)) && method === 'PUT') {
    const locale = decodeURIComponent(m[1]);
    if (!safe(locale)) return json(res, 400, { error: 'bad locale' });
    const body = await readJSONBody(req, 4 * 1024 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'bad body' });
    // ?create=1: a new language. Never replace a file that is already there - on a case-insensitive disk "en-us" is "en-US".
    if (url.searchParams.get('create') === '1') {
      const copyDir = path.join(PROJECT, 'copy');
      const taken = fs.existsSync(copyDir) && fs.readdirSync(copyDir).some((f) => f.toLowerCase() === `${locale}.json`.toLowerCase());
      if (taken) return json(res, 409, { error: `${locale} already has a text file` });
    }
    const file = path.join(PROJECT, 'copy', `${locale}.json`);
    writeProjectFile(file, prettyJSON(body), req.headers['if-match'] ?? null);
    return json(res, 200, { ok: true, revision: revision(file) });
  }

  if (p === '/api/capture') {
    const scope = url.searchParams.get('scope');
    const device = url.searchParams.get('device');
    const name = url.searchParams.get('name');
    if (![scope, device, name].every(safe)) return json(res, 400, { error: 'bad capture address' });
    const file = path.join(PROJECT, 'captures', scope, device, `${name}.png`);
    if (method === 'POST') {
      const buf = await readBody(req);
      if (url.searchParams.get('create') === '1' && ['png', 'jpg', 'jpeg'].some(ext => fs.existsSync(file.replace(/\.png$/, `.${ext}`)))) return json(res, 409, { error: 'A screenshot with this name already exists. Import it again to choose a new name.' });
      if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return json(res, 400, { error: 'captures must be PNG files' });
      writeProjectFile(file, buf);
      return json(res, 200, { ok: true, bytes: buf.length });
    }
    if (method === 'DELETE') {
      if (url.searchParams.get('unused') === '1') {
        const bundle = loadProjectBundle();
        if (captureUsage(bundle.studio, bundle.captures, { scope, set: device, name }).length) return json(res, 409, { error: 'This screenshot is used in the project. Remove its references first.' });
      } else if (scope === 'default') return json(res, 400, { error: 'refusing to delete a default capture' });
      for (const ext of ['png', 'jpg', 'jpeg']) {
        const f = path.join(PROJECT, 'captures', scope, device, `${name}.${ext}`);
        if (fs.existsSync(f)) { archiveDelete(f); }
      }
      // tidy up folders that are now empty (stops at captures/)
      const capturesDir = path.join(PROJECT, 'captures');
      for (let dir = path.join(capturesDir, scope, device); dir !== capturesDir && dir.startsWith(capturesDir); dir = path.dirname(dir)) {
        try { fs.rmdirSync(dir); } catch { break; }
      }
      return json(res, 200, { ok: true });
    }
  }

  // ----- images used as layers (project/assets/art)
  if (p === '/api/asset') {
    if (method === 'POST') {
      const buf = await readBody(req, 64 * 1024 * 1024);
      const ext = detectImageExt(buf);
      if (!ext) return json(res, 400, { error: 'Unsupported image. Use PNG, JPEG, WebP, GIF or SVG (SVGs with scripts are refused).' });
      const base = slug(path.parse(url.searchParams.get('name') ?? '').name) || 'image';
      const file = `${base}-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 6)}.${ext}`;
      const dest = path.join(PROJECT, 'assets', 'art', file);
      if (!fs.existsSync(dest)) writeProjectFile(dest, buf);
      return json(res, 200, { ok: true, file, bytes: buf.length });
    }
    if (method === 'DELETE') {
      const name = url.searchParams.get('name');
      if (!safe(name)) return json(res, 400, { error: 'bad asset name' });
      if (imageUsage(loadProjectBundle().studio, name).length) return json(res, 409, { error: 'This image is used in the project. Remove its references first.' });
      const file = path.join(PROJECT, 'assets', 'art', name);
      if (fs.existsSync(file)) { archiveDelete(file); }
      return json(res, 200, { ok: true });
    }
  }

  // ----- device frames (project/assets/frames/<name>.png + <name>.json)
  if (p === '/api/frame' || p === '/api/frame-meta') {
    const name = url.searchParams.get('name');
    if (!safe(name)) return json(res, 400, { error: 'bad frame name' });
    const frameRoot = frameLibrary.writeRoot(name);
    const png = path.join(frameRoot, `${name}.png`);
    const meta = path.join(frameRoot, `${name}.json`);
    assertInside(frameRoot, png); assertInside(frameRoot, meta);
    const writeFrame = (file, data) => {
      atomicWrite(file, data, { backupRoot: frameRoot });
      const local = path.join(PROJECT, 'assets', 'frames', path.basename(file));
      if (frameRoot !== frameLibrary.project && fs.existsSync(local)) writeProjectFile(local, data);
    };
    if (p === '/api/frame' && method === 'POST') {
      const buf = await readBody(req, 64 * 1024 * 1024);
      if (buf.length < 33 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buf.subarray(12, 16).toString() !== 'IHDR') return json(res, 400, { error: 'frames must be PNG files' });
      const [pw, ph] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
      if (!(pw >= 16 && ph >= 16 && pw <= 20000 && ph <= 20000)) return json(res, 400, { error: `that PNG is ${pw} × ${ph}px: not a plausible device frame` });
      // a frame that is already there is only replaced on purpose (the editor's "Replace image…"), never by a name clash
      if (fs.existsSync(png) && url.searchParams.get('replace') !== '1') return json(res, 409, { error: `a frame called “${name}” already exists` });
      writeFrame(png, buf);
      return json(res, 200, { ok: true, bytes: buf.length });
    }
    if (p === '/api/frame-meta' && method === 'PUT') {
      const body = await readJSONBody(req, 1024 * 1024);
      const num = (n) => typeof n === 'number' && Number.isFinite(n);
      const okRect = (r) => r && typeof r === 'object' && [r.x, r.y, r.w, r.h].every(num) && r.w > 0 && r.h > 0;
      const okRadius = (r) => r === undefined || (num(r) && r >= 0) || (Array.isArray(r) && r.length === 4 && r.every((v) => num(v) && v >= 0));
      if (!body || typeof body !== 'object' || !Array.isArray(body.size) || body.size.length !== 2 || !body.size.every((n) => num(n) && n > 0) || !okRect(body.screen)
        || !okRadius(body.screen.radius) || (body.screen.mode !== undefined && !['hole', 'overlay'].includes(body.screen.mode))) {
        return json(res, 400, { error: 'frame metadata needs size [w, h], screen {x, y, w, h} (optional radius, mode "hole" or "overlay")' });
      }
      writeFrame(meta, prettyJSON(body));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/frame' && method === 'DELETE') {
      for (const f of [png, meta]) {
        if (frameRoot === frameLibrary.project) archiveDelete(f);
        else { if (fs.existsSync(f)) { atomicWrite(path.join(frameRoot, '.history', `${Date.now()}-${crypto.randomUUID()}-${path.basename(f)}`), fs.readFileSync(f)); fs.unlinkSync(f); } archiveDelete(path.join(frameLibrary.project, path.basename(f))); }
      }
      return json(res, 200, { ok: true });
    }
  }

  // ----- taking a language out of the project (kept in project/_removed so nothing is lost)
  if (p === '/api/locale/remove' && method === 'POST') {
    const id = url.searchParams.get('id');
    if (!safe(id) || id === 'default') return json(res, 400, { error: 'bad locale' });
    const folder = `${id}__${new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')}`;
    const dest = path.join(PROJECT, '_removed', folder);
    const copyFile = path.join(PROJECT, 'copy', `${id}.json`);
    const captureDir = path.join(PROJECT, 'captures', id);
    // read and check everything first, so a bad request cannot leave a language half moved
    const entryText = (await readBody(req, 1024 * 1024)).toString('utf8').trim();
    let entry = null;
    if (entryText) { try { entry = JSON.parse(entryText); } catch { throw httpError(400, 'the language entry is not valid JSON'); } }
    const moves = [];
    try {
      if (fs.existsSync(copyFile)) { moveFile(copyFile, path.join(dest, 'copy.json')); moves.push([path.join(dest, 'copy.json'), copyFile]); }
      if (fs.existsSync(captureDir)) { moveFile(captureDir, path.join(dest, 'captures')); moves.push([path.join(dest, 'captures'), captureDir]); }
      fs.mkdirSync(dest, { recursive: true });
      // the language's entry from studio.json (name, font, direction...) travels with it, so a restore is complete
      if (entry) writeProjectFile(path.join(dest, 'locale.json'), prettyJSON(entry));
    } catch (err) {
      for (const [from, to] of moves.reverse()) { try { moveFile(from, to); } catch { /* best effort */ } } // put back what was already moved
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
      throw err;
    }
    return json(res, 200, { ok: true, folder });
  }
  if (p === '/api/locale/restore' && method === 'POST') {
    const folder = url.searchParams.get('folder') ?? '';
    if (!REMOVED_FOLDER.test(folder)) return json(res, 400, { error: 'bad folder' });
    const id = removedFolderId(folder);
    if (!safe(id)) return json(res, 400, { error: 'bad folder' });
    const from = path.join(PROJECT, '_removed', folder);
    if (!fs.existsSync(from)) return json(res, 404, { error: 'nothing to restore' });
    const copyFile = path.join(PROJECT, 'copy', `${id}.json`);
    const captureDir = path.join(PROJECT, 'captures', id);
    if (fs.existsSync(copyFile) || fs.existsSync(captureDir)) return json(res, 409, { error: `${id} already exists in the project` });
    const entry = readJSON(path.join(from, 'locale.json'), null);
    const moves = [];
    try {
      if (fs.existsSync(path.join(from, 'copy.json'))) { moveFile(path.join(from, 'copy.json'), copyFile); moves.push([copyFile, path.join(from, 'copy.json')]); }
      if (fs.existsSync(path.join(from, 'captures'))) { moveFile(path.join(from, 'captures'), captureDir); moves.push([captureDir, path.join(from, 'captures')]); }
    } catch (err) {
      for (const [src, dst] of moves.reverse()) { try { moveFile(src, dst); } catch { /* best effort */ } }
      throw err;
    }
    if (fs.existsSync(path.join(from, 'locale.json'))) { noteOwnWrite(path.join(from, 'locale.json')); fs.unlinkSync(path.join(from, 'locale.json')); }
    try { fs.rmdirSync(from); } catch { /* not empty: leave it */ }
    return json(res, 200, { ok: true, id, entry });
  }

  if (p === '/api/export/start' && method === 'POST') {
    const { mode, selection, destination } = await readJSONBody(req);
    if (!['draft', 'final'].includes(mode)) throw httpError(400, 'Invalid export mode');
    let output = EXPORT;
    if (destination !== undefined) {
      if (typeof destination !== 'string' || !exportDestinations.has(destination)) throw httpError(400, 'Choose the export folder again.');
      output = exportDestinations.get(destination); exportDestinations.delete(destination);
    }
    frameLibrary.retainUsed(loadProjectBundle().studio);
    const run = sessions.start(mode, selection, output);
    const snapshot = createStudioService({ appPath: APP, projectPath: run.source, exportPath: path.join(run.temp, 'unused') });
    try {
      return json(res, 200, { id: run.id, bundle: snapshot.loadProjectBundle(), projectURL: `/snapshot/${run.id}` });
    }
    catch (error) { sessions.abort(run.id); throw error; }
  }
  if (p === '/api/export/finish' && method === 'POST') {
    const { id, report } = await readJSONBody(req);
    latestExport = sessions.finish(id, report);
    completedExports.add(latestExport);
    return json(res, 200, { path: latestExport, relative: path.relative(EXPORT, latestExport) });
  }
  if (p === '/api/export/abort' && method === 'POST') { const { id } = await readJSONBody(req); sessions.abort(id); return json(res, 200, { ok: true }); }
  if (p === '/api/export' && method === 'POST') {
    const locale = url.searchParams.get('locale');
    const device = url.searchParams.get('device');
    const name = url.searchParams.get('file');
    const width = Number(url.searchParams.get('width'));
    const height = Number(url.searchParams.get('height'));
    if (![locale, device, name].every(safe) || ![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 12000)) return json(res, 400, { error: 'bad export address' });
    const buf = await readBody(req, 12000 * 12000 * 4);
    if (buf.length !== width * height * 4) return json(res, 400, { error: `expected ${width * height * 4} RGBA bytes, got ${buf.length}` });
    const png = encodePNG({ width, height, data: buf, channels: 3 }); // RGB: App Store Connect rejects alpha
    const id = url.searchParams.get('session');
    const out = `${locale}/${device}/${name}.png`;
    const file = sessions.write(id, out, png, [width, height]);
    exportLog.written++;
    return json(res, 200, { ok: true, path: file.path, bytes: png.length });
  }

  if (p === '/api/export-runs' && method === 'GET') return json(res, 200, { runs: savedExportRuns() });
  if (p === '/api/export-preview' && method === 'GET') {
    const root = path.resolve(PROJECT, 'export', url.searchParams.get('run') ?? '');
    if (!savedExportRuns().some(run => run.path === root)) throw httpError(404, 'Export not found.');
    const manifest = readJSON(path.join(root, 'manifest.json'), null);
    const file = exportPreviews(manifest.files, Infinity).images.find(file => file.path === url.searchParams.get('file'));
    if (!file) throw httpError(404, 'Preview not found.');
    const bytes = readExportImage(root, file);
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    return res.end(createThumbnail ? createThumbnail(bytes) : bytes);
  }
  if (p === '/api/exports' && method === 'GET') return json(res, 200, { dir: EXPORT, files: listExports() });

  if (p === '/api/reveal' && method === 'POST') {
    const rel = url.searchParams.get('path');
    const target = rel === null ? latestExport : path.resolve(EXPORT, rel);
    if (rel !== null && target !== EXPORT && !target.startsWith(EXPORT + path.sep)) return json(res, 400, { error: 'bad path' });
    if (target === EXPORT) fs.mkdirSync(EXPORT, { recursive: true });
    execFile('open', target !== EXPORT && fs.existsSync(target) ? ['-R', target] : [EXPORT]);
    return json(res, 200, { ok: true });
  }

  // headless export reporting
  if (p === '/api/export-log' && method === 'POST') {
    const body = await readJSONBody(req, 1024 * 1024);
    if (body.warning) exportLog.warnings.push(body.warning);
    if (body.error) exportLog.errors.push(body.error);
    if (body.line) onExportLog(body.line);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/export-done' && method === 'POST') {
    const body = await readJSONBody(req);
    if (body.inspection) exportLog.inspection = body.inspection;
    exportLog.done = true;
    if (typeof exportLog.resolve === 'function') exportLog.resolve();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'unknown endpoint' });
}


async function request(request) {
  const url = new URL(request.url);
  if (url.host !== 'local') return new Response('Forbidden', { status: 403 });
  const req = Readable.from(request.body ? [Buffer.from(await request.arrayBuffer())] : []);
  req.method = request.method; req.url = url.pathname + url.search;
  req.signal = request.signal;
  req.headers = Object.fromEntries(request.headers); req.headers.host = 'local';
  let status = 200, headers = {}, chunks = [];
  const res = Object.assign(new EventEmitter(), { writableEnded: false, writeHead(code, h = {}) { status = code; headers = h; }, write(data) { chunks.push(Buffer.from(data)); }, end(data) { if (data) chunks.push(Buffer.from(data)); this.writableEnded = true; } });
  const cancel = () => res.emit('close');
  request.signal.addEventListener('abort', cancel, { once: true });
  try { await handle(req, res, 0); } catch (error) { return new Response(error.message, { status: 500 }); }
  finally { request.signal.removeEventListener('abort', cancel); }
  return new Response(request.method === 'HEAD' ? null : Buffer.concat(chunks), { status, headers });
}
return { handle, request, uploadExportPath, retainSavedExport, authorizeExportDestination, loadProjectBundle, startWatching, exportLog, close() { exportDestinations.clear(); sessions.close(); watcher?.close(); clearTimeout(watchTimer); for (const c of clients) c.end(); } };
}
