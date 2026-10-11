import { layerTag, normalizeTag } from '../layer-tags.js';
import { h, modal } from './helpers.js';

export function editLayerTag(ed, layer) {
  const input = h('input', { class: 'input', value: layerTag(layer), maxlength: 40, 'aria-label': 'Layer tag', placeholder: 'e.g. decoration, logo, background' });
  const apply = value => { ed.setLayer(ed.layerById(layer.id) ?? layer, { tag: normalizeTag(value) }, { rebuild: true }); dialog.close(); };
  const dialog = modal({ title: 'Layer tag', body: h('div', { class: 'field' }, input,
    h('div', { class: 'row wrap' }, ['decoration', 'logo', 'background'].map(tag => h('button', { class: 'btn small', onClick: () => { input.value = tag; input.focus(); } }, tag))),
    h('div', { class: 'hint' }, 'Tags help you organise layers. They do not lock a layer or change its design.')),
    actions: [h('button', { class: 'btn', onClick: () => apply('') }, 'Remove tag'), h('span', { class: 'spacer' }), h('button', { class: 'btn', onClick: () => dialog.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => apply(input.value) }, 'Save tag')] });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(input.value); } });
  input.focus(); input.select();
}
