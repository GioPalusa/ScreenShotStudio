// Original Studio artwork: a neutral rim that follows the displayed screen's geometry.
export function genericFrame({ screen, family = null }) {
  return { type: 'generic', screen: [...screen], ...(family ? { family } : {}) };
}

/** Shared outer dimensions for layout, previews and export. */
export function genericGeometry(ref) {
  const [sw, sh] = ref.screen;
  const rim = Math.max(4, Math.round(Math.min(sw, sh) * .025));
  const radius = ref.radius ?? Math.min(sw, sh) * (['watch', 'wear'].includes(ref.family) ? .15 : ['ipad', 'android-tablet'].includes(ref.family) ? .025 : ['mac', 'tv', 'vision'].includes(ref.family) ? .015 : .09);
  return { screen: [sw, sh], size: [sw + rim * 2, sh + rim * 2], rim, radius };
}
