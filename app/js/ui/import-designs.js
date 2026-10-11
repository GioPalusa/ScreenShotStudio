import { engine, state, api, uploadAsset, uploadCapture, toPNG, importExternalDesigns, flushSaves } from '../store.js';
import { readImageInfo } from '../assets.js';
import { planExternalImport, importPath, applyExternalImport } from '../external-import.js';
import { h, modal, selectInput, toast } from './helpers.js';

const M = 1024 * 1024;
async function decodeFiles(input) {
  let files = [...input].map(file => ({ file, path: importPath(file.webkitRelativePath || file.name) }));
  if (files.some(f => /\.zip$/i.test(f.path)) && files.length !== 1) throw new Error('Choose one ZIP at a time, or select individual images.');
  if (files.length === 1 && /\.zip$/i.test(files[0].path)) {
    const archive = await api('/api/import/archive', { method: 'POST', body: files[0].file });
    files = archive.files.map(entry => { const bytes = Uint8Array.from(atob(entry.data), c => c.charCodeAt(0)); return { path: importPath(entry.path), file: new File([bytes], entry.path.split('/').at(-1)) }; });
  }
  files = files.filter(({ path }) => !path.split('/').some(p => p.startsWith('.') || p === '__MACOSX') && /\.(png|jpe?g|strings)$|(?:^|\/)Framefile\.json$/i.test(path));
  if (files.length > 300 || files.reduce((n, e) => n + e.file.size, 0) > 128 * M || files.some(e => e.file.size > 32 * M)) throw new Error('Import up to 300 files, 32 MB per file and 128 MB total at a time.');
  for (const entry of files) {
    if (/\.(png|jpe?g)$/i.test(entry.path)) {
      const info = await readImageInfo(entry.file);
      if (info.width > 16384 || info.height > 16384 || info.width * info.height > 40000000) throw new Error(`${entry.path} is too large. Use images up to 40 megapixels.`);
      Object.assign(entry, info);
    } else {
      if (entry.file.size > M) throw new Error('Framefile and .strings files must be smaller than 1 MB.');
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      entry.text = new TextDecoder(bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : 'utf-8', { fatal: true }).decode(bytes);
    }
  }
  return files;
}

