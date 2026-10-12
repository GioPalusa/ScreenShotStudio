// Canvas text engine: wrapping (including CJK), balanced lines, fit-to-box, bidi-aware drawing.
//
// Everything works in "design pixels" - the same units the layouts use - and never touches the
// DOM, so the preview, the thumbnails and the exporter produce identical results.

// Characters that must not start / end a line in Japanese and Chinese typesetting (kinsoku shori).
const NO_LINE_START = new Set('、。，．・：；？！）〕］｝〉》」』】〙〗〟’”ー々ゝゞヽヾ…‥％'.split(''));
const NO_LINE_END = new Set('（〔［｛〈《「『【〘〖〝‘“'.split(''));
const NO_SPACE_LANGS = new Set(['ja', 'zh', 'th', 'lo', 'km', 'my']);
const KATAKANA = /[\u30A1-\u30FA\u30FC\u31F0-\u31FF]/;

const segmenters = new Map();
function segmenterFor(lang) {
  if (!segmenters.has(lang)) segmenters.set(lang, new Intl.Segmenter(lang, { granularity: 'word' }));
  return segmenters.get(lang);
}

/** Split text into unbreakable units and report how to join them back together. */
export function tokenize(text, lang = 'en') {
  const base = lang.split('-')[0];
  if (NO_SPACE_LANGS.has(base) && typeof Intl.Segmenter === 'function') {
    const parts = [...segmenterFor(lang).segment(text)].map((s) => s.segment).filter((s) => s.trim() !== '');
    const units = [];
    for (const part of parts) {
      const prev = units[units.length - 1];
      // keep closing punctuation with the word before it, and never split a katakana word (ワーク|アウト)
      if (prev && (NO_LINE_START.has(part[0]) || (KATAKANA.test(prev.slice(-1)) && KATAKANA.test(part[0])))) units[units.length - 1] += part;
      else units.push(part);
    }
    for (let i = units.length - 2; i >= 0; i--) {
      if (NO_LINE_END.has(units[i].slice(-1))) { units[i] += units[i + 1]; units.splice(i + 1, 1); }
    }
    return { units, sep: '' };
  }
  return { units: text.trim().split(/\s+/).filter(Boolean), sep: ' ' };
}

