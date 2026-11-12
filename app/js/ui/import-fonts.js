import { engine, state, api, checkpoint, saveStudio, flushSaves, emit } from '../store.js';
import { mergeProjectFonts } from '../project-fonts.js';
import { h, modal, toast } from './helpers.js';

const encode = async file => {
  if (file.size > 32 * 1024 * 1024) throw Error('Choose a font file smaller than 32 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
  return btoa(binary);
};
const covers = (font, layer) => font.family === layer.fontFamily && font.style === (layer.figmaText?.italic ? 'italic' : 'normal') && (() => { const [min, max = min] = String(font.weight).split(' ').map(Number); return (layer.weight ?? 400) >= min && (layer.weight ?? 400) <= max; })();

/** Reusable in the Figma preview and for collecting fonts in an existing document. */
export function importFontControls({ active, onChange = () => {}, existing = engine.project?.fonts?.files ?? [] }) {
  let fonts = [], required = [], loading = false, cancelled = false;
  const attempted = new Set(), controller = new AbortController();
  const post = body => api('/api/import/fonts', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) });
  const list = h('div'), status = h('p', { class: 'hint', role: 'status' });
  const fallback = h('input', { type: 'checkbox', onChange });
  const fallbackRow = h('label', { class: 'row check' }, fallback, 'Import with available fonts for the missing faces');
  const picker = h('input', { type: 'file', accept: '.ttf,.otf', multiple: true, 'aria-label': 'Add font files', onChange: async () => {
    if (!picker.files.length || loading) return;
    let changed = false;
    loading = true; picker.disabled = true; status.textContent = 'Reading font files…'; onChange();
    try {
      const data = await post({ action: 'inspect', fonts: await Promise.all([...picker.files].map(async file => ({ data: await encode(file) }))) });
      if (!active() || cancelled) return;
      fonts = mergeProjectFonts(fonts, data.fonts); changed = true; status.textContent = 'Font files added. Preview again to check the typography.';
    } catch (error) { if (active()) status.textContent = error.message; }
    finally { loading = false; picker.disabled = false; picker.value = ''; refresh(); onChange(changed ? 'fonts' : undefined); }
  } });
  const available = () => mergeProjectFonts(existing, fonts);
  const missing = () => required.filter(layer => !available().some(font => covers(font, layer)));
  function refresh() {
    const needs = missing();
    list.replaceChildren(...[...new Set(required.map(l => l.fontFamily))].map(family => h('p', { class: 'hint' }, `${family} · ${needs.some(l => l.fontFamily === family) ? 'font file needed' : 'included in project'}`)));
    fallbackRow.hidden = !needs.length;
  }
  const el = h('section', { class: 'import-fonts' }, h('h3', null, 'Fonts'), h('p', { class: 'hint' }, 'Google Fonts are included automatically with their licenses. For other families, add the original .ttf or .otf files that you can embed in this project.'), list, h('label', { class: 'f' }, 'Add font files…', picker), fallbackRow, status);
  return {
    el, get files() { return fonts; }, get ready() { return !loading && (!missing().length || fallback.checked); },
    get previewFonts() { return mergeProjectFonts(existing, fonts.map(font => ({ ...font, file: `data:font/${font.extension};base64,${font.data}` }))); },
    async resolve(layers) {
      required = layers.filter(l => l.type === 'text' && !/^(system-ui|sans-serif|serif|monospace|ui-serif|ui-sans-serif|ui-rounded)$/.test(l.fontFamily)); loading = true; picker.disabled = true; refresh();
      const families = [...new Set(missing().map(l => l.fontFamily))].filter(f => !attempted.has(f));
      try {
        if (families.length) {
          status.textContent = 'Collecting font files from Google Fonts…'; families.forEach(f => attempted.add(f));
          const data = await post({ action: 'resolve', families });
          if (!active() || cancelled) return;
          fonts = mergeProjectFonts(fonts, data.fonts);
        }
        status.textContent = missing().length ? 'Add the missing faces for matching typography, or explicitly use available fonts.' : 'The original font families, weights and styles will travel with the project.';
      } catch (error) { if (active()) { families.forEach(f => attempted.delete(f)); status.textContent = error.message; } }
      finally { loading = false; picker.disabled = false; refresh(); }
    },
    async save() { return fonts.length ? (await post({ action: 'save', fonts })).fonts : []; },
    close() { cancelled = true; controller.abort(); },
  };
}

export async function openProjectFonts() {
  const project = engine.project, projectId = state.projectId; let closed = false;
  const active = () => !closed && project === engine.project && projectId === state.projectId;
  const status = h('p', { role: 'status', class: 'hint' });
  const controls = importFontControls({ active, onChange: () => { save.disabled = !controls.ready; } });
  const save = h('button', { class: 'btn primary', disabled: true, onClick: async () => {
    if (!active() || !controls.ready) return; save.disabled = true;
    try {
      const fonts = await controls.save(); if (!active()) return;
      if (fonts.length) { checkpoint(); project.fonts ??= {}; project.fonts.files = mergeProjectFonts(project.fonts.files, fonts); engine.invalidate(); saveStudio(); emit('restored'); await flushSaves(); }
      dialog.close(); toast('Project fonts collected.');
    } catch (error) { if (active()) { status.textContent = error.message; save.disabled = !controls.ready; } }
  } }, 'Save project fonts');
  const dialog = modal({ title: 'Collect project fonts', body: h('div', null, controls.el, status), actions: [h('button', { class: 'btn', onClick: () => dialog.close() }, 'Cancel'), save], onClose: () => { closed = true; controls.close(); } });
  const { resolveLayers } = await import('../layouts.js');
  const layers = project.slides.flatMap(slide => Object.keys(project.devices).flatMap(deviceId => project.locales.flatMap(locale => resolveLayers({ project, slide, deviceId, localeId: locale.id }).layers.map(l => ({ ...l, fontFamily: l.fontFamily || engine.fontsFor(locale.id).family || 'system-ui' })))));
  await controls.resolve(layers);
  if (active()) save.disabled = !controls.ready;
}
