// Setup → Saved designs: layouts you saved from a slide. Rename them, copy them, edit one (every slide that uses it
// follows), put them on more slides, or delete them (slides keep their look).

import { engine, state, saveStudio, checkpoint } from '../store.js';
import { templateUsage, renameTemplate, duplicateTemplate, deleteTemplate, followTemplate } from '../layer-ops.js';
import { slideWithOption } from './layout-picker.js';
import { h, toast, modal, confirmDialog, promptDialog, drawInto } from './helpers.js';

export function buildTemplatesView(ctx) {
  const project = engine.project;
  const root = h('div', { class: 'setup-section' });
  const ids = Object.keys(project.templates ?? {});
  const device = project.devices[state.ui.device];
  const [W, H] = device.size;
  const sample = project.slides.find((s) => s.id === state.ui.slideId) ?? project.slides[0];

  root.append(h('div', { class: 'setup-intro' }, h('div', null,
    h('h3', null, 'Saved designs'),
    h('p', { class: 'hint' }, 'Manage reusable designs saved in this project. Create one with Design → Save this design; load one with Design → Load design. Previews use the current screen’s text and screenshots on ', device.short ?? device.label, '.'))));

  const grid = h('div', { class: 'template-grid' });
  for (const id of ids) grid.append(card(id));
  if (!ids.length) grid.append(h('div', { class: 'empty-card' }, h('b', null, 'No saved designs yet'), h('div', { class: 'hint' }, 'Open a slide in the editor, arrange it the way you like, and choose Design → Save this design…')));
  root.append(grid);

  function card(id) {
    const tpl = project.templates[id];
    const users = templateUsage(project, id);
    const canvas = h('canvas');
    if (sample) drawInto(canvas, { slideId: sample.id, deviceId: state.ui.device, localeId: state.ui.locale, width: W > H ? 220 : 130, slide: slideWithOption(sample, state.ui.device, { kind: 'template', id }) });
    const names = users.map((sid) => project.slides.find((s) => s.id === sid)?.name ?? sid);
    return h('div', { class: 'template-card' },
      h('div', { class: 'template-thumb' }, canvas),
      h('div', { class: 'template-info' },
        h('b', null, tpl.name ?? id),
        h('div', { class: 'hint' }, users.length ? `Used by ${users.length}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : 'Not linked to any screen'),
        h('div', { class: 'hint' }, `Canvas sizes: ${Object.keys(tpl.layouts ?? {}).join(', ')}`),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn small primary', onClick: () => ctx.editTemplate(id) }, 'Edit saved design'),
          h('button', { class: 'btn small', onClick: () => useOn(id) }, 'Load on screens…')),
        h('details', { class: 'disclosure' }, h('summary', null, 'Manage design'), h('div', { class: 'row wrap disclosure-body' },
          h('button', { class: 'btn small', onClick: async () => {
            const name = await promptDialog({ title: 'Rename saved design', label: 'Name', value: tpl.name ?? id, confirmLabel: 'Rename' });
            if (name) { checkpoint(); renameTemplate(project, id, name); saveStudio(); ctx.go({}); }
          } }, 'Rename'),
          h('button', { class: 'btn small', onClick: () => { checkpoint(); duplicateTemplate(project, id); saveStudio(); ctx.go({}); } }, 'Duplicate'),
          h('button', { class: 'btn small danger', onClick: async () => {
            if (!(await confirmDialog({ title: `Delete “${tpl.name ?? id}”?`, body: users.length ? `${users.length} slide${users.length === 1 ? ' follows' : 's follow'} it. They keep their current look but stop following the saved design.` : 'It is not used by any slide.', confirmLabel: 'Delete design', danger: true }))) return;
            const token = checkpoint();
            deleteTemplate(project, id);
            saveStudio();
            ctx.go({});
            toast('Saved design deleted', { action: { label: 'Undo', onClick: () => ctx.undoStep(token) } });
          } }, 'Delete')))));
  }

  async function useOn(id) {
    const picks = new Set();
    const using = new Set(templateUsage(project, id));
    const list = h('div', { class: 'checklist single' }, project.slides.map((s) => {
      const box = h('input', { type: 'checkbox', onChange: () => { if (box.checked) picks.add(s.id); else picks.delete(s.id); } });
      return h('label', null, box, h('span', null, s.name ?? s.id), using.has(s.id) ? h('span', { class: 'muted' }, 'already uses it') : null);
    }));
    const ok = await new Promise((resolve) => {
      const apply = h('button', { class: 'btn primary', onClick: () => { resolve(true); m.close(); } }, 'Load design');
      const m = modal({ title: `Load “${project.templates[id].name}” on screens`, body: h('div', null, h('div', { class: 'hint' }, 'Replaces the selected screens’ layouts in every canvas size. Each screen keeps its text, screenshots and colours. Unique designs are kept.'), list), actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), apply], onClose: () => resolve(false) });
    });
    if (!ok || !picks.size) return;
    const token = checkpoint();
    for (const s of project.slides.filter((x) => picks.has(x.id))) followTemplate(project, s, id);
    saveStudio();
    ctx.go({});
    toast(`Design loaded on ${picks.size} slide${picks.size === 1 ? '' : 's'}`, { action: { label: 'Undo', onClick: () => ctx.undoStep(token) } });
  }

  return root;
}
