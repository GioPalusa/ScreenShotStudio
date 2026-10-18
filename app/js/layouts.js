import { sharedLayers } from './shared-canvas.js';
import { canvasForSlide } from './canvas-orientation.js';
// Layout templates: turn "this slide on this device" into an ordered list of layers.
//
// A slide picks a template per device class in studio.json, e.g.
//     "layouts": { "phone": { "template": "text-top", "overrides": { "device": { "top": 650 } } } }
// The template supplies sensible defaults for the canvas size; `overrides` patches any layer by id
// (or removes it with `false`); `layers` adds extra layers (images, shapes, more devices, more text).
// Instead of a built-in template a block can say `"use": "<id>"` to follow one of the project's own
// templates (`templates` in studio.json); the block's own `overrides` / `layers` then sit on top of it.
// Everything is plain data.
//
// Coordinates are design pixels. Layouts are written for a design *width* (the device's `designSize[0]`,
// or its own width) and any height: when a device's canvas is a different size the whole design is
// scaled uniformly, and the design height stretches to the canvas so bottom-anchored text still sits
// on the bottom edge. Positions can be numbers or "flow" references, e.g. { after: "headline", gap: 120 },
// which stack blocks without overlapping when a translation needs an extra line.

/** Per-class typography/geometry. Numbers were measured from the original Illustrator slides. */
export const STYLE = {
  phone: {
    headline: { x: 40, w: 1240, size: 182.5, minSize: 84, maxLines: 2 },
    caption: { x: 60, w: 1200, size: 117.9, minSize: 66, maxLines: 3, weight: 500, lineHeight: 1.2, align: 'center', block: 'center' },
    bullets: { x: 70, w: 1180, size: 110, minSize: 70, maxLines: 8, weight: 600, lineHeight: 1.4, align: 'start', block: 'start', marker: '-' },
    device: { w: 1024 },
    capTop: 86,
  },
  tablet: {
    headline: { x: 94, w: 1876, size: 152, minSize: 84, maxLines: 2, oneLine: 0.85 },
    caption: { x: 135, w: 1794, size: 110, minSize: 66, maxLines: 2, weight: 600, lineHeight: 1.4, align: 'start', block: 'start' },
    bullets: { x: 135, w: 1794, size: 110, minSize: 70, maxLines: 8, weight: 600, lineHeight: 1.4, align: 'start', block: 'start', marker: '-' },
    device: { w: 1455 },
    capTop: 103,
  },
  wide: {
    headline: { x: 140, w: 2573, size: 168, minSize: 84, maxLines: 2, oneLine: 0.8 },
    caption: { x: 140, w: 2573, size: 100, minSize: 60, maxLines: 2, weight: 600, lineHeight: 1.35, align: 'center', block: 'center' },
    bullets: { x: 140, w: 2573, size: 100, minSize: 60, maxLines: 8, weight: 600, lineHeight: 1.4, align: 'start', block: 'start', marker: '-' },
    device: { w: 1950 },
    capTop: 96,
  },
  outer: {
    headline: { x: 64, w: 1270, size: 150, minSize: 80, maxLines: 2 },
    caption: { x: 64, w: 1270, size: 96, minSize: 60, maxLines: 3, weight: 500, lineHeight: 1.2, align: 'center', block: 'center' },
    bullets: { x: 74, w: 1250, size: 92, minSize: 60, maxLines: 8, weight: 600, lineHeight: 1.4, align: 'start', block: 'start', marker: '-' },
    device: { w: 1010 },
    capTop: 84,
  },
};

/** Design space of a device: width W, height H (stretched to the canvas), and k = output pixels per design pixel. */
export function canvasMetrics(device) {
  const [SW, SH] = device.size;
  const W = device.designSize?.[0] ?? SW;
  const k = SW / W;
  return { SW, SH, W, H: SH / k, k };
}

const headline = (s, extra = {}) => ({
  id: 'headline', type: 'text', field: 'headline', weight: 700, lineHeight: 1.2, align: 'start', block: 'center',
  anchor: 'top', capTop: s.capTop, ...s.headline, ...extra,
});
const caption = (s, extra = {}) => ({ id: 'caption', type: 'text', field: 'caption', anchor: 'top', ...s.caption, ...extra });
const bullets = (s, extra = {}) => ({ id: 'bullets', type: 'text', field: 'bullets', anchor: 'top', itemGap: 0, ...s.bullets, ...extra });
const device = (s, W, extra = {}) => ({ id: 'device', type: 'device', cx: W / 2, w: s.device.w, ...extra });

