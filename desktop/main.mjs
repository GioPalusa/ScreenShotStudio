import { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createUpdater, RELEASES_URL } from './updater.mjs';
import { fileURLToPath } from 'node:url';
import { createStudioService } from '../host/service.mjs';
import { atomicWrite, copyProject, assertInside } from '../host/files.mjs';
import { isProjectFile, projectName, projectFilename } from '../app/js/project-file.js';
import { startupProject } from '../app/js/onboarding.js';
import { createNewProject } from '../host/new-project.mjs';
import { importFrameDiskImage } from '../host/disk-image-frames.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ORIGIN = 'studio://local';
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, aboutWindow, service, current, closing = false, busy = false, closingRequest = false, pendingOpen = null, readyForFiles = false;
let updater, updaterClosedService = false;
const waits = new Map();
let settings = { recent: [] };
const settingsFile = () => path.join(app.getPath('userData'), 'projects.json');
const allowedExternal = url => ['https://www.palusa.se', 'https://developer.apple.com/', 'https://support.google.com/googleplay/', 'https://developer.android.com/'].some(origin => origin.endsWith('/') ? url.startsWith(origin) : url === origin || url.startsWith(origin + '/'));
const saveSettings = () => atomicWrite(settingsFile(), JSON.stringify(settings, null, 2));
const trusted = event => event.sender === win?.webContents && event.senderFrame?.url.startsWith(`${ORIGIN}/app/`);

async function flush() {
  if (!win || !service) return;
  const token = crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waits.delete(token); reject(new Error('The editor did not confirm its saves. Your project remains open.')); }, 15000);
    waits.set(token, error => { clearTimeout(timer); error ? reject(new Error(error)) : resolve(); });
    win.webContents.send('studio:flush', token);
  });
}
ipcMain.on('studio:flushed', (event, token, error) => {
  if (!trusted(event) || !waits.has(token)) return;
  waits.get(token)(error); waits.delete(token);
});

async function openProject(folder, { created = false } = {}) {
  // Validate the entire candidate while the current document and editor remain usable.
  const candidatePath = fs.realpathSync(folder);
  const candidate = createStudioService({ appPath: path.join(ROOT, 'app'), projectPath: candidatePath, exportPath: path.join(candidatePath, 'export'), origin: ORIGIN, onChange: value => win?.webContents.send('studio:changed', value) });
  try { candidate.loadProjectBundle(); await flush(); }
  catch (error) { candidate.close(); throw error; }
  service?.close(); current = candidatePath; service = candidate;
  service.startWatching();
  await win.loadURL(`${ORIGIN}/app/index.html${created ? '?new=1' : ''}`);
  win.setTitle(`${projectName(path.basename(current))} — Screenshot Studio`);
  settings.recent = [current, ...settings.recent.filter(p => p !== current)].slice(0, 12);
  buildMenu();
  try { saveSettings(); app.addRecentDocument(current); }
  catch (error) { void dialog.showMessageBox(win, { type: 'warning', message: 'Project opened', detail: `The recent-project list could not be saved. Your project is open and usable. ${error.message}` }); }
}

