import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/** Run a synthetic UI fixture on wall time. Virtual time outruns native image/Blob
 * work and clipboard tasks, making otherwise correct tests fail randomly on CI. */
export async function runBrowserTest(chrome, args, { timeout = 40000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  const profile = args.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  const url = args.find(arg => /^https?:/.test(arg));
  if (!profile || !url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('Browser tests require an isolated profile and a localhost fixture.');
  const deadline = Date.now() + timeout;
  const remaining = () => Math.max(1, deadline - Date.now());
  const flags = args.filter(arg => arg !== url && arg !== '--dump-dom' && !arg.startsWith('--virtual-time-budget=') && !arg.startsWith('--remote-debugging-'));
  const child = spawn(chrome, [...flags, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', socket, exited = false, launchError, id = 0, stdout = '';
  const closed = new Promise(resolve => child.once('close', () => { exited = true; resolve(); }));
  child.once('error', error => { launchError = error; });
  child.stderr.on('data', data => { if (Buffer.byteLength(stderr) < maxBuffer) stderr += data.toString(); });
  const pending = new Map();
  const ensureRunning = () => {
    if (launchError) throw launchError;
    if (exited) throw new Error(`Chrome exited before the fixture finished (code ${child.exitCode}).`);
    if (Date.now() >= deadline) throw new Error(`Browser fixture timed out after ${timeout} ms: ${url}`);
  };
  function command(method, params = {}, budget = remaining()) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Chrome command timed out: ${method}`)); }, budget);
      pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  const evaluate = async (expression, budget) => {
    const response = await command('Runtime.evaluate', { expression, returnByValue: true }, budget);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    while (!fs.existsSync(portFile)) { ensureRunning(); await delay(25); }
    let port;
    while (!port) {
      ensureRunning();
      const value = fs.readFileSync(portFile, 'utf8').split('\n')[0];
      if (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 65535) port = value;
      else await delay(25);
    }
    let page;
    while (!page) {
      ensureRunning();
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(remaining()) });
      page = (await response.json()).find(target => target.type === 'page');
      if (!page) await delay(25);
    }
    socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const request of pending.values()) request.reject(new Error('Chrome debugging connection closed.'));
      pending.clear();
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome debugging connection timed out.')), remaining());
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to Chrome.')); }, { once: true });
    });
    await command('Page.navigate', { url });
    while (true) {
      ensureRunning();
      const verdict = await evaluate("document.querySelector('#result')?.textContent ?? ''");
      if (/^(PASS|FAIL):/.test(verdict)) {
        stdout = await evaluate('document.documentElement.outerHTML');
        if (Buffer.byteLength(stdout) > maxBuffer) throw new Error('Browser fixture DOM exceeded its diagnostic size limit.');
        return { stdout, stderr };
      }
      await delay(25);
    }
  } catch (error) {
    if (socket?.readyState === WebSocket.OPEN) {
      try { stdout = await evaluate('document.documentElement.outerHTML', 500); } catch { /* Keep the original failure. */ }
    }
    error.stdout = stdout; error.stderr = stderr;
    throw error;
  } finally {
    for (const request of pending.values()) request.reject(new Error('Browser fixture finished.'));
    pending.clear(); socket?.close();
    if (!exited) child.kill('SIGTERM');
    await Promise.race([closed, delay(1000, undefined, { ref: false })]);
    if (!exited) { child.kill('SIGKILL'); await closed; }
  }
}

// Callback adapter retains each existing fixture's DOM/stderr diagnostic files.
export function execBrowserTest(chrome, args, options, callback) {
  void runBrowserTest(chrome, args, options).then(
    ({ stdout, stderr }) => callback(null, stdout, stderr),
    error => callback(error, error.stdout ?? '', error.stderr ?? ''),
  );
}
