import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { createAgentSetup, configureCodex } from '../desktop/agent-setup.mjs';
import { revision } from '../host/files.mjs';

const ROOT = path.resolve('.');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-agent-setup-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const workspace = path.join(home, 'My screenshots'); fs.mkdirSync(workspace);
  const setup = createAgentSetup({ root: ROOT, home, executable: '/Applications/Screenshot Studio.app/Contents/MacOS/Screenshot Studio', packaged: true });
  return { home, workspace, setup };
}
test('Codex setup preserves unrelated settings and comments, handles quoted tables and retains backups', t => {
  const { home, workspace, setup } = fixture(t), dir = path.join(home, '.codex'); fs.mkdirSync(dir);
  const file = path.join(dir, 'config.toml');
  const original = '# my configuration\nmodel = "existing"\n[projects."/my/project"]\ntrust_level = "trusted"\n[mcp_servers.other]\ncommand = "other-tool"\n# keep this comment\n';
  fs.writeFileSync(file, original);
  const preview = setup.preview('codex', workspace);
  assert.equal(preview.skillInstalled, false); assert.equal(preview.mcpConfigured, false);
  assert.equal(preview.skillPath, path.join(home, '.agents/skills/screenshot-studio'));
  const result = setup.configure('codex', preview.configRevision);
  const text = fs.readFileSync(file, 'utf8'), parsed = parse(text);
  assert.ok(text.startsWith(original.trimEnd())); assert.equal(parsed.model, 'existing'); assert.equal(parsed.mcp_servers.other.command, 'other-tool');
  assert.deepEqual(parsed.mcp_servers['screenshot-studio'].args, ['--screenshot-studio-mcp', '--active-app', '--app-data', path.join(home, 'Library', 'Application Support', 'Screenshot Studio')]);
  assert.equal(parsed.mcp_servers['screenshot-studio'].command, '/Applications/Screenshot Studio.app/Contents/MacOS/Screenshot Studio');
  assert.equal(fs.readFileSync(result.backup, 'utf8'), original); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const refreshed = setup.preview('codex', workspace); assert.equal(refreshed.mcpConfigured, true);
  setup.configure('codex', refreshed.configRevision);
  assert.equal(Object.keys(parse(fs.readFileSync(file, 'utf8')).mcp_servers).length, 2);
  const quoted = configureCodex('[mcp_servers."screenshot-studio"]\ncommand="old"\n[mcp_servers.other]\ncommand="keep"\n', { command: 'new', args: ['space in path'] });
  assert.equal(parse(quoted).mcp_servers.other.command, 'keep'); assert.equal(parse(quoted).mcp_servers['screenshot-studio'].command, 'new');
});
test('conflicts, malformed configs and unsupported inline layouts keep original bytes', t => {
  const { setup, workspace, home } = fixture(t);
  const preview = setup.preview('codex'); fs.mkdirSync(path.dirname(preview.configPath), { recursive: true });
  fs.writeFileSync(preview.configPath, '# changed\n');
  assert.throws(() => setup.configure('codex', preview.configRevision), /changed/);
  fs.writeFileSync(preview.configPath, '[broken');
  const invalid = setup.preview('codex'); assert.ok(invalid.configError);
  assert.throws(() => setup.configure('codex', invalid.configRevision)); assert.equal(fs.readFileSync(preview.configPath, 'utf8'), '[broken');
  assert.throws(() => configureCodex('mcp_servers = { screenshot-studio = { command="old" } }', { command: 'new', args: [] }), /inline/);
  assert.throws(() => setup.preview('../escape'), /supported/);
  const link = path.join(home, '.claude.json'); fs.symlinkSync(preview.configPath, link);
  assert.throws(() => setup.preview('claude-code'), /symbolic link/);
});
test('Claude Code gets a stdio server without touching other servers or preferences', t => {
  const { home, workspace, setup } = fixture(t), file = path.join(home, '.claude.json');
  const existing = { theme: 'dark', projects: { local: { keep: true } }, mcpServers: { other: { command: 'other' } } };
  fs.writeFileSync(file, JSON.stringify(existing));
  const preview = setup.preview('claude-code', workspace);
  const installed = setup.configure('claude-code', preview.configRevision);
  const value = JSON.parse(fs.readFileSync(file));
  assert.equal(value.theme, 'dark'); assert.deepEqual(value.projects, existing.projects); assert.deepEqual(value.mcpServers.other, existing.mcpServers.other);
  assert.equal(value.mcpServers['screenshot-studio'].type, 'stdio'); assert.ok(fs.existsSync(installed.backup));
});
test('skill installation copies the bundled references, is idempotent and backs up user edits outside discovery', t => {
  const { setup } = fixture(t);
  for (const client of ['codex', 'claude-code']) {
    const before = setup.preview(client), installed = setup.installSkill(client, before.skillRevision);
    assert.ok(fs.existsSync(path.join(installed.path, 'references/editing.md')));
    assert.ok(fs.existsSync(path.join(installed.path, 'references/store-images.md')));
    const after = setup.preview(client); assert.equal(after.skillCurrent, true);
    assert.equal(setup.installSkill(client, after.skillRevision).unchanged, true);
    fs.appendFileSync(path.join(installed.path, 'SKILL.md'), '\nMy local edit\n');
    assert.throws(() => setup.installSkill(client, after.skillRevision), /changed/);
    const edited = setup.preview(client), updated = setup.installSkill(client, edited.skillRevision);
    assert.match(fs.readFileSync(path.join(updated.backup, 'SKILL.md'), 'utf8'), /My local edit/);
    assert.ok(!updated.backup.startsWith(path.dirname(installed.path) + path.sep));
    assert.equal(setup.preview(client).skillCurrent, true);
  }
});
