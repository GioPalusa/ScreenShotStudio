import { orderedSlides, phoneCanvasId } from './slide-order.js';
import { frameReferences, replaceFrameReferences } from './frame-ops.js';
import { localeNeedsReview, setFieldReview, setSlideReviewed } from './copy-review.js';
import { ensureReviewIdentity, applyReviewImport } from './review-exchange.js';
import { translatedCopies } from './translation.js';
import { applyExternalImport } from './external-import.js';
import { imageUsage } from './media.js';
// Shared state + talking to the local server. Plain JSON files on disk are the source of truth;
// the browser edits them through this module (debounced autosave) and reloads when they change.

import { Engine } from './render.js';
import { SaveQueue } from './save-queue.js';
import { duplicateLayers, templateUsage } from './layer-ops.js';

export const engine = new Engine();
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => { bus.addEventListener(type, (e) => fn(e.detail)); };

export const state = {
  exports: [],
  removedLocales: [],
  ui: { view: 'editor', locale: 'en-US', device: 'iphone', slideId: null, tab: 'details', captureScope: 'all', setupTab: 'devices', showNeighbors: true, neighborOpacity: 70 },
  saving: 0,
  saveFailed: false,
  lastSaved: null,
  serverApi: 2,
};

const UI_KEY = 'mmd-studio-ui-v1';
export function restoreUI() {
  try { Object.assign(state.ui, JSON.parse(localStorage.getItem(UI_KEY) ?? '{}')); } catch { /* private mode etc. */ }
}
export function rememberUI() {
  try { localStorage.setItem(UI_KEY, JSON.stringify(state.ui)); } catch { /* ignore */ }
}

export async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).error ?? message; } catch { /* not json */ }
    throw Object.assign(new Error(message), { status: res.status });
  }
  return res.json();
}

function applyBundle(bundle) {
  state.projectId = bundle.projectId ?? 'legacy';
  state.projectName = bundle.name ?? 'Screenshot Studio';
  state.revisions = bundle.revisions ?? {};
  state.recovery = readRecovery();
  engine.setData({ studio: bundle.studio, copy: bundle.copy, frames: bundle.frames, captures: bundle.captures, assets: bundle.assets ?? { art: [] } });
  state.exports = bundle.exports;
  state.removedLocales = bundle.removed ?? [];
  state.serverApi = bundle.api ?? 1;
}

/** Keep the current selection pointing at things that exist. */
export function validateSelection() {
  const { studio } = engine.data;
  const ui = state.ui;
  if (!studio.locales.some((l) => l.id === ui.locale)) ui.locale = studio.locales[0]?.id ?? 'en-US';
  if (!studio.devices[ui.device]) ui.device = Object.keys(studio.devices)[0];
  if (studio.devices[ui.device]?.screenScope !== 'store-image') ui.screenshotDevice = ui.device;
  if (!studio.devices[ui.screenshotDevice] || studio.devices[ui.screenshotDevice].screenScope === 'store-image') ui.screenshotDevice = Object.keys(studio.devices).find(id => studio.devices[id].screenScope !== 'store-image');
  ui.phoneDevice = phoneCanvasId(studio, ui.device, ui.phoneDevice);
  if (ui.allScreens && ui.device !== ui.phoneDevice) ui.allScreens = false;
  const slides = orderedSlides(studio, ui.locale, ui.device);
  if (!slides.some(s => s.id === ui.slideId)) ui.slideId = slides[0]?.id ?? null;
}

export async function loadAll() {
  const bundle = await api('/api/project');
  applyBundle(bundle);
  engine.invalidate();
  validateSelection();
  return bundle;
}

/** Re-read files that changed on the server side (new uploads, frames, ...) without touching unsaved studio edits. */
export async function refreshData(parts = ['captures', 'assets', 'frames']) {
  const bundle = await api('/api/project');
  for (const part of parts) {
    if (part === 'removed') state.removedLocales = bundle.removed ?? [];
    else engine.data[part] = bundle[part];
  }
  engine.invalidate({ assets: parts.includes('assets') || parts.includes('frames') });
  emit('data-changed', { parts });
}

// ---------------------------------------------------------------------------------------------
// autosave
//
// Every save is a function of `extra` (fetch options) so it can also be sent with `keepalive` when the page is closing.

