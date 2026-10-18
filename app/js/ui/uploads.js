import { savedExports, exportMiniatures, exportSummary } from './saved-exports.js';
import { h, modal } from './helpers.js';
import { warningList } from './warnings.js';
import { openAppStoreUpload } from './app-store-connect.js';

function uploadSource(onContinue) {
  const desktop = typeof window.studioDesktop?.appStore === 'function';
  const result = h('div', { class: 'export-body', 'aria-live': 'polite' });
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });
  let selected = null, closed = false;
  const next = h('button', { class: 'btn primary', disabled: true, onClick: () => onContinue(selected.path) }, 'Continue to App Store Connect…');
  const choose = h('button', { class: 'btn', disabled: !desktop, onClick: async () => {
    choose.disabled = true; next.disabled = true; status.textContent = 'Choose an export folder. Its images will be checked before upload.';
    try {
      const value = await window.studioDesktop.appStore('choose-export');
      if (closed) return;
      if (!value.canceled) {
        archive.clearSelection();
        selected = value;
        result.replaceChildren(
          h('div', { class: 'label' }, value.name), exportMiniatures(value),
          h('details', { class: 'disclosure' }, h('summary', null, 'Folder location'), h('p', { class: 'path mono' }, value.path)),
          h('p', null, exportSummary(value)),
          h('div', { class: 'export-check-counts' }, h('span', { class: value.errors.length ? 'err' : 'ok' }, `${value.errors.length} technical errors`), h('span', { class: value.warnings.length ? 'warn' : 'ok' }, `${value.warnings.length} warnings`)),
          h('p', { class: 'hint' }, value.errors.length ? 'Fix the technical errors before uploading. You can choose another export folder.' : value.warnings.length ? 'You can choose to upload despite these warnings after reviewing the destination.' : 'Ready to choose your app and version.'),
          ...((value.errors.length || value.warnings.length) ? [h('div', { class: 'result-list' }, warningList([...value.errors, ...value.warnings]))] : []));
      }
      status.textContent = value.canceled ? 'Folder selection canceled.' : '';
    } catch (error) { if (!closed) { selected = null; result.replaceChildren(); status.textContent = error.message; } }
    finally { if (!closed) { choose.disabled = false; next.disabled = !selected || selected.errors.length > 0; } }
  } }, 'Choose export folder…');
  const archive = savedExports({ onSelect: run => { if (closed) return; selected = run; result.replaceChildren(); status.textContent = ''; next.disabled = !desktop || run.errors.length > 0; } });
  const el = h('section', { class: 'export-body upload-source' },
    h('h2', null, 'Upload to App Store Connect'),
    h('p', { class: 'hint' }, 'Choose a saved export, then pick your app and version.'),
    !desktop ? h('p', { class: 'warn' }, 'Direct upload is available in the Screenshot Studio Mac app.') : null,
    archive, result, status, h('div', { class: 'upload-source-actions' }, next, choose),
    h('details', { class: 'disclosure' }, h('summary', null, 'About uploads'),
      h('p', { class: 'hint' }, 'Choose an export folder with its images and manifest.json. You can accept text and layout warnings. Missing images and technical errors must be fixed before upload.')));
  return { el, close() { closed = true; } };
}

export function createUploads() {
  const el = h('div', { class: 'uploads' });
  let source;
  const build = () => { source?.close(); source = uploadSource(exportPath => openAppStoreUpload(exportPath)); el.replaceChildren(source.el); };
  build();
  return { el, build, refresh: build };
}

// Also available from Welcome / File, without an open project.
export function openSavedUpload() {
  const source = uploadSource(exportPath => { dialog.close(); openAppStoreUpload(exportPath); });
  const close = h('button', { class: 'btn', onClick: () => dialog.close() }, 'Close');
  const dialog = modal({ title: 'Upload saved screenshots', wide: true, body: source.el, actions: [close], onClose: source.close });
  return dialog;
}
