// Entry point. `?view=render` and `?view=strip` are plain render views used for debugging and by
// headless export; everything else is the studio UI.

import { engine, state, loadAll, restoreUI, rememberUI, connectEvents, flushSaves, recoverEdits } from './store.js';

const params = new URLSearchParams(location.search);

async function debugRender() {
  const root = document.getElementById('root');
  document.body.style.background = '#1b1b1d';
  const scale = Number(params.get('scale') ?? 0.3);
  const device = params.get('device') ?? 'iphone';
  const ids = params.get('slide') ? params.get('slide').split(',') : engine.project.slides.map((s) => s.id);
  const localeParam = params.get('locales') ?? params.get('locale') ?? 'en-US';
  const locales = localeParam === 'all' ? engine.project.locales.map((l) => l.id) : localeParam.split(',');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;padding:12px;align-items:flex-start';
  root.append(wrap);
  const notes = [];
  for (const locale of locales) {
    for (const id of ids) {
      const scene = engine.scene(id, device, locale);
      const canvas = document.createElement('canvas');
      canvas.title = `${locale} ${id}`;
      const crop = Number(params.get('crop') ?? 0);
      const holder = document.createElement('div');
      holder.style.cssText = crop ? `overflow:hidden;height:${Math.round(scene.H * scale * crop)}px;position:relative` : '';
      holder.append(canvas);
      wrap.append(holder);
      const report = await engine.render(canvas, scene, { scale });
      notes.push({ locale, slide: id, warnings: report.warnings.filter((w) => w.level !== 'info').map((w) => `${w.level}:${w.code}`), texts: Object.fromEntries(Object.entries(report.texts).map(([k, v]) => [k, `${v.size.toFixed(1)}px x${v.lines}`])) });
    }
  }
  const pre = document.createElement('pre');
  pre.id = 'notes';
  pre.style.cssText = 'color:#ccc;font:12px ui-monospace;padding:0 12px';
  pre.textContent = JSON.stringify(notes, null, 1);
  root.append(pre);
  document.title = 'rendered';
}

async function boot() {
  window.studioDesktop?.onFlush(() => flushSaves());
  restoreUI();
  await loadAll();
  if (params.get('new') === '1') {
    Object.assign(state.ui, { view: 'editor', tab: 'screenshot', slideId: engine.project.slides[0]?.id, device: Object.keys(engine.project.devices)[0], locale: engine.project.locales[0]?.id, captureScope: 'all' });
    rememberUI();
    history.replaceState(null, '', location.pathname);
  }
  const view = params.get('view');
  if (view === 'render' || view === 'strip') return debugRender();
  if (params.get('headless') === '1') {
    document.body.textContent = 'Exporting…';
    const { runHeadless } = await import('./ui/export.js');
    return runHeadless(params);
  }
  if (state.recovery?.length) recoverEdits();
  const { mountStudio } = await import('./ui.js');
  mountStudio(document.getElementById('root'));
  connectEvents();
  window.studioDesktop?.onExport(async () => { const { openExport } = await import('./ui/export.js'); openExport({}); });
}

boot().catch((err) => {
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f66;padding:24px;white-space:pre-wrap';
  pre.textContent = `Studio failed to start:\n${err.stack ?? err}`; // text, not HTML: the message can quote file contents
  document.getElementById('root').replaceChildren(pre);
  console.error(err);
});
