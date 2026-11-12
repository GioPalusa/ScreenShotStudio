import { h } from './helpers.js';
let dismiss = () => {}, serial = 0;

/** Portalled menu levels avoid clipping at the canvas, inspector and window edges. */
export function showContextMenu(event, items, { label = 'Layer actions' } = {}) {
  event.preventDefault(); event.stopPropagation(); dismiss();
  const previous = document.activeElement, levels = [];
  let closed = false, search = '', searchedAt = 0;
  const enabled = level => level.buttons.filter(button => !button.disabled);
  const closeFrom = depth => {
    for (const level of levels.splice(depth).reverse()) {
      level.parent?.setAttribute('aria-expanded', 'false'); level.parent?.removeAttribute('aria-controls'); level.el.remove();
    }
  };
  const close = () => {
    if (closed) return; closed = true; closeFrom(0);
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', close); window.removeEventListener('blur', close);
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const outside = e => { if (!levels.some(level => level.el.contains(e.target))) close(); };
  const position = (el, x, y, parent) => {
    if (parent && x + el.offsetWidth > innerWidth - 8) x = parent.left - el.offsetWidth - 2;
    Object.assign(el.style, { left: `${Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8))}px`, top: `${Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8))}px` });
  };
  const openSubmenu = (depth, button, item, focus = false) => {
    if (button.disabled) return;
    if (levels[depth + 1]?.parent !== button) {
      closeFrom(depth + 1);
      const child = build(item.children, item.label, button), rect = button.getBoundingClientRect();
      levels.push(child); button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-controls', child.el.id);
      position(child.el, rect.right + 2, rect.top - 5, rect);
    }
    if (focus) enabled(levels[depth + 1])[0]?.focus();
  };
  function build(entries, name, parent = null) {
    const depth = levels.length, el = h('div', { id: `context-menu-${++serial}`, class: 'menu context-menu', role: 'menu', 'aria-label': name }), buttons = [];
    const level = { el, buttons, parent };
    for (const item of entries) {
      if (item.separator || item.type === 'separator') { el.append(h('div', { class: 'menu-separator', role: 'separator' })); continue; }
      const submenu = Array.isArray(item.children) && item.children.length > 0;
      const button = h('button', { type: 'button', class: `menu-item${item.danger ? ' danger' : ''}`, role: 'menuitem', disabled: item.disabled, title: item.help ?? item.label,
        ...(submenu ? { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } : {}),
        onPointerenter: () => { if (submenu && !button.disabled) openSubmenu(depth, button, item); else closeFrom(depth + 1); },
        onClick: () => { if (submenu) openSubmenu(depth, button, item, true); else { close(); item.run?.(); } },
      }, h('span', null, item.label), submenu ? h('span', { class: 'submenu-arrow', 'aria-hidden': 'true' }, '›') : item.shortcut ? h('small', { 'aria-hidden': 'true' }, item.shortcut) : null);
      button.menuItem = item; buttons.push(button); el.append(button);
    }
    el.addEventListener('scroll',()=>closeFrom(depth+1));
    document.body.append(el); return level;
  }
  const key = e => {
    const focused = document.activeElement, depth = levels.findIndex(level => level.el.contains(focused)), level = levels[Math.max(0, depth)];
    if (!level) return;
    e.stopPropagation();
    if (e.key === 'Tab') { e.preventDefault(); close(); return; }
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (levels.length > 1) { const parent = levels.at(-1).parent; closeFrom(levels.length - 1); parent?.focus(); }
      else if (e.key === 'Escape') close();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault(); if (focused?.menuItem?.children) openSubmenu(Math.max(0, depth), focused, focused.menuItem, true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); closeFrom(Math.max(0, depth) + 1);
      const active = enabled(level), current = active.indexOf(focused);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? active.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + active.length) % active.length;
      active[next]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focused?.click(); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); const now = Date.now(); search = now - searchedAt > 700 ? e.key : search + e.key; searchedAt = now;
      enabled(level).find(button => button.menuItem.label.toLowerCase().startsWith(search.toLowerCase()))?.focus();
    } else e.preventDefault();
  };
  const root = build(items, label); levels.push(root);
  position(root.el, event.clientX ?? previous?.getBoundingClientRect().left ?? 20, event.clientY ?? previous?.getBoundingClientRect().bottom ?? 20);
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
  window.addEventListener('resize', close); window.addEventListener('blur', close);
  dismiss = close; enabled(root)[0]?.focus();
  return { close, el: root.el };
}
