// Frame recommendations describe screen compatibility, never the output canvas's pixel size alone.
import { allFrames, frameScreenSize } from './frames.js';
import { profilesFor } from './profiles.js';
import { EXPORT_TARGETS } from './export-targets.js';
import { genericFrame } from './generic-frame.js';

const validSize = size => Array.isArray(size) && size.length === 2 && size.every(n => Number.isFinite(n) && n > 0);
const equalSize = (a, b) => validSize(a) && validSize(b) && a.every((n, i) => n === b[i]);
export const frameSizeText = size => validSize(size) ? `${size[0]} × ${size[1]} px` : 'Unknown screen size';

function familyOf({ label = '', target, frame, size }, frames = {}) {
  if (frame?.type === 'generic' && frame.family) return frame.family;
  if (frame?.type === 'android') return frame.model === 'watch' ? 'wear' : `android-${frame.model}`;
  if (frame?.type === 'duo') return `duo-${frame.display}`;
  const words = `${label} ${frame?.type === 'bezel' ? frames[frame.name]?.label ?? frame.name : ''}`;
  if (frame?.type === 'bezel' && frames[frame.name]?.family) return frames[frame.name].family;
  if (/wear\s*(?:os)?/i.test(words)) return 'wear';
  if (/android|pixel|galaxy/i.test(words)) return /fold/i.test(words) ? 'android-foldable' : /tablet|\btab\b/i.test(words) ? 'android-tablet' : 'android-phone';
  if (EXPORT_TARGETS[target]?.family) return EXPORT_TARGETS[target].family;
  if (/\b(?:apple\s*)?watch\b|\baw[\s_-]/i.test(words)) return 'watch';
  if (/duo.*(?:closed|outer)/i.test(words)) return 'duo-outer';
  if (/duo.*(?:open|inner)/i.test(words)) return 'duo-inner';
  for (const [family, pattern] of [['ipad', /\bipad\b/i], ['iphone', /\biphone\b/i], ['vision', /\bvision\b/i], ['tv', /\b(?:apple\s*)?tv\b/i], ['mac', /\bmac(?:book|os)?\b/i]]) {
    if (pattern.test(words)) return family;
  }
  if (target && target !== 'custom' && Object.hasOwn(EXPORT_TARGETS, target)) return target;
  // Dimensions can identify unnamed imported bezels, but TV/Vision's shared dimensions cannot.
  if (equalSize(size, [2853, 2007]) || equalSize(size, [2007, 2853])) return 'duo-inner';
  if (equalSize(size, [1398, 2034])) return 'duo-outer';
  const candidates = Object.entries(EXPORT_TARGETS).filter(([id, spec]) => id !== 'custom' && !spec.store && spec.formats.some(f => equalSize(f.size, size)));
  return candidates.length === 1 ? candidates[0][0] : null;
}

/** The displayed hardware wins over canvas format, capture collection and any manually chosen frame. */
export function frameTarget(project, canvas, layer = {}, frames = {}) {
  const profile = profilesFor(project, frames)[layer.profile];
  const hardware = profile ?? canvas;
  const baseSize = hardware.screen ?? hardware.size;
  const frameScreen = frameScreenSize(hardware.frame, { frames, deviceSize: baseSize });
  const label = profile?.label ?? canvas.short ?? canvas.label ?? 'this device';
  const family = familyOf({ label, target: profile ? undefined : canvas.target, frame: ['duo', 'android'].includes(hardware.frame?.type) ? hardware.frame : undefined, size: baseSize }, frames);
  const frameFamily = familyOf({ frame: hardware.frame, size: frameScreen }, frames);
  const screen = family && frameFamily && family !== frameFamily ? baseSize : frameScreen ?? baseSize;
  return { label, screen, family: family ?? frameFamily };
}

export function frameCompatibility(ref, target, frames = {}) {
  if (ref.type === 'plain') return { kind: 'plain', rank: 3, label: 'No frame', screen: ref.screen ?? target.screen };
  const screen = frameScreenSize(ref, { frames });
  const family = familyOf({ frame: ref, size: screen }, frames);
  if (family && target.family && family !== target.family) return { kind: 'other', rank: 4, label: 'Different device', screen };
  if (equalSize(screen, target.screen)) return { kind: 'exact', rank: 0, label: 'Exact screen match', screen };
  const sameProportions = validSize(screen) && validSize(target.screen) && Math.abs((screen[0] / screen[1]) / (target.screen[0] / target.screen[1]) - 1) < .01;
  if (family && family === target.family) return { kind: 'alternative', rank: 1, label: sameProportions ? 'Same proportions · scaled' : 'Different screen size', screen };
  if (validSize(screen) && validSize(target.screen) && Math.abs((screen[0] / screen[1]) / (target.screen[0] / target.screen[1]) - 1) < .01) {
    return { kind: 'alternative', rank: 2, label: 'Same proportions · scaled', screen };
  }
  return { kind: 'other', rank: 4, label: validSize(screen) ? 'Different proportions' : 'Unknown screen size', screen };
}

export function framesForTarget(target, frames = {}) {
  return allFrames(frames).map(option => ({ ...option, fit: frameCompatibility(option.ref, target, frames) }))
    .sort((a, b) => a.fit.rank - b.fit.rank || a.label.localeCompare(b.label));
}

/** Compact choices for the displayed device; other hardware remains in the full picker. */
export function frameDropdownOptions(target, frames = {}) {
  return [
    { ref: { type: 'plain', screen: [...target.screen] }, label: 'No frame' },
    { ref: genericFrame(target), label: 'Generic frame' },
    ...framesForTarget(target, frames).filter(option => option.fit.kind === 'exact' || option.fit.kind === 'alternative'),
  ];
}

const FAMILY_LABELS = { iphone: 'iPhone', ipad: 'iPad', watch: 'Apple Watch', mac: 'Mac', 'duo-inner': 'iPhone Duo · open', 'duo-outer': 'iPhone Duo · closed', 'android-phone': 'Android phone', 'android-tablet': 'Android tablet', 'android-foldable': 'Android foldable', wear: 'Wear OS', tv: 'Apple TV', vision: 'Apple Vision Pro', other: 'Other devices' };

/** Shared device grouping for the picker and the library, independent of screen compatibility. */
export function frameGroups(options, frames = {}) {
  const groups = new Map();
  for (const option of options) {
    if (option.ref.type === 'plain') continue;
    const family = familyOf({ frame: option.ref, size: frameScreenSize(option.ref, { frames }) }, frames) ?? 'other';
    if (!groups.has(family)) groups.set(family, { id: family, label: FAMILY_LABELS[family] ?? family, options: [] });
    groups.get(family).options.push(option);
  }
  const order = Object.keys(FAMILY_LABELS);
  return [...groups.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

export function frameModels(options, frames = {}) {
  const models = new Map();
  for (const option of options) {
    const label = frames[option.ref.name]?.device ?? (option.ref.type === 'bezel' ? 'Project frames' : 'Studio illustrations');
    if (!models.has(label)) models.set(label, []);
    models.get(label).push(option);
  }
  return [...models].map(([label, options]) => ({ label, options }));
}
