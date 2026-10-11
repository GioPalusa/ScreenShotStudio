import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export function fontFamilies(report) {
  const families = new Set();
  for (const file of report.SPFontsDataType ?? []) {
    if (file.enabled === 'no' || file.valid === 'no') continue;
    for (const face of file.typefaces ?? []) if (face.enabled !== 'no' && face.valid !== 'no' && typeof face.family === 'string' && !face.family.startsWith('.')) families.add(face.family);
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}

export function createFontCatalog({ platform = process.platform, execute = run, now = Date.now } = {}) {
  let pending, updated = 0;
  return async () => {
    if (platform !== 'darwin') return { families: [], unavailable: 'Installed-font discovery is currently available on macOS.' };
    if (!pending || now() - updated > 60000) {
      updated = now();
      pending = execute('/usr/sbin/system_profiler', ['SPFontsDataType', '-json'], { timeout: 30000, maxBuffer: 32 * 1024 * 1024 })
        .then(({ stdout }) => ({ families: fontFamilies(JSON.parse(stdout)) }))
        .catch(error => { pending = null; throw new Error(`Could not read installed fonts: ${error.message}`); });
    }
    return pending;
  };
}
export const installedFonts = createFontCatalog();
