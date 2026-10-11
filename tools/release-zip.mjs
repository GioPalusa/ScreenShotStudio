// Prepare an already notarized app for GitHub Releases; never signs or submits it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
assert.equal(process.platform, 'darwin', 'Release validation requires macOS.');
const input = process.argv[2];
assert.ok(input, 'Usage: npm run release:zip -- "/path/to/notarized/Screenshot Studio.app"');
const app = fs.realpathSync(input), plist = path.join(app, 'Contents/Info.plist');
const readPlist = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim();
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
assert.equal(readPlist('CFBundleShortVersionString'), version, 'App version must match the source release.');
assert.equal(readPlist('CFBundleIdentifier'), 'se.palusa.screenshotstudio');
const validate = bundle => {
  execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  const details = spawnSync('codesign', ['--display', '--verbose=2', bundle], { encoding: 'utf8' });
  assert.ok(details.status === 0 && /^Authority=Developer ID Application:/m.test(details.stderr), 'Developer ID signing is required.');
  execFileSync('xcrun', ['stapler', 'validate', bundle], { stdio: 'inherit' });
  execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle], { stdio: 'inherit' });
};
validate(app);
const arches = execFileSync('lipo', ['-archs', path.join(app, 'Contents/MacOS', readPlist('CFBundleExecutable'))], { encoding: 'utf8' }).trim().split(/\s+/);
assert.ok(arches.every(a => ['arm64', 'x86_64'].includes(a)) && arches.length <= 2, 'Unsupported release architecture.');
const arch = arches.length === 2 ? 'universal' : arches[0] === 'x86_64' ? 'x64' : 'arm64';
const name = `Screenshot-Studio-${version}-darwin-${arch}.zip`;
const dist = path.join(root, 'dist'); fs.mkdirSync(dist, { recursive: true });
const output = path.join(dist, name); assert.ok(!fs.existsSync(output), 'Release ZIP already exists; do not overwrite released artifacts.');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-release-'));
try {
  const zip = path.join(temp, name);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const extracted = path.join(temp, 'extracted');
  execFileSync('ditto', ['-x', '-k', zip, extracted]);
  validate(path.join(extracted, path.basename(app)));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  fs.copyFileSync(zip, output, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${name}\n`, { flag: 'wx' });
  console.log(`Verified release asset: ${output}\nSHA-256: ${digest}`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
