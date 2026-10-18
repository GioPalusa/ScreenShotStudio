import { EXPORT_TARGETS, CREATIVE_SPEC_URL } from '../export-targets.js';
import { PLAY_SPEC_URL } from '../google-play.js';
import { STORE_IMAGE_SETS, existingStoreImage } from '../store-images.js';
import { h, segmented, selectInput } from './helpers.js';

export function storeImagesPicker(project, onChange) {
  let store = 'app-store';
  const sizes = Object.fromEntries(Object.values(STORE_IMAGE_SETS).flatMap(set => set.targets).map(target => [target, [...(existingStoreImage(project, target)?.[1].size ?? EXPORT_TARGETS[target].formats[0].size)]]));
  const cards = h('div', { class: 'store-image-cards' });
  const note = h('p', { class: 'hint' });
  const source = h('a', { target: '_blank', rel: 'noreferrer' }, 'Store image requirements ↗');
  const el = h('section', { class: 'store-images-picker', 'aria-label': 'Store images', hidden: true },
    h('h3', null, 'Store images'),
    h('p', { class: 'hint' }, 'Add store artwork beside your screenshots in the same project. Each image uses its own canvas size and stays visible in the screen list, translation review and export. Existing images are kept.'),
    segmented({ label: 'Store for images', value: store, options: [['app-store', 'App Store'], ['google-play', 'Google Play']], onChange: value => { store = value; render(); onChange(); } }), cards, note, source);
  function render() {
    cards.replaceChildren(...STORE_IMAGE_SETS[store].targets.map(target => {
      const spec = EXPORT_TARGETS[target], existing = existingStoreImage(project, target);
      const size = sizes[target];
      const select = selectInput({ title: `${spec.label} size`, value: size.join('x'), options: spec.formats.map(f => [f.size.join('x'), `${f.size.join(' × ')} px`]), onChange: value => { sizes[target] = value.split('x').map(Number); render(); } });
      select.setAttribute('aria-label', `${spec.label} size`);
      select.disabled = Boolean(existing);
      return h('div', { class: 'store-image-card' },
        h('div', { class: 'store-image-outline', style: { aspectRatio: `${size[0]} / ${size[1]}`, maxWidth: `${220 * size[0] / size[1]}px` }, 'aria-hidden': 'true' }, target === 'app-store-search' ? 'Search' : target === 'app-store-header' ? 'Header' : 'Feature'),
        h('b', null, spec.label), h('label', null, 'Canvas size', select),
        h('span', { class: 'hint' }, existing ? 'Already in this project · artwork is kept' : 'New editable canvas'));
    }));
    note.textContent = store === 'app-store' ? 'Two independent images: Search result image and Header image. Add text, shapes or imported artwork in Editor. Choose other supported sizes in Setup later.' : 'One 1024 × 500 px feature graphic. Exported as RGB PNG without transparency. Add your artwork in Editor; Google recommends avoiding device imagery.';
    source.href = store === 'app-store' ? CREATIVE_SPEC_URL : PLAY_SPEC_URL;
  }
  render();
  return { el, selection: () => ({ kind: 'store-images', store, sizes }), label: () => `Add ${STORE_IMAGE_SETS[store].label}`, summary: () => store === 'app-store' ? 'Search result image + Header image · 2 canvases' : 'Feature graphic · 1 canvas' };
}
