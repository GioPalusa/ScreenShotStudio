import { copyFields } from '../copy-fields.js';
import { checkControl } from './review-check.js';
import { openCopyReview } from './copy-review.js';
import { translateButton } from './translate-dialog.js';
// Inspector → Text: one editor per text field of the slide (headline, sub text, bullets, any text layer you add),
// for the language being edited, with a live note on whether it fits.

import { engine, editCopy, getCopy, markReviewed, needsReview } from '../store.js';
import { resolveLayers } from '../layouts.js';
import { isOriginalLocale } from '../copy-review.js';
import { h, localeLabel } from './helpers.js';

const FIELD_LABEL = { headline: 'Headline', headlineAccent: 'Accent line', eyebrow: 'Eyebrow', caption: 'Sub text', bullets: 'Bullet list' };
const FIELD_HELP = {
  headline: 'A line break is kept on phones; wider layouts join it when the text fits on one line.',
  caption: 'Shown under the headline on iPad and iPhone Duo, and under the phone on the first slide.',
  bullets: 'One bullet per line.',
};

export const fieldLabel = (field) => FIELD_LABEL[field] ?? field;

/** Text fields still referenced by this language's layouts on any canvas. */
export const slideFields = (slide, localeId) => copyFields(engine.project, engine.data.copy, slide, localeId);

/** Short names of the devices whose layout shows a field. */
function shownOn(slide, field, localeId) {
  const out = [];
  for (const [id, dev] of Object.entries(engine.project.devices)) {
    const { layers } = resolveLayers({ project: engine.project, slide, deviceId: id, localeId });
    if (layers.some((l) => l.type === 'text' && l.field === field && !l.hidden)) out.push(dev.short ?? id);
  }
  return out;
}

export function buildTextPanel(ed, { fields = null, compact = false } = {}) {
  const selected = ed.layerById?.(ed.selectedId);
  const slide = engine.project.slides.find(s => s.id === (selected?.copySlideId ?? selected?._copySlideId)) ?? ed.slide();
  const locale = ed.locale();
  const panel = h('div', { class: 'panel' });
  const banner = h('div');
  let reviewPending;
  function updateReview() {
    const pending = needsReview(locale.id);
    if (pending === reviewPending) return;
    reviewPending = pending;
    banner.className = `banner${pending ? ' warn' : ''}`;
    banner.replaceChildren(...[
      h('div', null, h('b', null, localeLabel(locale)), h('div', { class: 'hint' }, isOriginalLocale(engine.project, locale.id) ? 'Original text' : pending ? 'Text needs review: check the changes before final export' : 'Reviewed text')),
      isOriginalLocale(engine.project, locale.id) ? null : pending ? h('button', { class: 'btn small', onClick: () => { markReviewed(locale.id); ed.rebuildInspector(); } }, 'Mark reviewed') : h('span', { class: 'chip ok' }, '✓ Reviewed'),
    ].filter(Boolean));
  }
  updateReview();
  panel.append(translateButton(ed.ctx, { target: locale.id, slideId: slide.id, fields }, true));
  if (!compact) panel.append(banner, h('button', { class: 'btn small', title: 'Export or import text for external language review', onClick: () => openCopyReview(ed.ctx) }, 'Import / Export…'));
  for (const field of fields ?? slideFields(slide, locale.id)) panel.append(fieldEditor(ed, slide, locale, field, updateReview, compact));
  if (!compact) panel.append(h('div', { class: 'hint' }, 'Text saves automatically. Check marks text that still needs a review.'));

  function updateFitLines(scene) {
    updateReview();
    for (const node of panel.querySelectorAll('[data-check]')) node.refreshCheck?.();
    for (const node of panel.querySelectorAll('[data-fit]')) {
      const field = node.dataset.fit;
      const t = Object.values(scene.texts).find((x) => x.field === field);
      node.className = 'hint';
      if (!t) { node.textContent = `Not shown on ${ed.device().short ?? ed.device().label}.`; continue; }
      const lines = `${t.lines} line${t.lines === 1 ? '' : 's'}`;
      if (t.overflow) { node.className = 'hint err'; node.textContent = 'Too long: it does not fit even at the smallest size. Shorten it.'; }
      else if (t.shrink / (t.baseShrink ?? 1) < 0.85) { node.className = 'hint warn'; node.textContent = `Smaller than the English version (${Math.round(t.shrink * 100)}% vs ${Math.round((t.baseShrink ?? 1) * 100)}%) to fit · ${lines}. Shorter text would look better.`; }
      else if (t.shrink < 0.995) node.textContent = `Fits · scaled to ${Math.round(t.shrink * 100)}% · ${lines}`;
      else { node.className = 'hint ok'; node.textContent = `Fits at full size · ${lines}`; }
    }
  }

  return {
    el: panel,
    afterRender: updateFitLines,
    /** Focus a field's text box (used when you double-click a headline on the stage). */
    focusField(field) { panel.querySelector(`[data-field="${field}"] textarea`)?.focus(); },
  };
}

