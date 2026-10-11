import { engine, state, checkpoint, saveStudio } from '../store.js';
import { reorderSlides, renameSlide } from '../project-ops.js';
import { h, modal, promptDialog } from './helpers.js';

export async function renameScreen(id, refresh) {
  const project = engine.project, slide = project.slides.find(s => s.id === id);
  if (!slide) return;
  const name = await promptDialog({ title: 'Rename screen', label: 'Screen name', value: slide.name ?? slide.id, confirmLabel: 'Rename', hint: 'The screen name is shared by all languages. Screenshot files and translated text keep their names.' });
  if (!name || project !== engine.project || name === slide.name) return;
  checkpoint(); renameSlide(project, id, name); saveStudio(); refresh();
}

export async function moveScreen(from, to, after, refresh, localeId = state.ui.locale) {
  if (from === to) return;
  const project = engine.project;
  let scope = 'current';
  if (project.locales.length > 1) scope = await new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled) return; settled = true; resolve(value); dialog.close(); };
    const dialog = modal({ title: 'Change screen order', body: h('p', null, `Apply this order to all languages or only ${engine.localeInfo(localeId).native}?`),
      actions: [h('button', { class: 'btn', onClick: () => finish(null) }, 'Cancel'),
        h('button', { class: 'btn', onClick: () => finish('current') }, 'This language only'),
        h('button', { class: 'btn primary', onClick: () => finish('all') }, 'All languages')], onClose: () => finish(null) });
  });
  if (!scope || project !== engine.project) return;
  checkpoint(); reorderSlides(project, from, to, after, localeId, scope === 'all'); saveStudio(); refresh();
}
