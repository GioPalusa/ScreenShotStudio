import { h } from './helpers.js';
let dismiss = () => {};

export function showContextMenu(event, items, { label = 'Layer actions' } = {}) {
  event.preventDefault(); event.stopPropagation(); dismiss();
  const previous = document.activeElement;
  const menu = h('div', { class: 'menu context-menu', role: 'menu', 'aria-label': label });
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus(); };
  const outside = e => { if (!menu.contains(e.target)) close(); };
  const buttons = items.map(item => h('button', { class: `menu-item${item.danger ? ' danger' : ''}`, role: 'menuitem', disabled: item.disabled, title: item.help ?? item.label, onClick: () => { close(); item.run(); } }, item.label));
  const enabled = () => buttons.filter(b => !b.disabled);
  const key = e => {
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const active = enabled(), current = active.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? active.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + active.length) % active.length;
      active[next]?.focus();
    }
  };
  menu.append(...buttons); document.body.append(menu);
  const x = event.clientX || previous?.getBoundingClientRect().left || 20, y = event.clientY || previous?.getBoundingClientRect().bottom || 20;
  Object.assign(menu.style, { left: `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`, top: `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px` });
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
  dismiss = close; enabled()[0]?.focus();
}
