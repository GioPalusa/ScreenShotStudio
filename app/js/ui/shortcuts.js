import { SHORTCUTS } from '../shortcuts.js';
import { h, modal } from './helpers.js';

export function openShortcuts() {
  if (document.querySelector('.modal-backdrop')) return;
  const groups = SHORTCUTS.map(([group, items]) => h('section', null,
    h('h4', null, group), h('dl', null, items.map(([key, label]) =>
      h('div', { class: 'shortcut-row' }, h('dt', null, label), h('dd', null, h('kbd', null, key)))))));
  modal({ title: 'Keyboard shortcuts', wide: true, body: h('div', null,
    h('p', { class: 'hint' }, 'Layer shortcuts work on the canvas and in the layer list. Text fields keep their normal editing keys. Use Control instead of Command on Windows.'),
    h('div', { class: 'shortcut-grid' }, groups)) });
}
