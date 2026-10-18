<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/github-logo-dark.svg">
    <img src="docs/assets/github-logo.svg" alt="Screenshot Studio" width="640">
  </picture>
</p>

<h1 align="center">Screenshot Studio</h1>

<p align="center">
  <b>Turn your app screenshots into a story.</b><br>
  Editable designs, connected screens, device illustrations and multilingual copy.<br>
  An offline Mac app. Open source under MIT. Your projects stay on your Mac.
</p>

<p align="center">
  <a href="https://github.com/GioPalusa/ScreenShotStudio/actions/workflows/ci.yml"><img alt="Tests" src="https://github.com/GioPalusa/ScreenShotStudio/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/GioPalusa/ScreenShotStudio/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/GioPalusa/ScreenShotStudio/actions/workflows/codeql.yml/badge.svg"></a>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2EAAE1?style=flat-square">
  <img alt="macOS 13+ · Apple silicon" src="https://img.shields.io/badge/macOS-13%2B%20%C2%B7%20Apple%20silicon-101C36?style=flat-square">
</p>

<p align="center">
  <a href="https://github.com/GioPalusa/ScreenShotStudio/releases/latest"><b>Download for Mac</b></a> ·
  <a href="https://github.com/GioPalusa/ScreenShotStudio/discussions">Join the community</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

![Screenshot Studio 0.2.8 in dark mode, editing a four-screen Pulse design](docs/assets/editor-demo-0.2.8.jpg)

*The four-screen Pulse starter design in Screenshot Studio 0.2.8, with the new dark appearance and original sample app content.*

