# Editable Figma import verification

Verified 2026-11-12. The current importer uses native Studio text, shapes and vector paths. The previous external exporter/flattened-image workflow has been removed from the product UI.

## Visual vector editing usability check

On 2026-11-12 the new Xcode Debug build was tested with native mouse/keyboard input. In a separate Figma-schema curve fixture, dragging an anchor and its Bézier handle changed the visible curve; Undo/Redo and closing/reopening retained native path geometry. Dragging a gradient endpoint changed the visible fill and angle; entering a stop position and outline width changed the picture; dragging the blur slider softened the vector and Undo restored its sharp edges. Gradient stops use compact rows, and SVG text is hidden under a closed advanced section.

A separate document containing frame **1312** from the real Community import was opened. Its rotated **Bezel** exposed eight points in the correct positions, including geometry outside the frame. Dragging a point visibly changed the curved phone edge; Undo restored the source geometry. The original full import document was preserved.

`tools/vector-editing.test.mjs` checks closed paths and holes, attached handles, exact cubic/quadratic/arc splitting, smoothing the closing edge, deletion limits, affine coordinate inversion and preserving sibling fills. `tools/vector-editing-ui-test.mjs` drives the real editor with pointer events and ordinary controls: point/handle drag, Corner/Smooth, edge insertion, point deletion, gradient stops/opacity/addition/direction, outline and blur. It checks Undo/Redo and identical rendered pixels after save/reopen. Both are included in the standard checks. Native UI review confirmed visible controls and usable hit areas; the raw path field is no longer the default editing interface.

## Visual fidelity correction and whole-file review

The earlier full-file import test established editability and completeness, but did not establish visual fidelity. The user's visual review exposed misplaced stroke outlines and missing blur. The following review supersedes that earlier visual assessment.

On 2026-11-12, all **75 views** were captured directly from the supplied Figma file as scale-1 PNG references at one recorded version, along with the original node tree and the 26 image fills actually used by those views. The updated importer rendered all 75 views again through the real Studio engine. All dimensions matched. Seven contact sheets covering every view were visually reviewed, with enlarged comparisons for the reported examples and remaining outliers. The user explicitly excluded font-style matching from this correction and retained the existing font-import workflow.

Corrected behaviors:

- Stroke geometry created as a separate editable path now retains the fill's reflection and skew. This removes displaced white/black contours on the phone frames.
- Layer blur is preserved as numeric effect data, with padded rendering so geometry outside the frame still contributes to the blur. Native clipboard foreground-blur records use the same effect.
- Inner shadows and all drop shadows on a group are composited while retaining native geometry.
- Linear gradients honor the perpendicular handle. Elliptical radial gradients are painted in their affine coordinate system, restoring glass/rim highlights.
- Pass-through masks blend their children against the actual backdrop. Alpha replacement preserves the backdrop instead of isolating overlay/multiply effects on transparency.

`tools/figma-fidelity.test.mjs` first failed for the missing affine outline and missing blur. `tools/figma-fidelity-render-test.mjs` additionally failed on radial gradients, masked backdrop blending and multiple shadows before the fixes. The final seven renderer cases compare against independent SVG/mathematical references: mean channel error is at most 0.021/255, with no pixels above the 25-channel difference threshold. These are controlled effect regressions, not a promise of pixel identity across arbitrary Figma documents.

The complete real-file graphics comparison excludes text bounding regions when calculating diagnostics. Mean per-view channel error was **0.298/255**; remaining differences include image sampling/colour and edge antialiasing. Full-image metrics include the deliberately unmatched fonts, so those are not a pass criterion. The local report contains both original and Studio images for all 75 views, not just selected examples.

Review artifacts are outside the repository under `~/Documents/Screenshot Studio Import Tests/Visual comparison 2026-11-12/verified/`. `report.html` shows all reference/import pairs. A separate `Figma import – grafiskt korrigerad.sss` was created and opened in the new Xcode Debug build; the prior test document was preserved. Native checks on 1343 and 1312 confirmed the soft field and corrected phone edges. Text editing and vector fill editing were undone successfully. A real copied Figma ellipse was pasted as a native ellipse with `blur: 114`, then undone, leaving the corrected document unchanged.

