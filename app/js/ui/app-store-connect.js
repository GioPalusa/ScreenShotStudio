import { h, modal, selectInput } from './helpers.js';
import { icon } from './icons.js';
import { warningList } from './warnings.js';
import { exportContentsInfo, exportPreviews } from '../export-previews.js';
import { exportContents, transferSteps } from './export-contents.js';
import { uploadScreenGroups } from '../upload-selection.js';

// Available only in the Mac app. Account secrets never enter the renderer or document.
export function openAppStoreUpload(exportPath) {
  const api = (operation, value) => window.studioDesktop.appStore(operation, value);
  const body = h('div', { class: 'export-body' });
  const source = h('div', { class: 'upload-inventory' });
  const steps = h('div', null, transferSteps(1));
  let selectedExport;
  const showSource = () => { if (selectedExport) source.replaceChildren(exportContents(selectedExport), h('details', { class: 'disclosure' }, h('summary', null, 'Export details'), h('p', { class: 'hint' }, selectedExport.name))); };
  const status = h('p', { class: 'hint', 'aria-live': 'polite' }, 'Loading connection…');
  const close = h('button', { class: 'btn' }, 'Close');
  const next = h('button', { class: 'btn primary', disabled: true }, 'Review images');
  let destination = '';
  let closed = false, uploading = false, jobId, timer, appId = '', versionId = '', plan, mapping = {}, excludedImages = new Set(), replace = false, acknowledgeWarnings = false, generation = 0;
  const dialog = modal({ title: 'Upload to App Store Connect', wide: true, body: h('div', { class: 'upload-workflow' }, steps, source, body, status), actions: [close, next], onClose: () => {
    closed = true; generation++; clearTimeout(timer);
    if (uploading && jobId) void api('stop', { id: jobId }).catch(() => {});
  } });
  close.addEventListener('click', () => dialog.close());
  const fail = error => { if (!closed) { status.hidden = false; status.className = 'err'; status.textContent = error.message; } };
  const say = message => { status.className = 'hint'; status.textContent = message; };
  const field = (label, control) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control);
  const invalidate = () => { generation++; plan = null; next.disabled = !versionId; next.textContent = 'Review images'; };
  async function showApps(apps) {
    if (closed) return;
    appId = ''; versionId = ''; invalidate(); showSource(); steps.replaceChildren(transferSteps(1));
    const versionHost = h('div');
    const appSelect = selectInput({ title: 'App', value: '', options: [['', 'Choose an app…'], ...apps.map(a => [a.id, `${a.attributes.name} · ${a.attributes.bundleId}`])], onChange: async value => {
      appId = value; destination = apps.find(a => a.id === value)?.attributes.name ?? ''; versionId = ''; mapping = {}; invalidate(); versionHost.replaceChildren();
      if (!appId) return;
      const mine = generation; say('Loading editable versions…');
      try {
        const versions = await api('versions', { appId });
        if (closed || mine !== generation) return;
        const select = selectInput({ title: 'App version', value: '', options: [['', 'Choose a version…'], ...versions.map(v => [v.id, `${v.attributes.versionString} · ${v.attributes.platform} · ${v.attributes.appStoreState.replace(/_/g, ' ').toLowerCase()}`])], onChange: value => { versionId = value; const version = versions.find(v => v.id === value); destination = `${apps.find(a => a.id === appId)?.attributes.name ?? ''} · ${version?.attributes.versionString ?? ''} · ${version?.attributes.platform ?? ''}`; invalidate(); say('Review the selected export before uploading.'); } });
        versionHost.replaceChildren(field('Version', select));
        say(versions.length ? '' : 'No editable versions. Create a new version in App Store Connect first.');
      } catch (error) { fail(error); }
    } });
    body.replaceChildren(h('div', { class: 'settings-grid upload-destination' }, field('App', appSelect), versionHost),
      h('details', { class: 'disclosure' }, h('summary', null, 'Connection settings'), h('div', { class: 'disclosure-body' }, h('button', { class: 'btn small', onClick: async () => { try { await api('forget'); await connectForm(); } catch (error) { fail(error); } } }, 'Disconnect API key'))));
    say(apps.length ? '' : 'This API key has access to no apps. Check its permissions in App Store Connect.');
  }
  async function connectForm(settings = {}) {
    if (closed) return;
    appId = ''; versionId = ''; invalidate(); next.disabled = true; showSource(); steps.replaceChildren(transferSteps(1));
    const keyId = h('input', { class: 'input', 'aria-label': 'Key ID', placeholder: 'Key ID', value: settings.keyId ?? '', autocomplete: 'off', maxlength: 10 });
    const issuerId = h('input', { class: 'input', 'aria-label': 'Issuer ID', placeholder: 'Issuer ID', value: settings.issuerId ?? '', autocomplete: 'off', maxlength: 36 });
    const connect = h('button', { class: 'btn primary', onClick: async () => {
      connect.disabled = true; say('Choose your .p8 key file. The connection will be checked before it is saved.');
      try {
        const result = await api('connect', { keyId: keyId.value.trim(), issuerId: issuerId.value.trim() });
        if (closed) return;
        if (result.canceled) say('Connection canceled.'); else await showApps(result.apps);
      } catch (error) { fail(error); }
      finally { connect.disabled = false; }
    } }, 'Choose .p8 key and connect…');
    body.replaceChildren(h('h4', null, 'Connect your account'),
      h('div', { class: 'settings-grid' }, field('Key ID', keyId), field('Issuer ID (optional for individual keys)', issuerId)), h('div', null, connect),
      h('details', { class: 'disclosure' }, h('summary', null, 'Where to find your API key'), h('p', { class: 'hint' }, 'In App Store Connect → Users and Access → Integrations, create an API key with permission to manage screenshots (for example, App Manager). Copy its Key ID and Issuer ID, then download the .p8 file. Leave Issuer ID empty for an individual API key.')),
      h('p', { class: 'hint' }, 'Your private key is stored in macOS Keychain. It stays outside your Screenshot Studio documents.'));
    say('Enter the key details to get started.');
  }
  async function review() {
    const scroll = dialog.el.querySelector('.modal-body').scrollTop;
    const focusLabel = document.activeElement?.getAttribute('aria-label'), focusTitle = document.activeElement?.getAttribute('title');
    const openOptions = new Set([...body.querySelectorAll('details[open][data-option]')].map(node => node.dataset.option));
    const mine = ++generation; plan = null; acknowledgeWarnings = false; next.disabled = true; say('Checking images, languages, accepted sizes and existing screenshots…');
    try {
      const result = await api('prepare', { appId, versionId, exportPath, mappings: mapping, excludedImages: [...excludedImages], replace });
      if (closed || mine !== generation) return;
      plan = result;
      const warnings = result.warnings ?? [];
      const updateUpload = () => {
        if (closed || mine !== generation) return;
        next.textContent = replace ? 'Replace and upload images' : warnings.length ? 'Upload anyway' : 'Upload images';
        next.disabled = Boolean(result.errors.length) || (warnings.length > 0 && !acknowledgeWarnings);
      };
      const accept = h('input', { type: 'checkbox', 'aria-label': 'I reviewed the warnings and want to upload anyway', onChange: e => { if (mine !== generation) return; acknowledgeWarnings = e.target.checked; updateUpload(); } });
      steps.replaceChildren(transferSteps(2));
      const sample = exportPreviews(result.entries, Infinity);
      source.replaceChildren(h('div', { class: 'upload-target' }, icon('square.and.arrow.up'), h('strong', null, destination)), exportContents({ ...exportContentsInfo(result.entries), previews: sample.images, previewLocale: sample.locale }, { title: 'Images to upload' }));
      const assignments = h('div', { class: 'field' });
      for (const screen of result.screens ?? uploadScreenGroups(result.entries)) {
        const entry = screen.images[0], shared = screen.devices.length > 1;
        const label = shared ? screen.label : `${entry.canvas} · ${entry.size.join(' × ')} px`;
        const section = h('div', { class: 'asc-screen-group' }, field(label, selectInput({ title: `Apple screen group for ${shared ? screen.label : entry.canvas}`, value: screen.groupId, options: [['', screen.choices.length ? 'Choose an Apple screen group…' : 'No accepted Apple screen group'], ...screen.choices.map(g => [g.id, g.label])], onChange: value => { for (const device of screen.devices) mapping[device] = value; void review(); } })));
        if (shared) {
          section.append(h('p', { class: 'hint' }, `One screen group · ${screen.images.filter(i => i.selected !== false).length} / ${screen.maxCount} images per language. Choose open, closed, or a mix. Your selection applies to every language.`));
          section.append(h('div', { class: 'row' }, screen.devices.map(device => h('button', { class: 'btn small', onClick: () => {
            for (const image of screen.images) { if (image.device === device) excludedImages.delete(image.key); else excludedImages.add(image.key); }
            void review();
          } }, `Use only ${screen.images.find(i => i.device === device).canvas}`))));
        } else section.append(h('p', { class: 'hint' }, 'Screen choices apply to every language.'));
        section.append(h('div', { class: 'asc-preview' }, screen.images.map(image => h('label', { class: 'asc-preview-item' },
            h('input', { type: 'checkbox', checked: image.selected !== false, 'aria-label': `Include ${image.canvas} · ${image.slide} in every language`, onChange: event => { if (event.target.checked) excludedImages.delete(image.key); else excludedImages.add(image.key); void review(); } }),
            image.thumbnail ? h('img', { src: image.thumbnail, alt: `${image.canvas} · ${image.slide}` }) : null,
            h('span', null, `${image.position}. ${image.slide}`)))));
        assignments.append(section);
      }
      const replaceInput = h('input', { type: 'checkbox', checked: replace, onChange: () => { replace = replaceInput.checked; void review(); } });
      const mappings = h('details', { class: 'disclosure', dataset: { option: 'mapping' }, open: openOptions.has('mapping') || (result.screens ?? uploadScreenGroups(result.entries)).some(s => s.devices.length > 1 || !s.groupId) },
        h('summary', null, 'Screen selection and Apple sizes'), h('div', { class: 'disclosure-body' }, assignments));
      body.replaceChildren(
        ...((result.keptGroups?.length ?? 0) ? [h('div', { class: 'export-kept-notice' },
          h('strong', null, `${result.keptGroups.length} existing language and screen group${result.keptGroups.length === 1 ? '' : 's'} kept`),
          h('p', { class: 'hint' }, `${(result.locales ?? []).length} languages in this export. Only missing groups receive new images.`))] : []),
        h('label', { class: 'row' }, replaceInput, 'Replace existing images'),
        h('p', { class: replace ? 'warn' : 'hint' }, replace ? 'Existing images in the groups below are removed after Apple receives the new images. Stopping may leave some groups partially updated.' : 'Existing language and screen groups are kept. Enable replacement to update them.'),
        mappings,
        h('details', { class: 'disclosure', dataset: { option: 'destinations' }, open: openOptions.has('destinations') }, h('summary', null, 'Upload destinations'), h('div', { class: 'disclosure-body result-list' },
          (result.keptGroups ?? []).map(g => h('p', null, `${g.locale} · ${g.label}: keeping ${g.existing} existing screenshots`)),
          result.groups.map(g => h('p', null, `${g.locale} · ${g.label}: ${g.incoming} new, ${g.existing} existing${replace ? ' to replace' : ' to keep'}`)))),
        ...(result.errors.length ? [h('div', { class: 'result-list err' }, result.errors.map(message => h('p', null, message)))] : []),
        ...(warnings.length ? [h('div', { class: 'export-readiness' }, h('div', { class: 'label' }, `${warnings.length} warnings — upload is your choice`),
          h('details', { class: 'disclosure', dataset: { option: 'warnings' }, open: openOptions.has('warnings') }, h('summary', null, 'View warnings'), h('div', { class: 'result-list' }, warningList(warnings))),
          h('label', { class: 'row' }, accept, 'I reviewed the warnings and want to upload anyway'))] : []),
        h('div', null, h('button', { class: 'btn small', onClick: async () => { invalidate(); try { await showApps(await api('apps')); } catch (error) { fail(error); } } }, 'Change app or version')),
      );
      dialog.el.querySelector('.modal-body').scrollTop = scroll;
      if (focusLabel || focusTitle) [...body.querySelectorAll('input,select,button')].find(node => focusLabel ? node.getAttribute('aria-label') === focusLabel : node.getAttribute('title') === focusTitle)?.focus({ preventScroll: true });
      updateUpload();
      say(result.errors.length ? 'Resolve the technical errors above before uploading.' : 'Review the images and destinations above. Uploading updates this version’s images; it does not submit the app for review.');
    } catch (error) { if (mine === generation) { plan = null; next.disabled = false; next.textContent = 'Review images'; fail(error); } }
  }
  async function poll() {
    try {
      const job = await api('status', { id: jobId });
      if (closed) return;
      const running = job.state === 'running';
      const complete = job.state === 'complete' && Number.isInteger(job.total) && job.total >= 0 && job.uploaded === job.total;
      const detailsOpen = body.querySelector('details')?.open ?? false;
      source.hidden = true; steps.hidden = true;
      say(job.message);
      status.hidden = complete;
      body.className = 'export-body upload-transfer';
      body.replaceChildren(
        h('div', { class: `upload-outcome${complete ? ' success' : running ? '' : ' failed'}`, role: 'status', 'aria-live': 'polite' },
          h('span', { class: 'upload-outcome-icon', 'aria-hidden': 'true' }, complete ? '✓' : running ? '↑' : '!'),
          h('h3', null, complete ? 'Upload successful' : running ? 'Uploading to Apple' : job.state === 'stopped' ? 'Upload stopped' : 'Upload needs attention'),
          h('p', null, destination),
          complete ? h('p', { class: 'hint' }, job.total ? 'All images received. Placement and order confirmed.' : 'Existing images kept. No new images were needed.') : null),
        ...(job.total ? [h('p', { class: 'label' }, `${job.uploaded} / ${job.total} screenshots received by Apple`)] : []),
        ...(job.locales?.length ? [h('p', { class: 'hint' }, `${job.locales.length} languages${job.keptGroups?.length ? ` · ${job.keptGroups.length} existing groups kept` : ''}`)] : []),
        ...(running ? [h('progress', { class: 'upload-progress', max: job.total || 1, value: job.uploaded, 'aria-label': 'Images received by Apple' })] : []),
        h('details', { class: 'disclosure', open: detailsOpen }, h('summary', null, 'Transfer details'), h('div', { class: 'result-list' }, (job.files ?? []).map(f => h('p', null, `${f.locale} · ${f.filename} · ${f.state}`)))),
      );
      if (running) { timer = setTimeout(poll, 1000); return; }
      uploading = false; close.textContent = complete ? 'Done' : 'Close'; close.className = 'btn primary';
      if (!complete) status.className = 'err';
      body.append(h('p', { class: 'hint' }, complete ? 'Check image processing in App Store Connect. You can close this window.' : 'Some images may already be uploaded. Check App Store Connect before trying again.'),
        h('div', { class: 'row upload-result-actions' },
          h('button', { class: 'btn', onClick: () => api('open-app', { id: jobId }).catch(fail) }, 'Open App Store Connect'),
          h('button', { class: 'btn', onClick: () => api('report', { id: jobId }).catch(fail) }, 'Show upload report')));
      next.hidden = true;
      const title = complete ? 'Upload successful' : 'Upload to App Store Connect';
      dialog.el.querySelector('.modal-head h3').textContent = complete ? 'App Store Connect' : title;
      dialog.el.querySelector('[role="dialog"]').setAttribute('aria-label', title);
      dialog.el.querySelector('.modal-body').scrollTop = 0;
      close.focus({ preventScroll: true });
    } catch (error) { fail(error); if (!closed) timer = setTimeout(poll, 3000); }
  }
  next.addEventListener('click', async () => {
    if (uploading) { try { await api('stop', { id: jobId }); next.disabled = true; say('Stopping…'); } catch (error) { fail(error); } return; }
    if (!plan) { await review(); return; }
    next.disabled = true;
    try {
      const result = await api('start', { planId: plan.planId, acknowledgeWarnings }); jobId = result.id;
      if (closed) { await api('stop', { id: jobId }); return; }
      uploading = true; close.textContent = 'Stop and close'; next.textContent = 'Stop upload'; next.disabled = false;
      source.hidden = true; steps.hidden = true;
      body.replaceChildren(h('h3', null, 'Starting upload…'), h('p', { class: 'hint' }, destination));
      dialog.el.querySelector('.modal-body').scrollTop = 0;
      await poll();
    } catch (error) { plan = null; next.textContent = 'Review images'; next.disabled = false; fail(error); }
  });
  void (async () => {
    try {
      const selected = await api('inspect-export', { exportPath });
      if (closed) return;
      selectedExport = selected; showSource();
      if (selected.errors.length) { body.replaceChildren(warningList(selected.errors)); say('This export has technical errors. Choose another export or fix the images before uploading.'); return; }
    } catch (error) { fail(error); return; }
    try {
      const settings = await api('settings');
      if (settings.connected) await showApps(await api('apps')); else await connectForm(settings);
    } catch (error) { await connectForm(); fail(error); }
  })();
  return dialog;
}
