// Presets and export checks share the same source of accepted dimensions.
import { EXPORT_TARGETS, exportTarget } from './export-targets.js';
export { SPEC_URL } from './export-targets.js';

export const SIZE_PRESETS = Object.entries(EXPORT_TARGETS).map(([target, definition]) => ({
  target, group: definition.label,
  items: definition.formats.map(({ label, size: [w, h] }) => [`${label} · ${w} × ${h}`, w, h]),
}));

/** The layout families (STYLE in layouts.js): what a device's typography and spacing are modelled on. */
export const LAYOUT_FAMILIES = [
  ['phone', 'Phone (tall, narrow)'],
  ['tablet', 'Tablet'],
  ['wide', 'Wide (landscape)'],
  ['outer', 'Compact tall (Duo outer display)'],
];

/** Store formats are selected from the catalog; legacy dimensions remain readable. */
export function canvasSizeOptions(target, currentSize = null) {
  const allOptions = SIZE_PRESETS.filter(group => group.target === target).flatMap(group => group.items.map(([label, w, h]) => [`${w}x${h}`, label]));
  const key = currentSize?.join('x');
  const seen = new Set();
  const options = allOptions.filter(([id]) => {
    const pair = id.split('x').map(Number).sort((a, b) => a - b).join('x');
    if (seen.has(pair)) return false;
    seen.add(pair); return true;
  }).map(option => {
    const reverse = option[0].split('x').reverse().join('x');
    return key === reverse ? allOptions.find(([id]) => id === key) ?? option : option;
  });
  if (key && !options.some(([id]) => id === key)) options.unshift([key, `Current format · ${currentSize.join(' × ')} px`]);
  return options;
}

export function existingStoreCanvas(devices, target, size) {
  if (target === 'custom') return null;
  return Object.entries(devices).find(([, device]) => exportTarget(device) === target && (device.size[0] === size[0] && device.size[1] === size[1] || device.size[0] === size[1] && device.size[1] === size[0]))?.[0] ?? null;
}
