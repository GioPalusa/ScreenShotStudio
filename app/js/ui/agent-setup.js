import { h, selectInput } from './helpers.js';

/** Installation is explicit; loading the guide only reads status. */
export function agentSetupPanel({ skillFirst = false } = {}) {
  const api = window.studioDesktop?.agentSetup;
  if (!api) return h('p', { class: 'hint' }, 'Open the Screenshot Studio Mac app to install the skill and connect MCP. The downloaded app includes everything it needs.');
  const panel = h('section', { class: 'agent-setup field', 'aria-label': 'AI agent setup' });
  let client = 'codex', preview, generation = 0, busy = false;
  const select = selectInput({ value: client, options: [['codex', 'Codex'], ['claude-code', 'Claude Code']], onChange: value => { client = value; void refresh(); } });
  select.setAttribute('aria-label', 'AI client');
  const paths = h('div', { class: 'agent-setup-paths' });
  const status = h('p', { class: 'hint', role: 'status' });
  const connectionState = h('p', { class: 'hint' });
  const workspace = h('p', { class: 'path mono' }, 'Open a project in Screenshot Studio.');
  const snippet = h('pre', { class: 'agent-setup-config' });
  const buttons = [];
  const updateButtons = () => {
    for (const button of buttons) button.disabled = busy || !preview;
    select.disabled = busy;
    install.disabled = busy || !preview || preview.skillCurrent;
    connect.disabled = busy || !preview || Boolean(preview.configError);
    test.disabled = busy || !preview;
  };
  async function refresh() {
    const mine = ++generation; preview = null; updateButtons();
    try {
      const result = await api('preview', { client });
      if (mine !== generation) return;
      preview = result;
      connectionState.textContent = `${result.skillCurrent ? 'Skill ready' : 'Install the skill'} · ${result.mcpConfigured ? 'MCP configured' : 'Connect MCP'}`;
      paths.replaceChildren(h('div', null, h('strong', null, 'Skill'), h('p', { class: 'path mono' }, result.skillPath), h('span', { class: 'hint' }, result.skillCurrent ? 'Installed and up to date' : result.skillInstalled ? 'An earlier skill is installed; updating keeps a backup.' : 'Not installed')),
        h('div', null, h('strong', null, 'MCP configuration'), h('p', { class: 'path mono' }, result.configPath), h('span', { class: 'hint' }, result.configError ?? (result.mcpConfigured ? result.followsApp ? 'Configured to follow the project open in the app.' : 'Existing connection uses a fixed workspace. Update it to follow the app.' : 'Not configured'))));
      install.textContent = result.skillCurrent ? 'Skill installed' : result.skillInstalled ? 'Update skill' : 'Install skill';
      connect.textContent = result.mcpConfigured ? 'Update MCP connection' : 'Set up MCP';
      snippet.textContent = result.configuration ?? '';
      workspace.textContent = result.activeProject ? `${result.projectName ?? 'Active project'} · ${result.activeProject}` : 'No project is open. Open a .sss document in the app to start working.';
    } catch (error) { if (mine === generation) { status.textContent = error.message; status.className = 'err'; } }
    finally { if (mine === generation) updateButtons(); }
  }
  async function perform(operation) {
    if (busy || !preview) return;
    busy = true; updateButtons(); status.className = 'hint'; status.textContent = operation === 'configure' ? 'Testing the bundled MCP server before saving…' : operation === 'test' ? 'Testing the bundled MCP server…' : 'Installing the bundled skill…';
    try {
      const result = await api(operation, { client, skillRevision: preview.skillRevision, configRevision: preview.configRevision });
      status.textContent = operation === 'test' ? `MCP server works: ${result.tools} tools available.${result.project ? ` Active project: ${result.project}.` : ' Open a project in the app to edit it.'} Reload your AI client if needed.` : operation === 'configure' ? 'MCP configuration saved. Restart or reload your AI client, then confirm Screenshot Studio appears in its tools.' : 'Skill installed. Reload your AI client to discover it.';
      if (result.backup) status.textContent += ` Backup: ${result.backup}`;
      await refresh();
    } catch (error) { status.className = 'err'; status.textContent = error.message; }
    finally { busy = false; updateButtons(); }
  }
  const install = h('button', { class: 'btn', onClick: () => perform('install-skill') }, 'Install skill');
  const connect = h('button', { class: 'btn primary', onClick: () => perform('configure') }, 'Set up MCP');
  const test = h('button', { class: 'btn', onClick: () => perform('test') }, 'Test MCP');
  buttons.push(install, connect, test);
  panel.append(h('h3', null, skillFirst ? 'Install the bundled skill' : 'Set up your AI agent'),
    h('p', null, 'Choose your AI app. Everything you need is included.'),
    h('label', { class: 'field' }, 'AI client', select), connectionState,
    h('div', { class: 'row wrap' }, install, connect, test), status,
    h('details', { class: 'disclosure' }, h('summary', null, 'Connection details'), h('div', { class: 'disclosure-body' }, paths,
      h('h4', null, 'Active project'), workspace,
      h('p', { class: 'hint' }, 'The agent follows the project open in this app. Edits are saved before it reads or writes. Imports can come from your project or an adjacent inputs folder.'),
      h('p', { class: 'hint' }, 'Setup keeps backups and preserves other client settings. Keep the app in Applications; run setup again if you move it.'),
      h('details', { class: 'disclosure' }, h('summary', null, 'Connection configuration'), snippet))));
  void refresh(); return panel;
}
