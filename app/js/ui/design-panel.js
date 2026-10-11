// Inspector → Design: the slide's name and colours, and its layout - which template it follows, saving the
// layout as a template for other slides, and resetting.

import { engine, state, checkpoint, saveStudio } from '../store.js';
import { TEMPLATE_LABELS, layoutFor } from '../layouts.js';
import { templateUsage, templateOf } from '../layer-ops.js';
import { openPaletteEditor } from './palettes.js';
import { h, toast, confirmDialog } from './helpers.js';
import { sceneHasContent } from '../preflight.js';

export function buildDesignPanel(ed) {
  const slide = ed.slide();
  const dev = ed.device();
  const deviceId = ed.deviceId();
  const project = engine.project;
  const layout = layoutFor(slide, deviceId, dev);
  const scene = ed.scene ?? engine.scene(slide.id, deviceId, state.ui.locale);
  const independent = Boolean(layout.independent || ed.localeScope());
  const panel = h('div', { class: 'panel' });

  // ----- name
  const nameInput = h('input', { class: 'input', value: slide.name ?? '', style: { width: '100%' } });
  // handlers look the slide up when they run: the project can be replaced from disk while this panel is open
  nameInput.addEventListener('change', () => { const s = ed.slide(); checkpoint(); s.name = nameInput.value.trim() || s.id; saveStudio(); ed.rebuildRail(); ed.refresh(); });
  panel.append(h('div', { class: 'field' }, h('label', null, 'Slide name', h('span', { class: 'sub' }, '· for your reference only')), nameInput));

  // ----- layout
  const templateId = templateOf(project, slide, deviceId);
  const template = templateId ? project.templates[templateId] : null;
  const usage = templateId ? templateUsage(project, templateId) : [];
  const customLayers = layout.template === 'custom' && layout.layers?.length > 0;
  const builtinLabel = customLayers ? 'Custom layout' : TEMPLATE_LABELS[layout.template ?? slide.template ?? 'text-top'] ?? 'Custom layout';
  const tweaked = Boolean((layout.overrides && Object.keys(layout.overrides).length) || layout.layers?.length);

  const section = h('div', { class: 'section' }, h('h4', null, 'Screen design'));
  section.append(h('div', { class: 'layout-now' },
    h('div', null, h('b', null, template ? template.name : builtinLabel), h('div', { class: 'hint' }, template ? `Linked to a saved design · ${usage.length} screen${usage.length === 1 ? '' : 's'}${tweaked ? ' · local changes' : ''}` : customLayers ? `${layout.layers.length} editable layers` : tweaked ? 'Built-in layout with your changes' : 'Built-in layout')),
  ));
  section.append(h('div', { class: 'row wrap' },
    h('button', { class: 'btn primary', disabled: independent || Boolean(ed.editTemplateId), title: independent ? 'Turn off Unique design to load a shared design.' : 'Replace the design on this screen; no new screens are added', onClick: () => ed.loadDesign() }, 'Load design…'),
    h('button', { class: 'btn', title: 'Save this screen’s layers and positions for reuse in this project', onClick: () => ed.saveTemplate() }, 'Save this design…')));

  if (template) {
    section.append(h('details', { class: 'template-box', open: Boolean(ed.editTemplateId) }, h('summary', null, 'Saved design link'),
      ed.editTemplateId === templateId
        ? h('div', null, h('b', null, `Editing saved design “${template.name}”`), h('div', { class: 'hint' }, `Changes in the preview and Layers tab reach all ${usage.length} slide${usage.length === 1 ? '' : 's'} that use it.`),
          h('div', { class: 'row' }, h('button', { class: 'btn small primary', onClick: () => ed.editTemplate(null) }, 'Done editing saved design')))
        : h('div', null, h('div', { class: 'hint' }, 'Local edits affect this screen. Editing or updating the saved design affects all linked screens.'),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn small', onClick: () => ed.editTemplate(templateId) }, 'Edit saved design'),
            tweaked ? h('button', { class: 'btn small', title: 'Replace the saved design with this screen’s layout', onClick: () => ed.updateTemplateFromSlide(templateId) }, 'Update from this screen') : null,
            h('button', { class: 'btn small', title: 'Keep this screen’s layout and stop following the saved design', onClick: () => ed.detachTemplate() }, 'Unlink this screen')))));
  }

  const editingTemplate = Boolean(ed.editTemplateId);
  section.append(h('div', { class: 'row' }, h('button', { class: 'btn small', onClick: async () => {
    const mine = ed.peekBlock(); // the slide's block - or, while a template is edited, the template's own
    const hasTweaks = Boolean((mine.overrides && Object.keys(mine.overrides).length) || mine.layers?.length || mine.panorama === false);
    if (editingTemplate || hasTweaks) {
      const n = editingTemplate ? templateUsage(engine.project, ed.editTemplateId).length : 0;
      const body = editingTemplate
        ? `This clears every position, size, image and other change in the saved design “${engine.project.templates[ed.editTemplateId].name}” on this device. It is used by ${n} slide${n === 1 ? '' : 's'}, which all change.`
        : 'Positions, sizes, added images and other changes on this device go back to the layout’s defaults.';
      if (!(await confirmDialog({ title: editingTemplate ? 'Reset saved design?' : 'Reset this layout?', body, confirmLabel: 'Reset' }))) return;
    }
    ed.editLayout((block) => { delete block.overrides; delete block.layers; delete block.panorama; });
    toast(editingTemplate ? 'Saved design reset' : 'Layout reset');
  } }, editingTemplate ? 'Reset saved design' : 'Reset this layout'), h('span', { class: 'hint' }, 'Sizes are in pixels of the exported image.')));
  section.append(h('p', { class: 'hint' }, 'Load changes this screen. Save keeps a reusable layout. To create more screens, use ＋ Add screens in the screen list.'));
  panel.append(section);

  // ----- colours
  const themes = project.themes ?? {};
  const custom = Boolean(slide.colors);
  const bg = h('input', { type: 'color', value: (slide.colors?.bg ?? scene.theme.bg).slice(0, 7) });
  const ink = h('input', { type: 'color', value: (slide.colors?.ink ?? scene.theme.ink).slice(0, 7) });
  const applyColors = () => { checkpoint('colors'); ed.slide().colors = { bg: bg.value, ink: ink.value }; saveStudio(); ed.refresh(); };
  bg.addEventListener('input', applyColors);
  ink.addEventListener('input', applyColors);
  panel.append(h('div', { class: 'section' }, h('h4', null, 'Colours · all languages'),
    h('div', { class: 'swatches' }, Object.entries(themes).map(([key, t]) => h('button', {
      class: 'swatch', title: t.name, style: { background: t.bg }, 'aria-pressed': String(slide.theme === key && !custom),
      onClick: () => { const s = ed.slide(); checkpoint(); s.theme = key; delete s.colors; saveStudio(); ed.refresh({ immediate: true, inspector: true }); },
    }, h('span', { style: { background: t.ink } })))),
    h('div', { class: 'row' }, h('span', { class: 'label' }, 'Background'), bg, h('span', { class: 'label' }, 'Text'), ink,
      custom ? h('button', { class: 'btn small', onClick: () => { checkpoint(); delete ed.slide().colors; saveStudio(); ed.refresh({ immediate: true, inspector: true }); } }, 'Reset') : null),
    h('button', { class: 'btn small', title: 'Create a reusable palette with background, text and extra layer colours', onClick: () => openPaletteEditor(ed) }, 'Create palette…')));



  // ----- canvas
  const [W, H] = dev.size;
  panel.append(h('div', { class: 'section' }, h('h4', null, 'Canvas'),
    h('div', { class: 'hint' }, `${dev.label}: ${W} × ${H}px${dev.designSize ? ` (layouts are drawn for ${dev.designSize[0]}px wide and scaled)` : ''}.`),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onClick: () => { state.ui.setupTab = 'devices'; ed.ctx.setView('setup'); } }, 'Change canvas size…'))));

  if (!sceneHasContent(scene)) panel.append(h('label', { class: 'row check' }, h('input', { type: 'checkbox', checked: Boolean(slide.exportChecks?.allowEmpty), onChange: e => { checkpoint(); ed.slide().exportChecks = { ...ed.slide().exportChecks, allowEmpty: e.target.checked }; saveStudio(); } }), 'Allow this empty canvas in exports'));
  return { el: panel };
}
