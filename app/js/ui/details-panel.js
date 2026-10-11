import { layerLabel } from '../layer-ops.js';
import { h, selectInput } from './helpers.js';
import { icon } from './icons.js';
import { buildTextPanel } from './text-panel.js';
import { buildScreenshotPanel } from './screenshot-panel.js';
import { buildLayersPanel } from './layers-panel.js';

const TYPES = { device: ['iphone', 'Device'], text: ['textformat', 'Text'], art: ['photo', 'Image'], shape: ['square', 'Shape'], route: ['line.3.horizontal', 'Route'] };

/** One inspector, always describing the current selection. */
export function buildDetailsPanel(ed) {
  const panel = h('div', { class: 'panel details-panel' });
  if (!ed.scene) { panel.append(h('p', { class: 'hint' }, 'Loading the preview…')); return { el: panel }; }
  const selected = ed.layerById(ed.selectedId);
  if (!selected) {
    panel.append(h('div', { class: 'details-empty' }, h('h3', null, 'Select something to edit'),
      h('p', { class: 'hint' }, 'Click a device, text or image on the canvas to edit its details.')));
    const choices = h('div', { class: 'details-choices', role: 'group', 'aria-label': 'Choose a layer to edit' });
    const visible = ed.scene.allLayers.filter(l => !l.hidden);
    const choice = layer => h('button', { class: 'btn details-choice', onClick: () => ed.select(layer.id, { individual: true }) }, icon(TYPES[layer.type]?.[0] ?? 'square'), layerLabel(layer));
    if (ed.allScreens()) {
      const group = (name, number, layers, key, hint) => h('details', { class: 'details-screen-group', open: true, 'data-screen-id': key, 'data-section': `screen-${key}` },
        h('summary', { 'aria-label': `${typeof number === 'number' ? `Screen ${number}: ` : ''}${name}, ${layers.length} ${layers.length === 1 ? 'object' : 'objects'}` }, h('span', { class: 'details-screen-number', 'aria-hidden': 'true' }, number),
          h('span', { class: 'details-screen-name' }, name), h('span', { class: 'details-screen-count' }, `${layers.length} ${layers.length === 1 ? 'object' : 'objects'}`)),
        h('div', { class: 'details-screen-objects' }, hint ? h('p', { class: 'hint' }, hint) : null,
          layers.length ? layers.map(choice) : h('p', { class: 'hint' }, 'No objects on this screen.')));
      for (const [index, tile] of ed.scene.tiles.entries()) {
        choices.append(group(tile.slide.name || `Screen ${index + 1}`, index + 1, visible.filter(l => l._sourceSlideId === tile.slide.id), tile.slide.id));
      }
      const shared = visible.filter(l => l._sharedId);
      if (shared.length) choices.append(group('Across screens', '↔', shared, 'shared', 'One object, shared by every screen it overlaps.'));
    } else {
      choices.append(...visible.map(choice));
    }
    panel.append(choices, h('div', { class: 'row wrap' },
      h('button', { class: 'btn small', onClick: () => ed.addLayer('device') }, '＋ Device'),
      h('button', { class: 'btn small', onClick: () => ed.addLayer('text') }, '＋ Text'),
      h('button', { class: 'btn small', onClick: () => ed.addImage() }, '＋ Image')));
    return { el: panel };
  }
  const multiple = ed.selectedIds.size > 1;
  const [symbol, type] = TYPES[selected.type] ?? ['square', 'Layer'];
  panel.append(h('div', { class: 'details-heading' }, icon(multiple ? 'rectangle.3.group' : symbol),
    h('div', null, h('b', null, multiple ? `${ed.selectedIds.size} layers selected` : layerLabel(selected)),
      h('div', { class: 'hint' }, multiple ? 'Arrange the selected layers together.' : type))));
  if (!ed.editTemplateId) {
    const shared = ed.screenScope(selected), tile = ed.screenForLayer(selected);
    const mixed = ed.selectionLayers().some(layer => ed.screenScope(layer) !== shared);
    const localLabel = ed.allScreens() ? multiple ? 'Keep on individual screens' : `Keep on screen ${tile.number}` : 'Keep on this screen';
    const options = [['local', localLabel], ['shared', 'Continue across screens']];
    if (mixed) options.unshift(['mixed', 'Mixed']);
    const scope = selectInput({ options, value: mixed ? 'mixed' : shared ? 'shared' : 'local', onChange: value => { if (value !== 'mixed') ed.setScreenScope(value === 'shared'); } });
    scope.setAttribute('aria-label', 'Screen edges'); scope.disabled = selected.locked === true;
    if (mixed) scope.options[0].disabled = true;
    panel.append(h('label', { class: 'field' }, 'Screen edges', scope), h('p', { class: 'hint' }, mixed
      ? 'Choose how the selected objects behave at screen edges.'
      : shared ? ed.allScreens() ? 'On by default in All screens. Overlapping parts appear on each screen.' : 'One shared object. Edits update every screen it overlaps.'
      : ed.allScreens() ? `Kept on screen ${tile.number}${tile.slide.name ? ` — ${tile.slide.name}` : ''}. Parts outside its edges are cropped, even when you move it here.` : 'Off by default on individual screens. Parts outside this screen are cropped.'));
  }
  const content = !multiple && selected.type === 'device' ? buildScreenshotPanel(ed, { selectedOnly: true })
    : !multiple && selected.type === 'text' && selected.field ? buildTextPanel(ed, { fields: [selected.field], compact: true }) : null;
  const properties = buildLayersPanel(ed, { detailsOnly: true });
  for (const part of [content, properties].filter(Boolean)) {
    part.el.className = 'details-content'; panel.append(part.el);
  }
  return {
    el: panel,
    afterRender(scene) { content?.afterRender?.(scene); properties.afterRender?.(scene); },
    updateGeometry() { properties.updateGeometry?.(); },
    focusField(field) { content?.focusField?.(field); },
    focusFrame() { content?.focusFrame?.(); },
  };
}
