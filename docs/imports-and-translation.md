# Translation and imports

## Translate screenshot text

Choose **Translate…** (the language icon) in the Translate view or a selected text layer’s Details. Choose the source and target languages, all slides or the current slide, and **Only missing text** or **Replace existing text**. A Details action scopes the current slide to the selected field. Add the target language first if it is not yet in the project.

Paste an OpenAI or Anthropic API key into the masked field. Keys are held only while the dialog is open; they are not stored in the document, preferences or logs. Each source string is sent in its own request with language IDs and an opaque text ID through fixed HTTPS endpoints. Other fields, slide names and field names are excluded so they cannot influence its meaning. The model is instructed to use natural wording while preserving the source text’s meaning and specificity, without adding places, features or claims. API billing is separate from ChatGPT/Claude subscriptions. The model field is editable for accounts with different model access.

A separate model request compares each translation with its source, accepting natural wording while checking for changed meaning and fluency problems. Fixable issues trigger one correction attempt and a fresh review. Unresolved issues and ambiguous source text are marked **Manual meaning check needed** in Translate and Details, with the source text and reasons visible. Automatic passes remain drafts; only a person marks text reviewed. Editing either text invalidates the saved automatic check. Review/correction requests use the same selected provider and model, increasing API usage and duration. If an API call or review response fails, the whole operation is rejected without changing text.

Responses are checked for complete IDs and unchanged placeholders. Results are applied only after every individual text request succeeds. Larger jobs make more provider requests and may take longer. Closing the dialog cancels application; any already processed provider work may still be billed. If source or target text changes while a request runs, the result is refused instead of overwriting the newer edit. Applied translations become draft with every field needing review and can be undone together. Saving uses the existing revision-checked save queue and recovery drafts.