const recoveryKey = () => `studio-recovery:${state.projectId}`;
function readRecovery() { try { return JSON.parse(localStorage.getItem(recoveryKey()) ?? '[]'); } catch { return []; } }
export const saves = new SaveQueue({
  async write(key, data, options) {
    const url = key === 'studio' ? '/api/studio' : `/api/copy/${encodeURIComponent(key.slice(5))}`;
    const result = await api(url, { method: 'PUT', headers: { 'content-type': 'application/json', ...(state.revisions?.[key] ? { 'if-match': state.revisions[key] } : {}) }, body: JSON.stringify(data), ...options });
    if (result.revision) state.revisions[key] = result.revision;
  },
  changed(status) {
    Object.assign(state, { saving: status.saving, saveFailed: status.failed, lastSaved: status.lastSaved });
    emit('saving', status);
    if (!saves.dirty) flushQueuedReload();
  },
  persist(entries) {
    try {
      if (entries.length) localStorage.setItem(recoveryKey(), JSON.stringify(entries.map(e => ({ ...e, revision: state.revisions?.[e.key] }))));
      else localStorage.removeItem(recoveryKey());
    } catch (error) { emit('error', new Error(`Recovery copy could not be stored: ${error.message}`)); }
  },
});
export function saveCopy(locale) { saves.enqueue(`copy:${locale}`, engine.data.copy[locale]); }
export function saveStudio() { saves.enqueue('studio', engine.data.studio); }
export const hasPendingSaves = () => saves.dirty;
export const flushSaves = (options = {}) => saves.flush(options);
export async function retrySaves() { await saves.flush(); }
export function recoverEdits() {
  for (const entry of state.recovery ?? []) {
    if (entry.key === 'studio') engine.data.studio = entry.data;
    else engine.data.copy[entry.key.slice(5)] = entry.data;
    state.revisions[entry.key] = entry.revision ?? 'missing';
    saves.enqueue(entry.key, entry.data);
  }
  state.recovery = []; engine.invalidate(); validateSelection(); emit('restored');
}
export async function resolveSaveConflict(keepMine) {
  const bundle = await api('/api/project');
  if (keepMine) { state.revisions = bundle.revisions; await saves.flush(); }
  else { saves.discard(); applyBundle(bundle); engine.invalidate(); clearHistory(); validateSelection(); emit('restored'); }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', event => { if (saves.dirty && !window.studioDesktop) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushSaves({ keepalive: true }).catch(() => {}); });
  window.addEventListener('online', () => { void retrySaves().catch(() => {}); });
}

// ---------------------------------------------------------------------------------------------
// undo / redo of layout work (slides, templates, devices, colours, decorations)
//
// Call checkpoint() *before* changing any of those. Edits that arrive as a stream (dragging, a slider)
// pass the same key and are folded into one undo step; keys are scoped to the slide and device being edited.
// Removing or duplicating a slide also changes its text: pass `copySlides: [slideId]` and that text is part of the step.

const HISTORY_KEYS = ['sourceLocale', 'sharedCanvas', 'slides', 'templates', 'devices', 'profiles', 'removedProfiles', 'themes', 'panorama'];
const history = { past: [], future: [], lastKey: null, lastAt: 0, seq: 0 };

function snapshot(copySlides = [], copyLocales = []) {
  const snap = structuredClone(Object.fromEntries(HISTORY_KEYS.map((k) => [k, engine.project[k]])));
  if (copySlides.length) {
    snap.copySlides = copySlides;
    snap.copy = Object.fromEntries(Object.entries(engine.data.copy).map(([loc, doc]) => [loc, Object.fromEntries(copySlides.map((id) => [id, doc[id] === undefined ? null : structuredClone(doc[id])]))]));
    snap.copyReview = Object.fromEntries(Object.entries(engine.data.copy).map(([loc, doc]) => [loc, (doc._meta?.needsReview ?? []).filter(key => reviewBelongsTo(key, copySlides))]));
  }
  if (copyLocales.length) {
    snap.copyLocales = copyLocales;
    snap.copyDocuments = Object.fromEntries(copyLocales.map(locale => [locale, structuredClone(engine.data.copy[locale] ?? null)]));
  }
  return snap;
}
const announceHistory = () => emit('history', { canUndo: history.past.length > 0, canRedo: history.future.length > 0 });
const reviewBelongsTo = (key, slides) => slides.some(id => key === id || key.startsWith(`${id}.`));

