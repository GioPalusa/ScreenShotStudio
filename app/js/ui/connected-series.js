import { engine } from '../store.js';
import { connectedGeometry } from '../connected-series.js';
import { drawPreviewDevice } from './composition-preview.js';
import { storySampleCopy } from '../story-templates.js';
import { layoutText, capHeight, drawLines } from '../text.js';

export function drawConnectedPreview(canvas, options) {
  const geometry = connectedGeometry(options), { W, H, total, offsets } = geometry;
  const width = Math.min(options.previewWidth ?? 410, (options.previewHeight ?? 190) * total / H), height = width * H / total, scale = width * 2 / total;
  canvas.width = Math.round(width * 2); canvas.height = Math.round(height * 2);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const c = canvas.getContext('2d'); c.scale(scale, scale);
  for (const [tile, offset] of offsets.entries()) {
    const palette = geometry.panels?.[tile].colors ?? options.palette;
    c.save(); c.beginPath(); c.rect(offset, 0, W, H); c.clip();
    c.fillStyle = palette.bg; c.fillRect(offset, 0, W, H);
    const drawShapes = list => { for (const s of list) {
      if (s.tile != null && s.tile !== tile) continue;
      c.save(); engine.drawShape(c, { px: scale }, { ...s }); c.restore();
    } };
    drawShapes(geometry.shapes);
    for (const b of geometry.devices) {
      if ((b.tile != null && b.tile !== tile) || (b.tiles && !b.tiles.includes(tile))) continue;
      drawPreviewDevice(c, b, options.ratio, options.palette, options.frame, options.images?.[b.captureIndex], scale);
    }
    drawShapes(geometry.foregroundShapes ?? []);
    for (const layer of geometry.texts ?? []) {
      if (geometry.offsets[layer.tile] !== offset) continue;
      const family = layer.fontFamily, layout = layoutText(c, storySampleCopy(options.designId, layer.tile)[layer.field], { family, weight: layer.weight, size: layer.size, minSize: layer.minSize, maxLines: layer.maxLines,
        boxW: layer.w, lang: 'en-US', dir: 'ltr', lineHeight: layer.lineHeight, balanced: false, maxHeight: layer.boxHeight, heightIncludesGlyphs: true });
      drawLines(c, layout, { x: offset + layer.x, w: layer.w, firstBaseline: layer.capTop + capHeight(c, { family, weight: layer.weight, size: layout.size }), align: layer.align, block: layer.block, dir: 'ltr', weight: layer.weight, family, color: layer.color ?? options.palette.ink, opacity: layer.opacity ?? 1 });
    }
    c.restore();
  }
}

/** Imports open the same gallery, with the imported screenshot count already selected. */
export async function openConnectedSeries(options) {
  const { openNewDesignGallery } = await import('./design-gallery.js');
  return openNewDesignGallery({ ...options, initialCount: Math.max(2, Math.min(5, options.captures?.length || 3)) });
}
