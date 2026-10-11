import { api } from '../store.js';
import { h } from './helpers.js';

export function fontPicker({ value, inherited, onChange }) {
  const select = h('select', { class: 'input', 'aria-label': 'Font', title: `Choose an installed font. Type a name in the open menu to jump to it. Project default: ${inherited}`, disabled: true,
    onChange: () => onChange(select.value || undefined) }, h('option', { value: value ?? '' }, value || 'Loading fonts…'));
  const status = h('div', { class: 'hint warn', role: 'status', hidden: true });
  async function load() {
    try {
      const { families, unavailable } = await api('/api/fonts');
      select.replaceChildren(h('option', { value: '' }, 'Project default'), ...families.map(family => h('option', { value: family }, family)));
      if (value && !families.includes(value)) select.append(h('option', { value }, `${value} (not installed)`));
      select.value = value ?? ''; select.disabled = false;
      if (unavailable) { status.textContent = unavailable; status.hidden = false; }
    } catch (error) {
      status.replaceChildren(document.createTextNode(error.message), h('button', { class: 'btn small', onClick: () => { status.hidden = true; void load(); } }, 'Retry'));
      status.hidden = false;
    }
  }
  void load();
  return h('div', { class: 'field' }, h('label', null, 'Font', select), status);
}
