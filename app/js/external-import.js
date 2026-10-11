// Import adapters consume inert file data only. Framefile Ruby/configuration code is never run.
import { uniqueId, slugify } from './layer-ops.js';
import { addDevice } from './project-ops.js';
import { canvasForSlide } from './canvas-orientation.js';
const basename = path => path.split('/').at(-1);
const dirname = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const colour = value => /^#[0-9a-f]{3,8}$/i.test(value ?? '') ? value : '#171717';
const number = (value, fallback, min, max) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.max(min, Math.min(max, Number(value))) : fallback;
export function importPath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path)) throw new Error('Invalid import file path.');
  const parts = [];
  for (const p of path.split('/')) { if (p === '..') { if (!parts.length) throw new Error('A referenced file is outside the selected folder.'); parts.pop(); } else if (p && p !== '.') parts.push(p); }
  return parts.join('/');
}
export function parseStrings(text) {
  const result = Object.create(null);
  // Comments are recognised only outside quoted strings, preserving URLs and quoted comment markers.
  const token = /\s+|\/\*[\s\S]*?\*\/|\/\/[^\n]*|"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"\s*;/gy;
  const decode = s => s.replace(/\\(?:U([a-f\d]{4})|u([a-f\d]{4})|([nrt"\\]))/gi, (_, a, b, c) => a || b ? String.fromCharCode(parseInt(a ?? b, 16)) : ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c]);
  text = text.replace(/^\uFEFF/, ''); let at = 0;
  while (at < text.length) { token.lastIndex = at; const m = token.exec(text); if (!m) throw new Error('A .strings file could not be read. Use UTF-8 or UTF-16 Apple .strings syntax.'); at = token.lastIndex; if (m[1] !== undefined) result[decode(m[1])] = decode(m[2]); }
  return result;
}
const mergeConfig = (a, b) => ({ ...a, ...b, title: { ...a.title, ...b.title }, keyword: { ...a.keyword, ...b.keyword } });
export function planExternalImport(files, { locales, localeId }) {
  const byPath = new Map(files.map(f => [importPath(f.path), f]));
  if (byPath.size !== files.length) throw new Error('Some selected files have the same path. Import their folder instead.');
  const configs = files.filter(f => basename(f.path).toLowerCase() === 'framefile.json').map(file => {
    let data; try { data = JSON.parse(file.text); } catch { throw new Error(`${file.path} is not valid JSON.`); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data.data !== undefined && !Array.isArray(data.data))) throw new Error(`${file.path} is not a supported Framefile.`);
    return { file, dir: dirname(file.path), data };
  }).sort((a, b) => b.dir.length - a.dir.length);
  const strings = new Map(files.filter(f => /(?:title|keyword)\.strings$/i.test(f.path)).map(f => [f.path, parseStrings(f.text)]));
  const backgrounds = new Set();
  for (const { dir, data } of configs) for (const cfg of [data.default ?? {}, ...(data.data ?? [])]) if (typeof cfg.background === 'string') { try { backgrounds.add(importPath(`${dir ? dir + '/' : ''}${cfg.background}`)); } catch { /* surfaced for its screenshot below */ } }
  const rows = [], warnings = new Set();
  for (const file of files.filter(f => /\.(png|jpe?g)$/i.test(f.path) && !backgrounds.has(f.path)).sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }))) {
    const name = basename(file.path), stem = name.replace(/\.[^.]+$/, '');
    const config = configs.find(c => !c.dir || file.path.startsWith(c.dir + '/'));
    if (config && /(?:_framed|_framed_preview)\.(png|jpe?g)$/i.test(name)) { warnings.add('Previously framed outputs are skipped when Framefile source captures are available.'); continue; }
    const folderLocale = file.path.split('/').find(p => locales.some(l => l.id.toLowerCase() === p.toLowerCase()));
    const locale = locales.find(l => l.id.toLowerCase() === folderLocale?.toLowerCase())?.id ?? localeId;
    let cfg = {}, background = null, title = '', keyword = '';
    if (config) {
      cfg = mergeConfig({}, config.data.default ?? {});
      for (const item of config.data.data ?? []) if (typeof item.filter === 'string' && name.includes(item.filter)) cfg = mergeConfig(cfg, item);
      if (typeof cfg.background === 'string') {
        try { background = byPath.get(importPath(`${config.dir ? config.dir + '/' : ''}${cfg.background}`)) ?? null; } catch { /* missing message below */ }
        if (!background?.width) { background = null; warnings.add(`Background “${cfg.background}” was not included. A plain background will be used.`); }
      }
      for (const kind of ['title', 'keyword']) {
        let dir = dirname(file.path), dict;
        while (true) { dict = strings.get(`${dir ? dir + '/' : ''}${kind}.strings`); if (dict || !dir || dir === config.dir) break; dir = dirname(dir); }
        const key = Object.keys(dict ?? {}).filter(k => stem.includes(k)).sort((a, b) => b.length - a.length)[0];
        const value = key !== undefined ? dict[key] : (typeof cfg[kind]?.text === 'string' ? cfg[kind].text : '');
        if (kind === 'title') title = value; else keyword = value;
      }
      warnings.add('Framefile titles, colours, backgrounds and above/below placement are imported as editable layers. Studio generic devices and your project font replace external frames/fonts; spacing may differ.');
    }
    if (!folderLocale) warnings.add('Files without a matching project language folder use the language selected in the preview. Add any missing languages before importing.');
    rows.push({ path: file.path, name: stem, file, locale, selected: true, kind: config ? 'frameit' : 'image', config: cfg, background, title, keyword,
      group: file.path.split('/').filter(p => !locales.some(l => l.id.toLowerCase() === p.toLowerCase())).join('/').replace(/\.[^.]+$/, '') });
  }
  if (!rows.length) throw new Error('No source PNG or JPEG screenshots were found.');
  return { rows, warnings: [...warnings] };
}

