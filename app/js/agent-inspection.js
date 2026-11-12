import { Engine } from './render.js';
import { preflightScene, preflightSelection } from './preflight.js';
import { orderedSlides, slideSupportsCanvas } from './slide-order.js';
import { sharedGeometry } from './shared-canvas.js';
import { fontAvailable } from './ui/export.js';
import { APP_STORE_ASSET_GUIDANCE, appStoreCopyAdvisories } from './app-store-asset-guidance.js';
import { reviewSceneText, textReviewReport, reviewWidths } from './text-review.js';

/** Render and check a frozen selection, with one labelled row per canvas/language. */
export async function inspectProject({ locales, devices, slides, checkOnly = false, details = false, previewWidth }) {
  if (previewWidth !== undefined && (!Number.isInteger(previewWidth) || previewWidth < 80 || previewWidth > 640)) throw new Error('Preview width must be an integer from 80 to 640 pixels.');
  const widths = reviewWidths([...new Set([160, 240, 320, ...(previewWidth ? [previewWidth] : [])])]);
  const post = async (url, body) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Inspection failed.');
    return result;
  };
  if (!checkOnly && locales.length * devices.length > 12) throw new Error('Preview up to 12 canvas/language rows at a time. Select fewer locales or canvases.');
  const snapshot = await post('/api/export/start', { mode: 'draft', selection: { locales, devices, slides: slides.map(s => s.id) } });
  const frozen = new Engine(); frozen.setData(snapshot.bundle); frozen.projectURL = snapshot.projectURL;
  const issues = preflightSelection(frozen.project, devices, slides).map(message => ({ level: 'error', code: 'selection', message }));
  const rows = [], advisories = [], scenes = [], textReviews = []; let checked = 0, detailCount = 0;
  try {
    for (const locale of locales) for (const device of devices) {
      const selected = orderedSlides(frozen.project, locale, device).filter(s => slides.some(slide => slide.id === s.id));
      if (!selected.length) continue;
      const row = { label: `${frozen.project.devices[device].label ?? device} · ${locale}`, images: [] };
      const geometry = sharedGeometry(frozen.project, device, locale);
      for (const slide of selected) {
        if (!slideSupportsCanvas(frozen.project, slide, device)) continue;
        const scene = frozen.scene(slide.id, device, locale), canvas = document.createElement('canvas');
        await frozen.render(canvas, scene, { scale: Math.min(scene.k, Math.max(600, previewWidth ?? 0) / scene.W) });
        textReviews.push(reviewSceneText(scene, { widths }));
        if (details) {
          detailCount += scene.layers.length;
          if (detailCount > 5000) throw new Error('Inspect up to 5000 rendered layers at a time. Select fewer screens or languages.');
          scenes.push({ locale, device, slide: slide.id, size: [Math.round(scene.W * scene.k), Math.round(scene.H * scene.k)], designSize: [scene.W, scene.H], outputScale: scene.k,
            layers: scene.layers.map(layer => {
              const capture = scene.assets?.captures?.[layer.id];
              return { id: layer._sharedId ?? layer.id, type: layer.type, name: layer.name ?? layer.id,
                scope: layer._sharedId ? { device, shared: true } : { device, slide: slide.id, ...(slide.localeLayouts?.[locale]?.[device] ? { locale } : {}) },
                bounds: layer._box ? { ...layer._box } : null,
                ...(layer._sharedId ? { rowOffset: -(layer._offsetX ?? 0) } : {}),
                ...(layer.group ? { group: layer.group, groupName: layer.groupName ?? 'Group' } : {}),
                ...(layer.type === 'text' ? { text: { ...scene.texts[layer.id], value: frozen.copyFor(locale, layer.copySlideId ?? slide.id, layer.field)?.value ?? '', fontFamily: layer.fontFamily ?? scene.fonts.family, empty: Boolean(layer._empty) } } : {}),
                ...(layer.type === 'device' ? { capture: { name: layer.capture, missing: Boolean(capture?.missing || !layer.capture), localized: Boolean(capture?.localized), ...(capture?.image ? { size: [capture.image.naturalWidth, capture.image.naturalHeight] } : {}), screenSize: layer._screenSize } } : {}) };
            }) });
        }
        issues.push(...preflightScene(scene, frozen.data, { fontAvailable, checkCanvas: false }).map(issue => ({ ...issue, locale, device, slide: slide.id })));
        advisories.push(...appStoreCopyAdvisories(scene, layer => frozen.copyFor(locale, layer.copySlideId ?? slide.id, layer.field)?.value));
        checked++;
        if (!checkOnly) row.images.push({ canvas, label: slide.name ?? slide.id, gapRatio: geometry.gap / (scene.W || 1) });
      }
      if (!checkOnly) rows.push(row);
    }
    if (!checked) throw new Error('No matching screen/canvas pairs to check. Select a compatible screen and canvas.');
    const report = { checked, errors: issues.filter(i => i.level === 'error').length, warnings: issues.filter(i => i.level !== 'error').length, issues };
    const result = { ready: issues.length === 0, report, textReview: textReviewReport(textReviews, widths), selection: { locales, devices, slides: slides.map(s => s.id) }, ...(details ? { revisions: snapshot.bundle.revisions, scenes } : {}), assetReview: {
      ...APP_STORE_ASSET_GUIDANCE, status: 'visual-review-required', advisories,
      note: 'ready describes technical preflight only. Review images and claims against the linked guidance; automated checks do not establish App Store approval.',
    } };
    if (checkOnly) return result;
    if (!rows.length) throw new Error('No matching screen/canvas pairs to preview.');
    // Explicit diagnostic widths keep every tile at the requested nominal image width.
    // Split long rows instead of shrinking a tile to fit the contact sheet.
    if (previewWidth) {
      const split = [];
      for (const row of rows) {
        let images = [], used = 0;
        for (const item of row.images) {
          const w = previewWidth * (1 + item.gapRatio);
          if (images.length && used + w > 1392) { split.push({ label: row.label, images }); images = []; used = 0; }
          images.push(item); used += w;
        }
        if (images.length) split.push({ label: row.label, images });
      }
      rows.splice(0, rows.length, ...split);
      result.preview = { imageWidth: previewWidth, scaling: 'diagnostic', cropVerified: false };
    }
    const W = 1440, pad = 24;
    const heights = rows.map(row => previewWidth ? Math.max(...row.images.map(i => previewWidth * i.canvas.height / i.canvas.width)) : Math.min(420, (W - 2 * pad) / row.images.reduce((sum, i) => sum + i.canvas.width / i.canvas.height * (1 + i.gapRatio), 0)));
    const H = Math.ceil(pad + heights.reduce((sum, height) => sum + height + 80, 0));
    if (H > 8000) throw new Error('Preview is too tall. Select fewer locales or canvases.');
    const sheet = document.createElement('canvas'); sheet.width = W; sheet.height = H;
    const ctx = sheet.getContext('2d'); ctx.fillStyle = '#eeecf0'; ctx.fillRect(0, 0, W, H);
    let y = pad;
    for (const [index, row] of rows.entries()) {
      ctx.fillStyle = '#272330'; ctx.font = '600 19px system-ui'; ctx.fillText(row.label + (previewWidth ? ` · ${previewWidth} px image width (diagnostic)` : ''), pad, y + 20); y += 34;
      let x = pad;
      for (const item of row.images) {
        const width = previewWidth ?? heights[index] * item.canvas.width / item.canvas.height, height = width * item.canvas.height / item.canvas.width;
        ctx.drawImage(item.canvas, x, y, width, height);
        ctx.font = '13px system-ui'; ctx.fillText(item.label, x, y + height + 20, Math.max(1, width));
        x += width * (1 + item.gapRatio);
      }
      y += heights[index] + 46;
    }
    return { ...result, image: sheet.toDataURL('image/jpeg', .88).split(',')[1] };
  } finally { await post('/api/export/abort', { id: snapshot.id }); }
}
