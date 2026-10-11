import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

function run(file, args, { input, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', () => {}); // A failed command may close stdin before consuming the plist.
    child.stdin.end(input);
  });
}

export async function listDiskImages() {
  const plist = await run('/usr/bin/hdiutil', ['info', '-plist']);
  return JSON.parse(await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist })).images ?? [];
}

async function mountedImage(images, imagePath) {
  for (const image of images) {
    let candidate;
    try { candidate = await fs.realpath(image['image-path']); } catch { continue; }
    if (candidate !== imagePath) continue;
    const entities = image['system-entities'] ?? [];
    const roots = entities.map(entity => entity['mount-point']).filter(p => typeof p === 'string' && path.isAbsolute(p));
    if (roots.length) return { roots, device: entities.find(entity => /^\/dev\/disk\d+$/.test(entity['dev-entry']))?.['dev-entry'] };
  }
  return null;
}

// DiskImageMounter owns the original agreement UI. Never answer a license prompt
// or use hdiutil attach here: the person importing must make that decision.
export const mountDiskImage = image => run('/usr/bin/open', ['-W', '-n', '-a', '/System/Library/CoreServices/DiskImageMounter.app', image], { timeout: 0 });
const ejectDiskImage = device => run('/usr/bin/hdiutil', ['detach', device]);

/** Process lifetime and mount readiness are separate: wait for the matching volume. */
async function waitForMountedImage(imagePath, { listImages, mountImage, pollInterval, settleTimeout }) {
  let finishedAt = null, failure;
  // Do not await this process before checking volumes. Some mounter instances
  // remain alive after opening Finder; others exit before the volume is listed.
  void Promise.resolve().then(() => mountImage(imagePath)).then(
    () => { finishedAt = Date.now(); },
    error => { failure = error; finishedAt = Date.now(); },
  );
  for (;;) {
    const mounted = await mountedImage(await listImages(), imagePath);
    if (mounted) return mounted;
    if (finishedAt !== null && Date.now() - finishedAt >= settleTimeout) {
      if (failure) throw failure;
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

/** Read PNGs only. No executable content, aliases, symlinks or hidden support files. */
export async function readDiskImagePNGs(roots) {
  const files = [];
  let totalBytes = 0, visited = 0;
  const walk = async (folder, root, depth = 0) => {
    if (depth > 20) throw new Error('This disk image has too many nested folders. Import its bezel PNGs directly.');
    const entries = (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (++visited > 10000) throw new Error('This disk image contains too many files. Import its bezel PNGs directly.');
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const source = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!/\.(app|bundle|framework|pkg|sss|screenshotstudio)$/i.test(entry.name)) await walk(source, root, depth + 1);
      } else if (entry.isFile() && /\.png$/i.test(entry.name)) {
        const real = await fs.realpath(source);
        if (!real.startsWith(root + path.sep)) throw new Error('A bezel points outside the mounted disk image.');
        const stat = await fs.stat(real);
        totalBytes += stat.size;
        if (stat.size > 64 * 1024 * 1024 || totalBytes > 256 * 1024 * 1024 || files.length >= 250) throw new Error('This disk image contains too much PNG data. Import smaller groups of bezel PNGs directly.');
        const bytes = await fs.readFile(real);
        if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString() !== 'IHDR') continue;
        const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
        if (w < 16 || h < 16 || w > 20000 || h > 20000 || w * h > 80000000) continue;
        files.push({ name: entry.name, relativePath: path.relative(root, source), bytes });
      }
    }
  };
  for (const volume of roots) {
    const root = await fs.realpath(volume);
    await walk(root, root);
  }
  if (!files.length) throw new Error('No usable bezel PNGs were found in this disk image. Choose a download containing PNG artwork.');
  return files;
}

/** Bytes are copied before ejecting, and nothing is written into the project until preview confirmation. */
export async function importFrameDiskImage(imagePath, { listImages = listDiskImages, mountImage = mountDiskImage, ejectImage = ejectDiskImage, pollInterval = 250, settleTimeout = 10000 } = {}) {
  if (typeof imagePath !== 'string' || !path.isAbsolute(imagePath) || !/\.dmg$/i.test(imagePath)) throw new Error('Choose a .dmg disk image.');
  imagePath = await fs.realpath(imagePath);
  if (!(await fs.stat(imagePath)).isFile()) throw new Error('Choose a .dmg file.');
  let mounted = await mountedImage(await listImages(), imagePath);
  const alreadyMounted = Boolean(mounted);
  if (!mounted) {
    mounted = await waitForMountedImage(imagePath, { listImages, mountImage, pollInterval, settleTimeout });
    // Decline/Cancel in macOS must never import any content.
    if (!mounted) return { canceled: true, files: [] };
  }
  const result = { canceled: false, files: [], warning: null };
  let failure;
  try { result.files = await readDiskImagePNGs(mounted.roots); }
  catch (error) { failure = error; }
  finally {
    if (!alreadyMounted) {
      try {
        if (!mounted.device) throw new Error('No disk identifier');
        await ejectImage(mounted.device);
      } catch {
        result.warning = 'The disk image is still mounted. You can eject it in Finder when you are finished.';
      }
    }
  }
  if (failure) throw new Error(`${failure.message}${result.warning ? ` ${result.warning}` : ''}`);
  return result;
}
