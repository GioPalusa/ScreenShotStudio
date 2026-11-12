// One signed executable serves either the editor or a client's stdio MCP process.
if (process.argv.includes('--screenshot-studio-mcp') && process.argv.includes('--active-app')) {
  // A proxy only talks to the GUI's Unix socket. Replace this process before
  // Electron becomes ready, keeping its PID/stdin/stdout and existing client configs.
  // Starting Chromium here otherwise costs two helpers for every connected chat.
  const { fileURLToPath } = await import('node:url');
  const server = fileURLToPath(new URL('../tools/mcp/server.mjs', import.meta.url));
  process.execve(process.execPath, [process.execPath, server, ...process.argv.slice(process.argv.indexOf('--screenshot-studio-mcp') + 1)], {
    ...process.env, ELECTRON_RUN_AS_NODE: '1',
  });
}
else if (process.argv.includes('--screenshot-studio-mcp')) await import('./mcp-main.mjs');
else await import('./main.mjs');
