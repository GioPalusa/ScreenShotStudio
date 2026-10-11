import test from 'node:test';
import assert from 'node:assert/strict';
import { planExternalImport, applyExternalImport, parseStrings, importPath } from '../app/js/external-import.js';
import { starterProject } from '../app/js/onboarding.js';
import { resolveLayers } from '../app/js/layouts.js';
import { validateDocument } from '../app/js/document.js';
import { readImportArchive } from '../host/import-archive.mjs';
import { deflateRawSync } from 'node:zlib';
const base = () => { const b = starterProject({}); b.project.locales.push({ id: 'sv-SE', name: 'Swedish' }); b.copy['sv-SE'] = { _meta: { status: 'approved' } }; return b; };
const image = (path, width = 1320, height = 2868) => ({ path, width, height });
test('image imports preserve exact dimensions, locale grouping and existing project; landscape shares one canvas', () => {
  const { project, copy } = base(), before = JSON.stringify(project);
  const files = [image('export/en-US/01.png'), image('export/sv-SE/01.png'), image('export/en-US/02.png', 2868, 1320)];
  const { rows } = planExternalImport(files, { locales: project.locales, localeId: 'en-US' });
  const result = applyExternalImport(project, copy, rows, { assets: Object.fromEntries(files.map((f, i) => [f.path, `image-${i}.png`])) });
  assert.equal(result.slides.length, 2); assert.equal(Object.keys(result.project.devices).length, Object.keys(project.devices).length + 1);
  assert.equal(JSON.stringify(project), before); assert.deepEqual(result.project.slides[0].layouts.iphone, project.slides[0].layouts.iphone);
  const slide = result.project.slides.find(s => s.id === result.slides[0]);
  const en = resolveLayers({ project: result.project, slide, deviceId: result.deviceId, localeId: 'en-US' });
  const sv = resolveLayers({ project: result.project, slide, deviceId: result.deviceId, localeId: 'sv-SE' });
  assert.equal(en.layers.length, 1); assert.equal(en.layers[0].src, 'image-0.png'); assert.equal(sv.layers[0].src, 'image-1.png');
  const landscape = result.project.slides.find(s => s.id === result.slides[1]);
  const scene = resolveLayers({ project: result.project, slide: landscape, deviceId: result.deviceId, localeId: 'en-US' });
  assert.equal(scene.W, 2868); assert.equal(scene.H, 1320); assert.equal(scene.layers[0].w, 2868);
  validateDocument(result.project);
});
test('Framefile merge, localized .strings, backgrounds, editable devices and text, draft review', () => {
  const { project, copy } = base();
  const files = [
    { path: 'shots/Framefile.json', text: JSON.stringify({ default: { background: './background.jpg', title: { text: 'Default', color: '#123456', font_weight: 750 } }, data: [{ filter: '01', title: { color: '#abcdef' }, title_below_image: true }] }) },
    image('shots/background.jpg'), image('shots/en-US/01-home.png'), image('shots/sv-SE/01-home.png'), image('shots/en-US/01-home_framed.png'),
    { path: 'shots/en-US/title.strings', text: '/* note */ "01" = "A title\\nTwo lines";' },
    { path: 'shots/sv-SE/title.strings', text: '"01" = "En rubrik";' },
    { path: 'shots/sv-SE/keyword.strings', text: '"01" = "Nyhet";' },
  ];
  const plan = planExternalImport(files, { locales: project.locales, localeId: 'en-US' }); assert.equal(plan.rows.length, 2);
  assert.equal(plan.rows[0].title, 'A title\nTwo lines');
  const result = applyExternalImport(project, copy, plan.rows, { canvasId: 'iphone', assets: { 'shots/background.jpg': 'bg.jpg' }, captures: Object.fromEntries(plan.rows.map((r, i) => [r.path, { set: 'imported', name: `screen-${i}` }])) });
  const slide = result.project.slides.at(-1), layers = resolveLayers({ project: result.project, slide, deviceId: 'iphone', localeId: 'sv-SE' }).layers;
  assert.deepEqual(layers.map(l => l.type), ['art', 'device', 'text', 'text']);
  assert.equal(layers.find(l => l.id === 'headline').color, '#abcdef'); assert.equal(layers.find(l => l.id === 'headline').weight, 750);
  assert.equal(layers[1].captureSet, 'imported'); assert.equal(result.copy['sv-SE'][slide.id].headline, 'En rubrik');
  assert.equal(result.copy['sv-SE']._meta.status, 'draft'); assert.deepEqual(result.copy['sv-SE']._meta.needsReview, ['*']);
  assert.equal(layers[1].frame.type, 'generic'); assert.ok(layers.find(l => l.id === 'headline').capTop > layers[1].top);
  validateDocument(result.project);
});
test('imports reject bad paths, malformed strings, ambiguous mappings and missing assets', () => {
  assert.throws(() => importPath('../../bad'), /outside/); assert.throws(() => importPath('/etc/file'), /Invalid/);
  assert.equal(parseStrings('"web" = "https://site.com/a/*b*/";').web, 'https://site.com/a/*b*/');
  assert.equal(parseStrings('"a" = "\\U00e5 \\"hej\\"";').a, 'å "hej"');
  assert.throws(() => parseStrings('"key" = broken'), /could not/);
  const { project, copy } = base(), files = [image('en-US/01.png'), image('sv-SE/01.png')];
  const plan = planExternalImport(files, { locales: project.locales, localeId: 'en-US' });
  assert.throws(() => applyExternalImport(project, copy, plan.rows, { assets: {} }), /missing/);
  const opposite = planExternalImport([files[0], image('sv-SE/01.png', 2868, 1320)], { locales: project.locales, localeId: 'en-US' });
  assert.throws(() => applyExternalImport(project, copy, opposite.rows, { assets: Object.fromEntries(files.map(f => [f.path, 'a.png'])) }), /different orientations/);
  plan.rows[1].locale = 'en-US';
  assert.throws(() => applyExternalImport(project, copy, plan.rows, { assets: Object.fromEntries(files.map(f => [f.path, 'a.png'])) }), /Two files/);
});
// Small authentic ZIP fixture, stored and deflated. Keep it independent of the importer.
const crc32 = buf => { let crc = -1; for (const b of buf) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; };
export function zip(entries) {
  const local = [], directory = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data), method = entry.method ?? 8, packed = method ? deflateRawSync(data) : data;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(method, 8); header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(method, 10); dir.writeUInt32LE(crc32(data), 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(entry.claimedSize ?? data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(entry.attributes ?? 0, 38); dir.writeUInt32LE(offset, 42);
    local.push(header, name, packed); directory.push(dir, name); offset += header.length + name.length + packed.length;
  }
  const dirs = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dirs.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirs, end]);
}
test('ZIP reader validates integrity, paths, duplicates, symlinks and decompression bounds', () => {
  const archive = zip([{ name: 'en-US/01.png', data: 'pixels', method: 0 }, { name: 'Framefile.json', data: '{}' }]);
  const files = readImportArchive(archive).files; assert.equal(files.length, 2); assert.equal(Buffer.from(files[0].data, 'base64').toString(), 'pixels');
  assert.throws(() => readImportArchive(zip([{ name: '../bad.png', data: 'x' }])), /unsafe/);
  assert.throws(() => readImportArchive(zip([{ name: 'x.png', data: 'x', attributes: 0xa000 * 65536 }])), /symbolic/);
  assert.throws(() => readImportArchive(zip([{ name: 'x.png', data: 'a' }, { name: 'x.png', data: 'b' }])), /duplicate/);
  assert.throws(() => readImportArchive(zip([{ name: 'x.png', data: 'x', claimedSize: 40000000 }])), /128 MB/);
  assert.throws(() => readImportArchive(zip([{ name: 'x.png', data: 'x'.repeat(20000), claimedSize: 1 }])), /decompressed/);
  const corrupt = Buffer.from(archive); corrupt[30 + 'en-US/01.png'.length] ^= 1; assert.throws(() => readImportArchive(corrupt), /integrity/);
});
