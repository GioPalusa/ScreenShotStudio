import { PLAY_TARGETS } from '../google-play.js';
import { uniqueId, slugify, fitStoreScreenshot } from '../layer-ops.js';
import { openMediaLibrary } from './media-library.js';
// Inspector → Screenshot: which app screen a device shows, the picture itself, the device frame it sits in,
// how it fits the frame's screen, and how round its corners are.
//
// It acts on one device layer: the selected one, else the first device on the slide.

import { iconChoices } from './icons.js';
import { chooseFrame } from './frame-picker.js';
import { profileChoices, deviceForLayer } from '../profiles.js';
import { engine, state, rememberUI, uploadCapture, removeCapture, toPNG } from '../store.js';
import { frameLabel, frameKey } from '../frames.js';
import { frameTarget, frameDropdownOptions, frameCompatibility } from '../frame-matching.js';
import { fitCapture, FIT_MODES } from '../devices.js';
import { h, toast, segmented, selectInput, numberInput } from './helpers.js';

const sizeText = (size) => (size ? `${size[0]} × ${size[1]}` : 'unknown');

export function targetDeviceLayer(ed) {
  const layers = (ed.scene?.layers ?? []).filter((l) => l.type === 'device');
  const selected = ed.layerById(ed.selectedId);
  return selected?.type === 'device' ? selected : layers[0] ?? null;
}

/** Corner radius for display: one number when all corners agree. */
function radiusText(radii) {
  if (radii === undefined || radii === null) return 'unknown';
  const list = Array.isArray(radii) ? radii : [radii];
  const rounded = list.map((r) => Math.round(r));
  return rounded.every((r) => r === rounded[0]) ? `${rounded[0]}px` : `${rounded.join(' / ')}px`;
}