/** Returns a token for the step (see undoIf). */
export function checkpoint(key = null, { copySlides = [], copyLocales = [] } = {}) {
  const now = Date.now();
  const scoped = key === null ? null : `${state.ui.slideId}|${state.ui.device}|${state.ui.locale}|${key}`;
  if (scoped !== null && scoped === history.lastKey && now - history.lastAt < 1500) { history.lastAt = now; return history.past.at(-1)?.token; }
  const snap = snapshot(copySlides, copyLocales);
  snap.token = ++history.seq;
  history.past.push(snap);
  if (history.past.length > 150) history.past.shift();
  history.future.length = 0;
  history.lastKey = scoped;
  history.lastAt = now;
  announceHistory();
  return snap.token;
}

function restore(snap) {
  for (const k of HISTORY_KEYS) {
    if (snap[k] === undefined) delete engine.project[k]; else engine.project[k] = snap[k];
  }
  if (snap.copy) {
    for (const [loc, slides] of Object.entries(snap.copy)) {
      const doc = engine.data.copy[loc];
      if (!doc) continue;
      let changed = false;
      for (const [id, value] of Object.entries(slides)) {
        if (JSON.stringify(doc[id] ?? null) === JSON.stringify(value)) continue;
        changed = true;
        if (value === null) delete doc[id]; else doc[id] = structuredClone(value);
      }
      if (doc._meta && snap.copyReview) {
        // An undo for one slide must not clear review flags from later edits on another slide.
        const pending = doc._meta.needsReview ?? [];
        const restored = [...new Set([...pending.filter(key => !reviewBelongsTo(key, snap.copySlides)), ...(snap.copyReview[loc] ?? [])])];
        if (JSON.stringify(pending) !== JSON.stringify(restored)) { doc._meta.needsReview = restored; changed = true; }
      }
      if (changed) saveCopy(loc);
    }
  }
  for (const [locale, doc] of Object.entries(snap.copyDocuments ?? {})) {
    if (doc === null) delete engine.data.copy[locale]; else engine.data.copy[locale] = structuredClone(doc);
    // A locale without a previous document still needs a persisted empty draft on undo.
    engine.data.copy[locale] ??= { _meta: { status: 'draft', needsReview: ['*'] } };
    saveCopy(locale);
  }
  history.lastKey = null;
  validateSelection();
  saveStudio();
  announceHistory();
  emit('restored');
}

export function undo() {
  if (!history.past.length) return false;
  const snap = history.past.pop();
  const redoSnap = snapshot(snap.copySlides ?? [], snap.copyLocales ?? []);
  redoSnap.token = snap.token;
  history.future.push(redoSnap);
  restore(snap);
  return true;
}

export function redo() {
  if (!history.future.length) return false;
  const snap = history.future.pop();
  const undoSnap = snapshot(snap.copySlides ?? [], snap.copyLocales ?? []);
  undoSnap.token = snap.token;
  history.past.push(undoSnap);
  restore(snap);
  return true;
}

/** Undo only if `token`'s step is still the latest one: for "Undo" buttons in messages, which must not undo something newer. */
export function undoIf(token) {
  if (history.past.at(-1)?.token !== token) return false;
  return undo();
}

export const canUndo = () => history.past.length > 0;
export const canRedo = () => history.future.length > 0;
export function clearHistory() { history.past.length = 0; history.future.length = 0; history.lastKey = null; announceHistory(); }

/** Both duplicate commands share one undo step and save all affected translations. */
export function duplicateEditorLayers(block, layers, resolved, { slideId, templateId = null }) {
  const slideIds = [...new Set([slideId, ...(templateId ? templateUsage(engine.project, templateId) : [])])];
  checkpoint(null, { copySlides: slideIds });
  const result = duplicateLayers(block, layers, resolved, engine.data.copy, slideIds);
  for (const locale of result.changedLocales) saveCopy(locale);
  saveStudio();
  return result.layers;
}

// ---------------------------------------------------------------------------------------------
// copy helpers

export function getCopy(locale, slideId, field) {
  return engine.data.copy[locale]?.[slideId]?.[field];
}

export function editCopy(locale, slideId, field, value) {
  checkpoint(`copy:${locale}:${slideId}:${field}`, { copyLocales: [locale] });
  setCopy(locale, slideId, field, value);
}

