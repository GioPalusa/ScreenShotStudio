import { app, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMCPServer } from '../tools/mcp/server.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDesktopExporter } from './mcp-renderer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const workspace = option('--workspace');
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const profile = fs.mkdtempSync(path.join(app.getPath('temp'), 'screenshot-studio-mcp-'));
app.setPath('userData', profile);
app.setActivationPolicy?.('accessory');
app.on('window-all-closed', () => {});
let exporter;
async function start() {
  if (!workspace || workspace.startsWith('--')) throw new Error('Supply --workspace for standalone use.');
  await app.whenReady();
  exporter = createDesktopExporter(path.join(ROOT, 'app'));
  const server = createMCPServer(workspace, { exportProject: exporter.exportProject });
  const transport = new StdioServerTransport();
  server.server.onclose = () => { exporter?.close(); app.quit(); };
  await server.connect(transport);
  process.stdin.once('end', () => app.quit());
}
void start().catch(error => { console.error(error.message); app.exit(1); });
app.once('will-quit', () => { exporter?.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* OS temporary storage also expires. */ } });
