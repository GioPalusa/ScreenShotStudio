// Frame references: what studio.json stores to say "put this slide's screenshot in that device frame".
//
//   { "type": "bezel", "name": "iphone-17-pro-orange" }   a bezel PNG from project/assets/frames/
//   { "type": "duo", "display": "inner", "orientation": "landscape", "finish": "star-white" }
//   { "type": "plain", "radius": 120 }                     the screenshot alone, rounded corners
//
// DOM-free, so it can be used from Node as well.

import { ANDROID_FRAMES, androidGeometry } from './android-hardware.js';
import { duoDisplaySize } from './devices.js';
import { genericGeometry } from './generic-frame.js';

export const DEFAULT_FRAME = { type: 'plain' };
export const APPLE_BEZELS_URL = 'https://developer.apple.com/design/resources/#product-bezels';

/** A stable string for a reference - used as <option> values and cache keys. */
export function frameKey(ref) {
  const r = ref ?? DEFAULT_FRAME;
  if (r.type === 'android') return `android:${r.model}:${r.orientation ?? (r.model === 'foldable' ? 'landscape' : 'portrait')}:${r.finish ?? 'graphite'}`;
  if (r.type === 'bezel') return `bezel:${r.name}`;
  if (r.type === 'generic') return `generic:${r.family ?? ''}:${r.screen.join(':')}`;
  if (r.type === 'duo') return `duo:${r.display}:${r.orientation ?? (r.display === 'inner' ? 'landscape' : 'portrait')}:${r.finish ?? 'star-white'}`;
  return 'plain';
}

export function parseFrameKey(key) {
  if (!key || key === 'plain') return { type: 'plain' };
  const [type, ...rest] = key.split(':');
  if (type === 'android') { const [model, orientation, finish] = rest; return { type, model, orientation, finish }; }
  if (type === 'bezel') return { type: 'bezel', name: rest.join(':') };
  if (type === 'generic') { const [family, w, h] = rest; return { type, screen: [Number(w), Number(h)], ...(family ? { family } : {}) }; }
  if (type === 'duo') {
    const [display, orientation, finish] = rest;
    return display === 'outer' ? { type: 'duo', display, finish } : { type: 'duo', display, orientation, finish };
  }
  return { type: 'plain' };
}

export const sameFrame = (a, b) => frameKey(a) === frameKey(b);

/** The hardware-style frames that are built in (no PNG needed). */
export const BUILTIN_FRAMES = [
  ...ANDROID_FRAMES,
  { ref: { type: 'plain' }, label: 'No frame' },
];

export function humanizeFrameName(name) {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\biphone\b/gi, 'iPhone')
    .replace(/\bipad\b/gi, 'iPad')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bI(Phone|Pad)\b/g, 'i$1');
}

export function frameLabel(ref, frames = {}) {
  const r = ref ?? DEFAULT_FRAME;
  if (r.type === 'generic') return 'Generic frame';
  if (r.type === 'duo') return `Duo ${r.display === 'outer' ? 'closed' : 'open'} · legacy frame`;
  if (r.type === 'bezel') return frames[r.name]?.label ?? humanizeFrameName(r.name);
  const key = frameKey(r);
  return BUILTIN_FRAMES.find((f) => frameKey(f.ref) === key)?.label ?? 'Frame';
}

/** Every frame the picker can offer: the project's bezel PNGs first, then the built-in ones. */
export function allFrames(frames = {}) {
  const bezels = Object.keys(frames)
    .filter((name) => frames[name]?.screen)
    .sort()
    .map((name) => ({ ref: { type: 'bezel', name }, label: frameLabel({ type: 'bezel', name }, frames), meta: frames[name] }));
  return [...bezels, ...BUILTIN_FRAMES];
}

/** Pixel size a screenshot should have to fill this frame's screen exactly. */
export function frameScreenSize(ref, { frames = {}, deviceSize = null, captureSize = null } = {}) {
  const r = ref ?? DEFAULT_FRAME;
  if (r.type === 'generic') return r.screen;
  if (r.type === 'bezel') {
    const meta = frames[r.name];
    return meta ? [meta.screen.w, meta.screen.h] : null;
  }
  if (r.type === 'android') return androidGeometry(r).screen;
  if (r.type === 'duo') return duoDisplaySize(r);
  return captureSize ?? r.screen ?? deviceSize;
}

/** Outer hardware dimensions used when placing a device, including its rim and bezel. */
export function frameOuterSize(ref, { frames = {}, deviceSize = null } = {}) {
  if (ref?.type === 'generic') return genericGeometry(ref).size;
  if (ref?.type === 'android') return androidGeometry(ref).size;
  if (ref?.type === 'bezel' && frames[ref.name]?.size) return frames[ref.name].size;
  const screen = frameScreenSize(ref, { frames, deviceSize });
  if (ref?.type !== 'duo' || !screen) return screen;
  // Matches composeDuo's 50u bezel + (13u + 2) rim on each edge.
  const padding = 2 * (63 * Math.min(...screen) / 2007 + 2);
  return screen.map(value => value + padding);
}

/** Corner radius of the frame's screen in screenshot pixels (number or [tl, tr, br, bl]), if known. */
export function frameRadius(ref, frames = {}) {
  if (ref?.type === 'bezel') return frames[ref.name]?.screen?.radius ?? null;
  return null;
}