export function setCopy(locale, slideId, field, value) {
  const doc = (engine.data.copy[locale] ??= { _meta: { status: 'draft', needsReview: ['*'] } });
  const slide = (doc[slideId] ??= {});
  const blank = value === undefined || value === '' || (Array.isArray(value) && value.every((v) => !v));
  if (blank) delete slide[field]; else slide[field] = value;
  if (doc._meta?.status === 'approved' || doc._meta?.reviewMode === 'fields') {
    // Editing an approved translation: remember what changed so a reviewer can find it.
    const key = `${slideId}.${field}`;
    const list = new Set(doc._meta.needsReview ?? []);
    list.add(key);
    doc._meta.needsReview = [...list];
  }
  saveCopy(locale);
  emit('copy-changed', { locale, slideId, field });
}

export function markReviewed(locale) {
  const doc = engine.data.copy[locale];
  if (!doc) return;
  checkpoint(null, { copyLocales: [locale] });
  doc._meta = { ...(doc._meta ?? {}), status: 'approved', needsReview: [] };
  saveCopy(locale);
  emit('copy-changed', { locale });
}

export const needsReview = (locale, slideId = null, field = null) => localeNeedsReview(engine.project, engine.data.copy, locale, slideId, field);

export function markSlideReviewed(locale, slideId) {
  checkpoint(null, { copyLocales: [locale] });
  setSlideReviewed(engine.project, engine.data.copy, locale, slideId);
  saveCopy(locale);
  emit('copy-changed', { locale, slideId });
}

export function setOriginalLocale(locale) {
  if (!engine.project.locales.some(l => l.id === locale)) return;
  checkpoint();
  engine.project.sourceLocale = locale;
  saveStudio();
  engine.invalidate({ assets: false });
}

export function setTextCheck(locale, slideId, field, pending) {
  checkpoint(null, { copyLocales: [locale] });
  setFieldReview(engine.project, engine.data.copy, locale, slideId, field, pending);
  saveCopy(locale);
  emit('copy-changed', { locale, slideId, field });
}

export async function prepareReviewExport() {
  if (ensureReviewIdentity(engine.project, () => crypto.randomUUID())) {
    // Review identities are document identity, not an undoable design edit.
    const ids = new Map(engine.project.slides.map(slide => [slide.id, slide.reviewId]));
    for (const snap of [...history.past, ...history.future]) for (const slide of snap.slides ?? []) {
      if (!slide.reviewId && ids.has(slide.id)) slide.reviewId = ids.get(slide.id);
    }
    saveStudio();
  }
  await flushSaves();
}

export function importReviewedCopy(rows, selected) {
  const result = applyReviewImport(engine.project, engine.data.copy, rows, selected);
  if (!result.locales.length) return;
  checkpoint(null, { copyLocales: result.locales });
  for (const locale of result.locales) { engine.data.copy[locale] = result.copy[locale]; saveCopy(locale); }
  emit('restored');
}

export function applyTranslation(plan, result) {
  applyTranslations([{ plan, result }]);
}

export function applyTranslations(results) {
  const docs = translatedCopies(engine.project, engine.data.copy, results);
  const locales = Object.keys(docs);
  if (!locales.length) return;
  checkpoint(null, { copyLocales: locales });
  for (const locale of locales) { engine.data.copy[locale] = docs[locale]; saveCopy(locale); }
  emit('restored');
}

export function importExternalDesigns(rows, options) {
  const result = applyExternalImport(engine.project, engine.data.copy, rows, options);
  checkpoint(null, { copyLocales: result.locales });
  Object.assign(engine.project, result.project);
  for (const locale of result.locales) { engine.data.copy[locale] = result.copy[locale]; saveCopy(locale); }
  saveStudio(); emit('restored');
  return result;
}

// ---------------------------------------------------------------------------------------------
// captures