export function buildScreenshotPanel(ed, { selectedOnly = false } = {}) {
  const locale = ed.locale();
  const layer = selectedOnly ? ed.layerById(ed.selectedId) : targetDeviceLayer(ed);
  const dev = deviceForLayer(engine.project, ed.device(), layer ?? {}, engine.data.frames);
  const set = dev.capture;
  const deviceLayers = (ed.scene?.layers ?? []).filter((l) => l.type === 'device');
  const panel = h('div', { class: 'panel' });

  if (!ed.scene) { panel.append(h('div', { class: 'hint' }, 'Loading the preview…')); return { el: panel }; }
  if (!layer) {
    panel.append(h('div', { class: 'banner' },
      h('div', null, h('b', null, 'This layout has no device'), h('div', { class: 'hint' }, `Add one to show a screenshot on ${dev.short ?? dev.label}.`)),
      h('button', { class: 'btn small', onClick: () => ed.addLayer('device') }, '＋ Device')));
    return { el: panel };
  }

  const name = layer.capture ?? null;
  const play = PLAY_TARGETS[ed.device().target];
  if (play) panel.append(h('div', { class: 'field' }, h('details', null, h('summary', null, 'Google Play requirements'), h('p', { class: 'hint' }, play.guidance)),
    play.raw ? h('button', { class: 'btn', title: 'Keep this screenshot, fill the canvas and remove other layers in the current layout. Undo restores the design.', onClick: () => ed.editLayout(block => fitStoreScreenshot(block, ed.scene.layers, layer, { W: ed.scene.W, H: ed.scene.H, size: ed.device().size })) }, 'Fit to store canvas') : null));


  if (!selectedOnly && deviceLayers.length > 1) {
    panel.append(h('div', { class: 'field' }, h('label', null, 'Device on this slide'),
      segmented({ options: deviceLayers.map((l, i) => [l.id, i === 0 ? 'Main' : `Device ${i + 1}`]), value: layer.id, onChange: (id) => { ed.select(id); } })));
  }

  panel.append(h('div', { class: 'field' }, h('label', null, 'Displayed device'),
    selectInput({ options: [['', 'Canvas default'], ...profileChoices(engine.project, engine.data.frames, layer.profile)], value: layer.profile ?? '', onChange: id => ed.setLayer(layer, { profile: id || undefined, frame: undefined, radius: undefined, captureSet: undefined }, { rebuild: true }) }),
    h('div', { class: 'hint' }, 'Choose a screenshot from your project’s media library.')));

  const chooseScreenshot = async () => {
    const projectId = state.projectId, slideId = ed.slide().id, deviceId = ed.deviceId(), localeId = locale.id;
    const item = await openMediaLibrary({ kind: 'screenshots', pick: 'screenshots', localeId, collection: set, ctx: ed.ctx, title: 'Choose a screenshot' });
    if (!item || state.projectId !== projectId || ed.slide().id !== slideId || ed.deviceId() !== deviceId || ed.locale().id !== localeId) return;
    if (!ed.layerById(layer.id)) return;
    ed.setLayer(ed.layerById(layer.id), { capture: item.name, captureSet: item.set }, { rebuild: true });
  };
  const screenshotChoice = h('div', { class: 'field' }, h('label', null, 'Screenshot'),
    h('button', { class: 'btn', title: 'Browse or import screenshots for this device', onClick: chooseScreenshot }, name ? 'Change screenshot…' : 'Choose screenshot…'));
  panel.append(screenshotChoice);

  // ----- the picture and how it fits
  const fitBox = h('div', { class: 'fit-report' });
  if (name) {
    const src = engine.captureSource(locale.id, dev, name, layer);
    const meta = h('div', { class: 'meta' });
    const img = h('img', { alt: `${name} screenshot`, src: src?.url ?? '' });
    img.onload = () => {
      meta.querySelector('[data-size]').replaceChildren(h('div', { class: 'mono' }, `${img.naturalWidth} × ${img.naturalHeight}px`));
      describeFit(img);
    };
    meta.append(...[
      h('div', null, src?.localized ? h('span', { class: 'chip info' }, `${locale.name} only`) : src?.missing ? h('span', { class: 'chip err' }, 'Missing') : h('span', { class: 'chip' }, 'Shared by all languages')),
      h('div', { dataset: { size: '' } }),
      src?.localized ? h('button', { class: 'btn small', onClick: async () => { await removeCapture({ scope: locale.id, device: set, name }); toast(`Now using the shared screenshot for ${locale.name}`); ed.afterCaptureChange(); } }, `Use the shared one for ${locale.name}`) : null,
    ].filter(Boolean));
    panel.append(h('div', { class: 'capture-preview' }, src?.url ? img : h('div', { class: 'hint' }, 'No file yet'), meta), fitBox);
  }

  /** Say what happens to the screenshot inside the frame's screen. */
  function describeFit(img) {
    const screen = layer._screenSize ?? engine.expectedCaptureSize(dev, layer);
    if (!screen || !img?.naturalWidth) { fitBox.replaceChildren(); return; }
    const mode = layer.fit ?? 'fill';
    const r = fitCapture(screen, [img.naturalWidth, img.naturalHeight], { fit: mode, align: layer.align });
    const lines = [];
    let level = '';
    if (r.exact) { level = 'ok'; lines.push('✓ Exactly the size of the frame’s screen: drawn 1:1.'); }
    else if (mode === 'stretch') { level = r.aspectDiff > 0.02 ? 'warn' : ''; lines.push(`Stretched to the ${sizeText(screen)} screen${r.aspectDiff > 0.02 ? ` (shape differs by ${(r.aspectDiff * 100).toFixed(1)}%)` : ''}.`); }
    else if (mode === 'contain') lines.push(`Scaled ${(r.scale * 100).toFixed(1)}% to sit inside the ${sizeText(screen)} screen; the rest is black.`);
    else {
      const crop = (r.cropX / img.naturalWidth + r.cropY / img.naturalHeight) * 100;
      level = crop > 2 ? 'warn' : '';
      lines.push(`Scaled ${(r.scale * 100).toFixed(1)}% to fill the ${sizeText(screen)} screen${crop > 0.05 ? `, cropping ${crop.toFixed(1)}% (${Math.round(r.cropY)}px tall, ${Math.round(r.cropX)}px wide)` : ''}.`);
      if (crop > 2) lines.push('Capture the app on a matching simulator, or choose another frame, to avoid cropping.');
    }
    fitBox.className = `fit-report hint ${level}`;
    fitBox.replaceChildren(...lines.map((t) => h('div', null, t)));
  }

  // ----- frame
  const target = frameTarget(engine.project, ed.device(), layer, engine.data.frames);
  const choices = frameDropdownOptions(target, engine.data.frames);
  const currentFrame = layer.frame ?? dev.frame ?? { type: 'plain' };
  const compatibility = frameCompatibility(currentFrame, target, engine.data.frames);
  const manageFrames = () => { state.ui.setupTab = 'frames'; ed.ctx.setView('setup'); };
  const currentKey = frameKey(currentFrame);
  const frameSelect = selectInput({ options: [...choices.map(option => [frameKey(option.ref), option.label]), ['get-more', 'Get more frames']], value: currentKey, title: `Frames for ${target.label}`, onChange: key => {
    if (key === 'get-more') { frameSelect.value = currentKey; manageFrames(); return; }
    const frame = choices.find(option => frameKey(option.ref) === key)?.ref;
    if (frame) ed.setLayer(layer, { frame: structuredClone(frame) }, { rebuild: true });
  } });
  frameSelect.setAttribute('aria-label', 'Device frame');
  // A frame chosen through Browse all frames stays visible without offering other
  // device styles as normal choices in this device's dropdown.
  if (!choices.some(option => frameKey(option.ref) === currentKey)) {
    frameSelect.insertBefore(h('option', { value: currentKey, selected: true, disabled: true }, `${frameLabel(currentFrame, engine.data.frames)} · current`), frameSelect.lastElementChild);
  }
  const browseFrames = () => chooseFrame({ selected: layer.frame, defaultFrame: dev.frame ?? { type: 'plain' }, target, onManage: manageFrames, onPick: frame => ed.setLayer(layer, { frame }, { rebuild: true }) });
  const screen = layer._screenSize ?? engine.expectedCaptureSize(dev, layer);
  const frameSection = h('div', { class: 'section' }, h('h4', null, `Frame · ${target.label}`),
    h('div', { class: 'field' }, frameSelect,
      play?.raw ? h('div', { class: 'hint' }, `Google Play ${play.label} requires a full-canvas screenshot without hardware or masking.`) :
      currentFrame.type === 'generic' ? h('div', { class: 'hint' }, 'Built-in Studio illustration. Import Apple bezels in Get more frames.') :
      compatibility.kind === 'exact' ? h('span', { class: 'chip ok' }, `Exact screen match for ${target.label}`) :
        currentFrame.type === 'plain' ? h('div', { class: 'hint' }, 'Choose a generic or imported frame above.') : null,
      currentFrame.type !== 'plain' && compatibility.kind !== 'exact' ? h('div', { class: 'hint warn' }, `${compatibility.label}. Check screenshot fitting below.`) : null,
      h('div', { class: 'hint' }, screen ? `Its screen is ${sizeText(screen)}px - ${layer._radii !== undefined ? `corner radius ${radiusText(layer._radii)}` : 'corners unknown'}.` : 'This frame has no screen size yet.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn small', title: 'Choose a frame from any device style', onClick: browseFrames }, 'Browse all frames…'), h('button', { class: 'btn small', onClick: manageFrames }, 'Get more frames'))),
  );
  panel.insertBefore(frameSection, screenshotChoice);

  // ----- fit + corners
  const fit = layer.fit ?? 'fill';
  const radiusAuto = layer.radius === undefined || layer.radius === null;
  const radiusInput = numberInput({ value: radiusAuto ? Math.round(Array.isArray(layer._radii) ? layer._radii[0] : layer._radii ?? 0) : layer.radius, min: 0, max: 1200, step: 1, width: 70,
    onInput: (v) => ed.setLayer(layer, { radius: v }, { key: `radius:${layer.id}` }) });
  radiusInput.disabled = radiusAuto;
  const radiusMode = segmented({ options: [['auto', 'Auto'], ['custom', 'Custom']], value: radiusAuto ? 'auto' : 'custom', onChange: (v) => {
    if (v === 'auto') ed.setLayer(layer, { radius: undefined }, { rebuild: true });
    else ed.setLayer(layer, { radius: Math.round(Array.isArray(layer._radii) ? layer._radii[0] : layer._radii ?? 0) }, { rebuild: true });
  } });
  panel.append(h('div', { class: 'section' }, h('h4', null, 'Fit and corners'),
    h('div', { class: 'field' }, h('label', null, 'Screenshot fit'),
      segmented({ options: FIT_MODES.map(([v, l]) => [v, l.split(' (')[0]]), value: fit, onChange: (v) => ed.setLayer(layer, { fit: v === 'fill' ? undefined : v }, { rebuild: true }) }),
      h('div', { class: 'hint' }, FIT_MODES.find(([v]) => v === fit)?.[1] ?? '')),
    fit === 'fill' ? h('div', { class: 'field' }, h('label', null, 'Crop from'),
      iconChoices({ label: 'Crop alignment', options: [['top', 'align.vertical.top', 'Crop from top'], ['center', 'align.vertical.center', 'Crop from middle'], ['bottom', 'align.vertical.bottom', 'Crop from bottom']], value: layer.align ?? 'center', onChange: (v) => ed.setLayer(layer, { align: v === 'center' ? undefined : v }, { rebuild: true }) }),
      h('div', { class: 'hint' }, 'Only matters when the screenshot is taller or wider than the screen.')) : null,
    h('div', { class: 'field', title: 'The screenshot is clipped to rounded corners and sits on black glass, hiding its original square or transparent corners.' }, h('label', null, 'Screen corners'),
      h('div', { class: 'row' }, radiusMode, radiusInput, h('span', { class: 'hint' }, 'px')),
      null),
  ));

  // ----- drop zone
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) applyCapture(ed, fileInput.files[0]); fileInput.value = ''; });
  const zone = h('div', { class: 'dropzone' },
    h('div', null, h('b', null, name ? 'Drop a new screenshot here' : 'Drop a screenshot here')),
    h('div', { class: 'hint' }, 'or paste it with ', h('kbd', null, '⌘V'), ' (a screenshot on your clipboard works too)'),
    h('button', { class: 'btn', onClick: () => fileInput.click() }, 'Choose file…'), fileInput);
  zone.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); } });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { zone.classList.remove('over'); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); e.stopPropagation(); applyCapture(ed, f); } });
  panel.append(zone);

  const scope = (value, label) => h('label', null, h('input', { type: 'radio', name: 'scope', checked: state.ui.captureScope === value, onChange: () => { state.ui.captureScope = value; rememberUI(); } }), label);
  panel.append(h('div', { class: 'field' }, h('label', null, 'Use the new screenshot for'),
    h('div', { class: 'radio-row' }, scope('all', 'All languages'), scope('locale', `${locale.name} only`)),
    h('div', { class: 'hint' }, 'Use “only” once the app is captured in that language, so its UI matches the headline.')));

  if (name) {
    panel.append(h('div', { class: 'section' }, h('h4', null, 'Language coverage'),
      h('div', { class: 'cover-grid' }, engine.project.locales.map((loc) => {
        const localized = Boolean(engine.data.captures[loc.id]?.[set]?.[name]);
        return h('button', { 'aria-pressed': String(loc.id === locale.id), title: localized ? 'Has its own screenshot' : 'Uses the shared screenshot', onClick: () => ed.ctx.setLocale(loc.id) },
          h('span', { class: `dot${localized ? ' localized' : ''}` }), loc.id);
      })),
      h('div', { class: 'hint' }, 'Green = has its own screenshot. Grey = uses the shared one.')));
  }

  return { el: panel, focusFrame() { frameSection.scrollIntoView({ block: 'start' }); frameSelect.focus({ preventScroll: true }); }, afterRender() { const img = panel.querySelector('.capture-preview img'); if (img?.complete) describeFit(img); } };
}

