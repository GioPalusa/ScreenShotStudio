// Readability diagnostics use measured scenes, never change rendering or block export.
import { exportTarget, EXPORT_TARGETS, SPEC_URL, CREATIVE_SPEC_URL, PLAY_SPEC_URL } from './export-targets.js';
import { paintOrder } from './layouts.js';

export const TEXT_REVIEW_POLICY = {
  version: 1,
  widths: [160, 240, 320],
  minFontSize: 12,
  contrastTarget: 4.5,
  note: 'Widths simulate image display sizes, not fixed App Store placements. The 12 px size and 4.5:1 contrast targets are review heuristics, not Apple requirements or conversion guarantees.',
  contrastSource: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
};

export function reviewWidths(widths = TEXT_REVIEW_POLICY.widths) {
  if (!Array.isArray(widths) || !widths.length || widths.length > 4 || new Set(widths).size !== widths.length || widths.some(w => !Number.isInteger(w) || w < 80 || w > 1600)) throw new Error('Choose 1–4 unique preview widths from 80 to 1600 pixels.');
  return [...widths];
}

const round = n => Math.round(n * 100) / 100;
const visible = l => !l.hidden && !l.maskOnly && (l.opacity ?? 1) > 0 && !l.compositing?.some(s => (s.opacity ?? 1) === 0);
const complex = l => l.basis || l.blur || l.shadows?.length || l.maskMembership || l.textPaint && l.textPaint.type !== 'solid' || !['NORMAL', 'PASS_THROUGH', 'source-over', undefined].includes(l.blend) || l.compositing?.length;

