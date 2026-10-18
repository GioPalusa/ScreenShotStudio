// One signed executable serves either the editor or a client's stdio MCP process.
if (process.argv.includes('--screenshot-studio-mcp')) await import('./mcp-main.mjs');
else await import('./main.mjs');
