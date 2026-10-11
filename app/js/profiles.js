import { ANDROID_HARDWARE, androidGeometry } from './android-hardware.js';
// Hardware profiles are independent of output canvases. Sizes checked 2026-10-07.
import { duoDisplaySize } from './devices.js';
const plain = (label, screen, capture, radius = 0) => ({ label, screen, capture, frame: { type: 'plain', screen, radius }, source: 'https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/', checkedAt: '2026-10-07' });
const duo = (label, display) => {
  const frame = { type: 'duo', display, orientation: display === 'inner' ? 'landscape' : 'portrait', finish: 'star-white' };
  return { label, screen: duoDisplaySize(frame), capture: `duo-${display}`, frame };
};
export const BUILTIN_PROFILES = {
  ...Object.fromEntries(Object.entries(ANDROID_HARDWARE).map(([model, spec]) => [`android-${model}`, { label: spec.label, screen: [...spec.screen], capture: `android-${model}`, frame: { type: 'android', model, finish: 'graphite' } }])),
  iphone: plain('iPhone', [1206, 2622], 'iphone', 188),
  ipad: plain('iPad', [1640, 2360], 'ipad', 30),
  'watch-series': plain('Apple Watch · Series', [416, 496], 'watch-series', 62),
  'watch-ultra': plain('Apple Watch · Ultra', [422, 514], 'watch-ultra', 62),
  mac: plain('Mac', [2880, 1800], 'mac'),
  tv: plain('Apple TV', [3840, 2160], 'tv'),
  vision: plain('Apple Vision Pro', [3840, 2160], 'vision'),
};
// Preserve existing documents that relied on the old Duo profile defaults.
// These profiles are never offered in a new document.
function legacyProfilesFor(project) {
  const used = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (['duo-inner', 'duo-outer'].includes(value.profile)) used.add(value.profile);
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  };
  walk(project);
  for (const id of ['duo-inner', 'duo-outer']) if (project.devices?.[id]?.frame?.type === 'duo') used.add(id);
  return Object.fromEntries([...used].map(id => [id, duo(id === 'duo-inner' ? 'Duo open' : 'Duo closed', id === 'duo-inner' ? 'inner' : 'outer')]));
}
/** Prefer the project's chosen hardware, then an imported bezel with the exact screen dimensions. */
export function profilesFor(project, frames = {}) {
  const available = { ...BUILTIN_PROFILES, ...legacyProfilesFor(project) };
  const builtins = Object.fromEntries(Object.entries(available).map(([id, profile]) => {
    const matches = ref => ref?.type === 'bezel' && frames[ref.name]?.screen?.w === profile.screen[0] && frames[ref.name]?.screen?.h === profile.screen[1];
    const preferred = project.devices?.[id]?.frame;
    if (profile.frame.type === 'android' && preferred?.type === 'android') return [id, { ...profile, screen: androidGeometry(preferred).screen, frame: structuredClone(preferred) }];
    if (profile.frame.type === 'duo' && preferred?.type === 'duo') {
      return [id, { ...profile, screen: duoDisplaySize(preferred), frame: structuredClone(preferred) }];
    }
    // TV and Vision share dimensions; dimensions alone cannot identify their hardware.
    const uniqueSize = Object.values(available).filter(p => p.screen[0] === profile.screen[0] && p.screen[1] === profile.screen[1]).length === 1;
    const frame = matches(preferred) ? preferred : uniqueSize ? Object.keys(frames).sort().map(name => ({ type: 'bezel', name })).find(matches) : undefined;
    return [id, frame ? { ...profile, frame: structuredClone(frame) } : profile];
  }));
  // An explicitly configured profile, including a screenshot-only frame, always wins.
  return { ...builtins, ...project.profiles };
}

/** Library choices. Removed profiles remain resolvable for devices already placed in a design. */
export function availableProfilesFor(project, frames = {}) {
  const removed = new Set(project.removedProfiles ?? []);
  return Object.fromEntries(Object.entries(profilesFor(project, frames)).filter(([id]) => !removed.has(id)));
}

/** Keep an existing selection visible when editing a device removed from the library. */
export function profileChoices(project, frames = {}, selected = '') {
  const available = availableProfilesFor(project, frames);
  const options = Object.entries(available).map(([id, profile]) => [id, profile.label]);
  const current = selected && profilesFor(project, frames)[selected];
  if (current && !available[selected]) options.unshift([selected, `${current.label} · removed from library`]);
  return options;
}

export function deviceForLayer(project, canvas, layer = {}, frames = {}) {
  const profile = profilesFor(project, frames)[layer.profile];
  return { ...canvas, ...(profile ? { label: profile.label, short: profile.label, size: profile.screen, capture: profile.capture, frame: profile.frame } : {}), ...(layer.captureSet ? { capture: layer.captureSet } : {}) };
}
