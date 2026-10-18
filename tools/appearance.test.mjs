import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createAppearance } from '../desktop/appearance.mjs';

const source = fs.readFileSync(new URL('../app/js/appearance.js', import.meta.url), 'utf8');
function renderer({ cached, storageFails = false, desktop } = {}) {
  const data = new Map(cached ? [['screenshot-studio:appearance', cached]] : []), handlers = new Map();
  const root = { dataset: {} }, window = new EventTarget();
  const media = { matches: true, addEventListener: (name, fn) => handlers.set(name, fn) };
  const localStorage = { getItem: key => { if (storageFails) throw Error('No storage'); return data.get(key); }, setItem: (key, value) => { if (storageFails) throw Error('No storage'); data.set(key, value); } };
  window.matchMedia = () => media; window.studioDesktop = desktop;
  vm.runInNewContext(source, { window, document: { documentElement: root }, localStorage, CustomEvent });
  return { api: window.studioAppearance, root, data, window, osDark(value) { media.matches = value; handlers.get('change')(); } };
}

test('System tracks the OS, explicit modes override it and the saved choice survives reload', async () => {
  const r = renderer(); assert.equal(r.api.theme, 'dark');
  await r.api.set('light'); r.osDark(true); assert.equal(r.api.theme, 'light');
  assert.equal(renderer({ cached: r.data.get('screenshot-studio:appearance') }).api.theme, 'light');
  await r.api.set('dark'); r.osDark(false); assert.equal(r.api.theme, 'dark');
  await r.api.set('system'); assert.equal(r.api.theme, 'light');
  r.osDark(true); assert.equal(r.api.theme, 'dark');
  await assert.rejects(r.api.set('blue'), /Choose/);
});

test('a slow startup preference cannot override a newer choice; failed saves retain the current mode', async () => {
  let loaded;
  const r = renderer({ desktop: { appearance: (op, value) => op === 'get' ? new Promise(resolve => { loaded = resolve; }) : Promise.resolve(value) } });
  await r.api.set('light'); loaded('dark'); await Promise.resolve();
  assert.equal(r.api.preference, 'light');
  const failure = renderer({ cached: 'dark', desktop: { appearance: op => op === 'get' ? Promise.resolve('dark') : Promise.reject(Error('Disk full')) } });
  await Promise.resolve(); await assert.rejects(failure.api.set('light'), /Disk full/);
  assert.equal(failure.api.preference, 'dark');
});

test('blocked storage and damaged preferences still provide a working appearance', async () => {
  const r = renderer({ storageFails: true }); await r.api.set('light'); assert.equal(r.api.theme, 'light');
  assert.equal(renderer({ cached: 'invalid' }).api.preference, 'system');
  const event = new Event('storage'); Object.assign(event, { key: 'screenshot-studio:appearance', newValue: 'dark' });
  r.window.dispatchEvent(event); assert.equal(r.api.preference, 'dark');
});

test('native appearance persists before changing controls, synchronizes windows and follows OS changes', () => {
  const theme = new EventEmitter(); theme.shouldUseDarkColors = false;
  let saved = 'light', fail = false; const messages = [], colors = [];
  const window = { isDestroyed: () => false, setBackgroundColor: c => colors.push(c), webContents: { send: (...args) => messages.push(args) } };
  const controller = createAppearance({ nativeTheme: theme, read: () => saved, write: value => { if (fail) throw Error('Disk full'); saved = value; }, windows: () => [window, window, null] });
  assert.equal(theme.themeSource, 'light');
  controller.set('dark'); assert.equal(saved, 'dark'); assert.equal(theme.themeSource, 'dark'); assert.equal(messages.length, 2);
  fail = true; assert.throws(() => controller.set('light'), /Disk full/); assert.equal(theme.themeSource, 'dark'); assert.equal(messages.length, 2);
  fail = false; controller.set('system'); theme.shouldUseDarkColors = true; theme.emit('updated');
  assert.equal(colors.at(-1), '#121019'); assert.equal(messages.at(-1)[1], 'system');
});