export const TEMPLATES = {
  /** Headline (and optional sub-text) on top, device underneath. */
  'text-top': ({ W, H, cls }) => {
    const s = STYLE[cls];
    const phone = cls === 'phone';
    const outerLike = cls === 'outer';
    return [
      headline(s),
      !phone && caption(s, { capTop: { after: 'headline', gap: cls === 'tablet' ? 123 : cls === 'wide' ? 96 : 90, min: s.capTop } }),
      device(s, W, {
        top: phone ? 621 : cls === 'tablet' ? { after: ['caption', 'headline'], gap: 103, min: 669 }
          : cls === 'wide' ? { after: ['caption', 'headline'], gap: 70, min: 480 }
          : { after: ['caption', 'headline'], gap: 90, min: outerLike ? 520 : 600 },
      }),
    ].filter(Boolean);
  },

  /** Device on top, headline anchored to the bottom edge. */
  'text-bottom': ({ W, H, cls }) => {
    const s = STYLE[cls];
    const phone = cls === 'phone';
    const bottom = H - (phone ? 158 : cls === 'tablet' ? 220 : cls === 'wide' ? 170 : 150);
    return [
      device(s, W, { top: phone ? 160 : cls === 'tablet' ? 140 : 110 }),
      headline(s, { anchor: 'bottom', baseline: bottom, capTop: undefined, size: phone ? 186.5 : s.headline.size }),
    ];
  },

  /** Headline on top, device in the middle, caption below it (the original "journal" slide). */
  'text-top-caption': ({ W, H, cls }) => {
    const s = STYLE[cls];
    const phone = cls === 'phone';
    return [
      headline(s),
      device(s, W, { top: phone ? 506.5 : { after: ['headline'], gap: 130, min: 520 }, ...(phone ? { w: 882.2, cx: 658 } : { w: s.device.w * 0.86 }) }),
      caption(s, { anchor: 'bottom', capTop: undefined, baseline: H - (phone ? 108 : 110) }),
    ];
  },

  /** Headline plus a bulleted list, no device - the globe (panorama art) carries the slide. */
  'text-bullets': ({ W, H, cls }) => {
    const s = STYLE[cls];
    return [
      headline(s, { size: s.headline.size * 0.85, capTop: s.capTop + 3 }),
      bullets(s, { capTop: { after: 'headline', gap: cls === 'phone' ? 115 : 120, min: s.capTop + 3 }, maxHeight: Math.round(H * 0.314) }),
    ];
  },

  /** Nothing but the background and panorama art - add your own layers. */
  custom: () => [],
};

export const TEMPLATE_LABELS = {
  'text-top': 'Headline on top, device below',
  'text-bottom': 'Device on top, headline below',
  'text-top-caption': 'Headline, device, caption',
  'text-bullets': 'Headline and bullet list',
  custom: 'Empty canvas (add your own layers)',
};

// ---------------------------------------------------------------------------
// New layers, with sensible defaults for the canvas they are added to.

export const LAYER_KINDS = {
  headline: 'Headline',
  caption: 'Sub text',
  bullets: 'Bullet list',
  text: 'Text',
  device: 'Device',
  image: 'Image',
  shape: 'Shape',
};

export function makeLayer(kind, { cls = 'phone', W, H, id, ...extra } = {}) {
  const s = STYLE[cls] ?? STYLE.phone;
  let layer;
  switch (kind) {
    case 'headline': layer = headline(s); break;
    case 'caption': layer = caption(s, { capTop: s.capTop + Math.round(H * 0.07) }); break;
    case 'bullets': layer = bullets(s, { capTop: s.capTop + Math.round(H * 0.12), maxHeight: Math.round(H * 0.314) }); break;
    case 'text': layer = { id, type: 'text', field: id, anchor: 'top', weight: 600, lineHeight: 1.2, ...s.caption, capTop: Math.round(H * 0.3), maxLines: 3 }; break;
    case 'device': layer = device(s, W, { top: Math.round(H * 0.2), w: Math.min(s.device.w, Math.round(W * 0.8)) }); break;
    case 'image': layer = { id, type: 'art', cx: Math.round(W / 2), cy: Math.round(H / 2), w: Math.round(W * 0.4) }; break;
    case 'shape': layer = { id, type: 'shape', shape: 'rect', cx: Math.round(W / 2), cy: Math.round(H / 2), w: Math.round(W * 0.5), h: Math.round(W * 0.5), fill: '#ffffff', opacity: 0.3, radius: 0 }; break;
    default: throw new Error(`Unknown layer kind “${kind}”`);
  }
  return { ...layer, ...(id ? { id } : {}), ...extra };
}

