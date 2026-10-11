// Device compositing: puts an app screenshot inside a device frame and returns one canvas
// ("device canvas") that the scene renderer positions, rotates, scales and shadows.
//
//   bezel  - a product bezel PNG (project/assets/frames/<name>.png + <name>.json, see Setup -> Frames)
//            hole     the screen is a transparent hole: the screenshot is painted *behind* the bezel
//            overlay  the screen is painted into the frame: the screenshot is painted on top of it
//   duo    - parametric iPhone Duo frame, built from the real display geometry
//   plain  - the screenshot with rounded corners and no hardware
//
// Every screenshot is handled the same way, whatever the frame:
//   1. fitted into the screen (fill = cover and crop, contain = letterbox, stretch),
//   2. flattened onto black, so transparent corners in the capture never let the slide show through,
//   3. clipped to the screen's rounded corners, so square (or white) capture corners can't stick out,
//   4. extended a couple of pixels under the bezel ("bleed"), so the anti-aliased edge of the bezel
//      blends with the screen content instead of with whatever is behind the device.
//
// All of this works at the frame's native pixel size. Scaling down to the slide happens once, when
// the scene renderer draws the finished device canvas.

import { androidGeometry } from './android-hardware.js';
import { genericGeometry } from './generic-frame.js';

const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

const imageSize = (img) => [img.naturalWidth || img.width, img.naturalHeight || img.height];

export const FIT_MODES = [
  ['fill', 'Fill (crop to fit)'],
  ['contain', 'Fit inside (black bars)'],
  ['stretch', 'Stretch'],
];
export const ALIGN_MODES = [['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']];

/**
 * Where and how big a capture is drawn inside a screen, and what that costs: how much of it is cropped
 * away or scaled. Shared by the renderer and the inspector so the numbers you read are the numbers drawn.
 */
export function fitCapture(screenSize, captureSize, { fit = 'fill', align = 'center' } = {}) {
  const [sw, sh] = screenSize;
  const [iw, ih] = captureSize;
  if (fit === 'stretch') {
    return { x: 0, y: 0, w: sw, h: sh, scale: sw / iw, scaleY: sh / ih, cropX: 0, cropY: 0, exact: sw === iw && sh === ih, aspectDiff: Math.abs(iw / ih - sw / sh) / (sw / sh) };
  }
  const s = fit === 'contain' ? Math.min(sw / iw, sh / ih) : Math.max(sw / iw, sh / ih);
  const w = iw * s;
  const h = ih * s;
  const x = (sw - w) / 2;
  const y = fit === 'fill' && align === 'top' ? 0 : fit === 'fill' && align === 'bottom' ? sh - h : (sh - h) / 2;
  return {
    x, y, w, h, scale: s, scaleY: s,
    cropX: Math.max(0, w - sw) / s, cropY: Math.max(0, h - sh) / s,   // capture pixels cut off
    exact: sw === iw && sh === ih,
    aspectDiff: Math.abs(iw / ih - sw / sh) / (sw / sh),
  };
}

/** Draw `img` into the rect (x, y, w, h) according to the fit mode. A capture of exactly the right size is drawn 1:1. */
export function drawFitted(g, img, x, y, w, h, options) {
  const r = fitCapture([w, h], imageSize(img), options);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, x + r.x, y + r.y, r.w, r.h);
}

/** Stand-in shown when a screenshot hasn't been supplied yet - deliberately obvious so it can't ship by accident. */
export function drawPlaceholder(g, x, y, w, h, lines) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const bg = g.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, '#13203a');
  bg.addColorStop(1, '#0a1020');
  g.fillStyle = bg;
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = Math.max(2, w / 400);
  const step = w / 10;
  for (let gx = x; gx <= x + w; gx += step) { g.beginPath(); g.moveTo(gx, y); g.lineTo(gx, y + h); g.stroke(); }
  for (let gy = y; gy <= y + h; gy += step) { g.beginPath(); g.moveTo(x, gy); g.lineTo(x + w, gy); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const title = Math.min(w, h) * 0.06;
  g.font = `700 ${title}px system-ui, sans-serif`;
  g.fillText('Screenshot needed', x + w / 2, y + h / 2 - title * 0.9);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  const sub = title * 0.55;
  g.font = `500 ${sub}px ui-monospace, Menlo, monospace`;
  lines.forEach((line, i) => g.fillText(line, x + w / 2, y + h / 2 + title * 0.3 + i * sub * 1.5));
  g.restore();
}

