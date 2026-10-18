import { engine, state } from '../store.js';
import { STORY_TEMPLATES } from '../story-templates.js';
import { CONNECTED_DESIGNS, SERIES_GAP } from '../connected-series.js';
import { DEVICE_COMPOSITIONS, compositionHardware } from '../device-compositions.js';
import { STARTER_PALETTES } from '../design-library.js';
import { availableProfilesFor } from '../profiles.js';
import { canvasMetrics, layoutFor } from '../layouts.js';
import { canvasForSlide } from '../canvas-orientation.js';
import { withLoadedDesign } from '../design-ops.js';
import { layoutOptions } from './layout-picker.js';
import { PLAY_TARGETS } from '../google-play.js';
import { captureItems } from '../media.js';
import { drawConnectedPreview } from './connected-series.js';
import { drawCompositionPreview } from './composition-preview.js';
import { h, modal, segmented, selectInput, drawInto } from './helpers.js';
import { storeImagesPicker } from './store-images-picker.js';
import { slideSupportsCanvas } from '../slide-order.js';

const COLLECTIONS = [
  { id: 'styled', name: 'Complete designs', note: 'Artwork, device placement and typography designed together.', designs: STORY_TEMPLATES },
  { id: 'layouts', name: 'Device arrangements', note: 'Device positions and rotations. When loaded on a screen, existing text and artwork stay in place.', designs: DEVICE_COMPOSITIONS },
  { id: 'connected', name: 'Connected series', note: 'Devices and artwork flow across 2–5 screens, with space between the store images.', designs: CONNECTED_DESIGNS },
];

