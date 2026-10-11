// Electron's native Squirrel.Mac updater. Only official Developer ID builds opt in.
export const RELEASES_URL = 'https://github.com/GioPalusa/ScreenShotStudio/releases';
export const updateFeed = (version, arch) => `https://update.electronjs.org/GioPalusa/ScreenShotStudio/darwin-${arch}/${encodeURIComponent(version)}`;

export function createUpdater({ autoUpdater, dialog, version, arch, supported, unavailableReason,
  automatic = true, canInteract = () => true, prepareInstall, cancelInstall = () => {},
  onChange = () => {}, log = console, timers = globalThis }) {
  let state = supported ? 'idle' : 'disabled', manual = false, prompting = false, installing = false;
  let initialTimer, interval;
  const setState = next => { state = next; onChange(); };
  const notify = options => dialog.showMessageBox({ title: 'Screenshot Studio Updates', ...options });
  const fail = async error => {
    const show = manual; manual = false; setState('idle');
    log.warn('Update check failed:', error.message);
    if (show) await notify({ type: 'warning', message: 'Could not check for updates', detail: 'Please try again later. You can also download releases from GitHub.' });
  };
  async function install() {
    if (state !== 'downloaded' || installing || !canInteract()) return;
    installing = true;
    try {
      // Squirrel closes windows before before-quit. Acknowledge saves before calling it.
      await prepareInstall();
      autoUpdater.quitAndInstall();
    } catch (error) {
      cancelInstall();
      await notify({ type: 'error', message: 'Could not restart for the update', detail: error.message });
    } finally { installing = false; }
  }
  async function offerInstall() {
    if (prompting || !canInteract()) return;
    prompting = true;
    try {
      const result = await notify({ type: 'info', message: 'An update is ready', detail: 'Restart Screenshot Studio to install it. Your project will be saved first.', buttons: ['Restart and Install', 'Later'], defaultId: 1, cancelId: 1 });
      if (result.response === 0) await install();
    } finally { prompting = false; }
  }
  function stopTimers() {
    timers.clearTimeout(initialTimer); timers.clearInterval(interval);
    initialTimer = interval = undefined;
  }
  function setAutomatic(value) {
    automatic = Boolean(value); stopTimers();
    if (supported && automatic) {
      initialTimer = timers.setTimeout(() => { void check(); }, 10000);
      interval = timers.setInterval(() => { void check(); }, 6 * 60 * 60 * 1000);
      initialTimer.unref?.(); interval.unref?.();
    }
    onChange();
  }
  async function check({ userInitiated = false } = {}) {
    if (!supported) {
      if (userInitiated) await notify({ message: 'Automatic updates are unavailable in this build', detail: unavailableReason });
      return;
    }
    if (!canInteract() || prompting || installing) return;
    if (state === 'downloaded') { if (userInitiated) await offerInstall(); return; }
    if (state === 'checking' || state === 'downloading') return;
    manual = userInitiated; setState('checking');
    try { autoUpdater.checkForUpdates(); } catch (error) { await fail(error); }
  }
  const listeners = {
    error: error => { void fail(error); },
    'checking-for-update': () => setState('checking'),
    'update-available': () => setState('downloading'),
    'update-not-available': () => {
      const show = manual; manual = false; setState('idle');
      if (show) void notify({ message: 'You’re up to date', detail: `Screenshot Studio ${version} is the latest available version.` });
    },
    'update-downloaded': () => { manual = false; setState('downloaded'); void offerInstall(); },
  };
  if (supported) {
    for (const [event, handler] of Object.entries(listeners)) autoUpdater.on(event, handler);
    try { autoUpdater.setFeedURL({ url: updateFeed(version, arch) }); }
    catch (error) { supported = false; state = 'disabled'; unavailableReason = error.message; }
  }
  setAutomatic(automatic);
  return { check, install, setAutomatic, get state() { return state; }, get automatic() { return automatic; },
    dispose() { stopTimers(); for (const [event, handler] of Object.entries(listeners)) autoUpdater.removeListener(event, handler); } };
}
