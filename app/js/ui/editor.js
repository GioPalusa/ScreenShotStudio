import { sharedBlock, sharedGeometry, sharedLayerId, patchSharedLayer, offsetLayer, SCREEN_SPACING_PRESETS, sharedSpacing, setSharedSpacing } from '../shared-canvas.js';
import { canvasForSlide } from '../canvas-orientation.js';
import { orientationPicker } from './canvas-orientation.js';
import { orderedSlides, insertSlideAfter } from '../project-ops.js';
import { moveScreen, renameScreen } from './slide-actions.js';
import { editLayerTag } from './layer-tag.js';
import { adjacentSlides, neighborPreferences } from '../preview-context.js';
import { creationShortcut, isTextEditing } from '../shortcuts.js';
import { snapshotLayer, transferLayer, removeConnectedFragments, containTextSource, screenScopeFor, screenTileForLayer, encodeLayerClipboard, decodeLayerClipboard, pasteLayerClipboard, LAYER_CLIPBOARD_MIME } from '../layer-transfer.js';
import { deviceForLayer } from '../profiles.js';
import { wheelPixels, pinchZoom, pointInRect } from './viewport-gestures.js';
import { visibleWarnings, warningButton } from './warnings.js';
// The editor: slide rail, the live preview (click, drag, resize and rotate things on it), and the
// Text / Screenshot / Layers / Design inspector. This file wires them together; each inspector tab and
// the stage interaction live in their own module and talk to the editor through the `ed` object below.

import {
  engine, state, on, rememberUI, saveStudio, saveCopy, uploadAsset, checkpoint, undo, undoIf, redo, canUndo, canRedo,
  currentSlide, slideIndex,
} from '../store.js';
import { arrangeSelection } from '../selection.js';
import { makeLayer, resolveLayers, canvasMetrics, paintOrder } from '../layouts.js';
import {
  editBlock, peekBlock, setLayoutIndependent, slideForTemplateEdit, patchLayer, addLayer, removeLayer, geometryPatch, scaleLayerGeometry, devicesSharingBlock,
  duplicateLayers, saveAsTemplate, detachTemplate, updateTemplateFromSlide, templateUsage, templateOf, uniqueId, slugify, layerLabel, stepLayer, moveLayerTo, stackIndex,
} from '../layer-ops.js';
import { readImageInfo, imageFilesOf } from '../assets.js';
import { h, drawInto, toast, modal, confirmDialog, promptDialog, pixelRatio, selectInput } from './helpers.js';
import { icon } from './icons.js';
import { createStage } from './stage.js';
import { buildDetailsPanel } from './details-panel.js';
import { applyCapture } from './screenshot-panel.js';
import { buildLayersPanel } from './layers-panel.js';
import { buildDesignPanel } from './design-panel.js';
import { withLoadedDesign } from '../design-ops.js';
import { openNewDesignGallery } from './design-gallery.js';
import { openDesignLibrary } from './design-library.js';
import { newCompositionSlide } from '../device-compositions.js';
import { newConnectedSeries, patchConnectedLayer } from '../connected-series.js';
import { storyCopyFor, addStoryCopy } from '../story-templates.js';
import { openConnectedSeries } from './connected-series.js';
import { openImagePicker } from './image-picker.js';
import { showContextMenu } from './context-menu.js';
import { createInspectorMemory } from './inspector-state.js';

const TABS = [['details', 'Details'], ['layers', 'Layers'], ['design', 'Design']];
const BUILDERS = { details: buildDetailsPanel, layers: buildLayersPanel, design: buildDesignPanel };

