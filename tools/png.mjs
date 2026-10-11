// Minimal dependency-free PNG codec (8-bit, non-interlaced).
//
// decodePNG(buffer)  -> { width, height, data: Uint8Array RGBA }
// encodePNG({ width, height, data, channels })  -> Buffer
//   channels = 3 (RGB, no alpha - what App Store Connect wants) or 4 (RGBA)
//
// Used by the exporter (to write RGB PNGs without an alpha channel) and by the
// one-off migration tool that pulls artwork out of the old Illustrator files.

import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, transparency = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (interlace) throw new Error('Interlaced PNGs are not supported');
  if (bitDepth !== 8 && !(colorType === 3 && bitDepth <= 8)) throw new Error(`Unsupported bit depth ${bitDepth}`);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[dst + x - bpp] : 0;
      const b = y > 0 ? pixels[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[dst - stride + x - bpp] : 0;
      const v = raw[src + x];
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: out = v + paeth(a, b, c); break;
        default: throw new Error(`Bad PNG filter ${filter}`);
      }
      pixels[dst + x] = out & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r, g, b, a = 255;
      if (colorType === 6) {
        const i = y * stride + x * 4;
        [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
      } else if (colorType === 2) {
        const i = y * stride + x * 3;
        [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      } else if (colorType === 0) {
        r = g = b = pixels[y * stride + x];
      } else if (colorType === 4) {
        const i = y * stride + x * 2;
        r = g = b = pixels[i];
        a = pixels[i + 1];
      } else {
        const bitPos = x * bitDepth;
        const byte = pixels[y * stride + (bitPos >> 3)];
        const idx = bitDepth === 8 ? byte : (byte >> (8 - bitDepth - (bitPos & 7))) & ((1 << bitDepth) - 1);
        r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
        if (transparency && idx < transparency.length) a = transparency[idx];
      }
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }
  return { width, height, data: rgba };
}

// Marketing slides are mostly flat colour plus a screenshot, so a cheap
// per-scanline choice between None / Sub / Up (smallest sum of absolute
// residuals) is nearly as small as the heavyweight heuristics and about 3x
// faster. Output is typically within a few percent of Illustrator's PNGs.
export function encodePNG({ width, height, data, channels = 3 }) {
  if (channels !== 3 && channels !== 4) throw new Error('channels must be 3 or 4');
  const stride = width * channels;
  const src = data.length === stride * height
    ? data
    : (() => {
        // Input is RGBA but caller wants RGB: drop alpha.
        const rgb = new Uint8Array(stride * height);
        for (let i = 0, o = 0; i < width * height; i++, o += channels) {
          rgb[o] = data[i * 4]; rgb[o + 1] = data[i * 4 + 1]; rgb[o + 2] = data[i * 4 + 2];
          if (channels === 4) rgb[o + 3] = data[i * 4 + 3];
        }
        return rgb;
      })();

  const out = Buffer.alloc((stride + 1) * height);
  const sub = new Uint8Array(stride);
  const up = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const prev = row - stride;
    let scoreNone = 0, scoreSub = 0, scoreUp = 0;
    for (let x = 0; x < stride; x++) {
      const v = src[row + x];
      scoreNone += v < 128 ? v : 256 - v;
      const s = (v - (x >= channels ? src[row + x - channels] : 0)) & 0xff;
      sub[x] = s;
      scoreSub += s < 128 ? s : 256 - s;
      const u = y > 0 ? (v - src[prev + x]) & 0xff : v;
      up[x] = u;
      scoreUp += u < 128 ? u : 256 - u;
    }
    const o = y * (stride + 1);
    if (scoreUp <= scoreSub && scoreUp <= scoreNone && y > 0) { out[o] = 2; out.set(up, o + 1); }
    else if (scoreSub < scoreNone) { out[o] = 1; out.set(sub, o + 1); }
    else { out[o] = 0; out.set(src.subarray(row, row + stride), o + 1); }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;                          // bit depth
  ihdr[9] = channels === 3 ? 2 : 6;     // colour type: RGB / RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])),    // tag as sRGB (perceptual)
    chunk('IDAT', zlib.deflateSync(out, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function readPNGSize(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
