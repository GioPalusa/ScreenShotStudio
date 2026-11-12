import { SHADOW_PRESETS } from './shadow-ops.js';
import { SCREEN_SPACING_PRESETS } from './shared-canvas.js';

// Shared discovery for standalone MCP, the active app and the in-app guide.
export const LAYER_OPERATIONS = ['add', 'patch', 'remove', 'group', 'ungroup', 'reorder', 'appearance', 'paint', 'shadow', 'corners', 'vector', 'mask', 'unmask', 'boolean'];
export const PROJECT_OPERATIONS = ['add_canvas', 'resize_canvas', 'remove_canvas', 'orient_canvas', 'rename_slide', 'reorder_slide', 'independent_layout', 'shared_spacing', 'save_template', 'apply_template', 'detach_template'];
export const MUTATING_TOOLS = ['edit_layers', 'arrange_layers', 'edit_project', 'add_store_images', 'save_document', 'save_copy', 'apply_design', 'import_media', 'import_fonts', 'prepare_design_import'];
export const SESSION_TOOLS = [...MUTATING_TOOLS, 'inspect_layers', 'font_catalog', 'export_project', 'preview_project', 'preflight_project'];
export const EDITING_CAPABILITIES = {
  version: 1,
  layerOperations: LAYER_OPERATIONS,
  projectOperations: PROJECT_OPERATIONS,
  arrangement: 'arrange_layers aligns or distributes local layers using actual renderer measurements and revision checks, including translated text and framed devices.',
  inspection: 'inspect_layers resolves native objects and text fallback. preview_project and preflight_project always return textReview: actual font sizes/lines/shrink, simulated sizes at 160/240/320 px, conservative contrast and presentation-specific guidance. previewWidth=160/240/320 renders diagnostic-size tiles. details=true also returns complete measured bounds and capture resolution. Readability advisories do not block export.',
  coordinateSpaces: { local: 'Design pixels for this screen, respecting its orientation.', shared: 'Design pixels across the whole canvas row, including store spacing; use raw shared layer IDs.' },
  shadows: { presets: SHADOW_PRESETS, polar: 'Angles increase clockwise from the right. Distance and blur use design pixels; alpha is 0–1.' },
  spacingPresets: SCREEN_SPACING_PRESETS,
  imports: { tool: 'prepare_design_import', sources: ['Figma URL using the app’s saved Keychain connection (standalone: FIGMA_ACCESS_TOKEN environment variable)', 'Local Figma REST JSON', 'Local Figma clipboard HTML'], workflow: 'Inspect frames, prepare the selected frames at native or target size, then add returned layers with edit_layers and save returned text with save_copy. Preparation imports image assets, but leaves layouts and copy unchanged.' },
  fonts: 'font_catalog reports installed/project families and usage. import_fonts embeds local .ttf/.otf files or official Google Fonts in the document with revision checking.',
  references: ['screenshot-studio://guide/editing', 'screenshot-studio://guide/advanced-editing', 'screenshot-studio://guide/store-images', 'screenshot-studio://guide/apple-assets'],
};