export function createEditor(ctx) {
  const layerAliases = new Map();
  let lastPaste = '', pasteCount = 0;
  const inspectorMemory = createInspectorMemory();
  let inspectorKey;
  const railList = h('div', { class: 'rail-list', role: 'listbox', 'aria-label': 'Slides' });
  const screenCount = h('span', { class: 'all-screens-count', 'aria-hidden': 'true' });
  const allScreens = h('button', { class: 'all-screens-option', 'aria-pressed': 'false', title: 'Edit the whole row together. New objects can span screen edges.', onClick: () => selectAllScreens() },
    h('span', { class: 'all-screens-heading' }, h('span', { class: 'all-screens-visual', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), screenCount),
    h('span', null, h('b', null, 'Edit all screens'), h('small', null, 'One shared canvas')));
  const rail = h('aside', { class: 'rail' }, allScreens, railList);
  const titleEl = h('span', { class: 'title' });
  const metaEl = h('span');
  const chipsEl = h('span', { class: 'row' });
  let warningContext = '';
  const undoBtn = h('button', { class: 'btn small icon', title: 'Undo  ⌘Z', 'aria-label': 'Undo', onClick: () => doUndo() }, icon('arrow.uturn.backward'));
  const redoBtn = h('button', { class: 'btn small icon', title: 'Redo  ⇧⌘Z', 'aria-label': 'Redo', onClick: () => doRedo() }, icon('arrow.uturn.forward'));
  const canvas = h('canvas', { 'aria-label': 'Slide preview' });
  const overlay = h('div', { class: 'overlay' });
  const screenLabels = h('div', { class: 'workspace-screen-labels' });
  const preview = h('div', { class: 'preview' }, canvas, screenLabels, overlay);
  const beforeCanvas = h('canvas');
  const afterCanvas = h('canvas');
  const openNeighbor = e => {
    const id = e.currentTarget.dataset.slideId;
    if (id && !stageApi.dragging) selectSlide(id);
  };
  const before = h('button', { type: 'button', class: 'neighbor before', onClick: openNeighbor }, beforeCanvas);
  const after = h('button', { type: 'button', class: 'neighbor after', onClick: openNeighbor }, afterCanvas);
  const strip = h('div', { class: 'stage-strip' }, before, preview, after);
  const stageCanvas = h('div', { class: 'stage-canvas', title: 'Pinch to zoom · Scroll with two fingers to pan · 0 to fit' }, strip);
  const zoom = selectInput({ options: [['fit', 'Fit'], ['0.25', '25%'], ['0.5', '50%'], ['1', '100%'], ['2', '200%']], value: 'fit', title: 'Canvas zoom', onChange: () => setZoom(zoom.value) });
  const customZoom = h('option', { value: 'custom', hidden: true });
  zoom.append(customZoom);
  let viewportX = 0, viewportY = 0, viewportKey = '', zoomTimer;
  const neighborToggle = h('button', { class: 'btn small', title: 'Show or hide the previous and next slides', 'aria-label': 'Show adjacent slides', onClick: () => {
    state.ui.showNeighbors = !neighborPreferences(state.ui).visible;
    rememberUI(); drawStage();
  } }, '▥');
  const opacityValue = h('span');
  const neighborOpacity = h('input', { type: 'range', min: 0, max: 100, step: 5, 'aria-label': 'Adjacent slide opacity', title: 'Opacity of adjacent slides', onInput: e => {
    state.ui.neighborOpacity = Number(e.target.value);
    rememberUI(); updateNeighborControls();
  } });
  const opacityControl = h('label', { class: 'neighbor-opacity' }, neighborOpacity, opacityValue);
  const neighborControls = h('span', { class: 'neighbor-controls' }, neighborToggle, opacityControl);
  const orientationControl = h('span');
  const stage = h('section', { class: 'stage' }, h('div', { class: 'stage-bar' }, titleEl, metaEl, h('span', { class: 'spacer' }), chipsEl, neighborControls, orientationControl, zoom, h('span', { class: 'row' }, undoBtn, redoBtn)), stageCanvas);
  const inspector = h('aside', { class: 'inspector' });
  const el = h('div', { class: 'editor' }, rail, stage, inspector);

  // ---------------------------------------------------------------------------------------------
  // the editor object shared with the stage and the inspector tabs

  const ed = {
    ctx, overlay, scene: null, stageWidth: 0, selectedId: null, selectedIds: new Set(), editTemplateId: null, panel: null, refreshTimer: null,

    allScreens: () => Boolean(state.ui.allScreens),
    screenScope: layer => screenScopeFor(layer, state.ui.allScreens),
    screenForLayer(layer) {
      const { tiles } = sharedGeometry(engine.project, state.ui.device, state.ui.locale);
      const tile = state.ui.allScreens ? screenTileForLayer(tiles, layer) : tiles.find(t => t.slide.id === currentSlide().id);
      return tile && { ...tile, number: tiles.indexOf(tile) + 1 };
    },
    slide: () => engine.project.slides.find(s => s.id === ed.layerById(ed.selectedId)?._sourceSlideId) ?? currentSlide(),
    localeScope: () => !state.ui.allScreens && !ed.editTemplateId && currentSlide()?.localeLayouts?.[state.ui.locale]?.[state.ui.device]?.independent ? state.ui.locale : null,
    selectionLayers: () => ed.scene?.layers.filter(l => (ed.selectedIds.has(l.id) || l.id === ed.selectedId) && l._box && !l.locked) ?? [],
    deviceId: () => state.ui.device,
    device: () => {
      if (!state.ui.allScreens) return canvasForSlide(engine.project, currentSlide(), state.ui.device);
      const { W, H, k } = sharedGeometry(engine.project, state.ui.device, state.ui.locale);
      return { ...engine.project.devices[state.ui.device], size: [W * k, H * k] };
    },
    locale: () => engine.localeInfo(state.ui.locale),
    layerById: (id) => (id ? ed.scene?.allLayers.find((l) => l.id === id) ?? ed.scene?.allLayers.find(l => l.id === layerAliases.get(id)) ?? null : null),

    /** The slide as drawn: the real one, or - while a template is edited - the slide with that template's layout in place of its own. */
    drawSlide() {
      const slide = currentSlide();
      if (ed.editTemplateId && engine.project.templates?.[ed.editTemplateId]) return slideForTemplateEdit(engine.project, slide, state.ui.device, ed.editTemplateId);
      ed.editTemplateId = null;
      return null;
    },
    /** The layout block edits are written to: the slide's, or the template's in template mode. Created when missing: use for writing. */
    block: () => state.ui.allScreens ? sharedBlock(engine.project, state.ui.device, true) : editBlock(engine.project, currentSlide(), state.ui.device, ed.editTemplateId && engine.project.templates?.[ed.editTemplateId] ? ed.editTemplateId : null, ed.localeScope()),
    /** The same block for reading: nothing is created. */
    peekBlock: () => state.ui.allScreens ? sharedBlock(engine.project, state.ui.device) : peekBlock(engine.project, currentSlide(), state.ui.device, ed.editTemplateId && engine.project.templates?.[ed.editTemplateId] ? ed.editTemplateId : null, ed.localeScope()),
    /** A message's "Undo" button: undoes `token`'s step only while it is still the latest one. */
    undoStep(token) {
      if (!undoIf(token)) toast('Other changes were made since: step back with ⌘Z instead.', { timeout: 4000 });
    },

    sourceFor(layer) {
      if (layer._sharedId) return { block: sharedBlock(engine.project, state.ui.device, true), layer: { ...layer, ...sharedBlock(engine.project, state.ui.device).layers.find(l => l.id === layer._sharedId), _origin: 'slide' }, slide: currentSlide() };
      if (layer._sourceSlideId) {
        const slide = engine.project.slides.find(s => s.id === layer._sourceSlideId);
        const scope = slide.localeLayouts?.[state.ui.locale]?.[state.ui.device]?.independent ? state.ui.locale : null;
        const source = resolveLayers({ project: engine.project, slide, deviceId: state.ui.device, localeId: state.ui.locale, includeShared: false }).layers.find(l => l.id === layer._sourceLayerId);
        return { block: editBlock(engine.project, slide, state.ui.device, null, scope), layer: { ...layer, ...source, id: source.id, _box: layer._box ? { ...layer._box, x: layer._box.x - layer._offsetX } : undefined, _decorationBase: layer._decorationBase }, slide, scope };
      }
      return { block: ed.block(), layer, slide: currentSlide(), scope: ed.localeScope() };
    },
    snapshot(layer) {
      const scene = ed.scene.tiles?.find(t => t.slide.id === layer._sourceSlideId)?.scene ?? ed.scene;
      return snapshotLayer(layer, { color: scene.theme.ink, frame: engine.frameRefFor(scene.deviceDef, layer), captureSet: deviceForLayer(engine.project, scene.deviceDef, layer).capture });
    },
    shareLayer(layer) {
      if (layer._sharedId) return layer;
      const source = ed.sourceFor(layer), block = sharedBlock(engine.project, state.ui.device, true);
      const tile = sharedGeometry(engine.project, state.ui.device, state.ui.locale).tiles.find(t => t.slide.id === source.slide.id);
      const stored = transferLayer({ sourceBlock: source.block, sourceLayer: source.layer, targetBlock: block,
        snapshot: ed.snapshot(layer), dx: state.ui.allScreens ? 0 : tile.x, copySlideId: source.slide.id, localeId: source.scope });
      delete stored.screenScope;
      const fragments = removeConnectedFragments(engine.project, source.slide, state.ui.device, source.layer, source.scope);
      const id = sharedLayerId(stored.id);
      // Keep the pointer gesture and its already-loaded images alive when ownership changes.
      layerAliases.set(layer.id, id);
      for (const slideId of fragments) {
        const fragmentId = `screen:${slideId}:${source.layer.id}`;
        layerAliases.set(fragmentId, id);
        if (ed.selectedIds.delete(fragmentId)) ed.selectedIds.add(id);
        if (ed.selectedId === fragmentId) ed.selectedId = id;
      }
      if (ed.selectedIds.delete(layer.id)) ed.selectedIds.add(id);
      if (ed.selectedId === layer.id) ed.selectedId = id;
      const sourceAssets = ed.scene.tiles?.find(t => t.slide.id === source.slide.id)?.scene.assets ?? ed.scene.assets;
      for (const assets of [ed.scene.assets, ed.scene.shared?.assets, ...(ed.scene.tiles ?? []).map(t => t.scene.assets)].filter(Boolean)) {
        // Frame images are keyed by frame reference; artwork and captures are keyed by layer ID.
        Object.assign(assets.frames ??= {}, sourceAssets?.frames);
        for (const kind of ['art', 'captures']) if (sourceAssets?.[kind]?.[source.layer.id]) (assets[kind] ??= {})[id] = sourceAssets[kind][source.layer.id];
      }
      ed.inspectorStale = true;
      return { ...layer, ...stored, id, _sharedId: stored.id, _sourceSlideId: undefined, _offsetX: state.ui.allScreens ? 0 : -tile.x };
    },
    setScreenScope(shared) {
      if (ed.editTemplateId) return;
      const layers = ed.selectionLayers(); if (!layers.length) return;
      checkpoint(null, { copyLocales: Object.keys(engine.data.copy) });
      const ids = [], changedLocales = new Set();
      for (const layer of layers) {
        if (shared) { ids.push(ed.shareLayer(layer).id); continue; }
        if (!layer._sharedId) {
          const source = ed.sourceFor(layer);
          removeConnectedFragments(engine.project, source.slide, state.ui.device, source.layer, source.scope);
          patchLayer(source.block, source.layer, { screenScope: 'local', seriesLayer: null });
          ids.push(layer.id); continue;
        }
        const source = ed.sourceFor(layer);
        const tile = ed.screenForLayer(layer), slide = tile.slide;
        const block = editBlock(engine.project, slide, state.ui.device, null, source.layer.localeId ?? null);
        const resolved = resolveLayers({ project: engine.project, slide, deviceId: state.ui.device, localeId: state.ui.locale, includeShared: false }).layers;
        const stored = transferLayer({ sourceBlock: source.block, sourceLayer: source.layer, targetBlock: block, snapshot: ed.snapshot(layer), dx: state.ui.allScreens ? -tile.x : 0, copySlideId: slide.id, resolved });
        stored.screenScope = 'local';
        containTextSource(stored, engine.data.copy, slide.id).forEach(locale => changedLocales.add(locale));
        ids.push(state.ui.allScreens ? `screen:${slide.id}:${stored.id}` : stored.id);
      }
      ed.selectedIds = new Set(ids); ed.selectedId = ids.at(-1);
      changedLocales.forEach(locale => saveCopy(locale)); saveStudio(); ed.refresh({ immediate: true, inspector: true, rail: true });
    },
    writePatch(layer, patch) {
      const alias = layerAliases.get(layer.id);
      const source = alias && sharedBlock(engine.project, state.ui.device).layers?.find(l => sharedLayerId(l.id) === alias);
      layer = source ? { ...layer, id: alias, _sharedId: source.id, _offsetX: state.ui.allScreens ? 0 : layer._offsetX } : ed.layerById(layer.id) ?? layer;
      if (state.ui.allScreens && !layer._sharedId && ed.screenScope(layer) && ['cx', 'cy', 'x', 'top', 'capTop', 'baseline', 'w', 'h', 'rotate', 'decorationBox'].some(key => key in patch)) layer = ed.shareLayer(layer);
      if (layer._sharedId) { patchSharedLayer(engine.project, state.ui.device, layer, patch); return; }
      const target = ed.sourceFor(layer);
      const local = offsetLayer(patch, -(layer._offsetX ?? 0));
      patchLayer(target.block, target.layer, local);
      if (!ed.editTemplateId) patchConnectedLayer(engine.project, target.slide, state.ui.device, target.layer, local, target.scope);
    },
    deleteLayer(layer) {
      const source = ed.sourceFor(layer);
      removeLayer(source.block, source.layer);
      if (layer._sharedId) source.block.layers ??= [];
    },

    // ----- redraw
    /** Redraw soon. `inspector` rebuilds the inspector once the new picture is ready (it describes what was just drawn). */
    refresh({ immediate = false, inspector = false, rail: rebuildRailToo = false } = {}) {
      if (inspector) ed.inspectorStale = true;
      clearTimeout(ed.refreshTimer);
      ed.refreshTimer = setTimeout(() => {
        drawStage();
        const card = railList.querySelector(`[data-id="${state.ui.slideId}"] canvas`);
        if (card) drawInto(card, { slideId: state.ui.slideId, deviceId: state.ui.device, localeId: state.ui.locale, width: 96 });
        if (rebuildRailToo || state.ui.allScreens || sharedBlock(engine.project, state.ui.device).layers?.length) buildRail();
      }, immediate ? 0 : 90);
    },
    rebuildInspector: () => buildInspector(),
    rebuildRail: () => buildRail(),
    setTab(tab) { state.ui.tab = tab; rememberUI(); buildInspector(); },
    afterCaptureChange() { drawStage(); buildRail(); if (state.ui.tab === 'details') buildInspector(); },

    // ----- selection
    /** Preserve a multi-selection when the user starts dragging it from the canvas. */
    selectionVisible() { return state.ui.tab === 'layers' || state.ui.tab === 'details'; },
    showDetails() { if (state.ui.tab !== 'details') ed.setTab('details'); },
    select(id, { from, toggle = false, individual = false } = {}) {
      const layer = ed.layerById(id);
      const ids = layer?.group && !individual ? ed.scene.layers.filter(l => l.group === layer.group).map(l => l.id) : id ? [id] : [];
      if (!toggle) ed.selectedIds.clear();
      const remove = toggle && ed.selectedIds.has(id);
      for (const next of ids) { if (remove) ed.selectedIds.delete(next); else ed.selectedIds.add(next); }
      ed.selectedId = ed.selectedIds.has(id) ? id : [...ed.selectedIds].at(-1) ?? null;
      if (from === 'stage' && layer) {
        state.ui.tab = 'details';
        rememberUI();
      }
      stageApi.render();
      buildInspector();
      inspector.querySelector('.layer-row[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    },
    /** Double click on the stage: go to the right place to edit that layer. */
    openLayer(layer) {
      ed.select(layer.id, { from: 'stage', individual: true });
      if (layer.type === 'text') ed.panel?.focusField?.(layer.field);
    },
    renameLayer(id) {
      state.ui.tab = 'layers'; ed.select(id, { individual: true }); ed.panel?.rename?.(id);
    },
    layerMenu(event, layer) {
      if (!layer) return;
      ed.select(layer.id, { individual: true });
      const all = ed.scene.allLayers, index = stackIndex(all, layer.id), locked = Boolean(layer.locked);
      const arrange = (direction, extreme = false) => ed.restack(block => extreme ? moveLayerTo(block, ed.scene.allLayers, layer.id, direction < 0 ? 0 : ed.scene.allLayers.length) : stepLayer(block, ed.scene.allLayers, layer.id, direction));
      showContextMenu(event, [
        { label: 'Rename', run: () => ed.renameLayer(layer.id) },
        { label: 'Tag…', run: () => editLayerTag(ed, layer) },
        { label: 'Bring forward', disabled: locked || index >= all.length - 1, run: () => arrange(1) },
        { label: 'Send backward', disabled: locked || index <= 0, run: () => arrange(-1) },
        { label: 'Bring to front', disabled: locked || index >= all.length - 1, run: () => arrange(1, true) },
        { label: 'Send to back', disabled: locked || index <= 0, run: () => arrange(-1, true) },
        { label: 'Rotate 90° clockwise', disabled: locked, run: () => ed.setLayer(ed.layerById(layer.id), { rotate: ((layer._box?.rot ?? layer.rotate ?? 0) + 90) % 360 }, { rebuild: true }) },
        { label: 'Reset rotation', disabled: locked || !(layer._box?.rot ?? layer.rotate), run: () => ed.setLayer(ed.layerById(layer.id), { rotate: 0 }, { rebuild: true }) },
        { label: 'Duplicate', disabled: locked, run: () => ed.duplicateSelection() },
        { label: layer.hidden ? 'Show layer' : 'Hide layer', run: () => ed.setLayer(layer, { hidden: !layer.hidden }, { rebuild: true }) },
        { label: locked ? 'Unlock layer' : 'Lock layer', run: () => ed.setLayer(layer, { locked: !locked }, { rebuild: true }) },
        { label: 'Delete layer', danger: true, disabled: locked, run: () => ed.removeLayer(layer) },
      ]);
    },

    groupSelection(ungroup = false) {
      const layers = ed.selectionLayers();
      if (!layers.length) return;
      checkpoint();
      if (!ungroup && new Set(layers.map(l => l._sharedId ? 'shared' : l._sourceSlideId ?? currentSlide().id)).size > 1) { toast('Group shared objects together, or layers belonging to the same screen.'); return; }
      const group = ungroup ? undefined : `group-${Date.now()}`;
      for (const layer of layers) ed.writePatch(layer, { group });
      saveStudio(); ed.refresh({ immediate: true, inspector: true });
    },
    arrange(operation) {
      const patches = arrangeSelection(ed.selectionLayers(), operation, ed.scene);
      if (!patches.length) return;
      checkpoint();
      for (const { layer, box } of patches) ed.writePatch(layer, geometryPatch(layer, box));
      livePaint(); ed.finishEdit(); stageApi.render();
    },
    removeSelection() {
      const layers = ed.selectionLayers();
      if (!layers.length) return;
      checkpoint();
      for (const layer of layers) ed.deleteLayer(layer);
      ed.selectedIds.clear(); ed.selectedId = null;
      saveStudio(); ed.refresh({ immediate: true, inspector: true });
    },
    // ----- editing layers
    startEdit(key) { checkpoint(key); return ed.block(); },
    /** Write a layer's geometry and repaint immediately (used while dragging and typing numbers). */
    applyBox(layer, box, opts) {
      const patch = geometryPatch(layer, box, opts);
      ed.writePatch(layer, patch);
      livePaint();
      drawNeighbors();
    },
    applyGroup(transforms) {
      for (const { layer, box, scale } of transforms) {
        const patch = geometryPatch(layer, box);
        if (layer.type === 'text' && Math.abs(scale - 1) > 0.0001) {
          patch.size = layer.size * scale;
          if (layer.minSize) patch.minSize = layer.minSize * scale;
        }
        ed.writePatch(layer, patch);
      }
      livePaint();
      drawNeighbors();
    },
    duplicateSelection() {
      const layers = ed.selectionLayers(); if (!layers.length) return;
      const ids = [], changedLocales = new Set();
      checkpoint(null, { copyLocales: Object.keys(engine.data.copy) });
      for (const layer of layers) {
        const source = ed.sourceFor(layer);
        const copySlide = source.layer.copySlideId ?? source.slide.id;
        const slideIds = [...new Set([copySlide, ...(ed.editTemplateId ? templateUsage(engine.project, ed.editTemplateId) : [])])];
        const resolved = layer._sharedId ? source.block.layers : resolveLayers({ project: engine.project, slide: ed.drawSlide() ?? source.slide, deviceId: state.ui.device, localeId: state.ui.locale, includeShared: false }).layers;
        const result = duplicateLayers(source.block, [source.layer], resolved, engine.data.copy, slideIds);
        const [stored] = result.layers;
        result.changedLocales.forEach(locale => changedLocales.add(locale));
        ids.push(layer._sharedId ? sharedLayerId(stored.id) : layer._sourceSlideId ? `screen:${source.slide.id}:${stored.id}` : stored.id);
      }
      ed.selectedIds = new Set(ids); ed.selectedId = ids.at(-1);
      changedLocales.forEach(locale => saveCopy(locale)); saveStudio();
      ed.refresh({ immediate: true, inspector: true, rail: true });
    },
    finishEdit() {
      saveStudio();
      if (ed.inspectorStale) { ed.inspectorStale = false; buildInspector(); }
      ed.panel?.updateGeometry?.();
      clearTimeout(ed.thumbTimer);
      ed.thumbTimer = setTimeout(() => {
        if (state.ui.allScreens || currentSlide().series || sharedBlock(engine.project, state.ui.device).layers?.length) { buildRail(); return; }
        const card = railList.querySelector(`[data-id="${state.ui.slideId}"] canvas`);
        if (card) drawInto(card, { slideId: state.ui.slideId, deviceId: state.ui.device, localeId: state.ui.locale, width: 96 });
      }, 200);
    },
    setLayer(layer, patch, { key = null, rebuild = false } = {}) {
      checkpoint(key ?? `set:${layer.id}:${Object.keys(patch).join(',')}`);
      if (layer._decorationBase && 'rotate' in patch) { const { rotate, ...rest } = patch; patch = { ...rest, decorationBox: { ...layer._box, rot: rotate ?? 0 } }; }
      ed.writePatch(layer, patch);
      saveStudio();
      ed.refresh({ immediate: true, inspector: rebuild, rail: Boolean(layer.seriesLayer) });
    },
    /** Change the stacking order: `fn(block)` does the moving. */
    restack(fn) {
      checkpoint();
      const layers = ed.scene.allLayers.map(l => ({ ...l, _origin: 'slide' })), block = { layers };
      fn(block);
      for (const layer of layers) { const original = ed.layerById(layer.id), zOrder = block.overrides?.[layer.id]?.zOrder ?? layer.zOrder; if (original && original.zOrder !== zOrder) ed.writePatch(original, { zOrder }); }
      saveStudio(); ed.refresh({ immediate: true, inspector: true });
    },
    /** Any other change to the layout block. */
    editLayout(fn) { checkpoint(); fn(ed.block()); saveStudio(); ed.refresh({ immediate: true, inspector: true }); },

    addLayer(kind, extra = {}) {
      const scene = ed.scene;
      if (!scene) return;
      const taken = scene.allLayers.map((l) => l.id);
      if (ed.editTemplateId) { // a slide following this template may already have layers of its own: keep ids distinct across them
        for (const s of engine.project.slides) for (const b of Object.values(s.layouts ?? {})) if (b?.use === ed.editTemplateId) taken.push(...(b.layers ?? []).map((l) => l.id));
      }
      taken.push(...Object.keys(ed.peekBlock().overrides ?? {})); // layers switched off keep their id reserved
      const id = uniqueId(taken, kind);
      checkpoint();
      const tile = state.ui.allScreens ? sharedGeometry(engine.project, state.ui.device, state.ui.locale).tiles[0] : null;
      const layer = makeLayer(kind, { cls: scene.cls, W: tile?.W ?? scene.W, H: tile?.H ?? scene.H, id, ...extra });
      if (tile) {
        if (Number.isFinite(layer.cx)) layer.cx = scene.W / 2;
        if (Number.isFinite(layer.x)) layer.x = scene.W / 2 - layer.w / 2;
        layer.allowCrop = true;
        if (layer.type === 'device') { layer.frame = structuredClone(engine.project.devices[state.ui.device].frame ?? { type: 'plain', screen: [...engine.project.devices[state.ui.device].size] }); }
        if (layer.type === 'text') { layer.color = scene.theme.ink; layer.copySlideId = currentSlide().id; layer.field = uniqueId([...Object.values(engine.data.copy).flatMap(doc => Object.keys(doc[currentSlide().id] ?? {})), ...(ed.block().layers ?? []).map(l => l.field)], `shared-${layer.field}`); }
      }
      const stored = addLayer(ed.block(), layer, state.ui.allScreens ? ed.block().layers : scene.allLayers);
      saveStudio();
      ed.selectedIds.clear(); ed.selectedId = state.ui.allScreens ? sharedLayerId(stored.id) : stored.id; ed.selectedIds.add(ed.selectedId);
      state.ui.tab = 'details'; rememberUI();
      ed.refresh({ immediate: true, inspector: true });
    },
    async addImage(files = null) {
      if (!ed.scene) return;
      const started = { allScreens: state.ui.allScreens, locale: state.ui.locale, scope: ed.localeScope(), slideId: state.ui.slideId, deviceId: state.ui.device, template: ed.editTemplateId };
      const { W, H, cls } = ed.scene;
      const picked = [];
      if (files) {
        for (const file of files) {
          try { const info = await readImageInfo(file); const res = await uploadAsset(file); picked.push({ file: res.file, width: info.width, height: info.height }); }
          catch (err) { toast(`Could not add ${file.name}: ${err.message}`, { error: true }); }
        }
      } else {
        const one = await openImagePicker({ title: 'Add an image' });
        if (one) picked.push(one);
      }
      if (!picked.length) return;
      if (started.allScreens !== state.ui.allScreens || started.locale !== state.ui.locale || started.scope !== ed.localeScope() || started.slideId !== state.ui.slideId || started.deviceId !== state.ui.device || started.template !== ed.editTemplateId) {
        toast('You moved to another slide while the image was uploading. It is in the image library: add it again from there.', { timeout: 7000 });
        return;
      }
      checkpoint();
      picked.forEach((p, i) => {
        const aspect = p.width / p.height;
        const tileWidth = state.ui.allScreens ? sharedGeometry(engine.project, state.ui.device, state.ui.locale).tiles[0].W : W;
        const w = Math.round(Math.min(tileWidth * (state.ui.allScreens ? 1.2 : .5), Math.max(160, p.width)));
        const layer = makeLayer('image', { cls, W, H, id: 'image', src: p.file, aspect: Math.round(aspect * 10000) / 10000, w });
        if (state.ui.allScreens) layer.allowCrop = true;
        layer.cx += i * 60;
        layer.cy += i * 60;
        const stored = addLayer(ed.block(), layer, state.ui.allScreens ? ed.block().layers : resolveLayers({ project: engine.project, slide: ed.drawSlide() ?? currentSlide(), deviceId: state.ui.device, localeId: state.ui.locale }).layers);
        ed.selectedIds.clear(); ed.selectedId = state.ui.allScreens ? sharedLayerId(stored.id) : stored.id; ed.selectedIds.add(ed.selectedId);
      });
      saveStudio();
      state.ui.tab = 'details'; rememberUI();
      ed.refresh({ immediate: true, inspector: true });
    },
    duplicateLayer(layer) {
      ed.selectedIds = new Set([layer.id]); ed.selectedId = layer.id; ed.duplicateSelection();
    },
    removeLayer(layer) {
      const token = checkpoint();
      ed.deleteLayer(layer);
      saveStudio();
      ed.selectedIds.delete(layer.id);
      if (ed.selectedId === layer.id) ed.selectedId = null;
      ed.refresh({ immediate: true, inspector: true });
      toast(`Removed “${layerLabel(layer)}”`, { timeout: 8000, action: { label: 'Undo', onClick: () => ed.undoStep(token) } });
    },
    fitWidth(layer) {
      const { W } = ed.scene;
      const b = layer._box;
      ed.setLayer(layer, layer._decorationBase ? geometryPatch(layer, { ...b, x: 0, w: W, h: b.h * W / b.w }) : { cx: W / 2, w: W, h: undefined }, { rebuild: true });
    },
    copyToOtherDevices(layer) {
      const scene = ed.scene;
      const slide = ed.drawSlide() ?? currentSlide();
      const from = { W: scene.W, H: scene.H };
      checkpoint();
      let count = 0;
      for (const [id, device] of Object.entries(engine.project.devices)) {
        if (id === state.ui.device || (!ed.localeScope() && devicesSharingBlock(engine.project, slide, state.ui.device).includes(id))) continue;
        if (currentSlide().layouts?.[id]?.independent || currentSlide().localeLayouts?.[ed.localeScope()]?.[id]?.independent) continue;
        const block = editBlock(engine.project, currentSlide(), id, ed.editTemplateId && engine.project.templates?.[ed.editTemplateId] ? ed.editTemplateId : null, ed.localeScope());
        const resolved = resolveLayers({ project: engine.project, slide, deviceId: id, localeId: state.ui.locale }).layers;
        addLayer(block, scaleLayerGeometry(layer, from, canvasMetrics(canvasForSlide(engine.project, slide, id))), resolved);
        count++;
      }
      saveStudio();
      if (count > 1) toast(`Copied to ${count} device layouts.`, { timeout: 4000 });
    },

    // ----- layouts and templates
    addScreens: newSlide,
    async loadDesign() {
      if (ed.localeScope() || ed.editTemplateId) { toast('Finish editing the saved design or switch to the shared layout before loading a design.'); return; }
      const project = engine.project, slide = currentSlide(), deviceId = state.ui.device;
      const picked = await openNewDesignGallery({ slide, deviceId, mode: 'load' });
      if (!picked || engine.project !== project || currentSlide() !== slide) return;
      try {
        const next = withLoadedDesign(project, slide, picked);
        checkpoint();
        project.slides[slideIndex(slide.id)] = next;
        ed.selectedIds.clear(); ed.selectedId = null;
        saveStudio(); ed.ctx.go({ device: picked.deviceIds[0] });
      } catch (error) { toast(error.message, { error: true }); }
    },
    async saveTemplate() {
      if (ed.localeScope()) { toast('Switch to the shared layer layout before saving a reusable design.'); return; }
      const slide = currentSlide();
      const name = await promptDialog({
        title: 'Save this design', label: 'Design name', placeholder: 'e.g. Phone tilted, text on top', confirmLabel: 'Save design',
        hint: 'Saves layers, styling and positions for every canvas size and links this screen to the saved design. Text, screenshots and screen colours stay with each screen. Reuse it with Load design → Saved designs.',
      });
      if (!name) return;
      checkpoint();
      const id = saveAsTemplate(engine.project, slide, name);
      ed.editTemplateId = null; // the slide now follows the new template
      saveStudio();
      ed.refresh({ immediate: true, inspector: true });
      toast(`Saved “${engine.project.templates[id].name}”. Find it in Load design → Saved designs.`, { timeout: 8000 });
    },
    editTemplate(id) {

      state.ui.allScreens = false; ed.editTemplateId = id;
      ed.selectedIds.clear(); ed.selectedId = null;
      ed.refresh({ immediate: true, inspector: true });
    },
    async updateTemplateFromSlide(id) {
      if (ed.localeScope()) { toast('Switch to the shared layer layout before updating the saved design.'); return; }
      const n = templateUsage(engine.project, id).length;
      if (!(await confirmDialog({ title: 'Update saved design?', body: `The saved design “${engine.project.templates[id].name}” will use this screen’s layout. It is used by ${n} slide${n === 1 ? '' : 's'}, which will all change.`, confirmLabel: 'Update design' }))) return;
      checkpoint();
      updateTemplateFromSlide(engine.project, id, currentSlide());
      saveStudio();
      ed.refresh({ immediate: true, inspector: true, rail: true });
    },
    detachTemplate() {
      if (ed.localeScope()) { toast('Switch to the shared layer layout before unlinking its saved design.'); return; }
      checkpoint();
      detachTemplate(engine.project, currentSlide(), { templateId: templateOf(engine.project, currentSlide(), state.ui.device) });
      ed.editTemplateId = null;
      saveStudio();
      ed.refresh({ immediate: true, inspector: true });
    },
  };

  let pan = null;
  const positionViewport = () => { strip.style.transform = `translate(${viewportX}px, ${viewportY}px)`; };
  stageCanvas.addEventListener('pointerdown', e => {
    if (e.button !== 1 || stageApi.dragging) return;
    e.preventDefault(); stageCanvas.setPointerCapture(e.pointerId);
    pan = { x: e.clientX, y: e.clientY, left: viewportX, top: viewportY };
  });
  stageCanvas.addEventListener('pointermove', e => { if (pan) { viewportX = pan.left + e.clientX - pan.x; viewportY = pan.top + e.clientY - pan.y; positionViewport(); } });
  stageCanvas.addEventListener('pointerup', () => { pan = null; });
  stageCanvas.addEventListener('pointercancel', () => { pan = null; });
  const stageApi = createStage(ed);
  stageCanvas.addEventListener('wheel', e => {
    if (!currentSlide() || !ed.stageWidth) return;
    e.preventDefault();
    if (stageApi.dragging || pan) return;
    const delta = wheelPixels(e, stageCanvas.clientHeight);
    if (e.ctrlKey) {
      setZoom(pinchZoom(ed.stageWidth / ed.device().size[0], delta.y, .01, 2), { x: e.clientX, y: e.clientY }, true);
    } else {
      viewportX -= delta.x; viewportY -= delta.y; positionViewport();
    }
  }, { passive: false });

  // ---------------------------------------------------------------------------------------------
  // undo / redo

  function doUndo() { undo(); }
  function doRedo() { redo(); }
  const updateHistoryButtons = () => { undoBtn.disabled = !canUndo(); redoBtn.disabled = !canRedo(); };
  on('history', () => { layerAliases.clear(); updateHistoryButtons(); });
  on('restored', () => {
    if (!el.isConnected) return;
    if (ed.editTemplateId && !engine.project.templates?.[ed.editTemplateId]) ed.editTemplateId = null;
    buildRail();
    ed.refresh({ immediate: true, inspector: true });
  });

  // ---------------------------------------------------------------------------------------------
  // slide rail

  function buildRail() {
    allScreens.setAttribute('aria-pressed', String(Boolean(state.ui.allScreens)));
    const count = engine.project.slides.length;
    screenCount.textContent = `${count} screen${count === 1 ? '' : 's'}`;
    allScreens.setAttribute('aria-label', `Edit all screens together · ${count} screen${count === 1 ? '' : 's'}`);
    for (const button of rail.querySelectorAll('.rail-foot .btn:not(.primary)')) button.disabled = Boolean(state.ui.allScreens);
    const slides = orderedSlides(engine.project, state.ui.locale);
    const signature = JSON.stringify([state.ui.device, state.ui.locale, slides.map(s => [s.id, s.name])]);
    if (railList.dataset.signature === signature) {
      for (const card of railList.children) {
        card.setAttribute('aria-selected', String(!state.ui.allScreens && card.dataset.id === state.ui.slideId));
        drawInto(card.querySelector('canvas'), { slideId: card.dataset.id, deviceId: state.ui.device, localeId: state.ui.locale, width: 96 });
      }
      return;
    }
    railList.dataset.signature = signature;
    railList.replaceChildren();
    slides.forEach((slide, i) => {
      const thumbCanvas = h('canvas');
      const badge = h('span');
      const card = h('div', {
        class: 'thumb', role: 'option', tabindex: 0, draggable: 'true', 'aria-selected': String(!state.ui.allScreens && slide.id === state.ui.slideId), dataset: { id: slide.id },
        onClick: () => selectSlide(slide.id),
        onContextmenu: e => screenMenu(e, slide.id),
        onKeydown: e => {
          if (e.target !== card) return;
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) screenMenu(e, slide.id);
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSlide(slide.id); }
        },
        onDragstart: (e) => { e.dataTransfer.setData('text/x-slide', slide.id); e.dataTransfer.effectAllowed = 'move'; },
        onDragover: (e) => {
          if (!e.dataTransfer.types.includes('text/x-slide')) return;
          e.preventDefault();
          const after = e.clientY - card.getBoundingClientRect().top > card.offsetHeight / 2;
          card.classList.toggle('drop-before', !after);
          card.classList.toggle('drop-after', after);
        },
        onDragleave: () => card.classList.remove('drop-before', 'drop-after'),
        onDrop: (e) => {
          const from = e.dataTransfer.getData('text/x-slide');
          if (!from) return;
          e.preventDefault();
          const after = e.clientY - card.getBoundingClientRect().top > card.offsetHeight / 2;
          card.classList.remove('drop-before', 'drop-after');
          moveSlide(from, slide.id, after);
        },
      }, thumbCanvas, h('div', { class: 'thumb-label' }, h('b', null, i + 1), h('button', { class: 'name screen-name', title: 'Rename screen', onClick: e => { e.stopPropagation(); renameScreen(slide.id, () => { buildRail(); ed.refresh({ immediate: true }); }); } }, slide.name ?? slide.id), badge));
      thumbCanvas.addEventListener('rendered', (e) => {
        const worst = e.detail.report.warnings.reduce((w, x) => (x.level === 'error' ? 'err' : x.level === 'warn' && w !== 'err' ? 'warn' : w), null);
        badge.className = worst ? `warning-mark ${worst}` : '';
        badge.textContent = worst ? '⚠' : '';
        badge.hidden = !worst;
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', worst === 'err' ? 'Error' : 'Warning');
        badge.title = e.detail.report.warnings.filter((x) => x.level !== 'info').map((x) => x.message).join('\n');
      });
      railList.append(card);
      drawInto(thumbCanvas, { slideId: slide.id, deviceId: state.ui.device, localeId: state.ui.locale, width: 96 });
    });
    rail.querySelector('.rail-foot')?.remove();
    rail.append(h('div', { class: 'rail-foot' },
      h('button', { class: 'btn small primary', title: 'Create new screens from complete designs or device arrangements', onClick: newSlide }, '＋ Add screens'),
      h('button', { class: 'btn small', disabled: Boolean(state.ui.allScreens), title: 'Add a copy of this screen', onClick: () => duplicateSlide() }, 'Duplicate'),
      h('button', { class: 'btn small danger', disabled: Boolean(state.ui.allScreens), title: 'Remove this screen', onClick: () => removeSlide() }, 'Remove'),
    ));
  }

  function moveSlide(fromId, toId, after) {
    return moveScreen(fromId, toId, after, () => { buildRail(); ed.refresh({ immediate: true }); });
  }

  function screenMenu(event, id) {
    const slide = engine.project.slides.find(s => s.id === id);
    if (!slide) return;
    showContextMenu(event, [
      { label: 'Duplicate screen', run: () => duplicateSlide(id) },
      { label: 'Remove screen…', danger: true, disabled: engine.project.slides.length <= 1, help: engine.project.slides.length <= 1 ? 'Keep at least one screen in the project.' : 'Remove this screen from all languages.', run: () => removeSlide(id) },
    ], { label: `Screen actions · ${slide.name ?? slide.id}` });
  }

  function uniqueSlideId(base) {
    return uniqueId(engine.project.slides.map((s) => s.id), base);
  }

  async function newSlide() {
    const project = engine.project, current = currentSlide();
    const picked = await openDesignLibrary({ slide: current, deviceId: state.ui.device, newSlide: true });
    if (!picked || engine.project !== project) return;
    createFromDesign(picked, current);
  }

  function createFromDesign(picked, current) {
    const project = engine.project;
    if (picked.kind === 'series') { createSeries(picked, current); return; }
    const slide = newCompositionSlide(project, picked, () => crypto.randomUUID());
    checkpoint();
    project.slides.splice(slideIndex(current.id) + 1, 0, slide);
    saveStudio();
    state.ui.tab = 'layers'; state.ui.allScreens = false;
    ed.editTemplateId = null;
    ctx.go({ device: picked.deviceIds[0], slideId: slide.id });
    railList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function createSeries(picked, current) {
    const project = engine.project;
    const slides = newConnectedSeries(project, picked, () => crypto.randomUUID());
    const hasCopy = Boolean(storyCopyFor(slides[0]));
    const locales = hasCopy ? project.locales.map(l => l.id) : [];
    checkpoint(null, { copyLocales: locales });
    project.slides.splice(slideIndex(current.id) + 1, 0, ...slides);
    for (const locale of locales) {
      addStoryCopy(project, engine.data.copy, slides, locale);
      saveCopy(locale);
    }
    saveStudio(); state.ui.tab = 'layers'; state.ui.showNeighbors = true; state.ui.allScreens = false;
    ed.editTemplateId = null;
    ctx.go({ view: 'editor', device: picked.deviceIds[0], slideId: slides[0].id });
  }

  async function newSeries({ captures = [] } = {}) {
    const project = engine.project, current = currentSlide();
    const picked = await openConnectedSeries({ slide: current, deviceId: state.ui.device, captures });
    if (picked && engine.project === project) createFromDesign(picked, current);
  }

  function duplicateSlide(id = state.ui.slideId) {
    const slide = engine.project.slides.find(s => s.id === id);
    if (!slide) return;
    const copy = structuredClone(slide);
    delete copy.series;
    copy.id = uniqueSlideId(slide.id);
    copy.reviewId = crypto.randomUUID();
    copy.name = `${slide.name ?? slide.id} (copy)`;
    checkpoint(null, { copySlides: [copy.id] }); // undo removes the copy's text along with the slide
    insertSlideAfter(engine.project, copy, slide.id);
    for (const [loc, doc] of Object.entries(engine.data.copy)) {
      if (doc[slide.id]) { doc[copy.id] = structuredClone(doc[slide.id]); saveCopy(loc); }
    }
    saveStudio();
    selectSlide(copy.id, { rebuildRail: true });
  }

  async function removeSlide(id = state.ui.slideId) {
    if (engine.project.slides.length <= 1) { toast('A set needs at least one slide.', { error: true }); return; }
    const slide = engine.project.slides.find(s => s.id === id);
    if (!slide) return;
    const project = engine.project;
    if (!(await confirmDialog({ title: 'Remove this screen?', body: `“${slide.name ?? slide.id}” and its text in every language will be removed from this project. You can undo this change.`, confirmLabel: 'Remove screen', danger: true }))) return;
    if (engine.project !== project || !project.slides.includes(slide)) return;
    const slides = project.slides;
    if (slides.length <= 1) return;
    const index = slideIndex(slide.id);
    const token = checkpoint(null, { copyLocales: Object.keys(engine.data.copy) });
    const survivor = slides.find(s => s.id !== slide.id);
    for (const block of Object.values(project.sharedCanvas ?? {})) for (const layer of block.layers ?? []) {
      if (layer.copySlideId !== slide.id) continue;
      const field = uniqueId(Object.values(engine.data.copy).flatMap(doc => Object.keys(doc[survivor.id] ?? {})), layer.field);
      for (const doc of Object.values(engine.data.copy)) if (doc[slide.id]?.[layer.field] !== undefined) (doc[survivor.id] ??= {})[field] = structuredClone(doc[slide.id][layer.field]);
      layer.copySlideId = survivor.id; layer.field = field;
    }
    slides.splice(index, 1);
    for (const order of Object.values(project.slideOrders ?? {})) { const at = order.indexOf(slide.id); if (at >= 0) order.splice(at, 1); }
    for (const [loc, doc] of Object.entries(engine.data.copy)) if (doc[slide.id]) { delete doc[slide.id]; saveCopy(loc); }
    saveStudio();
    if (state.ui.slideId === slide.id) state.ui.slideId = slides[Math.min(index, slides.length - 1)].id;
    ed.selectedIds.clear(); ed.selectedId = null; ed.scene = null;
    rememberUI(); buildRail(); ed.refresh({ immediate: true, inspector: true });
    toast(`Removed “${slide.name ?? slide.id}”`, {
      timeout: 10000,
      action: {
        label: 'Undo',
        onClick: () => {
          ed.undoStep(token);
          if (engine.project.slides.some((s) => s.id === slide.id)) selectSlide(slide.id, { rebuildRail: true });
        },
      },
    });
  }

  function selectAllScreens() {
    layerAliases.clear();
    state.ui.allScreens = true; ed.editTemplateId = null; ed.selectedIds.clear(); ed.selectedId = null; ed.scene = null;
    ed.inspectorStale = true; zoom.value = 'fit'; rememberUI(); buildRail(); drawStage(); buildInspector();
  }

  function selectSlide(id, { rebuildRail = false } = {}) {
    layerAliases.clear();
    const wasAll = state.ui.allScreens; state.ui.allScreens = false;
    allScreens.setAttribute('aria-pressed', 'false');
    if (wasAll) { ed.selectedIds.clear(); ed.selectedId = null; ed.scene = null; zoom.value = 'fit'; }
    if (id !== state.ui.slideId) { ed.selectedIds.clear(); ed.selectedId = null; ed.editTemplateId = null; ed.scene = null; }
    ed.inspectorStale = true; // describes the picture that is about to be drawn
    state.ui.slideId = id;
    rememberUI();
    if (rebuildRail || wasAll) buildRail();
    for (const card of railList.children) card.setAttribute('aria-selected', String(card.dataset.id === id));
    railList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    drawStage();
    buildInspector();
  }

  // ---------------------------------------------------------------------------------------------
  // stage

  function updateNeighborControls() {
    const prefs = neighborPreferences(state.ui);
    const visible = prefs.visible && !ed.editTemplateId && !state.ui.allScreens;
    neighborControls.hidden = Boolean(state.ui.allScreens);
    neighborToggle.setAttribute('aria-pressed', String(prefs.visible));
    neighborToggle.disabled = Boolean(ed.editTemplateId);
    opacityControl.hidden = !visible;
    neighborOpacity.value = String(prefs.opacity);
    neighborOpacity.setAttribute('aria-valuetext', `${prefs.opacity}%`);
    opacityValue.textContent = `${prefs.opacity}%`;
    strip.classList.toggle('hide-neighbors', !visible);
    before.style.opacity = after.style.opacity = String(prefs.opacity / 100);
  }

  function fitWidth() {
    const rect = stageCanvas.getBoundingClientRect();
    const [W, H] = ed.device().size;
    const availW = Math.max(160, rect.width - 56 - (neighborPreferences(state.ui).visible && !ed.editTemplateId && !state.ui.allScreens ? 316 : 0));
    const availH = Math.max(160, rect.height - 40);
    return Math.floor(Math.min(availW, (availH * W) / H));
  }

  function setZoom(value, point, gesture = false) {
    if (stageApi.dragging || !currentSlide()) return;
    clearTimeout(zoomTimer);
    if (value === 'fit') {
      zoom.value = 'fit'; viewportX = viewportY = 0; positionViewport(); drawStage(); return;
    }
    const next = Math.max(.01, Math.min(2, Number(value)));
    if (!Number.isFinite(next)) return;
    const bounds = stageCanvas.getBoundingClientRect();
    point ??= { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    const anchor = pointInRect(point, canvas.getBoundingClientRect());
    customZoom.value = String(next); customZoom.textContent = `${Math.round(next * 1000) / 10}%`; customZoom.hidden = false;
    zoom.value = String(next);
    // Invalidate any older render before changing the CSS size. Reuse its bitmap
    // during the gesture; the expensive sharp render only runs after fingers stop.
    for (const target of [canvas, beforeCanvas, afterCanvas]) target._token = (target._token ?? 0) + 1;
    sizeStage(ed.device().size[0] * next);
    const rect = canvas.getBoundingClientRect();
    viewportX += point.x - rect.left - anchor.x * rect.width;
    viewportY += point.y - rect.top - anchor.y * rect.height;
    positionViewport(); stageApi.render();
    if (gesture) zoomTimer = setTimeout(() => { if (el.isConnected) drawStage(); }, 140);
    else drawStage();
  }

  function sizeStage(width) {
    ed.stageWidth = width;
    screenLabels.replaceChildren(); screenLabels.hidden = !state.ui.allScreens;
    if (state.ui.allScreens) {
      const geometry = sharedGeometry(engine.project, state.ui.device, state.ui.locale);
      for (const [i, tile] of geometry.tiles.entries()) screenLabels.append(h('button', { title: 'Edit this screen', onClick: () => selectSlide(tile.slide.id), style: { left: `${tile.x / geometry.W * 100}%`, width: `${tile.W / geometry.W * 100}%` } }, `${i + 1} · ${tile.slide.name ?? tile.slide.id}`));
    }
    const [W, H] = ed.device().size;
    canvas.style.width = `${width}px`; canvas.style.height = `${width * H / W}px`;
    const slide = currentSlide();
    strip.style.gap = sharedBlock(engine.project, state.ui.device).layers.length ? `${sharedGeometry(engine.project, state.ui.device, state.ui.locale).gap * width / canvasMetrics(canvasForSlide(engine.project, slide, state.ui.device)).W}px` : slide?.series ? `${width * slide.series.gap}px` : '';
    const neighbors = adjacentSlides(orderedSlides(engine.project, state.ui.locale), slide?.id);
    for (const [index, node, target] of [[0, before, beforeCanvas], [1, after, afterCanvas]]) {
      const size = neighbors[index] ? canvasForSlide(engine.project, neighbors[index], state.ui.device).size : [W, H];
      node.style.height = target.style.height = `${width * size[1] / size[0]}px`;
      target.style.width = `${width}px`;
    }
  }

  function drawStage() {
    const slide = currentSlide();
    if (!slide || stageApi.dragging) return;
    updateNeighborControls();
    orientationControl.replaceChildren(orientationPicker(slide, state.ui.device, () => {
      ed.scene = null; ed.refresh({ immediate: true, inspector: true, rail: true });
    }));
    orientationControl.hidden = Boolean(ed.editTemplateId || state.ui.allScreens);
    const dev = ed.device();
    const [W, H] = dev.size;
    const key = `${state.ui.allScreens ? "all" : slide.id}:${state.ui.device}:${W}:${H}:${ed.editTemplateId}`;
    if (key !== viewportKey) { viewportKey = key; viewportX = viewportY = 0; positionViewport(); }
    const width = zoom.value === 'fit' ? fitWidth() : W * Number(zoom.value);
    sizeStage(width);
    titleEl.textContent = state.ui.allScreens ? 'All screens' : ed.editTemplateId ? `Saved design · ${engine.project.templates?.[ed.editTemplateId]?.name ?? ''}` : slide.name ?? slide.id;
    metaEl.textContent = state.ui.allScreens ? `${engine.project.slides.length} screens · ${dev.label} · ${ed.locale().native}` : `${dev.label} · ${W} × ${H}px · ${ed.locale().native}`;
    const nextWarningContext = `${key}:${state.ui.locale}`;
    if (warningContext !== nextWarningContext) {
      warningContext = nextWarningContext;
      chipsEl.replaceChildren(); // Never open the previous screen's report while this one loads.
    }
    stage.classList.toggle('template-mode', Boolean(ed.editTemplateId));
    stage.classList.toggle('workspace-mode', Boolean(state.ui.allScreens));
    updateHistoryButtons();
    drawNeighbors();
    drawInto(canvas, { slideId: slide.id, deviceId: state.ui.device, localeId: state.ui.locale, width, priority: true, slide: ed.drawSlide(), allScreens: Boolean(state.ui.allScreens) });
  }

  function drawNeighbors() {
    const slide = currentSlide(), width = ed.stageWidth;
    if (!slide || !width) return;
    const [W, H] = ed.device().size;
    strip.style.gap = sharedBlock(engine.project, state.ui.device).layers.length ? `${sharedGeometry(engine.project, state.ui.device, state.ui.locale).gap * width / canvasMetrics(canvasForSlide(engine.project, slide, state.ui.device)).W}px` : slide.series ? `${width * slide.series.gap}px` : '';
    const neighbors = state.ui.allScreens || ed.editTemplateId || !neighborPreferences(state.ui).visible ? [null, null] : adjacentSlides(orderedSlides(engine.project, state.ui.locale), slide.id);
    for (const [index, node, target] of [[0, before, beforeCanvas], [1, after, afterCanvas]]) {
      const neighbor = neighbors[index];
      node.style.visibility = neighbor ? 'visible' : 'hidden';
      const neighborSize = neighbor ? canvasForSlide(engine.project, neighbor, state.ui.device).size : [W, H];
      node.style.height = `${width * neighborSize[1] / neighborSize[0]}px`;
      node.dataset.slideId = neighbor?.id ?? '';
      node.disabled = !neighbor || neighborPreferences(state.ui).opacity === 0;
      node.setAttribute('aria-label', `Edit ${index ? 'next' : 'previous'} screen · ${neighbor?.name ?? neighbor?.id ?? ''}`);
      node.title = 'Click to edit this screen';
      if (neighbor) drawInto(target, { slideId: neighbor.id, deviceId: state.ui.device, localeId: state.ui.locale, width });
      else target._token = (target._token ?? 0) + 1;
    }
  }

  /** Redraw synchronously with the images already loaded: what dragging needs. */
  function livePaint() {
    const prev = ed.scene;
    if (!prev) return;
    const scene = engine.scene(prev.slideId, prev.deviceId, prev.localeId, { ...(ed.drawSlide() ? { slide: ed.drawSlide() } : {}), allScreens: Boolean(state.ui.allScreens) });
    scene.assets = prev.assets;
    if (scene.allScreens && prev.allScreens) {
      for (const tile of scene.tiles) tile.scene.assets = prev.tiles.find(t => t.slide.id === tile.slide.id)?.scene.assets;
      scene.shared.assets = prev.shared.assets;
    }
    const report = engine.draw(canvas, scene, { scale: Math.max(0.02, (ed.stageWidth * pixelRatio()) / scene.W) });
    canvas.style.width = `${ed.stageWidth}px`;
    canvas.style.height = `${(ed.stageWidth * scene.H) / scene.W}px`;
    ed.scene = scene;
    updateChips(report);
    ed.panel?.updateGeometry?.();
    stageApi.render();
  }

  canvas.addEventListener('rendered', (e) => {
    const { scene, report } = e.detail;
    ed.scene = scene;
    if (ed.selectedId && !scene.allLayers.some((l) => l.id === ed.selectedId)) { ed.selectedId = null; ed.inspectorStale = true; }
    updateChips(report);
    // Warning controls can change the toolbar height on narrow windows. Fit against
    // that final geometry before exposing the rendered state or handling a gesture.
    if (zoom.value === 'fit' && Math.abs(ed.stageWidth - fitWidth()) > .5) drawStage();
    stageApi.render();
    if (ed.inspectorStale) { ed.inspectorStale = false; buildInspector(); } else ed.panel?.afterRender?.(scene);
  });

  function updateChips(report) {
    chipsEl.replaceChildren();
    if (ed.editTemplateId) {
      const n = templateUsage(engine.project, ed.editTemplateId).length;
      chipsEl.append(h('span', { class: 'chip info' }, `Editing saved design · affects ${n} slide${n === 1 ? '' : 's'}`), h('button', { class: 'btn small', onClick: () => ed.editTemplate(null) }, 'Done'));
    }
    const slide = currentSlide();
    if (!state.ui.allScreens && !ed.editTemplateId && ed.localeScope()) chipsEl.append(h('span', { class: 'chip info', title: 'Only this screen in this language has its own layout.' }, 'Unique design'));
    const issues = visibleWarnings(report);
    if (!issues.length) { if (!ed.editTemplateId) chipsEl.append(h('button', { class: 'chip ok', title: 'The preview rendered. Run export checks to verify text, images and output sizes.', onClick: () => ctx.openExport() }, 'Check export…')); return; }
    chipsEl.append(warningButton({ issues, name: state.ui.allScreens ? 'All screens' : slide.name ?? slide.id,
      context: `${ed.device().label} · ${ed.locale().native}`,
      onOverview: () => ctx.go({ view: 'overview' }),
    }));
  }

  // drag & drop images onto the stage: one zone replaces the screenshot, the other adds a graphic
  let zones = null;
  const hideZones = () => { zones?.remove(); zones = null; };
  function showZones() {
    if (zones) return;
    const zone = (title, note, onFiles) => {
      const z = h('div', { class: 'dropzone-big' }, h('b', null, title), h('span', null, note));
      z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
      z.addEventListener('dragleave', () => z.classList.remove('over'));
      z.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); hideZones(); const files = imageFilesOf(e.dataTransfer.files); if (files.length) onFiles(files); });
      return z;
    };
    zones = h('div', { class: 'dropzones' },
      !state.ui.allScreens ? zone('Screenshot', 'Replace the app screenshot on this slide', (files) => applyCapture(ed, files[0])) : null,
      zone('Image', 'Add as a graphic you can put in front of or behind the device', (files) => ed.addImage(files)));
    stageCanvas.append(zones);
  }
  stage.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); showZones(); } });
  stage.addEventListener('dragleave', (e) => { if (!stage.contains(e.relatedTarget)) hideZones(); });
  stage.addEventListener('drop', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); hideZones(); });

  const handlesClipboard = () => el.isConnected && !stageApi.dragging && !isTextEditing(document.activeElement) && !document.querySelector('.modal-backdrop');
  document.addEventListener('copy', e => {
    if (!handlesClipboard() || !e.clipboardData) return;
    const layers = ed.selectionLayers(); if (!layers.length) return;
    const entries = paintOrder(layers).map(layer => {
      const slideId = layer.copySlideId ?? layer._copySlideId ?? currentSlide().id;
      const text = {};
      if (layer.type === 'text') for (const [locale, doc] of Object.entries(engine.data.copy)) {
        if (doc[slideId]?.[layer.field] === undefined) continue;
        const pending = doc._meta?.needsReview ?? [];
        text[locale] = { value: doc[slideId][layer.field], needsReview: doc._meta?.status !== 'approved' || pending.includes('*') || pending.includes(`${slideId}.${layer.field}`) };
      }
      return { layer: ed.snapshot(layer), text };
    });
    const originX = sharedGeometry(engine.project, state.ui.device, state.ui.locale).tiles.find(t => t.slide.id === currentSlide().id)?.x ?? 0;
    const payload = encodeLayerClipboard(entries, { projectId: state.projectId, allScreens: Boolean(state.ui.allScreens), originX });
    e.clipboardData.setData(LAYER_CLIPBOARD_MIME, payload);
    e.clipboardData.setData('text/plain', payload);
    e.preventDefault(); lastPaste = ''; pasteCount = 0;
  });
  document.addEventListener('paste', (e) => {
    if (!handlesClipboard()) return;
    const payload = e.clipboardData?.getData(LAYER_CLIPBOARD_MIME) || e.clipboardData?.getData('text/plain');
    const objects = decodeLayerClipboard(payload);
    if (objects) {
      e.preventDefault();
      if (objects.projectId !== state.projectId) { toast('These objects belong to another project. Open that project to paste them with their images.'); return; }
      const all = Boolean(state.ui.allScreens);
      const targetX = sharedGeometry(engine.project, state.ui.device, state.ui.locale).tiles.find(t => t.slide.id === currentSlide().id)?.x ?? 0;
      pasteCount = lastPaste === payload ? pasteCount + 1 : 1; lastPaste = payload;
      const nudge = 24 * pasteCount;
      let dx = nudge + (all && !objects.allScreens ? objects.originX : !all && objects.allScreens ? -targetX : 0);
      // A copy from another part of the row should still be reachable on the destination screen.
      const left = Math.min(...objects.entries.map(e => e.layer.x ?? (e.layer.cx ?? 0) - (e.layer.w ?? 0) / 2));
      if (!all && (left + dx > ed.scene.W || left + dx < -ed.scene.W)) dx = 24 - left;
      checkpoint(null, { copyLocales: Object.keys(engine.data.copy) });
      const slideIds = [...new Set([currentSlide().id, ...(ed.editTemplateId ? templateUsage(engine.project, ed.editTemplateId) : [])])];
      const result = pasteLayerClipboard(objects, { block: ed.block(), resolved: ed.scene.allLayers, copy: engine.data.copy, slideIds, shared: all, dx, dy: nudge });
      const ids = result.layers.map(l => all ? sharedLayerId(l.id) : l.id);
      ed.selectedIds = new Set(ids); ed.selectedId = ids.at(-1);
      result.changedLocales.forEach(locale => saveCopy(locale)); saveStudio();
      ed.refresh({ immediate: true, inspector: true, rail: true }); return;
    }
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    if (state.ui.allScreens) ed.addImage([item.getAsFile()]); else applyCapture(ed, item.getAsFile());
  });

  // ---------------------------------------------------------------------------------------------
  // inspector

  function buildInspector() {
    inspectorMemory.capture(inspectorKey, ed.panel?.el);
    const current = TABS.some(([id]) => id === state.ui.tab) ? state.ui.tab : 'details';
    state.ui.tab = current;
    inspectorKey = JSON.stringify([state.projectId, state.ui.slideId, state.ui.device, state.ui.locale, current, ed.editTemplateId, current === 'layers' || current === 'details' ? [...ed.selectedIds].sort() : null]);
    const panel = state.ui.allScreens && current === 'design' ? sharedDesignPanel() : BUILDERS[current](ed);
    ed.panel = panel;
    inspector.replaceChildren(
      h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(id === current), onClick: () => ed.setTab(id) }, label))),
      layoutScopeControls(),
      panel.el,
    );
    if (ed.scene) panel.afterRender?.(ed.scene);
    inspectorMemory.restore(inspectorKey, panel.el);
  }

  function sharedDesignPanel() {
    const deviceId = state.ui.device;
    const canvasWidth = engine.project.devices[deviceId].size[0];
    const pixels = gap => Math.round(gap * canvasWidth * 10) / 10;
    const apply = (preset, gap) => {
      if (!Number.isFinite(gap) || gap < 0 || gap > 1) { update(); return; }
      const current = sharedSpacing(engine.project, deviceId);
      if (current.preset !== preset || current.gap !== gap) {
        checkpoint('shared-gap'); setSharedSpacing(engine.project, deviceId, preset, gap);
        saveStudio(); ed.refresh({ immediate: true, rail: true });
      }
      update();
    };
    const presets = selectInput({ options: [...SCREEN_SPACING_PRESETS.map(p => [p.id, `${p.label} · ${pixels(p.gap)} px`]), ['custom', 'Custom']],
      value: sharedSpacing(engine.project, deviceId).preset, title: 'Screen spacing preset', onChange: preset => {
        apply(preset, SCREEN_SPACING_PRESETS.find(p => p.id === preset)?.gap ?? sharedSpacing(engine.project, deviceId).gap);
      } });
    presets.setAttribute('aria-label', 'Screen spacing preset');
    const slider = h('input', { type: 'range', min: 0, max: canvasWidth, step: .1, 'aria-label': 'Custom screen spacing in pixels', onInput: e => apply('custom', Number(e.target.value) / canvasWidth) });
    const amount = h('input', { class: 'input', type: 'number', min: 0, max: canvasWidth, step: .1, 'aria-label': 'Screen spacing pixels', onChange: e => apply('custom', e.target.value === '' ? NaN : Number(e.target.value) / canvasWidth) });
    const custom = h('div', { class: 'screen-spacing-custom' }, slider, h('label', { class: 'row' }, amount, 'px'));
    const detail = h('p', { class: 'hint' });
    function update() {
      const { gap, preset } = sharedSpacing(engine.project, deviceId), distance = pixels(gap);
      presets.value = preset; custom.hidden = preset !== 'custom';
      slider.max = Math.min(canvasWidth, Math.max(Math.round(canvasWidth * .3), Math.ceil(distance / 10) * 10)); slider.value = distance; amount.value = distance;
      detail.textContent = `${distance} px at the exported screenshot size. Presets approximate store spacing, which varies by device and placement. Each PNG excludes the gap.`;
    }
    update();
    return { el: h('div', { class: 'panel' }, h('h3', null, 'Shared canvas'),
      h('p', { class: 'hint' }, 'Add images, devices, text and shapes across the whole row. Shared objects appear on every screen they overlap and stay linked when edited inside a screen.'),
      h('label', { class: 'field' }, 'Space between screens', presets), custom, detail) };
  }

  function layoutScopeControls() {
    if (state.ui.allScreens) return h('div', { class: 'layout-scope shared-scope' }, h('b', null, 'Editing all screens'), h('div', { class: 'hint' }, 'Objects can continue across screens by default. Use Screen edges in Details to keep an object on one screen.'));
    if (ed.layerById(ed.selectedId)?._sharedId) return h('div', { class: 'layout-scope shared-scope' }, h('b', null, 'Shared object'), h('div', { class: 'hint' }, 'Edits update every screen this object overlaps.'), h('button', { class: 'btn small', onClick: selectAllScreens }, 'Open all screens'));
    const slide = currentSlide(), project = engine.project, deviceId = state.ui.device, localeId = state.ui.locale;
    const unique = Boolean(slide.localeLayouts?.[localeId]?.[deviceId]?.independent);
    return h('div', { class: 'layout-scope' }, h('label', { class: 'scope-check', title: 'Give only this screen in the selected language its own layout.' },
      h('input', { type: 'checkbox', checked: unique, disabled: Boolean(ed.editTemplateId), onChange: async e => {
        const enabled = e.target.checked;
        if (!enabled && !(await confirmDialog({ title: 'Use the shared design again?', body: 'Unique layout changes for this canvas and language will be discarded. Text translations and colours are kept. You can undo this change.', confirmLabel: 'Use shared design' }))) { e.target.checked = true; return; }
        if (engine.project !== project || currentSlide() !== slide || state.ui.device !== deviceId || state.ui.locale !== localeId) return;
        checkpoint();
        setLayoutIndependent(project, slide, deviceId, enabled, localeId);
        ed.editTemplateId = null; saveStudio(); ed.refresh({ immediate: true, inspector: true });
      } }), h('span', null, h('b', null, 'Unique design'), h('small', null, 'This screen and language only.'))));
  }

  // ---------------------------------------------------------------------------------------------
  // keyboard (the studio shell forwards keys here first)

  function handleKey(e) {
    if (!el.isConnected) return false;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return true; }
    if (mod && key === 'a') { e.preventDefault(); ed.selectedIds = new Set(ed.scene?.layers.filter(l => l._box && !l.locked).map(l => l.id)); ed.selectedId = [...ed.selectedIds].at(-1) ?? null; ed.setTab('layers'); stageApi.render(); return true; }
    if (mod && key === 'g') { e.preventDefault(); ed.groupSelection(e.shiftKey); return true; }
    if (mod && key === 'y') { e.preventDefault(); doRedo(); return true; }
    if (e.key === 'Escape' && stageApi.dragging) { e.preventDefault(); stageApi.cancelDrag(); doUndo(); return true; } // abandon the drag: back to where it started
    const layer = ed.layerById(ed.selectedId);
    const create = creationShortcut(e);
    if (create) { e.preventDefault(); if (create === 'image') ed.addImage(); else if (['rect', 'ellipse'].includes(create)) ed.addLayer('shape', { shape: create }); else ed.addLayer(create); return true; }
    if (!mod && !e.altKey && (e.key === 'Enter' || e.key === 'F2') && layer) { e.preventDefault(); ed.renameLayer(layer.id); return true; }
    if (mod && e.shiftKey && ['h', 'l'].includes(key) && layer) { e.preventDefault(); ed.setLayer(layer, key === 'h' ? { hidden: !layer.hidden } : { locked: !layer.locked }, { rebuild: true }); return true; }
    if (!mod && !e.altKey && ['0', '+', '=', '-'].includes(e.key)) {
      e.preventDefault();
      setZoom(e.key === '0' ? 'fit' : ed.stageWidth / ed.device().size[0] * (e.key === '-' ? 1 / 1.15 : 1.15)); return true;
    }
    if (mod && key === 'd' && layer) { e.preventDefault(); ed.duplicateSelection(); return true; }
    if (mod && (['[', ']', '{', '}'].includes(e.key) || ['BracketLeft', 'BracketRight'].includes(e.code)) && layer) {
      e.preventDefault();
      const forward = ['BracketRight'].includes(e.code) || [']', '}'].includes(e.key);
      ed.restack((block) => e.shiftKey ? moveLayerTo(block, ed.scene.allLayers, layer.id, forward ? ed.scene.allLayers.length : 0) : stepLayer(block, ed.scene.allLayers, layer.id, forward ? 1 : -1));
      return true;
    }
    if (!mod && e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key) && layer) {
      e.preventDefault(); const forward = e.key === 'ArrowUp';
      ed.restack(block => e.shiftKey ? moveLayerTo(block, ed.scene.allLayers, layer.id, forward ? ed.scene.allLayers.length : 0) : stepLayer(block, ed.scene.allLayers, layer.id, forward ? 1 : -1));
      return true;
    }
    if (mod || e.altKey || !layer) return false;
    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key] && layer._box) { e.preventDefault(); stageApi.nudge(...arrows[e.key]); ed.panel?.updateGeometry?.(); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ed.removeSelection(); return true; }
    if (e.key === 'Escape') { stageApi.cancelDrag(); ed.select(null); return true; }
    return false;
  }

  on('captures-changed', () => { if (el.isConnected) ed.afterCaptureChange(); });

  // ---------------------------------------------------------------------------------------------

  return {
    el,
    ed,
    build() {
      layerAliases.clear();
      ed.scene = null; ed.selectedIds.clear(); ed.selectedId = null;
      canvas._token = (canvas._token ?? 0) + 1;
      chipsEl.replaceChildren();
      ed.inspectorStale = true;
      buildRail();
      buildInspector();
      updateHistoryButtons();
    },
    /** Called once the element is attached, when real sizes are available. */
    activate() { drawStage(); },
    refresh() { drawStage(); },
    onResize() { if (el.isConnected) drawStage(); },
    selectSlide,
    newSeries,
    handleKey,
    undo: doUndo,
    redo: doRedo,
    editTemplate(id, slideId = null) {
      if (slideId) state.ui.slideId = slideId;
      ed.editTemplate(id);
    },
    focusFirstField() { inspector.querySelector('textarea')?.focus(); },
    afterCapturesChanged: () => ed.afterCaptureChange(),
    afterCopyChanged() {
      // an edit from another window / the file system: redraw everything, keep any focused field as is
      drawStage();
      buildRail();
      if (!inspector.contains(document.activeElement)) buildInspector();
    },
  };
}
