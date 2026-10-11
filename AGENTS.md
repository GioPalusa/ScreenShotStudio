# Screenshot Studio instructions

Standalone Mac application repository. The Xcode project packages the existing Electron app for Developer ID distribution; it is not the Map my day iOS app. Build with Xcode MCP when available. Archive/Organizer distribution may use Xcode UI or a shell archive fallback if the MCP cannot archive. Never call a build notarized until Apple acceptance and stapler validation are verified.

This folder generates the App Store screenshots (every language × device × slide). See `README.md` for the human guide.

- User documents are plain files; `starter/` is the only bundled seed. Historical `project/` is a development regression fixture and must never ship. Document contents: `studio.json` (languages, devices, themes, templates, slides, layouts), `copy/<locale>.json` (all text), `captures/**.png` (app screenshots) and `assets/` (device frames, images used as layers). Edit those, not `export/`.
- The primary product is the Mac app: `npm run desktop`, or `npm run package` for an ad-hoc signed `.app`. It uses a private `studio://local` protocol with no listening HTTP server. `node studio.mjs --no-open --port 4729` is optional browser development mode; restart it after changing host code.
- User projects are portable `.sss` directory packages (legacy `.screenshotstudio` packages remain readable). On first launch the Mac app shows the palette-led welcome screen. New documents come from `starterProject`, never the historical fixture. Preserve atomic writes, revision conflict checks, acknowledged saves and recovery drafts. Backups live in `.history/`, complete versions in `.versions/`.
- Rebuild draft exports with `node studio.mjs export [--locale a,b] [--device iphone,ipad] [--slide id]`; add `--strict` for final export. Final runs must pass preflight before any outputs are published. Each run uses a frozen source snapshot and its own output directory and manifest.
- Copy files are UTF-8 JSON. Keep `_meta.status` honest: new or machine-written translations are `"draft"` with `"needsReview": ["*"]`; only a native reviewer sets `"approved"`. `\n` in a headline is a deliberate line break.
- Locale ids follow store identifiers (`en-US`, `de-DE`, `zh-Hans`, `ar-SA`, `he`, …). Keep them in sync with that folder. Languages can be added and removed in the studio (Languages view); a removed language's files go to `project/_removed/`, not the bin.
- Never put credentials or API keys in this folder.
- Exports must stay **RGB PNGs without alpha** at the exact sizes in `studio.json` → `devices[*].size` (editable in the studio: Setup → Devices and sizes; layouts are drawn for `designSize[0]` px wide and scaled).
- The iPhone Duo frame is a stand-in; do not describe it as Apple's official artwork. Real bezel PNGs go in `project/assets/frames/` (Setup → Frames, or `tools/measure-frame.mjs`).
- New documents have no captures or imported assets. Missing captures show a placeholder and block final export. Preserve existing user documents.

## How the code is organised (no build step, plain ES modules)

- `app/js/layouts.js` turns slide + canvas + locale into layers (built-in templates, `overrides`, added `layers`, `use` of a project template, panorama, language-specific adjustments). Pure data, runs in Node: `resolveLayers({ project, slide, deviceId, localeId })`. `devices` are output canvases; `profiles` describe the hardware shown by individual layers, independently of their capture collection.
- Keep document, layout, profile, selection and preflight modules independent of Node and Electron so the same core can support a future web host. Filesystem operations belong in `host/`; native menus and document lifecycle belong in `desktop/`.
- `app/js/layer-ops.js` and `project-ops.js` are the edit operations (patch/add/remove/reorder layers, templates, resize/add/remove devices). Also pure; the editor saves and redraws after calling them. Keep new editing logic there so it can be tested from Node.
- `app/js/render.js` (`Engine`) draws a scene; `devices.js` composites a screenshot into a frame (fit, black glass, rounded corners, bleed); `frames.js` has frame references; `measure.js` finds a bezel's screen and corner radius (shared with `tools/measure-frame.mjs`).
- `app/js/ui/*` is the interface: `editor.js` wires the rail, `stage.js` (selection, drag, resize, rotate, snapping) and the inspector tabs (`text-panel`, `screenshot-panel`, `layers-panel`, `design-panel`); `setup.js` (+ `devices-view`, `frames-view`, `templates-view`), `languages.js` (+ `locale-dialogs`), `overview.js`, `export.js`.
- Layout edits must call `checkpoint()` (store.js) first so they can be undone; data written by the editor must stay plain JSON without private `_` fields.
- Never block rendering on `requestAnimationFrame` or `img.decode()`: they stall while the page is hidden.
- `npm test` checks module syntax, layout logic, storage failures, conflict handling, desktop protocol and export snapshots. `npm run test:render` exercises the real renderer and final-export rejection with synthetic fixtures. Extend these when changing behavior. Compare existing exports pixel by pixel when changing shared render logic. Packaging and headless tests do not prove native menu or pointer interaction; verify those in the running Mac app when UI access is available.
