import { checkControl } from './review-check.js';
import { openCopyReview } from './copy-review.js';
import { translateButton } from './translate-dialog.js';
// "Languages" view: one slide, every language. A translator's workbench - each row shows the live
// result next to editable text, so you can see overflow in German or Russian as you type.

import { engine, state, editCopy, getCopy, currentSlide, restoreLocale } from '../store.js';
import { h, drawInto, toast } from './helpers.js';
import { openAddLanguage, openLanguageSettings, removeLanguage } from './locale-dialogs.js';
import { slideFields, fieldLabel } from './text-panel.js';
import { copyNeedsReview } from '../copy-review.js';
import { previewWarnings } from '../preview-context.js';
import { orderedSlides } from '../project-ops.js';
import { canvasForSlide } from '../canvas-orientation.js';


export function createLanguages(ctx) {
  const el = h('div', { class: 'langs' });
  let screenStrip;
  const thumbnails = new Map();

  function revealSelectedScreen() {
    const selected = screenStrip?.querySelector('[aria-selected="true"]');
    if (!selected) return;
    const bounds = screenStrip.getBoundingClientRect(), card = selected.getBoundingClientRect();
    if (card.left < bounds.left) screenStrip.scrollLeft -= bounds.left - card.left;
    else if (card.right > bounds.right) screenStrip.scrollLeft += card.right - bounds.right;
  }

  function selectScreen(id) {
    if (id !== state.ui.slideId) {
      // The shell detaches this view while changing selection, which resets DOM scroll offsets.
      const scrollLeft = screenStrip.scrollLeft;
      ctx.go({ slideId: id });
      screenStrip.scrollLeft = scrollLeft;
      el.scrollTop = 0;
    }
    revealSelectedScreen();
    screenStrip.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
  }

  function buildScreenSelector(scrollLeft) {
    const slides = orderedSlides(engine.project, state.ui.locale);
    thumbnails.clear();
    screenStrip = h('div', { class: 'translate-screen-strip', role: 'tablist', 'aria-label': 'Screenshot to translate', 'aria-orientation': 'horizontal' });
    slides.forEach((slide, index) => {
      const [width, height] = canvasForSlide(engine.project, slide, state.ui.device).size;
      const previewWidth = Math.min(128, 104 * width / height);
      const canvas = h('canvas', { 'aria-hidden': 'true' });
      thumbnails.set(slide.id, { canvas, width: previewWidth });
      const selected = slide.id === state.ui.slideId;
      const name = slide.name ?? slide.id;
      screenStrip.append(h('button', {
        class: 'translate-screen', role: 'tab', id: `translate-screen-${index}`, tabindex: selected ? 0 : -1,
        'aria-selected': String(selected), 'aria-controls': 'translate-screen-content', 'aria-label': `${index + 1}. ${name}`, title: name,
        onClick: () => selectScreen(slide.id),
        onKeydown: e => {
          let next;
          if (e.key === 'ArrowLeft') next = Math.max(0, index - 1);
          else if (e.key === 'ArrowRight') next = Math.min(slides.length - 1, index + 1);
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = slides.length - 1;
          else return;
          e.preventDefault(); e.stopPropagation(); selectScreen(slides[next].id);
        },
      }, h('span', { class: 'translate-screen-preview' }, canvas), h('span', { class: 'translate-screen-label' }, h('span', { class: 'translate-screen-number' }, index + 1), h('span', null, name))));
      drawInto(canvas, { slideId: slide.id, deviceId: state.ui.device, localeId: state.ui.locale, width: previewWidth });
    });
    el.append(h('section', { class: 'translate-screens', 'aria-label': 'Screenshots' },
      h('div', { class: 'translate-screens-heading' }, h('h2', null, 'Screenshots'), h('span', { class: 'hint' }, 'Select a screen to translate below.')), screenStrip));
    screenStrip.scrollLeft = scrollLeft;
    return `translate-screen-${slides.findIndex(s => s.id === state.ui.slideId)}`;
  }

  /** Every text field of the slide - including text layers added in the editor that have no text yet. */
  function fieldsFor(slide) {
    const keys = new Set(engine.project.locales.flatMap(locale => slideFields(slide, locale.id)));
    for (const doc of Object.values(engine.data.copy)) for (const k of Object.keys(doc[slide.id] ?? {})) keys.add(k);
    const order = ['headline', 'caption', 'bullets'];
    return [...keys].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  }

  function build() {
    const slide = currentSlide();
    const dev = engine.project.devices[state.ui.device];
    const fields = fieldsFor(slide);
    const scrollLeft = screenStrip?.scrollLeft ?? 0;
    el.replaceChildren();
    const selectedTab = buildScreenSelector(scrollLeft);
    const selectedScreen = h('section', { id: 'translate-screen-content', role: 'tabpanel', 'aria-labelledby': selectedTab, tabindex: 0 },
      h('div', { class: 'langs-head' },
        h('h2', null, `${slide.name ?? slide.id}`),
        h('span', { class: 'hint' }, `${engine.project.locales.length} languages · previews show ${dev.label}. Type in any row, it saves automatically.`),
        h('span', { class: 'spacer' }),
        translateButton(ctx, { slideId: slide.id }),
        h('button', { class: 'btn', title: 'Export or import text for external language review', onClick: () => openCopyReview(ctx) }, 'Import / Export…'),
        h('button', { class: 'btn primary', onClick: () => openAddLanguage(ctx) }, '＋ Add language')),
    );
    const list = h('div', { class: 'lang-list' });
    for (const locale of engine.project.locales) {
      const reviewChip = h('span');
      const updateReview = () => {
        const pending = copyNeedsReview(engine.data.copy[locale.id], slide.id);
        reviewChip.title = 'Review status for the text on this slide';
        reviewChip.className = `chip ${pending ? 'warn' : 'ok'}`;
        reviewChip.textContent = pending ? 'Needs review' : '✓ Reviewed';
      };
      updateReview();
      const canvas = h('canvas');
      const chips = h('div', { class: 'row', style: { flexWrap: 'wrap' } });
      const row = h('div', { class: 'lang-row', 'aria-current': String(locale.id === state.ui.locale), dataset: { locale: locale.id } },
        h('div', null, canvas),
        h('div', { class: 'lang-meta' },
          h('div', { class: 'name' }, locale.name),
          h('div', { class: 'native', lang: locale.lang, dir: locale.dir }, locale.native),
          h('div', { class: 'row', style: { flexWrap: 'wrap' } }, reviewChip, chips),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn small', onClick: () => ctx.go({ locale: locale.id, view: 'editor' }) }, 'Open in editor'),
            translateButton(ctx, { target: locale.id, slideId: slide.id }, true),
            h('button', { class: 'btn small', onClick: () => openLanguageSettings(ctx, locale.id) }, 'Settings…'),
            locale.id === 'en-US' ? null : h('button', { class: 'btn small danger', title: 'Take this language out of the project (restorable)', onClick: () => removeLanguage(ctx, locale.id) }, 'Remove…'))),
        h('div', { class: 'lang-fields' }, fields.map((field) => fieldInput(slide, locale, field, canvas, updateReview))),
      );
      canvas.addEventListener('click', () => ctx.go({ locale: locale.id, view: 'editor' }));
      canvas.addEventListener('rendered', (e) => {
        chips.replaceChildren(...previewWarnings(e.detail.report.warnings).slice(0, 2).map((w) => h('span', { class: `chip ${w.level === 'error' ? 'err' : 'warn'}`, title: w.message }, w.label)));
      });
      list.append(row);
      drawInto(canvas, { slideId: slide.id, deviceId: state.ui.device, localeId: locale.id, width: 104 });
    }
    selectedScreen.append(list);
    el.append(selectedScreen);

    const removed = state.removedLocales ?? [];
    if (removed.length) {
      el.append(h('div', { class: 'removed-langs' },
        h('h4', null, `Removed languages (${removed.length})`),
        h('div', { class: 'hint' }, 'Their text and screenshots are kept in project/_removed/. Restore one to bring it back exactly as it was.'),
        removed.map((r) => h('div', { class: 'row removed-row' },
          h('b', null, r.entry?.name ?? r.id), h('span', { class: 'hint mono' }, r.id), h('span', { class: 'hint' }, new Date(r.mtime).toLocaleString()),
          h('button', { class: 'btn small', onClick: async () => {
            try { await restoreLocale(r.folder); ctx.go({}); toast(`${r.entry?.name ?? r.id} is back`); } catch (err) { toast(err.message, { error: true }); }
          } }, 'Restore')))));
    }
  }

  function fieldInput(slide, locale, field, canvas, updateReview) {
    const english = engine.data.copy['en-US']?.[slide.id]?.[field];
    const isList = field === 'bullets' || Array.isArray(english);
    const own = getCopy(locale.id, slide.id, field);
    const value = isList ? (Array.isArray(own) ? own.join('\n') : '') : (typeof own === 'string' ? own : '');
    const placeholder = isList ? (Array.isArray(english) ? english.join('\n') : '') : (typeof english === 'string' ? english : '');
    const ta = h('textarea', { class: 'input', rows: isList ? 3 : 2, value, placeholder, dir: locale.dir ?? 'ltr', lang: locale.lang });
    const check = checkControl(locale.id, slide.id, field, updateReview);
    let timer;
    ta.addEventListener('input', () => {
      editCopy(locale.id, slide.id, field, isList ? ta.value.split('\n').map((s) => s.trim()).filter(Boolean) : ta.value);
      updateReview(); check.refreshCheck();
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!canvas.isConnected) return;
        drawInto(canvas, { slideId: slide.id, deviceId: state.ui.device, localeId: locale.id, width: 104, priority: true });
        const thumb = thumbnails.get(slide.id);
        if (locale.id === state.ui.locale && thumb) drawInto(thumb.canvas, { slideId: slide.id, deviceId: state.ui.device, localeId: locale.id, width: thumb.width, priority: true });
      }, 120);
    });
    return h('div', { class: 'f' }, h('label', null, field === 'bullets' ? 'Bullets' : fieldLabel(field), check), ta);
  }

  return {
    el,
    build,
    activate: revealSelectedScreen,
    refresh: build,
    onResize: revealSelectedScreen,
  };
}
