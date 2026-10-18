import { orderedCanvases, orderedSlides } from '../slide-order.js';
import { PLAY_TARGETS, PLAY_SPEC_URL, playCanvasDefaults } from '../google-play.js';
// Setup → Devices: every device the set is made for - its canvas size (change it when Apple does), the layout
// family it is modelled on, the folder its screenshots live in, and the frame its screenshots sit in by default.

import { engine, state, saveStudio, saveCopy, checkpoint, rememberUI, validateSelection } from '../store.js';
import { canvasSizeOptions, existingStoreCanvas, SPEC_URL, LAYOUT_FAMILIES } from '../presets.js';
import { EXPORT_TARGETS, TARGET_OPTIONS, canvasIssues, exportTarget, storeLabel } from '../export-targets.js';
import { resizeDevice, addDevice, removeDevice } from '../project-ops.js';
import { chooseFrame, frameThumbnail } from './frame-picker.js';
import { allFrames, frameKey, parseFrameKey, frameScreenSize } from '../frames.js';
import { canvasMetrics } from '../layouts.js';
import { frameTarget } from '../frame-matching.js';
import { h, toast, modal, confirmDialog, selectInput, numberInput, drawInto } from './helpers.js';

const targetOptions = target => target === 'unknown' ? [['unknown', 'Choose a platform…'], ...TARGET_OPTIONS] : TARGET_OPTIONS;
const sizeStatus = device => {
  const issues = canvasIssues(device), custom = exportTarget(device) === 'custom';
  return h('div', { class: `canvas-status ${issues.length ? 'warn' : custom ? '' : 'ok'}`, role: 'status' },
    issues.length ? issues[0].message : custom ? 'Custom size · no store size restrictions' : `✓ Size accepted for ${storeLabel(device)}`);
};
const frameOptions = () => {
  const frames = allFrames(engine.data.frames);
  return [
    { group: 'Frames in this project', options: frames.filter((f) => f.ref.type === 'bezel').map((f) => [frameKey(f.ref), f.label]) },
    { group: 'Built in', options: frames.filter((f) => f.ref.type !== 'bezel').map((f) => [frameKey(f.ref), f.label]) },
  ].filter((g) => g.options.length);
};

