// Offline size policies shared by Setup, preflight and the CLI.
import { PLAY_TARGETS, playSizeAccepted } from './google-play.js';
export { PLAY_SPEC_URL, PLAY_SPEC_CHECKED_AT } from './google-play.js';
export const SPEC_URL = 'https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/';
export const SPEC_CHECKED_AT = '2026-10-07';

const formats = (label, sizes, rotate = true) => sizes.flatMap(([w, h]) => [
  { label, size: [w, h] }, ...(rotate ? [{ label, size: [h, w] }] : []),
]);

export const EXPORT_TARGETS = {
  iphone: { label: 'iPhone', layout: 'phone', formats: [
    ...formats('Dynamic Island · large', [[1320, 2868], [1290, 2796], [1260, 2736]]),
    ...formats('Dynamic Island · medium', [[1206, 2622], [1179, 2556]]),
    ...formats('Face ID · large', [[1284, 2778], [1242, 2688]]),
    ...formats('Face ID · medium', [[1170, 2532], [1125, 2436], [1080, 2340]]),
    ...formats('Duo · inner', [[2007, 2853]]), ...formats('Duo · outer', [[1398, 2034]]),
    ...formats('Home button · large', [[1242, 2208]]), ...formats('Home button · medium', [[750, 1334]]),
    ...formats('Legacy · 4″', [[640, 1096], [640, 1136], [1136, 600], [1136, 640]], false),
    ...formats('Legacy · 3.5″', [[640, 920], [640, 960], [960, 600], [960, 640]], false),
  ] },
  ipad: { label: 'iPad', layout: 'tablet', formats: [
    ...formats('13″', [[2064, 2752], [2048, 2732]]),
    ...formats('11″', [[1668, 2420], [1668, 2388], [1640, 2360], [1488, 2266]]),
    ...formats('10.5″', [[1668, 2224]]),
    ...formats('9.7″', [[1536, 2008], [1536, 2048], [2048, 1496], [2048, 1536], [768, 1004], [768, 1024], [1024, 748], [1024, 768]], false),
  ] },
  watch: { label: 'Apple Watch', layout: 'phone', formats: [
    ...formats('Ultra 4 / 3', [[422, 514]], false), ...formats('Ultra 2 / Ultra', [[410, 502]], false),
    ...formats('Series 12 / 11 / 10', [[416, 496]], false), ...formats('Series 9 / 8 / 7', [[396, 484]], false),
    ...formats('SE / Series 6 / 5 / 4', [[368, 448]], false), ...formats('Series 3 / 2 / 1', [[312, 390]], false),
  ] },
  mac: { label: 'Mac', layout: 'wide', formats: formats('Mac', [[2880, 1800], [2560, 1600], [1440, 900], [1280, 800]], false) },
  tv: { label: 'Apple TV', layout: 'wide', formats: formats('Apple TV', [[3840, 2160], [1920, 1080]], false) },
  vision: { label: 'Apple Vision Pro', layout: 'wide', formats: formats('Apple Vision Pro', [[3840, 2160]], false) },
  ...PLAY_TARGETS,
  custom: { label: 'Custom / marketing', layout: 'phone', formats: [
    ...formats('Square', [[1080, 1080]], false), ...formats('Story', [[1080, 1920]], false), ...formats('Banner', [[1920, 1080]], false),
  ] },
};

export const TARGET_OPTIONS = [
  { group: 'Apple App Store', options: Object.entries(EXPORT_TARGETS).filter(([id, t]) => id !== 'custom' && !t.store).map(([id, t]) => [id, t.label]) },
  { group: 'Google Play', options: Object.entries(PLAY_TARGETS).map(([id, t]) => [id, t.label]) },
  ['custom', 'Custom / marketing'],
];
export const storeLabel = device => PLAY_TARGETS[exportTarget(device)] ? 'Google Play' : 'App Store Connect';

/** Old documents used a generic App Store label. Infer only from their declared platform, never from pixels. */
export function exportTarget(device) {
  if (device.target && device.target !== 'app-store') return Object.hasOwn(EXPORT_TARGETS, device.target) ? device.target : 'unknown';
  if (!device.target && !device.appStore) return 'custom';
  for (const name of [device.appStore, device.label, device.short]) {
    if (/\bwatch\b/i.test(name ?? '')) return 'watch';
    if (/\biphone\b/i.test(name ?? '')) return 'iphone';
    if (/\bipad\b/i.test(name ?? '')) return 'ipad';
    if (/\bvision\b/i.test(name ?? '')) return 'vision';
    if (/\b(?:apple\s*)?tv\b/i.test(name ?? '')) return 'tv';
    if (/\bmac(?:os|book)?\b/i.test(name ?? '')) return 'mac';
  }
  return 'unknown';
}

export function acceptedFormat(device) {
  const target = exportTarget(device);
  if (PLAY_TARGETS[target]) return playSizeAccepted(target, device.size) ? { label: PLAY_TARGETS[target].label, size: device.size } : undefined;
  return EXPORT_TARGETS[exportTarget(device)]?.formats.find(({ size }) => size[0] === device.size[0] && size[1] === device.size[1]);
}

export function canvasIssues(device) {
  const target = exportTarget(device);
  if (target === 'unknown') return [{ code: 'export-target', level: 'warn', message: 'Choose an export target in Setup → Canvases so its size can be checked.' }];
  if (PLAY_TARGETS[target] && !acceptedFormat(device)) return [{ code: `${target}-size`, level: 'warn', message: `${device.size.join(' × ')} px does not meet Google Play’s ${PLAY_TARGETS[target].label} requirements. ${PLAY_TARGETS[target].guidance}` }];
  if (target !== 'custom' && !acceptedFormat(device)) return [{ code: `${target}-size`, level: 'warn', message: `${device.size.join(' × ')} px is not an accepted ${EXPORT_TARGETS[target].label} App Store screenshot size. Choose a preset in Setup → Canvases.` }];
  return [];
}
