// Offline Google Play screenshot policy, separate from Apple's exact-size lists.
export const PLAY_SPEC_URL = 'https://support.google.com/googleplay/android-developer/answer/9866151';
export const PLAY_SPEC_CHECKED_AT = '2026-10-08';
const presets = (label, sizes, rotate = true) => sizes.flatMap(([w, h]) => [{ label, size: [w, h] }, ...(rotate && w !== h ? [{ label, size: [h, w] }] : [])]);
const large = label => ({ label, store: 'google-play', layout: 'tablet', minCount: 4, rule: 'large', family: 'android-tablet', formats: presets('16:9', [[1080, 1920], [1440, 2560], [2160, 3840], [4320, 7680]]), guidance: 'Large screens: 4–8 images, 1080–7680 px per edge, 16:9 or 9:16. Use in-app content without added text.' });
export const PLAY_TARGETS = {
  'play-phone': { label: 'Android phone', store: 'google-play', layout: 'phone', rule: 'phone', family: 'android-phone', formats: presets('Phone', [[1080, 1920], [1440, 2560], [1080, 2160]]), guidance: '320–3840 px per edge; longest edge at most twice the shortest. Up to 8 screenshots. For promotion, Google recommends at least 4 at 1080 × 1920 or 1920 × 1080.' },
  'play-tablet-7': large('Android tablet · 7″'),
  'play-tablet-10': large('Android tablet · 10″'),
  'play-chromebook': { ...large('Chromebook'), formats: presets('16:9', [[1920, 1080], [2560, 1440], [3840, 2160], [7680, 4320]]) },
  'play-wear': { label: 'Wear OS', store: 'google-play', layout: 'phone', minCount: 1, rule: 'wear', family: 'wear', raw: true, formats: presets('Square', [[454, 454], [384, 384], [480, 480]]), guidance: 'Only the app interface, full canvas. No bezel, added text, background or masking. Square, at least 384 × 384 px.' },
  'play-tv': { label: 'Android TV', store: 'google-play', layout: 'wide', minCount: 1, rule: 'phone', formats: presets('TV', [[1920, 1080], [3840, 2160]], false), guidance: 'At least one TV screenshot. A separate 1280 × 720 store banner is also required.' },
  'play-auto': { label: 'Android Automotive', store: 'google-play', layout: 'wide', rule: 'auto', raw: true, formats: presets('Automotive', [[1024, 768], [800, 1280]], false), guidance: 'If supplied, include at least 2 portrait (800 × 1280) and 2 landscape (1024 × 768) images. Use the generic Automotive emulator UI, without vehicle branding.' },
  'play-xr': { label: 'Android XR', store: 'google-play', layout: 'wide', minCount: 4, rule: 'xr', maxBytes: 8 * 1024 * 1024, formats: presets('8:5', [[3840, 2400], [1920, 1200]], false), guidance: '4–8 images, landscape 8:5, minimum 1920 × 1200, maximum 8 MB per image.' },
  'play-feature': { label: 'Feature graphic', store: 'google-play', layout: 'wide', asset: true, rule: 'exact', formats: presets('Feature graphic', [[1024, 500]], false), guidance: 'One 1024 × 500 feature graphic per language. Google recommends avoiding device imagery.' },
  'play-tv-banner': { label: 'Android TV banner', store: 'google-play', layout: 'wide', asset: true, rule: 'exact', formats: presets('Store banner', [[1280, 720]], false), guidance: 'One 1280 × 720 store banner per language; separate from the app’s launcher banner.' },
};

export function playSizeAccepted(target, size) {
  const spec = PLAY_TARGETS[target];
  if (!spec || !Array.isArray(size) || size.length !== 2 || !size.every(n => Number.isInteger(n) && n > 0)) return false;
  const [w, h] = size, lo = Math.min(w, h), hi = Math.max(w, h);
  if (spec.rule === 'exact' || spec.rule === 'auto') return spec.formats.some(f => f.size[0] === w && f.size[1] === h);
  if (spec.rule === 'large') return lo >= 1080 && hi <= 7680 && hi * 9 === lo * 16;
  if (spec.rule === 'wear') return w === h && lo >= 384 && hi <= 3840;
  if (spec.rule === 'xr') return w >= 1920 && h >= 1200 && w <= 3840 && w * 5 === h * 8;
  return lo >= 320 && hi <= 3840 && hi <= lo * 2;
}

/** Fresh canvas defaults; output dimensions and displayed hardware stay independent. */
export function playCanvasDefaults(target, size) {
  const spec = PLAY_TARGETS[target];
  if (!spec) return { frame: { type: 'plain' }, capture: '' };
  const model = target === 'play-phone' ? 'phone' : spec.rule === 'large' ? 'tablet' : null;
  return { capture: model ? `android-${model}` : target === 'play-wear' ? 'android-watch' : target.replace('play-', 'android-'), frame: model ? { type: 'android', model, orientation: size[0] > size[1] && model === 'tablet' ? 'landscape' : 'portrait', finish: 'graphite' } : { type: 'plain', screen: [...size], radius: 0 } };
}

export function playSelectionIssues(devices, count) {
  const issues = [], groups = new Map();
  let screenshots = 0;
  for (const device of devices) {
    const spec = PLAY_TARGETS[device.target];
    if (!spec) continue;
    const group = groups.get(device.target) ?? { spec, count: 0, portrait: 0, landscape: 0 };
    group.count += count;
    group[device.size[0] < device.size[1] ? 'portrait' : 'landscape'] += count;
    groups.set(device.target, group);
    if (!spec.asset) screenshots += count;
  }
  for (const { spec, count: n, portrait, landscape } of groups.values()) {
    const max = spec.asset ? 1 : 8;
    if (n > max) issues.push(`Google Play · ${spec.label}: ${n} images per language selected; maximum ${max} across all canvases for this asset type.`);
    if (spec.minCount && n < spec.minCount) issues.push(`Google Play · ${spec.label}: select at least ${spec.minCount} screenshots per language.`);
    if (spec.rule === 'auto' && (portrait < 2 || landscape < 2)) issues.push('Google Play · Automotive: select at least 2 portrait and 2 landscape screenshots per language.');
  }
  if ([...groups.values()].some(g => !g.spec.asset) && screenshots < 2) issues.push('Google Play requires at least 2 screenshots in total per language across the selected device types.');
  return issues;
}