export function buildDevicesView(ctx) {
  const project = engine.project;
  const root = h('div', { class: 'setup-section' });
  const refreshShell = () => ctx.go({});

  root.append(h('div', { class: 'setup-intro' },
    h('div', null, h('h3', null, 'Output canvases'),
      h('p', { class: 'hint' }, 'Choose one size for each screenshot row. Set Portrait or Landscape per screen in the editor or Overview. Use Custom format for your own dimensions. ',
        h('a', { href: SPEC_URL, target: '_blank', rel: 'noopener' }, 'Apple specifications ↗'), ' · ', h('a', { href: PLAY_SPEC_URL, target: '_blank', rel: 'noopener' }, 'Google Play specifications ↗'))),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onClick: () => openAddDevice(ctx) }, '＋ Store format'), h('button', { class: 'btn', onClick: () => openAddDevice(ctx, { custom: true }) }, '＋ Custom format'))));

  const list = h('div', { class: 'device-list' });
  for (const [id, device] of orderedCanvases(project)) list.append(deviceCard(id, device));
  root.append(list);

  function set(device, patch) {
    checkpoint();
    Object.assign(device, patch);
    saveStudio();
    engine.invalidate({ assets: false });
  }

  function deviceCard(id, device) {
    const [W, H] = device.size;
    const target = exportTarget(device);
    const widthInput = numberInput({ value: W, min: 100, max: 12000, step: 1, width: 84 });
    const heightInput = numberInput({ value: H, min: 100, max: 12000, step: 1, width: 84 });
    widthInput.setAttribute('aria-label', 'Width in pixels'); heightInput.setAttribute('aria-label', 'Height in pixels');
    const apply = h('button', { class: 'btn small primary', disabled: true, onClick: () => applySize(id, Number(widthInput.value), Number(heightInput.value)) }, 'Apply size');
    const dirty = () => { apply.disabled = !(Number(widthInput.value) !== W || Number(heightInput.value) !== H); };
    widthInput.addEventListener('input', dirty);
    heightInput.addEventListener('input', dirty);
    const preset = selectInput({ options: canvasSizeOptions(target, device.size), value: device.size.join('x'), title: 'Store format', onChange: async v => { if (v && v !== device.size.join('x')) await applySize(id, ...v.split('x').map(Number)); preset.value = device.size.join('x'); } });
    preset.setAttribute('aria-label', 'Store format');
    const swap = h('button', { class: 'btn small', title: 'Swap width and height', onClick: () => { const w = widthInput.value; widthInput.value = heightInput.value; heightInput.value = w; dirty(); } }, '⇄');

    const label = h('input', { class: 'input grow', value: device.label, 'aria-label': 'Name' });
    label.addEventListener('change', () => { if (label.value.trim()) { set(device, { label: label.value.trim() }); refreshShell(); } });
    const short = h('input', { class: 'input', value: device.short ?? '', style: { width: '120px' }, 'aria-label': 'Short name', title: 'Short name (shown in the sidebar)' });
    short.addEventListener('change', () => { set(device, { short: short.value.trim() || device.label }); refreshShell(); });
    const store = h('input', { class: 'input grow', value: device.appStore ?? '', placeholder: 'App Store Connect name, e.g. iPhone 6.9″ Display', 'aria-label': 'App Store Connect name' });
    store.addEventListener('change', () => set(device, { appStore: store.value.trim() || undefined }));
    const folder = h('input', { class: 'input', value: device.capture, style: { width: '140px' }, 'aria-label': 'Screenshots folder' });
    folder.addEventListener('change', () => {
      const clean = folder.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!clean) { folder.value = device.capture; return; }
      set(device, { capture: clean });
      toast(`Screenshots for ${device.short ?? device.label} are now read from project/captures/…/${clean}/. Existing files are not moved.`, { timeout: 7000 });
      refreshShell();
    });
    const frameContext = frameTarget(project, device, {}, engine.data.frames);
    const frameSelect = h('button', { class: 'frame-current', title: 'Choose the default frame from visual previews', onClick: () => chooseFrame({ selected: device.frame, target: frameContext, onManage: () => { state.ui.setupTab = 'frames'; ctx.go({}); }, onPick: frame => { set(device, { frame }); refreshShell(); } }) }, h('div', { class: 'frame-thumb' }, frameThumbnail(device.frame ?? { type: 'plain' }, { screenSize: frameContext.screen })), 'Choose frame…');
    const screen = frameScreenSize(device.frame, { frames: engine.data.frames, deviceSize: device.size });
    const { W: dw, k } = canvasMetrics(device);

    const thumb = h('canvas');
    const first = orderedSlides(project, state.ui.locale, id)[0];
    if (first) drawInto(thumb, { slideId: first.id, deviceId: id, localeId: state.ui.locale, width: W > H ? 150 : 84 });

    const lastScreenshotCanvas = device.screenScope !== 'store-image' && project.slides.some(s => !s.canvasIds) && Object.values(project.devices).filter(d => d.screenScope !== 'store-image').length === 1;
    const remove = h('button', { class: 'btn small danger', disabled: Object.keys(project.devices).length <= 1 || lastScreenshotCanvas, title: lastScreenshotCanvas ? 'Keep a canvas for your screenshot screens' : Object.keys(project.devices).length <= 1 ? 'A project needs at least one device' : 'Remove this device', onClick: async () => {
      if (!(await confirmDialog({ title: `Remove ${device.label}?`, body: 'Its layouts and exports go away. Screenshots stay in project/captures/ in case another device uses them.', confirmLabel: 'Remove device', danger: true }))) return;
      checkpoint(null, { copyLocales: Object.keys(engine.data.copy) });
      const previousSlides = project.slides.map(slide => slide.id);
      removeDevice(project, id);
      const removedSlides = previousSlides.filter(slideId => !project.slides.some(slide => slide.id === slideId));
      for (const [locale, doc] of Object.entries(engine.data.copy)) if (removedSlides.some(slideId => Object.hasOwn(doc, slideId))) {
        for (const slideId of removedSlides) delete doc[slideId];
        saveCopy(locale);
      }
      validateSelection();
      saveStudio();
      refreshShell();
    } }, 'Remove');

    return h('div', { class: 'device-card' },
      h('div', { class: 'device-thumb' }, thumb),
      h('div', { class: 'device-body' },
        h('div', { class: 'row' }, label, remove),
        h('div', { class: 'settings-grid' },
          h('label', { class: 'field' }, 'Export target', selectInput({ options: targetOptions(target), value: target, onChange: v => { set(device, { target: v }); refreshShell(); } })),
          target === 'custom' ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Custom size'), h('div', { class: 'row wrap' }, widthInput, '×', heightInput, h('span', { class: 'hint' }, 'px'), swap, apply)) : h('label', { class: 'field' }, 'Store format', preset)),
        sizeStatus(device),
        PLAY_TARGETS[target] ? h('p', { class: 'hint' }, PLAY_TARGETS[target].guidance) : null,
        h('details', { class: 'canvas-advanced' },
          h('summary', null, 'Layout and source settings'),
          h('div', { class: 'settings-form' },
            h('div', { class: 'hint' }, k === 1 ? 'Layouts use this canvas’s own pixels.' : `Layouts are drawn for ${Math.round(dw)} px wide and scaled ×${k.toFixed(3)} to this canvas.`),
            h('div', { class: 'settings-grid' },
              h('label', { class: 'field' }, 'Short name', short),
              h('label', { class: 'field' }, 'Layout family', selectInput({ options: LAYOUT_FAMILIES, value: device.layout, onChange: v => { set(device, { layout: v }); refreshShell(); } })),
              h('label', { class: 'field' }, 'Screenshots folder', folder),
              !PLAY_TARGETS[target] ? h('label', { class: 'field' }, 'App Store name', store) : null),
            h('div', { class: 'field' }, h('span', { class: 'label' }, 'Default frame'), h('div', { class: 'row wrap' }, frameSelect,
              h('span', { class: 'hint' }, screen ? `screen ${screen[0]} × ${screen[1]}px` : '')))))));
  }

  async function applySize(id, width, height) {
    const device = project.devices[id];
    if (![width, height].every(v => Number.isInteger(v) && v >= 100 && v <= 12000)) { toast('Enter a width and height in pixels.', { error: true }); return; }
    const [W, H] = device.size;
    const aspect = ((width / height) / (W / H) - 1) * 100;
    let mode = 'scale';
    const radio = (value, title, text) => {
      const input = h('input', { type: 'radio', name: 'resize-mode', checked: mode === value, onChange: () => { mode = value; } });
      return h('label', { class: 'choice' }, input, h('div', null, h('b', null, title), h('div', { class: 'hint' }, text)));
    };
    const ok = await new Promise((resolve) => {
      const go = h('button', { class: 'btn primary', onClick: () => { resolve(true); m.close(); } }, 'Change size');
      const m = modal({
        title: `${device.label}: ${W} × ${H} → ${width} × ${height}`,
        body: h('div', { class: 'field' },
          h('div', { class: 'hint' }, `The new canvas is ${Math.abs(aspect) < 0.05 ? 'the same shape' : `${Math.abs(aspect).toFixed(1)}% ${aspect > 0 ? 'wider' : 'narrower'} (relative to its height)`}. How should the existing slides adapt?`),
          radio('scale', 'Scale the designs (recommended)', 'Positions and sizes grow or shrink with the canvas width, so every slide looks the same. Text pinned to the bottom edge stays on the bottom edge.'),
          radio('keep', 'Keep everything the same size in pixels', 'Nothing is rescaled: the new canvas simply has more (or less) room around the same layout.')),
        actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), go],
        onClose: () => resolve(false),
      });
    });
    if (!ok) return;
    checkpoint();
    resizeDevice(project, id, [width, height], { mode });
    saveStudio();
    engine.invalidate({ assets: false });
    refreshShell();
    toast(`${device.short ?? device.label} is now ${width} × ${height}px. Check the slides, and any screenshots that were sized for the old canvas.`, { timeout: 8000 });
  }


  return root;
}


