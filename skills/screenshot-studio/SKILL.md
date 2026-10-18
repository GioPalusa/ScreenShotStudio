---
name: screenshot-studio
description: Create editable App Store or Google Play screenshots, App Store search/header images and Google Play feature graphics with Screenshot Studio MCP, using real app captures, AI-written copy, optional generated artwork, and multilingual PNG exports.
---

# Screenshot Studio

Use the Screenshot Studio MCP tools to deliver an editable `.sss` project and rendered store screenshots. The AI supplies art direction, copy and layout decisions; Screenshot Studio renders the actual output. Read [the editing reference](references/editing.md) when composing slides or custom layers. For App Store search/header artwork or Google Play feature graphics, read [Store images](references/store-images.md) and use `add_store_images`.

## Establish the story

Use the user's app, audience, features, brand and target store to choose a coherent visual direction and a benefit-led screen sequence. Inspect supplied captures and the app's source when available. Ask only for missing inputs that change the design; continue layout and copy work while waiting for captures.

Call `catalog` for the configured workspace, current canvas formats, starter designs and palettes. When catalog reports `mode: active-app`, work on the project currently open in Screenshot Studio. Call `read_project` without a project argument; pass its `projectSession` to every add, save, design, import and export call. If the app switches projects or a session is rejected, reread before continuing. A null project means the user must open a document in the app. In standalone workspace mode, all paths must remain inside the configured workspace. If MCP is unavailable, open Screenshot Studio → Help → MCP and Skills Guide. Choose the AI client, install the bundled skill and set up MCP, then reload the client and verify catalog works. For a source-only installation, consult `docs/ai-screenshots.md`. Report saved configuration separately from a live connection.

For App Store assets, read `catalog.assetGuidance` and [Apple’s asset best practices](https://developer.apple.com/app-store/asset-best-practices/) before composing. The tool’s dated guidance supplies the shared checklist and official specification links; recheck Apple when requirements may have changed. During preview and preflight, resolve `assetReview.advisories` and complete its visual checklist. `ready` reports technical checks, not editorial compliance or Apple approval. Use [the App Store review reference](references/apple-assets.md) for the delivery procedure.

## Build the editable project

In app mode, edit the active document; new documents are created and opened in Screenshot Studio. In standalone mode, create a `.sss` document with `create_project`, or use the user's existing document when requested. Read it with `read_project`. Its `studio`, `copy`, media inventory and revisions are the source of truth.

Use `read_project.editing` to find canvas IDs, design coordinates, capture collections, screens and layer IDs. Use `edit_layers` for targeted add/patch/remove batches; one batch is one revision-checked save. A slide edit affects that canvas only. `shared: true` uses the selected canvas’s row coordinates for continuous artwork. Use `save_document` for structural changes, `save_copy` for each locale, and `apply_design` for built-in layouts. Keep changes as editable text, device, art and shape layers. Each write requires the latest relevant revision. On conflict, reread and reconcile the intended edit with the newer document before retrying.

Build the requested variants together: iPhone, iPad and Duo open/closed use their own capture collections and proportions. Inspect each before selecting captures. Preserve existing store artwork, locale layouts and unrelated screens. For backgrounds that flow across screens, read [the editing reference](references/editing.md#continuous-series) and preview the whole row with its spacing. Keep the area behind headlines quiet and retain the user’s requested accents. Use realistic, appealing sample data consistent across captures; for example, a running story should show a meaningful distance with coherent pace and completion times.

Use real captured app screens inside device layers. Import local PNG captures with `import_media`, using the canvas's capture collection and the slide's capture name. Localized captures use the locale ID as scope; shared captures use `default`. Importing a capture creates a new name; to replace an existing image, import under a fresh name and update its layout capture reference.

When generated illustrations or backgrounds help the direction, use an available image-generation capability and import the resulting local image as `art`. Keep headlines and captions as text layers. Generated imagery is decorative artwork; missing app captures stay visible placeholders until actual screens are supplied. In app mode, image files must be inside the active .sss package or its adjacent `inputs/` folder; exports stay inside the .sss package. Copy generated artwork into one of those locations before importing. In standalone mode, copy images into the configured workspace before importing.

All AI-written copy is saved as draft requiring review. Add target locale metadata to `studio.locales` before saving its copy with revision `missing`. Use full store locale IDs and set `dir: rtl` for right-to-left languages. Preserve existing locale variants unless the user requests changes. Only a native reviewer approves translations.

## Render and inspect

Use `preview_project` to inspect the complete series before full-size export. It returns a labelled image directly, with actionable issues keyed by locale/device/slide/layer. It defaults to the source language and all canvases; use filters to review translations in batches of up to 12 rows. Check hierarchy, text wrapping, capture fit, background continuity, cropping and contrast across every requested canvas, including iPad. Revise the editable source and preview again when issues remain.

Use `preflight_project` to check all selected languages and canvases without publishing images. Missing captures, text fit and pending language review remain visible. Report localized captures that fall back to another language. If the user requests a review before export, show the complete series and wait for that review. AI-written copy stays draft; design approval does not establish native-language review.

`allowPlaceholders: true` is useful for an explicitly provisional layout preview. Report missing captures and review flags. For deliverables, use `export_project` with `mode: final`; it runs the app's strict preflight against a frozen source. Resolve the returned warnings instead of weakening checks to obtain a final.

Return the project path, completed export directory and a representative screenshot. State whether the export is draft or final and identify any remaining review or input needs. Store upload or publication requires the user's request.

MCP clients can also discover the `design_screenshots`, `refine_series` and `translate_series` prompts. Add the app brief, visual reference, exact wording or target languages to the matching prompt.
