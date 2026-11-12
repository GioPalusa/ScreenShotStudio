import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createNewProject } from './new-project.mjs';
import { createStudioService } from './service.mjs';
import { assertInside } from './files.mjs';
import { EXPORT_TARGETS } from '../app/js/export-targets.js';
import { STARTER_DESIGNS, STARTER_PALETTES, previewStarterDesign } from '../app/js/design-library.js';
import { addStoreImages, STORE_IMAGE_SETS } from '../app/js/store-images.js';
import { editingInventory, editLayers } from '../app/js/agent-edits.js';
import { APP_STORE_ASSET_GUIDANCE } from '../app/js/app-store-asset-guidance.js';
import paper from 'paper';
import { EDITING_CAPABILITIES } from '../app/js/agent-capabilities.js';
import { inspectLayers } from '../app/js/agent-layer-inspection.js';
import { editProject } from '../app/js/agent-project-operations.js';
import { availableProfilesFor } from '../app/js/profiles.js';
import { installedFonts } from './fonts.mjs';
import { inspectFontFiles, resolveGoogleFonts } from './project-fonts.mjs';
import { mergeProjectFonts } from '../app/js/project-fonts.js';
import { prepareDesignImport } from './agent-design-import.mjs';
import { resolveLayers } from '../app/js/layouts.js';
import { geometryPatch } from '../app/js/layer-ops.js';
import { arrangeSelection } from '../app/js/selection.js';
import { readLocalInput } from './local-input.mjs';
import { slideSupportsCanvas } from '../app/js/slide-order.js';