/** Radius input (number, or [tl, tr, br, bl]) -> four radii, clamped so they fit the rectangle. */
export function cornerRadii(radius, w, h) {
  const list = Array.isArray(radius) ? radius : Array(4).fill(radius ?? 0);
  const max = Math.min(w, h) / 2;
  return list.map((r) => Math.max(0, Math.min(Number(r) || 0, max)));
}

function roundedRect(g, x, y, w, h, [tl, tr, br, bl]) {
  g.beginPath();
  g.moveTo(x + tl, y);
  g.lineTo(x + w - tr, y);
  g.arcTo(x + w, y, x + w, y + tr, tr);
  g.lineTo(x + w, y + h - br);
  g.arcTo(x + w, y + h, x + w - br, y + h, br);
  g.lineTo(x + bl, y + h);
  g.arcTo(x, y + h, x, y + h - bl, bl);
  g.lineTo(x, y + tl);
  g.arcTo(x, y, x + tl, y, tl);
  g.closePath();
}

/**
 * The "display": black, then the fitted screenshot (or the placeholder), then the outermost pixel rows and
 * columns repeated `bleed` px outwards. Returns a canvas of (w + 2 bleed) x (h + 2 bleed).
 */
function paintDisplay({ w, h, bleed, capture, fitOptions, placeholder }) {
  const core = makeCanvas(w, h);
  const cg = core.getContext('2d');
  cg.fillStyle = '#000';
  cg.fillRect(0, 0, w, h);
  if (capture) drawFitted(cg, capture, 0, 0, w, h, fitOptions);
  else drawPlaceholder(cg, 0, 0, w, h, placeholder);
  if (!bleed) return core;

  const out = makeCanvas(w + bleed * 2, h + bleed * 2);
  const g = out.getContext('2d');
  g.drawImage(core, bleed, bleed);
  g.drawImage(core, 0, 0, w, 1, bleed, 0, w, bleed);
  g.drawImage(core, 0, h - 1, w, 1, bleed, bleed + h, w, bleed);
  g.drawImage(core, 0, 0, 1, h, 0, bleed, bleed, h);
  g.drawImage(core, w - 1, 0, 1, h, bleed + w, bleed, bleed, h);
  g.drawImage(core, 0, 0, 1, 1, 0, 0, bleed, bleed);
  g.drawImage(core, w - 1, 0, 1, 1, bleed + w, 0, bleed, bleed);
  g.drawImage(core, 0, h - 1, 1, 1, 0, bleed + h, bleed, bleed);
  g.drawImage(core, w - 1, h - 1, 1, 1, bleed + w, bleed + h, bleed, bleed);
  return out;
}

// ---------------------------------------------------------------------------

export const HOLE_BLEED = 2;
export const OVERLAY_BLEED = 1;
const MASK_GROW = 3; // how far the black underlay reaches past the hole's edge, under the bezel's anti-aliased rim

/**
 * The bezel's hole as a black shape (a canvas the size of the frame image), grown a few pixels. It goes under the
 * screenshot so that wherever the rounded clip is a hair tighter than the hole the gap is black glass - and
 * only inside the device, never out past its outline where a plain rectangle would show.
 * `mask` is the Uint8Array from analyzeFrameData (1 = screen).
 */
export function buildHoleMask(mask, width, height, grow = MASK_GROW) {
  const base = makeCanvas(width, height);
  const bg = base.getContext('2d');
  const img = bg.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) if (mask[i]) img.data[i * 4 + 3] = 255;
  bg.putImageData(img, 0, 0);
  const out = makeCanvas(width, height);
  const og = out.getContext('2d');
  for (let dy = -grow; dy <= grow; dy++) for (let dx = -grow; dx <= grow; dx++) og.drawImage(base, dx, dy);
  return out;
}