function wrap(units, sep, maxWidth, measure) {
  const lines = [];
  let cur = '';
  for (const unit of units) {
    const next = cur ? cur + sep + unit : unit;
    if (!cur || measure(next) <= maxWidth) cur = next;
    else { lines.push(cur); cur = unit; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Narrowest wrap width that still gives the same number of lines, so ragged lines even out
 * (like CSS text-wrap: balance). The final wrap uses a hair more than the narrowest width: when two
 * splits are nearly equally balanced this prefers the one with the longer first line, which reads
 * as a more natural headline shape.
 */
function balance(units, sep, maxWidth, targetLines, measure) {
  let lo = Math.max(...units.map((u) => measure(u)));
  let hi = maxWidth;
  if (lo >= hi) return null;
  for (let i = 0; i < 16 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(units, sep, mid, measure).length <= targetLines) hi = mid; else lo = mid;
  }
  const relaxed = wrap(units, sep, Math.min(maxWidth, hi * 1.04), measure);
  return relaxed.length <= targetLines ? relaxed : wrap(units, sep, hi, measure);
}

export const fontString = (weight, size, family) => `${weight} ${size}px ${family}`;

function applyContext(ctx, { weight, size, family, lang, dir }) {
  ctx.font = fontString(weight, size, family);
  ctx.direction = dir;
  if ('lang' in ctx) ctx.lang = lang;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fontKerning = 'normal';
  ctx.textRendering = 'optimizeLegibility';
}

/**
 * Lay text out in a box.
 *
 *   text      a string (a block; "\n" forces a line break) or an array of strings (list items)
 *   size      the largest size to use - text only shrinks, down to minSize, when it has to
 *   maxLines  hard limit; 0 means unlimited; a longer translation shrinks until it fits
 *   boxW      available width
 *   fitFrame  grow or shrink to the full box width/height, preserving explicit line breaks
 *   marker    list marker for array input, e.g. "–"; continuation lines hang under the text
 *
 * Returns { size, lines:[{text,width,marker,hang}], maxW, ok, overflow, overflowReasons, shrink, lineHeightPx }.
 */
export function layoutText(ctx, text, o) {
  const {
    family, weight = 700, size: requestedSize, minSize: requestedMinSize, maxLines: requestedMaxLines = 99, boxW,
    lang = 'en', dir = 'ltr', lineHeight = 1.2, balanced = true, marker = '', itemGap = 0, oneLine = 0, maxHeight = Infinity, heightIncludesGlyphs = false,
  } = o;
  const fillFrame = o.fitFrame && Number.isFinite(maxHeight) && maxHeight > 0;
  const maxSize = fillFrame ? Math.max(boxW, maxHeight) * 4 : requestedSize;
  const minSize = fillFrame ? 1 : requestedMinSize ?? maxSize * 0.5;
  const maxLines = fillFrame || requestedMaxLines === 0 ? Infinity : requestedMaxLines;

  // Wide canvases: if the whole text fits on one line without dropping below `oneLine` x size, prefer
  // that over the hard line breaks the copy was written with for the narrower phone layout.
  if (!fillFrame && oneLine && !Array.isArray(text) && String(text).includes('\n')) {
    const joined = layoutText(ctx, String(text).replace(/\s*\n\s*/g, ' '), { ...o, oneLine: 0, maxLines: 1, minSize: maxSize * oneLine });
    if (joined.ok) return joined;
  }

  const items = Array.isArray(text) ? text.map(String) : [String(text ?? '')];
  const tokenized = items.map((item) => item.split('\n').map((segment) => tokenize(segment, lang)));

  const attempt = (size) => {
    applyContext(ctx, { weight, size, family, lang, dir });
    const measure = (s) => ctx.measureText(s).width;
    const hang = marker ? measure(marker + ' ') : 0;
    const available = boxW - hang;
    const lines = [];
    tokenized.forEach((segments, itemIndex) => {
      segments.forEach(({ units, sep }, segmentIndex) => {
        if (!units.length) { lines.push({ text: '', width: 0, hang, gapBefore: 0 }); return; }
        let wrapped = wrap(units, sep, available, measure);
        if (balanced && wrapped.length > 1 && !marker) wrapped = balance(units, sep, available, wrapped.length, measure) ?? wrapped;
        wrapped.forEach((line, lineIndex) => {
          const first = segmentIndex === 0 && lineIndex === 0;
          lines.push({
            text: line,
            width: measure(line) + hang,
            hang,
            marker: marker && first ? marker : '',
            gapBefore: first && itemIndex > 0 ? itemGap * size : 0,
          });
        });
      });
    });
    const maxW = Math.max(0, ...lines.map((l) => l.width));
    // distance from the first baseline to the last (what has to fit between two fixed points on the slide)
    const height = lines.reduce((h, l, i) => h + (i ? size * lineHeight : 0) + l.gapBefore, 0);
    const glyphs = lines.map(line => ctx.measureText(line.text || 'H'));
    const ascent = Math.max(0, ...glyphs.map(m => m.actualBoundingBoxAscent ?? size * 0.75));
    const descent = Math.max(0, ...glyphs.map(m => m.actualBoundingBoxDescent ?? size * 0.2));
    const measuredHeight = height + (heightIncludesGlyphs || fillFrame ? ascent + descent : 0);
    const overflowReasons = [];
    if (!(lines.length <= maxLines)) overflowReasons.push({ code: 'lines', actual: lines.length, limit: maxLines });
    if (!(maxW <= boxW + 0.5)) overflowReasons.push({ code: 'width', actual: maxW, limit: boxW });
    if (!(measuredHeight <= maxHeight)) overflowReasons.push({ code: 'height', actual: measuredHeight, limit: maxHeight });
    return { size, lines, maxW, ascent, descent, overflowReasons, ok: overflowReasons.length === 0 };
  };

  let result = attempt(maxSize);
  if (!result.ok && minSize < maxSize) {
    const smallest = attempt(minSize);
    if (!smallest.ok) {
      result = smallest;
      result.overflow = true;
    } else {
      let lo = minSize, hi = maxSize, best = smallest;
      for (let i = 0; i < 16 && hi - lo > 0.5; i++) {
        const mid = (lo + hi) / 2;
        const t = attempt(mid);
        if (t.ok) { best = t; lo = mid; } else hi = mid;
      }
      result = best;
    }
  } else if (!result.ok) {
    result.overflow = true;
  }
  result.overflow = Boolean(result.overflow);
  result.shrink = result.size / requestedSize;
  result.lineHeightPx = result.size * lineHeight;
  result.height = result.lines.reduce((h, l, i) => h + (i ? result.lineHeightPx : 0) + l.gapBefore, 0);
  return result;
}

/** The inspector and export preflight explain the same constraints used by the renderer. */
export function textOverflowMessage(reasons = []) {
  return reasons.map(reason => {
    if (reason.code === 'lines') return `Uses ${reason.actual} lines, but Max lines is ${reason.limit}. Increase Max lines or shorten the text.`;
    if (reason.code === 'width') return 'Text is wider than the box at the minimum size. Widen the box or reduce the text size.';
    if (reason.code === 'height') return 'Text is taller than the box at the minimum size. Increase the box height or reduce the text size.';
    return '';
  }).filter(Boolean).join(' ') || 'Text exceeds a layout limit. Check the text box and typography settings.';
}

/** Cap height of the primary font at a size - used to place a block by the top of its capitals. */
export function capHeight(ctx, { weight, size, family }) {
  ctx.font = fontString(weight, size, family);
  ctx.direction = 'ltr';
  return ctx.measureText('H').actualBoundingBoxAscent;
}

/**
 * Draw laid-out lines. `x`/`w` is the text box; the block of lines is positioned inside it by
 * `block` (center / start / end) and each line inside the block by `align`. "start" and "end"
 * follow the writing direction, so layouts mirror automatically for Arabic and Hebrew.
 */
export function drawLines(ctx, layout, o) {
  const { x, w, firstBaseline, align = 'start', block = 'center', dir = 'ltr', weight, family, lang, color, shadow, opacity = 1, dx = 0 } = o;
  const rtl = dir === 'rtl';
  const blockW = layout.maxW;
  let blockLeft;
  if (block === 'center') blockLeft = x + (w - blockW) / 2;
  else if (block === 'start') blockLeft = rtl ? x + w - blockW : x;
  else blockLeft = rtl ? x : x + w - blockW;
  blockLeft += rtl ? -dx : dx;

  ctx.save();
  applyContext(ctx, { weight, size: layout.size, family, lang, dir });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity;
  if (shadow) {
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.dx ?? 0;
    ctx.shadowOffsetY = shadow.dy ?? 0;
  }
  let baseline = firstBaseline;
  layout.lines.forEach((line, i) => {
    if (i > 0) baseline += layout.lineHeightPx;
    baseline += line.gapBefore;
    if (!line.text) return;
    let left;
    if (align === 'center') left = blockLeft + (blockW - line.width) / 2;
    else if ((align === 'start') !== rtl) left = blockLeft;          // flush with the left edge of the block
    else left = blockLeft + blockW - line.width;                     // flush with the right edge
    if (line.hang) {
      // list item: the marker sits on the start side, text is indented by the hang
      if (line.marker) {
        const markerWidth = ctx.measureText(line.marker).width;
        ctx.fillText(line.marker, rtl ? left + line.width - markerWidth : left, baseline);
      }
      ctx.fillText(line.text, rtl ? left : left + line.hang, baseline);
    } else {
      ctx.fillText(line.text, left, baseline);
    }
  });
  ctx.restore();
}