export function openImportDesigns(ctx) {
  const project = engine.project, projectId = state.projectId;
  let closed = false, busy = false, plan = null, urls = [];
  const active = () => !closed && project === engine.project && projectId === state.projectId;
  const status = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' }), preview = h('div', { class: 'import-design-preview' }), warnings = h('div', { class: 'hint' });
  const canvas = selectInput({ value: '', options: [['', 'Original image sizes · new canvases'], ...Object.entries(project.devices).map(([id, d]) => [id, `${d.label} · ${d.size.join(' × ')}`])], onChange: update });
  canvas.setAttribute('aria-label', 'Import canvas');
  const language = selectInput({ value: state.ui.locale, options: project.locales.map(l => [l.id, l.name]), onChange: value => { if (plan) { for (const row of plan.rows) row.locale = value; showRows(); } } });
  language.setAttribute('aria-label', 'Import language');
  const filesInput = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.zip', multiple: true, hidden: true, 'aria-label': 'Import design files' });
  const folderInput = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true, 'aria-label': 'Import design folder' });
  const choose = h('button', { class: 'btn primary', onClick: () => filesInput.click() }, 'Choose images or ZIP…');
  const folder = h('button', { class: 'btn', onClick: () => folderInput.click() }, 'Choose folder…');
  const clearURLs = () => { for (const url of urls) URL.revokeObjectURL(url); urls = []; };
  async function load(files) {
    if (!files.length || busy || !active()) return;
    busy = true; setDisabled(true); status.textContent = 'Reading import…';
    try {
      const decoded = await decodeFiles(files); if (!active()) return;
      plan = planExternalImport(decoded, { locales: project.locales, localeId: language.value });
      warnings.replaceChildren(...plan.warnings.map(w => h('p', null, w)));
      showRows(); status.textContent = '';
    } catch (error) { if (active()) { plan = null; preview.replaceChildren(); clearURLs(); warnings.replaceChildren(); status.textContent = error.message; } }
    finally { if (active()) { busy = false; setDisabled(false); update(); } }
  }
  filesInput.addEventListener('change', () => { void load(filesInput.files); filesInput.value = ''; });
  folderInput.addEventListener('change', () => { void load(folderInput.files); folderInput.value = ''; });
  function update() { const count = plan?.rows.filter(r => r.selected).length ?? 0; apply.disabled = busy || !count; apply.textContent = `Import ${count} screenshot${count === 1 ? '' : 's'}`; }
  function setDisabled(value) { for (const input of [choose, folder, canvas, language, ...preview.querySelectorAll('input,select')]) input.disabled = value; apply.disabled = value; }
  function showRows() {
    clearURLs(); preview.replaceChildren();
    for (const row of plan.rows) {
      const url = URL.createObjectURL(row.file.file); urls.push(url);
      const check = h('input', { type: 'checkbox', checked: row.selected, 'aria-label': `Import ${row.path}`, onChange: () => { row.selected = check.checked; update(); } });
      const locale = selectInput({ value: row.locale, options: project.locales.map(l => [l.id, l.name]), onChange: value => { row.locale = value; } }); locale.setAttribute('aria-label', `Language for ${row.path}`);
      preview.append(h('article', { class: 'import-design-row' }, check, h('img', { src: url, alt: row.name }), h('div', null,
        h('b', null, row.name), h('div', { class: 'hint' }, `${row.file.width} × ${row.file.height} · ${row.kind === 'frameit' ? 'Editable device + text' : 'Image layer'}`),
        row.title || row.keyword ? h('div', { class: 'import-design-copy' }, [row.keyword, row.title].filter(Boolean).join('\n')) : null,
        h('small', { class: 'hint' }, row.path)), locale));
    }
    update();
  }
  const apply = h('button', { class: 'btn primary', disabled: true, onClick: async () => {
    if (busy || !active()) return;
    const rows = plan.rows.filter(r => r.selected), assets = {}, captures = {}, set = `import-${crypto.randomUUID().slice(0, 8)}`;
    // Validate destinations and the complete edit before uploading any media.
    try { applyExternalImport(project, engine.data.copy, rows, { canvasId: canvas.value || null, assets: Object.fromEntries(rows.flatMap(r => [r.file, r.background].filter(Boolean)).map(f => [f.path, 'preview.png'])), captures: Object.fromEntries(rows.map((r, i) => [r.path, { set, name: `screen-${i + 1}` }])) }); }
    catch (error) { status.textContent = error.message; return; }
    busy = true; setDisabled(true);
    try {
      for (const [index, row] of rows.entries()) {
        if (!active()) return;
        status.textContent = `Importing ${index + 1} of ${rows.length}…`;
        for (const entry of [row.kind === 'image' ? row.file : null, row.background].filter(Boolean)) {
          if (!assets[entry.path]) assets[entry.path] = (await uploadAsset(entry.file)).file;
          if (!active()) return;
        }
        if (row.kind === 'frameit') {
          const png = await toPNG(row.file.file); if (!active()) return;
          const name = `screen-${index + 1}`;
          await uploadCapture({ scope: row.locale, device: set, name, blob: png.blob, create: true });
          captures[row.path] = { set, name };
        }
      }
      if (!active()) return;
      const result = importExternalDesigns(rows, { canvasId: canvas.value || null, assets, captures });
      dialog.close(); ctx.go({ view: 'editor', slideId: result.slides[0], device: result.deviceId, locale: rows[0].locale });
      toast(`${result.slides.length} slide${result.slides.length === 1 ? '' : 's'} imported. Select a layer to continue editing.`);
      try { await flushSaves(); } catch { toast('Imported slides are in the editor. Saving needs attention; use the save status to retry.', { error: true }); }
    } catch (error) { if (active()) status.textContent = `Import stopped: ${error.message}. No slides were added.`; }
    finally { if (active()) { busy = false; setDisabled(false); update(); } }
  } }, 'Import 0 screenshots');
  const body = h('div', { class: 'import-designs' },
    h('p', null, 'Continue a design from another screenshot tool.'),
    h('div', { class: 'notice' }, h('b', null, 'PNG / JPEG exports'), h('p', null, 'Import exports from AppScreens, AppMockUp or other tools as image layers. Their existing text and devices stay inside the image; add new text, images or devices above it.')),
    h('div', { class: 'notice' }, h('b', null, 'fastlane Framefile'), h('p', null, 'Choose a folder or ZIP containing Framefile.json, source screenshots, backgrounds and optional title.strings / keyword.strings. Text and devices become editable.')),
    h('div', { class: 'row wrap' }, choose, folder, filesInput, folderInput),
    h('div', { class: 'translation-grid' }, h('label', { class: 'f' }, 'Canvas', canvas), h('label', { class: 'f' }, 'Set all to language', language)),
    h('p', { class: 'hint' }, 'New slides are added to this project. Review each language below. Existing slides are kept, and the import can be undone.'), warnings, preview, status);
  body.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  body.addEventListener('drop', e => { e.preventDefault(); void load(e.dataTransfer.files); });
  const dialog = modal({ title: 'Import designs', body, wide: true, actions: [h('button', { class: 'btn', onClick: () => dialog.close() }, 'Cancel'), apply], onClose: () => { closed = true; clearURLs(); } });
  return dialog;
}
