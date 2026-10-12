import { orderedSlides } from './project-ops.js';
import { isTextEditing } from './shortcuts.js';
import { openGetStarted } from './ui/get-started.js';
import { openShortcuts } from './ui/shortcuts.js';
import { openMediaLibrary } from './ui/media-library.js';
// The studio shell: top bar (language, device, view, export), view switching, shortcuts.

import { engine, state, on, rememberUI, emit, undo, redo, undoIf, retrySaves, recoverEdits, resolveSaveConflict, needsReview } from './store.js';
import { h, toast, localeLabel, fmtTime, confirmDialog } from './ui/helpers.js';
import { installTooltips } from './ui/tooltips.js';
import { createEditor } from './ui/editor.js';
import { createLanguages } from './ui/languages.js';
import { createOverview } from './ui/overview.js';
import { createSetup } from './ui/setup.js';
import { openExport } from './ui/export.js';
import { openAddLanguage } from './ui/locale-dialogs.js';
import { openAddDevice } from './ui/devices-view.js';
import { translateIcon } from './ui/translate-dialog.js';

const VIEWS = [['editor', 'Editor'], ['languages', 'Translate'], ['overview', 'Overview'], ['setup', 'Setup']];

function viewIcon(id) {
  if (id === 'languages') return translateIcon();
  const paths = {
    editor: 'M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16l-1 4M14 7l3 3',
    overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    setup: 'M4 7h4m4 0h8M4 17h8m4 0h4M8 4v6M16 14v6',
  };
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', paths[id]); svg.append(path); return svg;
}

