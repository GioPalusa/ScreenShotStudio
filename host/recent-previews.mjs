import crypto from 'node:crypto';
import path from 'node:path';
import { createStudioService } from './service.mjs';

export const recentPreviewId = folder => crypto.createHash('sha256').update(folder).digest('hex').slice(0, 24);

/** A read-only protocol namespace for projects explicitly in the native recent list.
 * Home can render real artwork without opening a document or exporting any files. */
export function createRecentPreviews({ appPath, frameLibraryPath, recentPaths, origin = 'studio://local' }) {
  const services = new Map();
  function close() { for (const service of services.values()) service.close(); services.clear(); }
  return {
    close,
    async request(req) {
      const url = new URL(req.url), match = /^\/recent\/([a-f0-9]{24})(\/.*)$/.exec(url.pathname);
      const expected = new URL(origin);
      if (url.protocol !== expected.protocol || url.host !== expected.host || req.method !== 'GET' || !match) return new Response('Not found', { status: 404 });
      const folders = recentPaths(), folder = folders.find(folder => recentPreviewId(folder) === match[1]);
      if (!folder) return new Response('Not found', { status: 404 });
      for (const [old, service] of services) if (!folders.includes(old)) { service.close(); services.delete(old); }
      const relative = match[2];
      if (relative !== '/bundle' && !/^\/project\/(?:assets|captures)\//.test(relative)) return new Response('Not found', { status: 404 });
      try { if (decodeURIComponent(relative).split('/').some(part => part === '..' || part === '.')) return new Response('Not found', { status: 404 }); }
      catch { return new Response('Not found', { status: 404 }); }
      try {
        if (!services.has(folder)) services.set(folder, createStudioService({ appPath, projectPath: folder, exportPath: path.join(folder, 'export'), frameLibraryPath, origin, installLegacyFrames: false }));
        const service = services.get(folder);
        if (relative === '/bundle') {
          const bundle = service.loadProjectBundle({ includeExports: false });
          return Response.json({ studio: bundle.studio, copy: bundle.copy, frames: bundle.frames, captures: bundle.captures, assets: bundle.assets }, { headers: { 'cache-control': 'no-store' } });
        }
        return service.request(new Request(`${origin}${relative}${url.search}`, { headers: req.headers }));
      } catch { return new Response('Project preview is unavailable.', { status: 404 }); }
    },
  };
}
