import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCredentials } from '../host/app-store-connect.mjs';
const exec = promisify(execFile);

// All account metadata and the private key are a single Keychain item. No secret file is created.
export function createAppStoreSettings({ root, userData, packaged = false }) {
  let helperPromise, queue = Promise.resolve();
  const helper = () => helperPromise ??= (async () => {
    const bundled = path.join(root, 'desktop/keychain-helper');
    if (packaged) { if (!fs.existsSync(bundled)) throw new Error('Keychain helper is missing. Rebuild the app.'); return bundled; }
    fs.mkdirSync(userData, { recursive: true });
    const destination = path.join(userData, 'app-store-keychain-helper');
    await exec('/usr/bin/xcrun', ['swiftc', path.join(root, 'desktop/keychain.swift'), '-o', destination], { timeout: 60000 });
    return destination;
  })();
  const keychain = async (operation, value = '') => {
    const binary = await helper();
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [operation, 'se.palusa.screenshotstudio.app-store-connect', 'app-store-connect'], { stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks = []; let size = 0;
      const timer = setTimeout(() => { child.kill(); reject(new Error('Keychain access timed out.')); }, 30000);
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 4096) child.kill(); else chunks.push(chunk); });
      child.stderr.resume(); child.stdin.on('error', () => {});
      child.on('error', () => { clearTimeout(timer); reject(new Error('Keychain is unavailable.')); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('Could not access macOS Keychain. Unlock it and allow Screenshot Studio access.')); });
      child.stdin.end(value);
    });
  };
  const serialized = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const credentials = () => serialized(async () => {
    const value = await keychain('read');
    if (!value) throw new Error('Connect an App Store Connect API key first.');
    return validateCredentials(JSON.parse(value));
  });
  return {
    credentials,
    async load() {
      try { const { keyId, issuerId } = await credentials(); return { connected: true, keyId, issuerId }; }
      catch (error) { return { connected: false, error: error.message }; }
    },
    save: value => serialized(() => keychain('write', JSON.stringify(validateCredentials(value)))),
    forget: () => serialized(() => keychain('delete')),
  };
}
