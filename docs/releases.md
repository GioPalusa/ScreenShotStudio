# Official releases and automatic updates

The Mac app uses Electron's native `autoUpdater` (Squirrel.Mac) with this feed:

`https://update.electronjs.org/GioPalusa/ScreenShotStudio/darwin-<arch>/<version>`

It checks ten seconds after launch and every six hours. Users can disable automatic checks in the application menu or use **Check for Updates…**. A download offers **Restart and Install** or **Later**; a restart waits for acknowledged document saves. Failed saves keep the document open. Background network failures remain quiet; manual checks show feedback. A downloaded update is also installed on a later normal launch, as defined by Electron.

Development, ad-hoc and App Store builds do not use the official feed. Supported architectures are arm64 and x64. Windows packaging is not currently supported by this repository. Checking updates contacts Electron's update service and GitHub; it does not upload documents.

## Prepare a release

1. Set the same new semantic version in `package.json`, `package-lock.json` and both Xcode `MARKETING_VERSION` settings. Increase `CURRENT_PROJECT_VERSION`. Never reuse a released version.
2. Run `npm ci`, `npm test`, `npm run test:render` and relevant native Mac QA.
3. Commit the release source, tag it `v<version>` and push the commit/tag.
4. Archive **Screenshot Studio** in Xcode. Official releases use the maintainer's Developer ID identity, Hardened Runtime and Apple notarization. Forks should set their own signing team and disable/change the official update feed before distributing a Developer ID build. Do not add credentials or certificates to Git.
5. Wait for Apple acceptance, export and staple the notarized app. A successful build alone is not notarization.
6. Run `npm run release:zip -- "/path/to/Screenshot Studio.app"`. This verifies Developer ID signing, stapling, Gatekeeper and the ZIP-extracted app. It creates a ZIP and SHA-256 file in `dist/`.
7. Create a **draft** GitHub Release for the pushed tag, upload the verified assets and write release notes. Publish only after reviewing the draft and assets.

Example (replace the version and architecture with the actual validated release):

```sh
gh release create v0.2.6 dist/Screenshot-Studio-0.2.6-darwin-arm64.zip dist/Screenshot-Studio-0.2.6-darwin-arm64.zip.sha256 --repo GioPalusa/ScreenShotStudio --verify-tag --draft --title 'Screenshot Studio 0.2.6' --notes-file /path/to/release-notes.md
```

The ZIP name must include `-darwin` (or `-mac`/`-osx`) and the architecture. A DMG alone cannot serve Squirrel.Mac updates. Publish a stable release, not a prerelease. Keep each architecture's assets in the same release. Older app builds without the updater require a one-time manual download of an updater-enabled release.

The first updater-enabled release still needs to be signed, notarized and published. To prove end-to-end updates, install that release, publish a newer signed release with the same signing identity and bundle ID, then verify download, save acknowledgement, restart and the new version. Unit tests do not establish that installation evidence.

Sources: [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater), [Electron updating guide](https://www.electronjs.org/docs/latest/tutorial/updates), [update service asset names](https://github.com/electron/update.electronjs.org#asset-naming-convention).

## 0.2.9 (11) — 18 October 2026

- A compact upload view with a clear success check, verified receipt count and Done action. Interrupted or incomplete uploads remain distinct from success.
- Edit all screens now follows the selected screenshot canvas, including iPad, with isolated shared edits and undo support.
- New MCP tools for targeted layer edits, whole-series previews and renderer-based preflight, plus reusable design, refinement and translation prompts.
- Apple asset guidance in the MCP catalog, preview/preflight results and bundled skill, with overlay-copy advisories and a visual-review checklist.
- Appearance selection lives in View → Appearance; duplicate selectors were removed from the toolbar, Welcome and About.

- Apple silicon (arm64), macOS 13 or later.

## 0.2.8 (9) — 18 October 2026

- PALUSA appearance with System, Light and Dark modes across the editor, Welcome and About.
- Simpler translation, export and upload flows, compact primary-screen previews and visual upload summaries.
- App Store search/header artwork and Google Play feature graphics share the screenshot project, translation and export workflow.
- Store artwork stays first in the sidebar; shared editing opens phone screens. Guide & MCP replaces the question-mark button.
- App-connected MCP tools and agent setup; document icons for both project extensions.
- Improved text-fit diagnostics, excluded local user workspaces from app bundles, and updated Electron to 44.7.0.
- Apple silicon (arm64), macOS 13 or later.
