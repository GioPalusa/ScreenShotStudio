// WheelEvent uses pixels for a trackpad, lines/pages for some mice. Keep the
// fractional deltas: rounding them makes slow gestures feel like fixed steps.
export function wheelPixels(event, pageHeight) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  const x = event.deltaX * unit, y = event.deltaY * unit;
  return event.shiftKey && !x && !event.ctrlKey ? { x: y, y: 0 } : { x, y };
}

// Chromium delivers trackpad pinches as ctrl-wheel. Multiplicative scaling
// makes equal finger movements feel consistent at every magnification.
export function pinchZoom(current, delta, min, max) {
  return Math.max(min, Math.min(max, current * Math.exp(-delta * .01)));
}

export function pointInRect(point, rect) {
  return { x: (point.x - rect.left) / rect.width, y: (point.y - rect.top) / rect.height };
}
