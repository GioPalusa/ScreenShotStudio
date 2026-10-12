import { h, modal, selectInput } from './helpers.js';
import { warningList } from './warnings.js';
import { uploadScreenGroups } from '../upload-selection.js';

// Available only in the Mac app. Account secrets never enter the renderer or document.
export function openAppStoreUpload(exportPath) {
  const api = (operation, value) => window.studioDesktop.appStore(operation, value);
  const body = h('div', { class: 'export-body' });
  const source = h('div', { class: 'field' });
  const status = h('p', { class: 'hint', 'aria-live': 'polite' }, 'Loading connection…');
  const close = h('button', { class: 'btn' }, 'Close');
  const next = h('button', { class: 'btn primary', disabled: true }, 'Review screenshots');
  let destination = '';
  let closed = false, uploading = false, jobId, timer, appId = '', versionId = '', plan, mapping = {}, excludedImages = new Set(), replace = false, acknowledgeWarnings = false, generation = 0;
  const dialog = modal({ title: 'Upload to App Store Connect', wide: true, body: h('div', null, source, body, status), actions: [close, next], onClose: () => {
    closed = true; generation++; clearTimeout(timer);
    if (uploading && jobId) void api('stop', { id: jobId }).catch(() => {});
  } });
  close.addEventListener('click', () => dialog.close());
  const fail = error => { if (!closed) { status.className = 'err'; status.textContent = error.message; } };
  const say = message => { status.className = 'hint'; status.textContent = message; };
  const field = (label, control) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control);
  const invalidate = () => { generation++; plan = null; next.disabled = !versionId; next.textContent = 'Review screenshots'; };
  async function showApps(apps) {
    if (closed) return;
    appId = ''; versionId = ''; invalidate();
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
        say(versions.length ? 'Choose the app version that should receive these screenshots.' : 'No editable versions. Create a new version in App Store Connect first.');
      } catch (error) { fail(error); }
    } });
    body.replaceChildren(h('p', { class: 'hint' }, 'Languages, screen sizes and slide order come from the selected export.'),
      field('App', appSelect), versionHost,
      h('button', { class: 'btn small', onClick: async () => { try { await api('forget'); await connectForm(); } catch (error) { fail(error); } } }, 'Disconnect API key'));
    say(apps.length ? 'Choose an app.' : 'This API key has access to no apps. Check its permissions in App Store Connect.');
  }
  async function connectForm(settings = {}) {
    if (closed) return;
    next.disabled = true;
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
    body.replaceChildren(h('p', null, 'Connect your App Store Connect account'),
      h('p', { class: 'hint' }, 'In App Store Connect → Users and Access → Integrations, create an API key with permission to manage screenshots (for example, App Manager). Copy its Key ID and Issuer ID, then download the .p8 file. Leave Issuer ID empty for an individual API key.'),
      field('Key ID', keyId), field('Issuer ID', issuerId), connect,
      h('p', { class: 'hint' }, 'Your private key is stored in macOS Keychain. It stays outside your Screenshot Studio documents.'));
    say('Enter the key details to get started.');
  }
  async function review() {
    const mine = ++generation; plan = null; acknowledgeWarnings = false; next.disabled = true; say('Checking images, languages, accepted sizes and existing screenshots…');
    try {
      const result = await api('prepare', { appId, versionId, exportPath, mappings: mapping, excludedImages: [...excludedImages], replace });
      if (closed || mine !== generation) return;
      plan = result;
      const warnings = result.warnings ?? [];
      const updateUpload = () => {
        if (closed || mine !== generation) return;
        next.textContent = replace ? 'Replace and upload screenshots' : warnings.length ? 'Upload anyway' : 'Upload screenshots';
        next.disabled = Boolean(result.errors.length) || (warnings.length > 0 && !acknowledgeWarnings);
      };
      const accept = h('input', { type: 'checkbox', 'aria-label': 'I reviewed the warnings and want to upload anyway', onChange: e => { if (mine !== generation) return; acknowledgeWarnings = e.target.checked; updateUpload(); } });
      const assignments = h('div');
      for (const screen of result.screens ?? uploadScreenGroups(result.entries)) {
        const entry = screen.images[0], shared = screen.devices.length > 1;
        const label = shared ? screen.label : `${entry.canvas} · ${entry.size.join(' × ')} px`;
        const section = h('div', { class: 'asc-screen-group' }, field(label, selectInput({ title: `Apple screen group for ${shared ? screen.label : entry.canvas}`, value: screen.groupId, options: [['', screen.choices.length ? 'Choose an Apple screen group…' : 'No accepted Apple screen group'], ...screen.choices.map(g => [g.id, g.label])], onChange: value => { for (const device of screen.devices) mapping[device] = value; void review(); } })));
        if (shared) {
          section.append(h('p', { class: 'hint' }, `One screen group · ${screen.images.filter(i => i.selected !== false).length} / ${screen.maxCount} screenshots per language. Choose open, closed, or a mix. Your selection applies to every language.`));
          section.append(h('div', { class: 'row' }, screen.devices.map(device => h('button', { class: 'btn small', onClick: () => {
            for (const image of screen.images) { if (image.device === device) excludedImages.delete(image.key); else excludedImages.add(image.key); }
            void review();
          } }, `Use only ${screen.images.find(i => i.device === device).canvas}`))));
          section.append(h('div', { class: 'asc-preview' }, screen.images.map(image => h('label', { class: 'asc-preview-item' },
            h('input', { type: 'checkbox', checked: image.selected !== false, 'aria-label': `Include ${image.canvas} · ${image.slide} in every language`, onChange: event => { if (event.target.checked) excludedImages.delete(image.key); else excludedImages.add(image.key); void review(); } }),
            image.thumbnail ? h('img', { src: image.thumbnail, alt: `${image.canvas} · ${image.slide}` }) : null,
            h('span', null, `${image.canvas} · ${image.position}. ${image.slide}`)))));
        }
        assignments.append(section);
      }
      const replaceInput = h('input', { type: 'checkbox', checked: replace, onChange: () => { replace = replaceInput.checked; void review(); } });
      body.replaceChildren(
        h('p', { class: 'label' }, destination),
        h('p', null, `${result.entries.length} screenshots to upload · ${(result.locales ?? [...new Set(result.entries.map(e => e.locale))]).length} languages`),
        assignments,
        h('label', { class: 'row' }, replaceInput, 'Replace existing screenshots in the selected language and screen groups'),
        h('p', { class: replace ? 'warn' : 'hint' }, replace ? 'All existing screenshots in the groups below will be removed after Apple has received every new image. Apple continues processing the images after upload. Other languages and screen groups stay as they are. If stopped during replacement, some groups may be partially updated.' : 'Existing language and screen groups are kept. Upload all missing groups in every exported language. Enable replacement to update groups that already have screenshots.'),
        ...((result.keptGroups?.length ?? 0) ? [h('div', { class: 'result-list' }, result.keptGroups.map(g => h('p', null, `${g.locale} · ${g.label}: keeping ${g.existing} existing screenshots`)))] : []),
        h('div', { class: 'result-list' }, result.groups.map(g => h('p', null, `${g.locale} · ${g.label}: ${g.incoming} new, ${g.existing} existing${replace ? ' to replace' : ' to keep'}`))),
        h('div', { class: 'asc-preview' }, result.entries.map(e => h('div', { class: 'asc-preview-item' }, e.thumbnail ? h('img', { src: e.thumbnail, alt: `${e.locale} · ${e.slide}` }) : null, h('span', null, `${e.locale} · ${e.canvas} · ${e.position}. ${e.slide}`)))),
        ...(result.errors.length ? [h('div', { class: 'result-list err' }, result.errors.map(message => h('p', null, message)))] : []),
        ...(warnings.length ? [h('div', { class: 'export-readiness' }, h('div', { class: 'label' }, `${warnings.length} warnings — upload is your choice`), h('div', { class: 'result-list' }, warningList(warnings)), h('label', { class: 'row' }, accept, 'I reviewed the warnings and want to upload anyway'))] : []),
        h('button', { class: 'btn small', onClick: async () => { invalidate(); try { await showApps(await api('apps')); } catch (error) { fail(error); } } }, 'Change app or version'),
      );
      updateUpload();
      say(result.errors.length ? 'Resolve the technical errors above before uploading.' : 'Review the images and destinations above. Uploading updates this version’s screenshots; it does not submit the app for review.');
    } catch (error) { if (mine === generation) { plan = null; next.disabled = false; next.textContent = 'Review screenshots'; fail(error); } }
  }
  async function poll() {
    try {
      const job = await api('status', { id: jobId });
      if (closed) return;
      say(job.message);
      body.replaceChildren(
        ...(job.state === 'complete' ? [h('h3', null, 'Upload complete'), h('p', null, destination)] : []),
        ...(job.total ? [h('p', { class: 'label' }, `${job.uploaded} / ${job.total} screenshots received by Apple`)] : []),
        ...(job.locales ? [h('p', null, `${job.locales.length} languages · ${job.keptGroups?.length ?? 0} existing language/screen groups kept`)] : []),
        h('div', { class: 'result-list' }, job.files.map(f => h('p', null, `${f.locale} · ${f.filename} · ${f.state}`))),
      );
      if (job.state === 'running') { timer = setTimeout(poll, 1000); return; }
      uploading = false; close.textContent = 'Close';
      if (job.state !== 'complete') status.className = 'err';
      body.append(h('p', { class: 'hint' }, job.state === 'complete' ? 'Apple has received all screenshots, and their placement and order are confirmed. Check image processing and any further issues in App Store Connect. You can close this window.' : 'Some images or placements may already exist in App Store Connect. Review the report and the app version before uploading again. Stopping does not undo completed changes.'),
        h('button', { class: 'btn primary', onClick: () => api('open-app', { id: jobId }).catch(fail) }, 'Open App Store Connect'),
        h('button', { class: 'btn', onClick: () => api('report', { id: jobId }).catch(fail) }, 'Show upload report'));
      next.hidden = true;
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
      await poll();
    } catch (error) { plan = null; next.textContent = 'Review screenshots'; next.disabled = false; fail(error); }
  });
  void (async () => {
    try {
      const selected = await api('inspect-export', { exportPath });
      if (closed) return;
      source.replaceChildren(h('div', { class: 'label' }, selected.name), h('p', { class: 'hint' }, `${selected.count} screenshots · ${selected.locales.join(', ')}`));
      if (selected.errors.length) { body.replaceChildren(warningList(selected.errors)); say('This export has technical errors. Choose another export or fix the images before uploading.'); return; }
    } catch (error) { fail(error); return; }
    try {
      const settings = await api('settings');
      if (settings.connected) await showApps(await api('apps')); else await connectForm(settings);
    } catch (error) { await connectForm(); fail(error); }
  })();
  return dialog;
}
