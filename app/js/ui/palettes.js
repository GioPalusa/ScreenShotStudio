import { engine, checkpoint, saveStudio } from '../store.js';
import { savePalette, paletteColors } from '../design-library.js';
import { h, modal, toast } from './helpers.js';

export function paletteSwatches(ed, onPick) {
  const theme = engine.project.themes?.[ed.slide().theme];
  return h('div', { class: 'palette-colours', role: 'group', 'aria-label': 'Palette colours' },
    paletteColors(theme).map(colour => h('button', { class: 'colour-dot', style: { background: colour }, title: `Use ${colour} from ${theme?.name ?? 'this palette'}`, 'aria-label': `Use ${colour}`, onClick: () => onPick(colour) })));
}

export function openPaletteEditor(ed) {
  const project = engine.project, slide = ed.slide();
  const base = slide.colors ?? project.themes?.[slide.theme] ?? { bg: '#ffffff', ink: '#000000' };
  const colours = [...(project.themes?.[slide.theme]?.swatches ?? [])];
  const name = h('input', { class: 'input', placeholder: 'e.g. Summer launch', 'aria-label': 'Palette name', title: 'A name for this reusable project palette' });
  const bg = h('input', { type: 'color', value: base.bg.slice(0, 7), title: 'Default slide background' });
  const ink = h('input', { type: 'color', value: base.ink.slice(0, 7), title: 'Default text colour' });
  const extras = h('div', { class: 'palette-editor-colours' });
  function renderExtras() {
    extras.replaceChildren(...colours.map((colour, index) => h('div', { class: 'row' },
      h('input', { type: 'color', value: colour, title: `Extra colour ${index + 1}`, onInput: e => { colours[index] = e.target.value; } }),
      h('button', { class: 'btn small', title: `Remove extra colour ${index + 1}`, onClick: () => { colours.splice(index, 1); renderExtras(); } }, 'Remove'))));
  }
  renderExtras();
  const error = h('div', { class: 'hint err', role: 'alert' });
  const save = h('button', { class: 'btn primary', onClick: () => {
    if (!name.value.trim()) { error.textContent = 'Give this palette a name.'; name.focus(); return; }
    if (engine.project !== project || ed.slide() !== slide) { error.textContent = 'The project or slide changed. Reopen the palette editor.'; return; }
    const token = checkpoint();
    slide.theme = savePalette(project, name.value, { bg: bg.value, ink: ink.value, swatches: colours });
    delete slide.colors; saveStudio(); ed.refresh({ immediate: true, inspector: true }); m.close();
    toast(`Saved palette “${name.value.trim()}”`, { action: { label: 'Undo', onClick: () => ed.undoStep(token) } });
  } }, 'Save and use palette');
  const m = modal({ title: 'Create colour palette', body: h('div', { class: 'field' },
    h('label', null, 'Palette name'), name,
    h('div', { class: 'row' }, h('span', null, 'Background'), bg, h('span', null, 'Text'), ink),
    h('h4', null, 'Extra colours'), h('div', { class: 'hint' }, 'These colours are available on text and shape layers. The palette is saved inside this project and can be reused on every slide.'), extras,
    h('button', { class: 'btn', onClick: () => { colours.push('#e88755'); renderExtras(); } }, '＋ Add colour'), error),
    actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), save] });
  name.focus();
}
