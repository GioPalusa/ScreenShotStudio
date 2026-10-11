// Convert the generated source artwork into the complete macOS icon family.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-icon-'));
try {
  const iconset = path.join(temporary, 'ScreenshotStudio.iconset');
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      execFileSync('sips', ['-z', pixels, pixels, path.join(root, 'app/icons/screenshot-studio.png'), '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'distribution/ScreenshotStudio.icns')]);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
