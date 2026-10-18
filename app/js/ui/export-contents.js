import { h } from './helpers.js';
import { icon } from './icons.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const languageName = locale => { try { return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(locale); } catch { return locale; } };

/** A compact visual inventory shared by Export and App Store Connect. */
export function exportContents(info, { title = 'Your screenshots', previews = true, renderPreview } = {}) {
  const metric = (symbol, value, label, total = false) => h('div', { class: `export-metric${total ? ' total' : ''}` }, icon(symbol), h('strong', null, value), h('span', null, label));
  const images = info.previews ?? [];
  const el = h('section', { class: 'export-contents', 'aria-label': title },
    h('div', { class: 'export-contents-heading' }, h('h4', null, title), info.previewLocale && previews ? h('span', { class: 'hint' }, `Main previews · ${languageName(info.previewLocale)}`) : null),
    h('div', { class: 'export-infographic', 'aria-label': 'Included images' },
      metric('rectangle.3.group', info.screenCount ?? info.previewTotal ?? images.length, 'screens'),
      metric('globe', info.locales?.length ?? 0, 'languages'),
      metric('iphone', info.sizeCount ?? info.canvases?.length ?? 0, 'sizes'),
      h('span', { class: 'export-flow-arrow', 'aria-hidden': 'true' }, '→'), metric('photo', info.count, 'images', true)),
    previews && images.length ? h('ol', { class: 'export-screen-strip', 'aria-label': 'Main screens' }, images.map((preview, index) => {
      const label = preview.label ?? preview.slide ?? 'Screen';
      const art = h('div', { class: 'export-screen-art' });
      const fallback = () => art.replaceChildren(icon('photo'), h('span', { class: 'hint' }, 'Preview unavailable'));
      if (renderPreview) art.append(renderPreview(preview));
      else if (preview.src ?? preview.thumbnail) art.append(h('img', { src: preview.src ?? preview.thumbnail, alt: label, loading: 'lazy', onError: fallback }));
      else fallback();
      return h('li', null, art, h('span', { title: label }, `${index + 1}. ${label}`));
    })) : null,
    h('div', { class: 'export-coverage' },
      h('div', { class: 'export-language-chips', 'aria-label': 'Included languages' }, (info.locales ?? []).map(locale => h('span', { title: locale }, languageName(locale)))),
      h('span', { class: 'hint' }, (info.canvases ?? []).join(' · '))),
    h('p', { class: 'hint export-contents-note' }, previews ? 'Each screen is shown once. Translations and matching sizes are included in the image total.' : `${plural(info.count, 'image')} across the selected languages and matching sizes.`));
  return el;
}

export function transferSteps(current = 0) {
  return h('ol', { class: 'transfer-steps', 'aria-label': 'Export and upload progress' }, ['Export', 'Destination', 'Review', 'Upload'].map((label, index) =>
    h('li', { class: index < current ? 'done' : index === current ? 'current' : '', 'aria-current': index === current ? 'step' : null }, h('span', { 'aria-hidden': 'true' }, index < current ? '✓' : index + 1), label)));
}