async function chooseDestination(title, name, { allowReplace = false } = {}) {
  const result = await dialog.showSaveDialog(win, { title, defaultPath: path.join(app.getPath('documents'), projectFilename(name)), filters: [{ name: 'Screenshot Studio project', extensions: ['sss'] }] });
  if (result.canceled) return null;
  const dest = projectFilename(result.filePath);
  if (fs.existsSync(dest)) {
    if (!allowReplace) throw new Error('Choose a new name. Existing projects are never overwritten.');
    // The native panel confirms replacement of its returned path. If adding the
    // project extension changes that path, confirm the actual destination too.
    if (path.resolve(dest) !== path.resolve(result.filePath)) {
      const confirmation = await dialog.showMessageBox(win, { type: 'warning', message: `Replace “${path.basename(dest)}”?`, detail: 'A new project will replace it. The previous project will be kept as a saved version.', buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0 });
      if (confirmation.response !== 1) return null;
    }
  }
  return dest;
}
async function action(name, options = null) {
  if (busy) return;
  busy = true;
  try {
    if (name.startsWith('recent:')) { const folder = name.slice(7); if (!settings.recent.includes(folder)) throw new Error('Unknown recent project'); await openProject(folder); }
    else if (name === 'open-file') { const file = pendingOpen; pendingOpen = null; if (file) await openProject(file); }
    else if (name === 'open') {
      const result = await dialog.showOpenDialog(win, { title: 'Open Screenshot Studio project', properties: ['openDirectory', 'treatPackageAsDirectory'] });
      if (!result.canceled) await openProject(result.filePaths[0]);
    } else if (name === 'new' || name === 'welcome') {
      if (!options) { await flush(); service?.close(); service = null; current = null; buildMenu(); await win.loadURL(`${ORIGIN}/app/welcome.html`); win.setTitle('Welcome — Screenshot Studio'); return; }
      if (typeof options.name !== 'string' || !options.name.trim() || options.name.length > 80 || /[\\/]/.test(options.name)) throw new Error('Give your project a name without slashes.');
      const dest = await chooseDestination('Create project', options.name.trim(), { allowReplace: true }); if (!dest) return;
      const replace = fs.existsSync(dest);
      await flush(); createNewProject(dest, options, { replace }); await openProject(dest, { created: true });
    } else if (name === 'save-as') {
      const dest = await chooseDestination('Save project as', `${projectName(path.basename(current))} copy`); if (!dest) return;
      await flush(); copyProject(current, dest); await openProject(dest);
    } else if (name === 'save') await flush();
    else if (name === 'snapshot') {
      await flush();
      const id = new Date().toISOString().replace(/[:.]/g, '-');
      // Copy through a sibling staging directory: copyProject refuses descendants.
      const staging = path.join(path.dirname(current), `.studio-version-${crypto.randomUUID()}`);
      try { copyProject(current, staging); fs.mkdirSync(path.join(current, '.versions'), { recursive: true }); fs.renameSync(staging, path.join(current, '.versions', id)); }
      finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true }); }
      await dialog.showMessageBox(win, { message: 'Version saved', detail: 'This version contains the complete project and its images. Use Restore Version to open a separate recovered copy.' });
    } else if (name === 'restore') {
      const dir = path.join(current, '.versions');
      if (!fs.existsSync(dir)) throw new Error('No named versions yet. Use Save Version first. Every changed file also has an automatic backup in .history.');
      const result = await dialog.showOpenDialog(win, { title: 'Choose a saved version', defaultPath: dir, properties: ['openDirectory', 'showHiddenFiles', 'treatPackageAsDirectory'] });
      if (result.canceled) return;
      const from = fs.realpathSync(result.filePaths[0]);
      if (!from.startsWith(fs.realpathSync(dir) + path.sep)) throw new Error('Choose a version from this project’s .versions folder.');
      const dest = await chooseDestination('Recover version as a new project', 'Recovered'); if (!dest) return;
      await flush(); copyProject(from, dest); await openProject(dest);
    } else if (name === 'recover-backup') {
      const history = path.join(current, '.history');
      if (!fs.existsSync(history)) throw new Error('There are no automatic backups yet. A backup is saved before each file is changed.');
      const picked = await dialog.showOpenDialog(win, { title: 'Recover an automatic backup into a separate project', message: 'Choose a .bak file inside the folder for the design, text or image you want to recover.', defaultPath: history, properties: ['openFile', 'showHiddenFiles', 'treatPackageAsDirectory'], filters: [{ name: 'Automatic backup', extensions: ['bak'] }] });
      if (picked.canceled) return;
      const source = fs.realpathSync(picked.filePaths[0]); assertInside(history, source);
      const relative = path.dirname(path.relative(history, source));
      if (relative === '.' || relative.startsWith('.')) throw new Error('Choose a backup inside one of the project file folders.');
      const dest = await chooseDestination('Recover backup as a new project', 'Recovered'); if (!dest) return;
      await flush(); copyProject(current, dest);
      const target = path.join(dest, relative); assertInside(dest, target);
      atomicWrite(target, fs.readFileSync(source)); await openProject(dest);
    } else if (name === 'reveal') await shell.openPath(current);
    else if (name === 'export') win.webContents.send('studio:export');
    else throw new Error('Unknown project action');
  } catch (error) { if (options) return { error: error.message }; await dialog.showMessageBox(win, { type: 'error', message: 'Could not complete the action', detail: error.message }); }
  finally { busy = false; }
}
ipcMain.handle('studio:create-project', (event, value) => { if (!trusted(event)) throw new Error('Forbidden'); return action('new', value); });
ipcMain.handle('studio:action', (event, name) => { if (!trusted(event)) throw new Error('Forbidden'); return action(name); });

ipcMain.handle('studio:save-review', async (event, value) => {
  if (!trusted(event)) throw new Error('Forbidden');
  if (busy) throw new Error('Finish the current project action first.');
  if (!value || typeof value.text !== 'string' || Buffer.byteLength(value.text) > 20 * 1024 * 1024 || typeof value.name !== 'string' || path.basename(value.name) !== value.name || !value.name.endsWith('.csv')) throw new Error('Invalid review file.');
  busy = true;
  try {
    const result = await dialog.showSaveDialog(win, { title: 'Export text for review', defaultPath: path.join(app.getPath('documents'), value.name), filters: [{ name: 'UTF-8 CSV review file', extensions: ['csv'] }] });
    if (result.canceled) return false;
    atomicWrite(result.filePath, value.text);
    return true;
  } finally { busy = false; }
});

