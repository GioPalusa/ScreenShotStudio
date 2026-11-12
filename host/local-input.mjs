import fs from 'node:fs/promises';

/** File providers can stall open(), even for tiny files. Keep the app event loop free. */
export async function readLocalInput(file, limit, { timeout = 15000, stat = fs.stat, read = fs.readFile } = {}) {
  const controller = new AbortController(); let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('The local file did not become available in time. Download it locally and try the import again.')); }, timeout);
  });
  try {
    return await Promise.race([expired, (async () => {
      const info = await stat(file);
      if (!info.isFile() || info.size > limit) throw new Error(`Choose a local file smaller than ${Math.round(limit / 1024 / 1024)} MiB.`);
      const bytes = await read(file, { signal: controller.signal });
      if (bytes.length > limit) throw new Error('The local file grew beyond the import size limit.');
      return bytes;
    })()]);
  } finally { clearTimeout(timer); }
}
