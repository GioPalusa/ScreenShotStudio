# Contributing to Screenshot Studio

Welcome! We build an offline Mac app for editable App Store and Google Play screenshots. Bug reports, design feedback, translations, documentation and code are welcome.

## Get started

Use Node 22.12+ (Node 24 recommended). Clone this repository and run:

```sh
npm ci
npm test
npm run desktop
```

The desktop app and macOS packaging require a Mac. Core tests also run on Linux. `npm run test:render` requires Google Chrome; set `CHROME_PATH` for another Chromium installation. New documents use `starter/`; all test images are synthetic. No private example project or Apple artwork is required.

## Send a change

Open an issue for substantial changes, then fork the repository and open a pull request. Describe the problem, the resulting behavior and your validation. Keep changes focused and follow [AGENTS.md](AGENTS.md) for architecture and document safety. Use plain ES modules; there is no frontend build step.

Run `npm test`. Run `npm run test:render` when changing rendering or exports. Verify menu and pointer changes in the running Mac app. A headless test does not establish native interaction or release readiness. Never upload user documents, screenshots, API keys, signing certificates or Apple Design Resources.

Translations contributed without native review stay `draft` with `needsReview: ["*"]`. Final exports must pass preflight.

## Community and licensing

Be respectful, patient and specific. Critique ideas and code, avoid personal attacks and harassment, and respect people's privacy. Maintainers may edit or remove abusive content and restrict participation.

Contributions are offered under the [MIT license](LICENSE). Submit only work you have the right to contribute. Dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). PALUSA names and logos remain trademarks. Do not imply that a fork is an official PALUSA release.

Maintainers review contributions and publish official Developer ID releases. Community builds can be packaged ad-hoc and do not receive automatic updates from the official feed. See [docs/releases.md](docs/releases.md).

## Automated checks

Every pull request runs module and document tests, real Chrome rendering/export and UI tests, and Mac app packaging. The public source check rejects private project directories, credential files and common secret patterns. CodeQL analyses JavaScript for security issues; Dependabot proposes dependency and GitHub Action updates weekly. GitHub secret scanning and push protection are enabled.

Run `npm test`, `npm run test:render` and `npm run package` before proposing changes that affect those areas. Public checkout maintainers can also run `node tools/check-public-source.mjs`. The package check uses an ad-hoc signature; official releases are separately signed and notarized by the maintainer.
