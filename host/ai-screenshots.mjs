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

export const STORE_IMAGE_CATALOG = {
  tool: 'add_store_images', sets: STORE_IMAGE_SETS,
  workflow: 'Add an App Store search/header pair or a Google Play feature graphic. Returned deviceId/slideId pairs identify editable images with their own output sizes. They share the Editor screen list, translation review, Overview and combined export/upload with ordinary screenshots. Read the updated project, import artwork as art, edit each layout and locale copy, then export matching devices and slides.',
  appStoreConnect: 'App Store search and header exports can be uploaded from the Mac app Upload view or Export dialog. Choose the saved export and review the app, iOS version, language and creative placement. Apple catalog availability and limits are checked there. MCP does not upload or submit for review.',
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

/** Filesystem authority is the explicitly configured workspace, never the client's cwd. */
export function createAITools(workspace, { exportProject, boundProject = null, boundService = null } = {}) {
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
  return {
    catalog: async () => ({ workspace: boundProject ?? root, ...(boundProject ? { project: boundProject, inputDirectory: path.join(root, 'inputs'), mode: 'active-app' } : {}), targets: EXPORT_TARGETS, storeImages: STORE_IMAGE_CATALOG, designs: STARTER_DESIGNS, palettes: STARTER_PALETTES,
      workflow: 'Create a project, read it, save editable studio/copy data using revisions, import real captures and optional AI artwork, export draft, inspect PNGs, resolve checks, export final.',
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
    read_project: async ({ project }) => withProject(project, s => s.loadProjectBundle()),
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
      if (!fs.statSync(file).isFile() || fs.statSync(file).size > 64 * 1024 * 1024) throw new Error('Choose a local image smaller than 64 MiB.');
      const body = fs.readFileSync(file);
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
      const target = mediaPath(file), size = fs.statSync(target).size;
      if (!fs.statSync(target).isFile() || size > 16 * 1024 * 1024) throw new Error('Preview images must be smaller than 16 MiB.');
      const mimeType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[path.extname(target).toLowerCase()];
      if (!mimeType) throw new Error('Preview PNG, JPEG or WebP images.');
      return { content: [{ type: 'image', mimeType, data: fs.readFileSync(target).toString('base64') }] };
    },
  };
}
