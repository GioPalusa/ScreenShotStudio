import { sharedGeometry, sharedLayers, offsetLayer, boxIntersects } from './shared-canvas.js';
import { canvasForSlide } from './canvas-orientation.js';
// The rendering engine. One code path produces the live preview, the thumbnails and the exported
// PNGs, so what you see in the studio is exactly what gets exported.
//
//   const engine = new Engine();
//   engine.setData(bundle);                        // studio.json + copy + frame metadata + capture index
//   const scene = engine.scene(slideId, deviceId, localeId);
//   await engine.render(canvas, scene, { scale });  // draws, returns { warnings, texts }
//
// Layers are painted back to front by their stacking value (see layerZ in layouts.js). After a draw,
// every layer that can be moved on the stage carries `_box` = { x, y, w, h, rot }: its unrotated box in
// design pixels, rotated by `rot` degrees about the box centre.

import { decorationBounds } from './decorations.js';
import { deviceForLayer } from './profiles.js';
import { captureSourceFor } from './media.js';
import { originalLocale } from './copy-review.js';
import { layoutText, drawLines, capHeight, textOverflowMessage } from './text.js';
import { composeBezel, composeDuo, composeAndroid, composeGeneric, composePlain, fitCapture, buildHoleMask } from './devices.js';
import { resolveLayers, paintOrder } from './layouts.js';
import { frameKey, frameScreenSize, DEFAULT_FRAME } from './frames.js';
import { analyzeFrameData } from './measure.js';

const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');

const KEEP_WARNINGS = new Set(['frame-missing', 'asset-missing']);
const rad = (deg) => ((deg ?? 0) * Math.PI) / 180;

