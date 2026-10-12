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
| AppScreens | PNG/JPEG files, ZIP or exported folders | Each composed screenshot becomes one image layer; add new layers above it. |
| AppMockUp | PNG/JPEG exports, individually or in a ZIP/folder | Same image-layer import. Choose PNG/JPEG when exporting; WebP is not part of this importer. |
| fastlane frameit | Folder/ZIP with `Framefile.json`, source PNG/JPEG screenshots, backgrounds and optional localized `title.strings`/`keyword.strings` | Capture, generic device, background, heading and keyword become separate editable layers. |
| Other design tools | PNG/JPEG image exports | Image-layer import. Proprietary project formats are not read. |

Flattened exports cannot recover the original text/device layers. Framefile import preserves matched default/per-file settings, text, text colours/weight/size, above/below placement and included backgrounds. It uses Studio's generic devices and the project font; external fonts, ImageMagick-specific geometry and complex frameit flags are not reproduced exactly. Imported copy is draft. Review the result before final export. Only selected-language layouts are created, so other languages can be designed separately.

ZIPs are read in memory; paths, symbolic links, duplicate names, CRCs and decompression limits are checked. Limits: one ZIP up to 64 MB; 300 supported files, 32 MB per file and 128 MB unpacked in total; images up to 40 megapixels and 16384 px per edge. Encrypted, split and ZIP64 archives are not supported. Framefiles are JSON data; Ruby Fastfiles are never executed.

## Research, 2026-10-10

- [AppScreens export documentation](https://help.appscreens.com/export/exporting-previewing-your-finished-screenshots) documents PNG/JPEG output and a fastlane-compatible folder structure. That structure is an image export, not a guarantee of editable Framefile source data.
- [AppMockUp export documentation](https://app-mockup.com/help/articles/how-to-export-instance-screenshots/) documents PNG/JPEG/WebP and ZIP output. The implemented path uses PNG/JPEG, without claiming access to their internal project format.
- [fastlane frameit documentation](https://docs.fastlane.tools/actions/frameit/) describes its JSON settings and localized Apple `.strings` files. This is the structured adapter implemented here, independently of the frameit renderer.
- [Truepane](https://github.com/antonkarliner/truepane) publishes a v2 JSON project exchange including localization and linked devices. It is another candidate for a future adapter; its JSON format is not currently supported. No Truepane implementation code was copied.