// ---------------------------------------------------------------------------
// Paint order

const DEFAULT_Z = { route: 0, art: 0, shape: 0.5, device: 1, text: 2 };

/** Stacking value of a layer: its own `zOrder`, else a default by type (route/art behind, device, text on top). */
export const layerZ = (l) => l.zOrder ?? (l.type === 'art' && l.z !== 'below' && l.panoramaOffset !== undefined ? 1.5 : DEFAULT_Z[l.type] ?? 1);

/** Layers back to front. Equal values keep their list order. */
export function paintOrder(layers) {
  return layers.map((l, i) => ({ l, i, z: layerZ(l) })).sort((a, b) => a.z - b.z || a.i - b.i).map((x) => x.l);
}

// ---------------------------------------------------------------------------

/** `false` removes a layer, `null` resets a property, anything else patches. */
function applyOverrides(layers, overrides = {}) {
  const out = layers.map((l) => ({ ...l }));
  for (const [id, patch] of Object.entries(overrides)) {
    const i = out.findIndex((l) => l.id === id);
    if (patch === false) { if (i >= 0) out.splice(i, 1); continue; }
    if (i >= 0) {
      const layer = out[i];
      for (const [k, v] of Object.entries(patch)) { if (v === null) delete layer[k]; else layer[k] = v; }
      if (layer.hidden === false) delete layer.hidden;
    } else if (patch && patch.type) {
      out.push({ id, ...patch, _origin: 'slide' });
    }
  }
  return out;
}

/** Slide-level overrides sit on top of the template's: per layer id, later patches win. */
export function mergeOverrides(base = {}, top = {}) {
  const out = { ...base };
  for (const [id, patch] of Object.entries(top)) {
    if (patch === false || out[id] === false || typeof out[id] !== 'object' || out[id] === null) out[id] = patch === undefined ? out[id] : patch;
    else out[id] = { ...out[id], ...patch };
  }
  return out;
}

/** Panorama: art and the dashed route are laid out once across the whole strip of slides; each slide shows its tile. */
function panoramaLayers(project, cls, slideIndex, W, H) {
  const pano = project.panorama?.[cls];
  if (!pano) return { below: [], above: [] };
  const offsets = pano.offsets ?? [];
  const pitch = pano.pitch ?? 1480;
  const offset = slideIndex < offsets.length ? offsets[slideIndex] : (offsets.at(-1) ?? 0) + (slideIndex - offsets.length + 1) * pitch;
  const below = [];
  const above = [];
  if (pano.route) below.push({ id: 'route', type: 'route', ...pano.route, dx: offset, scale: pano.scale ?? 1, dy: pano.dy ?? 0, ...(pano.clipTop ? { clip: [0, pano.clipTop, W, H] } : {}), _origin: 'panorama' });
  for (const art of pano.art ?? []) {
    const layer = { id: art.id ?? art.src, type: 'art', ...art, panoramaOffset: offset, panoramaScale: pano.scale ?? 1, panoramaDy: pano.dy ?? 0, _origin: 'panorama' };
    (art.z === 'below' ? below : above).push(layer);
  }
  return { below, above };
}

/** The layout block of a slide (or template) for a device: exact device id first, then its class (phone/tablet/wide/outer). */
export function layoutFor(owner, deviceId, device) {
  return owner?.layouts?.[deviceId] ?? owner?.layouts?.[device.layout] ?? {};
}

/** Which key of `owner.layouts` layoutFor() reads for this device (the device id if it has its own block, else its class). */
export function layoutKey(owner, deviceId, device) {
  return owner?.layouts?.[deviceId] ? deviceId : device.layout;
}

