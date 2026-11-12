// Remove only image paints explicitly skipped by the user; keep other editable content.
export function skipClipboardImages(design, skipped) {
  const layers = design.layers.map(source => {
    const layer = structuredClone(source);
    if (layer.paints) layer.paints = layer.paints.filter(paint => paint.type !== 'image' || !skipped.has(paint.ref));
    return layer;
  }).filter(layer => !(layer.type === 'shape' && layer.paints?.length === 0 && ['transparent', '#00000000'].includes(layer.fill) && !layer.stroke && !layer.maskOnly));
  return { ...design, layers, images: [...new Set(layers.flatMap(layer => (layer.paints ?? []).filter(p => p.type === 'image').map(p => p.ref)))] };
}