> [!NOTE]
> Build this with us. Designers, translators, developers and people shipping their first app are welcome. Share designs and ideas in [Discussions](https://github.com/GioPalusa/ScreenShotStudio/discussions), or tell us what needs improving in [Issues](https://github.com/GioPalusa/ScreenShotStudio/issues).

[Features](#features) · [Downloads](#downloads) · [Get started](#get-started) · [Under the hood](#under-the-hood) · [Contributing](#contributing) · [Documentation](#documentation)

## Features

### One story across your screens

Work on an entire screenshot row in **Edit all screens**, or refine one screen at a time. Text, images and shapes can continue across screen edges. Choose App Store, Google Play or custom spacing; exported screenshots crop each screen without the preview gaps.

### Keep every design editable

Arrange text, screenshots, shapes and artwork as layers. Move, resize, rotate and align objects on the canvas. Save reusable designs, duplicate screens, and undo changes. Device illustrations and imported frames are separate from the output canvas, so a design can adapt to different store formats. Installed frames are shared across all projects on your Mac; used artwork is retained in the document for portability.

Select a text layer and choose **Text size → Fill frame** in Details to grow or shrink the text to its frame. Enter keeps a line break; resizing the frame updates the text size. **Max size** keeps the existing size limit, and **Auto text height** lets the frame follow the text again.

### Every language in one project

Edit translations alongside the design, preview right-to-left layouts, and export or import review CSVs. Each language keeps its own copy and review status. Original text remains visible above each translation, including manual edits. One portable project produces every language × canvas × screen.

Choose the original language in Translate; its text does not need translation review. **Translate all…** translates every screen to all target languages in one run, with one Undo for the result. Translate with OpenAI or Claude using a suggested model, or choose **Load models from API** to fetch the models available to your key. Model selections and lists are remembered per provider; the Mac app stores API keys in macOS Keychain, outside your project. **Forget saved key** removes a provider's key. Browser development mode remembers models without saving keys. Removed text layers disappear from Translate while their saved copy remains available for undo. **Mark screen reviewed** approves one screen; **Mark design reviewed** approves every screen in that language.

A language-specific screenshot overrides the standard screenshot. When it is absent, the standard screenshot is used automatically; if there is no separate standard image, the original language's screenshot is used.

Languages without their own screen order follow the original language's order, including the shared canvas. Missing translated text previews the original copy with its original text direction.

### Export with confidence

Preflight checks identify missing captures, overflow and other issues before export. Final CLI exports can require all checks to pass. Outputs are RGB PNGs at the exact configured dimensions, with a manifest and upload guide. Each completed export is kept inside the .sss project and appears in Export and Upload when you reopen it. The Mac app also asks for an output folder for an additional dated copy.

### Your work stays yours

Projects are ordinary portable `.sss` directory packages. Autosave uses atomic writes, revision checks and recovery drafts. The desktop app runs offline through a private protocol, with no local web server or required account. Optional translation services require your own provider configuration.

## Downloads

| Platform | Download | Requirements |
| --- | --- | --- |
| macOS · Apple silicon | [Latest release](https://github.com/GioPalusa/ScreenShotStudio/releases/latest) | macOS 13 or newer; Developer ID signed and notarized by Apple |

Unzip the release and move **Screenshot Studio.app** into **Applications**. Checksums are attached to each release. Intel Mac, Windows and Linux binaries are not currently published.

Version 0.2.6 introduces native updates. Install it manually once if you have an earlier build. Future official releases can download through **Screenshot Studio → Check for Updates…**; installation waits for acknowledged project saves.

## Get started

1. Create a project and choose a palette and store canvas.
2. Add your screenshots and select a device illustration or import your own frames.
3. Pick a design, edit the layers and translate your copy.
4. Preview every screen and export your PNGs.

Open **Help → MCP and Skills Guide** for connection instructions, skill installation and examples. **Add screens → Store images** creates App Store **Search result image** + **Header image** canvases together, or a Google Play **Feature graphic** (1024 × 500 px). They have their own screens and export destinations. Individual formats remain available in Setup → Canvases. MCP exposes the same sets through `catalog` and `add_store_images`; search/header exports upload through the app’s Upload view.

See the [user guide](docs/user-guide.md) for the full workflow.

### Run from source

Requires Node.js 22.12+ and npm. The desktop app is currently developed and packaged on macOS.

```sh
git clone https://github.com/GioPalusa/ScreenShotStudio.git
cd ScreenShotStudio
npm ci
npm run desktop
```

```sh
npm test             # module, storage, document and updater tests
npm run test:render  # real Chrome UI and export integration
npm run package      # ad-hoc signed Mac developer build
```

Renderer tests require Chrome; set `CHROME_PATH` if it is installed elsewhere. An ad-hoc development build is separate from the signed and notarized official release.

## Under the hood

### Create screenshots with an AI agent

The local MCP server and companion skill let an AI agent create editable projects, write multilingual copy, import your app captures and optional generated artwork, and render and inspect screenshot exports. Open **Help → MCP and Skills Guide** to choose Codex or Claude Code, install the bundled skill and connect MCP to the project open in the app. Project switches are followed automatically. The downloaded app includes the server and renderer; no separate Node, Chrome or source checkout is needed. See [AI screenshot setup and tools](docs/ai-screenshots.md).

- Plain JavaScript ES modules, with no frontend build step.
- Pure document, layout and edit modules shared by the renderer and Node tests.
- Filesystem services in `host/`; native menus, documents and updates in `desktop/`.
- Electron desktop shell using `studio://local`, with no listening HTTP server.
- Synthetic fixtures for tests; private user projects and Apple artwork are excluded.

Pull requests run code tests, real renderer/export tests, Mac packaging, a public source check and CodeQL security analysis. Dependabot checks npm dependencies and GitHub Actions weekly. See [contribution guidelines](CONTRIBUTING.md).

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, translations, design improvements, documentation and code contributions are welcome. Discuss larger changes before implementation so we can agree on the scope.

This is an early public release. Please include your macOS version and steps to reproduce when reporting issues. Automatic installation of a newer published version will receive end-to-end verification when a subsequent release is available.

## Documentation

- [User guide](docs/user-guide.md)
- [Building, signing and publishing releases](docs/releases.md)
- [Security policy](SECURITY.md)
- [Third-party notices and artwork](THIRD_PARTY_NOTICES.md)

## License

[MIT](LICENSE) © Giovanni Palusa. Apple device artwork is not bundled or covered by this project's license. Import your own assets under their applicable terms.
