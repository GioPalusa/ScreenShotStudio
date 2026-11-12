// Shared by the in-app guide and MCP prompt discovery.
const appleGuidance = ' For App Store work, follow catalog.assetGuidance and read screenshot-studio://guide/apple-assets. Make the first image explain the app’s benefit, use one dominant promise and visible app evidence, and preserve the requested brand accents. Preview at previewWidth=160 and 320; read textReview sizes, contrast and hierarchy advisories for each locale/canvas. Review unknown contrast and text baked into captures visually. Simplify competing small overlays rather than shrinking text to fit. Treat position and alignment as test hypotheses, not universal rules. Keep a baseline and name design variants with their hypothesis; simultaneous changes test a package. Review assetReview too; technical readiness is not Apple approval or a conversion guarantee.';
export const AGENT_PROMPTS = {
  design_screenshots: {
    title: 'Design a screenshot series',
    description: 'Build an editable story from real captures on the open document’s screenshot canvases.',
    text: 'Use Screenshot Studio on the project currently open in the Mac app. Read its projectSession, editing inventory, copy and captures first. Build a benefit-led screenshot story using the app’s actual features and supplied visual direction. Keep headlines and captions editable. Match each canvas to its own capture collection, including iPad and each Duo posture. Use realistic, appealing sample data. Preserve existing store artwork and unrelated screens. Show the complete series with preview_project before final export; report missing captures and language review needs.',
  },
  refine_series: {
    title: 'Refine the open series',
    description: 'Adjust the current composition while preserving other screens, captures and translations.',
    text: 'Read the open Screenshot Studio project and its projectSession. Inspect the affected scope with inspect_layers; use edit_layers and the current revision for native edits, arrange_layers for measured alignment/spacing, and edit_project for canvas orientation, templates and shared row spacing. Keep unrelated layers, canvas variants and locale layouts. For continuous backgrounds, use shared layers in each canvas’s row coordinates and account for screen spacing. Keep the headline area quiet, preserve the requested colour accents, and keep text editable. Preview the complete affected series on every affected canvas, including iPad, with details=true when checking text fit or geometry. Report what changed and any preflight issues.',
  },
  translate_series: {
    title: 'Translate and review the series',
    description: 'Write natural store copy and preview the complete sequence in each target language.',
    text: 'Read the open Screenshot Studio project, its projectSession, source copy and existing locales. Add only the requested languages; use the app’s declared supported locales when supplied. Preserve meaning, feature claims, tone and deliberate headline breaks while writing natural, concise store copy. Save through save_copy with each current copy revision; machine-written text stays draft. Preserve locale layouts and use locale-scoped layer edits for text fit. Run preflight_project across the requested languages and canvases. Show complete series previews in manageable batches for review, and identify any captures that fall back to the source language. Wait for requested approval before final export; only a native reviewer approves translations.',
  },
  edit_native_design: {
    title: 'Edit native objects and effects',
    description: 'Refine vectors, gradients, masks, appearance and shadows while preserving native editability.',
    text: 'Read the open Screenshot Studio project and its projectSession. Read catalog.editing and inspect_layers for the affected screen/locale or shared row; enable vectors for point/handle work. Preserve original vector coordinates, affine transforms, image fills, other gradient paints and locale variants. Use edit_layers for appearance, paint, shadow presets or polar geometry, live corners, anchor/handle/curve edits, editable masks and boolean shapes. Release a mask as a whole, and use arrange_layers for renderer-measured alignment or distribution. Read the new revision after every save. Preview with details=true to check actual text fit, bounds and capture fallback; resolve reported issues and show the visual result.',
  },
  import_figma_design: {
    title: 'Import an editable Figma design',
    description: 'Inspect frames, prepare collision-safe native layers and localized text, embed fonts and preview the result.',
    text: 'Read the open Screenshot Studio project and its projectSession. Use prepare_design_import with action inspect for a Figma URL, local REST JSON or clipboard HTML; select the requested frame and destination canvas/screen/locale. Use the saved Figma connection in the app; credentials stay outside tool arguments and documents. Prepare one frame with the current studio revision. Review returned warnings, edit plan, copy and font families. Use font_catalog and import_fonts for licensed missing fonts. Reread and prepare again if font embedding changes the studio revision. Apply returned layers with edit_layers, then save_copy with the returned copyRevision. The prepared image assets do not mean layouts or copy have been saved. Preserve existing screens and translations, and keep imported text, masks, gradients and paths native. Preview with details=true and report any fidelity or font concerns.',
  },
};
for (const prompt of Object.values(AGENT_PROMPTS)) prompt.text += appleGuidance;
