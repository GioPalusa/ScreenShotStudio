// Geometry operations shared by keyboard, inspector and direct manipulation.
export function selectionBounds(layers) {
  const boxes = layers.map(l => l._box).filter(Boolean).map(b => {
    const angle = (b.rot ?? 0) * Math.PI / 180;
    const w = Math.abs(b.w * Math.cos(angle)) + Math.abs(b.h * Math.sin(angle));
    const h = Math.abs(b.w * Math.sin(angle)) + Math.abs(b.h * Math.cos(angle));
    return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
  });
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
}

/** Uniform group transform. Members retain their proportions and relative angles. */
export function transformSelection(members, start, next) {
  const scale = next.w / start.w, rotation = (next.rot ?? 0) - (start.rot ?? 0);
  const angle = rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return members.map(({ layer, box }) => {
    const x = (box.x + box.w / 2 - start.x - start.w / 2) * scale;
    const y = (box.y + box.h / 2 - start.y - start.h / 2) * scale;
    const w = box.w * scale, h = box.h * scale;
    return { layer, scale, box: { x: next.x + next.w / 2 + x * c - y * s - w / 2, y: next.y + next.h / 2 + x * s + y * c - h / 2, w, h, rot: (box.rot ?? 0) + rotation } };
  });
}

export function arrangeSelection(layers, operation, canvas) {
  const items = layers.filter(l => l._box && !l.locked);
  const bounds = items.length === 1 ? { x: 0, y: 0, w: canvas.W, h: canvas.H } : selectionBounds(items);
  if (!bounds) return [];
  const visible = layer => selectionBounds([layer]);
  const axis = operation.endsWith('x') ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  if (operation.startsWith('distribute')) {
    if (items.length < 3) return [];
    const sorted = [...items].sort((a, b) => visible(a)[axis] - visible(b)[axis]);
    const gap = (bounds[size] - sorted.reduce((sum, l) => sum + visible(l)[size], 0)) / (sorted.length - 1);
    let cursor = bounds[axis];
    return sorted.map(layer => { const bounds = visible(layer); const box = { ...layer._box, [axis]: layer._box[axis] + cursor - bounds[axis] }; cursor += bounds[size] + gap; return { layer, box }; });
  }
  return items.map(layer => {
    const box = { ...layer._box }, current = visible(layer);
    if (operation === 'left') box.x += bounds.x - current.x;
    if (operation === 'right') box.x += bounds.x + bounds.w - current.x - current.w;
    if (operation === 'top') box.y += bounds.y - current.y;
    if (operation === 'bottom') box.y += bounds.y + bounds.h - current.y - current.h;
    if (operation === 'center-x') box.x = bounds.x + (bounds.w - box.w) / 2;
    if (operation === 'center-y') box.y = bounds.y + (bounds.h - box.h) / 2;
    return { layer, box };
  });
}