Provider contracts: [OpenAI Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Defaults were checked on 2026-10-10: `gpt-5-mini` and `claude-sonnet-5-5`. Tests use fixture responses; a live, billed call needs the user's own API key.

## Import existing designs

Open **Overview → Import designs…** or **Media → Import designs…**. Choose images, one ZIP, or a folder; review previews and language assignments before importing. Matching project language folder names are recognised. Add missing project languages before import or change their assignment in the preview. Choose original image dimensions (new canvases) or an existing canvas. Original portrait/landscape sizes share a canvas with per-slide orientation. Existing slides stay intact. The appended slides and new canvases can be undone together; uploaded media remains available in the library.

| Source | What can be imported | Editing afterwards |
| --- | --- | --- |
| Figma | File or selection link in the app’s Figma dialog | Native text, editable rectangles/ellipses, vector paths and image fills. No automatic raster fallback. |
| AppScreens | PNG/JPEG files, ZIP or exported folders | Each composed screenshot becomes one image layer; add new layers above it. |
| AppMockUp | PNG/JPEG exports, individually or in a ZIP/folder | Same image-layer import. Choose PNG/JPEG when exporting; WebP is not part of this importer. |
| fastlane frameit | Folder/ZIP with `Framefile.json`, source PNG/JPEG screenshots, backgrounds and optional localized `title.strings`/`keyword.strings` | Capture, generic device, background, heading and keyword become separate editable layers. |
| Other design tools | PNG/JPEG image exports | Image-layer import. Proprietary project formats are not read. |

Flattened exports cannot recover the original text/device layers. Framefile import preserves matched default/per-file settings, text, text colours/weight/size, above/below placement and included backgrounds. It uses Studio's generic devices and the project font; external fonts, ImageMagick-specific geometry and complex frameit flags are not reproduced exactly. Imported copy is draft. Review the result before final export. Only selected-language layouts are created, so other languages can be designed separately.

### Figma views

On Home, choose **Import from Figma…** to create a new project containing only the selected views, with their original canvas sizes. Review the import before choosing where to save the new `.sss` package; cancelling the save keeps the preview available. Existing projects are never overwritten by this flow.

For an existing document, open **File → Import → From Figma…** (also available from Overview and Media). Paste a Figma file or frame link and enter a personal access token with `file_content:read` permission in the masked field. Choose **Load views**, select frames, then **Preview selected views**. Pick the language and original view sizes or an existing canvas, review the native-layer previews and reported differences, then import. Connection, selection, preview and import all happen inside Studio. No exporter plugin, browser tab or external import page is opened.

The token is sent only to Figma’s fixed HTTPS API endpoint. After a successful connection, the Mac app saves it in macOS Keychain and clears the renderer field. Reopening the dialog or app reuses the native stored key; it is never saved in documents, ordinary preferences or recovery drafts. **Replace key**, **Forget key** and **Edit expiry** manage the connection. Match the lifetime chosen when generating the key in Figma: **1 day**, **7 days**, **30 days**, **90 days** or **Custom date**. For an existing key, enter its actual expiry date or leave it unknown. These choices record expiry metadata; they do not generate, extend or refresh the Figma PAT. Known expiry blocks reuse, and an invalid/revoked key prompts replacement while retaining the file and selection. File-access errors and rate limits do not discard a working key. Browser development mode uses an ephemeral key. Closing cancels the request. The Codex Figma connection is separate from the application’s authentication. Source Figma files are only read; they are not edited. [Figma’s file endpoint](https://developers.figma.com/docs/rest-api/file-endpoints/) provides the node tree and `geometry=paths` vector geometry.

Text is stored in `copy/<locale>.json` with normal text layers and draft review status. Rectangles and ellipses use Studio’s shape controls. Other vectors remain path data in `studio.json`, drawn at export resolution; select one in Details and choose **Edit points**, double-click it on the canvas, or press Enter to edit its anchors and Bézier handles visually. Double-click an edge to insert a point; use **Corner**, **Smooth** or **Delete point** on the canvas toolbar. Arrow keys move the selected point (Shift: 10 px); **Done** or Escape exits. **Fill** offers colour, opacity and gradient stops, with start/end handles on the canvas. **Outline** controls width, colour and alignment; **Blur** has a slider and pixel input. Editing a fill preserves other imported fills. Raw path data is optional, under the closed **Advanced path data** section. Size and rotation retain the ordinary canvas controls. Image fills retain portable image files in the document and have a **Change image fill…** action. Groups preserve opacity, blending, clipping and vector masks through compositing metadata while their layers remain individually editable. Import and text changes use the ordinary save/recovery and Undo/Redo mechanisms.

There is no automatic conversion of text or vector layers to bitmap images. Some Figma features have limited translation: mixed text runs currently use the main text style; background blur needs review; angular/diamond gradients use a radial approximation. Layer blur, inner shadows, multiple group shadows and affine linear/radial gradients are retained. Skewed/reflected stroke outlines share their fill transform, and pass-through masks preserve blending against the backdrop. These differences are shown in the preview. Figma’s file API reports font names/styles rather than font files. Studio automatically collects matching Google Fonts from the official open-source repository, including variable weights, italic faces and the license. Font files are stored in `assets/fonts/` and referenced by `studio.json` → `fonts.files`; previews, reopened documents and frozen exports load those files without installing them in macOS. For other families, add the original `.ttf`/`.otf` files in the same dialog. Missing faces block import until supplied or explicitly accepted using available fonts. **File → Import → Font files…** can collect fonts for an existing document. The font picker labels included families as “project”. A missing/corrupt project font is a technical preflight error. Auto-layout is imported at its current geometry, not as a live Figma layout engine. Prototypes and animation are not imported.

Limits: up to 100 views per batch, 5000 layers and 64 nested groups per view, 10000 layers per batch; output canvases 100–12000 px per edge and 40 megapixels; images 32 MB each and 128 MB total. A selected-node link avoids loading a large whole-file tree. Rate-limit and access errors are displayed in the dialog without changing the project.

### Copy / paste from Figma

Use ordinary **⌘C** in Figma and **⌘V** in Studio, outside a text field. On Home, a copied native selection opens a new-project import preview. In an existing document it opens a review before adding editable layers to the current screen. Decoding is local and requires no Figma key. Embedded original images are retained; selections whose image bytes are absent must be imported through their Figma link. SVG files added through the editor’s Image picker or image drop area also become native layers.

| Clipboard content | Studio behavior |
| --- | --- |
| Normal Copy (⌘C) | Native text, fonts, shapes and vector paths, including vector networks; an internal preview precedes import. On Home, creates a new project. |
| Copy link to selection | Opens the internal Figma import dialog with the frame link filled in. |
| Copy as SVG | Native vector paths, shapes, gradients and embedded images; SVG `<text>` becomes editable text. Letters already outlined by Figma remain vectors, because the SVG contains no original text. |
| Copy as PNG | Adds an image layer; it does not replace a device capture. |
| Copy as code → CSS | Reviews supported properties in an internal dialog, then applies them to selected layers in one undoable edit. Width, height, position, solid fill/colour, outline, radius, rotation, opacity and typography are supported. Supplied code is never executed. |
| Figma’s internal Copy/Paste properties payload | Not decoded. Use CSS text for property transfer. |
| Paste animation / other code languages | Not imported. |

SVG parsing is inert: scripts, embedded HTML, external entities and external image references are rejected. SVG can be up to 8 MB. Basic transforms, paths, shapes, local references, gradients, simple clipping and embedded PNG/JPEG/WebP images are supported. Complex clips, filters, masks and mixed text spans can require review and are reported; they are not silently rasterized.

The old `.figma-studio.json` image exchange remains readable as a legacy image import. It does not convert old bitmap exports back into text or vector layers. See [verification scope](figma-import-verification.md).

ZIPs are read in memory; paths, symbolic links, duplicate names, CRCs and decompression limits are checked. Limits: one ZIP up to 64 MB; 300 supported files, 32 MB per file and 128 MB unpacked in total; images up to 40 megapixels and 16384 px per edge. Encrypted, split and ZIP64 archives are not supported. Framefiles are JSON data; Ruby Fastfiles are never executed.

## Research, 2026-10-10

- [AppScreens export documentation](https://help.appscreens.com/export/exporting-previewing-your-finished-screenshots) documents PNG/JPEG output and a fastlane-compatible folder structure. That structure is an image export, not a guarantee of editable Framefile source data.
- [AppMockUp export documentation](https://app-mockup.com/help/articles/how-to-export-instance-screenshots/) documents PNG/JPEG/WebP and ZIP output. The implemented path uses PNG/JPEG, without claiming access to their internal project format.
- [fastlane frameit documentation](https://docs.fastlane.tools/actions/frameit/) describes its JSON settings and localized Apple `.strings` files. This is the structured adapter implemented here, independently of the frameit renderer.
- [Truepane](https://github.com/antonkarliner/truepane) publishes a v2 JSON project exchange including localization and linked devices. It is another candidate for a future adapter; its JSON format is not currently supported. No Truepane implementation code was copied.