/** Build a complete edit first, then callers checkpoint and publish it once. Uploaded assets have unique names. */
export function applyExternalImport(project, copy, rows, { canvasId = null, assets, captures = {} }) {
  if (!rows.length) throw new Error('Select at least one screenshot.');
  const next = structuredClone(project), texts = structuredClone(copy), groups = new Map(), newDevices = new Map(), destinations = new Set();
  const imported = [], locales = new Set(); let firstDevice;
  for (const row of rows) {
    if (!next.locales.some(l => l.id === row.locale)) throw new Error('An import language is no longer in this project.');
    let deviceId = canvasId;
    const size = [row.file.width, row.file.height], dimensionKey = [...size].sort((a, b) => a - b).join('x');
    if (!deviceId) {
      deviceId = newDevices.get(dimensionKey);
      if (!deviceId) { deviceId = addDevice(next, { label: `Imported ${dimensionKey}`, size: [...size].sort((a, b) => a - b), layout: 'phone', target: 'custom', frame: { type: 'plain' } }); newDevices.set(dimensionKey, deviceId); }
    }
    if (!next.devices[deviceId]) throw new Error('The selected canvas was removed.');
    firstDevice ??= deviceId;
    const groupKey = row.group; let slide = groups.get(groupKey);
    if (!slide) {
      const id = uniqueId(next.slides.map(s => s.id), slugify(row.name, 'imported'));
      slide = { id, name: row.name, theme: Object.keys(next.themes)[0], colors: { bg: '#ffffff', ink: '#171717' }, layouts: Object.fromEntries(Object.keys(next.devices).map(id => [id, { template: 'custom', panorama: false, layers: [] }])), localeLayouts: {} };
      next.slides.push(slide); groups.set(groupKey, slide); imported.push(id);
    }
    const destination = `${slide.id}|${deviceId}|${row.locale}`;
    if (destinations.has(destination)) throw new Error('Two files map to the same slide, canvas and language. Change the language or deselect one.'); destinations.add(destination);
    if (!canvasId) {
      const orientation = size[0] > size[1] ? 'landscape' : 'portrait';
      if (slide.canvasOrientations?.[deviceId] && slide.canvasOrientations[deviceId] !== orientation) throw new Error('Language versions of one screenshot have different orientations. Import these files separately to keep their original dimensions.');
      (slide.canvasOrientations ??= {})[deviceId] = orientation;
    }
    const device = canvasForSlide(next, slide, deviceId), [W, H] = device.designSize ?? device.size;
    const image = (id, file, cover = false) => {
      const src = assets[file.path]; if (!src) throw new Error('An imported image is missing.');
      const w = cover ? W : Math.min(W, H * file.width / file.height);
      return { id, type: 'art', name: id === 'imported-image' ? 'Imported design' : 'Background', src, cx: W / 2, cy: H / 2, w, h: cover ? H : w * file.height / file.width, aspect: file.width / file.height, ...(cover ? { fit: 'cover' } : {}) };
    };
    const layers = [];
    if (row.kind === 'image') layers.push(image('imported-image', row.file));
    else {
      if (row.background) layers.push(image('background', row.background, true));
      const hasText = row.title || row.keyword, below = row.config.title_below_image === true, pad = number(row.config.padding, W * .05, 0, W * .2);
      const textHeight = hasText ? H * .22 : 0, space = H - textHeight - 2 * pad;
      const w = Math.min(W - pad * 2, space * size[0] / size[1]) * .95, height = w * size[1] / size[0];
      if (!captures[row.path]) throw new Error('An imported capture is missing.');
      layers.push({ id: 'device', type: 'device', name: 'Imported screenshot', capture: captures[row.path].name, captureSet: captures[row.path].set, frame: { type: 'generic', screen: size, family: row.config.use_platform === 'ANDROID' ? 'android-phone' : 'iphone' }, fit: 'contain', cx: W / 2, top: pad + (!below ? textHeight : 0) + (space - height) / 2, w });
      const top = below ? H - textHeight - pad : pad;
      let y = top;
      for (const [field, value, settings] of [['eyebrow', row.keyword, row.config.keyword], ['headline', row.title, row.config.title]]) {
        if (!value) continue;
        const boxHeight = textHeight * (row.keyword && row.title ? (field === 'eyebrow' ? .32 : .68) : 1);
        const fontSize = number(settings?.font_size, W * (field === 'eyebrow' ? .045 : .065), 10, W * .2);
        layers.push({ id: field, type: 'text', field, x: pad, capTop: y, w: W - pad * 2, boxHeight, size: fontSize, minSize: fontSize * .6, maxLines: field === 'eyebrow' ? 2 : 4, weight: number(settings?.font_weight, 600, 100, 900), color: colour(settings?.color), lineHeight: 1.15, align: 'center', block: 'center', anchor: 'top' });
        (texts[row.locale] ??= {}); (texts[row.locale][slide.id] ??= {})[field] = value; y += boxHeight;
      }
      const doc = (texts[row.locale] ??= {}); doc._meta = { ...doc._meta, status: 'draft', needsReview: ['*'] }; locales.add(row.locale);
    }
    (slide.localeLayouts[row.locale] ??= {})[deviceId] = { independent: true, scope: 'locale', template: 'custom', panorama: false, layers };
  }
  return { project: next, copy: texts, slides: imported, locales: [...locales], deviceId: firstDevice };
}
