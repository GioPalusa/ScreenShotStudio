// Small UI toolkit: DOM builder, a render queue for canvases, toasts and modals.

import { engine } from '../store.js';

/** h('div', { class: 'x', onClick }, child, [children]...) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'textContent' || key === 'selected') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// canvas rendering queue

export const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
const queue = [];
let running = false;

/** Next animation frame, or a short timer when the page is hidden and frames are paused - the queue must keep moving. */
const nextFrame = () => new Promise((resolve) => {
  let done = false;
  const finish = () => { if (!done) { done = true; resolve(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 50);
});

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    try { await job(); } catch (err) { console.error(err); }
    await nextFrame();
  }
  running = false;
}

/**
 * Render a slide into `canvas` at a CSS width. Renders off-screen first and swaps only if this is still the
 * newest request for the canvas, so quick edits never flash an outdated frame.
 */
export function drawInto(canvas, { slideId, deviceId, localeId, width, priority = false, slide = null, allScreens = false }) {
  const token = (canvas._token = (canvas._token ?? 0) + 1);
  const job = async () => {
    if (canvas._token !== token) return;
    if (!canvas.isConnected) {
      // Built before its parent was added to the page (galleries, freshly built views): try again shortly.
      canvas._waits = (canvas._waits ?? 0) + 1;
      if (canvas._waits < 40) setTimeout(() => { if (canvas._token === token) { queue.push(job); pump(); } }, 40);
      return;
    }
    canvas._waits = 0;
    const scene = engine.scene(slideId, deviceId, localeId, { ...(slide ? { slide } : {}), allScreens });
    const scale = Math.max(0.02, (width * pixelRatio()) / scene.W);
    const off = document.createElement('canvas');
    const report = await engine.render(off, scene, { scale });
    if (canvas._token !== token) return;
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext('2d').drawImage(off, 0, 0);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${(width * scene.H) / scene.W}px`;
    canvas.dispatchEvent(new CustomEvent('rendered', { detail: { scene, report } }));
  };
  if (priority) queue.unshift(job); else queue.push(job);
  pump();
}

// ---------------------------------------------------------------------------------------------
// toasts + modal

let toastHost;
export function toast(message, { action, timeout = 5000, error = false } = {}) {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts' }));
  const el = h('div', { class: `toast${error ? ' err' : ''}` }, h('span', null, message));
  if (action) el.append(h('button', { onClick: () => { action.onClick(); el.remove(); } }, action.label));
  toastHost.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

export function modal({ title, body, actions = [], onClose, wide = false }) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape' || !backdrop.isConnected) return;
    // only the top-most dialog reacts
    const all = document.querySelectorAll('.modal-backdrop');
    if (all[all.length - 1] !== backdrop) return;
    e.stopPropagation();
    close();
  };
  document.addEventListener('keydown', onKey, true);
  const backdrop = h('div', { class: 'modal-backdrop', onMousedown: (e) => { if (e.target === backdrop) close(); } },
    h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'btn small icon', 'aria-label': 'Close', onClick: close }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('div', { class: 'modal-foot' }, actions) : null,
    ));
  document.body.append(backdrop);
  return { close, el: backdrop };
}

export const localeLabel = (locale) => (locale.native && locale.native !== locale.name && !locale.name.startsWith(locale.native) ? `${locale.name} · ${locale.native}` : locale.name);

export function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------------------------
// dialogs and small controls

/** Ask a yes/no question. Resolves true when confirmed. */
export function confirmDialog({ title, body, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); m.close(); };
    const ok = h('button', { class: `btn ${danger ? 'danger-fill' : 'primary'}`, onClick: () => finish(true) }, confirmLabel);
    const cancel = h('button', { class: 'btn', onClick: () => finish(false) }, cancelLabel);
    const m = modal({ title, body: typeof body === 'string' ? h('p', { class: 'modal-text' }, body) : body, actions: [cancel, ok], onClose: () => finish(false) });
    ok.focus();
  });
}

/** Ask for a line of text. Resolves the trimmed text, or null when cancelled. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'OK', hint = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; resolve(result); m.close(); };
    const input = h('input', { class: 'input', value, placeholder, style: { width: '100%' } });
    const ok = h('button', { class: 'btn primary', onClick: () => finish(input.value.trim() || null) }, confirmLabel);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim() || null); } });
    const m = modal({
      title,
      body: h('div', { class: 'field' }, label ? h('label', null, label) : null, input, hint ? h('div', { class: 'hint' }, hint) : null),
      actions: [h('button', { class: 'btn', onClick: () => finish(null) }, 'Cancel'), ok],
      onClose: () => finish(null),
    });
    input.focus();
    input.select();
  });
}

/** <select> from [[value, label], ...] (or { group, options } entries). */
export function selectInput({ options, value, onChange, title, class: cls = 'input' }) {
  const render = ([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label);
  const sel = h('select', { class: cls, title }, options.map((o) => (o.group ? h('optgroup', { label: o.group }, o.options.map(render)) : render(o))));
  sel.addEventListener('change', () => onChange?.(sel.value));
  return sel;
}

/** Segmented control: [[value, label, title?], ...]. */
export function segmented({ options, value, onChange, label }) {
  const buttons = options.map(([v, text, title]) => h('button', { type: 'button', title, 'aria-pressed': String(v === value), onClick: () => {
    for (const b of buttons) b.setAttribute('aria-pressed', 'false');
    buttons[options.findIndex(([x]) => x === v)].setAttribute('aria-pressed', 'true');
    onChange(v);
  } }, text));
  return h('div', { class: 'seg', role: 'group', 'aria-label': label }, buttons);
}

/** Number input that reports `onInput` while typing/stepping and `onChange` when done. Returns the <input>. */
export function numberInput({ value, min, max, step = 1, onInput, onChange, title, width }) {
  const input = h('input', { class: 'input num', type: 'number', value: value ?? '', min, max, step, title, style: width ? { width: `${width}px` } : undefined });
  const read = () => (input.value === '' ? null : Number(input.value));
  if (onInput) input.addEventListener('input', () => { const v = read(); if (v !== null && Number.isFinite(v)) onInput(v); });
  if (onChange) input.addEventListener('change', () => { const v = read(); if (v !== null && Number.isFinite(v)) onChange(v); });
  return input;
}

export const round1 = (v) => Math.round(v * 10) / 10;
export const pretty = (n) => (Number.isInteger(n) ? String(n) : String(round1(n)));

/** A button that opens a small menu. items: [{ value, label, hint?, disabled? }]. */
export function menuButton({ label, items, onPick, class: cls = 'btn small', title }) {
  const btn = h('button', { class: cls, type: 'button', title }, label);
  let menu = null;
  const close = () => { menu?.remove(); menu = null; document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('keydown', onKey, true); };
  const onOutside = (e) => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  btn.addEventListener('click', () => {
    if (menu) { close(); return; }
    menu = h('div', { class: 'menu', role: 'menu' }, items.map((item) => h('button', {
      class: 'menu-item', role: 'menuitem', type: 'button', disabled: item.disabled,
      onClick: () => { close(); onPick(item.value); },
    }, h('span', null, item.label), item.hint ? h('small', null, item.hint) : null)));
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    const width = menu.offsetWidth;
    Object.assign(menu.style, { left: `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`, top: `${r.bottom + 4}px` });
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });
  return btn;
}

/** A stable, collapsible property group; editor rebuilds preserve its open state. */
export function inspectorGroup(id, label, children, { open = true } = {}) {
  return h('details', { class: 'inspector-group', dataset: { section: id }, open },
    h('summary', null, label), h('div', { class: 'group-body' }, children));
}
