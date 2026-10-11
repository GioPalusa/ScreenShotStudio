// Measures a device-frame image: where the screen is, how round its corners are, and whether the
// screen is a transparent hole (Apple's product bezels) or painted into the frame (most mockups).
//
// DOM-free on purpose: it works on { width, height, data: RGBA bytes }, so the browser (frame import)
// and Node (tools/measure-frame.mjs) share one implementation.
//
//   measureFrameData({ width, height, data }) ->
//     { size: [w, h],
//       screen: { x, y, w, h, radius, mode },     // mode: "hole" | "overlay"
//       silhouette: { x, y, w, h } }               // bounding box of everything visible

const HOLE_ALPHA = 8;        // alpha below this counts as transparent
const OVERLAY_TOLERANCE = 28; // per-channel colour distance when the screen is painted into the frame

/** Scanline flood fill. Returns the mask plus the bounding box of what it filled. */
function floodFill(width, height, inside, startX, startY) {
  const mask = new Uint8Array(width * height);
  const stack = [startX, startY];
  let x0 = startX, y0 = startY, x1 = startX, y1 = startY, count = 0;
  while (stack.length) {
    const y = stack.pop();
    let x = stack.pop();
    if (y < 0 || y >= height || mask[y * width + x] || !inside(x, y)) continue;
    while (x > 0 && !mask[y * width + x - 1] && inside(x - 1, y)) x--;
    let spanUp = false;
    let spanDown = false;
    while (x < width && !mask[y * width + x] && inside(x, y)) {
      mask[y * width + x] = 1;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (y > 0) {
        const up = !mask[(y - 1) * width + x] && inside(x, y - 1);
        if (up && !spanUp) { stack.push(x, y - 1); spanUp = true; } else if (!up) spanUp = false;
      }
      if (y < height - 1) {
        const down = !mask[(y + 1) * width + x] && inside(x, y + 1);
        if (down && !spanDown) { stack.push(x, y + 1); spanDown = true; } else if (!down) spanDown = false;
      }
      x++;
    }
  }
  return { mask, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, count };
}

/**
 * Corner radius of each corner of the filled region, from how far the corner is cut away along the
 * diagonal: a circular corner of radius r leaves the pixel (k, k) outside until k + 0.5 >= r * (1 - 1/sqrt 2).
 * Returns a number when the corners agree, otherwise [topLeft, topRight, bottomRight, bottomLeft].
 */
export function estimateRadii(mask, width, box) {
  const { x, y, w, h } = box;
  const x1 = x + w - 1;
  const y1 = y + h - 1;
  const limit = Math.floor(Math.min(w, h) / 2);
  const walk = (sx, sy, dx, dy) => {
    for (let k = 0; k < limit; k++) if (mask[(sy + dy * k) * width + sx + dx * k]) return k;
    return limit;
  };
  const factor = 1 - Math.SQRT1_2;
  const radii = [walk(x, y, 1, 1), walk(x1, y, -1, 1), walk(x1, y1, -1, -1), walk(x, y1, 1, -1)]
    .map((k) => (k === 0 ? 0 : Math.round((k / factor) * 10) / 10));
  const mean = radii.reduce((a, b) => a + b, 0) / 4;
  const uniform = radii.every((r) => Math.abs(r - mean) <= Math.max(2, mean * 0.06));
  return uniform ? Math.round(mean * 10) / 10 : radii;
}

/** Like measureFrameData, but also returns the mask of the screen region (Uint8Array, 1 = screen) so callers can use its exact shape. */
export function analyzeFrameData({ width, height, data }) {
  const alpha = (px, py) => data[(py * width + px) * 4 + 3];

  // Silhouette: bounding box of everything that is not transparent.
  let sx0 = width, sy0 = height, sx1 = -1, sy1 = -1;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (alpha(px, py) >= HOLE_ALPHA) {
        if (px < sx0) sx0 = px;
        if (px > sx1) sx1 = px;
        if (py < sy0) sy0 = py;
        if (py > sy1) sy1 = py;
      }
    }
  }
  if (sx1 < 0) throw new Error('The image is completely transparent');

  const cx = width >> 1;
  const cy = height >> 1;
  let mode = 'hole';
  let inside = (px, py) => alpha(px, py) < HOLE_ALPHA;
  if (!inside(cx, cy)) {
    // No hole in the middle: the screen is painted into the frame. Take the flat region around the centre.
    mode = 'overlay';
    const i = (cy * width + cx) * 4;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    inside = (px, py) => {
      const j = (py * width + px) * 4;
      return data[j + 3] >= 200 && Math.abs(data[j] - r) <= OVERLAY_TOLERANCE && Math.abs(data[j + 1] - g) <= OVERLAY_TOLERANCE && Math.abs(data[j + 2] - b) <= OVERLAY_TOLERANCE;
    };
  }

  const { mask, box, count } = floodFill(width, height, inside, cx, cy);
  if (count < 64) throw new Error('Could not find a screen area in the middle of the frame');
  if (box.x === 0 || box.y === 0 || box.x + box.w === width || box.y + box.h === height) {
    throw new Error('The screen area reaches the edge of the image: the bezel must close around it (no gap in the frame)');
  }
  const radius = estimateRadii(mask, width, box);

  return {
    meta: {
      size: [width, height],
      screen: { ...box, radius, mode },
      silhouette: { x: sx0, y: sy0, w: sx1 - sx0 + 1, h: sy1 - sy0 + 1 },
    },
    mask,
  };
}

export const measureFrameData = (image) => analyzeFrameData(image).meta;
