import { h } from './helpers.js';
import { openAppStoreUpload } from './app-store-connect.js';

export function exportMiniatures(run) {
  const previews = run.previews ?? [];
  return h('div', { class: 'export-miniatures' }, previews.length ? previews.map(preview => {
    const frame = h('span', { class: 'export-miniature' });
    const unavailable = () => frame.replaceChildren(h('span', { class: 'hint' }, 'Preview unavailable'));
    if (preview.src) frame.append(h('img', { src: preview.src, alt: preview.label, loading: 'lazy', decoding: 'async', onError: unavailable }));
    else unavailable();
    return frame;
  }) : h('span', { class: 'hint' }, 'Preview unavailable'),
  run.previewTotal > previews.length ? h('span', { class: 'export-preview-more' }, `+${run.previewTotal - previews.length}`) : null);
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
export function exportSummary(run) {
  return [plural(run.count, 'image'), plural(run.locales.length, 'language'), run.canvases.join(', ')].join(' · ');
}
let galleryId = 0;
/** Completed runs live with the document and are rediscovered after reopening. */
export function savedExports({ onSelect, onUpload } = {}) {
  const name = `saved-export-${++galleryId}`;
  let selected, autoSelect = true;
  const el = h('section', { class: 'saved-exports field', 'aria-label': 'Saved exports' }, h('h3', null, 'Saved exports'), h('p', { class: 'hint' }, 'Loading previews…'));
  el.clearSelection = () => { autoSelect = false; selected = null; el.querySelectorAll('input[type="radio"]').forEach(input => { input.checked = false; }); };
  fetch('/api/export-runs').then(async response => {
    if (!response.ok) throw new Error('Could not load saved exports.');
    const { runs } = await response.json();
    el.replaceChildren(h('h3', null, 'Saved exports'));
    if (!runs.length) { el.append(h('p', { class: 'hint' }, 'Your completed exports will appear here.')); return; }
    const gallery = h('div', { class: 'export-gallery', role: 'radiogroup', 'aria-label': 'Saved export' });
    const upload = h('button', { class: 'btn', disabled: true, onClick: () => { if (selected) (onUpload ?? openAppStoreUpload)(selected.path); } }, 'Upload saved export…');
    const select = run => { selected = run; upload.disabled = !window.studioDesktop?.appStore || run.errors.length > 0; onSelect?.(run); };
    const add = (run, index) => {
      const date = new Date(run.completed).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', year: 'numeric' });
      const input = h('input', { type: 'radio', name, value: run.path, 'aria-label': `${date} · ${exportSummary(run)}`, checked: index === 0 && autoSelect, onChange: () => select(run) });
      gallery.append(h('label', { class: 'export-choice' },
        h('span', { class: 'export-choice-heading' }, h('strong', null, date), input),
        exportMiniatures(run), h('span', { class: 'hint' }, exportSummary(run)),
        run.errors.length ? h('span', { class: 'err' }, `${plural(run.errors.length, 'technical error')} · Choose another export`) : run.warnings.length ? h('span', { class: 'warn' }, plural(run.warnings.length, 'warning')) : null));
    };
    runs.slice(0, 4).forEach(add);
    el.append(gallery);
    if (runs.length > 4) {
      const more = h('button', { class: 'btn', onClick: () => { runs.slice(4).forEach((run, i) => add(run, i + 4)); more.remove(); } }, `Show ${runs.length - 4} older exports`);
      el.append(h('div', null, more));
    }
    if (!onSelect) el.append(h('div', null, upload));
    if (autoSelect) select(runs[0]);
  }).catch(error => el.replaceChildren(h('p', { class: 'warn' }, error.message)));
  return el;
}
