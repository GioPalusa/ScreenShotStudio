import { layerLabel } from '../layer-ops.js';
import { engine } from '../store.js';
import { openProjectFonts } from './import-fonts.js';
import { h, selectInput, inspectorGroup } from './helpers.js';
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
    const project=engine.project,device=ed.scene.deviceDef;
    panel.append(h('div',{class:'details-empty document-details'},h('h3',null,'Document'),
      h('p',{class:'hint'},'Select an object on the canvas to edit its properties.'),
      h('dl',{class:'document-facts'},h('dt',null,'Screens'),h('dd',null,String(project.slides.length)),h('dt',null,'Languages'),h('dd',null,String(project.locales.length)),h('dt',null,'Canvas'),h('dd',null,`${device.label} · ${device.size.join(' × ')} px`)),
      h('div',{class:'field'},h('button',{class:'btn',onClick:()=>ed.ctx.setView('setup')},'Document settings…'),h('button',{class:'btn',onClick:()=>openProjectFonts()},'Manage fonts…'),h('button',{class:'btn small',onClick:()=>ed.setTab('layers')},'Browse layers'))));
    return { el: panel };
  }
  const multiple = ed.selectedIds.size > 1;
  const [symbol, type] = TYPES[selected.type] ?? ['square', 'Layer'];
  panel.append(h('div', { class: 'details-heading' }, icon(multiple ? 'rectangle.3.group' : symbol),
    h('div', null, h('b', null, multiple ? `${ed.selectedIds.size} layers selected` : layerLabel(selected)),
      h('div', { class: 'hint' }, multiple ? 'Arrange the selected layers together.' : type))));
  let scopeSection;
  if (!ed.editTemplateId) {
    const shared = ed.screenScope(selected), tile = ed.screenForLayer(selected);
    const mixed = ed.selectionLayers().some(layer => ed.screenScope(layer) !== shared);
    const localLabel = ed.allScreens() ? multiple ? 'Keep on individual screens' : `Keep on screen ${tile.number}` : 'Keep on this screen';
    const options = [['local', localLabel], ['shared', 'Continue across screens']];
    if (mixed) options.unshift(['mixed', 'Mixed']);
    const scope = selectInput({ options, value: mixed ? 'mixed' : shared ? 'shared' : 'local', onChange: value => { if (value !== 'mixed') ed.setScreenScope(value === 'shared'); } });
    scope.setAttribute('aria-label', 'Screen edges'); scope.disabled = selected.locked === true;
    if (mixed) scope.options[0].disabled = true;
    scopeSection=inspectorGroup('screen-edges','Screen edges',[h('label', { class: 'field' }, 'Screen edges', scope), h('p', { class: 'hint' }, mixed
      ? 'Choose how the selected objects behave at screen edges.'
      : shared ? ed.allScreens() ? 'On by default in All screens. Overlapping parts appear on each screen.' : 'One shared object. Edits update every screen it overlaps.'
      : ed.allScreens() ? `Kept on screen ${tile.number}${tile.slide.name ? ` — ${tile.slide.name}` : ''}. Parts outside its edges are cropped, even when you move it here.` : 'Parts outside this screen are cropped.')],{open:false});
  }
  const content = !multiple && selected.type === 'device' ? buildScreenshotPanel(ed, { selectedOnly: true })
    : !multiple && selected.type === 'text' && selected.field ? buildTextPanel(ed, { fields: [selected.field], compact: true }) : null;
  const properties = buildLayersPanel(ed, { detailsOnly: true });
  for (const part of [content, properties].filter(Boolean)) {
    part.el.className = 'details-content'; panel.append(part.el);
  }
  if(scopeSection)panel.append(scopeSection);
  return {
    el: panel,
    afterRender(scene) { content?.afterRender?.(scene); properties.afterRender?.(scene); },
    updateGeometry() { properties.updateGeometry?.(); },
    focusField(field) { content?.focusField?.(field); },
    focusFrame() { content?.focusFrame?.(); },
  };
}