function fieldEditor(ed, slide, locale, field, updateReview, compact = false) {
  const english = engine.data.copy['en-US']?.[slide.id]?.[field];
  const isList = field === 'bullets' || Array.isArray(english);
  const own = getCopy(locale.id, slide.id, field);
  const shown = shownOn(slide, field, locale.id);
  const common = { dir: locale.dir ?? 'ltr', lang: locale.lang };
  const wrap = h('div', { class: 'field', dataset: { field } });
  wrap.append(h('label', null, fieldLabel(field),
    h('span', { class: 'sub' }, shown.length ? `· ${shown.join(' · ')}` : '· not used by the current layouts'),
    checkControl(locale.id, slide.id, field, updateReview)));

  if (isList) {
    const items = Array.isArray(own) && own.length ? [...own] : Array.isArray(english) ? english.map(() => '') : ['', '', ''];
    const holder = h('div', { class: 'field' });
    const collect = () => [...holder.querySelectorAll('textarea')].map((t) => t.value.trim()).filter(Boolean);
    const addRow = (value, placeholder) => {
      const ta = h('textarea', { class: 'input', rows: 1, value, placeholder: placeholder ?? '', ...common });
      ta.addEventListener('input', () => { editCopy(locale.id, slide.id, field, collect()); updateReview(); ed.refresh(); });
      holder.append(ta);
    };
    items.forEach((value, i) => addRow(value, Array.isArray(english) ? english[i] : ''));
    wrap.append(holder, h('div', { class: 'row' },
      h('button', { class: 'btn small', onClick: () => { addRow('', ''); holder.lastChild.focus(); } }, '＋ Bullet'),
      h('button', { class: 'btn small', onClick: () => { if (holder.children.length > 1) { holder.lastChild.remove(); editCopy(locale.id, slide.id, field, collect()); updateReview(); ed.refresh(); } } }, '− Last'),
    ));
  } else {
    const ta = h('textarea', { class: 'input', rows: field === 'headline' ? 2 : 3, value: typeof own === 'string' ? own : '', placeholder: typeof english === 'string' ? english : '', ...common });
    ta.addEventListener('input', () => { editCopy(locale.id, slide.id, field, ta.value); updateReview(); ed.refresh(); });
    wrap.append(ta);
  }
  wrap.append(h('div', { class: 'hint', dataset: { fit: field } }));
  if (locale.id !== 'en-US' && english) {
    const line = Array.isArray(english) ? english.join(' · ') : english.replace(/\n/g, ' ⏎ ');
    wrap.append(h('div', { class: 'ref', title: 'Click to start from the English text', onClick: () => {
      if (isList) wrap.querySelectorAll('textarea').forEach((t, i) => { if (!t.value) { t.value = english[i] ?? ''; } });
      else { const ta = wrap.querySelector('textarea'); if (!ta.value) ta.value = english; }
      wrap.querySelector('textarea').dispatchEvent(new Event('input'));
    } }, `English: ${line}`));
  }
  if (!compact && FIELD_HELP[field]) wrap.append(h('div', { class: 'hint' }, FIELD_HELP[field]));
  return wrap;
}