export function composeBezel({ frameImage, meta, capture, placeholder, fit, align, radius, holeMask = null }) {
  const [W, H] = meta.size;
  const canvas = makeCanvas(W, H);
  const g = canvas.getContext('2d');
  const { x, y, w, h } = meta.screen;
  const overlay = meta.screen.mode === 'overlay';
  const bleed = overlay ? OVERLAY_BLEED : HOLE_BLEED;
  const radii = cornerRadii(radius ?? meta.screen.radius ?? 0, w, h);
  const display = paintDisplay({ w, h, bleed, capture, fitOptions: { fit, align }, placeholder });

  // The display is clipped to the screen's rounded corners, grown by the bleed - and, for a cut-out screen, to the hole's
  // own shape, so that even a radius of 0 can never put picture outside the device's outline.
  const paintScreen = () => {
    if (!overlay && holeMask) {
      const scratch = makeCanvas(W, H);
      const sg = scratch.getContext('2d');
      sg.save();
      roundedRect(sg, x - bleed, y - bleed, w + bleed * 2, h + bleed * 2, radii.map((r) => r + bleed));
      sg.clip();
      sg.drawImage(display, x - bleed, y - bleed);
      sg.restore();
      sg.globalCompositeOperation = 'destination-in';
      sg.drawImage(holeMask, 0, 0);
      g.drawImage(scratch, 0, 0);
      return;
    }
    g.save();
    roundedRect(g, x - bleed, y - bleed, w + bleed * 2, h + bleed * 2, radii.map((r) => r + bleed));
    g.clip();
    g.drawImage(display, x - bleed, y - bleed);
    g.restore();
  };

  if (overlay) {
    g.drawImage(frameImage, 0, 0);
    paintScreen();
  } else {
    // The screen goes first and the bezel on top: its transparent hole is the only place the screen shows through.
    // Black glass goes under the screen in the exact shape of the hole: wherever the rounded clip below is a hair
    // tighter than the hole (or the capture has transparent corners) the gap is black, never the slide behind the
    // device. (Without the hole's shape, a rounded rectangle stands in; a plain rectangle would poke out of the
    // device's rounded outline at the screen's corners.)
    if (holeMask) g.drawImage(holeMask, 0, 0);
    else {
      g.fillStyle = '#000';
      roundedRect(g, x - bleed, y - bleed, w + bleed * 2, h + bleed * 2, radii.map((r) => r + bleed));
      g.fill();
    }
    paintScreen();
    g.drawImage(frameImage, 0, 0);
  }
  return { canvas, w: W, h: H, screen: { x, y, w, h }, radii };
}

// ---------------------------------------------------------------------------
// iPhone Duo. Display sizes and corner geometry come from Apple's published screenshot sizes and the
// Xcode simulator's display masks; the hardware styling (finishes, rim, hinge) is a stand-in until
// Apple's official bezel artwork is dropped into project/assets/frames/ (see README).

const DUO_DISPLAY = {
  inner: { portrait: [2007, 2853], landscape: [2853, 2007], radius: 205.5 },
  outer: { portrait: [1398, 2034], radiusHinge: 30.8, radiusFree: 226.8 },
};

export const DUO_FINISHES = [['star-white', 'Star White'], ['night-sky', 'Night Sky']];
const FINISH = {
  'star-white': { rim: ['#fbfaf7', '#d8d3c8', '#f3efe7'], hinge: ['#c9c6bf', '#a9a6a0'], edge: 'rgba(255,255,255,0.7)' },
  'night-sky': { rim: ['#4b5262', '#191d26', '#3b4252'], hinge: ['#3a3f49', '#272b33'], edge: 'rgba(255,255,255,0.18)' },
};

export function duoDisplaySize({ display, orientation = 'landscape' }) {
  const d = DUO_DISPLAY[display];
  return display === 'inner' ? d[orientation] : d.portrait;
}

export function duoRadii({ display }, u = 1) {
  const d = DUO_DISPLAY;
  return display === 'inner'
    ? Array(4).fill(d.inner.radius * u)
    : [d.outer.radiusHinge * u, d.outer.radiusFree * u, d.outer.radiusFree * u, d.outer.radiusHinge * u];
}

