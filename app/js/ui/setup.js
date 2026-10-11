// "Setup" view: the things behind the slides - devices and their canvas sizes, device frames, layout templates.

import { state, rememberUI } from '../store.js';
import { h } from './helpers.js';
import { buildProfilesView } from './profiles-view.js';
import { buildDevicesView } from './devices-view.js';
import { buildFramesView } from './frames-view.js';
import { buildTemplatesView } from './templates-view.js';

const TABS = [['devices', 'Canvases'], ['profiles', 'Device library'], ['frames', 'Frames'], ['templates', 'Saved designs']];

export function createSetup(ctx) {
  const el = h('div', { class: 'setup' });

  function build() {
    const current = TABS.some(([id]) => id === state.ui.setupTab) ? state.ui.setupTab : 'devices';
    const view = { devices: buildDevicesView, profiles: buildProfilesView, frames: buildFramesView, templates: buildTemplatesView }[current](ctx);
    el.replaceChildren(
      h('div', { class: 'setup-head' },
        h('h2', null, 'Setup'),
        h('div', { class: 'seg', role: 'tablist' }, TABS.map(([id, label]) => h('button', { role: 'tab', 'aria-pressed': String(id === current), onClick: () => { state.ui.setupTab = id; rememberUI(); build(); } }, label)))),
      h('div', { class: 'setup-body' }, view));
  }

  return { el, build, activate() {}, refresh: build, onResize() {} };
}
