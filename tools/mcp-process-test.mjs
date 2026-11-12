// Run against a real bundle; list tools, verify process count, then close stdin.
import assert from 'node:assert/strict';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { verifyActiveMCPProcess } from './mcp-process-check.mjs';

const bundle = process.argv[2];
assert.ok(bundle?.endsWith('.app'), 'Pass Screenshot Studio.app');
const transport = new StdioClientTransport({
  command: path.join(bundle, 'Contents/MacOS/Screenshot Studio'),
  args: ['--screenshot-studio-mcp', '--active-app', '--app-data', '/tmp/studio-process-check-no-document'],
  stderr: 'pipe',
});
const client = new Client({ name: 'studio-process-check', version: '1' });
let pid;
try {
  await client.connect(transport, { timeout: 15000 });
  pid = transport.pid;
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'read_project'));
  console.log(verifyActiveMCPProcess(pid));
} finally {
  await client.close();
  if (pid) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'MCP must exit when the client closes stdin');
}
