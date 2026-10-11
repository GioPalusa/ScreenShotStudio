// Setup → Frames: the device bezels the project can put screenshots in. Import a bezel PNG and the studio finds its
// screen and the screen's corner radius; fine-tune both here with a live preview, so the screenshot fits exactly and
// the corners line up.

import { frameThumbnail } from './frame-picker.js';
import { engine, state, saveFrame, deleteFrame, frameUsage } from '../store.js';
import { composeBezel, fitCapture, buildHoleMask } from '../devices.js';
import { analyzeFrameData } from '../measure.js';
import { allFrames, frameLabel, humanizeFrameName, APPLE_BEZELS_URL } from '../frames.js';
import { frameGroups, frameModels } from '../frame-matching.js';
import { slugify, uniqueId } from '../layer-ops.js';
import { pickFiles, measureFrameFile } from '../assets.js';
import { h, toast, modal, confirmDialog, selectInput, numberInput, round1 } from './helpers.js';

const radiusValue = (r) => (Array.isArray(r) ? r[0] : r ?? 0);
let importingDMG = false;

export function buildFramesView(ctx) {
  const root = h('div', { class: 'setup-section' });
  const frames = engine.data.frames;
  const supportsDMG = Boolean(window.studioDesktop?.importFrameDmg);

  root.append(h('div', { class: 'setup-intro' },
    h('div', null, h('h3', null, 'Get more frames'),
      h('p', { class: 'hint' }, 'Add Apple frames in two steps. Your imported frames stay inside this project.'))));

  root.append(h('div', { class: 'frame-import-steps' },
    h('section', { class: 'frame-import-step', 'aria-label': 'Step 1: Download from Apple' },
      h('span', { class: 'frame-step-number', 'aria-hidden': 'true' }, '1'),
      h('h4', null, 'Download from Apple'),
      h('p', null, 'Choose your device on Apple Design Resources and download its bezel DMG.'),
      h('a', { class: 'btn primary', href: APPLE_BEZELS_URL, target: '_blank', rel: 'noopener' }, 'Get Apple bezels ↗')),
    h('section', { class: 'frame-import-step frame-import-zone', 'aria-label': 'Step 2: Drop your DMG here', onDragover: e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; e.currentTarget.classList.add('over'); } }, onDragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('over'); }, onDrop: e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('over'); void importFrames([...e.dataTransfer.files]); } },
      h('span', { class: 'frame-step-number', 'aria-hidden': 'true' }, '2'),
      h('h4', null, supportsDMG ? 'Drop your DMG here' : 'Import your bezel PNGs'),
      h('p', null, supportsDMG ? 'Drag the downloaded DMG into this box. Accept Apple’s agreement in macOS, then choose your frames.' : 'Open the DMG in Finder, accept Apple’s agreement, then drop its PNGs here. Direct DMG import is available in the Mac app.'),
      h('button', { class: 'btn primary', onClick: () => supportsDMG ? importDMG() : importFrames() }, supportsDMG ? 'Choose DMG…' : 'Choose PNGs…'))));
  root.append(h('div', { class: 'frame-import-alternative row wrap' },
    h('span', { class: 'hint' }, 'Already have bezel PNGs?'),
    h('button', { class: 'btn small', onClick: () => importFrames() }, 'Import PNGs…')));
  if (!Object.keys(frames).length) root.append(h('p', { class: 'hint frame-empty' }, 'No imported frames yet. Start with step 1 above, or use a Studio illustration below.'));
  const groups = frameGroups(allFrames(frames), frames);
  if (!groups.some(group => group.id === 'iphone')) groups.unshift({ id: 'iphone', label: 'iPhone', options: [] });
  const tabs = h('div', { class: 'frame-families', role: 'group', 'aria-label': 'Device type' });
  const gallery = h('div', { class: 'frame-gallery' });
  const show = group => {
    for (const button of tabs.children) button.setAttribute('aria-pressed', String(button.dataset.family === group.id));
    gallery.replaceChildren(h('h4', { class: 'setup-sub' }, `${group.label} · ${group.options.length} frames`));
    if (!group.options.length) gallery.append(h('div', { class: 'iphone-frame-empty' },
      h('h3', null, 'Add your first iPhone frame'),
      h('p', null, 'We recommend downloading Apple’s iPhone bezels for an authentic device frame. Import the downloaded DMG to choose the models you want.'),
      h('a', { class: 'btn primary', href: APPLE_BEZELS_URL, target: '_blank', rel: 'noopener' }, 'Download iPhone bezels'),
      h('button', { class: 'btn', onClick: () => supportsDMG ? importDMG() : importFrames() }, supportsDMG ? 'Import downloaded DMG…' : 'Import bezel PNGs…')));
    for (const model of frameModels(group.options, frames)) {
      gallery.append(h('section', { class: 'frame-model' }, h('h5', null, model.label), h('div', { class: 'frame-grid' }, model.options.map(option => option.ref.type === 'bezel' ? card(option.ref.name) :
        h('div', { class: 'frame-card' }, h('div', { class: 'frame-thumb' }, frameThumbnail(option.ref)), h('div', { class: 'frame-info' }, h('b', null, option.label), h('div', { class: 'hint' }, 'Studio illustration')))))));
    }
  };
  for (const group of groups) tabs.append(h('button', { class: 'btn small', dataset: { family: group.id }, onClick: () => show(group) }, group.label));
  root.append(tabs, gallery);
  if (groups.length) show(groups[0]);

  function card(name) {
    const meta = frames[name];
    const uses = frameUsage(name);
    const s = meta.screen;
    return h('div', { class: 'frame-card' },
      h('div', { class: 'frame-thumb' }, h('img', { src: engine.assetUrl('frames', name), alt: '', loading: 'lazy' })),
      h('div', { class: 'frame-info' },
        h('b', { title: name }, meta.variant ?? frameLabel({ type: 'bezel', name }, frames)),
        h('div', { class: 'hint', title: `${s.mode === 'overlay' ? 'Painted-in' : 'Transparent'} screen · corner radius ${Array.isArray(s.radius) ? s.radius.map(Math.round).join('/') : Math.round(s.radius ?? 0)}px` }, `${s.w} × ${s.h}px screen`),
        h('div', { class: 'hint' }, uses.length ? `Used in ${uses.length} place${uses.length === 1 ? '' : 's'}` : 'Project frame'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onClick: () => openEditor({ name }) }, 'Fit and corners…'))));
  }

  async function importDMG(file = null) {
    if (!supportsDMG) { toast('Open this project in the Mac app to import a DMG.', { error: true }); return; }
    if (importingDMG) { toast('A disk image is already opening. Finish its macOS dialog first.'); return; }
    importingDMG = true;
    const projectId = state.projectId;
    let dismissed = false;
    const progress = modal({ title: 'Opening bezel DMG', body: h('p', { role: 'status' }, 'Review the macOS agreement if one appears. Accept to continue, or decline to cancel. Studio will continue automatically when the disk is ready.'), onClose: () => { dismissed = true; } });
    try {
      const result = await window.studioDesktop.importFrameDmg(file);
      // Background refreshes rebuild this view and replace project objects.
      // Only a different document or explicit cancellation invalidates the import.
      const discard = dismissed || state.projectId !== projectId;
      progress.close();
      if (result.warning) toast(result.warning, { timeout: 9000 });
      if (discard || result.canceled) return;
      const files = result.files.map(item => new File([item.bytes], item.name, { type: 'image/png' }));
      await importFrames(files, { batch: true });
    } catch (error) {
      progress.close();
      toast(`Could not import that DMG: ${error.message}`, { error: true });
    } finally { importingDMG = false; }
  }

  async function importFrames(dropped = null, { batch = false } = {}) {
    const files = dropped ?? await pickFiles({ accept: 'image/png', multiple: true });
    if (!files.length) return;
    if (files.some(file => /\.dmg$/i.test(file.name))) {
      if (files.length !== 1) { toast('Drop one DMG at a time, without other files.', { error: true }); return; }
      return importDMG(files[0]);
    }
    if (files.length === 1 && !batch) {
      try {
        const file = files[0], { canvas, meta } = await measureFrameFile(file);
        await openEditor({ file, canvas, meta, name: uniqueId(Object.keys(engine.data.frames), slugify(file.name.replace(/\.[^.]+$/, ''), 'frame')) });
      } catch (err) { toast(`Could not use that image as a frame: ${err.message}`, { error: true }); }
      return;
    }
    const projectId = state.projectId, ready = [], urls = [];
    let closed = false, busy = false;
    const list = h('div', { class: 'frame-picker-grid' });
    const status = h('p', { class: 'hint', role: 'status' }, 'Finding screen cut-outs…');
    const save = h('button', { class: 'btn primary', disabled: true, onClick: async () => {
      if (busy) return; busy = true; save.disabled = true;
      let count = 0;
      try {
        for (const item of ready.filter(item => item.check.checked && !item.saved)) {
          if (state.projectId !== projectId) throw new Error('Project changed; remaining frames were not imported.');
          const name = uniqueId(Object.keys(engine.data.frames), slugify(item.file.name.replace(/\.[^.]+$/, ''), 'frame'));
          await saveFrame({ name, png: item.file, meta: { ...item.meta, label: humanizeFrameName(name) }, replace: false });
          item.saved = true; item.check.disabled = true; count++;
        }
        m.close(); ctx.go({}); toast(`Saved ${count} frames`);
      } catch (err) { status.textContent = `${count} frames saved. ${err.message}`; save.disabled = false; }
      finally { busy = false; }
    } }, 'Import selected frames');
    const m = modal({ title: 'Import bezel PNGs', wide: true, body: h('div', null, status, list), actions: [save], onClose: () => { closed = true; for (const url of urls) URL.revokeObjectURL(url); } });
    for (const file of files) {
      if (closed) break;
      try {
        const { meta } = await measureFrameFile(file);
        if (closed) break;
        const url = URL.createObjectURL(file); urls.push(url);
        const check = h('input', { type: 'checkbox', checked: true, title: `Import ${file.name}` });
        ready.push({ file, meta, check });
        list.append(h('label', { class: 'frame-card' }, h('div', { class: 'frame-thumb' }, h('img', { src: url, alt: '' })), h('div', { class: 'frame-info' }, h('div', { class: 'row' }, check, file.name), h('small', null, `${meta.screen.w} × ${meta.screen.h}px screen`))));
      } catch (err) { list.append(h('div', { class: 'frame-card hint err' }, `${file.name}: ${err.message}`)); }
    }
    status.textContent = `${ready.length} of ${files.length} frames ready. Review the previews before importing.`;
    save.disabled = !ready.length;
  }

  /**
   * The editor. Existing frame: { name }. New one: { name, file, canvas, meta } straight from import.
   */
  async function openEditor(source) {
    const isNew = Boolean(source.file);
    const name = source.name;
    const stored = frames[name];
    let image = source.canvas ?? (await engine.loadImage(engine.assetUrl('frames', name)));
    let pngBlob = null;                 // set when a new image is being uploaded
    if (!image) { toast('That frame’s image is missing.', { error: true }); return; }
    const imageSize = () => [image.naturalWidth ?? image.width, image.naturalHeight ?? image.height];
    const initial = source.meta ?? (await engine.loadFrame(name)).meta ?? stored;
    const draft = {
      ...(stored?.family ? { family: stored.family, device: stored.device, variant: stored.variant } : {}),
      label: stored?.label ?? '',
      size: initial.size ?? imageSize(),
      silhouette: initial.silhouette,
      screen: { mode: 'hole', ...initial.screen },
    };
    if (draft.screen.radius === undefined) draft.screen.radius = 0;
    let sample = null;
    let showOutline = true;
    let holeMask = null; // the shape of the cut-out screen, measured from the image (it only changes with the image)
    const analyse = () => {
      const c = document.createElement('canvas');
      c.width = imageSize()[0]; c.height = imageSize()[1];
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(image, 0, 0);
      return analyzeFrameData(g.getImageData(0, 0, c.width, c.height));
    };
    const measureMask = () => {
      try { const found = analyse(); holeMask = found.meta.screen.mode === 'hole' ? buildHoleMask(found.mask, c0(found), c1(found)) : null; } catch { holeMask = null; }
    };
    const c0 = (found) => found.meta.size[0];
    const c1 = (found) => found.meta.size[1];
    measureMask();

    const preview = h('canvas', { class: 'frame-preview' });
    const info = h('div', { class: 'hint' });
    const fitInfo = h('div', { class: 'hint' });
    const inputs = {};

    function paint() {
      const [W, H] = draft.size;
      const scale = Math.min(360 / W, 520 / H, 1);
      const composed = composeBezel({ frameImage: image, meta: { size: draft.size, screen: draft.screen }, capture: sample?.image ?? null, placeholder: ['preview'], fit: 'fill', radius: draft.screen.radius, holeMask: draft.screen.mode === 'hole' ? holeMask : null });
      preview.width = Math.round(W * scale);
      preview.height = Math.round(H * scale);
      const g = preview.getContext('2d');
      g.fillStyle = '#9aa0aa';
      g.fillRect(0, 0, preview.width, preview.height);
      g.drawImage(composed.canvas, 0, 0, preview.width, preview.height);
      if (showOutline) {
        const { x, y, w, h: hh } = draft.screen;
        const r = Array.isArray(draft.screen.radius) ? draft.screen.radius : Array(4).fill(draft.screen.radius ?? 0);
        g.save();
        g.scale(scale, scale);
        g.lineWidth = 3 / scale;
        g.setLineDash([10 / scale, 7 / scale]);
        g.strokeStyle = '#ff2d78';
        g.beginPath();
        g.roundRect(x, y, w, hh, r.map((v) => Math.max(0, Math.min(v, Math.min(w, hh) / 2))));
        g.stroke();
        g.restore();
      }
      info.textContent = `Screenshots for this frame should be ${draft.screen.w} × ${draft.screen.h}px.`;
      if (sample?.image) {
        const fit = fitCapture([draft.screen.w, draft.screen.h], [sample.image.naturalWidth, sample.image.naturalHeight], { fit: 'fill' });
        fitInfo.className = `hint ${fit.exact ? 'ok' : fit.aspectDiff > 0.02 ? 'warn' : ''}`;
        fitInfo.textContent = fit.exact ? `✓ The sample (${sample.label}) is exactly this size.` : `The sample (${sample.label}, ${sample.image.naturalWidth} × ${sample.image.naturalHeight}) is scaled ${(fit.scale * 100).toFixed(1)}%${fit.aspectDiff > 0.02 ? ` and ${(((fit.cropX / sample.image.naturalWidth) + (fit.cropY / sample.image.naturalHeight)) * 100).toFixed(1)}% of it is cropped` : ''}.`;
      } else { fitInfo.textContent = ''; fitInfo.className = 'hint'; }
    }

    const num = (key, label, get, set, extra = {}) => {
      const input = numberInput({ value: round1(get()), step: 1, ...extra, onInput: (v) => { set(v); paint(); } });
      inputs[key] = input;
      return h('label', { class: 'geom' }, h('span', null, label), input);
    };
    const refreshInputs = () => {
      inputs.x.value = draft.screen.x; inputs.y.value = draft.screen.y; inputs.w.value = draft.screen.w; inputs.h.value = draft.screen.h;
      inputs.r.value = round1(radiusValue(draft.screen.radius));
      mode.value = draft.screen.mode;
    };
    const mode = selectInput({ options: [['hole', 'Cut-out screen (transparent hole)'], ['overlay', 'Painted-in screen (draw on top)']], value: draft.screen.mode, onChange: (v) => { draft.screen.mode = v; paint(); } });

    // sample screenshot to preview with: the shared captures whose shape is closest to this screen
    const sampleOptions = [];
    for (const [set, byName] of Object.entries(engine.data.captures.default ?? {})) for (const n of Object.keys(byName)) sampleOptions.push({ key: `${set}/${n}`, set, name: n, hit: byName[n] });
    const loadSample = async (key) => {
      const item = sampleOptions.find((o) => o.key === key);
      sample = null;
      if (item) {
        const img = await engine.loadImage(`/project/captures/default/${item.set}/${item.hit.file}?v=${item.hit.mtime}`);
        if (img) sample = { image: img, label: item.key };
      }
      paint();
    };
    const sampleSelect = selectInput({ options: [['', 'No screenshot (placeholder)'], ...sampleOptions.map((o) => [o.key, o.key])], value: '', onChange: loadSample });

    const nameInput = h('input', { class: 'input', value: name, disabled: !isNew, style: { width: '100%' } });
    const labelInput = h('input', { class: 'input', value: draft.label, placeholder: humanizeFrameName(name), style: { width: '100%' } });
    labelInput.addEventListener('input', () => { draft.label = labelInput.value; });

    const redetect = h('button', { class: 'btn small', title: 'Find the screen and corner radius in the image again', onClick: () => {
      try {
        const found = analyse();
        draft.screen = { ...found.meta.screen };
        draft.silhouette = found.meta.silhouette;
        holeMask = found.meta.screen.mode === 'hole' ? buildHoleMask(found.mask, found.meta.size[0], found.meta.size[1]) : null;
        refreshInputs(); paint();
      } catch (err) { toast(err.message, { error: true }); }
    } }, 'Detect again');

    const replace = !isNew ? h('button', { class: 'btn small', onClick: async () => {
      const [file] = await pickFiles({ accept: 'image/png' });
      if (!file) return;
      try {
        const { canvas, meta } = await measureFrameFile(file);
        image = canvas; pngBlob = file; draft.size = meta.size; draft.silhouette = meta.silhouette; draft.screen = { ...meta.screen };
        measureMask();
        refreshInputs(); paint();
      } catch (err) { toast(`Could not read that image: ${err.message}`, { error: true }); }
    } }, 'Replace image…') : null;

    const outline = h('input', { type: 'checkbox', checked: true, onChange: (e) => { showOutline = e.target.checked; paint(); } });

    const body = h('div', { class: 'frame-editor' },
      h('div', { class: 'frame-editor-preview' }, preview, h('label', { class: 'row check' }, outline, 'Show the screen outline'), fitInfo),
      h('div', { class: 'frame-editor-fields' },
        isNew ? h('div', { class: 'field' }, h('label', null, 'File name'), nameInput, h('div', { class: 'hint' }, 'Letters, numbers and dashes; becomes project/assets/frames/<name>.png')) : null,
        h('div', { class: 'field' }, h('label', null, 'Display name'), labelInput),
        h('div', { class: 'field' }, h('label', null, 'Screen', h('span', { class: 'sub' }, `· px inside the ${draft.size[0]} × ${draft.size[1]} image`)),
          h('div', { class: 'geom-grid' },
            num('x', 'X', () => draft.screen.x, (v) => { draft.screen.x = v; }), num('y', 'Y', () => draft.screen.y, (v) => { draft.screen.y = v; }),
            num('w', 'W', () => draft.screen.w, (v) => { draft.screen.w = Math.max(1, v); }), num('h', 'H', () => draft.screen.h, (v) => { draft.screen.h = Math.max(1, v); }),
            num('r', 'Radius', () => radiusValue(draft.screen.radius), (v) => { draft.screen.radius = Math.max(0, v); })),
          info,
          h('div', { class: 'hint' }, 'The screenshot is clipped to this rounded rectangle (and sits on black) so its corners never show. If the pink outline does not follow the device’s own screen corners, adjust Radius until it does.')),
        h('div', { class: 'field' }, h('label', null, 'How the screen is built'), mode,
          h('div', { class: 'hint' }, 'Cut-out: the screen is transparent in the PNG and the screenshot shows through. Painted-in: the screen is part of the picture, so the screenshot is drawn on top.')),
        h('div', { class: 'field' }, h('label', null, 'Preview with'), sampleSelect),
        h('div', { class: 'row wrap' }, redetect, replace)));

    const save = h('button', { class: 'btn primary', onClick: async () => {
      const fileName = isNew ? slugify(nameInput.value, '') : name;
      if (!fileName) { nameInput.focus(); return; }
      if (isNew && frames[fileName]) { toast(`There is already a frame called “${fileName}”.`, { error: true }); return; }
      try {
        const meta = { ...(draft.label.trim() ? { label: draft.label.trim() } : {}), size: draft.size, screen: { ...draft.screen, radius: Math.round(radiusValue(draft.screen.radius) * 10) / 10 }, silhouette: draft.silhouette };
        if (Array.isArray(draft.screen.radius)) meta.screen.radius = draft.screen.radius.map((v) => Math.round(v * 10) / 10);
        const png = isNew ? source.file : pngBlob;
        await saveFrame({ name: fileName, png, meta, replace: !isNew && Boolean(pngBlob) }); // replacing an existing image is explicit
        m.close();
        ctx.go({});
        toast(isNew ? `Frame “${fileName}” added. Select a device in Editor and choose the frame in Details.` : 'Frame saved.', { timeout: 7000 });
      } catch (err) { toast(`Could not save the frame: ${err.message}`, { error: true }); }
    } }, isNew ? 'Add frame' : 'Save');
    const del = !isNew ? h('button', { class: 'btn danger', onClick: async () => {
      const uses = frameUsage(name);
      const body = uses.length
        ? `This frame is used in ${uses.length} place${uses.length === 1 ? '' : 's'} in this project. Deleting it will replace every use with the Studio generic frame, including other languages and saved designs. ${name}.png and its settings will be deleted.`
        : `${name}.png and its settings will be deleted.`;
      if (!(await confirmDialog({ title: 'Delete this frame?', body, confirmLabel: uses.length ? 'Delete and use generic' : 'Delete', danger: true }))) return;
      try {
        await deleteFrame(name);
        m.close();
        ctx.go({});
        toast(uses.length ? 'Frame deleted. Its uses now have the generic frame.' : 'Frame deleted.');
      } catch (err) { toast(`Could not delete the frame: ${err.message}`, { error: true }); }
    } }, 'Delete frame') : null;

    const m = modal({ title: isNew ? 'Add a device frame' : `Frame · ${frameLabel({ type: 'bezel', name }, frames)}`, body, wide: true, actions: [del, h('span', { class: 'spacer' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), save] });
    paint();

    // preview with a shared screenshot whose shape matches the screen, when there is one
    (async () => {
      const target = draft.screen.w / draft.screen.h;
      let best = null;
      for (const o of sampleOptions) {
        const img = await engine.loadImage(`/project/captures/default/${o.set}/${o.hit.file}?v=${o.hit.mtime}`);
        if (!img) continue;
        const diff = Math.abs(img.naturalWidth / img.naturalHeight - target) / target;
        if (diff < 0.04 && (!best || diff < best.diff)) best = { key: o.key, diff };
      }
      if (best && m.el.isConnected) { sampleSelect.value = best.key; loadSample(best.key); }
    })();
  }

  return root;
}
