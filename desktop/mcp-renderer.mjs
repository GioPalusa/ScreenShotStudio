import { BrowserWindow, session } from 'electron';
import path from 'node:path';
import { createStudioService } from '../host/service.mjs';
const ORIGIN = 'studio://local';

export function createDesktopExporter(appPath) {
let activeService, activeWindow, queue = Promise.resolve();

function exportProject(input) {
  const result = queue.then(() => renderExport(input));
  queue = result.catch(() => {});
  return result;
}
async function renderExport({ source, destination, mode, locales, devices, slides, allowPlaceholders }) {
  const service = createStudioService({ appPath: appPath, projectPath: source, exportPath: destination, origin: ORIGIN, onExportLog: line => console.error(line) });
  activeService = service;
  let timer;
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { partition: 'mcp-render', contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  activeWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${ORIGIN}/app/`)) event.preventDefault(); });
  const params = new URLSearchParams({ headless: '1' });
  for (const [name, ids] of [['locale', locales], ['device', devices], ['slide', slides]]) if (ids) params.set(name, ids.join(','));
  if (mode === 'final') params.set('strict', '1');
  if (allowPlaceholders) params.set('placeholders', '1');
  try {
    const completed = new Promise((resolve, reject) => {
      service.exportLog.resolve = resolve;
      win.webContents.once('render-process-gone', () => reject(new Error('The export renderer stopped.')));
      timer = setTimeout(() => reject(new Error('Export timed out after 30 minutes.')), 30 * 60 * 1000);
    });
    // Observe completion before loading: a renderer can finish during loadURL.
    await Promise.all([win.loadURL(`${ORIGIN}/app/index.html?${params}`), completed]);
    const log = service.exportLog;
    if (log.errors.length || !log.done || mode === 'final' && log.warnings.length) throw new Error([...log.errors, ...log.warnings].join('\n') || 'Export did not complete.');
  } finally { clearTimeout(timer); win.destroy(); service.close(); activeWindow = null; activeService = null; }
}

  const renderSession = session.fromPartition('mcp-render');
  renderSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  renderSession.protocol.handle('studio', req => {
    if (!activeService || req.initiatorOrigin && req.initiatorOrigin !== ORIGIN) return new Response('Forbidden', { status: 403 });
    return activeService.request(req);
  });
  return { exportProject, close() { activeWindow?.destroy(); activeService?.close(); } };
}
