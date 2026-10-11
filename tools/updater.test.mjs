import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdater, updateFeed } from '../desktop/updater.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  const events = [], messages = [], pending = [];
  const autoUpdater = new EventEmitter();
  autoUpdater.setFeedURL = value => events.push(['feed', value.url]);
  autoUpdater.checkForUpdates = () => events.push(['check']);
  autoUpdater.quitAndInstall = () => events.push(['install']);
  const timers = { setTimeout: fn => { pending.push(fn); return 1; }, setInterval: fn => { pending.push(fn); return 2; }, clearTimeout() {}, clearInterval() {} };
  const updater = createUpdater({ autoUpdater, timers, version: '0.2.6', arch: 'arm64', supported: true,
    dialog: { showMessageBox: async options => { messages.push(options); return { response: 1 }; } },
    prepareInstall: async () => events.push(['save']), log: { warn() {} }, ...options });
  return { updater, autoUpdater, events, messages, pending };
}
test('architecture-specific HTTPS feed, delayed startup and periodic checks', async () => {
  assert.equal(updateFeed('0.2.6', 'x64'), 'https://update.electronjs.org/GioPalusa/ScreenShotStudio/darwin-x64/0.2.6');
  const f = setup(); assert.equal(f.pending.length, 2); assert.equal(f.events.length, 1);
  f.pending[0](); await tick(); assert.equal(f.updater.state, 'checking');
  assert.equal(f.events.filter(e => e[0] === 'check').length, 1);
  f.updater.dispose(); assert.equal(f.autoUpdater.listenerCount('error'), 0);
});
test('development and ad-hoc builds never configure or contact the service', async () => {
  const f = setup({ supported: false, unavailableReason: 'Developer ID required' });
  await f.updater.check(); await f.updater.check({ userInitiated: true });
  assert.deepEqual(f.events, []); assert.equal(f.pending.length, 0);
  assert.equal(f.messages[0].detail, 'Developer ID required');
});
test('overlapping checks and downloads cannot start a second download', async () => {
  const f = setup(); await f.updater.check(); await f.updater.check({ userInitiated: true });
  f.autoUpdater.emit('update-available'); await f.updater.check();
  assert.equal(f.events.filter(e => e[0] === 'check').length, 1);
  assert.equal(f.updater.state, 'downloading');
});
test('automatic errors stay quiet and manual errors recover for retry', async () => {
  const f = setup(); await f.updater.check(); f.autoUpdater.emit('error', new Error('Offline')); await tick();
  assert.equal(f.messages.length, 0); assert.equal(f.updater.state, 'idle');
  await f.updater.check({ userInitiated: true }); f.autoUpdater.emit('error', new Error('Offline')); await tick();
  assert.equal(f.messages.length, 1); assert.equal(f.updater.state, 'idle');
});
test('manual no-update feedback and opt-out still permit manual checks', async () => {
  const f = setup({ automatic: false }); assert.equal(f.pending.length, 0);
  await f.updater.check({ userInitiated: true }); f.autoUpdater.emit('update-not-available'); await tick();
  assert.match(f.messages[0].message, /up to date/);
});
test('Later retains the downloaded update, then installation waits for save acknowledgement', async () => {
  let confirmSave;
  const saved = new Promise(resolve => { confirmSave = resolve; });
  const f = setup({ prepareInstall: async () => { await saved; f.events.push(['save']); } });
  f.autoUpdater.emit('update-downloaded'); await tick();
  assert.equal(f.updater.state, 'downloaded'); assert.equal(f.events.some(e => e[0] === 'install'), false);
  const install = f.updater.install(); await tick();
  assert.equal(f.events.some(e => e[0] === 'install'), false);
  confirmSave(); await install; assert.deepEqual(f.events.slice(-2), [['save'], ['install']]);
});
test('failed save prevents restart and releases the document action lock', async () => {
  let canceled = false;
  const f = setup({ prepareInstall: async () => { throw new Error('Unacknowledged save'); }, cancelInstall: () => { canceled = true; } });
  f.autoUpdater.emit('update-downloaded'); await tick(); await f.updater.install();
  assert.equal(f.events.some(e => e[0] === 'install'), false); assert.equal(canceled, true);
  assert.match(f.messages.at(-1).detail, /Unacknowledged save/); assert.equal(f.updater.state, 'downloaded');
});
test('busy document action suppresses background prompt and user can install later', async () => {
  let busy = true;
  const f = setup({ canInteract: () => !busy });
  await f.updater.check(); assert.equal(f.events.some(e => e[0] === 'check'), false);
  f.autoUpdater.emit('update-downloaded'); await tick(); assert.equal(f.messages.length, 0);
  busy = false; await f.updater.check({ userInitiated: true }); assert.equal(f.messages.length, 1);
});
test('synchronous feed and check errors are handled', async () => {
  const f = setup(); f.autoUpdater.checkForUpdates = () => { throw new Error('Network'); };
  await f.updater.check({ userInitiated: true }); assert.equal(f.updater.state, 'idle'); assert.equal(f.messages.length, 1);
  const broken = new EventEmitter(); broken.setFeedURL = () => { throw new Error('Invalid feed'); };
  const g = setup({ autoUpdater: broken }); assert.equal(g.updater.state, 'disabled'); assert.equal(g.pending.length, 0);
});
