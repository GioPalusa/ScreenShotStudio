import { h } from './helpers.js';

// SVG masks follow the current UI colour; icon licenses are in THIRD_PARTY_NOTICES.md.
export const icon = name => h('span', { class: 'sf-symbol', 'aria-hidden': 'true', style: { maskImage: `url("/app/icons/${name}.svg")` } });
export function iconButton(name, label, onClick, props = {}) {
  return h('button', { class: 'symbol-button', title: label, 'aria-label': label, onClick, ...props }, icon(name));
}
export function iconChoices({ label, options, value, onChange }) {
  const group = h('div', { class: 'symbol-choices', role: 'group', 'aria-label': label });
  for (const [id, name, title] of options) {
    const button = iconButton(name, title, () => {
      for (const other of group.children) other.setAttribute('aria-pressed', String(other === button));
      onChange(id);
    }, { 'aria-pressed': String(id === value) });
    group.append(button);
  }
  return group;
}
