import { app, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMCPServer } from '../tools/mcp/server.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDesktopExporter } from './mcp-renderer.mjs';
import { callActiveAgent } from './active-agent-link.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const active = process.argv.includes('--active-app');
const workspace = option('--workspace'), appData = option('--app-data');
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const profile = fs.mkdtempSync(path.join(app.getPath('temp'), 'screenshot-studio-mcp-'));
app.setPath('userData', profile);
app.setActivationPolicy?.('accessory');
app.on('window-all-closed', () => {});
let exporter;
async function start() {
  if (active ? !appData || !path.isAbsolute(appData) : !workspace || workspace.startsWith('--')) throw new Error('Connect from Screenshot Studio, or supply --workspace for standalone use.');
  await app.whenReady();
  if (!active) exporter = createDesktopExporter(path.join(ROOT, 'app'));
  const options = active ? { activeApp: true, invoke: (name, args) => callActiveAgent(appData, name, args) } : { exportProject: exporter.exportProject };
  const server = createMCPServer(workspace, options);
  const transport = new StdioServerTransport();
  server.server.onclose = () => { exporter?.close(); app.quit(); };
  await server.connect(transport);
  process.stdin.once('end', () => app.quit());
}
void start().catch(error => { console.error(error.message); app.exit(1); });
app.once('will-quit', () => { exporter?.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* OS temporary storage also expires. */ } });
