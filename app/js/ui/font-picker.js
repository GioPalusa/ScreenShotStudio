import { api, engine } from '../store.js';
import { h } from './helpers.js';

const generic={'system-ui':'System font','sans-serif':'Sans serif',serif:'Serif',monospace:'Monospace','ui-serif':'System serif','ui-sans-serif':'System sans serif','ui-rounded':'System rounded'};
export function fontPicker({ value, inherited, onChange, mixed = false }) {
  let currentValue=value,isMixed=mixed;
  const select = h('select', { class: 'input', 'aria-label': 'Font', title: `Choose a project or installed font. Type a name in the open menu to jump to it. Project default: ${inherited}`, disabled: false,
    onChange: () => {isMixed=false;currentValue=select.value||undefined;onChange(currentValue);} }, h('option',{value:''},'Project default'),...(value?[h('option',{value},generic[value]??value)]:[]),...(mixed?[h('option',{value:'__mixed__',disabled:true},'Mixed')]:[]));
  select.value=mixed?'__mixed__':value??'';
  const status = h('div', { class: 'hint warn', role: 'status', hidden: true });
  async function load() {
    try {
      const { families, unavailable } = await api('/api/fonts');
      const embedded = new Set((engine.project.fonts?.files ?? []).map(font => font.family));
      const available = [...new Set([...families, ...embedded])].sort((a,b) => a.localeCompare(b));
      select.replaceChildren(h('option', { value: '' }, 'Project default'), ...available.map(family => h('option', { value: family }, `${family}${embedded.has(family) ? ' · project' : ''}`)));
      if(currentValue&&!available.includes(currentValue))select.append(h('option',{value:currentValue},generic[currentValue]??`${currentValue} (not installed)`));
      if(isMixed)select.prepend(h('option',{value:'__mixed__',disabled:true},'Mixed'));
      select.value = isMixed ? '__mixed__' : currentValue ?? ''; select.disabled = false;
      if (unavailable) { status.textContent = unavailable; status.hidden = false; }
    } catch (error) {
      status.replaceChildren(document.createTextNode(error.message), h('button', { class: 'btn small', onClick: () => { status.hidden = true; void load(); } }, 'Retry'));
      status.hidden = false;
    }
  }
  void load();
  return h('div', { class: 'field' }, h('label', null, 'Font', select), status);
}
