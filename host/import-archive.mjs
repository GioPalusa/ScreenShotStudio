import { inflateRawSync } from 'node:zlib';
const invalid = message => Object.assign(new Error(message), { status: 400 });
const MAX = 128 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = buffer => { let c = 0xffffffff; for (const n of buffer) c = crcTable[(c ^ n) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** Read supported files in memory. Nothing from an archive is extracted onto the filesystem. */
export function readImportArchive(buf) {
  if (buf.length > 64 * 1024 * 1024) throw invalid('Choose a ZIP smaller than 64 MB.');
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { end = i; break; }
  if (end < 0 || buf.readUInt16LE(end + 4) || buf.readUInt16LE(end + 6)) throw invalid('Choose a standard, single-part ZIP.');
  const count = buf.readUInt16LE(end + 10), directorySize = buf.readUInt32LE(end + 12), start = buf.readUInt32LE(end + 16);
  if (count > 2000 || count !== buf.readUInt16LE(end + 8) || start + directorySize > end) throw invalid('This ZIP is too large or uses an unsupported format.');
  let offset = start, total = 0; const files = [], names = new Set();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buf.readUInt32LE(offset) !== 0x02014b50) throw invalid('The ZIP directory is damaged.');
    const flags = buf.readUInt16LE(offset + 8), method = buf.readUInt16LE(offset + 10), crc = buf.readUInt32LE(offset + 16), packed = buf.readUInt32LE(offset + 20), size = buf.readUInt32LE(offset + 24), nameLength = buf.readUInt16LE(offset + 28), extra = buf.readUInt16LE(offset + 30), comment = buf.readUInt16LE(offset + 32), attributes = buf.readUInt32LE(offset + 38), local = buf.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength + extra + comment > end) throw invalid('The ZIP directory is damaged.');
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extra + comment;
    if (name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').includes('..') || /^[A-Za-z]:/.test(name) || ((attributes >>> 16) & 0xf000) === 0xa000) throw invalid('The ZIP contains unsafe paths or symbolic links.');
    if (name.endsWith('/') || name.split('/').some(p => p.startsWith('.') || p === '__MACOSX') || !/\.(png|jpe?g|json|strings)$/i.test(name)) continue;
    if (names.has(name)) throw invalid('The ZIP contains duplicate file names.'); names.add(name);
    total += size;
    if (files.length >= 300 || size > 32 * 1024 * 1024 || total > MAX) throw invalid('Import up to 300 files, 32 MB per file and 128 MB unpacked at a time.');
    if (flags & 1 || ![0, 8].includes(method) || local + 30 > start || buf.readUInt32LE(local) !== 0x04034b50) throw invalid('This ZIP is encrypted or uses unsupported compression.');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (dataStart + packed > start) throw invalid('The ZIP entry is damaged.');
    let data;
    try { data = method === 0 ? buf.subarray(dataStart, dataStart + packed) : inflateRawSync(buf.subarray(dataStart, dataStart + packed), { maxOutputLength: Math.min(size + 1, MAX) }); }
    catch { throw invalid('A ZIP entry could not be decompressed.'); }
    if (data.length !== size || crc32(data) !== crc) throw invalid('A ZIP entry failed its integrity check.');
    files.push({ path: name, data: data.toString('base64') });
  }
  if (offset !== start + directorySize) throw invalid('The ZIP directory is damaged.');
  if (!files.length) throw invalid('No PNG, JPEG or Framefile files were found in this ZIP.');
  return { files };
}
