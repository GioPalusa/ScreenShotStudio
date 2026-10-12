import { layerTag } from '../layer-tags.js';
import { editLayerTag } from './layer-tag.js';
import { checkControl } from './review-check.js';
// Inspector → Layers: everything on the slide as a stack (front at the top), what you can add to it, and the
// properties of the selected layer - position and size, rotation, opacity, shadow and the settings of its type.

import { engine, checkpoint, saveStudio } from '../store.js';
import { paintOrder } from '../layouts.js';
import { layerLabel, removedLayerIds, restoreLayer, placeRelativeTo, stepLayer } from '../layer-ops.js';
import { frameLabel } from '../frames.js';
import { frameTarget, framesForTarget } from '../frame-matching.js';
import { h, segmented, selectInput, numberInput, menuButton, round1, inspectorGroup } from './helpers.js';
import { openImagePicker } from './image-picker.js';
import { paletteSwatches } from './palettes.js';
import { fontPicker } from './font-picker.js';

import { icon, iconButton, iconChoices } from './icons.js';

const ICONS = { device: 'iphone', text: 'textformat', art: 'photo', shape: 'square', route: 'line.3.horizontal' };
const aspectLocks = new Map(); // layer id -> boolean (images lock to their proportions unless you unlock them)

export function buildLayersPanel(ed, { detailsOnly = false } = {}) {
  const scene = ed.scene;
  const panel = h('div', { class: 'panel' });
  if (!scene) return { el: panel };
  const all = scene.allLayers;
  const selected = all.find((l) => l.id === ed.selectedId) ?? null;
  const geomInputs = {};
  const renamers = new Map();
  /** The layer as it is *now*: sliders keep changing it without rebuilding this panel, so handlers must not trust the object they were built with. */
  const current = (layer) => ed.layerById(layer.id) ?? layer;
  const live = () => ed.scene?.allLayers ?? all;

  // ----- header: add buttons
  const hasField = (field) => all.some((l) => l.type === 'text' && l.field === field);
  if (!detailsOnly) panel.append(h('div', { class: 'row wrap add-row' },
    h('button', { class: 'btn small', onClick: () => ed.addImage() }, '＋ Image'),
    menuButton({ label: '＋ Shape', items: [{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }], onPick: (shape) => ed.addLayer('shape', { shape }) }),
    h('button', { class: 'btn small', onClick: () => ed.addLayer('device') }, '＋ Device'),
    menuButton({ label: '＋ Text', items: [
      { value: 'headline', label: 'Headline', disabled: hasField('headline'), hint: hasField('headline') ? 'already here' : '' },
      { value: 'caption', label: 'Sub text', disabled: hasField('caption'), hint: hasField('caption') ? 'already here' : '' },
      { value: 'bullets', label: 'Bullet list', disabled: hasField('bullets'), hint: hasField('bullets') ? 'already here' : '' },
      { value: 'text', label: 'Extra text', hint: 'its own field' },
    ], onPick: (kind) => ed.addLayer(kind) }),
  ));

  // ----- the stack
  const list = h('div', { class: 'layer-list', role: 'listbox', 'aria-label': 'Layers, front to back', 'aria-multiselectable': 'true' });
  const ordered = paintOrder(all).reverse();
  if (!detailsOnly) {
    for (const layer of ordered) list.append(row(layer));
    panel.append(list);
  }
  const selection = ed.selectionLayers().filter(layer => !layer.locked && layer._box);
  const alignment = () => h('div', { class: 'alignment-tools', role: 'group', 'aria-label': selection.length > 1 ? 'Align selected layers' : 'Align to canvas' },
    [['left', 'align.horizontal.left', 'Align left'], ['center-x', 'align.horizontal.center', 'Centre horizontally'], ['right', 'align.horizontal.right', 'Align right'],
      ['top', 'align.vertical.top', 'Align top'], ['center-y', 'align.vertical.center', 'Centre vertically'], ['bottom', 'align.vertical.bottom', 'Align bottom'],
      ['distribute-x', 'distribute.horizontal.center', 'Distribute horizontally'], ['distribute-y', 'distribute.vertical.center', 'Distribute vertically']]
      .map(([op, symbol, label]) => iconButton(symbol, `${label}${op.startsWith('distribute') ? ' · select at least three layers' : selection.length > 1 ? ' · within selection' : ' · on canvas'}`, () => ed.arrange(op), { disabled: selection.length < (op.startsWith('distribute') ? 3 : 1) })));
  if (selection.length > 1) panel.append(inspectorGroup('selection', `${selection.length} layers selected`, [alignment(),
    h('div', { class: 'row' }, iconButton('rectangle.3.group', 'Group selected layers · ⌘G', () => ed.groupSelection()),
      iconButton('square.dashed', 'Ungroup selected layers · ⇧⌘G', () => ed.groupSelection(true), { disabled: !selection.some(layer => layer.group) }))]));

  const removed = removedLayerIds(ed.peekBlock());
  if (!detailsOnly && removed.length) {
    panel.append(h('div', { class: 'hint row wrap' }, 'Removed from this layout:', removed.map((id) => h('button', { class: 'btn small', title: 'Bring it back', onClick: () => { checkpoint(); restoreLayer(ed.block(), id); saveStudio(); ed.refresh({ immediate: true, inspector: true }); } }, `↺ ${id}`))));
  }

  function row(layer) {
    const label = layerLabel(layer, { captureLabel: layer.capture });
    const grip = iconButton('line.3.horizontal', `Reorder ${label} · drag, or Option + Up/Down`, e => e.stopPropagation(), { class: 'icon-btn layer-grip', draggable: 'false', disabled: Boolean(layer.locked) });
    grip.addEventListener('keydown', e => {
      if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      ed.restack(block => stepLayer(block, live(), layer.id, e.key === 'ArrowUp' ? 1 : -1));
    });
    const el = h('div', {
      class: `layer-row${layer.hidden ? ' off' : ''}`, role: 'option', 'aria-selected': String(ed.selectedIds.has(layer.id) || layer.id === ed.selectedId), dataset: { id: layer.id }, draggable: 'false',
      onClick: e => {
        if (e.target.closest('input, button')) return;
        if (!e.shiftKey && !e.altKey && ed.selectedId === layer.id && ed.selectedIds.size <= 1) rename();
        else ed.select(layer.id, { toggle: e.shiftKey, individual: e.altKey });
      },
      onContextmenu: e => { ed.layerMenu(e, layer); },
      tabIndex: 0,
      onKeydown: e => { if (e.target.closest('input, button')) return; if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); rename(); } },
    },
      grip,
      h('button', { class: 'icon-btn', title: layer.hidden ? 'Show' : 'Hide', 'aria-label': layer.hidden ? 'Show layer' : 'Hide layer', onClick: (e) => { e.stopPropagation(); ed.setLayer(layer, { hidden: layer.hidden ? undefined : true }, { rebuild: true }); } }, icon(layer.hidden ? 'eye.slash' : 'eye')),
      h('span', { class: `layer-icon ${layer.type}` }, icon(ICONS[layer.type] ?? 'square')),
      h('span', { class: 'layer-name', title: `${label} · Click again when selected to rename` }, label),
      h('button', { class: `tag layer-tag${layerTag(layer) ? '' : ' empty'}`, title: 'Add, change or remove the layer tag', 'aria-label': `Tag for ${label}: ${layerTag(layer) || 'none'}`, onClick: e => { e.stopPropagation(); editLayerTag(ed, current(layer)); } }, layerTag(layer) || '+ tag'),
      h('button', { class: `icon-btn lock${layer.locked ? ' on' : ''}`, title: layer.locked ? 'Unlock' : 'Lock (cannot be selected on the preview)', 'aria-label': layer.locked ? 'Unlock layer' : 'Lock layer', onClick: (e) => { e.stopPropagation(); ed.setLayer(layer, { locked: layer.locked ? undefined : true }, { rebuild: true }); } }, icon(layer.locked ? 'lock' : 'lock.open')),
    );
    function rename() {
      if (el.querySelector('input')) return;
      const node = el.querySelector('.layer-name');
      const input = h('input', { class: 'input layer-rename', value: layer.name ?? label, 'aria-label': 'Layer name', title: 'Rename this layer. Enter saves; Escape cancels.' });
      const project = engine.project, slide = ed.slide(), deviceId = ed.deviceId(), localeId = ed.locale().id;
      let done = false;
      const finish = commit => {
        if (done) return; done = true;
        const value = input.value.trim();
        node.replaceChildren(document.createTextNode(commit && value ? value : label)); grip.disabled = Boolean(layer.locked);
        if (commit && engine.project === project && ed.slide() === slide && ed.deviceId() === deviceId && ed.locale().id === localeId && value !== (layer.name ?? label)) ed.setLayer(current(layer), { name: value || undefined }, { rebuild: true });
      };
      input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish(e.key === 'Enter'); } });
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('pointerdown', e => e.stopPropagation());
      node.replaceChildren(input); grip.disabled = true; input.focus(); input.select();
    }
    renamers.set(layer.id, rename);
    let drag = null;
    const clearDrop = () => { for (const row of list.children) row.classList.remove('drop-before', 'drop-after'); };
    const cancelDrag = () => {
      const pointerId = drag?.pointerId;
      drag = null; clearDrop();
      if (pointerId !== undefined && grip.hasPointerCapture?.(pointerId)) grip.releasePointerCapture(pointerId);
      document.removeEventListener('keydown', cancelOnEscape, true);
      document.removeEventListener('pointerup', finishDrag, true);
    };
    const cancelOnEscape = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelDrag(); } };
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || current(layer).locked) return;
      e.preventDefault(); e.stopPropagation();
      grip.focus({ preventScroll: true });
      drag = { pointerId: e.pointerId, startY: e.clientY, project: engine.project, target: null };
      grip.setPointerCapture?.(e.pointerId);
      document.addEventListener('keydown', cancelOnEscape, true);
      document.addEventListener('pointerup', finishDrag, true);
    });
    grip.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.pointerId || Math.abs(e.clientY - drag.startY) < 4) return;
      e.preventDefault(); clearDrop(); drag.target = null;
      const bounds = panel.getBoundingClientRect();
      if (e.clientY < bounds.top + 36) panel.scrollTop -= 14;
      else if (e.clientY > bounds.bottom - 36) panel.scrollTop += 14;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.layer-row');
      if (!target || !list.contains(target) || target === el) return;
      const below = e.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
      target.classList.add(below ? 'drop-after' : 'drop-before');
      drag.target = { id: target.dataset.id, where: below ? 'behind' : 'front' };
    });
    const finishDrag = e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { target, project } = drag;
      cancelDrag();
      if (target && el.isConnected && engine.project === project && !current(layer).locked) ed.restack(block => placeRelativeTo(block, live(), layer.id, target.id, target.where));
    };
    grip.addEventListener('pointerup', finishDrag);
    grip.addEventListener('dragstart', e => e.preventDefault());
    grip.addEventListener('pointercancel', cancelDrag);
    grip.addEventListener('lostpointercapture', cancelDrag);
    return el;
  }

  // ----- the selected layer
  if (selected && (!detailsOnly || ed.selectedIds.size <= 1)) panel.append(properties(selected));
  else if (!detailsOnly) panel.append(h('div', { class: 'hint empty-hint' }, 'Select a layer to edit. Drag its handle to reorder.'));

  // ---------------------------------------------------------------------------------------------

  function properties(layer) {
    const box = h('div', { class: 'layer-props' });

    if (!detailsOnly && layer.type === 'text' && layer.field) box.append(checkControl(ed.locale().id, ed.slide().id, layer.field, () => ed.refresh({ inspector: true })));

    if (layer.locked) box.append(h('div', { class: 'hint warn' }, 'Locked: it cannot be selected on the preview. Unlock it in the list to move it.'));

    // a hidden layer is not drawn, so it has no measured box: it can be styled but not placed until it is shown again
    const position = layer._box ? inspectorGroup('position', 'Position', [selection.length <= 1 ? alignment() : null, geometry(layer)]) : null;
    if (position && !detailsOnly) box.append(position);
    if (!position) box.append(h('div', { class: 'hint warn' }, layer.hidden ? 'Hidden: switch it back on (the dot in the list) to move and resize it on the preview.' : 'This layer is not on the canvas.'));
    if (!detailsOnly && layer.type === 'device') box.append(inspectorGroup('style', 'Device', deviceFields(layer)));
    if (layer.type === 'art') box.append(inspectorGroup('style', 'Image', imageFields(layer)));
    if (layer.type === 'shape') box.append(inspectorGroup('style', 'Shape', shapeFields(layer)));
    if (layer.type === 'text') box.append(inspectorGroup('style', 'Typography', textFields(layer)));
    if (position && detailsOnly) box.append(position);
    box.append(inspectorGroup('appearance', 'Appearance', appearance(layer)));
    box.append(inspectorGroup('export', 'Export checks', h('div', { class: 'field' },
      [['allowCrop', 'Cropping outside the canvas is intentional'], ['allowUpscale', 'Image enlargement is intentional'], ...(layer.type === 'device' ? [['languageNeutral', 'Shared screenshot is language-neutral']] : [])].map(([key, label]) => h('label', { class: 'row check' }, h('input', { type: 'checkbox', checked: Boolean(layer[key]), onChange: e => ed.setLayer(layer, { [key]: e.target.checked || undefined }) }), label))), { open: false }));
    box.append(actions(layer));
    return box;
  }

  // ----- position and size

  function geometry(layer) {
    const b = layer._box;
    const isText = layer.type === 'text';
    const isDevice = layer.type === 'device';
    const canRotate = true;
    const unlockable = layer.type === 'art' || layer.type === 'shape';
    const isLocked = () => (isDevice ? true : aspectLocks.get(layer.id) ?? (layer.type === 'art'));

    const fresh = () => ed.layerById(layer.id);
    const apply = (key, value, done) => {
      const cur = fresh()?._box;
      if (!cur) return;
      const locked = isLocked();
      const nb = { ...cur };
      const aspect = cur.w / cur.h;
      if (key === 'x') nb.x = value;
      else if (key === 'y') nb.y = value;
      else if (key === 'rot') nb.rot = value;
      else if (key === 'w') { nb.w = Math.max(8, value); if (locked && !isText) nb.h = nb.w / aspect; }
      else if (key === 'h') { nb.h = Math.max(8, value); if (locked) nb.w = nb.h * aspect; }
      ed.startEdit(`geom:${layer.id}`);
      ed.applyBox(fresh(), nb, { vertical: key !== 'w' || locked });
      if (done) ed.finishEdit({ quick: true });
    };
    const field = (key, label, value, { disabled = false, step = 1 } = {}) => {
      const input = numberInput({ value: round1(value), step, title: ({ x: 'Horizontal position in canvas pixels', y: 'Vertical position in canvas pixels', w: 'Layer width in canvas pixels', h: 'Layer height in canvas pixels', rot: 'Rotation in degrees. You can also drag the round handle above the selected layer.' })[key], onInput: (v) => apply(key, v, false), onChange: (v) => apply(key, v, true) });
      input.disabled = disabled;
      geomInputs[key] = input;
      return h('label', { class: 'geom' }, h('span', null, label), input);
    };
    const grid = h('div', { class: 'geom-grid' },
      field('x', 'X', b.x), field('y', 'Y', b.y),
      field('w', 'W', b.w), field('h', 'H', b.h),
      canRotate ? field('rot', 'Rotate °', b.rot ?? 0) : null,
    );
    const keep = unlockable ? h('label', { class: 'row check' }, h('input', { type: 'checkbox', checked: isLocked(), onChange: (e) => { aspectLocks.set(layer.id, e.target.checked); } }), 'Lock proportions') : null;
    return h('div', { class: 'field', title: 'Position and size in canvas pixels. Arrow keys nudge; Shift moves 10 px. Alt resizes from the centre.' }, grid, keep,
      isText ? h('button', { class: 'btn small', onClick: () => ed.setLayer(layer, { boxHeight: undefined, textFit: undefined }, { rebuild: true }) }, 'Auto text height') : null);
  }

  // ----- opacity and shadow

  function appearance(layer) {
    const opacity = layer.opacity ?? 1;
    const op = h('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round(opacity * 100) });
    const opNum = h('output', { class: 'mono' }, `${Math.round(opacity * 100)}%`);
    op.addEventListener('input', () => { opNum.textContent = `${op.value}%`; ed.setLayer(current(layer), { opacity: Number(op.value) / 100 }, { key: `opacity:${layer.id}` }); });
    const wrap = h('div', { class: 'field' }, h('label', null, 'Opacity'), h('div', { class: 'row' }, op, opNum));

    if (layer.type !== 'text' && layer.type !== 'route') {
      const shadow = layer.shadow;
      const toggle = h('input', { type: 'checkbox', checked: Boolean(shadow) });
      toggle.addEventListener('change', () => ed.setLayer(current(layer), { shadow: toggle.checked ? { color: '#000000', alpha: 0.3, blur: 50, dy: 24 } : undefined }, { rebuild: true }));
      wrap.append(h('label', { class: 'row check' }, toggle, 'Shadow'));
      if (shadow) {
        const slider = (label, key, min, max, fmt = (v) => v) => {
          const input = h('input', { type: 'range', min, max, step: key === 'alpha' ? 0.01 : 1, value: shadow[key] ?? (key === 'alpha' ? 0.3 : 0) });
          const out = h('output', { class: 'mono' }, fmt(Number(input.value)));
          input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); ed.setLayer(current(layer), { shadow: { ...current(layer).shadow, [key]: Number(input.value) } }, { key: `shadow:${key}:${layer.id}` }); });
          return h('div', { class: 'row shadow-row' }, h('span', null, label), input, out);
        };
        const color = h('input', { type: 'color', value: (shadow.color ?? '#000000').slice(0, 7) });
        color.addEventListener('input', () => ed.setLayer(current(layer), { shadow: { ...current(layer).shadow, color: color.value } }, { key: `shadow:color:${layer.id}` }));
        wrap.append(h('div', { class: 'row' }, h('span', { class: 'label' }, 'Colour'), color),
          slider('Strength', 'alpha', 0, 1, (v) => `${Math.round(v * 100)}%`), slider('Blur', 'blur', 0, 200), slider('Drop', 'dy', -100, 200));
      }
    }
    return wrap;
  }

  // ----- by type

  function deviceFields(layer) {
    const frame = engine.frameRefFor(scene.deviceDef, layer);
    const target = frameTarget(engine.project, scene.deviceDef, layer, engine.data.frames);
    const matches = framesForTarget(target, engine.data.frames).filter(option => option.fit.kind === 'exact').length;
    return h('div', { class: 'field' }, h('label', null, 'Frame & screenshot'),
      h('div', { class: 'hint' }, `${target.label} · ${frame.type === 'plain' ? 'No hardware frame' : frameLabel(frame, engine.data.frames)}`),
      matches ? h('span', { class: 'chip ok' }, `${matches} matching ${matches === 1 ? 'frame' : 'frames'} available`) : null,
      h('button', { class: 'btn inspector-destination', title: 'Open frame and screenshot details for this layer', onClick: () => { ed.setTab('details'); ed.panel?.focusFrame?.(); } },
        h('span', null, 'Edit device details'), h('span', { 'aria-hidden': 'true' }, '→')));
  }

  function imageFields(layer) {
    const locale = ed.locale();
    const variants = layer.variants ?? {};
    const own = variants[locale.id];
    const preview = detailsOnly && layer.src ? h('img', { class: 'details-image-preview', src: engine.assetUrl('art', engine.artSource(layer, locale)), alt: layerLabel(layer) }) : null;
    const replace = async () => {
      const picked = await openImagePicker({ title: 'Replace image' });
      if (picked) ed.setLayer(layer, { src: picked.file, aspect: picked.width / picked.height, h: undefined }, { rebuild: true });
    };
    const forLanguage = async () => {
      const picked = await openImagePicker({ title: `Image for ${locale.name}` });
      if (picked) ed.setLayer(current(layer), { variants: { ...current(layer).variants, [locale.id]: picked.file } }, { rebuild: true });
    };
    const clearVariant = (id) => { const next = { ...current(layer).variants }; delete next[id]; ed.setLayer(current(layer), { variants: Object.keys(next).length ? next : undefined }, { rebuild: true }); };
    const flip = (key, label) => h('label', { class: 'row check' }, h('input', { type: 'checkbox', checked: Boolean(layer[key]), onChange: (e) => ed.setLayer(layer, { [key]: e.target.checked ? true : undefined }) }), label);
    if (layer.matrix) return h('div', { class: 'field' }, preview, h('div', { class: 'hint' }, layer.src),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn small', onClick: replace }, detailsOnly ? 'Change image…' : 'Replace…'), h('button', { class: 'btn small', onClick: () => ed.fitWidth(current(layer)) }, 'Fit width')));
    return h('div', { class: 'field' }, h('label', null, 'Image'),
      preview,
      h('div', { class: 'hint' }, layer.src ? `${layer.src}` : 'No image chosen'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn small', onClick: replace }, detailsOnly ? 'Change image…' : 'Replace…'),
        h('button', { class: 'btn small', title: 'Make it as wide as the slide', onClick: () => ed.fitWidth(layer) }, 'Fit width'),
        h('button', { class: 'btn small', title: 'Undo stretching: back to the picture’s own proportions', onClick: () => ed.setLayer(layer, { h: undefined }, { rebuild: true }) }, 'Reset proportions')),
      h('div', { class: 'row wrap' }, flip('flipX', 'Flip horizontally'), flip('flipY', 'Flip vertically')),
      h('label', null, 'Image fit'), selectInput({ options: [['stretch', 'Stretch'], ['contain', 'Fit inside'], ['cover', 'Fill and crop']], value: layer.fit ?? 'stretch', onChange: v => ed.setLayer(layer, { fit: v }, { rebuild: true }) }),
      h('label', null, 'Mask'), selectInput({ options: [['none', 'None'], ['rounded', 'Rounded rectangle'], ['ellipse', 'Ellipse']], value: layer.mask ?? 'none', onChange: v => ed.setLayer(layer, { mask: v }, { rebuild: true }) }),
      layer.mask === 'rounded' ? h('label', null, 'Corner radius ', numberInput({ value: layer.radius ?? 24, min: 0, onChange: v => ed.setLayer(layer, { radius: Math.max(0, v) }) })) : null,
      layer.fit === 'cover' ? h('div', { class: 'row wrap' }, ['X', 'Y'].map(axis => h('label', null, `Crop ${axis} % `, numberInput({ value: (layer[`crop${axis}`] ?? 0.5) * 100, min: 0, max: 100, width: 70, onChange: v => ed.setLayer(layer, { [`crop${axis}`]: Math.max(0, Math.min(1, v / 100)) }) })))) : null,
      ed.localeScope?.() ? h('div', { class: 'hint' }, `This image belongs to the unique ${locale.name} layout. Use Change image to replace it here.`) : h('div', { class: 'section tight' }, h('h4', null, 'Languages'),
        h('div', { class: 'hint' }, layer._sharedId ? 'This shared image appears on every screen it overlaps. Give a language its own version when the picture contains text.' : 'The image appears on this slide in every language. Give a language its own version when the picture contains text.'),
        own ? h('div', { class: 'row' }, h('span', { class: 'chip info' }, `${locale.name}: its own image`), h('button', { class: 'btn small', onClick: forLanguage }, 'Change…'), h('button', { class: 'btn small', onClick: () => clearVariant(locale.id) }, 'Use the shared one'))
          : h('div', { class: 'row' }, h('button', { class: 'btn small', onClick: forLanguage }, `Different image for ${locale.name}…`)),
        Object.keys(variants).filter((id) => id !== locale.id).length ? h('div', { class: 'hint' }, `Other language versions: ${Object.keys(variants).filter((id) => id !== locale.id).join(', ')}`) : null));
  }

  function shapeFields(layer) {
    const gradient = layer.gradient;
    const set = (patch, o) => ed.setLayer(current(layer), patch, o);
    const color = (value, onInput, key) => {
      const input = h('input', { type: 'color', value: (value ?? '#ffffff').slice(0, 7) });
      input.addEventListener('input', () => onInput(input.value));
      return input;
    };
    const slider = (label, value, min, max, step, onInput, fmt = (v) => v) => {
      const input = h('input', { type: 'range', min, max, step, value });
      const out = h('output', { class: 'mono' }, fmt(Number(value)));
      input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); onInput(Number(input.value)); });
      return h('div', { class: 'row shadow-row' }, h('span', null, label), input, out);
    };
    const b = layer._box ?? { w: 400, h: 400 };
    const fills = gradient
      ? [
        h('div', { class: 'row' }, selectInput({ options: [['linear', 'Linear'], ['radial', 'Radial (glow)']], value: gradient.type ?? 'linear', onChange: (v) => set({ gradient: { ...current(layer).gradient, type: v } }, { rebuild: true }) })),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'From'), color(gradient.from, (v) => set({ gradient: { ...current(layer).gradient, from: v } }, { key: `grad:${layer.id}` })),
          h('span', { class: 'label' }, 'To'), color(gradient.to, (v) => set({ gradient: { ...current(layer).gradient, to: v } }, { key: `grad:${layer.id}` }))),
        slider('Start opacity', gradient.fromAlpha ?? 1, 0, 1, 0.01, (v) => set({ gradient: { ...current(layer).gradient, fromAlpha: v } }, { key: `grad:${layer.id}` }), (v) => `${Math.round(v * 100)}%`),
        slider('End opacity', gradient.toAlpha ?? 0, 0, 1, 0.01, (v) => set({ gradient: { ...current(layer).gradient, toAlpha: v } }, { key: `grad:${layer.id}` }), (v) => `${Math.round(v * 100)}%`),
        gradient.type !== 'radial' ? slider('Angle', gradient.angle ?? 180, 0, 360, 1, (v) => set({ gradient: { ...current(layer).gradient, angle: v } }, { key: `grad:${layer.id}` }), (v) => `${v}°`) : null,
      ]
      : [h('div', { class: 'row' }, h('span', { class: 'label' }, 'Colour'), color(layer.fill, (v) => set({ fill: v }, { key: `fill:${layer.id}` })))];
    return h('div', { class: 'field' }, h('label', null, 'Shape'),
      segmented({ options: [['rect', 'Rectangle'], ['ellipse', 'Ellipse']], value: layer.shape ?? 'rect', onChange: (v) => set({ shape: v }, { rebuild: true }) }),
      segmented({ options: [['solid', 'Solid'], ['gradient', 'Gradient']], value: gradient ? 'gradient' : 'solid', onChange: (v) => set(v === 'gradient' ? { gradient: { type: 'linear', from: layer.fill ?? '#ffffff', to: layer.fill ?? '#ffffff', fromAlpha: 0.9, toAlpha: 0, angle: 180 } } : { gradient: undefined }, { rebuild: true }) }),
      ...fills,
      !gradient ? paletteSwatches(ed, fill => set({ fill }, { rebuild: true })) : null,
      (layer.shape ?? 'rect') === 'rect' ? slider('Corner radius', layer.radius ?? 0, 0, Math.round(Math.min(b.w, b.h) / 2), 1, (v) => set({ radius: v || undefined }, { key: `radius:${layer.id}` }), (v) => `${Math.round(v)}px`) : null,
      slider('Outline', layer.stroke?.width ?? 0, 0, 60, 1, (v) => set({ stroke: v ? { color: current(layer).stroke?.color ?? '#ffffff', width: v } : undefined }, { key: `stroke:${layer.id}` }), (v) => `${v}px`),
      layer.stroke?.width ? h('div', { class: 'row' }, h('span', { class: 'label' }, 'Outline colour'), color(layer.stroke.color, (v) => set({ stroke: { ...current(layer).stroke, color: v } }, { key: `stroke:${layer.id}` }))) : null);
  }

  function textFields(layer) {
    const set = (patch, o) => ed.setLayer(current(layer), patch, o);
    const lineLimit = numberInput({ value: layer.maxLines ?? 99, min: 0, step: 1, width: 64, title: 'Maximum number of lines. Set 0 for unlimited.', onChange: v => {
      if (!Number.isInteger(v) || v < 0) { lineLimit.value = current(layer).maxLines ?? 99; return; }
      set({ maxLines: v });
    } });
    lineLimit.setAttribute('aria-label', 'Max lines');
    const slider = (label, value, min, max, step, onInput, fmt = (v) => v) => {
      const input = h('input', { type: 'range', min, max, step, value });
      const out = h('output', { class: 'mono' }, fmt(Number(value)));
      input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); onInput(Number(input.value)); });
      return h('div', { class: 'row shadow-row' }, h('span', null, label), input, out);
    };
    const color = h('input', { type: 'color', value: (layer.color ?? scene.theme.ink).slice(0, 7) });
    color.addEventListener('input', () => set({ color: color.value }, { key: `color:${layer.id}` }));
    return h('div', { class: 'field' },
      !detailsOnly ? h('div', { class: 'row' }, h('button', { class: 'btn small', onClick: () => ed.openLayer(layer) }, 'Edit the text…')) : null,
      fontPicker({ value: layer.fontFamily, inherited: scene.fonts.family, onChange: fontFamily => set({ fontFamily }) }),
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Text size'), selectInput({ title: 'Text sizing', options: [['manual', 'Max size'], ['frame', 'Fill frame']], value: layer.textFit ?? 'manual', onChange: v => {
        const fresh = current(layer);
        set(v === 'frame' ? { textFit: 'frame', boxHeight: fresh.boxHeight ?? fresh._box?.h ?? fresh.size ?? 100 } : { textFit: undefined }, { rebuild: true });
      } })),
      layer.textFit === 'frame' ? h('div', { class: 'hint' }, 'Text grows or shrinks to fit the frame. Enter keeps a line break. Resize the frame to change the text size.') : slider('Max size', Math.round(layer.size ?? 100), 24, 400, 1, (v) => set({ size: v }, { key: `size:${layer.id}` }), (v) => `${v}px`),
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Weight'),
        selectInput({ options: [[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Heavy']], value: layer.weight ?? 700, onChange: (v) => set({ weight: Number(v) }) })),
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Align'), iconChoices({ label: 'Text alignment', options: [['start', scene.locale?.dir === 'rtl' ? 'text.alignright' : 'text.alignleft', 'Align to language start'], ['center', 'text.aligncenter', 'Centre text'], ['end', scene.locale?.dir === 'rtl' ? 'text.alignleft' : 'text.alignright', 'Align to language end']], value: layer.align ?? 'start', onChange: (v) => set({ align: v }) })),
      h('div', { class: 'row' }, h('span', { class: 'label' }, 'Colour'), color, layer.color ? h('button', { class: 'btn small', onClick: () => set({ color: undefined }, { rebuild: true }) }, 'Slide colour') : h('span', { class: 'hint' }, 'follows the slide')),
      paletteSwatches(ed, colour => set({ color: colour }, { rebuild: true })),
      slider('Line spacing', layer.lineHeight ?? 1.2, 0.9, 1.7, 0.01, (v) => set({ lineHeight: v }, { key: `lh:${layer.id}` }), (v) => v.toFixed(2)),
      layer.textFit !== 'frame' ? h('div', { class: 'row' }, h('span', { class: 'label' }, 'Max lines'), lineLimit, h('span', { class: 'hint' }, '0 = unlimited')) : null);
  }

  // ----- order, duplicate, delete, copy

  function actions(layer) {
    const others = Object.keys(engine.project.devices).filter(id => id !== ed.deviceId());
    return h('div', { class: 'layer-actions', role: 'group', 'aria-label': 'Layer actions' },
      layer.group ? iconButton('square.dashed', 'Ungroup · ⇧⌘G', () => ed.groupSelection(true)) : null,
      iconButton('square.on.square', 'Duplicate layer', () => ed.duplicateLayer(layer)),
      !ed.allScreens?.() && layer._origin === 'slide' && layer.type !== 'device' && others.length ? iconButton('square.stack.3d.up', 'Copy a scaled layer to the other canvases', () => ed.copyToOtherDevices(layer)) : null,
      iconButton('trash', 'Delete layer', () => ed.removeLayer(layer), { class: 'symbol-button danger' }));
  }

  return {
    el: panel,
    rename(id) { renamers.get(id)?.(); },
    /** Refresh the position fields after a drag or a repaint (leaves a field you are typing in alone). */
    updateGeometry() {
      const layer = ed.layerById(ed.selectedId);
      const b = layer?._box;
      if (!b) return;
      const values = { x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot ?? 0 };
      for (const [key, input] of Object.entries(geomInputs)) if (document.activeElement !== input) input.value = round1(values[key]);
    },
    afterRender() { this.updateGeometry(); },
  };
}