export function openAddDevice(ctx, { custom = false, fromMenu = false } = {}) {
  const project = engine.project;
  const refreshShell = () => ctx.go(fromMenu ? { view: 'editor' } : {});
  const initial = exportTarget(project.devices[state.ui.device]);
  const f = { target: custom ? 'custom' : EXPORT_TARGETS[initial] && initial !== 'custom' ? initial : 'iphone', reuse: '' };
  f.size = [...EXPORT_TARGETS[f.target].formats[0].size];
  const label = h('input', { class: 'input', value: 'Custom format', 'aria-label': 'Canvas name' });
  const status = h('div');
  const updateStatus = () => status.replaceChildren(sizeStatus(f), ...(PLAY_TARGETS[f.target] ? [h('p', { class: 'hint' }, PLAY_TARGETS[f.target].guidance)] : []));
  const width = numberInput({ value: f.size[0], min: 100, max: 12000, step: 1, width: 100, onInput: v => { f.size[0] = v; updateStatus(); } });
  const height = numberInput({ value: f.size[1], min: 100, max: 12000, step: 1, width: 100, onInput: v => { f.size[1] = v; updateStatus(); } });
  width.setAttribute('aria-label', 'Width in pixels'); height.setAttribute('aria-label', 'Height in pixels');
  const presets = h('div', { class: 'canvas-presets' });
  const updatePresets = () => {
    const select = selectInput({ options: canvasSizeOptions(f.target), value: f.size.join('x'), onChange: v => { f.size = v.split('x').map(Number); updateStatus(); } });
    select.setAttribute('aria-label', 'Store format');
    presets.replaceChildren(select);
  };
  const reuse = selectInput({
    options: [['', 'Start with an empty canvas'], ...Object.entries(project.devices).map(([id, d]) => [id, `Reuse the layouts of ${d.label}`])],
    value: '', onChange: id => { f.reuse = id; },
  });
  reuse.setAttribute('aria-label', 'Starting layout');
  const target = selectInput({ options: TARGET_OPTIONS.filter(option => option.group), value: f.target, onChange: value => {
    f.target = value; f.size = [...EXPORT_TARGETS[value].formats[0].size]; updatePresets(); updateStatus();
  } });
  target.setAttribute('aria-label', 'Store destination');
  updatePresets(); updateStatus();
  const create = h('button', { class: 'btn primary', onClick: () => {
    const format = canvasSizeOptions(f.target).find(([key]) => key === f.size.join('x'));
    const name = custom ? label.value.trim() : `${EXPORT_TARGETS[f.target].label} · ${f.size.join(' × ')}`;
    if (!name) { label.focus(); return; }
    if (!f.size.every(v => Number.isInteger(v) && v >= 100 && v <= 12000)) { toast('Enter a width and height between 100 and 12000 pixels.', { error: true }); return; }
    if (!custom && !format) { toast('Choose a store format.', { error: true }); return; }
    const existing = existingStoreCanvas(project.devices, f.target, f.size);
    if (existing) { state.ui.device = existing; rememberUI(); m.close(); refreshShell(); return; }
    checkpoint();
    const donor = project.devices[f.reuse];
    const defaults = playCanvasDefaults(f.target, f.size);
    const id = addDevice(project, { label: name, short: custom ? name : EXPORT_TARGETS[f.target].label, target: f.target, size: f.size, layout: donor?.layout ?? EXPORT_TARGETS[f.target].layout, capture: donor?.capture ?? defaults.capture, frame: donor?.frame ?? defaults.frame, reuseFrom: f.reuse || null });
    saveStudio(); state.ui.device = id; rememberUI();
    m.close(); refreshShell();
    toast(`Added ${name}. ${f.reuse ? 'Check the scaled layouts in Editor.' : 'Open Editor to add text, screenshots and displayed devices.'}`, { timeout: 8000 });
  } }, custom ? 'Add custom format' : fromMenu ? 'Add device' : 'Add store format');
  const m = modal({
    title: custom ? 'Custom format' : fromMenu ? 'Add device' : 'Add a store format',
    body: h('div', { class: 'settings-form' },
      custom ? [h('label', { class: 'field' }, 'Name', label), h('div', { class: 'row wrap' }, width, '×', height, h('span', { class: 'hint' }, 'px'))] : [h('label', { class: 'field' }, fromMenu ? 'Device' : 'Store destination', target), h('div', { class: 'field' }, h('span', { class: 'label' }, 'Format'), presets)],
      status,
      h('details', { class: 'disclosure settings-disclosure' }, h('summary', null, 'Starting layout'), h('div', { class: 'disclosure-body' }, reuse)),
      h('div', { class: 'hint' }, custom ? 'Your own dimensions, without store size restrictions.' : fromMenu ? 'Create a canvas for an Apple or Android device, then add your screenshots in Editor.' : 'Ready-made export dimensions. Displayed devices and frames are chosen separately in Editor.')),
    actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), create],
  });
}
