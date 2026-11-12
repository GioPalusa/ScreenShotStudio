# Screenshot text optimization

Implemented 2026-11-12 from the [source analysis](research/screenshot-text-placement-2026-11-12/REPORT.md).

## App

The Text inspector reports nominal rendered font size at 160/240/320 px image width, separately from text fitting. Small text and low known contrast receive advisory styling. Empty, hidden and mask-only text is excluded; all-screens inspection uses the selected screen's own dimensions.

Export includes a separate **Review text at small sizes** dialog. Choose a language, canvas and 160/240/320 px image width. The dialog renders a frozen snapshot with the actual Engine, keeps the diagnostic image width and lets long series scroll horizontally. Its measurements and suggestions do not alter technical readiness or weaken strict export.

## MCP

`preview_project` and `preflight_project` always include `textReview`, even with `details` omitted. `previewWidth` accepts an integer from 80 to 640. Preview tiles keep this nominal width and long rows wrap without shrinking the images. Preflight adds this width to the diagnostic measurements without publishing a preview. `details: true` continues to add the full measured layer/capture inventory and source revisions.

Each scene reports its locale, canvas and slide IDs, presentation type, layer font sizes, lines, line texts, shrink, fallback, overflow, simulated sizes and contrast. Advisory IDs use editable raw shared layer IDs. Store screenshots, header/search creative assets, Google Play and custom outputs have separate presentation/specification metadata. Actual crop/safe-area approval is explicitly unverified.

`text-review.js` owns the shared policy and pure analysis. The default 12 px diagnostic size and 4.5:1 contrast target are review heuristics, not Apple requirements or conversion forecasts. Supported flat colors use sRGB relative luminance and alpha composition. Background images, gradients, partial plates, rounded plates, overlapping foreground content, affine transforms and scoped compositing return unknown when a trustworthy ratio cannot be established. Rasterized text inside captures is reviewed visually.

The catalog, prompts and bundled skill explain benefit-led copy, readable app evidence, language-specific review and baseline/variant experiments. Existing mutation/session/revision checks and draft translation status remain in force.

## Orbit Club delivery

`output/orbit-club/Orbit Club — baseline.sss` preserves the original. The updated `Orbit Club.sss` has one editable 92 designpx headline per image, actual portrait captures of its runnable fictional prototype, native Bézier orbit paths, rounded iPad frames and soft shadows.

- Main headline at 160 px image width: 14.26 px, with no fitting shrink.
- Known flat-background contrast: 10.38:1 on cream and 10.29:1 on teal.
- Diagnostic advisories: 20 before, 0 after. This compares a design package, not an isolated A/B test or measured conversion lift.
- Four strict-export PNGs: 2064 × 2752, RGB without alpha.
- `comparison.html`, diagnostic JPEGs, `optimization-variant.json`, final manifest and `installed-verification.json` preserve the comparison and evidence.
- AI-written source copy remains draft. The captures still depict a fictional concept, not a released native app.

## Verification

- `npm test`: passed; includes nine pure text-review tests. Optional renderer tests use their normal opt-in switches.
- `npm run test:render`: passed existing renderer, export, UI and pixel checks. The newly added `text-review-ui-test.mjs` also passed independently after the last dialog changes and is included in future full render runs.
- `STUDIO_MCP_RENDER_TEST=1 node --test tools/mcp.test.mjs`: passed the real renderer path, including diagnostic width and textReview assertions.
- Isolated Chrome tested the actual inspector/export dialog, width switching and independence from technical export gating.
- Xcode MCP built the final app successfully. Installed development app passed codesign validation and source-file comparison; this is not a notarization claim.
- A fresh installed stdio MCP session verified all 18 tools were discoverable, updated prompts/resources, 640 px preview, technical preflight, reopening without revision changes and matching installed skill copies.
- The official skill validator passed. Native CUA window access timed out; native pointer/menu interaction was not established by this work.

The initial sandboxed test run failed only the three Unix-socket MCP tests with EPERM. The authorized rerun with local socket access passed; no test was weakened to obtain the result.
