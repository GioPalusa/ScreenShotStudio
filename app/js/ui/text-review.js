import { h, modal } from './helpers.js';
import { flushSaves, engine } from '../store.js';

/** A separate review keeps heuristic design advice out of technical export gates. */
export function openTextReview(selection) {
  let generation = 0, closed = false;
  const status = h('p', { class: 'hint', 'aria-live': 'polite' }, 'Rendering text review…');
  const preview = h('div', { style: { overflowX: 'auto', maxHeight: '52vh' } });
  const findings = h('div');
  const width = h('select', { class: 'input', 'aria-label': 'Diagnostic image width', onChange: () => refresh() },
    [160, 240, 320].map(n => h('option', { value: n, selected: n === 240 }, `${n} px image width`)));
  const locale = h('select', { class: 'input', 'aria-label': 'Review language', onChange: () => refresh() },
    selection.locales.map(id => h('option', { value: id }, engine.localeInfo(id).name ?? id)));
  const device = h('select', { class: 'input', 'aria-label': 'Review canvas', onChange: () => refresh() },
    selection.devices.map(id => h('option', { value: id }, engine.project.devices[id]?.label ?? id)));
  const body = h('div', null,
    h('p', { class: 'hint' }, 'Read the main promise and check the app feature at a small size. These are diagnostic previews; actual store sizing and cropping vary.'),
    h('div', { class: 'row' }, locale, device, width), status, preview, findings);
  const m = modal({ title: 'Text readability', body, wide: true, actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Close')], onClose: () => { closed = true; generation++; } });
  async function refresh() {
    const mine = ++generation;
    status.textContent = 'Rendering text review…';
    preview.replaceChildren(); findings.replaceChildren();
    try {
      await flushSaves();
      const { inspectProject } = await import('../agent-inspection.js');
      const result = await inspectProject({ ...selection, locales: [locale.value], devices: [device.value], previewWidth: Number(width.value) });
      if (closed || mine !== generation) return;
      const image = h('img', { src: `data:image/jpeg;base64,${result.image}`, alt: `Selected screenshot series at ${width.value} pixel image width`, width: 1440, style: { maxWidth: 'none', display: 'block' } });
      preview.append(image);
      status.textContent = 'Preview uses the selected image width. Scroll sideways to see the complete series.';
      const review = result.textReview;
      findings.append(h('p', { class: 'hint' }, '12 px text and 4.5:1 contrast are review targets, not Apple rules. Text inside captures needs visual review.'));
      for (const scene of review.scenes) {
        const title = `${scene.locale} · ${scene.device} · ${scene.slide}`;
        const list = h('div');
        for (const layer of scene.layers) {
          const size = layer.previews.find(p => p.width === Number(width.value));
          list.append(h('p', { class: 'hint' }, `${layer.field} · ${size?.fontSize === null ? 'transformed size: inspect visually' : `${size?.fontSize} px`} · ${layer.lines} line${layer.lines === 1 ? '' : 's'} · ${layer.contrast.ratio ? `${layer.contrast.ratio}:1 contrast` : 'contrast: visual check'}`));
        }
        findings.append(h('details', { class: 'disclosure' }, h('summary', null, title), list,
          scene.advisories.map(a => h('p', { class: 'hint warn' }, a.message))));
      }
    } catch (error) { if (!closed && mine === generation) status.textContent = error.message; }
  }
  void refresh();
}
