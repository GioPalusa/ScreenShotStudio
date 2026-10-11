## 0.2.6 (7) — 11 October 2026

- First public MIT release; native Electron updater and community contribution workflows.
- Apple accepted notarization in Xcode Direct Distribution.
- Exported app and ZIP-extracted app passed deep signature, stapler validation and Gatekeeper assessment (Notarized Developer ID).
- Apple silicon arm64, macOS 13+. Developer ID team: `4W4M797J67`.
- ZIP: `Screenshot-Studio-0.2.6-darwin-arm64.zip`.
- SHA-256: `27eaa80624d6ff7c7705d9bb1e433e6bf076f041e25aabf3b6c2a8a033f69c95`.
- 239 Node tests, 25 self-tests and full local renderer/export integration passed.
- Automatic installation of a future published version has not yet been exercised end to end.

# Verified distribution releases

## 0.2.2 (3) — 8 October 2026

- Normal launch shows Welcome; recent projects open by choice, explicit project files open directly.
- Palusa logo, Created by Giovanni Palusa and website link on Welcome and About Screenshot Studio.
- Apple silicon (arm64), macOS 13 or later.
- Xcode build and Archive completed; 167 tests passed.
- Native QA: launch with recent projects, recent-project opening and About window verified.
- Final notarized export launched on Welcome successfully.
- Apple notarization identifier: `FF03115E-2ED2-40BB-B1E4-C796D8CE20D0`.
- Organizer status: **Ready to distribute**.
- Export: `dist/release-0.2.2-arm64/Screenshot Studio.app`.
- Shareable archive: `dist/Screenshot-Studio-0.2.2-arm64.zip`.
- ZIP SHA-256: `22ec636646f7cd10635e3e4a31fe42466d3b6ce26f8c0f663b9f1cbe76359856`.
- Exported and ZIP-extracted apps passed deep signature, stapler and Gatekeeper checks.
- Gatekeeper source: **Notarized Developer ID**.
- Bundled launch/branding files match validated source; private example project is absent.

## 0.2.1 (2) — 8 October 2026

- Neutral first-launch welcome screen, four palette examples, custom colours and getting-started guide.
- Private example project and its artwork/screenshots are excluded from the app bundle.
- Apple silicon (arm64), macOS 13 or later.
- Xcode build and Archive completed; 167 tests passed.
- Native QA: palette selection, creating a clean `.sss` project and Help guide verified.
- Apple notarization identifier: `2E3AF90C-453E-41D4-B8C7-C2AD04CD6085`.
- Organizer status: **Ready to distribute**.
- Export: `dist/release-0.2.1-arm64/Screenshot Studio.app`.
- Shareable archive: `dist/Screenshot-Studio-0.2.1-arm64.zip`.
- ZIP SHA-256: `bf22207e1448c22796409b666b1d5b69ac445927b7c088620b4636dfb74d5196`.
- Exported app and ZIP-extracted app passed deep signature, stapler and Gatekeeper checks.
- Gatekeeper source: **Notarized Developer ID**.
- Final app bundle checked against the current desktop source; only the neutral seed is bundled.

## 0.2.0 (1) — 8 October 2026

- Apple silicon (arm64), macOS 13 or later.
- Xcode Archive and Direct Distribution completed.
- Apple notarization identifier: `74504EE6-6533-4835-9181-C1FF945D4260`.
- Organizer status: **Ready to distribute**.
- Export: `dist/release-0.2.0-arm64/Screenshot Studio.app`.
- Shareable archive: `dist/Screenshot-Studio-0.2.0-arm64.zip`.
- The app extracted from the ZIP passed signature, stapler and Gatekeeper checks.
- ZIP SHA-256: `8ce064e47172fe7eef8c5103d523d8da8129566f08c071f7fba2bebee1a1b9bf`.
- Signing team: `4W4M797J67`; Hardened Runtime enabled, JIT entitlement only.
- `codesign --verify --deep --strict`: passed on the exported app.
- `xcrun stapler validate`: passed on the exported app.
- `spctl --assess --type execute --verbose=2`: accepted, **Notarized Developer ID**.
- 163 Studio tests passed after extracting the independent repository.
- The final notarized export opened the existing `.screenshotstudio` document successfully.

Notarization applies to these exact binaries. Subsequent changes need a new archive, notarization and export. The normal `npm run package` output remains an ad-hoc developer build.