export function composeDuo({ def, capture, placeholder, fit, align, radius }) {
  const { display, orientation = 'landscape', finish = 'star-white' } = def;
  const [sw, sh] = duoDisplaySize({ display, orientation });
  const u = Math.min(sw, sh) / 2007;          // scale relative to the inner display's short side
  const rim = 13 * u + 2;
  const bezel = 50 * u;
  const t = rim + bezel;
  const W = sw + t * 2;
  const H = sh + t * 2;
  const canvas = makeCanvas(W, H);
  const g = canvas.getContext('2d');
  const style = FINISH[finish] ?? FINISH['star-white'];

  // corner radii of the screen: [tl, tr, br, bl]
  const radii = radius === undefined || radius === null ? duoRadii({ display }, u) : cornerRadii(radius, sw, sh);
  const grow = (r, by) => r.map((v) => v + by);

  // 1. titanium rim
  const rimGradient = g.createLinearGradient(0, 0, W, H);
  style.rim.forEach((c, i) => rimGradient.addColorStop(i / (style.rim.length - 1), c));
  roundedRect(g, 0, 0, W, H, grow(radii, t));
  g.fillStyle = rimGradient;
  g.fill();

  // 2. hinge cover (matte, contrasting) - the spine side of the closed phone, or a band across the open book
  g.save();
  roundedRect(g, 0, 0, W, H, grow(radii, t));
  g.clip();
  const matte = g.createLinearGradient(0, 0, W, 0);
  matte.addColorStop(0, style.hinge[0]);
  matte.addColorStop(1, style.hinge[1]);
  g.fillStyle = matte;
  if (display === 'outer') {
    g.fillRect(0, 0, rim * 2.4, H);
  } else if (orientation === 'landscape') {
    g.fillRect(W / 2 - 46 * u, 0, 92 * u, rim * 1.5);
    g.fillRect(W / 2 - 46 * u, H - rim * 1.5, 92 * u, rim * 1.5);
  } else {
    g.fillRect(0, H / 2 - 46 * u, rim * 1.5, 92 * u);
    g.fillRect(W - rim * 1.5, H / 2 - 46 * u, rim * 1.5, 92 * u);
  }
  g.restore();

  // 3. polished edge highlight
  g.save();
  roundedRect(g, rim * 0.5, rim * 0.5, W - rim, H - rim, grow(radii, t - rim * 0.5));
  g.strokeStyle = style.edge;
  g.lineWidth = Math.max(2, 3 * u);
  g.stroke();
  g.restore();

  // 4. black bezel
  roundedRect(g, rim, rim, W - rim * 2, H - rim * 2, grow(radii, bezel));
  g.fillStyle = '#050507';
  g.fill();

  // 5. screen
  g.save();
  roundedRect(g, t, t, sw, sh, radii);
  g.clip();
  g.drawImage(paintDisplay({ w: sw, h: sh, bleed: 0, capture, fitOptions: { fit, align }, placeholder }), t, t);

  // crease / fold shading on the open display
  if (display === 'inner') {
    const horizontal = orientation === 'landscape';
    const span = 120 * u;
    const shade = horizontal
      ? g.createLinearGradient(t + sw / 2 - span, 0, t + sw / 2 + span, 0)
      : g.createLinearGradient(0, t + sh / 2 - span, 0, t + sh / 2 + span);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.5, 'rgba(0,0,0,0.12)');
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shade;
    if (horizontal) g.fillRect(t + sw / 2 - span, t, span * 2, sh);
    else g.fillRect(t, t + sh / 2 - span, sw, span * 2);
  }

  // soft glass reflection
  const glass = g.createLinearGradient(t, t, t + sw * 0.7, t + sh * 0.7);
  glass.addColorStop(0, 'rgba(255,255,255,0.07)');
  glass.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.fillStyle = glass;
  g.fillRect(t, t, sw, sh);
  g.restore();

  return { canvas, w: W, h: H, screen: { x: t, y: t, w: sw, h: sh }, radii };
}

// ---------------------------------------------------------------------------