/**
 * A block that says `"use": "<template id>"` is expanded into the template's own block (template,
 * overrides, layers, decorations) with the slide's tweaks on top. A missing template falls back to the
 * block as written, so a deleted template never breaks a slide.
 */
export function expandBlock(project, block, deviceId, device) {
  if (!block?.use) return block ?? {};
  const tpl = project.templates?.[block.use];
  const base = tpl ? layoutFor(tpl, deviceId, device) : null;
  if (!tpl || !base || (!base.template && !base.layers && !base.overrides && base.panorama === undefined)) return { ...block, use: undefined, _missingTemplate: block.use };
  return {
    template: base.template,
    overrides: mergeOverrides(base.overrides, block.overrides),
    layers: [...(base.layers ?? []).map((l) => ({ ...l, _origin: 'template' })), ...(block.layers ?? [])],
    panorama: block.panorama !== undefined ? block.panorama : base.panorama,
    capture: block.capture,
    use: block.use,
  };
}

/**
 * Everything a scene needs from the layout: the layers (hidden ones included, flagged `hidden`),
 * the design-space size and the expanded layout block. Each layer carries `_origin`:
 * "builtin" (from the template function), "template" (from a project template), "slide" (the
 * block's own `layers`) or "panorama" - the editor uses it to decide where an edit is written.
 */
export function resolveLayers({ project, slide, deviceId, localeId = null, includeShared = true }) {
  const device = canvasForSlide(project, slide, deviceId);
  const { W, H, k } = canvasMetrics(device);
  const cls = device.layout;
  const variant = slide.localeLayouts?.[localeId]?.[deviceId];
  const layout = variant?.independent ? variant : expandBlock(project, layoutFor(slide, deviceId, device), deviceId, device);
  const template = TEMPLATES[layout.template ?? slide.template ?? 'text-top'] ?? TEMPLATES['text-top'];
  let layers = template({ W, H, cls, device, slide }).map((l) => ({ ...l, _origin: 'builtin' }));
  for (const extra of layout.layers ?? []) layers.push({ ...extra, _origin: extra.panoramaLayer ? 'panorama' : extra._origin ?? 'slide' });
  layers = applyOverrides(layers, layout.overrides);

  const index = Math.max(0, project.slides.findIndex((s) => s.id === slide.id));
  const pano = (variant?.panorama ?? layout.panorama) === false ? { below: [], above: [] } : panoramaLayers(project, cls, index, W, H);

  // A slide's own layer and one from its template can share an id (both were "image"); assets and edits are keyed by id,
  // so the later one gets a new id instead of silently taking the other's picture.
  const seen = new Set([...pano.below, ...pano.above].map((l) => l.id));
  for (const l of layers) {
    if (seen.has(l.id)) {
      let n = 2;
      while (seen.has(`${l.id}~${n}`)) n++;
      l._sourceId = l.id;
      l.id = `${l.id}~${n}`;
    }
    seen.add(l.id);
  }
  if (variant && !variant.independent) {
    layers = applyOverrides(layers, variant.overrides);
    for (const extra of variant.layers ?? []) {
      let id = extra.id, n = 2; while (seen.has(id)) id = `${extra.id}~${n++}`;
      seen.add(id); layers.push({ ...extra, id, ...(id !== extra.id ? { _sourceId: extra.id } : {}), _origin: 'slide' });
    }
  }
  const captureName = variant?.capture !== undefined ? variant.capture : layout.capture !== undefined ? layout.capture : slide.capture ?? null;
  for (const l of layers) if (l.type === 'device' && !l.capture) { l.capture = captureName; l._captureFrom = 'block'; }

  const decorate = items => {
    const ids = new Set(items.map(l => l.id));
    const patches = source => Object.fromEntries(Object.entries(source ?? {}).filter(([id]) => ids.has(id)));
    let result = applyOverrides(items, patches(layout.overrides));
    if (variant && !variant.independent) result = applyOverrides(result, patches(variant.overrides));
    return result;
  };
  return { layers: [...decorate(pano.below), ...layers, ...decorate(pano.above), ...(includeShared ? sharedLayers(project, deviceId, localeId, slide.id) : [])], layout, W, H, k, cls };
}
