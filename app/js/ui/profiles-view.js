import { engine, checkpoint, saveStudio } from '../store.js';
import { profilesFor, availableProfilesFor } from '../profiles.js';
import { deviceProfileUsage, removeDeviceProfile } from '../project-ops.js';
import { screenshotCollections } from '../media.js';
import { uniqueId } from '../layer-ops.js';
import { h, numberInput, selectInput, modal, confirmDialog } from './helpers.js';
import { allFrames, frameKey, parseFrameKey, frameLabel } from '../frames.js';
import { frameThumbnail } from './frame-picker.js';

// A neutral screen for hardware previews, without a misleading missing-screenshot warning.
function profileThumbnail(profile) {
  const screen = h('canvas'); screen.width = screen.height = 96;
  const c = screen.getContext('2d'), gradient = c.createLinearGradient(0, 0, 96, 96);
  gradient.addColorStop(0, '#566780'); gradient.addColorStop(.5, '#27364e'); gradient.addColorStop(1, '#111b2c');
  c.fillStyle = gradient; c.fillRect(0, 0, 96, 96);
  return frameThumbnail(profile.frame ?? { type: 'plain' }, { screenSize: profile.screen, capture: screen });
}

export function buildProfilesView(ctx) {
  const root = h('div', { class: 'setup-section' });
  const project = engine.project;
  const profiles = availableProfilesFor(project, engine.data.frames);
  const gallery = h('div', { class: 'profile-grid' });
  const add = h('button', { class: 'btn primary', onClick: () => {
    const id = uniqueId([...Object.keys(profilesFor(project, engine.data.frames)), ...(project.removedProfiles ?? [])], 'device');
    editProfile(id, { label: 'Custom device', screen: [1080, 1920], capture: id, frame: { type: 'plain', screen: [1080, 1920], radius: 0 } }, add, true);
  } }, '＋ Add device');
  root.append(h('div', { class: 'setup-intro' },
    h('div', null, h('h3', null, 'Device library'), h('p', { class: 'hint' }, 'Built-in and custom devices available to this project. Edit their settings for this project.')), add), gallery);

  for (const [id, profile] of Object.entries(profiles)) {
    const edit = h('button', { class: 'btn small', 'aria-label': `Edit ${profile.label}`, onClick: () => editProfile(id, profile, edit) }, 'Edit');
    gallery.append(h('article', { class: 'profile-card', dataset: { profile: id } },
      h('div', { class: 'profile-thumb', role: 'img', 'aria-label': profile.label }, profileThumbnail(profile)),
      h('div', { class: 'profile-card-footer' }, h('b', null, profile.label), edit)));
  }

  function editProfile(id, profile, opener, isNew = false) {
    const draft = structuredClone(profile);
    const name = h('input', { class: 'input', 'aria-label': 'Device name', value: draft.label });
    const width = numberInput({ value: draft.screen[0], min: 100, max: 12000 });
    const height = numberInput({ value: draft.screen[1], min: 100, max: 12000 });
    width.setAttribute('aria-label', 'Screen width in pixels'); height.setAttribute('aria-label', 'Screen height in pixels');
    const collections = screenshotCollections(project, engine.data.captures).map(({ id, label }) => [id, label]);
    if (!collections.some(([id]) => id === draft.capture)) collections.push([draft.capture, `${draft.label} · own screenshots`]);
    const collection = selectInput({ options: collections, value: draft.capture });
    collection.setAttribute('aria-label', 'Screenshots from');
    const preview = h('div', { class: 'profile-thumb profile-edit-preview', role: 'img', 'aria-label': draft.label });
    const radius = numberInput({ value: draft.frame?.radius ?? 0, min: 0, max: Math.min(...draft.screen) / 2 });
    radius.setAttribute('aria-label', 'Screen corner radius');
    const radiusField = h('label', { class: 'field' }, 'Screen corner radius', radius);
    const status = h('p', { class: 'hint err', role: 'alert' });
    const readScreen = () => [Number(width.value), Number(height.value)];
    const updatePreview = () => {
      const screen = readScreen();
      if (!screen.every(n => Number.isInteger(n) && n >= 100 && n <= 12000)) return;
      draft.screen = screen;
      if (['plain', 'generic'].includes(draft.frame?.type)) draft.frame.screen = [...screen];
      if (draft.frame?.type === 'plain') draft.frame.radius = Math.max(0, Math.min(Number(radius.value) || 0, ...screen.map(n => n / 2)));
      radius.max = Math.min(...screen) / 2;
      radiusField.hidden = draft.frame?.type !== 'plain';
      preview.replaceChildren(profileThumbnail(draft));
    };
    for (const input of [width, height, radius]) input.addEventListener('change', updatePreview);
    const options = allFrames(engine.data.frames).map(f => [frameKey(f.ref), f.label]);
    const current = frameKey(draft.frame);
    if (!options.some(([key]) => key === current)) options.unshift([current, frameLabel(draft.frame, engine.data.frames)]);
    const frame = selectInput({ options, value: current, onChange: value => { draft.frame = parseFrameKey(value); updatePreview(); } });
    frame.setAttribute('aria-label', 'Default device frame');
    const save = h('button', { class: 'btn primary', onClick: () => {
      if (engine.project !== project) { status.textContent = 'The project changed. Reopen the device settings.'; return; }
      const screen = readScreen();
      if (!name.value.trim()) { status.textContent = 'Enter a device name.'; name.focus(); return; }
      if (!screen.every(n => Number.isInteger(n) && n >= 100 && n <= 12000)) { status.textContent = 'Enter screen dimensions from 100 to 12000 pixels.'; return; }
      const capture = collection.value;
      if (!collections.some(([id]) => id === capture)) { status.textContent = 'Choose where to get screenshots from.'; collection.focus(); return; }
      updatePreview();
      draft.label = name.value.trim(); draft.capture = capture;
      checkpoint(); project.profiles ??= {}; project.profiles[id] = draft;
      saveStudio(); engine.invalidate({ assets: false }); dialog.close(); ctx.go({});
    } }, isNew ? 'Add device' : 'Save changes');
    const remove = isNew ? null : h('button', { class: 'btn danger', onClick: async () => {
      if (engine.project !== project) return;
      const usage = deviceProfileUsage(project, id);
      const used = usage.length ? `Used in: ${usage.map(item => `${item.name} (${item.type})`).join(', ')}. Already placed devices will keep their appearance. ` : '';
      const confirmed = await confirmDialog({ title: `Remove ${profile.label} from the library?`, body: `${used}This removes it from this project's device choices. You can undo this change.`, confirmLabel: 'Remove device', danger: true });
      if (!confirmed || engine.project !== project || !availableProfilesFor(project, engine.data.frames)[id]) return;
      checkpoint(); removeDeviceProfile(project, id, engine.data.frames);
      saveStudio(); engine.invalidate({ assets: false }); dialog.close(); ctx.go({});
    } }, 'Remove…');
    const dialog = modal({ title: isNew ? 'Add device to library' : `Edit ${profile.label}`, body: h('div', { class: 'profile-editor' }, preview,
      h('div', { class: 'profile-edit-fields' }, h('label', { class: 'field' }, 'Name', name),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Screen size'), h('div', { class: 'row' }, width, '×', height, h('span', { class: 'hint' }, 'px'))),
        h('label', { class: 'field' }, 'Screenshots from', collection), h('label', { class: 'field' }, 'Default frame', frame), radiusField, status)),
      actions: [remove, h('span', { class: 'spacer' }), h('button', { class: 'btn', onClick: () => dialog.close() }, 'Cancel'), save],
      onClose: () => { if (opener.isConnected) opener.focus(); },
    });
    updatePreview(); name.focus();
  }
  return root;
}
