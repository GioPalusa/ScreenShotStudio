// Regression for native image work racing accelerated browser timers on CI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { runBrowserTest } from './browser-test-runner.mjs';
import { encodePNG } from './png.mjs';
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(file => fs.existsSync(file));
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-browser-runner-'));
const png = encodePNG({ width: 1000, height: 1000, data: Buffer.alloc(1000 * 1000 * 4, 255) });
const server = http.createServer((req, res) => {
  if (req.url === '/image') { res.end(png); return; }
  if (req.url === '/pending') { res.end('<pre id="result">PENDING: intentionally unfinished</pre>'); return; }
  if (req.url === '/failure') { res.end('<pre id="result">FAIL: intentional assertion</pre>'); return; }
  res.end(`<!doctype html><pre id="result">PENDING</pre><script>
    (async () => {
      try {
        const blob = await (await fetch('/image')).blob();
        let done = false;
        const work = (async () => {
          for (let i = 0; i < 100; i++) {
            const bitmap = await createImageBitmap(new File([blob], 'test.png'));
            if (bitmap.width !== 1000) throw new Error('Wrong decoded dimensions');
            bitmap.close();
          }
          done = true;
        })();
        for (let i = 0; i < 500; i++) {
          if (done) { await work; result.textContent = 'PASS: native image decoding and real timers complete together'; return; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error('Timers outran image decoding');
      } catch (error) { result.textContent = 'FAIL: ' + error.message; }
    })();
  </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixture = (name, url, timeout = 15000) => runBrowserTest(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${path.join(temp, name)}`, `http://127.0.0.1:${server.address().port}${url}`], { timeout });
try {
  const { stdout } = await fixture('images', '/');
  assert.match(stdout, /<pre id="result">PASS: native image decoding/);
  const failure = await fixture('failure', '/failure');
  assert.match(failure.stdout, /FAIL: intentional assertion/);
  await assert.rejects(fixture('timeout', '/pending', 5000), error => {
    fs.writeFileSync('/tmp/studio-browser-runner-timeout-dom.html', error.stdout ?? '');
    assert.match(error.message, /timed out/);
    assert.match(error.stdout, /PENDING: intentionally unfinished/);
    return true;
  });
  console.log('PASS: real image decode/timer regression, explicit failures, bounded wall-clock timeout with DOM diagnostics and browser cleanup');
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
