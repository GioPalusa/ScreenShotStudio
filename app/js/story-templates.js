import { setFieldReview } from './copy-review.js';

// Original, editable starting points: art direction, typography and varied screenshot sequences.
export const STORY_TEMPLATES = [
  { id: 'pulse', name: 'Pulse', note: 'Lime contrasts, a split hero and floating feature cards', palette: { bg: '#12231c', ink: '#f6ffe9', swatches: ['#c5f765', '#70b994'] }, angle: -12, weight: 850 },
  { id: 'paper', name: 'Paper', note: 'Serif headlines, ink-dark pages and oversized screen crops', palette: { bg: '#f5f0e6', ink: '#292a27', swatches: ['#c95b3d', '#e3dccd'] }, angle: 0, font: 'Georgia', weight: 500 },
  { id: 'citrus', name: 'Citrus', note: 'Bold posters, warm colour blocks and playful screen angles', palette: { bg: '#ffe45c', ink: '#292318', swatches: ['#f87946', '#fff7c6'] }, angle: 13, weight: 800 },
  { id: 'bloom', name: 'Bloom', note: 'Pastel pages, overlapping devices and top-to-bottom rhythm', palette: { bg: '#efe7fb', ink: '#452452', swatches: ['#bb99e9', '#e3a4bc'] }, angle: -9, bottom: true, weight: 650 },
  { id: 'nocturne', name: 'Nocturne', note: 'Midnight spotlights, panoramic devices and pale interludes', palette: { bg: '#10132d', ink: '#f2f0ff', swatches: ['#7779e8', '#294a8b'] }, angle: 8, weight: 750 },
  { id: 'blueprint', name: 'Blueprint', note: 'Cobalt grids, split devices and oversized graphic headlines', palette: { bg: '#234fe1', ink: '#ffffff', swatches: ['#b7ceff', '#5479f3'] }, angle: 0, weight: 750 },
  { id: 'atelier', name: 'Atelier', note: 'Sculptural duets, cream and charcoal, editorial screen crops', palette: { bg: '#f6f4ef', ink: '#222523', swatches: ['#b9c8bd', '#dedbd2'] }, angle: 16, bottom: true, weight: 800 },
  { id: 'terracotta', name: 'Terracotta', note: 'Warm serif posters, clay colour fields and feature callouts', palette: { bg: '#f0ded0', ink: '#62382b', swatches: ['#bd7057', '#d6ad90'] }, angle: -7, font: 'Georgia', weight: 500 },
];
export const storyTemplate = id => STORY_TEMPLATES.find(d => d.id === id);
const COPY_LINES = {
  pulse: [['Find your', 'momentum.', 'Small steps. A little more every day.'], ['Make every', 'move count.', 'Keep what matters in focus.'], ['One place.', 'Your pace.', 'Make space for a routine that fits.'], ['Keep moving', 'forward.', 'See the moments that add up.'], ['Your next', 'starts here.', 'Make today the beginning.']],
  paper: [['Make room', 'for more.', 'A little space for what matters.'], ['Good ideas.', 'All together.', 'Bring your favourites into focus.'], ['Something', 'worth finding.', 'Follow your curiosity.'], ['Less noise.', 'More meaning.', 'Give the important things room.'], ['A new page.', 'Every day.', 'Start a story of your own.']],
  citrus: [['A brighter', 'everyday.', 'Find a little joy in the ordinary.'], ['Fresh ideas.', 'One place.', 'Keep the things that inspire you.'], ['Find your', 'next favourite.', 'There is more to discover.'], ['Little things.', 'Big energy.', 'Make each day feel like yours.'], ['Good things', 'start here.', 'Take your next step.']],
  bloom: [['A little more', 'you.', 'A space to make your own.'], ['Your world.', 'In harmony.', 'Bring the pieces together.'], ['Find what', 'feels right.', 'Let curiosity lead the way.'], ['Room to', 'grow.', 'Make time for what matters.'], ['Beautifully', 'yours.', 'Start with something you love.']],
  nocturne: [['Beyond the', 'ordinary.', 'A new perspective on your everyday.'], ['Everything.', 'In focus.', 'Bring your world together.'], ['Discover', 'what is next.', 'Make room for possibility.'], ['Every detail.', 'Considered.', 'Spend more time on what matters.'], ['Make it', 'your world.', 'Your next chapter starts here.']],
  blueprint: [['Clear space.', 'Clear mind.', 'Give your ideas a place to grow.'], ['Bring it', 'together.', 'Keep the important things connected.'], ['From idea', 'to next step.', 'Find a direction that works for you.'], ['Less friction.', 'More flow.', 'Make room for better days.'], ['Build your', 'everyday.', 'Start with what matters most.']],
  atelier: [['Your life.', 'Well curated.', 'A home for the things you love.'], ['A place for', 'everything.', 'Bring your collection together.'], ['Find your', 'point of view.', 'Make space for inspiration.'], ['The art of', 'less effort.', 'Keep the everyday beautifully simple.'], ['Make it', 'personal.', 'Choose a world that feels like you.']],
  terracotta: [['Slow down.', 'Look closer.', 'Make room for the good things.'], ['Stay close', 'to what matters.', 'Keep your favourites together.'], ['Follow your', 'curiosity.', 'There is always more to discover.'], ['A little less.', 'A little better.', 'Find a rhythm of your own.'], ['Every day.', 'More yours.', 'Start something worth keeping.']],
};
export function storySampleCopy(designId, index) {
  const [headline, headlineAccent, caption] = COPY_LINES[designId][index];
  return { headline, headlineAccent, caption, eyebrow: `${String(index + 1).padStart(2, '0')}  /  ${['THE INTRODUCTION', 'ALL TOGETHER', 'THE DISCOVERY', 'THE EVERYDAY', 'YOUR NEXT CHAPTER'][index]}` };
}
export function storyCopyFor(slide) {
  return slide.series?.includeText !== false && storyTemplate(slide.series?.designId) ? storySampleCopy(slide.series.designId, slide.series.index) : null;
}