export async function uploadCapture({ scope, device, name, blob, create = false }) {
  const q = new URLSearchParams({ scope, device, name, ...(create ? { create: '1' } : {}) });
  await api(`/api/capture?${q}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: blob });
  await refreshCaptures();
}

export async function removeCapture({ scope, device, name, unusedOnly = false }) {
  if (unusedOnly) await flushSaves();
  const q = new URLSearchParams({ scope, device, name, ...(unusedOnly ? { unused: '1' } : {}) });
  await api(`/api/capture?${q}`, { method: 'DELETE' });
  await refreshCaptures();
}

export async function refreshCaptures() {
  await refreshData(['captures']);
  emit('captures-changed');
}

/** Any image the browser can decode -> PNG blob (captures are stored as PNG). */
export async function toPNG(fileOrBlob) {
  const bitmap = await createImageBitmap(fileOrBlob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { blob, width: bitmap.width, height: bitmap.height };
}

// ---------------------------------------------------------------------------------------------
// images used as layers

/** Upload an image file for use as a layer. Returns { file } - the name to store as the layer's `src`. */
export async function uploadAsset(file) {
  const q = new URLSearchParams({ name: file.name || 'image' });
  const res = await api(`/api/asset?${q}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
  await refreshData(['assets']);
  return res;
}

export async function deleteAsset(name) {
  await flushSaves();
  if (assetUsage(name).length) throw new Error('This image is still used in the project. Remove its layer references before deleting it.');
  await api(`/api/asset?${new URLSearchParams({ name })}`, { method: 'DELETE' });
  await refreshData(['assets']);
}

/** Where a project image is used: [{ slideId, deviceKey, layerId }] - scans layouts and templates. */
export const assetUsage = file => imageUsage(engine.project, file);

// ---------------------------------------------------------------------------------------------
// frames

/** Save a bezel: its PNG (when new or replaced) and its metadata (screen rectangle, radius, ...). */
export async function saveFrame({ name, png = null, meta, replace = false }) {
  if (png) await api(`/api/frame?${new URLSearchParams({ name, ...(replace ? { replace: '1' } : {}) })}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
  await api(`/api/frame-meta?${new URLSearchParams({ name })}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(meta) });
  await refreshData(['frames', 'assets']);
}

export async function deleteFrame(name) {
  await flushSaves();
  const frames = engine.data.frames;
  if (frameUsage(name).length) {
    checkpoint();
    replaceFrameReferences(engine.project, name, frames);
    saveStudio();
    // Never delete the artwork until replacement references are acknowledged on disk.
    await flushSaves();
  }
  await api(`/api/frame?${new URLSearchParams({ name })}`, { method: 'DELETE' });
  // Layout undo must not bring back references to artwork that no longer exists.
  for (const snap of [...history.past, ...history.future]) replaceFrameReferences(snap, name, frames);
  await refreshData(['frames', 'assets']);
  engine.invalidate();
}

/** Every place a frame is chosen, including automatically selected hardware profiles. */
export const frameUsage = name => frameReferences(engine.project, name, engine.data.frames);

// ---------------------------------------------------------------------------------------------
// languages

/**
 * Add a language. `entry` is the studio.json locale ({ id, name, native, lang, dir, appUI, font? }).
 * With `prefillFrom`, its text is copied in as a starting point; otherwise the language starts empty and
 * shows (flagged) English until it is translated.
 */
export async function addLocale(entry, { prefillFrom = null } = {}) {
  const project = engine.project;
  const lower = entry.id.toLowerCase();
  if (project.locales.some((l) => l.id.toLowerCase() === lower) || Object.keys(engine.data.copy).some((k) => k.toLowerCase() === lower)) throw new Error(`${entry.id} is already in the project`);
  const doc = { _meta: { status: 'draft', needsReview: ['*'], source: prefillFrom ? `starts as a copy of ${prefillFrom}: translate it` : 'new language: not translated yet' } };
  if (prefillFrom) {
    for (const slide of project.slides) {
      const src = engine.data.copy[prefillFrom]?.[slide.id];
      if (src) doc[slide.id] = structuredClone(src);
    }
  }
  const created = await api(`/api/copy/${encodeURIComponent(entry.id)}?create=1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) }); // create=1: the server refuses to replace a file
  state.revisions[`copy:${entry.id}`] = created.revision;
  engine.data.copy[entry.id] = doc;
  project.locales.push(entry);
  saveStudio();
  emit('locales-changed');
}

/** Take a language out of the project. Its files are moved to project/_removed/ - see restoreLocale(). */
export async function removeLocale(id) {
  await flushSaves();
  const project = engine.project;
  const index = project.locales.findIndex((l) => l.id === id);
  if (index < 0) throw new Error(`${id} is not in the project`);
  if (id === 'en-US') throw new Error('English (US) is the source language: it supplies the text any other language is missing, so it stays.');
  if (project.locales.length <= 1) throw new Error('A project needs at least one language.');
  const entry = project.locales[index];
  const res = await api(`/api/locale/remove?${new URLSearchParams({ id })}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry) });
  project.locales.splice(index, 1);
  delete engine.data.copy[id];
  delete engine.data.captures[id];
  validateSelection();
  saveStudio();
  await refreshData(['removed', 'captures']);
  emit('locales-changed');
  return { folder: res.folder, entry, index };
}

