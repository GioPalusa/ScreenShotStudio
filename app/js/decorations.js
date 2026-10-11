/** Canvas-space bounds of existing artwork, before an optional editable decorationBox transform. */
export function decorationBounds(layer, width, height) {
  let points;
  if (layer.matrix) {
    const [a, b, c, d, x, y] = layer.matrix;
    points = [[0, 0], [width, 0], [0, height], [width, height]].map(([px, py]) => [a * px + c * py + x, b * px + d * py + y]);
  } else {
    const w = layer.w ?? width, h = layer.h ?? w / (layer.aspect ?? width / height);
    const angle = (layer.rotate ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    points = [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]].map(([x, y]) => [layer.cx + x * c - y * s, layer.cy + x * s + y * c]);
  }
  const scale = layer.panoramaOffset === undefined ? 1 : layer.panoramaScale ?? 1;
  const xs = points.map(p => (p[0] - (layer.panoramaOffset ?? 0)) * scale);
  const ys = points.map(p => p[1] * scale + (layer.panoramaOffset === undefined ? 0 : layer.panoramaDy ?? 0));
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