ipcMain.handle('studio:import-frame-dmg', async (event, source) => {
  if (!trusted(event) || !service) throw new Error('Open a project first.');
  if (busy) throw new Error('Finish the current project action first.');
  busy = true;
  try {
    if (process.platform !== 'darwin') throw new Error('DMG import requires macOS.');
    if (source === null) {
      const picked = await dialog.showOpenDialog(win, { title: 'Import bezel DMG', message: 'macOS will ask you to accept any agreement included with the disk image.', properties: ['openFile', 'noResolveAliases'], filters: [{ name: 'Disk image', extensions: ['dmg'] }] });
      if (picked.canceled) return { canceled: true, files: [] };
      source = picked.filePaths[0];
    }
    return await importFrameDiskImage(source);
  } finally { busy = false; win?.focus(); }
});

function showAbout() {
  if (aboutWindow && !aboutWindow.isDestroyed()) { aboutWindow.show(); aboutWindow.focus(); return; }
  aboutWindow = new BrowserWindow({ width: 480, height: 420, title: 'About Screenshot Studio', resizable: false, minimizable: false, maximizable: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#101C36' : '#EEEAE3', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => { if (allowedExternal(url)) void shell.openExternal(url); return { action: 'deny' }; });
  aboutWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${ORIGIN}/app/`)) event.preventDefault(); });
  void aboutWindow.loadURL(`${ORIGIN}/app/about.html?version=${encodeURIComponent(app.getVersion())}`);
}
ipcMain.handle('studio:recent-projects', event => {
  if (!trusted(event)) throw new Error('Forbidden');
  return settings.recent.filter(p => typeof p === 'string' && fs.existsSync(path.join(p, 'studio.json'))).map(p => ({ path: p, name: projectName(path.basename(p)) }));
});
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Screenshot Studio', submenu: [{ label: 'About Screenshot Studio', click: showAbout },
      { label: updater?.state === 'downloaded' ? 'Restart and Install Update…' : updater?.state === 'checking' ? 'Checking for Updates…' : updater?.state === 'downloading' ? 'Downloading Update…' : 'Check for Updates…', enabled: !['checking', 'downloading'].includes(updater?.state), click: () => updater?.check({ userInitiated: true }) },
      { label: 'Automatically Check for Updates', type: 'checkbox', checked: settings.autoUpdates !== false, enabled: updater?.state !== 'disabled', click: item => { const previous = settings.autoUpdates; settings.autoUpdates = item.checked; try { saveSettings(); updater?.setAutomatic(item.checked); } catch (error) { settings.autoUpdates = previous; buildMenu(); void dialog.showMessageBox(win, { type: 'error', message: 'Could not save update preferences', detail: error.message }); } } }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [
      { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: () => action('new') },
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => action('open') },
      { label: 'Open Recent', submenu: settings.recent.map(p => ({ label: path.basename(p), click: () => action(`recent:${p}`) })) },
      { type: 'separator' }, { label: 'Save', enabled: Boolean(current), accelerator: 'CmdOrCtrl+S', click: () => action('save') },
      { label: 'Save As…', enabled: Boolean(current), accelerator: 'CmdOrCtrl+Shift+S', click: () => action('save-as') },
      { label: 'Save Version', enabled: Boolean(current), click: () => action('snapshot') }, { label: 'Restore Version…', enabled: Boolean(current), click: () => action('restore') },
      { label: 'Recover Automatic Backup…', enabled: Boolean(current), click: () => action('recover-backup') },
      { label: 'Show Project in Finder', enabled: Boolean(current), click: () => action('reveal') },
      { type: 'separator' }, { label: 'Export…', enabled: Boolean(current), accelerator: 'CmdOrCtrl+E', click: () => action('export') }, { role: 'close' },
    ] }, { role: 'editMenu' },
    { label: 'Help', submenu: [{ label: 'Get Started Guide', click: () => win.webContents.send('studio:command', 'guide') }, { label: 'Community on GitHub', click: () => shell.openExternal('https://github.com/GioPalusa/ScreenShotStudio') }, { label: 'Download Releases', click: () => shell.openExternal(RELEASES_URL) }] },
    { label: 'View', submenu: [
      { label: 'Welcome Screen', click: () => action('welcome') },
      { label: 'Media Library…', enabled: Boolean(current), accelerator: 'CmdOrCtrl+Shift+M', click: () => win.webContents.send('studio:command', 'media') },
      { label: 'Keyboard Shortcuts…', enabled: Boolean(current), click: () => win.webContents.send('studio:command', 'shortcuts') },
    ] }, { role: 'windowMenu' },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => { win?.show(); win?.focus(); const file = argv.find(isProjectFile); if (file) { pendingOpen = file; if (readyForFiles) void action('open-file'); } });
  app.on('open-file', (event, file) => { event.preventDefault(); pendingOpen = file; if (readyForFiles) void action('open-file'); });
  app.whenReady().then(async () => {
    app.dock?.setIcon(path.join(ROOT, 'app', 'icons', 'screenshot-studio.png'));
    try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* first launch */ }
    settings.recent = Array.isArray(settings.recent) ? settings.recent.filter(p => typeof p === 'string' && p) : [];
    const welcomeService = createStudioService({ appPath: path.join(ROOT, 'app'), projectPath: path.join(ROOT, 'starter'), exportPath: path.join(ROOT, 'starter', 'export'), origin: ORIGIN });
    protocol.handle('studio', req => {
      if (req.initiatorOrigin && req.initiatorOrigin !== ORIGIN) return new Response('Forbidden', { status: 403 });
      if (service) return service.request(req);
      if (req.method === 'GET' && new URL(req.url).pathname.startsWith('/app/')) return welcomeService.request(req);
      return new Response('Open or create a project first.', { status: 403 });
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win = new BrowserWindow({ width: 1480, height: 950, minWidth: 1000, minHeight: 680, title: 'Screenshot Studio', backgroundColor: nativeTheme.shouldUseDarkColors ? '#101C36' : '#EEEAE3', webPreferences: { preload: path.join(ROOT, 'desktop', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    win.webContents.setWindowOpenHandler(({ url }) => { if (allowedExternal(url)) void shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${ORIGIN}/app/`)) event.preventDefault(); });
    win.on('close', event => {
      if (closing) return;
      event.preventDefault();
      if (closingRequest || busy) return; closingRequest = true;
      flush().then(() => { closing = true; service?.close(); win.destroy(); app.quit(); }).catch(error => dialog.showMessageBox(win, { type: 'error', message: 'Your edits are not saved', detail: error.message })).finally(() => { closingRequest = false; });
    });
    const arg = process.argv.find(isProjectFile);
    const explicit = pendingOpen ?? arg;
    const initial = startupProject({ explicit, recent: settings.recent }, folder => fs.statSync(path.join(folder, 'studio.json')).isFile());
    pendingOpen = null;
    let openError;
    if (initial) {
      try { await openProject(initial); }
      catch (error) { openError = error; service?.close(); service = null; current = null; }
    }
    if (!current) { buildMenu(); await win.loadURL(`${ORIGIN}/app/welcome.html`); win.setTitle('Welcome — Screenshot Studio'); }
    let signed = false;
    if (app.isPackaged && process.platform === 'darwin') {
      try {
        const bundle = path.resolve(path.dirname(app.getPath('exe')), '..', '..');
        execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
        const info = spawnSync('codesign', ['--display', '--verbose=2', bundle], { encoding: 'utf8' });
        signed = info.status === 0 && /^Authority=Developer ID Application:/m.test(info.stderr);
      } catch { /* development or invalid signature */ }
    }
    updater = createUpdater({ autoUpdater, dialog, version: app.getVersion(), arch: process.arch,
      supported: signed && !process.mas && ['arm64', 'x64'].includes(process.arch),
      unavailableReason: 'Use an official Developer ID release installed on your Mac. Development, ad-hoc and App Store builds do not receive automatic updates. Downloads are available through Help → Download Releases.',
      automatic: settings.autoUpdates !== false, canInteract: () => !busy && !closingRequest && !closing,
      prepareInstall: async () => { if (busy || closingRequest || closing) throw new Error('Finish the current project action first.'); busy = true; await flush(); closing = true; service?.close(); updaterClosedService = Boolean(service); },
      cancelInstall: () => { busy = false; closing = false; if (updaterClosedService) service?.startWatching(); updaterClosedService = false; }, onChange: buildMenu,
    });
    app.once('will-quit', () => updater.dispose());
    buildMenu();
    readyForFiles = true;
    if (pendingOpen) await action('open-file');
    else if (openError) await dialog.showMessageBox(win, { type: 'warning', message: explicit ? 'Could not open the project' : 'Could not reopen the last project', detail: `${openError.message}\nYou can open another project or create a new one from the welcome screen.` });

  }).catch(error => { dialog.showErrorBox('Screenshot Studio could not start', error.message); app.quit(); });
}