/** "#rrggbb" + alpha -> "rgba(...)" */
export function withAlpha(hex, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return hex ?? '#000';
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export class Engine {
  constructor() {
    this.data = { studio: null, copy: {}, frames: {}, captures: {}, assets: { art: [] } };
    this.assetVersion = 0; this.projectURL = '/project';
    this.images = new Map();
    this.deviceCache = new Map(); // small LRU of composed device canvases
    this.frameCache = new Map();  // frame name -> { image, meta } with the corner radius filled in
  }

  setData(bundle) {
    this.data = { ...this.data, ...bundle };
  }

  /** Forget cached images (called when files change on disk). */
  invalidate({ assets = true } = {}) {
    if (assets) { this.assetVersion++; this.images.clear(); this.frameCache.clear(); }
    this.deviceCache.clear();
  }

  get project() { return this.data.studio; }

  localeInfo(localeId) {
    return this.project.locales.find((l) => l.id === localeId) ?? this.project.locales[0];
  }

  /** Font for a language: the project default, then fonts.byLang (base language, then full tag), then the language's own `font`. */
  fontsFor(localeId) {
    const locale = this.localeInfo(localeId);
    const lang = locale.lang ?? 'en';
    const f = this.project.fonts ?? {};
    return { ...(f.default ?? {}), ...(f.byLang?.[lang.split('-')[0]] ?? {}), ...(f.byLang?.[lang] ?? {}), ...(locale.font ?? {}) };
  }

  /** Missing translations display the original copy, then legacy English copy. */
  copyFor(localeId, slideId, field) {
    const get = (loc) => this.data.copy[loc]?.[slideId]?.[field];
    const filled = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.every((x) => !String(x).trim()));
    const own = get(localeId);
    if (filled(own)) return { value: own, fallback: false };
    for (const source of new Set([originalLocale(this.project), 'en-US'])) {
      const value = get(source);
      if (source !== localeId && filled(value)) return { value, fallback: true };
    }
    return null;
  }

  captureSource(localeId, deviceDef, name, layer = {}) {
    if (!name) return null;
    const set = deviceForLayer(this.project, deviceDef, layer).capture;
    const hit = captureSourceFor(this.project, this.data.captures, localeId, set, name);
    if (!hit) return { missing: true, name, set };
    const { scope, localized } = hit;
    return { url: `${this.projectURL}/captures/${scope}/${set}/${hit.file}?v=${hit.mtime}`, scope, name, set, localized };
  }

  /** The frame a device layer is drawn in: the layer's own choice, else the device's default. */
  frameRefFor(deviceDef, layer) {
    return layer?.frame ?? deviceForLayer(this.project, deviceDef, layer ?? {}, this.data.frames).frame ?? DEFAULT_FRAME;
  }

  /** Pixel size a screenshot should have to fill the screen of a device's frame (or of one layer's frame) exactly. */
  expectedCaptureSize(deviceDef, layer = null) {
    return frameScreenSize(this.frameRefFor(deviceDef, layer), { frames: this.data.frames, deviceSize: deviceForLayer(this.project, deviceDef, layer ?? {}).size });
  }

  // ----- scene resolution ---------------------------------------------------------------------

  /** `options.slide` renders a slide object that is not (yet) in the project - template previews, template editing. */
  scene(slideId, deviceId, localeId, options = {}) {
    if (options.allScreens) return this.workspaceScene(deviceId, localeId);
    const project = this.project;
    const slide = options.slide ?? project.slides.find((s) => s.id === slideId);
    const deviceDef = canvasForSlide(project, slide, deviceId);
    if (!slide || !deviceDef) throw new Error(`Unknown slide/device: ${slideId} / ${deviceId}`);
    const { layers: allLayers, layout, W, H, k, cls } = resolveLayers({ project, slide, deviceId, localeId, includeShared: options.includeShared !== false && !options.slide });
    const layers = allLayers.filter((l) => !l.hidden);
    const theme = { ...(project.themes[slide.theme] ?? { bg: '#333', ink: '#fff' }), ...(slide.colors ?? {}) };
    const locale = this.localeInfo(localeId);
    return { slideId: slide.id, deviceId, localeId, slide, deviceDef, layout, allLayers, layers, W, H, k, cls, theme, locale, fonts: this.fontsFor(localeId), warnings: [], texts: {} };
  }

  workspaceScene(deviceId, localeId) {
    const geometry = sharedGeometry(this.project, deviceId, localeId);
    const tiles = geometry.tiles.map(tile => ({ ...tile, scene: this.scene(tile.slide.id, deviceId, localeId) }));
    const first = tiles[0].scene;
    const allLayers = sharedLayers(this.project, deviceId, localeId);
    const shared = { ...first, ...geometry, tiles: undefined, allLayers, layers: allLayers.filter(l => !l.hidden), warnings: [], texts: {}, transparent: true };
    return { ...first, ...geometry, deviceDef: { ...first.deviceDef, size: [geometry.W * geometry.k, geometry.H * geometry.k] },
      tiles, shared, allScreens: true, allLayers: [], layers: [], warnings: [], texts: {} };
  }

  drawWorkspace(canvas, scene, options) {
    const scale = options.size ? options.size[0] / scene.W : options.scale ?? 1;
    canvas.width = Math.max(1, Math.round(scene.W * scale)); canvas.height = Math.max(1, Math.round(scene.H * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#24252a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    scene.allLayers = []; scene.layers = []; scene.warnings = []; scene.texts = {};
    const sharedCanvas = document.createElement('canvas');
    // Measure the complete shared objects for editing, but show only their exported pieces.
    // Keeping the store gaps empty makes the working preview match the separated PNGs.
    this.draw(sharedCanvas, scene.shared, { scale });
    for (const tile of scene.tiles) {
      const target = document.createElement('canvas');
      this.draw(target, tile.scene, { scale });
      ctx.drawImage(target, tile.x * scale, 0);
      for (const layer of tile.scene.allLayers.filter(l => !l._sharedId)) {
        const proxy = { ...offsetLayer(layer, tile.x), id: `screen:${tile.slide.id}:${layer.id}`,
          _sourceSlideId: tile.slide.id, _sourceLayerId: layer.id, _offsetX: tile.x,
          _clip: { x: tile.x, y: 0, w: tile.W, h: tile.H }, _copySlideId: tile.slide.id };
        if (proxy.group) proxy.group = `${tile.slide.id}:${proxy.group}`;
        scene.allLayers.push(proxy); if (!proxy.hidden) scene.layers.push(proxy);
      }
      scene.warnings.push(...tile.scene.warnings.map(w => ({ ...w, message: `${tile.slide.name ?? tile.slide.id}: ${w.message}` })));
      Object.assign(scene.texts, Object.fromEntries(Object.entries(tile.scene.texts).map(([id, value]) => [`${tile.slide.id}:${id}`, value])));
    }
    scene.allLayers.push(...scene.shared.allLayers); scene.layers.push(...scene.shared.layers);
    Object.assign(scene.texts, scene.shared.texts);
    return { warnings: scene.warnings, texts: scene.texts };
  }

  // ----- images ---------------------------------------------------------------------------------

  loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (!this.images.has(url)) {
      this.images.set(url, new Promise((resolve) => {
        const img = new Image();
        // decode() can wait for a paint, which never comes while the page is hidden: don't let that stall a render or an export
        img.onload = async () => { try { await Promise.race([img.decode(), new Promise((r) => setTimeout(r, 400))]); } catch { /* already usable */ } resolve(img); };
        img.onerror = () => resolve(null);
        img.src = url;
      }));
    }
    return this.images.get(url);
  }

  /** URL of a file under project/assets. A name without an extension is a PNG (older projects store "globe"). */
  assetUrl(kind, name, ext = 'png') {
    const file = /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${ext}`;
    return `${this.projectURL}/assets/${kind}/${file}?v=${this.assetVersion}`;
  }

  /** Which image an art layer shows in a language: its own version for that language, else the shared one. */
  artSource(layer, locale) {
    const v = layer.variants;
    if (v) {
      const lang = locale.lang ?? '';
      return v[locale.id] ?? v[lang] ?? v[lang.split('-')[0]] ?? layer.src;
    }
    return layer.src;
  }

  /**
   * A bezel frame: its image and metadata, plus what is measured from the image - the corner radius (when the metadata has
   * none) and, for cut-out screens, the exact shape of the hole (used for the black glass under the screenshot).
   */
  async loadFrame(name) {
    if (!this.frameCache.has(name)) {
      this.frameCache.set(name, (async () => {
        const meta = this.data.frames[name];
        const image = meta ? await this.loadImage(this.assetUrl('frames', name)) : null;
        if (!image || !meta) return { image: null, meta: null };
        const effective = { ...meta, screen: { mode: 'hole', ...meta.screen } };
        let holeMask = null;
        try {
          const c = document.createElement('canvas');
          c.width = image.naturalWidth;
          c.height = image.naturalHeight;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(image, 0, 0);
          const found = analyzeFrameData(g.getImageData(0, 0, c.width, c.height));
          if (effective.screen.radius === undefined) effective.screen.radius = found.meta.screen.radius;
          // the mask belongs to the screen the file declares: only trust it when it is the same place
          const s = effective.screen;
          const same = Math.abs(found.meta.screen.x - s.x) <= 2 && Math.abs(found.meta.screen.y - s.y) <= 2 && Math.abs(found.meta.screen.w - s.w) <= 4 && Math.abs(found.meta.screen.h - s.h) <= 4;
          if (effective.screen.mode === 'hole' && found.meta.screen.mode === 'hole' && same) holeMask = buildHoleMask(found.mask, c.width, c.height);
        } catch { if (effective.screen.radius === undefined) effective.screen.radius = 0; }
        return { image, meta: effective, holeMask };
      })());
    }
    return this.frameCache.get(name);
  }

  /** Load everything a scene needs so that drawing can be synchronous. */
  async prepare(scene) {
    if (scene.allScreens) {
      for (const tile of scene.tiles) await this.prepare(tile.scene);
      await this.prepare(scene.shared);
      scene.assets = {}; return scene.assets;
    }
    const assets = { captures: {}, frames: {}, art: {} };
    scene.warnings = scene.warnings.filter((w) => !KEEP_WARNINGS.has(w.code));
    for (const layer of scene.layers) {
      if (layer.type === 'device') {
        const ref = this.frameRefFor(scene.deviceDef, layer);
        const key = frameKey(ref);
        if (ref.type === 'bezel' && !assets.frames[key]) {
          assets.frames[key] = await this.loadFrame(ref.name);
          if (!assets.frames[key].image) scene.warnings.push({ level: 'error', code: 'frame-missing', layer: layer.id, message: `Frame “${ref.name}” is missing (project/assets/frames/${ref.name}.png + .json)` });
        }
        const src = this.captureSource(scene.localeId, scene.deviceDef, layer.capture, layer);
        assets.captures[layer.id] = src;
        if (src?.url) src.image = await this.loadImage(src.url);
        if (src?.url && !src.image) { src.missing = true; }
      } else if (layer.type === 'art' && layer.src) {
        const file = this.artSource(layer, scene.locale);
        assets.art[layer.id] = await this.loadImage(this.assetUrl('art', file));
        if (!assets.art[layer.id] && layer.panoramaOffset === undefined) scene.warnings.push({ level: 'error', code: 'asset-missing', layer: layer.id, message: `Image “${file}” is missing (project/assets/art/)` });
      }
    }
    scene.assets = assets;
    return assets;
  }

  // ----- drawing ----------------------------------------------------------------------------------

  async render(canvas, scene, options = {}) {
    await this.prepare(scene);
    return this.draw(canvas, scene, options);
  }

  /** `scale` sizes the canvas relative to the design size; `size: [w, h]` forces exact output pixels. */
  draw(canvas, scene, { scale = 1, size = null } = {}) {
    if (scene.allScreens) return this.drawWorkspace(canvas, scene, { scale, size });
    const { W, H, theme, layers, locale } = scene;
    scene.warnings = scene.warnings.filter((w) => KEEP_WARNINGS.has(w.code));
    scene.texts = {};
    canvas.width = size ? size[0] : Math.max(1, Math.round(W * scale));
    canvas.height = size ? size[1] : Math.max(1, Math.round(H * scale));
    scene.px = canvas.width / W; // output pixels per design pixel: shadows and blurs are not scaled by the canvas transform
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    ctx.save();
    ctx.scale(canvas.width / W, canvas.height / H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // background
    if (theme.bg2) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, theme.bg);
      g.addColorStop(1, theme.bg2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = theme.bg;
    if (!scene.transparent) ctx.fillRect(0, 0, W, H);

    // pass 1: lay out text so flow references (after: "headline") and devices can use the metrics
    const metrics = {};
    for (const layer of layers) if (layer.type === 'text') this.layoutTextLayer(scene, layer, metrics);
    for (const layer of layers) {
      if (layer.type !== 'device') continue;
      layer._top = this.resolvePosition(layer.top ?? 0, metrics, 'bottom');
    }

    // pass 2: paint back to front
    for (const l of paintOrder(layers)) {
      ctx.save();
      if (l.type === 'route') this.drawRoute(ctx, scene, l);
      else if (l.type === 'art') this.drawArt(ctx, scene, l);
      else if (l.type === 'shape') this.drawShape(ctx, scene, l);
      else if (l.type === 'device') this.drawDevice(ctx, scene, l);
      else if (l.type === 'text') this.drawTextLayer(ctx, scene, l);
      ctx.restore();
    }
    ctx.restore();

    // report
    for (const [id, t] of Object.entries(scene.texts)) {
      if (t.fallback) scene.warnings.push({ level: 'warn', code: 'missing-translation', layer: id, message: `No ${locale.name} text for “${t.field}” - showing original text` });
      if (t.overflow) scene.warnings.push({ level: 'error', code: 'overflow', layer: id, message: `“${t.field}”: ${textOverflowMessage(t.overflowReasons)}` });
      else if (t.shrink / t.baseShrink < 0.85) scene.warnings.push({ level: 'warn', code: 'shrunk', layer: id, message: `“${t.field}” is ${Math.round((1 - t.shrink / t.baseShrink) * 100)}% smaller than the English version to fit - consider shorter text` });
    }
    // Shared objects outside this tile belong to another export, not this tile's preflight.
    if (!scene.transparent) {
      const outside = new Set(layers.filter(l => l._sharedId && !boxIntersects(l._box, W, H)).map(l => l.id));
      scene.layers = layers.filter(l => !outside.has(l.id));
      scene.allLayers = scene.allLayers.filter(l => !outside.has(l.id));
      scene.warnings = scene.warnings.filter(w => !outside.has(w.layer));
      for (const id of outside) delete scene.texts[id];
    }
    return { warnings: scene.warnings, texts: scene.texts };
  }

  /** number | { after: id | [ids], gap, min } -> number */
  resolvePosition(pos, metrics, edge = 'bottom') {
    if (typeof pos === 'number') return pos;
    if (!pos || typeof pos !== 'object') return 0;
    const ids = Array.isArray(pos.after) ? pos.after : [pos.after];
    const hit = ids.map((id) => metrics[id]).find(Boolean);
    const base = hit ? hit[edge] + (pos.gap ?? 0) : (pos.min ?? 0);
    return Math.max(base, pos.min ?? -Infinity);
  }

  /** ctx shadow settings from a layer's { color, blur, dx, dy } in design pixels. */
  applyShadow(ctx, scene, shadow, fallback = {}) {
    if (!shadow) return;
    const px = scene.px ?? 1;
    const color = shadow.color ?? fallback.color;
    ctx.shadowColor = color === undefined ? withAlpha('#000000', shadow.alpha ?? 0.3) : shadow.alpha !== undefined ? withAlpha(color, shadow.alpha) : color;
    ctx.shadowBlur = (shadow.blur ?? fallback.blur ?? 60) * px;
    ctx.shadowOffsetX = (shadow.dx ?? 0) * px;
    ctx.shadowOffsetY = (shadow.dy ?? fallback.dy ?? 30) * px;
  }

  /** How much the English text had to shrink in this layer: the design's own baseline for "fits well". */
  englishShrink(layer, text, lineHeight) {
    const key = JSON.stringify([text, layer.size, layer.minSize, layer.maxLines, layer.w, layer.weight, layer.lineHeight, layer.oneLine, layer.marker, layer.balanced, layer.maxHeight, layer.boxHeight, layer.fontFamily, layer.textFit]);
    this.baseCache ??= new Map();
    if (!this.baseCache.has(key)) {
      const fonts = this.fontsFor('en-US');
      const list = Array.isArray(text);
      const result = layoutText(measureCtx, text, {
        family: layer.fontFamily || fonts.family, weight: layer.weight ?? 700, size: layer.size, minSize: layer.minSize, maxLines: layer.maxLines, fitFrame: layer.textFit === 'frame',
        boxW: layer.w, lang: 'en-US', dir: 'ltr', lineHeight, marker: list ? (layer.marker ?? '-') : (layer.marker ?? ''),
        itemGap: layer.itemGap ?? 0, balanced: layer.balanced !== false, oneLine: layer.oneLine ?? 0, maxHeight: layer.boxHeight ?? layer.maxHeight ?? Infinity, heightIncludesGlyphs: layer.boxHeight !== undefined,
      });
      this.baseCache.set(key, result.overflow ? 1 : result.shrink);
      if (this.baseCache.size > 400) this.baseCache.delete(this.baseCache.keys().next().value);
    }
    return this.baseCache.get(key);
  }

  layoutTextLayer(scene, layer, metrics) {
    const copy = this.copyFor(scene.localeId, layer.copySlideId ?? scene.slideId, layer.field);
    const { fonts, locale } = scene;
    if (!copy) {
      // No text yet (a new text layer): keep a box so it can still be found, moved and sized on the stage.
      // (it takes no part in flow positions: a layer with nothing to show must not push the device down)
      const size = layer.size ?? 100;
      const top = (layer.anchor ?? 'top') === 'bottom' ? layer.baseline - (layer.boxHeight ?? size) : this.resolvePosition(layer.capTop ?? 0, metrics, 'bottom');
      layer._empty = true;
      layer._layout = null;
      layer._box = { x: layer.x, y: top, w: layer.w, h: layer.boxHeight ?? size, rot: layer.rotate ?? 0 };
      return;
    }
    const list = Array.isArray(copy.value);
    const lineHeight = (layer.lineHeight ?? 1.2) * (fonts.lineHeight ?? 1);
    // Placeholder copy uses its source language's line-breaking rules.
    const original = originalLocale(this.project);
    const originalCopy = this.data.copy[original]?.[layer.copySlideId ?? scene.slideId]?.[layer.field];
    const textLocale = copy.fallback ? (originalCopy === copy.value ? this.localeInfo(original) : { lang: 'en-US', dir: 'ltr' }) : locale;
    const textLang = textLocale.lang;
    layer._lang = textLang;
    layer._dir = textLocale.dir ?? 'ltr';
    const layout = layoutText(measureCtx, copy.value, {
      family: layer.fontFamily || fonts.family, weight: layer.weight ?? 700, size: layer.size, minSize: layer.minSize, maxLines: layer.maxLines, fitFrame: layer.textFit === 'frame',
      boxW: layer.w, lang: textLang, dir: layer._dir, lineHeight,
      marker: list ? (layer.marker ?? '-') : (layer.marker ?? ''), itemGap: layer.itemGap ?? 0, balanced: layer.balanced !== false, oneLine: layer.oneLine ?? 0, maxHeight: layer.boxHeight ?? layer.maxHeight ?? Infinity, heightIncludesGlyphs: layer.boxHeight !== undefined,
    });
    const cap = capHeight(measureCtx, { weight: layer.weight ?? 700, size: layout.size, family: layer.fontFamily || fonts.family });
    let firstBaseline;
    const fillFrame = layer.textFit === 'frame' && layer.boxHeight !== undefined;
    if ((layer.anchor ?? 'top') === 'bottom') firstBaseline = layer.baseline - layout.height - (fillFrame ? layout.descent : 0);
    else firstBaseline = this.resolvePosition(layer.capTop ?? 0, metrics, 'bottom') + (fillFrame ? layout.ascent : cap);
    layer._layout = layout;
    layer._empty = false;
    layer._baseline = firstBaseline;
    layer._copy = copy;
    metrics[layer.id] = { top: firstBaseline - (fillFrame ? layout.ascent : cap), bottom: firstBaseline + layout.height + (fillFrame ? layout.descent : 0) };
    layer._box = { x: layer.x, y: layer.anchor === 'bottom' && layer.boxHeight ? layer.baseline - layer.boxHeight : firstBaseline - (fillFrame ? layout.ascent : cap), w: layer.w, h: layer.boxHeight ?? layout.height + cap, rot: layer.rotate ?? 0 };
    let baseShrink = layout.shrink;
    if (scene.localeId !== 'en-US') {
      const en = this.copyFor('en-US', layer.copySlideId ?? scene.slideId, layer.field);
      if (en) baseShrink = this.englishShrink(layer, en.value, (layer.lineHeight ?? 1.2) * (this.fontsFor('en-US').lineHeight ?? 1));
    }
    scene.texts[layer.id] = { field: layer.field, copySlideId: layer.copySlideId ?? scene.slideId, size: layout.size, shrink: layout.shrink, baseShrink, lines: layout.lines.length, overflow: layout.overflow, overflowReasons: layout.overflowReasons, fallback: copy.fallback, width: layout.maxW, baseline: firstBaseline, lineTexts: layout.lines.map((l) => l.text) };
  }

  drawTextLayer(ctx, scene, layer) {
    if (!layer._layout) return;
    const px = scene.px ?? 1;
    const shadow = layer.shadow ? { color: layer.shadow.alpha !== undefined ? withAlpha(layer.shadow.color ?? '#000000', layer.shadow.alpha) : layer.shadow.color, blur: (layer.shadow.blur ?? 0) * px, dx: (layer.shadow.dx ?? 0) * px, dy: (layer.shadow.dy ?? 0) * px } : undefined;
    if (layer.rotate) { const b = layer._box; ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.rotate(rad(layer.rotate)); ctx.translate(-b.x - b.w / 2, -b.y - b.h / 2); }
    drawLines(ctx, layer._layout, {
      x: layer.x, w: layer.w, firstBaseline: layer._baseline, align: layer.align, block: layer.block,
      dir: layer._dir ?? scene.locale.dir ?? 'ltr', weight: layer.weight ?? 700, family: layer.fontFamily || scene.fonts.family, lang: layer._lang ?? scene.locale.lang,
      color: layer.color ?? scene.theme.ink, opacity: layer.opacity ?? 1, shadow, dx: layer.dx ?? 0,
    });
  }

  applyDecorationBox(ctx, layer, base) {
    layer._decorationBase = base;
    layer._box = { ...base, rot: 0, ...layer.decorationBox };
    if (!layer.decorationBox) return;
    const box = layer._box;
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.rotate(rad(box.rot));
    ctx.scale(box.w / base.w, box.h / base.h);
    ctx.translate(-base.x - base.w / 2, -base.y - base.h / 2);
  }

  drawRoute(ctx, scene, layer) {
    this.applyDecorationBox(ctx, layer, { x: 0, y: 0, w: scene.W, h: scene.H });
    if (layer.clip) { ctx.beginPath(); ctx.rect(...layer.clip.slice(0, 2), layer.clip[2] - layer.clip[0], layer.clip[3] - layer.clip[1]); ctx.clip(); }
    ctx.translate(-layer.dx * (layer.scale ?? 1), layer.dy ?? 0);
    ctx.scale(layer.scale ?? 1, layer.scale ?? 1);
    ctx.globalAlpha = layer.opacity ?? 0.52;
    ctx.strokeStyle = layer.color ?? '#ffffff';
    ctx.lineWidth = layer.width ?? 42;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(layer.dash ?? [79.78, 79.78]);
    ctx.stroke(new Path2D(layer.d));
  }

  /** An image layer (your own graphics) or a piece of the panorama (the globe). */
  drawArt(ctx, scene, layer) {
    const img = scene.assets?.art?.[layer.id];
    if (!img) {
      // keep a box for the stage so a missing image can still be found, moved or replaced
      if (layer.panoramaOffset === undefined && layer.w) layer._box = { x: layer.cx - layer.w / 2, y: layer.cy - (layer.h ?? layer.w) / 2, w: layer.w, h: layer.h ?? layer.w, rot: layer.rotate ?? 0 };
      return;
    }
    ctx.globalAlpha = layer.opacity ?? 1;
    if (layer.panoramaOffset !== undefined || layer.matrix) {
      this.applyDecorationBox(ctx, layer, decorationBounds(layer, img.naturalWidth, img.naturalHeight));
    }
    if (layer.panoramaOffset !== undefined) {
      ctx.translate(-layer.panoramaOffset * layer.panoramaScale, layer.panoramaDy);
      ctx.scale(layer.panoramaScale, layer.panoramaScale);
    }
    if (layer.matrix) {
      this.applyShadow(ctx, scene, layer.shadow, { blur: 40, dy: 20 });
      const [a, b, c, d, e, f] = layer.matrix;
      ctx.transform(a, b, c, d, e, f);
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
      return;
    }
    const natural = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    const aspect = layer.aspect ?? natural;
    layer._natural = aspect;
    const w = layer.w ?? img.naturalWidth;
    const h = layer.h ?? w / aspect;
    if (!layer._decorationBase) layer._box = { x: layer.cx - w / 2, y: layer.cy - h / 2, w, h, rot: layer.rotate ?? 0 };
    this.applyShadow(ctx, scene, layer.shadow, { blur: 40, dy: 20 });
    ctx.translate(layer.cx, layer.cy);
    ctx.rotate(rad(layer.rotate));
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    if (layer.mask === 'ellipse' || layer.mask === 'rounded') {
      ctx.beginPath();
      if (layer.mask === 'ellipse') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      else ctx.roundRect(-w / 2, -h / 2, w, h, Math.max(0, Math.min(layer.radius ?? 24, w / 2, h / 2)));
      ctx.clip();
    }
    if (layer.fit === 'cover' && img.naturalWidth) {
      ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
      ctx.drawImage(img, -w / 2 - (iw - w) * (layer.cropX ?? 0.5), -h / 2 - (ih - h) * (layer.cropY ?? 0.5), iw, ih);
      return;
    }
    // a language's own picture may have other proportions than the shared one: it sits inside the layer's box, undistorted
    const variant = layer.variants && this.artSource(layer, scene.locale) !== layer.src;
    if ((variant || layer.fit === 'contain') && img.naturalWidth) {
      const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      ctx.drawImage(img, (-img.naturalWidth * s) / 2, (-img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    } else ctx.drawImage(img, -w / 2, -h / 2, w, h);
  }

  /** A plain rectangle or ellipse: solid fill or gradient, optional outline and shadow. */
  drawShape(ctx, scene, layer) {
    const w = layer.w ?? 400;
    const h = layer.h ?? w;
    layer._box = { x: layer.cx - w / 2, y: layer.cy - h / 2, w, h, rot: layer.rotate ?? 0 };
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.translate(layer.cx, layer.cy);
    ctx.rotate(rad(layer.rotate));
    this.applyShadow(ctx, scene, layer.shadow, { blur: 40, dy: 20 });

    const path = new Path2D();
    if (layer.shape === 'ellipse') path.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else path.roundRect(-w / 2, -h / 2, w, h, Math.min(layer.radius ?? 0, w / 2, h / 2));

    const gr = layer.gradient;
    if (gr) {
      const c1 = withAlpha(gr.from ?? '#ffffff', gr.fromAlpha ?? 1);
      const c2 = withAlpha(gr.to ?? '#ffffff', gr.toAlpha ?? 0);
      let fill;
      if (gr.type === 'radial') {
        fill = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) / 2);
      } else {
        const a = rad(gr.angle ?? 180);
        const half = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2;
        fill = ctx.createLinearGradient(-Math.sin(a) * half, Math.cos(a) * half, Math.sin(a) * half, -Math.cos(a) * half);
      }
      fill.addColorStop(0, c1);
      fill.addColorStop(1, c2);
      ctx.fillStyle = fill;
    } else ctx.fillStyle = layer.fill ?? '#ffffff';
    ctx.fill(path);
    if (layer.stroke?.width) {
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = layer.stroke.width;
      ctx.strokeStyle = layer.stroke.color ?? '#ffffff';
      ctx.stroke(path);
    }
  }

  composedDevice(scene, layer) {
    const ref = this.frameRefFor(scene.deviceDef, layer);
    const device = deviceForLayer(this.project, scene.deviceDef, layer);
    const src = scene.assets.captures[layer.id];
    const capture = src?.image ?? null;
    const fit = layer.fit ?? 'fill';
    const align = layer.align ?? 'center';
    const radius = layer.radius ?? undefined;
    const captureSize = capture ? [capture.naturalWidth, capture.naturalHeight] : null;
    const key = [frameKey(ref), ref.radius ?? '', src?.url ?? `${device.capture}/${layer.capture ?? 'none'}`, fit, align, JSON.stringify(radius ?? null), ref.type === 'plain' ? JSON.stringify(ref.screen ?? captureSize ?? device.size) : '', this.assetVersion].join('|');
    if (this.deviceCache.has(key)) {
      const hit = this.deviceCache.get(key);
      this.deviceCache.delete(key); this.deviceCache.set(key, hit); // refresh LRU
      return hit;
    }
    const where = layer.capture ? `${device.label} · ${layer.capture}` : 'Select the device to choose a screenshot';
    const placeholder = [where];
    let composed;
    if (ref.type === 'bezel') {
      const { image, meta, holeMask } = scene.assets.frames[frameKey(ref)] ?? {};
      if (!image || !meta) return null;
      composed = composeBezel({ frameImage: image, meta, capture, placeholder, fit, align, radius, holeMask });
    } else if (ref.type === 'android') composed = composeAndroid({ def: ref, capture, placeholder, fit, align, radius });
    else if (ref.type === 'generic') composed = composeGeneric({ def: ref, capture, placeholder, fit, align, radius });
    else if (ref.type === 'duo') composed = composeDuo({ def: ref, capture, placeholder, fit, align, radius });
    else {
      const screen = ref.screen ?? captureSize ?? device.size;
      composed = composePlain({ def: { ...ref, screen }, capture, placeholder, fit, align, radius });
    }
    this.deviceCache.set(key, composed);
    while (this.deviceCache.size > 10) this.deviceCache.delete(this.deviceCache.keys().next().value);
    return composed;
  }

  drawDevice(ctx, scene, layer) {
    const composed = this.composedDevice(scene, layer);
    const src = scene.assets.captures[layer.id];
    if (src?.missing || !layer.capture) {
      const device = deviceForLayer(this.project, scene.deviceDef, layer);
      scene.warnings.push({ level: 'error', code: 'capture-missing', layer: layer.id, message: layer.capture ? `Screenshot “${layer.capture}” missing for ${device.label}` : 'No screenshot chosen for this slide' });
    } else if (src && !src.localized && scene.locale.appUI && !scene.locale.lang.startsWith('en')) {
      scene.warnings.push({ level: 'info', code: 'capture-default', layer: layer.id, message: 'Uses the standard screenshot' });
    }
    if (!composed) return;
    layer._screenSize = [composed.screen.w, composed.screen.h]; // what the inspector reports about the fit
    layer._radii = composed.radii;

    // does the screenshot fit the frame's screen?
    if (src?.image && composed.screen) {
      const fit = layer.fit ?? 'fill';
      const r = fitCapture([composed.screen.w, composed.screen.h], [src.image.naturalWidth, src.image.naturalHeight], { fit, align: layer.align });
      if (!r.exact) {
        const dims = `${src.image.naturalWidth}×${src.image.naturalHeight}`;
        const screen = `${composed.screen.w}×${composed.screen.h}`;
        const cropped = (r.cropX / src.image.naturalWidth + r.cropY / src.image.naturalHeight) * 100;
        if (fit === 'fill' && cropped > 2) scene.warnings.push({ level: 'warn', code: 'capture-size', layer: layer.id, message: `Screenshot ${dims} does not match the frame's screen (${screen}): ${cropped.toFixed(1)}% is cropped` });
        else if (fit === 'stretch' && r.aspectDiff > 0.02) scene.warnings.push({ level: 'warn', code: 'capture-size', layer: layer.id, message: `Screenshot ${dims} is stretched to the frame's ${screen} screen` });
        else scene.warnings.push({ level: 'info', code: 'capture-scaled', layer: layer.id, message: `Screenshot ${dims} is scaled ${r.scale.toFixed(2)}× to the frame's ${screen} screen` });
      }
    }

    const w = layer.w;
    const s = w / composed.w;
    const h = composed.h * s;
    layer._screenDrawn = { w: composed.screen.w * s, h: composed.screen.h * s };
    const top = layer._top ?? layer.top ?? 0;
    layer._box = { x: layer.cx - w / 2, y: top, w, h, rot: layer.rotate ?? 0 };
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.translate(layer.cx, top + h / 2);
    if (layer.rotate) ctx.rotate(rad(layer.rotate));
    this.applyShadow(ctx, scene, layer.shadow);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(composed.canvas, -w / 2, -h / 2, w, h);
  }
}

/** Render a scene at 1:1 and return raw RGBA bytes, ready to POST to the exporter. */
export async function renderToBytes(engine, scene) {
  const canvas = document.createElement('canvas');
  const report = await engine.render(canvas, scene, { size: scene.deviceDef.size });
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { bytes: data, width: canvas.width, height: canvas.height, report };
}
