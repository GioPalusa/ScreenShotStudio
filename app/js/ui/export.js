// Export selected images from a frozen project. The host publishes a complete RGB PNG set only after checks pass.

import { exportContentsInfo, exportPreviews } from '../export-previews.js';
import { exportContents, transferSteps } from './export-contents.js';
import { savedExports } from './saved-exports.js';
import { engine, state, flushSaves } from '../store.js';
import { preflightScene, preflightSelection } from '../preflight.js';
import { SPEC_URL, SPEC_CHECKED_AT, PLAY_SPEC_URL, PLAY_SPEC_CHECKED_AT } from '../export-targets.js';
import { localeNeedsReview } from '../copy-review.js';
import { Engine, renderToBytes } from '../render.js';
import { h, modal, toast, localeLabel, drawInto } from './helpers.js';
import { warningList } from './warnings.js';
import { openAppStoreUpload } from './app-store-connect.js';
import { uploadChecks } from '../upload-checks.js';
import { exportPlan } from '../export-naming.js';
import { slideSupportsCanvas } from '../slide-order.js';
import { icon } from './icons.js';

const pad2 = (n) => String(n).padStart(2, '0');

const post = async (url, data) => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Export failed'); return body;
};
const fontAvailable = stack => {
  // Check the first requested face; a silent fallback changes the composition.
  const family = (stack ?? 'sans-serif').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  if (/^(serif|sans-serif|monospace|system-ui|ui-rounded|ui-serif|ui-sans-serif)$/.test(family)) return true;
  const ctx = document.createElement('canvas').getContext('2d');
  const specimen = 'mmmmWWWW0123456789日本語العربيةאבג';
  return ['monospace', 'serif'].some(fallback => {
    ctx.font = `72px ${fallback}`; const base = ctx.measureText(specimen).width;
    ctx.font = `72px "${family.replace(/["\\]/g, '')}", ${fallback}`;
    return Math.abs(ctx.measureText(specimen).width - base) > 0.01;
  });
};

