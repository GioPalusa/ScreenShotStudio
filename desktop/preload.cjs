const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('studioDesktop', {
  onChanged: callback => ipcRenderer.on('studio:changed', (_event, value) => callback(value)),
  onFlush: callback => ipcRenderer.on('studio:flush', async (_event, token) => {
    try { await callback(); ipcRenderer.send('studio:flushed', token, null); }
    catch (error) { ipcRenderer.send('studio:flushed', token, String(error.message ?? error)); }
  }),
  onCommand: callback => ipcRenderer.on('studio:command', (_event, command) => callback(command)),
  onExport: callback => ipcRenderer.on('studio:export', () => callback()),
  chooseExportFolder: () => ipcRenderer.invoke('studio:choose-export-folder'),
  saveReview: value => ipcRenderer.invoke('studio:save-review', value),
  importFrameDmg: file => ipcRenderer.invoke('studio:import-frame-dmg', file ? webUtils.getPathForFile(file) : null),
  createProject: value => ipcRenderer.invoke('studio:create-project', value),
  recentProjects: () => ipcRenderer.invoke('studio:recent-projects'),
  action: name => ipcRenderer.invoke('studio:action', name),
  agentSetup: (operation, value) => ipcRenderer.invoke('studio:agent-setup', operation, value),
  appStore: (operation, value) => ipcRenderer.invoke('studio:app-store', operation, value),
  translationSettings: (operation, value) => ipcRenderer.invoke('studio:translation-settings', operation, value),
});
