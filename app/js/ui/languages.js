import { meaningReviewNote } from './meaning-review.js';
import { checkControl } from './review-check.js';
import { openCopyReview } from './copy-review.js';
import { translateButton } from './translate-dialog.js';
// Translation workbench: group editable previews by screen or by language.

import { engine, state, on, editCopy, getCopy, currentSlide, restoreLocale, needsReview, markReviewed, markSlideReviewed, setOriginalLocale } from '../store.js';
import { h, drawInto, toast, selectInput } from './helpers.js';
import { openAddLanguage, openLanguageSettings, removeLanguage } from './locale-dialogs.js';
import { slideFields, fieldLabel } from './text-panel.js';
import { isOriginalLocale, originalLocale } from '../copy-review.js';
import { previewWarnings } from '../preview-context.js';
import { screenCanvasId } from '../slide-order.js';
import { orderedSlides } from '../project-ops.js';
import { canvasForSlide } from '../canvas-orientation.js';


export function createLanguages(ctx) {
  const el = h('div', { class: 'langs' });
  let screenStrip;
  let showOriginal = false;
  let buildKey;
  const thumbnails = new Map();

  on('copy-changed', ({ locale, slideId }) => {
    if (!el.isConnected) return;
    if (locale === originalLocale(engine.project)) for (const source of el.querySelectorAll('.translation-source')) {
      if (!slideId || source.closest('.lang-row').dataset.slide === slideId) source.refreshSource();
    }
    for (const row of el.querySelectorAll('.lang-row')) {
      if (row.dataset.locale === locale && (!slideId || row.dataset.slide === slideId)) row.refreshReview();
    }
  });

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
      const deviceId = screenCanvasId(engine.project, slide, state.ui.device, state.ui.screenshotDevice);
      const [width, height] = canvasForSlide(engine.project, slide, deviceId).size;
      const previewWidth = Math.min(128, 104 * width / height);
      const canvas = h('canvas', { 'aria-hidden': 'true' });
      thumbnails.set(slide.id, { canvas, width: previewWidth, deviceId });
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
      drawInto(canvas, { slideId: slide.id, deviceId, localeId: state.ui.locale, width: previewWidth });
    });
    el.append(h('section', { class: 'translate-screens', 'aria-label': 'Screenshots' },
      h('div', { class: 'translate-screens-heading' }, h('h2', null, 'Screenshots'), h('span', { class: 'hint' }, 'Select a screen to translate below.')), screenStrip));
    screenStrip.scrollLeft = scrollLeft;
    return `translate-screen-${slides.findIndex(s => s.id === state.ui.slideId)}`;
  }

  function buildLanguageSelector(scrollLeft) {
    thumbnails.clear();
    const locales = engine.project.locales;
    screenStrip = h('div', { class: 'translate-screen-strip', role: 'tablist', 'aria-label': 'Language to translate', 'aria-orientation': 'horizontal' });
    const selectLanguage = id => {
      const left = screenStrip.scrollLeft;
      ctx.go({ locale: id });
      screenStrip.scrollLeft = left;
      el.scrollTop = 0;
      revealSelectedScreen();
      screenStrip.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
    };
    locales.forEach((locale, index) => {
      const selected = locale.id === state.ui.locale;
      screenStrip.append(h('button', {
        class: 'translate-screen translate-language', role: 'tab', id: `translate-language-${index}`, tabindex: selected ? 0 : -1,
        'aria-selected': String(selected), 'aria-controls': 'translate-screen-content',
        onClick: () => selectLanguage(locale.id),
        onKeydown: e => {
          let next;
          if (e.key === 'ArrowLeft') next = Math.max(0, index - 1);
          else if (e.key === 'ArrowRight') next = Math.min(locales.length - 1, index + 1);
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = locales.length - 1;
          else return;
          e.preventDefault(); e.stopPropagation(); selectLanguage(locales[next].id);
        },
      }, h('strong', null, locale.name), h('span', { class: 'native', lang: locale.lang, dir: locale.dir }, locale.native)));
    });
    el.append(h('section', { class: 'translate-screens', 'aria-label': 'Languages' },
      h('div', { class: 'translate-screens-heading' }, h('h2', null, 'Languages'), h('span', { class: 'hint' }, 'Select a language to translate its screens below.')), screenStrip));
    screenStrip.scrollLeft = scrollLeft;
    return `translate-language-${locales.findIndex(l => l.id === state.ui.locale)}`;
  }

  /** Every text field of the slide - including text layers added in the editor that have no text yet. */
  function fieldsFor(slide) {
    const keys = new Set(engine.project.locales.flatMap(locale => slideFields(slide, locale.id)));
    const order = ['headline', 'caption', 'bullets'];
    return [...keys].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  }

  function build() {
    const slide = currentSlide();
    const byLanguage = state.ui.translateMode === 'language';
    const locale = engine.project.locales.find(l => l.id === state.ui.locale);
    const slides = orderedSlides(engine.project, state.ui.locale);
    const scrollLeft = screenStrip?.scrollLeft ?? 0;
    const scrollTop = el.scrollTop;
    const nextKey = `${byLanguage}:${state.ui.locale}:${state.ui.slideId}`;
    const disclosureKey = node => {
      const row = node.closest('.lang-row');
      const kind = node.dataset.meaningReview != null ? `meaning:${node.dataset.meaningReview}`
        : node.dataset.sourceField != null ? `source:${node.dataset.sourceField}` : node.querySelector('summary')?.textContent;
      return [row?.dataset.locale, row?.dataset.slide, kind].join(':');
    };
    const openStates = new Map(buildKey === nextKey ? [...el.querySelectorAll('details')].map(node => [disclosureKey(node), node.open]) : []);
    buildKey = nextKey;
    el.replaceChildren();
    el.append(h('div', { class: 'translate-view-options' },
      h('div', { class: 'row', role: 'group', 'aria-label': 'Group translations' },
        [['screen', 'Per screen'], ['language', 'Per language']].map(([mode, label]) => h('button', {
          class: `btn small${(byLanguage ? 'language' : 'screen') === mode ? ' primary' : ''}`,
          'aria-pressed': String((byLanguage ? 'language' : 'screen') === mode),
          onClick: () => { state.ui.translateMode = mode; screenStrip = null; ctx.go({}); el.scrollTop = 0; },
        }, label))),
      h('label', { class: 'row translation-compare' }, h('input', { type: 'checkbox', checked: showOriginal, onChange: e => {
        showOriginal = e.target.checked;
        for (const source of el.querySelectorAll('.translation-source')) source.open = showOriginal;
      } }), 'Show original text')));
    const selectedTab = byLanguage ? buildLanguageSelector(scrollLeft) : buildScreenSelector(scrollLeft);
    const sourceLanguage = selectInput({ value: originalLocale(engine.project), options: engine.project.locales.map(l => [l.id, l.name]), onChange: id => { setOriginalLocale(id); ctx.go({}); } });
    sourceLanguage.id = 'translation-source-language';
    const selectedScreen = h('section', { id: 'translate-screen-content', role: 'tabpanel', 'aria-labelledby': selectedTab, tabindex: 0 },
      h('div', { class: 'langs-head' },
        h('div', { class: 'translation-heading' }, h('h2', null, byLanguage ? locale.name : (slide.name ?? slide.id)),
          h('span', { class: 'hint' }, 'Edits save automatically')),
        h('div', { class: 'translation-primary-actions' },
          translateButton(ctx, { target: byLanguage ? locale.id : 'all' }),
          h('button', { class: 'btn', onClick: () => openAddLanguage(ctx) }, '＋ Add language'))),
      h('details', { class: 'disclosure translation-options' }, h('summary', null, 'More options'),
        h('div', { class: 'translation-option-groups' },
          h('section', { class: 'translation-option-group', 'aria-label': 'Translation options' }, h('h3', null, h('label', { for: sourceLanguage.id }, 'Original language')),
            sourceLanguage,
            byLanguage ? translateButton(ctx, { target: 'all' }, true) : null),
          h('section', { class: 'translation-option-group', 'aria-label': 'Review options' }, h('h3', null, 'Review'),
            h('button', { class: 'btn small', title: 'Export or import text for external language review', onClick: () => openCopyReview(ctx) }, 'Import / Export…'),
            !byLanguage || isOriginalLocale(engine.project, locale.id) ? null : h('button', { class: 'btn small', onClick: () => markReviewed(locale.id) }, 'Mark design reviewed')),
          byLanguage ? h('section', { class: 'translation-option-group', 'aria-label': 'Language options' }, h('h3', null, locale.name),
            h('button', { class: 'btn small', onClick: () => openLanguageSettings(ctx, locale.id) }, 'Settings…'),
            locale.id === 'en-US' ? null : h('button', { class: 'btn small danger', onClick: () => removeLanguage(ctx, locale.id) }, 'Remove…')) : null)),
    );
    const list = h('div', { class: 'lang-list' });
    const pairs = byLanguage ? slides.map(slide => ({ slide, locale })) : engine.project.locales.map(locale => ({ slide, locale }));
    for (const { slide, locale } of pairs) {
      const deviceId = screenCanvasId(engine.project, slide, state.ui.device, state.ui.screenshotDevice);
      const fields = fieldsFor(slide);
      const reviewChip = h('span');
      const updateReview = () => {
        for (const check of row.querySelectorAll('[data-check]')) check.refreshCheck();
        for (const note of row.querySelectorAll('[data-meaning-review]')) note.refreshMeaningReview();
        const pending = needsReview(locale.id, slide.id);
        reviewChip.title = 'Review status for the text on this slide';
        reviewChip.className = `chip ${pending ? 'warn' : 'ok'}`;
        reviewChip.textContent = !fields.length ? 'No text' : isOriginalLocale(engine.project, locale.id) ? 'Original' : pending ? 'Needs review' : '✓ Reviewed';
        const reviewAction = row.querySelector('[data-review-screen]');
        if (reviewAction) reviewAction.hidden = !fields.length;
      };
      const canvas = h('canvas');
      const chips = h('div', { class: 'row', style: { flexWrap: 'wrap' } });
      const row = h('div', { class: 'lang-row', 'aria-current': String(byLanguage ? slide.id === state.ui.slideId : locale.id === state.ui.locale), dataset: { locale: locale.id, slide: slide.id, device: deviceId } },
        h('div', null, canvas),
        h('div', { class: 'lang-meta' },
          h('div', { class: 'name' }, byLanguage ? (slide.name ?? slide.id) : locale.name),
          byLanguage ? null : h('div', { class: 'native', lang: locale.lang, dir: locale.dir }, locale.native),
          h('div', { class: 'row', style: { flexWrap: 'wrap' } }, reviewChip, chips),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn small', onClick: () => ctx.go({ locale: locale.id, slideId: slide.id, device: deviceId, view: 'editor' }) }, 'Open in editor'),
            h('details', { class: 'disclosure row-options', hidden: byLanguage && !fields.length }, h('summary', null, 'More'), h('div', { class: 'disclosure-body' },
            isOriginalLocale(engine.project, locale.id) ? null : h('button', { class: 'btn small', dataset: { reviewScreen: '' }, title: 'Mark all text on this screen in this language reviewed', onClick: () => markSlideReviewed(locale.id, slide.id) }, 'Mark screen reviewed'),
            fields.length ? translateButton(ctx, { target: locale.id, slideId: slide.id }, true) : null,
            byLanguage || isOriginalLocale(engine.project, locale.id) ? null : h('button', { class: 'btn small', title: 'Mark every screen in this language reviewed', onClick: () => markReviewed(locale.id) }, 'Mark design reviewed'),
            byLanguage ? null : h('button', { class: 'btn small', onClick: () => openLanguageSettings(ctx, locale.id) }, 'Settings…'),
            byLanguage || locale.id === 'en-US' ? null : h('button', { class: 'btn small danger', title: 'Take this language out of the project (restorable)', onClick: () => removeLanguage(ctx, locale.id) }, 'Remove…'))))),
        h('div', { class: 'lang-fields' }, fields.map((field) => fieldInput(slide, locale, field, canvas))),
      );
      row.refreshReview = updateReview;
      updateReview();
      canvas.addEventListener('click', () => ctx.go({ locale: locale.id, slideId: slide.id, device: deviceId, view: 'editor' }));
      canvas.addEventListener('rendered', (e) => {
        chips.replaceChildren(...previewWarnings(e.detail.report.warnings).slice(0, 2).map((w) => h('span', { class: `chip ${w.level === 'error' ? 'err' : 'warn'}`, title: w.message }, w.label)));
      });
      list.append(row);
      drawInto(canvas, { slideId: slide.id, deviceId, localeId: locale.id, width: 104 });
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
    for (const node of el.querySelectorAll('details')) if (openStates.has(disclosureKey(node))) node.open = openStates.get(disclosureKey(node));
    el.scrollTop = scrollTop;
  }

  function fieldInput(slide, locale, field, canvas) {
    const deviceId = screenCanvasId(engine.project, slide, state.ui.device, state.ui.screenshotDevice);
    const english = engine.data.copy[originalLocale(engine.project)]?.[slide.id]?.[field];
    const isList = field === 'bullets' || Array.isArray(english);
    const own = getCopy(locale.id, slide.id, field);
    const value = isList ? (Array.isArray(own) ? own.join('\n') : '') : (typeof own === 'string' ? own : '');
    const placeholder = isList ? (Array.isArray(english) ? english.join('\n') : '') : (typeof english === 'string' ? english : '');
    const inputId = `translation-${locale.id}-${slide.id}-${field}`;
    const ta = h('textarea', { id: inputId, class: 'input', rows: isList ? 3 : 2, value, placeholder: 'Enter your text…', dir: locale.dir ?? 'ltr', lang: locale.lang });
    const check = checkControl(locale.id, slide.id, field);
    let timer;
    ta.addEventListener('input', () => {
      editCopy(locale.id, slide.id, field, isList ? ta.value.split('\n').map((s) => s.trim()).filter(Boolean) : ta.value);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!canvas.isConnected) return;
        drawInto(canvas, { slideId: slide.id, deviceId, localeId: locale.id, width: 104, priority: true });
        const thumb = thumbnails.get(slide.id);
        if (locale.id === state.ui.locale && thumb) drawInto(thumb.canvas, { slideId: slide.id, deviceId: thumb.deviceId, localeId: locale.id, width: thumb.width, priority: true });
      }, 120);
    });
    const original = engine.project.locales.find(l => l.id === originalLocale(engine.project));
    const source = isOriginalLocale(engine.project, locale.id) ? null : h('details', { class: 'translation-source disclosure', open: showOriginal, dataset: { sourceField: field } },
      h('summary', null, `Original · ${original?.name ?? originalLocale(engine.project)}`),
      h('div', { class: 'translation-source-text', lang: original?.lang, dir: original?.dir ?? 'ltr' }, placeholder || '(No original text)'));
    if (source) source.refreshSource = () => {
      const value = engine.data.copy[originalLocale(engine.project)]?.[slide.id]?.[field];
      const text = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
      source.querySelector('.translation-source-text').textContent = text || '(No original text)';
    };
    return h('div', { class: 'f translation-field' },
      h('div', { class: 'translation-field-heading' }, h('label', { for: inputId }, field === 'bullets' ? 'Bullets' : fieldLabel(field)), check),
      ta, h('div', { class: 'translation-references' }, source, meaningReviewNote(locale.id, slide.id, field)));
  }

  return {
    el,
    build,
    activate: revealSelectedScreen,
    refresh: build,
    onResize: revealSelectedScreen,
  };
}
