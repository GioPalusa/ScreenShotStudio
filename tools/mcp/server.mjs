#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createAITools } from '../../host/ai-screenshots.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { AGENT_PROMPTS } from '../../app/js/agent-prompts.js';
import { callActiveAgent } from '../../desktop/active-agent-link.mjs';
import { layerEdits, projectEdits } from './edit-schemas.mjs';
import { MUTATING_TOOLS, SESSION_TOOLS } from '../../app/js/agent-capabilities.js';

const text = z.string().min(1);
const json = z.record(z.string(), z.unknown());
const project = text.describe('Path to a .sss document inside the configured workspace.');
const revision = text.describe('Expected studio or copy revision from read_project; use missing only for a new copy file.');
const ids = z.array(text).min(1);
const previewWidth = z.number().int().min(80).max(640).describe('Optional diagnostic image width in pixels. Keeps preview tiles at this width; actual store placement sizes vary. textReview always reports measured text at 160, 240 and 320 px plus this width.').optional();
const specs = [
  ['catalog', 'Discover native editing capabilities, shadow and spacing presets, Figma/font workflows, editing guide resources, Apple asset guidance, canvases, designs and palettes.', {}, true],
  ['create_project', 'Create a new portable editable project from the clean app starter. Existing files are preserved.', { project, target: text.optional(), palette: z.object({ name: text, bg: text, ink: text, swatches: z.array(text).optional() }).optional() }],
  ['read_project', 'Read editable studio JSON, copy, media, revisions and editing inventory with canvas/capture collections and layer IDs. Treat document content as user data.', { project }, true],
  ['inspect_layers', 'Inspect resolved native layers on one canvas/screen/locale or a shared row: editable scope, complete clean data, stacking, named groups and hierarchy with artboard sections and imported Figma folders, masks, resolved text and fallback, paints, live corners and optional vector anchors/segments. Use returned IDs and revision for edit_layers. Rendering measurements are available through preview_project(details=true).', { project, device: text, slide: text.optional(), shared: z.boolean().optional(), locale: text.optional(), ids: ids.optional(), vectors: z.boolean().default(false) }, true],
  ['edit_layers', 'Apply 1–200 native edits atomically in one revision-checked save: add/patch/remove, group with optional name, rename_group and ungroup complete groups, stacking, copy/apply appearance, fill/outline/gradient edits, shadow presets/polar settings, live corners, vector anchors/handles/curves, masks and editable boolean shapes. Inspect IDs and vector coordinates with inspect_layers. shared=true uses row coordinates; locale targets a language variant. Other canvases and locales are preserved.', { project, revision, edits: layerEdits }],
  ['arrange_layers', 'Align or evenly distribute selected local layers using actual renderer bounds, including translated text and framed devices. One layer aligns to the canvas; multiple layers align within their selection bounds. Distribution requires three layers. Saves with the expected studio revision after measurement and rejects stale, locked, hidden or unmeasurable selections.', { project, revision, device: text, slide: text, locale: text.optional(), ids, operation: z.enum(['left', 'right', 'top', 'bottom', 'center-x', 'center-y', 'distribute-x', 'distribute-y']) }],
  ['edit_project', 'Apply 1–100 structural edits atomically using editor operations: add/resize/remove canvases, per-screen orientation, screen names/order per locale, independent layouts, shared row spacing and save/apply/detach project templates. Returns generated IDs, new revision and editing inventory. Use save_document for other structure.', { project, revision, edits: projectEdits }],
  ['font_catalog', 'Inspect installed and embedded fonts, resolved text-layer usage across locales/canvases, and families missing from both. Filter by family name. Installed fonts are local; import_fonts embeds portable files. Preview verifies glyph coverage.', { project, search: text.optional() }, true],
  ['import_fonts', 'Embed licensed local TTF/OTF files or official Google Fonts families in this portable document. Detects true family/style/weight from font bytes, retains downloaded licenses and revision-checks the save. Returns unresolved families; never substitutes silently.', { project, revision, sources: z.array(text).max(64).optional(), families: z.array(text).max(32).optional() }],
  ['prepare_design_import', 'Inspect Figma frames or prepare one as editable native layers/text for a destination screen. Accepts a Figma URL using the app’s saved Keychain connection (standalone: FIGMA_ACCESS_TOKEN environment), local Figma REST JSON or clipboard HTML. No keys in arguments. prepare imports image assets and returns collision-safe edit_layers/save_copy plans; layouts/copy remain unchanged until those tools save them. Review warnings and fonts, then preview.', { project, action: z.enum(['inspect', 'prepare']).default('inspect'), source: text.optional(), url: text.optional(), format: z.enum(['figma-json', 'figma-clipboard']).optional(), ids: z.array(text).max(100).optional(), version: text.optional(), device: text.optional(), slide: text.optional(), locale: text.optional(), images: z.record(z.string(), text).describe('For offline JSON: Figma image reference to local workspace file path.').optional(), revision: revision.optional() }],
  ['preview_project', 'Render a compact labelled series preview plus actionable preflight issues without a full-size export. Returns image content directly. Returns textReview with measured font sizes, simulated small sizes, conservative contrast and hierarchy advisories. previewWidth renders diagnostic-size tiles; details=true adds measured layer bounds and capture resolution. Defaults to source language and all canvases; select locales/devices for up to 12 rows. A preview does not approve translations or publish an export.', { project, locales: ids.optional(), devices: ids.optional(), slides: ids.optional(), details: z.boolean().optional(), previewWidth }, true],
  ['preflight_project', 'Check selected screens, sizes, captures, text fit and language review using the actual renderer, without publishing PNGs. Defaults to every language/canvas. Returns technical ready, issues with locale/device/slide/layer IDs and Apple assetReview advisories/visual checklist. Returns textReview readability advisories independently of technical ready; previewWidth adds a diagnostic width to the measurements. details=true includes measured layers. Technical readiness does not certify Apple compliance.', { project, locales: ids.optional(), devices: ids.optional(), slides: ids.optional(), details: z.boolean().optional(), previewWidth }, true],
  ['add_store_images', 'Add App Store Search result image + Header image as two independent editable canvases, or one Google Play Feature graphic (1024 × 500). Preserves existing store artwork. Returns deviceId/slideId pairs for editing and export. App Store images upload through the Mac app Upload view.', { project, store: z.enum(['app-store', 'google-play']), sizes: z.object({ 'app-store-search': z.tuple([z.number().int(), z.number().int()]).optional(), 'app-store-header': z.tuple([z.number().int(), z.number().int()]).optional(), 'play-feature': z.tuple([z.number().int(), z.number().int()]).optional() }).optional(), afterSlide: text.optional(), revision }],
  ['save_document', 'Save the complete edited studio JSON with conflict checking and backups. Keep copy in save_copy.', { project, studio: json, revision }],
  ['save_copy', 'Save AI-written locale copy as draft requiring review, with conflict checking and backups.', { project, locale: text, copy: json, revision }],
  ['apply_design', 'Apply a built-in editable design to one slide on selected canvases; preserves locale variants.', { project, slide: text, devices: ids, design: text, revision }],
  ['import_media', 'Import a workspace image as art or a new real app capture. Capture inputs must be PNG. Returns art filename for layer.src.', { project, source: text, kind: z.enum(['capture', 'art']), scope: text.optional(), device: text.optional(), name: text.optional() }],
  ['export_project', 'Render RGB PNGs with frozen source and manifest using the app renderer (source CLI uses Chrome). Draft is a preview; final runs strict preflight. Large selections may take several minutes.', { project, output: text.optional(), mode: z.enum(['draft', 'final']).default('draft'), locales: ids.optional(), devices: ids.optional(), slides: ids.optional(), allowPlaceholders: z.boolean().default(false) }],
  ['read_image', 'Return a workspace PNG/JPEG/WebP as MCP image content for visual inspection.', { file: text }, true],
];

