import { PROJECT_EXTENSIONS } from '../app/js/project-file.js';
import { packager } from '@electron/packager';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { copyProject } from '../host/files.mjs';
import { createStudioService } from '../host/service.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const xcode = process.argv.includes('--xcode');
const debug = xcode && process.env.CONFIGURATION === 'Debug';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const identity = xcode && process.env.EXPANDED_CODE_SIGN_IDENTITY === '-'
  ? ''
  : xcode ? process.env.EXPANDED_CODE_SIGN_IDENTITY_NAME : process.env.STUDIO_SIGN_IDENTITY;
if (xcode && !process.env.TARGET_BUILD_DIR) throw new Error('--xcode must run from the Xcode build phase.');
const icon = path.join(root, 'distribution', 'ScreenshotStudio.icns');
assert.ok(fs.existsSync(icon), 'App icon missing. Run node tools/build-icon.mjs on macOS.');
const results = await packager({
  dir: root, out: xcode ? path.join(process.env.TARGET_TEMP_DIR, 'electron-package') : path.join(root, 'dist'), name: 'Screenshot Studio',
  platform: 'darwin', arch: xcode && process.env.ARCHS === 'x86_64' ? 'x64' : process.arch, overwrite: true, prune: true,
  // The project seed and renderer assets use ordinary filesystem paths, including recursive copies.
  asar: false,
  afterCopy: [async ({ buildPath, arch }) => {
    execFileSync('/usr/bin/xcrun', ['swiftc', path.join(root, 'desktop/keychain.swift'), '-target', `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos13.0`, '-o', path.join(buildPath, 'desktop/keychain-helper')], { stdio: 'inherit' });
  }],
  appBundleId: 'se.palusa.screenshotstudio', appVersion: version, buildVersion: process.env.CURRENT_PROJECT_VERSION ?? '1',
  ...(identity ? { osxSign: { identity, preAutoEntitlements: false, optionsForFile: () => ({ hardenedRuntime: true, entitlements: path.join(root, 'distribution', 'Studio.entitlements') }) } } : {}),
  icon,
  appCategoryType: 'public.app-category.graphics-design',
  ignore: [/^\/ai-workspace(?:\/|$)/, /(?:^|\/)[^/]+\.(?:sss|screenshotstudio)(?:\/|$)/i, /^\/(?:\.agents|\.codex|\.aws)(?:\/|$)/, /(?:^|\/)\.env(?:$|\.)|\.(?:p12|p8|pem|key|mobileprovision)$/i, /^\/\.github(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/app\/icons\/(?!palusa-logo\.png$|screenshot-studio\.png$).*\.png$/, /^\/project(?:\/|$)/, /^\/README\.md$/, /^\/AGENTS\.md$/, /^\/distribution(?:\/|$)/, /^\/Screenshot Studio\.xcodeproj(?:\/|$)/, /^\/build(?:\/|$)/, /^\/dist(?:\/|$)/, /^\/export(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/project\/\.(history|versions)(?:\/|$)/, /^\/tools\/(?!png\.mjs$|mcp(?:\/|$))/, /^\/tests(?:\/|$)/],
  extendInfo: {
    CFBundleIconFile: 'ScreenshotStudio.icns',
    CFBundleDocumentTypes: [{ CFBundleTypeIconFile: 'ScreenshotStudio.icns', CFBundleTypeName: 'Screenshot Studio project', CFBundleTypeRole: 'Editor', LSHandlerRank: 'Owner', LSItemContentTypes: ['se.palusa.screenshotstudio.project'], LSTypeIsPackage: true }],
    UTExportedTypeDeclarations: [{ UTTypeIdentifier: 'se.palusa.screenshotstudio.project', UTTypeIconFile: 'ScreenshotStudio.icns', UTTypeDescription: 'Screenshot Studio project', UTTypeConformsTo: ['com.apple.package'], UTTypeTagSpecification: { 'public.filename-extension': PROJECT_EXTENSIONS } }],
  },
});
for (const result of results) {
  const app = path.join(result, 'Screenshot Studio.app');
  const bundled = path.join(app, 'Contents', 'Resources', 'app');
  assert.ok(fs.readFileSync(icon).equals(fs.readFileSync(path.join(app, 'Contents', 'Resources', 'ScreenshotStudio.icns'))), 'Packaged app icon differs');
  const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }));
  const projectType = info.UTExportedTypeDeclarations.find(type => type.UTTypeIdentifier === 'se.palusa.screenshotstudio.project');
  const documentType = info.CFBundleDocumentTypes.find(type => type.LSItemContentTypes.includes(projectType.UTTypeIdentifier));
  assert.equal(projectType.UTTypeIconFile, 'ScreenshotStudio.icns', 'Project file type must reference the bundled icon');
  assert.equal(documentType.CFBundleTypeIconFile, projectType.UTTypeIconFile, 'Document and exported type icons must match');
  assert.deepEqual(projectType.UTTypeTagSpecification['public.filename-extension'], PROJECT_EXTENSIONS, 'All supported project extensions must receive the icon');
  let checked = 0;
  const compare = relative => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'export') continue;
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) compare(file);
      else { assert.ok(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(bundled, file))), `Packaged file differs: ${file}`); checked++; }
    }
  };
  for (const folder of ['app', 'host', 'desktop', 'starter', 'skills']) compare(folder);
  assert.equal(fs.existsSync(path.join(bundled, 'project')), false, 'Private example project must not ship');
  assert.equal(fs.existsSync(path.join(bundled, 'ai-workspace')), false, 'Local AI workspace must not ship');
  const checkPublication = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      assert.ok(!/\.(?:sss|screenshotstudio)$/i.test(entry.name), 'User project packages must not ship');
      assert.ok(!/^\.env(?:$|\.)|\.(?:p12|p8|pem|key|mobileprovision)$/i.test(entry.name), 'Credential files must not ship');
      if (entry.isDirectory()) checkPublication(path.join(folder, entry.name));
    }
  };
  checkPublication(bundled);
  assert.equal(fs.existsSync(path.join(bundled, 'app/assets/frames')), false, 'Apple bezel artwork must not ship');
  const seed = JSON.parse(fs.readFileSync(path.join(bundled, 'starter', 'studio.json'), 'utf8'));
  assert.equal(Object.keys(seed.themes).length, 1);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-package-check-'));
  let service;
  try {
    const project = path.join(sandbox, 'Example.sss');
    copyProject(path.join(bundled, 'starter'), project);
    service = createStudioService({ appPath: path.join(bundled, 'app'), projectPath: project, exportPath: path.join(project, 'export'), origin: 'studio://local' });
    service.loadProjectBundle();
    assert.equal((await service.request(new Request('studio://local/app/index.html'))).status, 200);
  } finally { service?.close(); fs.rmSync(sandbox, { recursive: true, force: true }); }
  console.log(`Verified ${checked} bundled files, first-launch project copy and protocol content.`);
  // Local developer build. Distribution signing/notarization is a separate release step.
  if (!identity) {
    // --deep does not discover Squirrel's executable in framework Resources.
    // Organizer checks every executable for Hardened Runtime before re-signing.
    const shipIt = path.join(app, 'Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt');
    // Ad-hoc Debug helpers have no Team ID. Hardened library validation rejects
    // their Electron framework even when both signatures are valid.
    const runtimeOptions = debug ? [] : ['--options', 'runtime'];
    execFileSync('codesign', ['--force', ...runtimeOptions, '--sign', '-', path.join(bundled, 'desktop/keychain-helper')], { stdio: 'inherit' });
    execFileSync('codesign', ['--force', ...runtimeOptions, '--sign', '-', shipIt], { stdio: 'inherit' });
    execFileSync('codesign', ['--force', '--deep', ...runtimeOptions, '--entitlements', path.join(root, 'distribution', 'Studio.entitlements'), '--sign', '-', app], { stdio: 'inherit' });
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(root, 'tools/packaged-mcp-test.mjs'), app], { cwd: root, stdio: 'inherit', timeout: 180000 });
  if (xcode) {
    const destination = path.join(process.env.TARGET_BUILD_DIR, process.env.FULL_PRODUCT_NAME);
    fs.mkdirSync(path.join(destination, 'Contents'), { recursive: true });
    // Xcode owns the root Info.plist and final signature; Electron supplies the executable and nested bundles.
    for (const entry of ['MacOS', 'Frameworks', 'Resources']) {
      const output = path.join(destination, 'Contents', entry);
      fs.rmSync(output, { recursive: true, force: true });
      execFileSync('ditto', [path.join(app, 'Contents', entry), output]);
    }
    // The copied launcher's signature belongs to packager's Info.plist. Let Xcode
    // sign a fresh root with its processed plist, also on incremental builds.
    fs.rmSync(path.join(destination, 'Contents', '_CodeSignature'), { recursive: true, force: true });
    execFileSync('codesign', ['--remove-signature', path.join(destination, 'Contents', 'MacOS', 'Screenshot Studio')], { stdio: 'inherit' });
    console.log(destination);
  } else console.log(app);
}
