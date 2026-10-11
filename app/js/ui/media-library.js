import { engine, state, uploadAsset, deleteAsset, assetUsage, uploadCapture, removeCapture, toPNG, checkpoint, saveStudio, frameUsage } from '../store.js';
import { captureItems, captureUsage, screenshotCollections } from '../media.js';
import { uniqueId, slugify } from '../layer-ops.js';
import { imageInfoFromUrl, pickFiles, imageFilesOf } from '../assets.js';
import { frameLabel } from '../frames.js';
import { openImportDesigns } from './import-designs.js';
import { h, modal, selectInput, confirmDialog, promptDialog, toast } from './helpers.js';

/** One project gallery, also used to choose image layers and device screenshots. */
export function openMediaLibrary({ kind = 'all', pick = null, localeId = state.ui.locale, collection = null, ctx = null, title = 'Media library' } = {}) {
  return new Promise(resolve => {
    const project = engine.project, projectId = state.projectId;
    let filter = kind, query = '', settled = false, busy = false;
    let set = collection ?? screenshotCollections(project, engine.data.captures)[0]?.id ?? 'iphone';
    let scope = 'default';
    const active = () => state.projectId === projectId && engine.project === project && !settled;
    const finish = value => { if (settled) return; settled = true; resolve(value); m.close(); };
    const grid = h('div', { class: 'media-grid' });
    const status = h('div', { class: 'hint', role: 'status' });
    const seriesOffer = h('div', { class: 'notice row wrap', hidden: true });
    const controls = h('div', { class: 'media-controls' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search media…', 'aria-label': 'Search media', onInput: e => { query = e.target.value.toLowerCase(); buildGrid(); } });
    const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Media type' });
    const navigateFrames = () => { finish(null); if (ctx) { state.ui.setupTab = 'frames'; ctx.setView('setup'); } };
    const urlFor = item => item.kind === 'images' ? engine.assetUrl('art', item.file) : item.kind === 'frames' ? engine.assetUrl('frames', item.name) : `${engine.projectURL}/captures/${item.scope}/${item.set}/${item.file}?v=${item.mtime}`;
    const labelFor = item => project.mediaNames?.[item.key] ?? (item.kind === 'frames' ? frameLabel({ type: 'bezel', name: item.name }, engine.data.frames) : (item.name ?? item.file.replace(/-[0-9a-f]{6}(?=\.)/, '')));
    async function choose(item) {
      if (!active() || busy) return;
      if (pick === 'images') {
        try { const info = await imageInfoFromUrl(urlFor(item)); if (active()) finish({ file: item.file, ...info }); }
        catch (error) { status.textContent = error.message; }
      } else if (pick === 'screenshots') finish(item);
      else modal({ title: labelFor(item), body: h('img', { class: 'media-preview', src: urlFor(item), alt: labelFor(item) }), wide: true });
    }
    function items() {
      return [
        ...(engine.data.assets?.art ?? []).map(item => ({ ...item, kind: 'images', key: `image:${item.file}` })),
        ...captureItems(engine.data.captures, pick === 'screenshots' ? localeId : null),
        ...Object.entries(engine.data.frames).map(([name, meta]) => ({ kind: 'frames', name, meta, key: `frame:${name}` })),
      ];
    }
    function buildGrid() {
      grid.replaceChildren();
      const entries = items().filter(item => (filter === 'all' || item.kind === filter) && (!pick || item.kind === pick) && (filter !== 'screenshots' || item.set === set) && `${labelFor(item)} ${item.set ?? ''} ${item.scope ?? ''}`.toLowerCase().includes(query));
      status.textContent = `${entries.length} item${entries.length === 1 ? '' : 's'} · stored in this project`;
      const sets = screenshotCollections(project, engine.data.captures);
      for (const item of entries) {
        const label = labelFor(item);
        const uses = item.kind === 'images' ? assetUsage(item.file).length : item.kind === 'screenshots' ? captureUsage(project, engine.data.captures, item).length : frameUsage(item.name).length;
        const detail = item.kind === 'screenshots' ? `${sets.find(s => s.id === item.set)?.label ?? item.set} · ${item.scope === 'default' ? 'Shared' : project.locales.find(l => l.id === item.scope)?.name ?? item.scope}` : item.kind === 'frames' ? `${item.meta.screen?.w ?? '?'} × ${item.meta.screen?.h ?? '?'} screen` : 'Image';
        const rename = async () => {
          const name = await promptDialog({ title: 'Rename media', label: 'Name', value: label, confirmLabel: 'Rename' });
          if (!active() || !name?.trim()) return;
          checkpoint(); (project.mediaNames ??= {})[item.key] = name.trim(); saveStudio(); buildGrid();
        };
        const remove = async () => {
          if (!active() || busy) return;
          if (!(await confirmDialog({ title: 'Delete unused media?', body: `“${label}” will be removed from this project. An automatic backup is kept.`, confirmLabel: 'Delete', danger: true })) || !active()) return;
          busy = true;
          try {
            if (item.kind === 'images') await deleteAsset(item.file);
            else await removeCapture({ scope: item.scope, device: item.set, name: item.name, unusedOnly: true });
            if (active()) { buildGrid(); toast('Media deleted'); }
          } catch (error) { status.textContent = error.message; }
          finally { busy = false; }
        };
        grid.append(h('article', { class: 'media-card' },
          h('button', { class: 'media-pick', title: pick ? `Use ${label}` : `Preview ${label}`, onClick: () => choose(item) }, h('div', { class: 'media-thumb' }, h('img', { src: urlFor(item), alt: label, loading: 'lazy' })), h('b', null, label)),
          h('small', { class: 'hint' }, detail), h('small', { class: 'hint' }, uses ? 'Used in project' : 'Not used yet'),
          h('div', { class: 'row' }, h('button', { class: 'btn small', onClick: rename }, 'Rename'), item.kind !== 'frames' ? h('button', { class: 'btn small danger', disabled: uses > 0, title: uses ? 'Remove layer references before deleting this media' : 'Delete unused media; an automatic backup is kept', onClick: remove }, 'Delete') : ctx ? h('button', { class: 'btn small', onClick: navigateFrames }, 'Manage frame…') : null)));
      }
      if (!entries.length) grid.append(h('p', { class: 'hint' }, query ? 'No matching media.' : 'Import files or drop them here to get started.'));
    }
    async function importFiles(files) {
      if (!active() || busy || !files.length) return;
      busy = true; let count = 0; const errors = [], imported = [];
      const importKind = filter === 'screenshots' || pick === 'screenshots' ? 'screenshots' : 'images';
      const target = { set, scope };
      try {
        for (const file of files) {
          if (!active()) break;
          status.textContent = `Importing ${file.name}…`;
          try {
            if (importKind === 'screenshots') {
              const png = await toPNG(file); if (!active()) break;
              const name = uniqueId(Object.keys(engine.data.captures[target.scope]?.[target.set] ?? {}), slugify(file.name.replace(/\.[^.]+$/, ''), 'screenshot'));
              await uploadCapture({ scope: target.scope, device: target.set, name, blob: png.blob, create: true });
              imported.push({ scope: target.scope, set: target.set, name, ...engine.data.captures[target.scope]?.[target.set]?.[name] });
            } else await uploadAsset(file);
            count++;
          } catch (error) { errors.push(`${file.name}: ${error.message}`); }
        }
      } finally { busy = false; }
      if (active()) {
        buildGrid(); if (count) toast(`${count} file${count === 1 ? '' : 's'} imported`); if (errors.length) status.textContent = errors.join(' · ');
        seriesOffer.hidden = imported.length < 2 || !ctx?.openConnectedSeries;
        if (!seriesOffer.hidden) seriesOffer.replaceChildren(
          h('span', null, `${imported.length} screenshots imported. Try a connected design.`),
          h('button', { class: 'btn primary', onClick: () => { finish(null); void ctx.openConnectedSeries({ captures: imported }); } }, 'Create screens from screenshots…'));
      }
    }
    function buildControls() {
      tabs.replaceChildren(...(pick ? [pick] : ['all', 'images', 'screenshots', 'frames']).map(value => h('button', { role: 'tab', 'aria-selected': String(filter === value), 'aria-pressed': String(filter === value), onClick: () => { if (busy) return; filter = value; buildControls(); buildGrid(); } }, ({ all: 'All', images: 'Images', screenshots: 'Screenshots', frames: 'Frames' })[value])));
      controls.replaceChildren(tabs, search);
      if (filter === 'frames') { if (ctx) controls.append(h('button', { class: 'btn primary', onClick: navigateFrames }, 'Import frames…')); return; }
      const screenshots = filter === 'screenshots';
      if (screenshots) controls.append(
        h('label', { class: 'media-select' }, 'Device', selectInput({ options: screenshotCollections(project, engine.data.captures).map(s => [s.id, s.label]), value: set, onChange: value => { set = value; buildGrid(); } })),
        h('label', { class: 'media-select' }, 'Import language', selectInput({ options: [['default', 'Shared · all languages'], ...(pick ? project.locales.filter(l => l.id === localeId) : project.locales).map(l => [l.id, l.name])], value: scope, onChange: value => { scope = value; } })));
      controls.append(h('button', { class: 'btn primary', title: 'Import multiple files. You can also drop images into the gallery.', onClick: async () => importFiles(await pickFiles({ multiple: true })) }, screenshots ? 'Import screenshots…' : 'Import images…'));
      if (ctx && !pick) controls.append(h('button', { class: 'btn', onClick: () => { finish(null); openImportDesigns(ctx); } }, 'Import designs…'));
    }
    const body = h('div', { class: 'media-library' }, controls, status, seriesOffer, grid);
    body.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    body.addEventListener('drop', e => { if (filter === 'frames') return; e.preventDefault(); void importFiles(imageFilesOf(e.dataTransfer.files)); });
    const m = modal({ title, body, wide: true, onClose: () => finish(null), actions: [h('button', { class: 'btn', onClick: () => finish(null) }, pick ? 'Cancel' : 'Done')] });
    buildControls(); buildGrid();
  });
}