// Only claim a contrast ratio when the entire text box has a known flat backdrop.
export function parseReviewColor(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim().replace(/^#/, '');
  if (!value.trim().startsWith('#') || !/^(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(s)) return null;
  if (s.length < 5) s = [...s].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255).concat(s.length === 8 ? parseInt(s.slice(6), 16) / 255 : 1);
}
const over = (fg, bg, opacity = 1) => fg.slice(0, 3).map((v, i) => v * fg[3] * opacity + bg[i] * (1 - fg[3] * opacity)).concat(1);
const luminance = c => c.slice(0, 3).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
export function contrastRatio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function boxFor(layer, effects = false) {
  const b = layer._box;
  if (!b) return null;
  const angle = (b.rot ?? 0) * Math.PI / 180;
  const w = Math.abs(b.w * Math.cos(angle)) + Math.abs(b.h * Math.sin(angle));
  const h = Math.abs(b.w * Math.sin(angle)) + Math.abs(b.h * Math.cos(angle));
  const pad = effects ? Math.max(layer.blur ?? 0, ...[layer.shadow, ...(layer.shadows ?? []), ...(layer.compositing ?? []).flatMap(s => [s.shadow, ...(s.shadows ?? [])])].filter(Boolean).map(s => (s.blur ?? 0) * 2 + Math.abs(s.dx ?? 0) + Math.abs(s.dy ?? 0)), 0) : 0;
  return { x: b.x + b.w / 2 - w / 2 - pad, y: b.y + b.h / 2 - h / 2 - pad, w: w + pad * 2, h: h + pad * 2 };
}
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

export function textContrast(scene, layer) {
  const unknown = reason => ({ status: 'unknown', reason });
  if (scene.allScreens || scene.transparent || complex(layer) || layer.shadow || layer.rotate || layer.dx) return unknown('Transformed, masked or effect-based text needs visual contrast review.');
  let bg = scene.theme.bg2 ? null : parseReviewColor(scene.theme.bg);
  if (bg?.[3] !== 1) bg = null;
  const box = boxFor(layer);
  if (!box) return unknown('Render the text before reviewing contrast.');
  const ordered = paintOrder(scene.layers), index = ordered.indexOf(layer);
  for (const other of ordered.slice(0, index)) {
    if (!visible(other)) continue;
    const b = boxFor(other, true);
    if (!b || complex(other)) return unknown('A transformed or unmeasured layer may affect the text backdrop.');
    if (!intersects(b, box)) continue;
    const rounded = other.radius || other.radii?.some(r => r > 0);
    const paints = other.paints ?? (other.gradient ? null : [{ type: 'solid', color: other.fill ?? '#ffffff' }]);
    const paint = paints?.length === 1 && paints[0].type === 'solid' ? parseReviewColor(paints[0].color) : null;
    if (other.type === 'shape' && other.shape === 'rect' && !rounded && !other.rotate && !other.stroke && !other.shadow && contains(b, box) && paint && (bg || paint[3] * (other.opacity ?? 1) === 1)) bg = over(paint, bg ?? [0, 0, 0, 1], other.opacity ?? 1);
    else bg = null;
  }
  for (const other of ordered.slice(index + 1)) {
    if (!visible(other)) continue;
    const b = boxFor(other, true);
    if (!b || complex(other) || intersects(b, box)) return unknown('An overlapping foreground layer may cover or alter this text.');
  }
  if (!bg) return unknown('Image, gradient, shadow or partial backdrop needs visual contrast review.');
  const fg = parseReviewColor(layer.textPaint?.color ?? layer.color ?? scene.theme.ink);
  if (!fg) return unknown('This text color needs visual contrast review.');
  const ratio = contrastRatio(over(fg, bg, layer.opacity ?? 1), bg);
  return { status: ratio < TEXT_REVIEW_POLICY.contrastTarget ? 'review' : 'measured', ratio: round(ratio), target: TEXT_REVIEW_POLICY.contrastTarget, method: 'sRGB relative luminance; known flat backdrop and composited text opacity; excludes glyph antialiasing' };
}

export function reviewPresentation(device) {
  const target = exportTarget(device), creative = Boolean(EXPORT_TARGETS[target]?.placementType), play = EXPORT_TARGETS[target]?.store === 'google-play', custom = ['custom', 'unknown'].includes(target);
  return { target, kind: creative ? 'creative-asset' : play ? 'google-play' : custom ? 'custom' : 'screenshot',
    label: EXPORT_TARGETS[target]?.label ?? 'Custom', specs: creative ? CREATIVE_SPEC_URL : play ? PLAY_SPEC_URL : custom ? null : SPEC_URL,
    cropVerified: false, note: creative ? 'Use this placement’s official template and App Store Connect Preview to verify cropping and safe areas.' : 'Diagnostic scaling preserves this image’s aspect ratio. Actual store presentation varies; verify in the store preview.' };
}

export function reviewSceneText(scene, { widths } = {}) {
  widths = reviewWidths(widths);
  const advisories = [], layers = [];
  const scope = { locale: scene.localeId, device: scene.deviceId, slide: scene.slideId };
  const add = (code, message, layer, extra = {}) => advisories.push({ code, message, ...scope, ...(layer ? { layer: layer._sharedId ?? layer.id } : {}), ...extra });
  for (const layer of scene.layers.filter(l => l.type === 'text' && visible(l))) {
    const t = scene.texts[layer.id];
    if (!t || !Number.isFinite(t.size) || !t.lines) continue;
    // A basis can scale/shear the glyphs; report nominal size, not false precision.
    const transformed = Boolean(layer.basis);
    const previews = widths.map(width => ({ width, fontSize: transformed ? null : round(t.size * width / scene.W) }));
    const contrast = textContrast(scene, layer);
    layers.push({ id: layer._sharedId ?? layer.id, field: t.field, size: t.size, lines: t.lines, lineTexts: t.lineTexts, shrink: t.shrink, fallback: t.fallback, overflow: t.overflow, previews, contrast,
      ...(transformed ? { sizeNote: 'Nominal size before affine transformation. Inspect the rendered glyphs.' } : {}) });
    const small = previews.filter(p => p.fontSize !== null && p.fontSize < TEXT_REVIEW_POLICY.minFontSize);
    if (small.length) add('text-small-preview', `“${t.field}” is ${small[0].fontSize} px at ${small[0].width} px image width. Shorten, enlarge or remove secondary text; inspect the preview.`, layer, { previews: small });
    if (contrast.status === 'review') add('text-low-contrast', `“${t.field}” has ${contrast.ratio}:1 contrast; review against the ${contrast.target}:1 readability target.`, layer);
  }
  // Distinct sizes are a diagnostic for competing hierarchy, not a universal limit.
  const tiers = new Set(layers.map(l => Math.round(l.size)));
  if (tiers.size > 3) add('text-hierarchy', `${tiers.size} text sizes compete on this image. Consider one main promise with optional supporting text.`);
  return { ...scope, designSize: [scene.W, scene.H], presentation: reviewPresentation(scene.deviceDef), layers, advisories };
}

export function textReviewReport(scenes, widths) {
  return { ...TEXT_REVIEW_POLICY, widths: reviewWidths(widths), status: 'visual-review-required', scenes, advisories: scenes.flatMap(s => s.advisories),
    note: TEXT_REVIEW_POLICY.note + ' Only editable text layers are measured; text inside captures or artwork requires visual review. Technical ready is independent of these advisories.' };
}