export const STORE_IMAGE_CATALOG = {
  tool: 'add_store_images', sets: STORE_IMAGE_SETS,
  workflow: 'Add an App Store search/header pair or a Google Play feature graphic. Returned deviceId/slideId pairs identify editable images with their own output sizes. They share the Editor screen list, translation review, Overview and combined export/upload with ordinary screenshots. Read the updated project, import artwork as art, edit each layout and locale copy, then export matching devices and slides.',
  appStoreConnect: 'App Store search and header exports can be uploaded from the Mac app Upload view or Export dialog. Choose the saved export and review the app, iOS version, language and creative placement. Apple catalog availability and limits are checked there. MCP does not upload or submit for review.',
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

/** Filesystem authority is the explicitly configured workspace, never the client's cwd. */
export function createAITools(workspace, { exportProject, boundProject = null, boundService = null, figmaRequest, fontCatalog = installedFonts, resolveFonts = resolveGoogleFonts } = {}) {
  const configuredRoot = path.resolve(workspace);
  const root = fs.realpathSync(workspace);
  if (!fs.statSync(root).isDirectory()) throw new Error('Workspace must be an existing directory.');
  const local = value => {
    if (typeof value !== 'string' || !value) throw new Error('Supply a workspace-relative or absolute path.');
    let file = path.resolve(boundProject ?? root, value);
    // macOS commonly aliases /var to /private/var. Accept the configured spelling,
    // then validate each descendant against the canonical root without following links.
    if (file.startsWith(configuredRoot + path.sep)) file = path.resolve(root, path.relative(configuredRoot, file));
    assertInside(root, file);
    return file;
  };
  const projectPath = value => {
    const file = boundProject && value === undefined ? boundProject : boundProject && !path.isAbsolute(value) ? path.resolve(root, value) : local(value);
    if (boundProject && file !== boundProject) throw new Error('This MCP connection follows the project open in Screenshot Studio. Read the current project again.');
    if (!/\.(sss|screenshotstudio)$/i.test(file)) throw new Error('Use a .sss project package.');
    for (const bundled of ['starter', 'project']) {
      const protectedPath = path.join(ROOT, bundled);
      if (file === protectedPath || file.startsWith(protectedPath + path.sep)) throw new Error('Choose a user document outside bundled projects.');
    }
    return file;
  };
  async function withProject(value, callback) {
    const project = projectPath(value);
    if (boundService) return callback(boundService, project);
    const service = createStudioService({ appPath: path.join(ROOT, 'app'), projectPath: project, exportPath: path.join(root, 'exports'), origin: 'studio://local' });
    try { return await callback(service, project); } finally { service.close(); }
  }
  async function request(service, url, { method = 'PUT', body, revision } = {}) {
    const response = await service.request(new Request(`studio://local${url}`, {
      method, headers: { ...(revision ? { 'if-match': revision } : {}), ...(Buffer.isBuffer(body) ? {} : { 'content-type': 'application/json' }) },
      body: Buffer.isBuffer(body) ? body : JSON.stringify(body),
    }));
    const result = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${result.error ?? 'Request failed'}`);
    return result;
  }
  function expected(value) {
    if (typeof value !== 'string' || !/^(missing|[a-f0-9]{64})$/.test(value)) throw new Error('Read the project and supply its expected revision.');
    return value;
  }
  function noPrivateFields(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('_')) throw new Error('Save document data without private renderer fields.');
      noPrivateFields(child);
    }
  }
  const mediaPath = value => {
    const file = local(value);
    if (boundProject && !file.startsWith(boundProject + path.sep) && !file.startsWith(path.join(root, 'inputs') + path.sep)) throw new Error('Use images in the active project or its adjacent inputs folder.');
    return file;
  };
  const readLocal = (value, limit) => {
    return readLocalInput(mediaPath(value), limit);
  };
  const inspect = (input, checkOnly) => withProject(input.project, async (s, source) => {
    if (input.previewWidth !== undefined && (!Number.isInteger(input.previewWidth) || input.previewWidth < 80 || input.previewWidth > 640)) throw new Error('Preview width must be an integer from 80 to 640 pixels.');
    const bundle = s.loadProjectBundle(), project = bundle.studio;
    const selection = {
      locales: input.locales ?? (checkOnly ? project.locales.map(l => l.id) : [project.sourceLocale ?? project.locales[0].id]),
      devices: input.devices ?? Object.keys(project.devices), slides: input.slides ?? project.slides.map(s => s.id),
    };
    for (const [key, available] of [['locales', project.locales.map(l => l.id)], ['devices', Object.keys(project.devices)], ['slides', project.slides.map(s => s.id)]]) {
      const ids = selection[key];
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !available.includes(id))) throw new Error(`Choose valid, unique ${key} IDs.`);
    }
    const base = boundProject ? path.join(boundProject, 'export', 'previews') : path.join(root, 'previews');
    fs.mkdirSync(base, { recursive: true });
    const destination = fs.mkdtempSync(path.join(base, 'ai-'));
    try {
      let result;
      if (exportProject) result = await exportProject({ source, destination, mode: 'inspect', ...selection, checkOnly, details: input.details ?? false, previewWidth: input.previewWidth });
      else {
        const args = [path.join(ROOT, 'studio.mjs'), 'inspect', '--project', source, '--output', destination];
        for (const [flag, key] of [['locale', 'locales'], ['device', 'devices'], ['slide', 'slides']]) args.push(`--${flag}`, selection[key].join(','));
        if (checkOnly) args.push('--check-only');
        if (input.details) args.push('--details');
        if (input.previewWidth !== undefined) args.push('--preview-width', String(input.previewWidth));
        await run(process.execPath, args, { cwd: ROOT, timeout: 31 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
        result = JSON.parse(fs.readFileSync(path.join(destination, 'inspection.json'), 'utf8'));
        fs.unlinkSync(path.join(destination, 'inspection.json'));
      }
      if (!result?.report || !result.selection || !checkOnly && !result.image) throw new Error('Inspection produced no usable result.');
      const { image, ...info } = result;
      if (checkOnly) return info;
      const file = path.join(destination, 'series.jpg'); fs.writeFileSync(file, Buffer.from(image, 'base64'));
      const metadata = { ...info, file, mode: 'preview', next: 'Inspect this draft series. Resolve the reported issues before final export; translations remain draft until reviewed.' };
      return { content: [{ type: 'text', text: JSON.stringify(metadata) }, { type: 'image', mimeType: 'image/jpeg', data: image }], structuredContent: metadata };
    } catch (error) {
      fs.rmSync(destination, { recursive: true, force: true });
      throw new Error(`Inspection failed. ${error.stderr ?? error.message}`);
    } finally { if (checkOnly) fs.rmSync(destination, { recursive: true, force: true }); }
  });
  return {
    catalog: async () => ({ workspace: boundProject ?? root, ...(boundProject ? { project: boundProject, inputDirectory: path.join(root, 'inputs'), mode: 'active-app' } : {}), targets: EXPORT_TARGETS, assetGuidance: APP_STORE_ASSET_GUIDANCE, storeImages: STORE_IMAGE_CATALOG, designs: STARTER_DESIGNS, palettes: STARTER_PALETTES, editing: EDITING_CAPABILITIES,
      workflow: boundProject ? 'Read the open project and its editing inventory. Use edit_layers for targeted changes, save_copy for text, preview_project for a whole series, preflight_project for all selected languages, then export_project for final delivery.' : 'Create or read a project, import real captures, edit_layers and save_copy, preview_project to inspect the series, preflight_project, then export_project for final delivery.',
      capturePath: 'captures/<locale ID or default>/<device.capture>/<slide.capture>.png',
      artLayer: { id: 'artwork', type: 'art', src: '<file returned by import_media>', cx: 660, cy: 1400, w: 800, h: 800 },
    }),
    create_project: async ({ project, target = 'iphone', palette }) => {
      if (boundProject) throw new Error('Create or open a project in Screenshot Studio first. This connection edits the active document.');
      const destination = projectPath(project);
      // A new document may not be nested in another portable document.
      if (path.relative(root, path.dirname(destination)).split(path.sep).some(p => /\.(sss|screenshotstudio)$/i.test(p))) throw new Error('Create documents outside existing project packages.');
      createNewProject(destination, { target, ...(palette ? { palette } : {}) });
      return { project: destination, ...await withProject(destination, s => s.loadProjectBundle()) };
    },
    read_project: async ({ project }) => withProject(project, s => { const bundle = s.loadProjectBundle(); return { ...bundle, editing: editingInventory(bundle.studio), hardware: availableProfilesFor(bundle.studio, bundle.frames) }; }),
    inspect_layers: async input => withProject(input.project, s => inspectLayers(s.loadProjectBundle(), input)),
    edit_layers: async ({ project, edits, revision }) => withProject(project, async s => {
      const bundle = s.loadProjectBundle();
      if (expected(revision) !== bundle.revisions.studio) throw new Error('409: The document changed. Read the project again and reconcile this edit.');
      const studio = editLayers(bundle.studio, edits, { paper });
      const saved = await request(s, '/api/studio', { body: studio, revision: expected(revision) });
      return { ...saved, edited: edits.length, editing: editingInventory(studio) };
    }),
    arrange_layers: async input => withProject(input.project, async s => {
      const bundle = s.loadProjectBundle(), { device, slide, ids, operation, revision } = input;
      if (expected(revision) !== bundle.revisions.studio) throw new Error('409: The document changed. Read it again before arranging layers.');
      if (!['left', 'right', 'top', 'bottom', 'center-x', 'center-y', 'distribute-x', 'distribute-y'].includes(operation)) throw new Error('Choose an alignment or distribution operation.');
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.length > 200) throw new Error('Supply 1–200 unique layer IDs.');
      if (operation.startsWith('distribute') && ids.length < 3) throw new Error('Select at least three layers to distribute.');
      const locale = input.locale ?? bundle.studio.sourceLocale ?? bundle.studio.locales[0].id;
      const target = bundle.studio.slides.find(item => item.id === slide);
      if (!bundle.studio.devices[device] || !target || !slideSupportsCanvas(bundle.studio, target, device)) throw new Error('Choose a screen on this canvas.');
      const local = resolveLayers({ project: bundle.studio, slide: target, deviceId: device, localeId: locale, includeShared: false }).layers;
      for (const id of ids) { const layer = local.find(l => l.id === id); if (!layer || layer._sourceId || layer.locked || layer.type === 'route') throw new Error(`Choose an unlocked editable local layer: ${id}`); }
      const measured = await inspect({ project: input.project, devices: [device], slides: [slide], locales: [locale], details: true }, true);
      const current = s.loadProjectBundle();
      if (Object.entries(bundle.revisions).some(([key, value]) => measured.revisions?.[key] !== value || current.revisions[key] !== value)) throw new Error('409: The document or its text changed while measuring. Read it again.');
      const scene = measured.scenes?.find(scene => scene.device === device && scene.slide === slide && scene.locale === locale);
      if (!scene) throw new Error('The renderer returned no measurements for this screen.');
      const layers = ids.map(id => {
        const result = scene.layers.find(l => l.id === id && !l.scope.shared);
        if (!result?.bounds) throw new Error(`Layer ${id} has no measured bounds. Check missing assets or hidden objects.`);
        return { ...local.find(l => l.id === id), _box: result.bounds };
      });
      const edits = arrangeSelection(layers, operation, { W: scene.designSize[0], H: scene.designSize[1] }).map(({ layer, box }) => ({
        op: 'patch', device, slide, ...(input.locale || target.localeLayouts?.[locale]?.[device] ? { locale } : {}), id: layer.id,
        patch: Object.fromEntries(Object.entries(geometryPatch(layer, box)).map(([k, v]) => [k, v === undefined ? null : v])),
      }));
      const studio = editLayers(bundle.studio, edits, { paper });
      const saved = await request(s, '/api/studio', { body: studio, revision });
      return { ...saved, arranged: edits.length, operation, editing: editingInventory(studio) };
    }),
    edit_project: async ({ project, edits, revision }) => withProject(project, async s => {
      const bundle = s.loadProjectBundle();
      if (expected(revision) !== bundle.revisions.studio) throw new Error('409: The document changed. Read the project again and reconcile this edit.');
      const result = editProject(bundle.studio, edits);
      const saved = await request(s, '/api/studio', { body: result.studio, revision });
      return { ...saved, results: result.results, editing: editingInventory(result.studio) };
    }),
    font_catalog: async ({ project, search }) => withProject(project, async s => {
      const bundle = s.loadProjectBundle(), usage = [];
      for (const locale of bundle.studio.locales) for (const device of Object.keys(bundle.studio.devices)) for (const slide of bundle.studio.slides) {
        if (!slideSupportsCanvas(bundle.studio, slide, device)) continue;
        for (const layer of resolveLayers({ project: bundle.studio, slide, deviceId: device, localeId: locale.id }).layers) if (layer.type === 'text') {
          const lang = locale.lang ?? locale.id, fonts = bundle.studio.fonts;
          const family = layer.fontFamily ?? locale.font?.family ?? fonts?.byLang?.[lang]?.family ?? fonts?.byLang?.[lang.split('-')[0]]?.family ?? fonts?.default?.family;
          if (family) usage.push({ family, locale: locale.id, device, slide: slide.id, layer: layer.id });
        }
      }
      const installed = await fontCatalog(), embedded = bundle.studio.fonts?.files ?? [];
      const matches = family => !search || family.toLowerCase().includes(search.toLowerCase());
      const families = new Set([...(installed.families ?? []), ...embedded.map(f => f.family)]);
      return { revision: bundle.revisions.studio, installed: installed.families.filter(matches), embedded: embedded.filter(f => matches(f.family)),
        usage: usage.filter(u => matches(u.family)), missing: [...new Set(usage.map(u => u.family))].filter(f => matches(f) && !families.has(f) && !['system-ui', 'sans-serif', 'serif', 'monospace', '-apple-system'].includes(f)),
        ...(installed.unavailable ? { unavailable: installed.unavailable } : {}), next: 'Import missing licensed fonts to embed them portably. System fonts are local availability, not portable files. Preview to verify actual font loading and glyph coverage.' };
    }),
    import_fonts: async ({ project, sources = [], families = [], revision }) => withProject(project, async s => {
      const bundle = s.loadProjectBundle();
      if (expected(revision) !== bundle.revisions.studio) throw new Error('409: The document changed. Read the project again before importing fonts.');
      if (!Array.isArray(sources) || sources.length > 64 || !Array.isArray(families) || families.length > 32 || !sources.length && !families.length) throw new Error('Supply up to 64 local font paths or 32 Google Fonts families.');
      const localFonts = [];
      for (const source of sources) localFonts.push({ data: (await readLocal(source, 32 * 1024 * 1024)).toString('base64'), source: 'Local font file' });
      const downloaded = families.length ? await resolveFonts(families) : { fonts: [], missing: [] };
      const fonts = [...localFonts, ...downloaded.fonts];
      if (!fonts.length) return { revision, fonts: [], missing: downloaded.missing };
      inspectFontFiles(fonts);
      if (s.loadProjectBundle().revisions.studio !== revision) throw new Error('409: The document changed while preparing fonts. Read it again.');
      const stored = await request(s, '/api/import/fonts', { method: 'POST', body: { action: 'save', fonts } });
      const studio = structuredClone(bundle.studio); studio.fonts ??= {}; studio.fonts.files = mergeProjectFonts(studio.fonts.files, stored.fonts);
      const saved = await request(s, '/api/studio', { body: studio, revision });
      return { ...saved, fonts: stored.fonts, missing: downloaded.missing, next: 'Use these family names in text layers. Preview to verify glyph coverage; font files now travel with this document.' };
    }),
    prepare_design_import: async input => withProject(input.project, async s => {
      const bundle = s.loadProjectBundle();
      if (input.action === 'prepare' && expected(input.revision) !== bundle.revisions.studio) throw new Error('409: The document changed. Read it again before preparing an import.');
      return prepareDesignImport(bundle, input, { readLocal, figmaRequest, importImage: (bytes, name) => request(s, `/api/asset?${new URLSearchParams({ name })}`, { method: 'POST', body: bytes }) });
    }),
    preview_project: input => inspect(input, false),
    preflight_project: input => inspect(input, true),
    add_store_images: async ({ project, store, sizes, afterSlide, revision }) => withProject(project, async s => {
      const bundle = s.loadProjectBundle();
      if (afterSlide && !bundle.studio.slides.some(slide => slide.id === afterSlide)) throw new Error('Unknown slide to insert after.');
      const images = addStoreImages(bundle.studio, { store, sizes, afterId: afterSlide }, () => crypto.randomUUID());
      const saved = await request(s, '/api/studio', { body: bundle.studio, revision: expected(revision) });
      return { ...saved, images, next: 'Read the updated project before editing image layouts and copy. Export these deviceId/slideId pairs, then use Upload in the Mac app for App Store Connect.' };
    }),
    save_document: async ({ project, studio, revision }) => withProject(project, async s => {
      noPrivateFields(studio);
      const before = s.loadProjectBundle().studio;
      if (Array.isArray(studio?.locales) && before.locales.some(locale => !studio.locales.some(next => next.id === locale.id))) throw new Error('Remove languages in the Mac app so their files are archived in _removed.');
      return request(s, '/api/studio', { body: studio, revision: expected(revision) });
    }),
    save_copy: async ({ project, locale, copy, revision }) => withProject(project, async s => {
      const bundle = s.loadProjectBundle();
      if (!bundle.studio.locales.some(l => l.id === locale)) throw new Error('Add this locale to studio.locales first.');
      if (!copy || typeof copy !== 'object' || Array.isArray(copy)) throw new Error('Copy must be an object keyed by slide ID.');
      for (const [key, fields] of Object.entries(copy)) {
        if (key === '_meta') continue;
        if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.values(fields).some(v => typeof v !== 'string')) throw new Error('Each slide contains named text fields with string values.');
      }
      const body = { ...copy, _meta: { status: 'draft', needsReview: ['*'] } };
      return request(s, `/api/copy/${encodeURIComponent(locale)}`, { body, revision: expected(revision) });
    }),
    apply_design: async ({ project, slide, devices, design, revision }) => withProject(project, async s => {
      const bundle = s.loadProjectBundle();
      const index = bundle.studio.slides.findIndex(item => item.id === slide);
      if (index < 0) throw new Error('Unknown slide.');
      bundle.studio.slides[index] = previewStarterDesign(bundle.studio, bundle.studio.slides[index], { designId: design, deviceIds: devices, frames: bundle.frames });
      return request(s, '/api/studio', { body: bundle.studio, revision: expected(revision) });
    }),
    import_media: async ({ project, source, kind, scope = 'default', device, name }) => withProject(project, async s => {
      const file = mediaPath(source);
      const body = await readLocal(source, 64 * 1024 * 1024);
      if (kind === 'art') return request(s, `/api/asset?${new URLSearchParams({ name: name ?? path.basename(file) })}`, { method: 'POST', body });
      if (kind !== 'capture' || !device || !name) throw new Error('Capture imports need device (capture collection) and name (slide.capture).');
      // Import creates new captures; replacement is an explicit document/media edit in the app.
      return request(s, `/api/capture?${new URLSearchParams({ scope, device, name, create: '1' })}`, { method: 'POST', body });
    }),
    export_project: async ({ project, output, mode = 'draft', locales, devices, slides, allowPlaceholders = false }) => withProject(project, async (s, source) => {
      const destination = local(output ?? (boundProject ? path.join(boundProject, 'export') : 'exports'));
      if (boundProject) {
        const exports = path.join(boundProject, 'export');
        if (destination !== exports && !destination.startsWith(exports + path.sep)) throw new Error('Active-project exports are saved inside this .sss document.');
      } else if (path.relative(root, destination).split(path.sep).some(p => /\.(sss|screenshotstudio)$/i.test(p))) throw new Error('Export outside project packages.');
      if (!['draft', 'final'].includes(mode) || (mode === 'final' && allowPlaceholders)) throw new Error('Final exports require captures and all preflight checks.');
      const bundle = s.loadProjectBundle();
      const args = [path.join(ROOT, 'studio.mjs'), 'export', '--project', source, '--output', destination];
      for (const [flag, selection, available] of [
        ['locale', locales, bundle.studio.locales.map(l => l.id)], ['device', devices, Object.keys(bundle.studio.devices)], ['slide', slides, bundle.studio.slides.map(l => l.id)],
      ]) if (selection !== undefined) {
        if (!Array.isArray(selection) || !selection.length || new Set(selection).size !== selection.length || selection.some(id => !available.includes(id))) throw new Error(`Choose valid, unique ${flag} IDs.`);
        args.push(`--${flag}`, selection.join(','));
      }
      if (mode === 'final') args.push('--strict');
      if (allowPlaceholders) args.push('--allow-placeholders');
      // Isolate each invocation so concurrent clients can identify their own manifest.
      fs.mkdirSync(destination, { recursive: true });
      const invocation = fs.mkdtempSync(path.join(destination, 'ai-'));
      args[args.indexOf('--output') + 1] = invocation;
      let logs;
      try {
        if (exportProject) { await exportProject({ source, destination: invocation, mode, locales, devices, slides, allowPlaceholders }); logs = { stdout: '' }; }
        else logs = await run(process.execPath, args, { cwd: ROOT, timeout: 31 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }); }
      catch (error) { throw new Error(`Export failed. ${error.stdout ?? ''}\n${error.stderr ?? error.message}`); }
      const folder = fs.readdirSync(invocation).find(name => name.startsWith(`${mode}-`));
      if (!folder) throw new Error(`Export produced no completed manifest. ${logs.stdout}`);
      const directory = path.join(invocation, folder);
      const manifestPath = path.join(directory, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return { directory, manifest: manifestPath, files: manifest.files.map(f => ({ ...f, absolutePath: path.join(directory, f.path) })), report: manifest.report };
    }),
    read_image: async ({ file }) => {
      const target = mediaPath(file);
      const mimeType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[path.extname(target).toLowerCase()];
      if (!mimeType) throw new Error('Preview PNG, JPEG or WebP images.');
      return { content: [{ type: 'image', mimeType, data: (await readLocal(file, 16 * 1024 * 1024)).toString('base64') }] };
    },
  };
}
