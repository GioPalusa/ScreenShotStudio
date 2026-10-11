import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importFrameDiskImage, readDiskImagePNGs } from '../host/disk-image-frames.mjs';
import { encodePNG } from './png.mjs';

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-dmg-test-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const image = path.join(dir, 'Bezel test.dmg'), volume = path.join(dir, 'Mounted volume');
  await fs.writeFile(image, 'disk image stand-in');
  await fs.mkdir(path.join(volume, 'PNG'), { recursive: true });
  const png = encodePNG({ width: 32, height: 64, data: Buffer.alloc(32 * 64 * 4, 255), channels: 4 });
  await fs.writeFile(path.join(volume, 'PNG', 'Phone.png'), png);
  const info = { 'image-path': image, 'system-entities': [{ 'dev-entry': '/dev/disk99' }, { 'dev-entry': '/dev/disk99s2', 'mount-point': volume }] };
  return { dir, image, volume, png, info };
}

test('a new DMG waits for the native mount, reads nested PNGs and ejects only its own disk', async t => {
  const f = await fixture(t), events = [];
  let mounted = false;
  const result = await importFrameDiskImage(f.image, {
    listImages: async () => mounted ? [f.info] : [],
    mountImage: async image => { assert.equal(image, f.image); events.push('native agreement finished'); mounted = true; },
    ejectImage: async device => { assert.equal(device, '/dev/disk99'); events.push('eject'); await fs.rm(f.volume, { recursive: true }); },
  });
  assert.deepEqual(events, ['native agreement finished', 'eject']);
  assert.equal(result.files[0].relativePath, 'PNG/Phone.png');
  assert.deepEqual(result.files[0].bytes, f.png, 'Bytes survive the volume being ejected');
  assert.equal(result.canceled, false);
});

test('one import waits for the mounted volume when the native launcher exits before macOS publishes it', async t => {
  const f = await fixture(t);
  let checks = 0, mounts = 0;
  const result = await importFrameDiskImage(f.image, {
    listImages: async () => ++checks >= 4 ? [f.info] : [],
    mountImage: async () => { mounts++; },
    ejectImage: async () => {},
    pollInterval: 1, settleTimeout: 20,
  });
  assert.equal(result.canceled, false, 'A late volume must not make the first drop look canceled');
  assert.equal(result.files.length, 1);
  assert.equal(mounts, 1, 'The user should not need to drop the image again');
});

test('declining or canceling the native agreement imports nothing and ejects nothing', async t => {
  const f = await fixture(t);
  let shown = 0;
  const result = await importFrameDiskImage(f.image, { listImages: async () => [], mountImage: async () => shown++, ejectImage: async () => assert.fail('Nothing was mounted'), settleTimeout: 0 });
  assert.equal(shown, 1);
  assert.deepEqual(result, { canceled: true, files: [] });
});

test('an already mounted image is reused and remains mounted, even through an image path alias', async t => {
  const f = await fixture(t), alias = path.join(f.dir, 'alias.dmg');
  await fs.symlink(f.image, alias);
  const result = await importFrameDiskImage(alias, { listImages: async () => [f.info], mountImage: async () => assert.fail('Already mounted'), ejectImage: async () => assert.fail('User-owned volume') });
  assert.equal(result.files.length, 1);
  assert.ok(await fs.stat(f.volume));
});

test('an unrelated mounted image cannot satisfy a canceled mount', async t => {
  const f = await fixture(t), other = path.join(f.dir, 'Other.dmg');
  await fs.writeFile(other, 'other');
  const result = await importFrameDiskImage(f.image, { listImages: async () => [{ ...f.info, 'image-path': other }], mountImage: async () => {}, ejectImage: async () => assert.fail('Unrelated disk'), settleTimeout: 0 });
  assert.equal(result.canceled, true);
});

test('a mounted volume is imported even while the native mounter remains open in Finder', { timeout: 1000 }, async t => {
  const f = await fixture(t);
  let checks = 0;
  const result = await importFrameDiskImage(f.image, {
    listImages: async () => ++checks >= 3 ? [f.info] : [],
    mountImage: () => new Promise(() => {}),
    ejectImage: async () => {}, pollInterval: 1,
  });
  assert.equal(result.canceled, false);
  assert.equal(result.files.length, 1);
});

test('failure to launch the native mounter is reported instead of silently canceling', async t => {
  const f = await fixture(t);
  await assert.rejects(importFrameDiskImage(f.image, {
    listImages: async () => [], mountImage: async () => { throw new Error('Native mounter unavailable'); },
    ejectImage: async () => assert.fail('No disk was mounted'), settleTimeout: 0, pollInterval: 1,
  }), /Native mounter unavailable/);
});

test('scan failures still eject app-mounted images', async t => {
  const f = await fixture(t);
  await fs.rm(path.join(f.volume, 'PNG'), { recursive: true });
  let mounted = false, ejected = false;
  await assert.rejects(importFrameDiskImage(f.image, { listImages: async () => mounted ? [f.info] : [], mountImage: async () => { mounted = true; }, ejectImage: async () => { ejected = true; } }), /No usable bezel PNGs/);
  assert.equal(ejected, true);
});

test('an eject failure retains readable files and provides an actionable warning', async t => {
  const f = await fixture(t);
  let mounted = false;
  const result = await importFrameDiskImage(f.image, { listImages: async () => mounted ? [f.info] : [], mountImage: async () => { mounted = true; }, ejectImage: async () => { throw new Error('busy'); } });
  assert.equal(result.files.length, 1);
  assert.match(result.warning, /eject it in Finder/);
});

test('scanner ignores Photoshop, hidden files, symlinks, application bundles and invalid PNGs', async t => {
  const f = await fixture(t);
  for (const dir of ['.hidden', 'Installer.app', 'Photoshop']) await fs.mkdir(path.join(f.volume, dir));
  for (const name of ['.hidden/hidden.png', 'Installer.app/icon.png', '._Phone.png']) await fs.writeFile(path.join(f.volume, name), f.png);
  await fs.writeFile(path.join(f.volume, 'Photoshop/Phone.psd'), 'not PNG');
  await fs.writeFile(path.join(f.volume, 'broken.png'), 'not PNG');
  await fs.writeFile(path.join(f.dir, 'outside.png'), f.png);
  await fs.symlink(path.join(f.dir, 'outside.png'), path.join(f.volume, 'linked.png'));
  await fs.symlink(f.dir, path.join(f.volume, 'linked-folder'));
  assert.deepEqual((await readDiskImagePNGs([f.volume])).map(file => file.name), ['Phone.png']);
});

test('oversized images are rejected before reading their contents', async t => {
  const f = await fixture(t), file = path.join(f.volume, 'Large.png');
  await fs.writeFile(file, ''); await fs.truncate(file, 65 * 1024 * 1024);
  await assert.rejects(readDiskImagePNGs([f.volume]), /too much PNG data/);
});

test('non-DMG paths are rejected before launching native commands', async () => {
  for (const source of [null, 'relative.dmg', '/tmp/image.png', '/tmp/test.dmg;echo nope']) {
    await assert.rejects(importFrameDiskImage(source, { listImages: async () => assert.fail('Invalid path') }), /Choose a .dmg/);
  }
});
