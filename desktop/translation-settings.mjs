import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicWrite } from '../host/files.mjs';

const exec = promisify(execFile);
const providers = new Set(['openai', 'claude']);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value);
export function cleanTranslationSettings(value) {
  if (!providers.has(value?.provider) || !validId(value.model)) throw new Error('Invalid translation settings.');
  if (!Array.isArray(value.models) || value.models.length > 2000) throw new Error('Invalid model list.');
  return { model: value.model, models: value.models.filter(m => validId(m?.id)).map(m => ({ id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 200) : m.id })) };
}

export function createTranslationSettings({ root, userData, packaged = false, serviceName = 'se.palusa.screenshotstudio.translation' }) {
  const file = path.join(userData, 'translation-settings.json');
  let helperPromise, queue = Promise.resolve();
  const helper = () => helperPromise ??= (async () => {
    const bundled = path.join(root, 'desktop', 'keychain-helper');
    if (packaged) { if (!fs.existsSync(bundled)) throw new Error('Keychain helper is missing. Rebuild the app.'); return bundled; }
    const destination = path.join(userData, 'keychain-helper');
    fs.mkdirSync(userData, { recursive: true });
    await exec('/usr/bin/xcrun', ['swiftc', path.join(root, 'desktop', 'keychain.swift'), '-o', destination], { timeout: 60000 });
    return destination;
  })();
  async function keychain(operation, provider, token = '') {
    if (!providers.has(provider)) throw new Error('Invalid translation provider.');
    if (operation === 'write' && (typeof token !== 'string' || !token.trim() || Buffer.byteLength(token) > 4096)) throw new Error('Invalid API key.');
    const binary = await helper();
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [operation, serviceName, provider], { stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks = []; let bytes = 0;
      child.stdout.on('data', data => { bytes += data.length; if (bytes > 4096) child.kill(); else chunks.push(data); });
      child.stderr.resume();
      child.on('error', () => reject(new Error('Keychain is unavailable.')));
      child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('Could not access macOS Keychain. Unlock it and allow Screenshot Studio access.')));
      child.stdin.on('error', () => {});
      child.stdin.end(operation === 'write' ? token.trim() : '');
    });
  }
  const serialized = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  return {
    async load(provider) {
      return serialized(async () => {
        provider ??= read().lastProvider ?? 'openai';
        if (!providers.has(provider)) throw new Error('Invalid translation provider.');
        const prefs = { ...read()[provider], provider };
        try { return { ...prefs, token: await keychain('read', provider) }; }
        catch (error) { return { ...prefs, token: '', keyError: error.message }; }
      });
    },
    async save(value) {
      const prefs = cleanTranslationSettings(value);
      return serialized(async () => {
        if (value.token !== undefined) await keychain('write', value.provider, value.token);
        const settings = read(); settings[value.provider] = prefs; settings.lastProvider = value.provider;
        atomicWrite(file, JSON.stringify(settings, null, 2));
      });
    },
    forget(provider) { return serialized(() => keychain('delete', provider)); },
  };
}