/** Original Android-style bezels; screen geometry is shared with the composition gallery. */
export function composeAndroid({ def, capture, placeholder, fit, align, radius }) {
  const { screen: [sw, sh], size: [w, h], rim, radius: screenRadius } = androidGeometry(def);
  const canvas = makeCanvas(w, h), g = canvas.getContext('2d');
  const metal = g.createLinearGradient(0, 0, w, h);
  (def.finish === 'silver' ? ['#8c949e', '#f3f5f8', '#6e7784'] : ['#292e35', '#65707c', '#181b20']).forEach((c, i) => metal.addColorStop(i / 2, c));
  roundedRect(g, 0, 0, w, h, cornerRadii(screenRadius + rim, w, h)); g.fillStyle = metal; g.fill();
  const edge = Math.max(3, rim * .18);
  roundedRect(g, edge, edge, w - edge * 2, h - edge * 2, cornerRadii(screenRadius + rim - edge, w - edge * 2, h - edge * 2)); g.fillStyle = '#06080b'; g.fill();
  const radii = cornerRadii(radius ?? screenRadius, sw, sh);
  g.save(); roundedRect(g, rim, rim, sw, sh, radii); g.clip();
  g.drawImage(paintDisplay({ w: sw, h: sh, bleed: 0, capture, fitOptions: { fit, align }, placeholder }), rim, rim);
  if (def.model === 'foldable') {
    const gradient = g.createLinearGradient(w / 2 - 16, 0, w / 2 + 16, 0);
    gradient.addColorStop(0, '#0000'); gradient.addColorStop(.5, '#0002'); gradient.addColorStop(1, '#0000');
    g.fillStyle = gradient; g.fillRect(w / 2 - 16, rim, 32, sh);
  }
  if (def.model === 'phone') {
    g.beginPath(); g.arc(sw < sh ? w / 2 : rim + 32, sw < sh ? rim + 32 : h / 2, 11, 0, Math.PI * 2);
    g.fillStyle = '#07090d'; g.fill();
  }
  g.restore();
  return { canvas, w, h, screen: { x: rim, y: rim, w: sw, h: sh }, radii };
}

/** A neutral Studio frame, sized to the screen without altering its screenshot geometry. */
export function composeGeneric({ def, capture, placeholder, fit, align, radius }) {
  const { screen: [sw, sh], size: [w, h], rim, radius: screenRadius } = genericGeometry(def);
  const canvas = makeCanvas(w, h), g = canvas.getContext('2d');
  const radii = cornerRadii(radius ?? screenRadius, sw, sh);
  roundedRect(g, 0, 0, w, h, radii.map(r => r + rim));
  const metal = g.createLinearGradient(0, 0, w, h);
  metal.addColorStop(0, '#78818b'); metal.addColorStop(.45, '#30363e'); metal.addColorStop(1, '#101419');
  g.fillStyle = metal; g.fill();
  const edge = Math.max(1, rim * .15);
  roundedRect(g, edge, edge, w - edge * 2, h - edge * 2, radii.map(r => r + rim - edge));
  g.fillStyle = '#090b0e'; g.fill();
  g.save(); roundedRect(g, rim, rim, sw, sh, radii); g.clip();
  g.drawImage(paintDisplay({ w: sw, h: sh, bleed: 0, capture, fitOptions: { fit, align }, placeholder }), rim, rim);
  g.restore();
  return { canvas, w, h, screen: { x: rim, y: rim, w: sw, h: sh }, radii };
}

/** The screenshot alone with rounded corners. The caller supplies the screen size (usually the capture's own size). */
export function composePlain({ def, capture, placeholder, fit, align, radius }) {
  const [sw, sh] = def.screen;
  const canvas = makeCanvas(sw, sh);
  const g = canvas.getContext('2d');
  const radii = cornerRadii(radius ?? def.radius ?? Math.min(sw, sh) * 0.09, sw, sh);
  roundedRect(g, 0, 0, sw, sh, radii);
  g.clip();
  g.drawImage(paintDisplay({ w: sw, h: sh, bleed: 0, capture, fitOptions: { fit, align }, placeholder }), 0, 0);
  return { canvas, w: sw, h: sh, screen: { x: 0, y: 0, w: sw, h: sh }, radii };
}
