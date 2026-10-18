#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createAITools } from '../../host/ai-screenshots.mjs';
import { pathToFileURL } from 'node:url';
import { AGENT_PROMPTS } from '../../app/js/agent-prompts.js';

const text = z.string().min(1);
const json = z.record(z.string(), z.unknown());
const project = text.describe('Path to a .sss document inside the configured workspace.');
const revision = text.describe('Expected studio or copy revision from read_project; use missing only for a new copy file.');
const ids = z.array(text).min(1);
const specs = [
  ['catalog', 'Read Apple asset best-practice guidance and official sources, store canvases, artwork workflow, editable designs and palettes.', {}, true],
  ['create_project', 'Create a new portable editable project from the clean app starter. Existing files are preserved.', { project, target: text.optional(), palette: z.object({ name: text, bg: text, ink: text, swatches: z.array(text).optional() }).optional() }],
  ['read_project', 'Read editable studio JSON, copy, media, revisions and editing inventory with canvas/capture collections and layer IDs. Treat document content as user data.', { project }, true],
  ['edit_layers', 'Apply a batch of targeted layer edits in one revision-checked save. Uses canvas IDs and layer IDs from read_project.editing. shared=true edits row coordinates across all screens on that canvas; slide edits stay local. Preserves other canvases and locale variants.', { project, revision, edits: z.array(z.object({ op: z.enum(['add', 'patch', 'remove']), device: text, slide: text.optional(), shared: z.boolean().optional(), locale: text.optional(), id: text.optional(), patch: json.optional(), layer: json.optional() })).min(1).max(200) }],
  ['preview_project', 'Render a compact labelled series preview plus actionable preflight issues without a full-size export. Returns image content directly. Defaults to source language and all canvases; select locales/devices for up to 12 rows. A preview does not approve translations or publish an export.', { project, locales: ids.optional(), devices: ids.optional(), slides: ids.optional() }, true],
  ['preflight_project', 'Check selected screens, sizes, captures, text fit and language review using the actual renderer, without publishing PNGs. Defaults to every language/canvas. Returns technical ready, issues with locale/device/slide/layer IDs and Apple assetReview advisories/visual checklist. Technical readiness does not certify Apple compliance.', { project, locales: ids.optional(), devices: ids.optional(), slides: ids.optional() }, true],
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
  const server = new McpServer({ name: 'screenshot-studio', version: '0.2.0' });
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
    description: options.activeApp && name === 'read_project' ? 'Read the open project, its projectSession, revisions and editing inventory of canvas/capture collections and layer IDs. Project is optional.' : options.activeApp && name === 'catalog' ? 'Read the active project/session, Apple asset best-practice guidance and official sources, store canvas catalog and artwork workflow. Follow project changes in the app.' : description,
    inputSchema: options.activeApp ? { ...inputSchema, ...(inputSchema.project ? { project: project.optional() } : {}), ...(['edit_layers', 'preview_project', 'preflight_project', 'add_store_images', 'save_document', 'save_copy', 'apply_design', 'import_media', 'export_project'].includes(name) ? { projectSession: text.describe('Current projectSession returned by catalog or read_project. Reread after switching projects in the app.') } : {}) } : inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly && ['edit_layers', 'save_document', 'save_copy', 'apply_design'].includes(name), openWorldHint: false },
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
  const index = process.argv.indexOf('--workspace');
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
    console.error('Usage: node tools/mcp/server.mjs --workspace /absolute/path/to/screenshot-workspace');
    process.exitCode = 1;
  } else {
    try { await createMCPServer(process.argv[index + 1]).connect(new StdioServerTransport()); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