The final `npm test` run passed **362 tests**; `npm run test:render` passed including shared-layout pixel regressions and the new effect cases. The Xcode Debug build passed.

Reproduction tools:

- `tools/figma-reference-capture.mjs`: read-only capture using the native Keychain adapter; never saves credentials or expiring download URLs, and refuses reference output inside the repository.
- `tools/figma-visual-compare.mjs`: offline import/render of every captured view, preserving the supplied document and producing a new editable review package.
- `tools/figma-contact-sheets.py`: contact sheets, paired HTML report and pixel diagnostics (Pillow/NumPy required). Text regions are excluded only from the separately labelled graphics metric.

## Real Community template

The user-provided [App Store Screenshot Template (Community), screen 8:117](https://www.figma.com/design/zn6ZFvOF9PiMUkv8Lu9hdN/App-Store-Screenshot-Template--Community-?node-id=8-117) was loaded through the packaged Mac app's Figma API dialog. The user entered the read token directly in its secure field; it was not provided in chat or written to the document.

The app selected frame **1267**, previewed it, then imported and saved it at **375 × 808**. Inspection of the saved document confirmed:

- One native text layer, with the original characters in the locale copy JSON.
- Three shape layers with `shape: "path"` and real vector path commands (657, 628 and 45 characters respectively).
- One native rectangle background.
- No art/image layer replacing the full view.

Native UI checks changed the headline in the normal text editor, changed the phone body's vector fill via the palette, and undid both changes. The original text and vector fill were restored. The original Figma file was only read.

The template's **Mulish** family is not installed on the test Mac. The native **File → Import → Font files…** dialog collected the original Google Fonts family, normal and italic variable faces (weights 200–1000), and OFL license files into the imported project. After saving, returning Home via the logo, and reopening the recent project, the native canvas retained Mulish without any system-font installation.

A strict export of a temporary copy of this real document passed as RGB PNG at **375 × 808**, with **zero preflight warnings and no font substitution**. Original text and draft metadata were preserved. This establishes portable typography and export compatibility, not pixel equality for every Figma feature.

The official Figma MCP connection could not read this Community file because it required edit access. The application's read-only REST import succeeded with the user's token, including the selected frame link. This distinction is intentional: the app does not depend on Codex or an external plugin.

## Home, full-file and live clipboard checks

The local Mac build was tested with the real Community file through **Home → Import from Figma** and **Select all**. It created `Figma import – verifiering.sss` under the user's `Documents/Screenshot Studio Import Tests`, containing **75 screens**, **6 canvases**, **134 native text layers**, **630 vector path layers** and **26 original image asset files**. No starter screen or token was written to the document. Twelve font faces, with licenses, were embedded. The file also references unavailable commercial/other families (including Satoshi, Aeonik and Netflix Sans); the test explicitly accepted available-font substitution. This full-file import is therefore not a pixel-equality claim. Font names remain available for later replacement with the originals.

A separate **Home → Import from Figma** import of the individual headline, node **8:122**, used the saved Keychain connection and created a one-layer **311 × 129** project with embedded Mulish. It contained no starter screen. Native text editing and keyboard Undo restored the original copy. White text copied without its parent background remains white on the new canvas.

Actual Figma desktop copy/paste was then exercised, rather than only fixture clipboard HTML:

- Ordinary **⌘C** on the headline opened Studio's key-free native clipboard preview, pasted a second editable text layer with Mulish, and was undone in one step.
- Ordinary **⌘C** on frame **1267**, then **⌘V on Home**, created and saved `Figma urklipp – hel skärm.sss`: **375 × 808**, one native Mulish text layer, three vector paths and one rectangle. Figma's network-only geometry was decoded into cubic/line commands; detached effect-style resources were excluded from canvas bounds. The project reopened from Home with the original five layers and embedded font faces.
- Figma's **Copy/Paste as → Copy as SVG** on the phone group pasted three native layers. Saved JSON contained vector commands; one Undo removed the added SVG layers.
- Figma's **Copy as PNG** pasted a separate image layer with ordinary image controls. Undo restored the original scene. Existing device captures were not replaced.

The read key was entered by the user directly in the app and successfully stored in macOS Keychain. A later import reused it with no key entry. After a process restart, the native connection status remained stored; a subsequent API request hit Figma's rate limit and retained the key. The live native lifetime menu showed **1 day / 7 days / 30 days / 90 days / Custom date**; metadata could be saved without reentering the key. The existing key's actual expiry is unknown and was left unknown. Expired/revoked responses and known-date rejection are covered by controlled automated tests, not by revoking the user's real key.

## Automated coverage

`tools/fixtures/figma-native.json` is a synthetic REST-schema fixture, not a copy of the Community template. `tools/figma.test.mjs` verifies native text/copy, vector commands, canvas scaling, image reference protection, read-only fixed endpoints, request versioning, authentication isolation, errors and CSS property parsing.

`tools/figma-native-ui-test.mjs` drives the actual app modules in Chrome with fixture Figma HTTP responses. It covers:

- Masked key, file loading, frame selection, native canvas previews and import without mutation before confirmation.
- Native rectangle/vector rendering, editable vector paths and text, vector masks, once-only group opacity, original image fills and portable assets.
- Save, Undo and Redo, with source text review remaining draft.
- SVG clipboard paths and real SVG text, simple clipping, script rejection, CSS property review/application, PNG image-layer paste and selection-link paste into the internal dialog.
- No key in project state, local storage or saved JSON.
- Real Mulish font bytes load in Chrome; preflight recognizes the document font; saved/reopened output matches pixel for pixel; a missing font is a technical export error; import Undo/Redo also restores the font manifest.

`tools/figma-project.test.mjs` verifies atomic new-project creation, individual text-node API import and clipboard vector-network curves/bounds. `tools/figma-settings.test.mjs` verifies native-only Keychain storage/reuse, metadata editing, known expiry, server rejection, replacement and preservation across file-access errors. `tools/figma-home-ui-test.mjs` covers complete and partial selection, font collection, save-dialog cancellation/retry, new-project creation, expiry presets and replacement without losing the selected views.

`tools/home-ui-test.mjs` verifies the project gallery with real rendered thumbnails (including selection of the imported canvas over an empty starter), search and its empty state, sorting, light/dark appearance without changing artwork, all recent-project entries, the palette-led creation flow, logo navigation and File import dispatch. `tools/recent-previews.test.mjs` verifies that thumbnail routes are restricted to recent documents and read-only artwork, reject traversal and mutation, and leave document files unchanged. Native Mac review showed real Map my day and Community-template previews in the gallery. `tools/project-fonts.test.mjs` verifies original family/weight metadata, licenses, portable files, frozen export snapshots, fixed Google sources and safe Home summaries. Native Mac checks exercised File → Import, collection of real Mulish, Home/New project/back navigation and reopening the imported document.

The complete `npm test` and `npm run test:render` suites passed, including the existing shared-renderer pixel checks. Xcode Debug builds passed. Existing layouts retain their rendering behavior.

Reproduce:

```sh
node --test tools/figma.test.mjs
node tools/figma-native-ui-test.mjs
npm test
npm run test:render
```

## Limits

Mixed text spans currently use their primary style. Background blur, angular/diamond gradients, complex SVG masks/filters and prototypes/animation need review or are unsupported; they are not replaced with bitmap fallbacks. Figma's internal clipboard property payload is not decoded; supported CSS text can be pasted onto selected layers instead. The tests establish native editability and the stated rendering behaviors, not complete equivalence for every Figma feature.

The Mac package used here is a local Debug build. This is not signing/notarization or distribution verification.
