#!/usr/bin/env node
// Screenshot Studio server and CLI. Zero dependencies, Node 20+.
//
//   node studio.mjs                          start the studio and open it in your browser
//   node studio.mjs --no-open                start without opening a browser
//   node studio.mjs export [filters]         render everything headlessly (needs Google Chrome)
//       --locale sv,de-DE   --device iphone,ipad   --slide journal,story
//       --strict            exit with code 2 if anything was skipped or flagged (missing screenshot, long text, ...)
//       --allow-placeholders  also export slides whose screenshot is missing (shows "Screenshot needed")
//
// The server only listens on 127.0.0.1 and refuses requests from other origins.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createStudioService } from './host/service.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(ROOT, 'app');
let PROJECT = path.join(ROOT, 'starter');
let EXPORT = path.join(ROOT, 'export');

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'serve';
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PORT = Number(option('port') ?? process.env.PORT ?? (['export', 'inspect'].includes(command) ? 0 : 4729));


PROJECT = path.resolve(option('project') ?? PROJECT);
EXPORT = path.resolve(option('output') ?? EXPORT);
const service = createStudioService({ appPath: APP, projectPath: PROJECT, exportPath: EXPORT });
const { handle, startWatching, exportLog } = service;
// ---------------------------------------------------------------------------
// start

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handle(req, res, server.address().port).catch((err) => { console.error(err); res.writeHead(500); res.end(); });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c));
}

async function main() {
  if (!fs.existsSync(path.join(PROJECT, 'studio.json'))) {
    console.error(`No ${path.relative(process.cwd(), path.join(PROJECT, 'studio.json'))} found.`);
    process.exit(1);
  }

  let server;
  try {
    server = await listen(PORT);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is in use. Is the studio already running? Open http://127.0.0.1:${PORT} or pass --port.`);
      process.exit(1);
    }
    throw err;
  }
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  if (['export', 'inspect'].includes(command)) return runHeadlessExport(server, base);

  startWatching();
  console.log(`\n  Screenshot Studio\n  ${base}\n`);
  console.log('  Edit text, layouts and captures in the browser, or edit the JSON files under project/ - changes appear live.');
  console.log('  Press Ctrl+C to stop.\n');
  if (!flag('no-open')) execFile('open', [base]);
}

async function runHeadlessExport(server, base) {
  const chrome = findChrome();
  if (!chrome) {
    console.error('Headless export needs Google Chrome (or set CHROME_PATH to a Chromium-based browser).');
    console.error('Alternatively open the studio and use Export in the toolbar.');
    process.exit(1);
  }
  const params = new URLSearchParams({ headless: '1' });
  if (command === 'inspect') { params.set('inspect', '1'); if (flag('check-only')) params.set('checkOnly', '1'); }
  for (const key of ['locale', 'device', 'slide']) if (option(key)) params.set(key, option(key));
  if (flag('strict')) params.set('strict', '1');
  if (flag('allow-placeholders')) params.set('placeholders', '1');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-studio-chrome-'));
  console.log(`Exporting via headless Chrome -> ${path.relative(process.cwd(), EXPORT) || EXPORT}`);
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`, '--window-size=1400,900',
    `${base}/app/index.html?${params}`,
  ], { stdio: 'ignore' });

  const finished = new Promise((resolve) => { exportLog.resolve = resolve; });
  child.on('exit', () => exportLog.resolve?.());
  const timeout = setTimeout(() => { console.error('Export timed out after 30 minutes.'); exportLog.errors.push('timeout'); exportLog.resolve(); }, 30 * 60 * 1000);
  await finished;
  clearTimeout(timeout);
  // Let Chrome shut down fully before deleting its temporary profile, and don't fail the export if
  // a straggling helper process still holds a file - the OS clears the temp folder eventually.
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 4000); });
  }
  service.close(); server.close();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch { /* ignore */ }

  console.log(`\nWrote ${exportLog.written} screenshot${exportLog.written === 1 ? '' : 's'}.`);
  if (exportLog.warnings.length) console.log(`${exportLog.warnings.length} warning${exportLog.warnings.length === 1 ? '' : 's'}:\n  - ${exportLog.warnings.join('\n  - ')}`);
  if (exportLog.errors.length) { console.error(`${exportLog.errors.length} error(s):\n  - ${exportLog.errors.join('\n  - ')}`); process.exit(1); }
  if (!exportLog.done) { console.error('Browser closed before the export finished.'); process.exit(1); }
  if (command === 'inspect') {
    if (!exportLog.inspection) throw new Error('Inspection produced no result.');
    fs.mkdirSync(EXPORT, { recursive: true });
    fs.writeFileSync(path.join(EXPORT, 'inspection.json'), JSON.stringify(exportLog.inspection));
  }
  if (flag('strict') && exportLog.warnings.length) process.exit(2);
  process.exit(0);
}

main();