/** Preserve existing review decisions while marking every added sample field as draft. */
export function addStoryCopy(project, copy, slides, locale) {
  const doc = copy[locale] ??= {};
  for (const slide of slides) doc[slide.id] = storyCopyFor(slide);
  if (doc._meta?.status === 'approved' || doc._meta?.reviewMode === 'fields') {
    for (const slide of slides) for (const field of Object.keys(doc[slide.id])) setFieldReview(project, copy, locale, slide.id, field, true);
  } else doc._meta = { ...doc._meta, status: 'draft', needsReview: ['*'] };
}

// Each collection has an editorial sequence, not a repeated phone pose.
const SEQUENCES = {
  pulse: ['bridge', 'reverse', 'feature', 'duet', 'poster'],
  paper: ['editorial', 'reverse', 'feature', 'bridge', 'poster'],
  citrus: ['poster', 'feature', 'reverse', 'duet', 'editorial'],
  bloom: ['reverse', 'duet', 'editorial', 'feature', 'poster'],
  nocturne: ['spotlight', 'bridge', 'reverse', 'feature', 'duet'],
  blueprint: ['bridge', 'reverse', 'poster', 'feature', 'editorial'],
  atelier: ['duet', 'editorial', 'reverse', 'bridge', 'feature'],
  terracotta: ['editorial', 'feature', 'poster', 'reverse', 'duet'],
};
const luminance = hex => {
  const rgb = hex.replace('#', '').match(/../g).slice(0, 3).map(v => parseInt(v, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const readable = (bg, candidates) => candidates.reduce((best, color) => contrast(bg, color) > contrast(bg, best) ? color : best);

// World-space artwork and local editorial panels drive both previews and real exports.
export function storyGeometry({ designId, count, W, H, ratio, gap, palette, includeText = true }) {
  const design = storyTemplate(designId), colors = palette ?? design.palette;
  const accent = colors.swatches?.find(c => c !== colors.bg && c !== colors.ink) ?? colors.ink;
  const secondary = colors.swatches?.[1] ?? colors.bg;
  const pitch = W * (1 + gap), total = count * W + (count - 1) * W * gap;
  const offsets = Array.from({ length: count }, (_, i) => i * pitch);
  const shapes = [], foregroundShapes = [], devices = [], texts = [], panels = [];
  const backgrounds = {
    pulse: [colors.bg, accent, colors.bg, secondary, colors.ink],
    paper: [colors.bg, colors.ink, secondary, accent, colors.bg],
    citrus: [colors.bg, accent, secondary, colors.ink, colors.bg],
    bloom: [colors.bg, secondary, accent, colors.ink, colors.bg],
    nocturne: [colors.bg, secondary, colors.ink, colors.bg, accent],
    blueprint: [colors.bg, colors.ink, secondary, colors.bg, accent],
    atelier: [colors.bg, colors.ink, secondary, accent, colors.bg],
    terracotta: [colors.bg, accent, colors.ink, secondary, colors.bg],
  }[designId];
  const wide = W > H * 1.15;
  for (let i = 0; i < count; i++) {
    let role = SEQUENCES[designId][i];
    if (count === 1 && role === 'duet') role = 'spotlight';
    if (role === 'bridge' && i === count - 1) role = designId === 'nocturne' ? 'reverse' : 'spotlight';
    const bg = backgrounds[i], ink = readable(bg, [colors.ink, colors.bg, '#ffffff', '#161b19']);
    const highlight = contrast(bg, accent) >= 3 ? accent : ink;
    panels.push({ role, colors: { bg, bg2: bg, ink } });
    const x = offsets[i];
    const shape = (name, cx, cy, w, h, fill, extra = {}, front = false) => (front ? foregroundShapes : shapes).push({
      id: `${name}-${i}`, name: name.replaceAll('-', ' '), tile: i, type: 'shape', shape: 'rect',
      cx: x + cx * W, cy: cy * H, w: w * W, h: h * H, fill, allowCrop: true, ...(front ? { zOrder: 1.5 } : {}), ...extra,
    });
    const ellipse = (name, cx, cy, size, fill, extra = {}) => shape(name, cx, cy, size, size * W / H, fill, { shape: 'ellipse', ...extra });
    const line = (name, cy, opacity = .2) => shape(name, .5, cy, .84, .001, ink, { opacity });
    const text = (field, y, size, height, extra = {}) => {
      const fontSize = Math.min(W * size, H * height * .91);
      texts.push({ id: field, type: 'text', field, tile: i, x: W * .09, capTop: H * y, w: W * .82,
        boxHeight: H * height, size: fontSize, minSize: fontSize * .58, maxLines: 1,
        weight: design.font ? 400 : design.weight, fontFamily: design.font ?? 'system-ui', color: ink,
        anchor: 'top', align: 'start', block: 'start', balanced: false, lineHeight: 1.06, ...extra });
    };
    const heading = (top, { center = false, large = false, caption = top + .218 } = {}) => {
      const align = center ? { align: 'center', block: 'center' } : {};
      text('eyebrow', top, .024, .022, { weight: 600, fontFamily: 'system-ui', opacity: .65, ...align });
      text('headline', top + .050, large ? .18 : .143, large ? .084 : .069, align);
      text('headlineAccent', top + (large ? .139 : .125), large ? .18 : .143, large ? .084 : .069, { color: highlight, ...align });
      text('caption', caption, .037, .048, { size: Math.min(W * .037, H * .02), minSize: Math.min(W * .026, H * .014),
        weight: 400, fontFamily: 'system-ui', maxLines: 2, lineHeight: 1.35, opacity: .83, ...align });
    };
    const device = (name, cx, cy, height, rotate = 0, captureIndex = i, shared = false, maxWidth = .93) => {
      const a = rotate * Math.PI / 180;
      const h = Math.min(H * height, W * maxWidth / (Math.abs(ratio * Math.cos(a)) + Math.abs(Math.sin(a))));
      devices.push({ id: `${name}-${i}`, ...(shared ? { tiles: [i, i + 1], seam: i } : { tile: i }),
        cx: x + cx * W, cy: cy * H, w: h * ratio, h, rotate, captureIndex,
        shadow: { color: '#000000', alpha: .24, blur: W * .045, dy: H * .013 } });
    };

    // Each family has its own graphic vocabulary; color changes follow the page sequence.
    if (designId === 'paper') {
      line('edition-rule', .045); line('folio-rule', .962);
      shape('publisher-mark', .11, .975, .045, .006, contrast(bg, accent) > 2 ? accent : ink);
    } else if (designId === 'blueprint') {
      for (let n = 0; n < 9; n++) {
        shape(`grid-v-${n}`, n / 8, .5, .001, 1, ink, { opacity: .07 });
        shape(`grid-h-${n}`, .5, n / 8, 1, .0006, ink, { opacity: .07 });
      }
      shape('registration-h', .91, .94, .035, .001, ink, { opacity: .6 });
      shape('registration-v', .91, .94, .002, .035 * W / H, ink, { opacity: .6 });
    } else if (designId === 'nocturne') {
      ellipse('ambient-light', .7, .58, 1.9, accent, { gradient: { type: 'radial', from: accent, to: bg, fromAlpha: .45, toAlpha: 0 } });
      for (let n = 0; n < 3; n++) ellipse(`orbit-${n}`, .7, .58, 1.15 + n * .23, '#00000000', { stroke: { color: ink, width: W * .001 }, opacity: .18 - n * .04 });
    } else if (designId === 'bloom') {
      ellipse('petal', .1, role === 'reverse' ? .26 : .75, 1.5, secondary, { gradient: { type: 'radial', from: accent, to: bg, fromAlpha: .55, toAlpha: 0 } });
      ellipse('petal-outline', .95, .48, 1.3, '#00000000', { stroke: { color: ink, width: W * .0015 }, opacity: .13 });
    } else if (designId === 'atelier') {
      shape('gallery-niche', .5, .48, .84, .83, secondary, { radius: W * .42, opacity: i % 2 ? .18 : .6 });
      line('gallery-rule', .96);
    } else if (designId === 'terracotta') {
      ellipse('clay-disc', .9, .88, 1.7, accent, { gradient: { from: secondary, to: accent, toAlpha: 1, angle: 125 }, opacity: .65 });
      ellipse('clay-contour', .9, .88, 1.9, '#00000000', { stroke: { color: ink, width: W * .001 }, opacity: .2 });
    } else if (designId === 'citrus') {
      ellipse('sun', .9, .78, 1.55, i % 2 ? colors.bg : accent);
      ellipse('sun-outline', .9, .78, 1.74, '#00000000', { stroke: { color: ink, width: W * .002 }, opacity: .17 });
    } else {
      shape('speed-band', .55, .76, 1.5, .27, accent, { rotate: -15, opacity: i % 2 ? .18 : .9 });
      shape('speed-line', .55, .575, 1.5, .0015, ink, { rotate: -15, opacity: .22 });
    }

    if (wide) {
      // Landscape output retains hierarchy and variety without shrinking a portrait poster.
      heading(.18, { large: role === 'poster', caption: .57 });
      for (const t of texts.filter(t => t.tile === i)) { t.w = W * .40; t.x = W * .07; }
      device('hero', .74, role === 'reverse' ? .28 : .65, role === 'duet' ? .70 : 1.06, design.angle, i, false, .48);
      if (role === 'duet') device('companion', .58, .40, .60, -design.angle, (i + 1) % count, false, .32);
      continue;
    }
    if (role === 'editorial') {
      heading(.082, { large: Boolean(design.font), caption: .34 });
      device('editorial-screen', .50, .81, .82, 0, i, false, .84);
      line('chapter-rule', .427);
    } else if (role === 'reverse') {
      device('top-crop', .57, .20, .86, 0, i, false, .82);
      // A crisp color block separates the crop and bottom headline, like an editorial spread.
      shape('caption-panel', .5, .815, 1, .37, bg, {}, true);
      heading(.685, { caption: .909 });
    } else if (role === 'poster') {
      heading(.082, { large: true, caption: .36 });
      ellipse('poster-disc', .17, .83, .67, ink, { opacity: .09 });
      device('poster-screen', .69, .85, .68, -20, i, false, 1.05);
      shape('poster-dash', .145, .53, .11, .009, ink);
    } else if (role === 'duet') {
      shape('reading-panel', .5, .84, 1, .32, bg, { zOrder: .75 });
      device('rear-screen', .29, .31, .68, -14, (i + 1) % count, false, .65);
      device('front-screen', .71, .37, .72, 13, i, false, .72);
      heading(.715, { caption: .925 });
    } else if (role === 'feature') {
      heading(.060, { center: true, caption: .715 });
      device('feature-screen', .5, .65, .69, 0, i, false, .78);
      const cardBg = ink, cardInk = readable(cardBg, [bg, '#ffffff', '#161b19']);
      shape('feature-card', .5, .758, .88, .14, cardBg, { radius: W * .035, shadow: { color: '#000000', alpha: .20, blur: W * .04, dy: H * .009 } }, true);
      shape('feature-accent', .13, .758, .009, .074, cardInk, { opacity: .7 }, true);
      const caption = texts.find(t => t.tile === i && t.field === 'caption');
      Object.assign(caption, { x: W * .18, w: W * .66, capTop: H * .725, boxHeight: H * .065, size: W * .05, minSize: W * .03, color: cardInk, opacity: 1, align: 'start', block: 'start' });
    } else if (role === 'bridge') {
      heading(.062, { large: true, caption: .335 });
      // The missing world-space strip is exactly the chosen store gap. Only this pair shares the phone.
      device('bridge-screen', .94 + gap / 2, .76, .70, design.angle || -10, i, true, 1.13);
      device('companion', .25, .80, .38, -(design.angle || -10) * .6, i, false, .48);
    } else {
      heading(.075, { center: true, caption: .308 });
      device('spotlight-screen', .50, .75, .74, design.angle * .5, i, false, .84);
      line('spotlight-rule', .415, .13);
    }
  }
  if (!includeText) {
    texts.length = 0;
    // Remove text-bearing panels and rebalance the artwork around the device.
    for (const list of [shapes, foregroundShapes]) {
      for (let i = list.length - 1; i >= 0; i--) if (/^(caption-panel|reading-panel|feature-card|feature-accent)-/.test(list[i].id)) list.splice(i, 1);
    }
    for (const device of devices) {
      device.cy = H * .5 + (device.cy - H * .5) * .3;
      if (wide) device.cx = offsets[device.tile ?? device.seam ?? 0] + W * .5;
      device.w *= 1.06; device.h *= 1.06;
    }
  }
  return { W, H, gap, pitch, total, offsets, panels, shapes, foregroundShapes, devices, texts };
}
