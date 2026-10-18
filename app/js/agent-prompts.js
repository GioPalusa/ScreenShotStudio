// Shared by the in-app guide and MCP prompt discovery.
const appleGuidance = ' For App Store work, follow catalog.assetGuidance, sourced from https://developer.apple.com/app-store/asset-best-practices/. Review preview/preflight assetReview advisories and its visual checklist before delivery; technical readiness is not Apple approval.';
export const AGENT_PROMPTS = {
  design_screenshots: {
    title: 'Design a screenshot series',
    description: 'Build an editable story from real captures on the open document’s screenshot canvases.',
    text: 'Use Screenshot Studio on the project currently open in the Mac app. Read its projectSession, editing inventory, copy and captures first. Build a benefit-led screenshot story using the app’s actual features and supplied visual direction. Keep headlines and captions editable. Match each canvas to its own capture collection, including iPad and each Duo posture. Use realistic, appealing sample data. Preserve existing store artwork and unrelated screens. Show the complete series with preview_project before final export; report missing captures and language review needs.',
  },
  refine_series: {
    title: 'Refine the open series',
    description: 'Adjust the current composition while preserving other screens, captures and translations.',
    text: 'Read the open Screenshot Studio project and its projectSession. Refine the existing series using edit_layers and the current revision. Keep unrelated layers, canvas variants and locale layouts. For continuous backgrounds, use shared layers in each canvas’s row coordinates and account for screen spacing. Keep the headline area quiet, preserve the requested colour accents, and keep text editable. Preview the complete affected series on every affected canvas, including iPad. Report what changed and any preflight issues.',
  },
  translate_series: {
    title: 'Translate and review the series',
    description: 'Write natural store copy and preview the complete sequence in each target language.',
    text: 'Read the open Screenshot Studio project, its projectSession, source copy and existing locales. Add only the requested languages; use the app’s declared supported locales when supplied. Preserve meaning, feature claims, tone and deliberate headline breaks while writing natural, concise store copy. Save through save_copy with each current copy revision; machine-written text stays draft. Preserve locale layouts and use locale-scoped layer edits for text fit. Run preflight_project across the requested languages and canvases. Show complete series previews in manageable batches for review, and identify any captures that fall back to the source language. Wait for requested approval before final export; only a native reviewer approves translations.',
  },
};
for (const prompt of Object.values(AGENT_PROMPTS)) prompt.text += appleGuidance;
