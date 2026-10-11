// Original, brand-neutral Studio illustrations. These are not manufacturer product artwork.
export const ANDROID_HARDWARE = {
  phone: { label: 'Android phone', screen: [1080, 2400], radius: 84, rim: 28 },
  tablet: { label: 'Android tablet', screen: [1600, 2560], radius: 38, rim: 70 },
  foldable: { label: 'Android foldable · open', screen: [2208, 1840], radius: 46, rim: 36 },
  watch: { label: 'Wear OS watch', screen: [454, 454], radius: 227, rim: 36 },
};
export function androidGeometry(ref) {
  const spec = ANDROID_HARDWARE[ref.model] ?? ANDROID_HARDWARE.phone;
  const screen = [...spec.screen];
  if ((ref.orientation === 'landscape' && screen[0] < screen[1]) || (ref.orientation === 'portrait' && screen[0] > screen[1])) screen.reverse();
  return { ...spec, screen, size: screen.map(n => n + spec.rim * 2) };
}

export const ANDROID_FRAMES = Object.entries(ANDROID_HARDWARE).flatMap(([model, spec]) =>
  (model === 'watch' ? [null] : ['portrait', 'landscape']).flatMap(orientation => ['graphite', 'silver'].map(finish => ({
    ref: { type: 'android', model, ...(orientation ? { orientation } : {}), finish },
    label: `${spec.label}${orientation ? ` · ${orientation}` : ''} · ${finish === 'silver' ? 'Silver' : 'Graphite'}`,
  }))));