export function mountStudio(root) {
  installTooltips(document);
  const topbar = h('header', { class: 'topbar' });
  const content = h('main', { class: 'content' });
  root.replaceChildren(h('div', { class: 'app' }, topbar, content));

  const ctx = {
    /** Change selection and re-render once. */
    go({ view, locale, device, slideId } = {}) {
      if (view) state.ui.view = view;
      if (locale) state.ui.locale = locale;
      if (device) state.ui.device = device;
      if (slideId) { state.ui.slideId = slideId; state.ui.allScreens = false; }
      rememberUI();
      renderAll();
    },
    setLocale(id) { ctx.go({ locale: id }); },
    setDevice(id) { ctx.go({ device: id }); },
    setView(view) { ctx.go({ view }); },
    openExport() { openExport(ctx); },
    openMedia() { return openMediaLibrary({ ctx }); },
    openConnectedSeries(options) { return views.editor.newSeries(options); },
    /** Open a template for editing in the editor (Setup → Templates → Edit layout). */
    editTemplate(id) {
      ctx.go({ view: 'editor' });
      views.editor.editTemplate(id);
    },
    undo() { undo(); },
    /** A message's "Undo" button: undoes that step only while it is still the latest one. */
    undoStep(token) { if (!undoIf(token)) toast('Other changes were made since: step back with ⌘Z instead.', { timeout: 4000 }); },
  };

  const views = { editor: createEditor(ctx), languages: createLanguages(ctx), overview: createOverview(ctx), setup: createSetup(ctx) };
  const saveStatus = h('button', { class: 'status save-status', 'aria-live': 'polite' }, state.recovery?.length ? 'Recover unsaved edits…' : state.saving ? 'Saving recovered edits…' : 'All changes saved');
  saveStatus.addEventListener('click', async () => {
    try {
      if (state.recovery?.length) { recoverEdits(); renderAll(); return; }
      await retrySaves();
    } catch (error) {
      if (error.status === 409) {
        const keep = await confirmDialog({ title: 'Conflicting edits', body: 'This project changed on disk. Keep your version and replace the changed files? A backup of the disk version is retained.', confirmLabel: 'Keep my version', cancelLabel: 'Keep edits unsaved' });
        if (keep) await resolveSaveConflict(true);
      } else toast(error.message, { error: true });
    }
  });

  // ----- top bar

  function localeOptionLabel(l) {
    return `${localeLabel(l)}${needsReview(l.id) ? '  · draft' : ''}`;
  }

  function buildTopbar() {
    const { locales, devices } = engine.project;
    const select = h('select', { class: 'input', 'aria-label': 'Language', style: { minWidth: '210px' }, onChange: () => {
      if (select.value === '__add') { select.value = state.ui.locale; openAddLanguage(ctx); return; }
      ctx.setLocale(select.value);
    } },
      locales.map((l) => h('option', { value: l.id, selected: l.id === state.ui.locale }, localeOptionLabel(l))),
      h('option', { value: '__add' }, '＋ Add language…'));
    const step = (delta) => {
      const i = locales.findIndex((l) => l.id === state.ui.locale);
      ctx.setLocale(locales[(i + delta + locales.length) % locales.length].id);
    };
    topbar.replaceChildren(
      h('nav', { class: 'view-nav', 'aria-label': 'View' }, VIEWS.map(([id, label]) =>
        h('button', { 'aria-pressed': String(id === state.ui.view), onClick: () => ctx.setView(id) }, viewIcon(id), label))),
      h('div', { class: 'select-wrap' },
        h('button', { class: 'btn icon', title: 'Previous language  [', 'aria-label': 'Previous language', onClick: () => step(-1) }, '‹'),
        select,
        h('button', { class: 'btn icon', title: 'Next language  ]', 'aria-label': 'Next language', onClick: () => step(1) }, '›')),
      h('select', { class: 'input canvas-select', 'aria-label': 'Canvas', onChange: e => {
        if (e.target.value === '__add') { e.target.value = state.ui.device; openAddDevice(ctx, { fromMenu: true }); return; }
        ctx.setDevice(e.target.value);
      } }, Object.entries(devices).map(([id, d]) => h('option', { value: id, selected: id === state.ui.device }, d.short ?? d.label)),
      h('option', { value: '__add' }, '＋ Add device…')),
      h('button', { class: 'btn', title: 'Media library · ⇧⌘M', onClick: () => ctx.openMedia() }, 'Media'),
      h('button', { class: 'btn icon', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts · ?', onClick: openShortcuts }, '?'),
      h('div', { class: 'spacer' }),
      h('div', { class: 'row topbar-actions' }, saveStatus,
        h('button', { class: 'btn primary', title: 'Export screenshots  ⌘E', onClick: ctx.openExport }, 'Export…')),
    );
  }

  // ----- views

  function renderAll() {
    buildTopbar();
    const view = views[state.ui.view] ?? views.editor;
    content.replaceChildren(view.el);
    view.build();
    // once the view is on the page and has real sizes (a timer too: frames are paused while the page is hidden)
    let activated = false;
    const activate = () => { if (!activated) { activated = true; view.activate?.(); } };
    requestAnimationFrame(activate);
    setTimeout(activate, 60);
  }

  on('saving', ({ saving, lastSaved, failed }) => {
    saveStatus.textContent = failed ? 'Not saved · Retry…' : saving > 0 ? 'Saving…' : `Saved ${fmtTime(lastSaved)}`;
    saveStatus.classList.toggle('err', Boolean(failed));
  });
  on('error', (err) => toast(`Something went wrong: ${err.message}`, { error: true, timeout: 8000 }));
  on('restored', () => {
    // undo / redo can change devices and templates: refresh the shell and any view that is not the editor (it handles itself)
    buildTopbar();
    if (state.ui.view !== 'editor') views[state.ui.view]?.refresh?.();
  });
  on('locales-changed', () => buildTopbar());
  on('reloaded', ({ files }) => {
    // Files were changed outside the browser (an editor, git, Claude Code): pick the changes up.
    const view = views[state.ui.view];
    if (state.ui.view === 'editor' && view.afterCopyChanged) view.afterCopyChanged();
    else view.refresh?.();
    buildTopbar();
  });

  window.addEventListener('resize', () => {
    clearTimeout(mountStudio._resize);
    mountStudio._resize = setTimeout(() => views[state.ui.view]?.onResize?.(), 120);
  });

  window.studioDesktop?.onCommand(command => {
    if (command === 'guide') { openGetStarted(); return; }
    if (document.querySelector('.modal-backdrop')) return;
    if (command === 'media') ctx.openMedia();
    if (command === 'shortcuts') openShortcuts();
  });

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const typing = isTextEditing(document.activeElement);
    if (document.querySelector('.modal-backdrop, .context-menu')) return; // dialogs and menus own the keyboard
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); ctx.openExport(); return; }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); ctx.openMedia(); return; }
    if (!typing && e.key === '?') { e.preventDefault(); openShortcuts(); return; }
    // the editor gets first go at undo/redo, nudging, delete and the like (not while you are typing in a field)
    if (!typing && state.ui.view === 'editor' && views.editor.handleKey(e)) return;
    if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const slides = orderedSlides(engine.project, state.ui.locale);
    const locales = engine.project.locales;
    const devices = Object.keys(engine.project.devices);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const i = slides.findIndex((s) => s.id === state.ui.slideId);
      const next = slides[Math.min(slides.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next && next.id !== state.ui.slideId) { e.preventDefault(); if (state.ui.view === 'editor') views.editor.selectSlide(next.id); else ctx.go({ slideId: next.id }); }
    } else if (e.key === '[' || e.key === ']') {
      const i = locales.findIndex((l) => l.id === state.ui.locale);
      ctx.setLocale(locales[(i + (e.key === ']' ? 1 : -1) + locales.length) % locales.length].id);
    } else if (/^[1-9]$/.test(e.key) && devices[Number(e.key) - 1]) {
      ctx.setDevice(devices[Number(e.key) - 1]);
    }
  });

  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  }

  renderAll();
  emit('mounted');
  if (state.serverApi < 3) {
    toast('The studio server is older than this page: restart it (stop node studio.mjs with Ctrl+C, then run it again) to use images, frames and removing languages. Text, layouts and screenshots work as before.', { error: true, timeout: 0 });
  }
}