/** One entry point for complete designs, device layouts and connected screenshots. */
export function openNewDesignGallery({ slide, deviceId, captures = [], initialCount = null, mode = 'add' }) {
  const loading = mode === 'load';
  const project = engine.project, fingerprint = JSON.stringify(project);
  const options = layoutOptions();
  const collections = loading ? [
    { id: 'saved', name: 'Saved designs', note: 'Reusable layouts saved in this project. Your screen keeps its text, screenshots and colours.', designs: options.filter(o => o.kind === 'template').map(o => ({ ...o, name: o.label })) },
    ...COLLECTIONS.filter(c => c.id !== 'connected'),
    { id: 'basic', name: 'Basic layouts', note: 'Simple starting layouts for text and devices.', designs: options.filter(o => o.kind === 'builtin').map(o => ({ ...o, name: o.label })) },
  ] : COLLECTIONS;
  const currentPalette = { ...(project.themes?.[slide.theme] ?? { bg: '#ffffff', ink: '#202126' }), ...slide.colors };
  const source = captures.slice(0, 5), chosen = [...source];
  const available = [...source, ...captureItems(engine.data.captures, state.ui.locale)]
    .filter((item, index, all) => all.findIndex(x => x.set === item.set && x.name === item.name) === index);
  const canvases = Object.entries(project.devices);
  return new Promise(resolve => {
    let category = 'all', screenFilter = loading ? '1' : initialCount ? String(initialCount) : 'all', includeText = true;
    let selected = { group: 'styled', design: STORY_TEMPLATES[0] }, count = initialCount ?? 1;
    let canvasId = deviceId, profileId = '', customPalette = null, gap = SERIES_GAP, settled = false, allCanvases = false;
    const imageCache = new Map(), cards = [], sections = [];
    const finish = value => { if (settled) return; settled = true; resolve(value); dialog.close(); };
    const paletteFor = design => customPalette ?? design.palette ?? currentPalette;
    const isLayout = group => group === 'saved' || group === 'basic';
    const countFor = group => loading || group === 'layouts' ? 1 : screenFilter !== 'all' ? Number(screenFilter) : group === 'connected' ? Math.max(2, count) : count;
    const visible = group => (category === 'all' || category === group) && (screenFilter === 'all' || (group === 'layouts' ? screenFilter === '1' : group === 'connected' ? screenFilter !== '1' : true));
    const catalogue = h('div', { class: 'design-catalogue' });
    const hero = h('canvas', { 'aria-label': 'Selected design preview' });
    const title = h('h3'), description = h('p', { class: 'hint' });
    const summary = h('span', { class: 'hint', 'aria-live': 'polite' }), error = h('span', { class: 'hint err', role: 'alert' });
    const create = h('button', { class: 'btn primary', onClick: () => {
      if (engine.project !== project || JSON.stringify(project) !== fingerprint) { error.textContent = 'The project changed. Reopen the gallery to continue.'; create.disabled = true; return; }
      if (category === 'store-images') { finish(storePicker.selection()); return; }
      const { group, design } = selected;
      if (loading) { finish({ kind: isLayout(group) ? 'layout' : group === 'styled' ? 'styled' : 'arrangement', option: design, designId: design.id, palette: isLayout(group) ? null : group === 'layouts' ? customPalette : paletteFor(design), profileId, frames: engine.data.frames, deviceIds: allCanvases ? canvases.filter(([id, d]) => (id === deviceId || slideSupportsCanvas(project, slide, id) && !layoutFor(slide, id, d).independent)).map(([id]) => id) : [canvasId], includeText, sourceDeviceId: deviceId }); return; }
      finish({ ...(group === 'layouts' ? {} : { kind: 'series', count, gap, includeText }), designId: design.id,
        palette: paletteFor(design), profileId, frames: engine.data.frames, theme: slide.theme,
        deviceIds: [canvasId], sourceDeviceId: deviceId, captures: Array.from({ length: count }, (_, i) => chosen[i] ?? null) });
    } });
    const textControl = segmented({ label: 'Design text', value: 'with', options: [['with', loading ? 'Keep text' : 'With text'], ['without', 'Without text']], onChange: value => { includeText = value === 'with'; render(); } });
    const textHint = h('p', { class: 'hint' });
    const countControl = h('div');
    const screenshotList = h('div', { class: 'series-screenshots' });
    const gapValue = h('span', { class: 'mono' });
    const gapControl = h('label', { class: 'series-gap' }, 'Space between screens', h('input', { type: 'range', min: 2, max: 16, step: 1, value: 6, 'aria-label': 'Gap between slides', onInput: e => { gap = Number(e.target.value) / 100; render(); } }), gapValue);
    const sourceControls = h('details', { class: 'design-sources' }, h('summary', null, 'Choose screenshots'), screenshotList);
    for (const group of collections) {
      const grid = h('div', { class: `design-card-grid design-card-grid-${group.id}` });
      const section = h('section', { class: 'design-collection', 'aria-label': group.name },
        h('div', { class: 'design-collection-heading' }, h('h3', null, group.name), h('span', { class: 'hint' }, `${group.designs.length} designs`)), h('p', { class: 'hint' }, group.note), grid);
      sections.push({ group, section }); catalogue.append(section);
      if (!group.designs.length) grid.append(h('p', { class: 'hint' }, 'No saved designs yet. Use Save this design in the editor to add one.'));
      for (const design of group.designs) {
        const canvas = h('canvas', { 'aria-label': `${design.name} preview` }), badge = h('span', { class: 'design-card-badge' });
        const card = h('button', { class: 'starter-card design-card', 'aria-label': `${design.name} · ${group.name}`, 'aria-pressed': 'false', onClick: () => {
          selected = { group: group.id, design }; count = countFor(group.id); render();
        } }, h('div', { class: 'design-card-preview' }, canvas), h('b', null, design.name), badge);
        grid.append(card); cards.push({ group: group.id, design, canvas, badge, card });
      }
    }
    const empty = h('p', { class: 'notice', hidden: true }, 'No designs match these filters. Choose All designs or another screen count.'); catalogue.append(empty);
    function screenshots() {
      screenshotList.replaceChildren(...Array.from({ length: count }, (_, i) => h('label', { class: 'series-source' }, h('b', null, i + 1),
        selectInput({ title: `Screenshot ${i + 1}`, value: chosen[i] ? `${chosen[i].set}/${chosen[i].name}` : '', options: [['', 'Add later'], ...available.map(item => [`${item.set}/${item.name}`, `${item.name} · ${item.set}`])], onChange: value => { chosen[i] = available.find(item => `${item.set}/${item.name}` === value) ?? null; render(); } }))));
    }
    function render() {
      const storeImages = category === 'store-images';
      storePicker.el.hidden = !storeImages; catalogue.hidden = storeImages; catalogue.parentElement.hidden = storeImages; screenTabs.hidden = storeImages;
      if (storeImages) {
        settings.hidden = true; create.disabled = false; error.textContent = '';
        create.textContent = storePicker.label(); summary.textContent = storePicker.summary(); return;
      }
      const shown = cards.filter(card => visible(card.group));
      if (!visible(selected.group) && shown.length) { selected = { group: shown[0].group, design: shown[0].design }; count = countFor(selected.group); }
      settings.hidden = !shown.length;
      if (!shown.length) {
        for (const { group, section } of sections) section.hidden = !visible(group.id);
        empty.hidden = category === 'saved'; create.disabled = true; summary.textContent = category === 'saved' ? 'Save a design from the editor to see it here.' : 'Choose another filter to see designs.'; return;
      }
      count = countFor(selected.group);
      const { W, H } = canvasMetrics(canvasForSlide(project, loading ? slide : null, canvasId));
      const { ratio, profile } = compositionHardware(project, profileId, engine.data.frames, canvasId);
      const images = chosen.map(item => {
        if (!item) return null;
        const src = `${engine.projectURL}/captures/${item.scope}/${item.set}/${item.file}?v=${item.mtime}`;
        if (!imageCache.has(src)) { const image = new Image(); imageCache.set(src, image); image.onload = () => { if (!settled) render(); }; image.src = src; }
        const image = imageCache.get(src); return image.complete && image.naturalWidth ? image : null;
      });
      const draw = (canvas, group, design, n, large = false) => {
        if (loading) {
          const key = JSON.stringify([canvasId, profileId, customPalette, includeText, group, design.id]);
          if (canvas.dataset.preview === key) return;
          canvas.dataset.preview = key;
          const preview = withLoadedDesign(project, slide, { kind: isLayout(group) ? 'layout' : group === 'styled' ? 'styled' : 'arrangement', option: design, designId: design.id, palette: isLayout(group) ? null : group === 'layouts' ? customPalette : paletteFor(design), profileId, frames: engine.data.frames, deviceIds: [canvasId], includeText });
          const width = Math.min(large ? 210 : 120, (large ? 230 : 180) * W / H);
          drawInto(canvas, { slideId: slide.id, slide: preview, deviceId: canvasId, localeId: state.ui.locale, width });
        }
        else if (group === 'layouts') drawCompositionPreview(canvas, { designId: design.id, size: [W, H], ratio, palette: paletteFor(design), frame: profile.frame });
        else drawConnectedPreview(canvas, { designId: design.id, count: n, W, H, ratio, gap, includeText, palette: paletteFor(design), frame: profile.frame, images, previewWidth: large ? 440 : 320, previewHeight: large ? 270 : 190 });
      };
      for (const { group, design, canvas, card, badge } of cards) {
        card.hidden = !visible(group);
        card.setAttribute('aria-pressed', String(selected.group === group && selected.design.id === design.id));
        const n = countFor(group);
        badge.textContent = isLayout(group) ? group === 'saved' ? 'Saved in this project' : 'Text & device layout' : `${n} ${n === 1 ? 'screen' : 'screens'} · ${group === 'styled' ? includeText ? loading ? 'Your text' : 'With text' : 'Without text' : group === 'layouts' ? `${design.count} ${design.count === 1 ? 'device' : 'devices'}` : 'Spanning devices'}`;
        if (!card.hidden) draw(canvas, group, design, n);
      }
      for (const { group, section } of sections) section.hidden = !visible(group.id) || (category === 'all' && !group.designs.length);
      empty.hidden = shown.length > 0;
      create.disabled = !shown.length;
      title.textContent = selected.design.name;
      description.textContent = isLayout(selected.group) ? 'Loads the layout using this screen’s text and screenshots.' : selected.group === 'styled' && count === 1 ? 'A complete design with one device and editable artwork.' : selected.design.note ?? `${selected.design.count} editable devices on one screen.`;
      draw(hero, selected.group, selected.design, count, true);
      const options = selected.group === 'layouts' ? [['1', '1 screen']] : Array.from({ length: selected.group === 'connected' ? 4 : 5 }, (_, i) => { const n = i + (selected.group === 'connected' ? 2 : 1); return [String(n), `${n} ${n === 1 ? 'screen' : 'screens'}`]; });
      countControl.replaceChildren(h('label', { class: 'design-control' }, 'Create', selectInput({ title: 'Screens to create', options, value: String(count), onChange: value => {
        count = Number(value); screenFilter = value;
        for (const button of screenTabs.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.textContent === (count === 1 ? '1 screen' : `${count} screens`)));
        render();
      } })));
      countControl.hidden = loading;
      textControl.hidden = selected.group !== 'styled';
      textHint.textContent = loading ? selected.group === 'styled' ? `${includeText ? 'Uses your existing text and screenshot.' : 'Loads artwork and devices without text layers. Your saved copy is kept.'} Replaces this canvas’s layout and artwork. Colours apply to this screen in every canvas size.` : selected.group === 'layouts' ? 'Replaces device layers only on this canvas. Text and artwork stay in place.' : 'Replaces this canvas’s layout. Your text and screenshot files are kept.' : selected.group === 'styled' ? includeText ? 'Editable example text. Replace it with your own copy.' : 'Artwork and devices only. You can add text in the editor.' : 'Device arrangements start without text. Add your own in the editor.';
      gapControl.hidden = count === 1; gapValue.textContent = `${Math.round(gap * 100)}%`;
      sourceControls.hidden = loading || selected.group === 'layouts'; screenshots();
      appearanceControls.hidden = isLayout(selected.group);
      const raw = PLAY_TARGETS[project.devices[canvasId].target]?.raw;
      error.textContent = raw ? 'This canvas requires a full-screen capture; artwork and device frames are omitted.' : '';
      summary.textContent = loading ? `Replace design · ${slide.name ?? slide.id} · ${allCanvases ? 'all linked canvas sizes' : project.devices[canvasId].short ?? project.devices[canvasId].label}` : `${selected.design.name} · ${count} ${count === 1 ? 'screen' : 'screens'}${selected.group === 'styled' ? includeText ? ' · with text' : ' · without text' : ''}`;
      create.textContent = loading ? 'Load design' : count === 1 ? 'Create screen' : `Create ${count} screens`;
    }
    const storePicker = storeImagesPicker(project, render);
    const categoryTabs = segmented({ label: 'Design category', value: category, options: [['all', 'All designs'], ...collections.map(c => [c.id, c.name]), ...(loading ? [] : [['store-images', 'Store images']])], onChange: value => { category = value; render(); } });
    const screenTabs = segmented({ label: 'Number of screens', value: screenFilter, options: [['all', 'Any number'], ...[1,2,3,4,5].map(n => [String(n), `${n} ${n === 1 ? 'screen' : 'screens'}`])], onChange: value => { screenFilter = value; if (value !== 'all') count = Number(value); render(); } });
    const palettes = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Design colours' });
    palettes.append(h('button', { class: 'btn small', 'aria-pressed': 'true', onClick: e => { customPalette = null; for (const b of palettes.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); render(); } }, 'Original colours'));
    const colors = [{ ...currentPalette, name: 'Project colours' }, ...STARTER_PALETTES];
    colors.forEach(p => palettes.append(h('button', { class: 'swatch', title: p.name, 'aria-label': p.name, 'aria-pressed': 'false', style: { background: p.bg }, onClick: e => { customPalette = p; for (const b of palettes.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); render(); } }, h('span', { style: { background: p.ink } }))));
    const appearanceControls = h('div', { class: 'design-appearance' },
      h('label', { class: 'design-control' }, 'Device', selectInput({ title: 'Displayed device', options: [['', 'Match canvas'], ...Object.entries(availableProfilesFor(project, engine.data.frames)).map(([id, p]) => [id, p.label])], value: profileId, onChange: value => { profileId = value; render(); } })), palettes);
    const settings = h('aside', { class: 'design-settings', 'aria-label': 'Customise selected design' },
      h('div', { class: 'design-selected-preview' }, hero), title, description, countControl, textControl, textHint,
      h('details', { class: 'design-options' }, h('summary', null, 'Colours & device'),
        h('label', { class: 'design-control' }, loading ? 'Apply to canvas' : 'Preview canvas', selectInput({ title: 'Preview canvas', options: canvases.filter(([id, d]) => !loading || (id === deviceId || slideSupportsCanvas(project, slide, id) && !layoutFor(slide, id, d).independent)).map(([id, d]) => [id, d.short ?? d.label]), value: canvasId, onChange: value => { canvasId = value; render(); } })),
        appearanceControls), gapControl, sourceControls);
    if (loading && canvases.length > 1) settings.append(h('label', { class: 'row check' }, h('input', { type: 'checkbox', onChange: e => { allCanvases = e.target.checked; render(); } }), 'Also apply to other canvas sizes', h('span', { class: 'hint' }, 'Unique designs are kept.')));
    const body = h('div', { class: 'design-gallery' },
      h('p', { class: 'design-gallery-intro' }, loading ? 'Choose a design for the current screen. Preview it, then Load design to apply. No new screens are created.' : 'Add screenshot designs or choose Store images for App Store search and header artwork, or a Google Play feature graphic. To change an existing screen, use Design → Load design.'),
      h('div', { class: 'design-gallery-filters' }, categoryTabs, loading ? null : screenTabs),
      h('div', { class: 'design-gallery-content' }, catalogue, settings), storePicker.el);
    const dialog = modal({ title: loading ? 'Load design' : 'Add screens', wide: true, body, actions: [summary, error, h('span', { class: 'spacer' }), h('button', { class: 'btn', onClick: () => finish(null) }, 'Cancel'), create], onClose: () => finish(null) });
    render();
  });
}
