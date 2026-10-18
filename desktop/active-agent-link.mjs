import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite } from '../host/files.mjs';

const statePath = appData => path.join(appData, 'active-mcp.json');
function receive(socket, maximum) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    const finish = (error, value) => { if (done) return; done = true; socket.off('data', data); error ? reject(error) : resolve(value); };
    const data = chunk => {
      chunks.push(chunk); size += chunk.length;
      if (size > maximum) { finish(new Error('App connection message is too large.')); socket.destroy(); return; }
      if (chunk.includes(10)) {
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { finish(new Error('Invalid app connection message.')); }
      }
    };
    socket.on('data', data);
    socket.once('error', () => finish(new Error('Open Screenshot Studio and reconnect its MCP server.')));
    socket.once('end', () => finish(new Error('The app connection closed. Open Screenshot Studio and try again.')));
    socket.once('timeout', () => { finish(new Error('The app connection timed out.')); socket.destroy(); });
  });
}

/** Private Unix socket, never a listening HTTP server. No project path is cached by the client. */
export async function startActiveAgentLink({ appData, invoke }) {
  const directory = fs.mkdtempSync('/tmp/sss-agent-'); fs.chmodSync(directory, 0o700);
  const address = path.join(directory, 'rpc'), token = crypto.randomBytes(32).toString('hex');
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.setTimeout(32 * 60 * 1000);
    void (async () => {
      try {
        const request = await receive(socket, 16 * 1024 * 1024);
        if (typeof request.token !== 'string' || request.token.length !== token.length || !crypto.timingSafeEqual(Buffer.from(request.token), Buffer.from(token))) throw new Error('Invalid app connection.');
        const result = await invoke(request.name, request.args);
        socket.end(JSON.stringify({ result }) + '\n');
      } catch (error) { if (!socket.destroyed) socket.end(JSON.stringify({ error: error.message }) + '\n'); }
    })();
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
    fs.chmodSync(address, 0o600);
    atomicWrite(statePath(appData), JSON.stringify({ address, token, pid: process.pid }), { mode: 0o600 });
  } catch (error) { server.close(); fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  return { close() {
    try { if (JSON.parse(fs.readFileSync(statePath(appData), 'utf8')).token === token) fs.unlinkSync(statePath(appData)); } catch { /* Already closed. */ }
    for (const socket of sockets) socket.destroy();
    server.close(() => fs.rmSync(directory, { recursive: true, force: true }));
  } };
}
export async function callActiveAgent(appData, name, args) {
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath(appData), 'utf8')); }
  catch { throw new Error('Open Screenshot Studio to use the project shown in the app.'); }
  if (typeof state.address !== 'string' || typeof state.token !== 'string') throw new Error('Reconnect MCP from Screenshot Studio.');
  const socket = net.createConnection(state.address); socket.setTimeout(32 * 60 * 1000);
  try {
    const response = receive(socket, 32 * 1024 * 1024);
    socket.once('connect', () => socket.write(JSON.stringify({ token: state.token, name, args }) + '\n'));
    const message = await response;
    if (message.error) throw new Error(message.error);
    return message.result;
  } finally { socket.destroy(); }
}
