import { api, engine } from '../store.js';
import { h } from './helpers.js';

export function fontPicker({ value, inherited, onChange, mixed = false }) {
  const select = h('select', { class: 'input', 'aria-label': 'Font', title: `Choose a project or installed font. Type a name in the open menu to jump to it. Project default: ${inherited}`, disabled: true,
    onChange: () => onChange(select.value || undefined) }, h('option', { value: mixed ? '__mixed__' : value ?? '' }, mixed ? 'Mixed' : value || 'Loading fonts…'));
  const status = h('div', { class: 'hint warn', role: 'status', hidden: true });
  async function load() {
    try {
      const { families, unavailable } = await api('/api/fonts');
      const embedded = new Set((engine.project.fonts?.files ?? []).map(font => font.family));
      const available = [...new Set([...families, ...embedded])].sort((a,b) => a.localeCompare(b));
      select.replaceChildren(h('option', { value: '' }, 'Project default'), ...available.map(family => h('option', { value: family }, `${family}${embedded.has(family) ? ' · project' : ''}`)));
      if (value && !available.includes(value)) select.append(h('option', { value }, `${value} (not installed)`));
      if(mixed)select.prepend(h('option',{value:'__mixed__',disabled:true},'Mixed'));
      select.value = mixed ? '__mixed__' : value ?? ''; select.disabled = false;
      if (unavailable) { status.textContent = unavailable; status.hidden = false; }
    } catch (error) {
      status.replaceChildren(document.createTextNode(error.message), h('button', { class: 'btn small', onClick: () => { status.hidden = true; void load(); } }, 'Retry'));
      status.hidden = false;
    }
  }
  void load();
  return h('div', { class: 'field' }, h('label', null, 'Font', select), status);
}
