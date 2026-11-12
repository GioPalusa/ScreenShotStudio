import crypto from 'node:crypto';
import path from 'node:path';
import { atomicWrite, assertInside } from './files.mjs';

const fail = message => Object.assign(new Error(message), { status: 400 });
const MAX_FONT = 32 * 1024 * 1024;
const normal = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Read the family and face from the font itself, never from a supplied filename. */
export function fontInfo(bytes) {
  try {
    if (bytes.length < 12 || bytes.length > MAX_FONT || !['00010000', '4f54544f'].includes(bytes.subarray(0, 4).toString('hex'))) throw Error();
    const tables = new Map(), count = bytes.readUInt16BE(4);
    if (count > 200 || 12 + count * 16 > bytes.length) throw Error();
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16, offset = bytes.readUInt32BE(at + 8), length = bytes.readUInt32BE(at + 12);
      if (offset + length > bytes.length) throw Error();
      tables.set(bytes.toString('ascii', at, at + 4), bytes.subarray(offset, offset + length));
    }
    const names = tables.get('name'), strings = names.readUInt16BE(4), records = names.readUInt16BE(2), candidates = [];
    for (let i = 0; i < records; i++) {
      const at = 6 + i * 12, platform = names.readUInt16BE(at), language = names.readUInt16BE(at + 4), id = names.readUInt16BE(at + 6), length = names.readUInt16BE(at + 8), start = strings + names.readUInt16BE(at + 10);
      if (![1, 16].includes(id) || start + length > names.length || ![0, 1, 3].includes(platform)) continue;
      const raw = Buffer.from(names.subarray(start, start + length));
      const value = platform === 1 ? raw.toString('latin1') : raw.swap16().toString('utf16le');
      candidates.push({ value: value.replace(/\0/g, '').trim(), rank: (id === 16 ? 10 : 0) + (language === 0x409 ? 2 : 0) + (platform === 3 ? 1 : 0) });
    }
    const family = candidates.sort((a, b) => b.rank - a.rank)[0]?.value;
    if (!family || family.length > 200 || /[\x00-\x1f]/.test(family)) throw Error();
    const os = tables.get('OS/2');
    let weight = String(os && os.length >= 6 ? Math.max(1, Math.min(1000, os.readUInt16BE(4))) : 400);
    const style = os && os.length >= 64 && os.readUInt16BE(62) & 1 ? 'italic' : 'normal';
    const variable = tables.get('fvar');
    if (variable) {
      const start = variable.readUInt16BE(4), axes = variable.readUInt16BE(8), size = variable.readUInt16BE(10);
      for (let i = 0; i < axes; i++) {
        const at = start + i * size;
        if (variable.toString('ascii', at, at + 4) === 'wght') weight = `${variable.readInt32BE(at + 4) / 65536} ${variable.readInt32BE(at + 12) / 65536}`;
      }
    }
    if (!/^\d+(?:\.\d+)?(?: \d+(?:\.\d+)?)?$/.test(weight)) throw Error();
    return { family, weight, style, extension: bytes.toString('ascii', 0, 4) === 'OTTO' ? 'otf' : 'ttf' };
  } catch { throw fail('Choose a valid OpenType or TrueType font file (.otf or .ttf), up to 32 MB.'); }
}

export function inspectFontFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 64) throw fail('Choose up to 64 font files.');
  let total = 0;
  return files.map(file => {
    if (typeof file.data !== 'string' || file.data.length > MAX_FONT * 4 / 3 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) throw fail('Invalid font file.');
    const bytes = Buffer.from(file.data, 'base64'); total += bytes.length;
    if (total > 128 * 1024 * 1024) throw fail('Import up to 128 MB of fonts at a time.');
    const info = fontInfo(bytes);
    return { ...info, data: bytes.toString('base64'), license: typeof file.license === 'string' ? file.license.slice(0, 100000) : '', source: typeof file.source === 'string' ? file.source.slice(0, 1000) : 'Local font file' };
  });
}

async function read(response, limit, signal) {
  if (!response.ok) throw Error('Font source unavailable');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { if (signal.aborted || (size += chunk.length) > limit) throw Error('Font download exceeds the size limit'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

/** Only the official open-source Google Fonts repository, including its license. No Figma key is sent. */
export async function resolveGoogleFonts(families, { fetchImpl = fetch, signal } = {}) {
  if (!Array.isArray(families) || families.length > 32 || families.some(f => typeof f !== 'string' || !f.trim() || f.length > 200)) throw fail('Choose up to 32 font families.');
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  const fonts = [], missing = [];
  const get = async (url, limit) => read(await fetchImpl(url, { redirect: 'error', signal: abort }), limit, abort);
  for (const family of new Set(families)) {
    let found = false;
    const slug = normal(family);
    if (!/^[a-z0-9]+$/.test(slug)) { missing.push(family); continue; }
    for (const dir of ['ofl', 'apache', 'ufl']) {
      try {
        const base = `https://raw.githubusercontent.com/google/fonts/main/${dir}/${slug}/`;
        const metadata = (await get(`${base}METADATA.pb`, 512000)).toString();
        if (metadata.match(/^name: "([^"]+)"/m)?.[1] !== family) continue;
        const licenseName = { ofl: 'OFL.txt', apache: 'LICENSE.txt', ufl: 'UFL.txt' }[dir];
        const license = (await get(base + licenseName, 100000)).toString();
        const filenames = [...metadata.matchAll(/^  filename: "([^"/\\]+\.(?:ttf|otf))"/gm)].map(m => m[1]);
        if (!filenames.length || filenames.length > 32) continue;
        const loaded = [];
        for (const filename of filenames) {
          const source = base + encodeURIComponent(filename), bytes = await get(source, MAX_FONT), info = fontInfo(bytes);
          if (normal(info.family) !== normal(family)) throw Error('Font family does not match');
          loaded.push({ ...info, family, data: bytes.toString('base64'), source, license });
        }
        fonts.push(...loaded); found = true; break;
      } catch { if (abort.aborted) throw fail('Font download cancelled or timed out.'); }
    }
    if (!found) missing.push(family);
  }
  if (fonts.length) inspectFontFiles(fonts);
  return { fonts, missing };
}

export function saveProjectFonts(project, files) {
  return inspectFontFiles(files).map(font => {
    const bytes = Buffer.from(font.data, 'base64'), hash = crypto.createHash('sha256').update(bytes).digest('hex'), file = `${hash}.${font.extension}`;
    const destination = path.join(project, 'assets', 'fonts', file); assertInside(project, destination); atomicWrite(destination, bytes);
    const license = font.license ? `${hash}.license.txt` : null;
    if (license) { const dest = path.join(project, 'assets', 'fonts', license); assertInside(project, dest); atomicWrite(dest, font.license); }
    return { family: font.family, weight: font.weight, style: font.style, file, source: font.source, ...(license ? { license } : {}) };
  });
}
