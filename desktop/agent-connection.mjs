import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** Probe the bundled executable without changing any client configuration. */
export async function testAgentConnection(connection) {
  const transport = new StdioClientTransport({ ...connection, stderr: 'pipe' });
  const client = new Client({ name: 'screenshot-studio-setup', version: '1.0.0' });
  try {
    await client.connect(transport, { timeout: 20000 });
    const { tools } = await client.listTools({}, { timeout: 20000 });
    if (!['catalog', 'read_project', 'export_project', 'read_image'].every(name => tools.some(t => t.name === name))) throw new Error('The bundled server did not expose the expected tools.');
    const catalog = await client.callTool({ name: 'catalog', arguments: {} }, undefined, { timeout: 20000 });
    if (catalog.isError || !catalog.structuredContent || !(catalog.structuredContent.mode === 'active-app' || catalog.structuredContent.workspace)) throw new Error(catalog.content?.[0]?.text ?? 'The server could not reach Screenshot Studio.');
    return { tools: tools.length, workspace: catalog.structuredContent.workspace, project: catalog.structuredContent.project, mode: catalog.structuredContent.mode };
  } finally { await client.close(); }
}
