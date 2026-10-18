import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, stringify } from 'smol-toml';
import { atomicWrite, revision } from '../host/files.mjs';

export const AGENT_CLIENTS = [
  { id: 'codex', label: 'Codex' }, { id: 'claude-code', label: 'Claude Code' },
];
const SERVER = 'screenshot-studio';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Preserve unrelated TOML byte-for-byte, including comments and table ordering. */
export function configureCodex(source, connection) {
  const before = parse(source), existing = before.mcp_servers?.[SERVER];
  if (existing && !object(existing)) throw new Error('The existing Screenshot Studio MCP entry is invalid.');
  const next = { ...existing, ...connection, startup_timeout_sec: 60, tool_timeout_sec: 1860 };
  delete next.url; // A stdio connection replaces a previous HTTP connection for this server only.
  let skipping = false, removed = false;
  const kept = [];
  for (const line of source.split('\n')) {
    if (/^\s*\[/.test(line)) {
      try {
        const header = parse(`${line}\n__studio_header = true\n`);
        skipping = Object.hasOwn(header.mcp_servers ?? {}, SERVER);
        if (skipping) removed = true;
      } catch { /* Data such as a line in a multiline string; validate the whole result below. */ }
    }
    if (!skipping) kept.push(line);
  }
  if (existing && !removed) throw new Error('This config uses an inline Screenshot Studio entry. Use the shown configuration to update that entry; the original file was kept.');
  const result = `${kept.join('\n').trimEnd()}\n\n${stringify({ mcp_servers: { [SERVER]: next } })}`;
  const after = parse(result);
  const other = value => { const clone = structuredClone(value); if (clone.mcp_servers) { delete clone.mcp_servers[SERVER]; if (!Object.keys(clone.mcp_servers).length) delete clone.mcp_servers; } return clone; };
  if (!equal(other(before), other(after))) throw new Error('Could not preserve all unrelated Codex settings. The original file was kept.');
  return result;
}

function treeHash(directory) {
  if (!fs.existsSync(directory)) return 'missing';
  const hash = crypto.createHash('sha256');
  const walk = (dir, prefix = '') => {
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('A linked skill is kept as-is. Manage it through its original location.');
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), rel = `${prefix}${name}`, stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Skill files must be ordinary local files.');
      if (stat.isDirectory()) walk(file, `${rel}/`);
      else if (stat.isFile()) hash.update(rel).update('\0').update(fs.readFileSync(file)).update('\0');
    }
  };
  walk(directory); return hash.digest('hex');
}

export function createAgentSetup({ root, home, codexHome = path.join(home, '.codex'), executable, packaged, appData = path.join(home, 'Library', 'Application Support', 'Screenshot Studio') }) {
  const source = path.join(root, 'skills', SERVER);
  const paths = id => {
    if (id === 'codex') return { configPath: path.join(codexHome, 'config.toml'), skillPath: path.join(home, '.agents', 'skills', SERVER), configRoot: codexHome };
    if (id === 'claude-code') return { configPath: path.join(home, '.claude.json'), skillPath: path.join(home, '.claude', 'skills', SERVER), configRoot: home };
    throw new Error('Choose a supported AI client.');
  };
  const read = file => {
    if (!fs.existsSync(file)) return '';
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('The client config is a symbolic link. Its original file was kept.');
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('The client config is too large to update automatically.');
    return fs.readFileSync(file, 'utf8');
  };
  const connection = () => ({ command: executable, args: [...(packaged ? [] : [root]), '--screenshot-studio-mcp', '--active-app', '--app-data', appData] });
  const decode = (id, text) => id === 'codex' ? parse(text) : text ? JSON.parse(text) : {};
  function preview(id) {
    const p = paths(id), text = read(p.configPath);
    let configured = false, followsApp = false, configError;
    try { const data = decode(id, text); const entry = (id === 'codex' ? data.mcp_servers : data.mcpServers)?.[SERVER]; configured = Boolean(entry); followsApp = Boolean(entry?.args?.includes('--active-app')); }
    catch { configError = 'The existing client configuration could not be parsed. It will not be changed.'; }
    const skillRevision = treeHash(p.skillPath), bundledRevision = treeHash(source);
    if (bundledRevision === 'missing') throw new Error('The bundled skill is missing. Reinstall Screenshot Studio.');
    return { ...p, configRevision: revision(p.configPath), skillRevision, skillInstalled: skillRevision !== 'missing', skillCurrent: skillRevision === bundledRevision,
      mcpConfigured: configured, followsApp, configError, mode: 'active-app',
      configuration: id === 'codex' ? stringify({ mcp_servers: { [SERVER]: { ...connection(), startup_timeout_sec: 60, tool_timeout_sec: 1860 } } }) : JSON.stringify({ mcpServers: { [SERVER]: { type: 'stdio', ...connection() } } }, null, 2) };
  }
  function installSkill(id, expected) {
    const { skillPath } = paths(id);
    if (treeHash(skillPath) !== expected) throw new Error('The installed skill changed. Refresh before installing.');
    if (expected === treeHash(source)) return { path: skillPath, unchanged: true };
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    const staging = fs.mkdtempSync(path.join(path.dirname(skillPath), '.studio-skill-'));
    let backup = null;
    try {
      fs.cpSync(source, staging, { recursive: true, filter: file => { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Bundled skill files must be local.'); return true; } });
      if (treeHash(skillPath) !== expected) throw new Error('The installed skill changed. Refresh before installing.');
      if (expected !== 'missing') {
        // Keep backups outside skill discovery so old SKILL.md files do not become duplicate skills.
        const backupRoot = path.join(home, 'Library', 'Application Support', 'Screenshot Studio', 'agent-backups');
        fs.mkdirSync(backupRoot, { recursive: true });
        backup = path.join(backupRoot, `skill-${id}-${crypto.randomUUID()}`);
        fs.renameSync(skillPath, backup);
      }
      try { fs.renameSync(staging, skillPath); }
      catch (error) { if (backup) fs.renameSync(backup, skillPath); throw error; }
      return { path: skillPath, backup };
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
  function configure(id, expected) {
    const p = paths(id), text = read(p.configPath);
    if (revision(p.configPath) !== expected) throw new Error('The client configuration changed. Refresh before connecting.');
    const entry = connection();
    let result;
    if (id === 'codex') result = configureCodex(text, entry);
    else {
      const data = decode(id, text);
      if (!object(data) || data.mcpServers !== undefined && !object(data.mcpServers)) throw new Error('The existing client configuration is invalid.');
      data.mcpServers ??= {};
      data.mcpServers[SERVER] = { ...data.mcpServers[SERVER], type: 'stdio', ...entry };
      delete data.mcpServers[SERVER].url;
      result = JSON.stringify(data, null, 2) + '\n';
    }
    let backup = null;
    if (text) { backup = `${p.configPath}.studio-backup-${crypto.randomUUID()}`; atomicWrite(backup, text, { mode: 0o600 }); }
    atomicWrite(p.configPath, result, { expected, mode: 0o600 });
    return { path: p.configPath, backup, mode: 'active-app', ...entry };
  }
  return { preview, installSkill, configure, connection };
}
