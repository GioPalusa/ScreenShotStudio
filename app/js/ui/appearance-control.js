import '../appearance.js';
import { h, toast } from './helpers.js';
import { icon } from './icons.js';

if (typeof window !== 'undefined') window.addEventListener('studio:appearance', () => {
  document.querySelectorAll('[data-appearance-picker]').forEach(select => { select.value = window.studioAppearance.preference; });
});

export function appearanceControl() {
  const select = h('select', { class: 'input', 'aria-label': 'Appearance', title: 'App appearance', dataset: { appearancePicker: '' }, value: window.studioAppearance.preference, onChange: async () => {
    try { await window.studioAppearance.set(select.value); }
    catch (error) { select.value = window.studioAppearance.preference; toast(`Could not save appearance: ${error.message}`, { error: true }); }
  } }, ['system', 'light', 'dark'].map(mode => h('option', { value: mode }, mode[0].toUpperCase() + mode.slice(1))));
  // The value must be set after the options exist.
  select.value = window.studioAppearance.preference;
  return h('label', { class: 'appearance-control' }, icon('appearance'), select);
}