/** Bring a removed language back (from the folder removeLocale returned, or one listed in state.removedLocales). */
export async function restoreLocale(folder, { entry = null, index = null } = {}) {
  const res = await api(`/api/locale/restore?${new URLSearchParams({ folder })}`, { method: 'POST' });
  const restored = entry ?? res.entry;
  if (!restored) throw new Error(`The files for ${res.id} were restored, but its settings were not saved. Add the language again to finish.`);
  const project = engine.project;
  if (!project.locales.some((l) => l.id === restored.id)) {
    if (index !== null && index <= project.locales.length) project.locales.splice(index, 0, restored); else project.locales.push(restored);
  }
  const bundle = await api('/api/project');
  state.revisions[`copy:${restored.id}`] = bundle.revisions[`copy:${restored.id}`];
  engine.data.copy[restored.id] = bundle.copy[restored.id];
  engine.data.captures = bundle.captures;
  state.removedLocales = bundle.removed ?? [];
  engine.invalidate({ assets: false });
  saveStudio();
  emit('locales-changed');
  return restored;
}

// ---------------------------------------------------------------------------------------------
// live reload: the server tells us which files changed outside the studio

let queuedChanges = [];
let reloading = false;

/** Take over what changed on disk. Only a changed studio.json replaces the project (and clears undo); text and images are merged in. */
function applyExternalChanges(files, bundle) {
  if (files.includes('studio.json')) {
    applyBundle(bundle);
    engine.invalidate();
    validateSelection();
    clearHistory(); // the data was replaced from outside: older snapshots no longer apply
    emit('reloaded', { files });
    return;
  }
  for (const f of files) {
    const m = /^copy\/([^/]+)\.json$/.exec(f);
    if (!m) continue;
    state.revisions[`copy:${m[1]}`] = bundle.revisions[`copy:${m[1]}`] ?? 'missing';
    if (bundle.copy[m[1]]) engine.data.copy[m[1]] = bundle.copy[m[1]]; else delete engine.data.copy[m[1]];
  }
  engine.data.captures = bundle.captures;
  engine.data.assets = bundle.assets ?? { art: [] };
  engine.data.frames = bundle.frames;
  state.removedLocales = bundle.removed ?? [];
  state.exports = bundle.exports;
  engine.invalidate({ assets: files.some((f) => f.startsWith('assets/')) });
  emit('reloaded', { files });
}

/** Changes that arrived while saves were pending are applied once those saves have landed. */
async function flushQueuedReload() {
  if (reloading || !queuedChanges.length || hasPendingSaves()) return;
  const files = [...new Set(queuedChanges)];
  queuedChanges = [];
  const generation = saves.generation;
  reloading = true;
  let failed = false;
  try {
    const bundle = await api('/api/project');
    // Even an edit already acknowledged during this fetch makes its snapshot stale.
    // Keep both the local data and its revisions until a fresh read can be applied.
    if (hasPendingSaves() || generation !== saves.generation) queuedChanges.push(...files);
    else applyExternalChanges(files, bundle);
  } catch (err) {
    queuedChanges.push(...files);
    failed = true;
    emit('error', err);
  } finally {
    reloading = false;
    if (!failed) void flushQueuedReload();
  }
}

export function connectEvents() {
  if (window.studioDesktop) {
    window.studioDesktop.onChanged(msg => { queuedChanges.push(...msg.files); flushQueuedReload(); });
    return;
  }
  if (typeof EventSource === 'undefined') return;
  const source = new EventSource('/api/events');
  source.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type !== 'changed') return;
    queuedChanges.push(...msg.files);
    flushQueuedReload(); // does nothing while our own edits are about to be saved: it runs when they have
  };
}

export const slideIndex = (slideId) => engine.project.slides.findIndex((s) => s.id === slideId);
export const currentSlide = () => engine.project.slides.find((s) => s.id === state.ui.slideId);
