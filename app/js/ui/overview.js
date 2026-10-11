import { canvasForSlide } from '../canvas-orientation.js';
import { orientationPicker } from './canvas-orientation.js';
import { orderedSlides } from '../project-ops.js';
import { moveScreen, renameScreen } from './slide-actions.js';
import { openImportDesigns } from './import-designs.js';
// "Overview" view: the whole set the way the App Store shows it, for one language - or every
// language at once (a grid of all slides x all languages for a quick visual check).

import { engine, state, rememberUI } from '../store.js';
import { h, drawInto } from './helpers.js';
import { wheelPixels, pinchZoom, pointInRect } from './viewport-gestures.js';
import { visibleWarnings, warningList } from './warnings.js';

export function createOverview(ctx) {
  const el = h('div', { class: 'overview' });
  let mode = state.ui.overviewMode === 'all' ? 'all' : 'language';
  let zoom = state.ui.overviewZoom === 'fit' ? 'fit' : Math.min(200, Math.max(10, Number(state.ui.overviewZoom) || 100));
  let cards = [], viewport, rows, zoomInput, zoomSlider, fitButton, leftButton, rightButton;
  let sizingKey = '';
  let pinching = false, zoomTimer;
  const baseHeight = 420;
  const remember = () => { state.ui.overviewZoom = zoom; state.ui.overviewMode = mode; rememberUI(); };

  function scrollButtons() {
    if (!viewport) return;
    leftButton.disabled = viewport.scrollLeft < 1;
    rightButton.disabled = viewport.scrollLeft >= viewport.scrollWidth - viewport.clientWidth - 1;
  }

  function resize() {
    if (!viewport?.clientWidth || !cards.length) return;
    const key = `${viewport.clientWidth}:${zoom}`;
    if (key === sizingKey) return;
    sizingKey = key;
    const slides = engine.project.slides;
    const sizes = slides.map(slide => canvasForSlide(engine.project, slide, state.ui.device).size);
    const gap = zoom === 'fit' ? Math.min(14, viewport.clientWidth / Math.max(1, sizes.length * 5)) : 14;
    const available = Math.max(1, viewport.clientWidth - 2 - Math.max(0, sizes.length - 1) * gap);
    const height = zoom === 'fit' ? available / sizes.reduce((sum, [w, h]) => sum + w / h, 0) : baseHeight * zoom / 100;
    rows.style.setProperty('--overview-gap', `${gap}px`);
    rows.style.setProperty('--overview-visible-width', `${viewport.clientWidth}px`);
    for (const { canvas, item, job, size } of cards) {
      const width = height * size[0] / size[1];
      item.style.width = `${width}px`;
      lazy(canvas, { ...job, width });
    }
    zoomInput.value = zoom === 'fit' ? String(Math.round(height / baseHeight * 100)) : String(Math.round(zoom * 10) / 10);
    zoomSlider.value = zoom === 'fit' ? String(Math.max(10, Math.min(200, height / baseHeight * 100))) : String(zoom);
    fitButton.setAttribute('aria-pressed', String(zoom === 'fit'));
    if (zoom === 'fit') viewport.scrollLeft = 0;
    scrollButtons();
  }

  function setZoom(value) {
    clearTimeout(zoomTimer); pinching = false; sizingKey = '';
    zoom = value === 'fit' ? value : Math.min(200, Math.max(10, Number(value) || 100));
    remember(); resize();
  }

  function pinch(event) {
    if (!event.ctrlKey || !cards.length) return; // ordinary two-finger scrolling stays native
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    // Anchor to the nearest preview, including when the pointer is in a gutter.
    const nearest = cards.reduce((best, card) => {
      const rect = card.canvas.getBoundingClientRect();
      const distance = Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right), Math.max(rect.top - point.y, 0, point.y - rect.bottom));
      return !best || distance < best.distance ? { canvas: card.canvas, rect, distance } : best;
    }, null);
    const anchor = pointInRect(point, nearest.rect);
    const current = nearest.rect.height / baseHeight * 100;
    zoom = pinchZoom(current, wheelPixels(event, viewport.clientHeight).y, Math.min(10, current), 200);
    clearTimeout(zoomTimer); pinching = true;
    resize();
    const rect = nearest.canvas.getBoundingClientRect();
    viewport.scrollLeft += rect.left + anchor.x * rect.width - point.x;
    viewport.scrollTop += rect.top + anchor.y * rect.height - point.y;
    scrollButtons();
    zoomTimer = setTimeout(() => {
      pinching = false; remember(); sizingKey = '';
      if (el.isConnected) resize();
    }, 140);
  }
  const sizeObserver = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || pinching) continue;
          observer.unobserve(entry.target);
          const job = entry.target._job;
          if (job) drawInto(entry.target, job);
        }
      }, { root: null, rootMargin: '300px' })
    : null;

  function lazy(canvas, job) {
    const [W, H] = canvasForSlide(engine.project, engine.project.slides.find(s => s.id === job.slideId), job.deviceId).size;
    canvas.style.width = `${job.width}px`;
    canvas.style.height = `${(job.width * H) / W}px`;
    canvas._token = (canvas._token ?? 0) + 1;
    canvas._job = job;
    if (pinching) observer?.unobserve(canvas);
    else if (observer) observer.observe(canvas); else drawInto(canvas, job);
  }

  function open(localeId, slideId) {
    ctx.go({ locale: localeId, slideId, view: 'editor' });
  }

  function draggable(item, slide, localeId) {
    item.draggable = true;
    item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-slide', slide.id); e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/x-slide')) return;
      e.preventDefault();
      const after = e.clientX > item.getBoundingClientRect().left + item.offsetWidth / 2;
      item.classList.toggle('drop-before', !after); item.classList.toggle('drop-after', after);
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
    item.addEventListener('drop', e => {
      e.preventDefault(); item.classList.remove('drop-before', 'drop-after');
      const from = e.dataTransfer.getData('text/x-slide');
      if (from) moveScreen(from, slide.id, e.clientX > item.getBoundingClientRect().left + item.offsetWidth / 2, build, localeId);
    });
  }

  function build() {
    clearTimeout(zoomTimer); pinching = false;
    const scroll = { left: viewport?.scrollLeft ?? 0, top: viewport?.scrollTop ?? 0 };
    observer?.disconnect(); sizeObserver?.disconnect(); cards = []; sizingKey = '';
    const dev = engine.project.devices[state.ui.device];
    const toggle = h('div', { class: 'seg' },
      h('button', { 'aria-pressed': String(mode === 'language'), onClick: () => { mode = 'language'; remember(); build(); } }, 'This language'),
      h('button', { 'aria-pressed': String(mode === 'all'), onClick: () => { mode = 'all'; remember(); build(); } }, 'All languages'));
    fitButton = h('button', { class: 'btn small', 'aria-pressed': String(zoom === 'fit'), onClick: () => setZoom('fit') }, 'Fit to width');
    zoomSlider = h('input', { type: 'range', min: 10, max: 200, step: 1, value: typeof zoom === 'number' ? zoom : 100,
      'aria-label': 'Overview zoom slider', onInput: e => setZoom(e.target.value) });
    zoomInput = h('input', { class: 'input num', type: 'number', min: 10, max: 200, step: 1,
      'aria-label': 'Overview zoom percent', onChange: e => setZoom(e.target.value),
      onKeydown: e => { if (e.key === 'Enter') { e.preventDefault(); setZoom(e.target.value); } } });
    const zoomControls = h('div', { class: 'overview-zoom', role: 'group', 'aria-label': 'Overview zoom' },
      h('span', { class: 'hint' }, 'Zoom'), zoomSlider, zoomInput, h('span', null, '%'), fitButton);
    leftButton = h('button', { class: 'btn small', 'aria-label': 'Scroll screenshots left', onClick: () => viewport.scrollBy({ left: -viewport.clientWidth * .8, behavior: 'instant' }) }, '←');
    rightButton = h('button', { class: 'btn small', 'aria-label': 'Scroll screenshots right', onClick: () => viewport.scrollBy({ left: viewport.clientWidth * .8, behavior: 'instant' }) }, '→');
    rows = h('div', { class: 'overview-rows' });
    viewport = h('div', { class: 'overview-viewport', tabIndex: 0, role: 'region', 'aria-label': 'Screenshot rows', onScroll: scrollButtons, onKeydown: e => { if (e.target === viewport) e.stopPropagation(); } }, rows);
    viewport.addEventListener('wheel', pinch, { passive: false });
    el.replaceChildren(h('div', { class: 'overview-head' },
      h('h2', null, mode === 'language' ? `${engine.localeInfo(state.ui.locale).native} · ${dev.label}` : `All languages · ${dev.label}`),
      toggle, h('button', { class: 'btn', onClick: () => openImportDesigns(ctx) }, 'Import designs…'), zoomControls, h('div', { class: 'row' }, leftButton, rightButton)),
      h('p', { class: 'hint overview-help' }, 'Drag screens to reorder. Click a preview to edit or its name to rename. Pinch to zoom; scroll with two fingers to explore.'), viewport);

    const locales = mode === 'all' ? engine.project.locales : [engine.localeInfo(state.ui.locale)];
    for (const locale of locales) {
      const strip = h('div', { class: 'strip' });
      const warnings = h('div', { class: 'overview-warnings', hidden: true, 'aria-label': `Warnings · ${locale.native ?? locale.name}` }, h('h4', null, 'Warnings'));
      const section = h('section', { class: 'overview-language', 'aria-label': locale.native ?? locale.name, dataset: { locale: locale.id } },
        mode === 'all' ? h('h3', { class: 'overview-locale' }, locale.native ?? locale.name, h('span', null, locale.id)) : null, strip, warnings);
      rows.append(section);
      orderedSlides(engine.project, locale.id).forEach((slide, i) => {
        const size = canvasForSlide(engine.project, slide, state.ui.device).size;
        const canvas = h('canvas');
        const cap = h('div', { class: 'cap' }, h('button', { class: 'screen-name', title: 'Rename screen', onClick: e => { e.stopPropagation(); renameScreen(slide.id, build); } }, `${i + 1} · ${slide.name ?? slide.id}`));
        const item = h('div', { class: 'strip-item', onClick: () => open(locale.id, slide.id) }, canvas, cap, orientationPicker(slide, state.ui.device, build));
        const warningGroup = h('section', { class: 'overview-screen-warnings', hidden: true, dataset: { slideId: slide.id } });
        warnings.append(warningGroup);
        canvas.addEventListener('rendered', e => {
          cap.querySelector('.warning-mark')?.remove();
          const bad = visibleWarnings(e.detail.report);
          if (bad.length) cap.append(h('span', { class: `warning-mark ${bad.some(w => w.level === 'error') ? 'err' : 'warn'}`, role: 'img', 'aria-label': `${bad.length} warning${bad.length === 1 ? '' : 's'}`, title: bad.map(w => w.message).join('\n') }, '⚠'));
          warningGroup.replaceChildren(...(bad.length ? [
            h('button', { class: 'screen-name', title: 'Edit this screen', onClick: () => open(locale.id, slide.id) }, `${i + 1} · ${slide.name ?? slide.id}`), warningList(bad),
          ] : []));
          warningGroup.hidden = !bad.length;
          warnings.hidden = !warnings.querySelector('.warning-list');
        });
        draggable(item, slide, locale.id); strip.append(item);
        cards.push({ canvas, item, size, job: { slideId: slide.id, deviceId: state.ui.device, localeId: locale.id } });
      });
    }
    resize();
    viewport.scrollLeft = scroll.left; viewport.scrollTop = scroll.top;
    scrollButtons(); sizeObserver?.observe(viewport);
  }

  return { el, build, activate: resize, refresh: build, onResize: resize };
}