export async function runExport({ locales, devices, slides, allowPlaceholders = false, mode = 'draft', preflightOnly = false, onPreflight, onProgress, signal }) {
  await flushSaves();
  const selection = { locales, devices, slides: slides.map(s => s.id) };
  let destination;
  if (!preflightOnly && window.studioDesktop?.chooseExportFolder) {
    const picked = await window.studioDesktop.chooseExportFolder();
    if (picked.canceled || signal?.aborted) return { canceled: true, written: 0 };
    if (typeof picked.token !== 'string') throw new Error('Choose an export folder before exporting.');
    destination = picked.token;
    await flushSaves();
  }
  if (signal?.aborted) throw new Error('Export stopped. No partial export was published.');
  const snapshot = await post('/api/export/start', { mode, selection, ...(destination ? { destination } : {}) });
  const frozen = new Engine(); frozen.setData(snapshot.bundle); frozen.projectURL = snapshot.projectURL;
  const results = { environment: { renderer: navigator.userAgent, fonts: frozen.project.fonts, fontOverrides: frozen.project.locales.filter(l => l.font).map(l => ({ locale: l.id, font: l.font })) }, written: 0, bytes: 0, skipped: [], warnings: [], issues: [], files: [], checked: false, mode };
  const jobs = [];
  const total = exportPlan(frozen.project, selection).length;
  let done = 0, complete = false;
  const checkAbort = () => { if (signal?.aborted) throw new Error('Export stopped. No partial export was published.'); };
  try {
    const selectedSlides = frozen.project.slides.filter(s => selection.slides.includes(s.id));
    const selectionIssues = preflightSelection(frozen.project, devices, selectedSlides);
    results.warnings.push(...selectionIssues);
    results.issues.push(...selectionIssues.map(message => ({ level: 'error', message })));
    for (const locale of locales) for (const device of devices) for (const slide of slides) {
      if (!slideSupportsCanvas(frozen.project, slide, device)) continue;
      checkAbort();
      const label = `${locale} · ${frozen.project.devices[device].short ?? device} · ${slide.name ?? slide.id}`;
      onProgress?.({ done, total, label: `Checking ${label}` });
      const scene = frozen.scene(slide.id, device, locale);
      const canvas = document.createElement('canvas');
      await frozen.render(canvas, scene, { scale: Math.min(1, 600 / scene.W) });
      const warnings = preflightScene(scene, frozen.data, { fontAvailable, checkCanvas: false });
      const missing = warnings.find(w => ['capture-missing', 'frame-missing', 'asset-missing'].includes(w.code));
      if (missing && !allowPlaceholders) results.skipped.push(`${label}: ${missing.message}`);
      else jobs.push({ locale, device, slideId: slide.id, label });
      for (const warning of warnings) {
        const message = `${label}${warning.layer ? ` · layer ${warning.layer}` : ''}: ${warning.message}`;
        results.warnings.push(message);
        results.issues.push({ ...warning, message });
      }
      done++;
    }
    checkAbort();
    if (preflightOnly || (mode === 'final' && (results.warnings.length || results.skipped.length)) || (onPreflight && !await onPreflight(results))) {
      results.checked = true; results.blocked = !preflightOnly; return results;
    }
    done = 0;
    for (const job of jobs) {
      checkAbort();
      onProgress?.({ done, total: jobs.length, label: `Writing ${job.label}` });
      const rendered = await renderToBytes(frozen, frozen.scene(job.slideId, job.device, job.locale));
      const index = frozen.project.slides.findIndex(s => s.id === job.slideId) + 1;
      const query = new URLSearchParams({ session: snapshot.id, locale: job.locale, device: job.device, file: `${pad2(index)}-${job.slideId}`, width: rendered.width, height: rendered.height });
      const response = await fetch(`/api/export?${query}`, { method: 'POST', body: rendered.bytes });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Export failed');
      results.written++; results.bytes += body.bytes; results.files.push(body.path); done++;
    }
    checkAbort();
    const finished = await post('/api/export/finish', { id: snapshot.id, report: results });
    complete = true; results.path = finished.path; results.relative = finished.relative;
    onProgress?.({ done, total: jobs.length, label: 'Done' }); return results;
  } finally {
    if (!complete) await post('/api/export/abort', { id: snapshot.id }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------

export function openExport(ctx, previous = null) {
  const project = engine.project;
  const pick = previous ?? {
    locales: new Set(project.locales.map(l => l.id)),
    devices: new Set(Object.keys(project.devices)),
    slides: new Set(project.slides.map(s => s.id)),
  };
  const summary = h('div', { class: 'export-inventory' });
  const inventory = () => {
    const files = exportPlan(project, { ...selection(), slides: [...pick.slides] });
    const sample = exportPreviews(files, Infinity, { appStoreOnly: false });
    return exportContents({ ...exportContentsInfo(files), previewLocale: sample.locale, previews: sample.images }, { title: 'Images to export', renderPreview: file => {
      const canvas = h('canvas', { role: 'img', 'aria-label': file.slide });
      drawInto(canvas, { slideId: file.slideId, deviceId: file.device, localeId: file.locale, width: Math.min(120, 80 * file.size[0] / file.size[1]) });
      return canvas;
    } });
  };
  const readiness = h('div', { class: 'export-readiness', 'aria-live': 'polite' });
  const form = h('div', { class: 'export-body' });
  const body = h('div', null, form);
  const startBtn = h('button', { class: 'btn primary', disabled: true }, 'Checking…');
  const cancelBtn = h('button', { class: 'btn' }, 'Close');
  let m, report = null, controller = null, generation = 0, closed = false, exporting = false;
  const selection = () => ({
    locales: project.locales.filter(l => pick.locales.has(l.id)).map(l => l.id),
    devices: Object.keys(project.devices).filter(d => pick.devices.has(d)),
    slides: project.slides.filter(s => pick.slides.has(s.id)),
  });
  const count = () => exportPlan(project, { ...selection(), slides: [...pick.slides] }).length;
  const fingerprint = r => JSON.stringify(r.issues.map(i => [i.level, i.code, i.message]));
  const checkCounts = r => {
    const errors = r.issues.filter(i => i.level === 'error').length;
    const warnings = r.issues.length - errors;
    return h('div', { class: 'export-check-counts', hidden: !errors && !warnings },
      h('span', { class: 'err', hidden: !errors }, `${errors} error${errors === 1 ? '' : 's'}`),
      h('span', { class: 'warn', hidden: !warnings }, `${warnings} warning${warnings === 1 ? '' : 's'}`));
  };
  const showReport = r => {
    report = r;
    readiness.replaceChildren(
      h('div', { class: 'label' }, r.issues.length ? 'Review before export' : '✓ Ready to export'),
      checkCounts(r),
      ...(r.issues.length ? [
        h('p', { class: 'hint' }, 'Export anyway creates a draft. Missing images use placeholders.'),
        h('details', { class: 'disclosure export-check-details', open: r.issues.some(i => i.level === 'error') },
          h('summary', null, 'View checks'),
          h('div', { class: 'result-list' }, warningList(r.issues)),
          h('p', { class: 'hint' }, 'You can upload despite text, layout and review warnings. Fix missing images and technical errors before uploading.')),
      ] : []),
    );
    startBtn.textContent = r.issues.length ? 'Export anyway' : 'Export images';
    startBtn.disabled = !count();
  };
  const recheck = async () => {
    if (exporting || closed) return;
    const mine = ++generation;
    controller?.abort(); controller = new AbortController();
    report = null; startBtn.disabled = true; startBtn.textContent = 'Checking…';
    summary.replaceChildren(inventory());
    if (!count()) {
      readiness.replaceChildren(h('p', { class: 'hint' }, 'Choose a language, size and screen.'));
      startBtn.textContent = 'Export images'; return;
    }
    readiness.replaceChildren(h('div', { class: 'label' }, 'Checking images…'), h('p', { class: 'hint' }, 'Preparing your export'));
    try {
      const result = await runExport({ ...selection(), mode: 'draft', allowPlaceholders: true, preflightOnly: true, signal: controller.signal,
        onProgress: ({ done, total, label }) => {
          if (mine === generation && !closed) readiness.lastChild.textContent = `${done} / ${total} · ${label}`;
        } });
      if (mine === generation && !closed) showReport(result);
    } catch (error) {
      if (mine !== generation || closed) return;
      readiness.replaceChildren(h('p', { class: 'err' }, `Could not complete checks: ${error.message}`),
        h('button', { class: 'btn', onClick: recheck }, 'Retry checks'));
      startBtn.textContent = 'Export images';
    }
  };
  const groups = [];
  const group = (title, items, set) => {
    const boxes = [];
    const setAll = value => { items.forEach(({ id }, i) => { boxes[i].checked = value; value ? set.add(id) : set.delete(id); }); void recheck(); };
    const list = h('div', { class: 'checklist' }, items.map(({ id, label, note }) => {
      const input = h('input', { type: 'checkbox', checked: set.has(id), onChange: () => { input.checked ? set.add(id) : set.delete(id); void recheck(); } });
      boxes.push(input);
      return h('label', null, input, h('span', null, label, note ? h('small', { class: 'muted' }, note) : null));
    }));
    groups.push({ items, set, boxes });
    return h('div', { class: 'field' }, h('div', { class: 'row between' }, h('span', { class: 'label' }, title),
      h('span', { class: 'row' }, h('button', { class: 'btn small', onClick: () => setAll(true) }, 'All'), h('button', { class: 'btn small', onClick: () => setAll(false) }, 'None'))), list);
  };
  const allSelected = project.locales.every(l => pick.locales.has(l.id)) && Object.keys(project.devices).every(id => pick.devices.has(id)) && project.slides.every(s => pick.slides.has(s.id));
  const customSelection = h('div', { class: 'export-columns', id: 'export-custom-selection', hidden: allSelected },
      group('Languages', project.locales.map(l => ({ id: l.id, label: localeLabel(l), note: localeNeedsReview(project, engine.data.copy, l.id) ? 'Needs review' : '' })), pick.locales),
      group('Sizes', Object.entries(project.devices).map(([id, d]) => ({ id, label: d.label, note: `${d.size[0]} × ${d.size[1]} px` })), pick.devices),
      group('Screens', project.slides.map((s, i) => ({ id: s.id, label: `${i + 1}. ${s.name ?? s.id}` })), pick.slides));
  const allScreens = h('input', { type: 'checkbox', checked: allSelected, 'aria-controls': 'export-custom-selection', 'aria-expanded': String(!allSelected), onChange: () => {
    customSelection.hidden = allScreens.checked;
    allScreens.setAttribute('aria-expanded', String(!allScreens.checked));
    if (allScreens.checked) {
      for (const { items, set, boxes } of groups) items.forEach(({ id }, index) => { set.add(id); boxes[index].checked = true; });
      void recheck();
    }
  } });
  form.append(
    transferSteps(0),
    h('label', { class: 'export-all' }, allScreens, icon('rectangle.3.group'), h('span', null, h('strong', null, 'All screens'), h('small', null, 'Every language and size'))),
    summary, customSelection,
    readiness,
    h('details', { class: 'disclosure export-options' }, h('summary', null, 'Export details'), h('div', { class: 'disclosure-body' },
      h('div', { class: 'row wrap' }, h('button', { class: 'btn small', onClick: recheck }, 'Recheck'),
        h('button', { class: 'btn small', onClick: () => { m.close(); state.ui.setupTab = 'devices'; ctx.go({ view: 'setup' }); } }, 'Edit canvases…')),
      h('p', { class: 'hint' }, 'RGB PNG · no transparency. A copy stays in your project.', window.studioDesktop?.chooseExportFolder ? ' Choose an additional folder when exporting.' : h('span', null, ' Saved in ', h('span', { class: 'path mono', id: 'export-dir' }, 'export/'), '.')),
      h('p', { class: 'hint' }, h('a', { href: SPEC_URL, target: '_blank', rel: 'noopener' }, `Apple sizes · ${SPEC_CHECKED_AT} ↗`), ' · ',
        h('a', { href: PLAY_SPEC_URL, target: '_blank', rel: 'noopener' }, `Google Play sizes · ${PLAY_SPEC_CHECKED_AT} ↗`)))),
    h('details', { class: 'disclosure' }, h('summary', null, 'Earlier exports'), savedExports({ onUpload: exportPath => { m.close(); openAppStoreUpload(exportPath); } })),
  );
  fetch('/api/exports').then(r => r.json()).then(j => { const n = form.querySelector('#export-dir'); if (n) n.textContent = j.dir; }).catch(() => {});
  startBtn.addEventListener('click', async () => {
    if (!report || exporting || !count()) return;
    exporting = true; generation++; controller?.abort(); controller = new AbortController();
    const reviewed = fingerprint(report), override = report.issues.length > 0;
    const bar = h('div', null), label = h('div', { class: 'hint' }, 'Preparing export…');
    const progress = h('div', { class: 'field' }, transferSteps(0), h('div', { class: 'label' }, 'Exporting screenshots…'), h('div', { class: 'progress' }, bar), label);
    form.hidden = true; body.append(progress);
    const stop = h('button', { class: 'btn', onClick: () => controller.abort() }, 'Stop');
    m.el.querySelector('.modal-foot').replaceChildren(stop);
    const restore = () => { progress.remove(); form.hidden = false; exporting = false; m.el.querySelector('.modal-foot').replaceChildren(cancelBtn, startBtn); };
    try {
      const result = await runExport({ ...selection(), mode: override ? 'draft' : 'final', allowPlaceholders: override, signal: controller.signal,
        // Recheck the frozen source before writing, and review any changed issues again.
        onPreflight: r => fingerprint(r) === reviewed,
        onProgress: ({ done, total, label: text }) => { bar.style.width = `${total ? done / total * 100 : 0}%`; label.textContent = `${done} / ${total} · ${text}`; },
      });
      if (closed) return;
      if (result.canceled) { restore(); return; }
      if (result.checked) {
        restore(); showReport(result);
        readiness.prepend(h('p', { class: 'warn' }, 'The checks changed since your review. Review the updated result before exporting.'));
        return;
      }
      const checks = uploadChecks(result), unresolved = checks.errors.length > 0;
      const desktopUpload = typeof window.studioDesktop?.appStore === 'function';
      const appStoreCount = exportPlan(project, { ...selection(), slides: [...pick.slides] }).filter(file => file.store === 'app-store').length;
      const uploadBlocked = unresolved || !desktopUpload || !appStoreCount;
      const reveal = h('button', { class: `btn${uploadBlocked ? ' primary' : ''}`, onClick: () => fetch('/api/reveal', { method: 'POST' }) }, 'Show in Finder');
      const uploadStatus = h('div', { class: 'export-readiness', id: 'export-upload-status' },
        h('div', { class: 'label' }, uploadBlocked ? 'App Store Connect upload unavailable' : 'Ready to upload to App Store Connect'),
        checks.errors.length || checks.warnings.length ? checkCounts({ issues: [...checks.errors, ...checks.warnings] }) : null,
        h('p', { class: 'hint' }, !appStoreCount ? 'This export has no App Store images. Include an App Store size to upload from here.' : unresolved
          ? 'Fix the technical errors or select only images without technical errors, then export again. Text, layout and review warnings can be accepted during upload.'
          : checks.warnings.length ? 'You can upload these images despite the warnings. Review them and choose to upload anyway in the next step.' : 'Choose the app and version, then review the screenshots before uploading.'),
        !desktopUpload ? h('p', { class: 'hint' }, 'Direct upload requires the latest Screenshot Studio Mac app. Open this project there and export again.') : null,
        result.issues.length ? h('div', null, h('button', { class: 'btn small', onClick: () => { m.close(); openExport(ctx, pick); } }, 'Review export checks…')) : null);
      body.replaceChildren(h('div', { class: 'export-body' }, transferSteps(1), h('div', { class: 'label' }, '✓ Export finished'),
        exportContents({ ...exportContentsInfo(exportPlan(project, { ...selection(), slides: [...pick.slides] })), count: result.written }, { title: 'Export saved', previews: false }),
        h('details', { class: 'disclosure' }, h('summary', null, 'Saved files'), h('p', { class: 'hint' }, `${result.written} image${result.written === 1 ? '' : 's'} written (${(result.bytes / 1048576).toFixed(1)} MB). ${result.path}`)),
        uploadStatus,
        result.issues.length ? h('div', { class: 'result-list' }, warningList([...checks.errors, ...checks.warnings])) : null));
      const upload = h('button', { class: 'btn primary', disabled: uploadBlocked, 'aria-describedby': 'export-upload-status', onClick: () => { m.close(); openAppStoreUpload(result.path); } }, 'Upload to App Store Connect…');
      m.el.querySelector('.modal-foot').replaceChildren(cancelBtn, reveal, upload);
    } catch (error) {
      if (closed) return;
      restore(); report = null; startBtn.disabled = true;
      readiness.replaceChildren(h('p', { class: 'err' }, `Export failed: ${error.message}`),
        h('button', { class: 'btn', onClick: recheck }, 'Retry checks'));
    }
  });
  cancelBtn.addEventListener('click', () => m.close());
  m = modal({ title: 'Export screenshots', wide: true, body, actions: [cancelBtn, startBtn], onClose: () => { closed = true; generation++; controller?.abort(); } });
  void recheck();
  return m;
}

// ---------------------------------------------------------------------------------------------
// headless mode: `node studio.mjs export` opens the studio in headless Chrome with ?headless=1

export async function runHeadless(params) {
  const post = (path, payload) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload ?? {}) });
  const csv = (key) => (params.get(key) ? params.get(key).split(',').map((s) => s.trim()).filter(Boolean) : null);
  try {
    const project = engine.project;
    const locales = csv('locale') ?? project.locales.map((l) => l.id);
    const devices = csv('device') ?? Object.keys(project.devices);
    const slideIds = csv('slide');
    for (const id of locales) if (!project.locales.some((l) => l.id === id)) throw new Error(`Unknown locale “${id}”. Known: ${project.locales.map((l) => l.id).join(', ')}`);
    for (const id of devices) if (!project.devices[id]) throw new Error(`Unknown device “${id}”. Known: ${Object.keys(project.devices).join(', ')}`);
    const slides = slideIds ? project.slides.filter((s) => slideIds.includes(s.id)) : project.slides;
    if (slideIds && slides.length !== slideIds.length) throw new Error(`Unknown slide in “${slideIds.join(',')}”. Known: ${project.slides.map((s) => s.id).join(', ')}`);
    let last = 0;
    const results = await runExport({
      locales, devices, slides, mode: params.get('strict') === '1' ? 'final' : 'draft', allowPlaceholders: params.get('placeholders') === '1',
      onProgress: ({ done, total, label }) => {
        if (done === total || done - last >= 10) { last = done; post('/api/export-log', { line: `  ${done}/${total} ${label}` }); }
      },
    });
    if (results.path) await post('/api/export-log', { line: `  Folder: ${results.path}` });
    for (const text of results.skipped) await post('/api/export-log', { warning: `skipped ${text}` });
    for (const text of results.warnings) await post('/api/export-log', { warning: text });
    await post('/api/export-done');
  } catch (err) {
    await post('/api/export-log', { error: String(err.message ?? err) });
    await post('/api/export-done');
  }
}

export { toast };
