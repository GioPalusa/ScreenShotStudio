import path from 'node:path';
import { createAITools, STORE_IMAGE_CATALOG } from './ai-screenshots.mjs';
import { EXPORT_TARGETS } from '../app/js/export-targets.js';
import { STARTER_DESIGNS, STARTER_PALETTES } from '../app/js/design-library.js';
import { APP_STORE_ASSET_GUIDANCE } from '../app/js/app-store-asset-guidance.js';

export const ACTIVE_TOOLS = ['catalog', 'read_project', 'edit_layers', 'preview_project', 'preflight_project', 'add_store_images', 'save_document', 'save_copy', 'apply_design', 'import_media', 'export_project', 'read_image'];
const changes = name => ['edit_layers', 'add_store_images', 'save_document', 'save_copy', 'apply_design', 'import_media'].includes(name);
const needsSession = name => changes(name) || ['export_project', 'preview_project', 'preflight_project'].includes(name);

/** The GUI owns document selection, pending saves and file writes. */
export function createActiveProjectTools({ getCurrent, flush, locked = callback => callback(), changed = () => {}, exportProject }) {
  async function invoke(name, args = {}) {
    if (!ACTIVE_TOOLS.includes(name)) throw new Error('Use the currently open project. Create and open documents in Screenshot Studio.');
    const context = getCurrent();
    if (!context && name === 'catalog') return { mode: 'active-app', project: null, projectSession: null, workspace: null,
      status: 'Open a project in Screenshot Studio to edit it.', targets: EXPORT_TARGETS, assetGuidance: APP_STORE_ASSET_GUIDANCE, storeImages: STORE_IMAGE_CATALOG, designs: STARTER_DESIGNS, palettes: STARTER_PALETTES };
    if (!context) throw new Error('No project is open in Screenshot Studio. Open a .sss document in the app first.');
    if (needsSession(name) && args.projectSession !== context.session) throw new Error('The active project changed or its session is missing. Call read_project again before editing or exporting.');
    return locked(async () => {
      await flush();
      const current = getCurrent();
      if (!current || current.session !== context.session || current.service !== context.service) throw new Error('The active project changed while saving. Call read_project again.');
      const api = createAITools(path.dirname(context.project), { boundProject: context.project, boundService: context.service, exportProject });
      const result = await api[name](args);
      if (changes(name)) changed(name === 'save_copy' ? [`copy/${args.locale}.json`] : name === 'import_media' ? ['captures/', 'assets/'] : ['studio.json']);
      if (name === 'read_image') return result;
      if (name === 'preview_project') return { ...result, structuredContent: { ...result.structuredContent, project: context.project, projectSession: context.session, mode: 'active-app' } };
      return { ...result, project: context.project, projectSession: context.session, mode: 'active-app' };
    });
  }
  return { invoke };
}