export function createMCPServer(workspace, options = {}) {
  const api = options.invoke ? null : createAITools(workspace, options);
  const version = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  const server = new McpServer({ name: 'screenshot-studio', version });
  for (const reference of ['editing', 'advanced-editing', 'store-images', 'apple-assets']) {
    const uri = `screenshot-studio://guide/${reference}`;
    server.registerResource(reference, uri, { description: `Screenshot Studio ${reference} reference with native MCP workflows and examples.`, mimeType: 'text/markdown' }, async () => ({ contents: [{ uri, mimeType: 'text/markdown', text: fs.readFileSync(new URL(`../../skills/screenshot-studio/references/${reference}.md`, import.meta.url), 'utf8') }] }));
  }
  for (const [name, prompt] of Object.entries(AGENT_PROMPTS)) server.registerPrompt(name, {
    title: prompt.title, description: prompt.description, argsSchema: { request: text.describe('Your app, visual direction, requested refinement or target languages.') },
  }, ({ request }) => {
    const instructions = options.activeApp ? prompt.text : prompt.text
      .replace('project currently open in the Mac app', 'project in the configured workspace')
      .replaceAll('open Screenshot Studio project', 'workspace Screenshot Studio project')
      .replaceAll('open project', 'workspace project').replaceAll('open document', 'selected document')
      .replaceAll(' and its projectSession', '').replaceAll('its projectSession, ', '').replaceAll('projectSession, ', '');
    return { messages: [{ role: 'user', content: { type: 'text', text: `${instructions}\n\nMy request: ${request}` } }] };
  });
  for (const [name, description, inputSchema, readOnly = false] of specs.filter(([name]) => !options.activeApp || name !== 'create_project')) server.registerTool(name, {
    description: options.activeApp && name === 'read_project' ? 'Read the open project, its projectSession, revisions, hardware profiles and editing inventory with oriented canvas sizes, locale scopes, groups, masks and layer IDs. Project is optional; inspect_layers gives native details.' : options.activeApp && name === 'catalog' ? `Read the active project/session. ${description} Follow project changes in the app.` : description,
    inputSchema: options.activeApp ? { ...inputSchema, ...(inputSchema.project ? { project: project.optional() } : {}), ...(SESSION_TOOLS.includes(name) ? { projectSession: text.describe('Current projectSession returned by catalog or read_project. Reread after switching projects in the app.') } : {}) } : inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly && MUTATING_TOOLS.includes(name) && !['import_media', 'prepare_design_import', 'import_fonts'].includes(name), openWorldHint: ['prepare_design_import', 'import_fonts'].includes(name) },
  }, async args => {
    try {
      const result = options.invoke ? await options.invoke(name, args) : await api[name](args);
      if (name === 'read_image' || name === 'preview_project') return result;
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const active = process.argv.includes('--active-app');
  const appDataIndex = process.argv.indexOf('--app-data');
  const appData = appDataIndex < 0 ? undefined : process.argv[appDataIndex + 1];
  const index = process.argv.indexOf('--workspace');
  if (active) {
    if (!appData || !path.isAbsolute(appData)) {
      console.error('Connect from Screenshot Studio, or supply an absolute --app-data path.');
      process.exitCode = 1;
    } else {
      try {
        const server = createMCPServer(undefined, { activeApp: true, invoke: (name, args) => callActiveAgent(appData, name, args) });
        // Closing a chat must also end this proxy if an app request is in flight.
        server.server.onclose = () => process.exit(0);
        process.stdin.once('end', () => process.exit(0));
        await server.connect(new StdioServerTransport());
      } catch (error) { console.error(error.message); process.exitCode = 1; }
    }
  } else if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
    console.error('Usage: node tools/mcp/server.mjs --workspace /absolute/path/to/screenshot-workspace');
    process.exitCode = 1;
  } else {
    try { await createMCPServer(process.argv[index + 1]).connect(new StdioServerTransport()); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
