import { Engine } from './render.js';
import { preflightScene, preflightSelection } from './preflight.js';
import { orderedSlides, slideSupportsCanvas } from './slide-order.js';
import { sharedGeometry } from './shared-canvas.js';
import { fontAvailable } from './ui/export.js';
import { APP_STORE_ASSET_GUIDANCE, appStoreCopyAdvisories } from './app-store-asset-guidance.js';

/** Render and check a frozen selection, with one labelled row per canvas/language. */
export async function inspectProject({ locales, devices, slides, checkOnly = false }) {
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
  const rows = [], advisories = []; let checked = 0;
  try {
    for (const locale of locales) for (const device of devices) {
      const selected = orderedSlides(frozen.project, locale, device).filter(s => slides.some(slide => slide.id === s.id));
      if (!selected.length) continue;
      const row = { label: `${frozen.project.devices[device].label ?? device} · ${locale}`, images: [] };
      const geometry = sharedGeometry(frozen.project, device, locale);
      for (const slide of selected) {
        if (!slideSupportsCanvas(frozen.project, slide, device)) continue;
        const scene = frozen.scene(slide.id, device, locale), canvas = document.createElement('canvas');
        await frozen.render(canvas, scene, { scale: Math.min(1, 600 / scene.W) });
        issues.push(...preflightScene(scene, frozen.data, { fontAvailable, checkCanvas: false }).map(issue => ({ ...issue, locale, device, slide: slide.id })));
        advisories.push(...appStoreCopyAdvisories(scene, layer => frozen.copyFor(locale, layer.copySlideId ?? slide.id, layer.field)?.value));
        checked++;
        if (!checkOnly) row.images.push({ canvas, label: slide.name ?? slide.id, gapRatio: geometry.gap / (scene.W || 1) });
      }
      if (!checkOnly) rows.push(row);
    }
    if (!checked) throw new Error('No matching screen/canvas pairs to check. Select a compatible screen and canvas.');
    const report = { checked, errors: issues.filter(i => i.level === 'error').length, warnings: issues.filter(i => i.level !== 'error').length, issues };
    const result = { ready: issues.length === 0, report, selection: { locales, devices, slides: slides.map(s => s.id) }, assetReview: {
      ...APP_STORE_ASSET_GUIDANCE, status: 'visual-review-required', advisories,
      note: 'ready describes technical preflight only. Review images and claims against the linked guidance; automated checks do not establish App Store approval.',
    } };
    if (checkOnly) return result;
    if (!rows.length) throw new Error('No matching screen/canvas pairs to preview.');
    const W = 1440, pad = 24;
    const heights = rows.map(row => Math.min(420, (W - 2 * pad) / row.images.reduce((sum, i) => sum + i.canvas.width / i.canvas.height * (1 + i.gapRatio), 0)));
    const H = Math.ceil(pad + heights.reduce((sum, height) => sum + height + 80, 0));
    if (H > 8000) throw new Error('Preview is too tall. Select fewer locales or canvases.');
    const sheet = document.createElement('canvas'); sheet.width = W; sheet.height = H;
    const ctx = sheet.getContext('2d'); ctx.fillStyle = '#eeecf0'; ctx.fillRect(0, 0, W, H);
    let y = pad;
    for (const [index, row] of rows.entries()) {
      ctx.fillStyle = '#272330'; ctx.font = '600 19px system-ui'; ctx.fillText(row.label, pad, y + 20); y += 34;
      let x = pad;
      for (const item of row.images) {
        const height = heights[index], width = height * item.canvas.width / item.canvas.height;
        ctx.drawImage(item.canvas, x, y, width, height);
        ctx.font = '13px system-ui'; ctx.fillText(item.label, x, y + height + 20, Math.max(1, width));
        x += width * (1 + item.gapRatio);
      }
      y += heights[index] + 46;
    }
    return { ...result, image: sheet.toDataURL('image/jpeg', .88).split(',')[1] };
  } finally { await post('/api/export/abort', { id: snapshot.id }); }
}
