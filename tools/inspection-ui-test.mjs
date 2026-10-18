// An oversized inspection must report its HTTP rejection, not wait for the host's 30-minute timeout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
import { runBrowserTest } from './browser-test-runner.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-inspection-ui-'));
const appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Test.sss');
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let service, server;
try {
  fs.cpSync(path.resolve('app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  fs.writeFileSync(path.join(appPath, 'js/agent-inspection.js'), `export async function inspectProject(){return {image:'A'.repeat(9*1024*1024)}}`);
  fs.writeFileSync(path.join(appPath, 'inspection-test.html'), '<html><body><pre id="result">PENDING</pre><script type="module" src="/app/inspection-test.js"></script></body></html>');
  fs.writeFileSync(path.join(appPath, 'inspection-test.js'), `
    import {loadAll} from '/app/js/store.js';
    import {runHeadless} from '/app/js/ui/export.js';
    try {
      await loadAll(); await runHeadless(new URLSearchParams({inspect:'1'}));
      document.querySelector('#result').textContent='PASS: headless inspection returned promptly after rejected transfer';
    } catch(error) { document.querySelector('#result').textContent='FAIL: '+error.stack; }
  `);
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { stdout } = await runBrowserTest(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-sandbox', `--user-data-dir=${path.join(temp, 'chrome')}`, `http://127.0.0.1:${server.address().port}/app/inspection-test.html`], { timeout: 30000 });
  assert.match(stdout, /PASS: headless inspection returned promptly/);
  assert.equal(service.exportLog.done, true);
  assert.equal(service.exportLog.inspection, undefined);
  assert.match(service.exportLog.errors.join('\n'), /Preview result is too large/);
  console.log('PASS: oversized inspection fails promptly with an actionable error and signals completion');
} finally {
  server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve());
  service?.close(); fs.rmSync(temp, { recursive: true, force: true });
}