// ---------------------------------------------------------------------------------------------

async function snapshotCapture(scope, set, name) {
  const hit = engine.data.captures[scope]?.[set]?.[name];
  if (!hit) return null;
  try { return await (await fetch(`/project/captures/${scope}/${set}/${hit.file}?v=${hit.mtime}`)).blob(); } catch { return null; }
}

/** Save a dropped / pasted / chosen image as the screenshot of the current device layer. */
export async function applyCapture(ed, file) {
  const locale = ed.locale();
  const layer = targetDeviceLayer(ed);
  const dev = deviceForLayer(engine.project, ed.device(), layer ?? {});
  const existingName = layer?.capture;
  const name = existingName || uniqueId(Object.keys(engine.data.captures[state.ui.captureScope === 'locale' ? locale.id : 'default']?.[dev.capture] ?? {}), slugify(file.name?.replace(/\.[^.]+$/, '') || 'screenshot', 'screenshot'));
  const started = { project: engine.project, slideId: ed.slide().id, deviceId: ed.deviceId(), localeId: locale.id };
  if (!layer) { toast('This layout has no device to put a screenshot in. Add one in the Layers tab.', { error: true }); return; }
  const scope = state.ui.captureScope === 'locale' ? locale.id : 'default';
  let png;
  try { png = await toPNG(file); } catch { toast('The browser could not read that file as an image.', { error: true }); return; }
  const active = () => engine.project === started.project && ed.slide().id === started.slideId && ed.deviceId() === started.deviceId && ed.locale().id === started.localeId && ed.layerById(layer.id);
  if (!active()) return;
  const previous = await snapshotCapture(scope, dev.capture, name);
  if (!active()) return;
  try { await uploadCapture({ scope, device: dev.capture, name, blob: png.blob, create: !existingName }); } catch (err) { toast(`Could not save the screenshot: ${err.message}`, { error: true }); return; }
  if (!active()) return;
  if (!existingName) ed.setLayer(ed.layerById(layer.id), { capture: name, captureSet: dev.capture }, { rebuild: true });
  const expected = layer._screenSize ?? engine.expectedCaptureSize(dev, layer);
  let note = '';
  if (expected && Math.abs(png.width / png.height - expected[0] / expected[1]) > 0.02) note = ` · ${png.width}×${png.height} does not match the frame's ${sizeText(expected)} screen and will be ${layer.fit === 'stretch' ? 'stretched' : layer.fit === 'contain' ? 'letterboxed' : 'cropped'}`;
  const canUndo = existingName && (previous || scope !== 'default');
  toast(`${scope === 'default' ? 'Screenshot updated for all languages' : `Screenshot updated for ${locale.name} only`}${note}`, {
    timeout: 9000,
    action: canUndo ? { label: 'Undo', onClick: async () => {
      if (previous) await uploadCapture({ scope, device: dev.capture, name, blob: previous });
      else await removeCapture({ scope, device: dev.capture, name });
      ed.afterCaptureChange();
    } } : undefined,
  });
  ed.afterCaptureChange();
}
