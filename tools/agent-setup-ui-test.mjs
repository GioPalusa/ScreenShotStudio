import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { runBrowserTest } from './browser-test-runner.mjs';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
const root = path.resolve('.'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-agent-ui-'));
const appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Test.sss');
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let service, server;
try {
  fs.cpSync(path.join(root, 'app'), appPath, { recursive: true }); createNewProject(projectPath, {});
  fs.writeFileSync(path.join(appPath, 'agent-test.html'), '<html><head><link rel="stylesheet" href="/app/css/studio.css"></head><body><pre id="result">PENDING</pre><script type="module" src="/app/agent-test.js"></script></body></html>');
  fs.writeFileSync(path.join(appPath, 'agent-test.js'), `
  import { openGetStarted } from '/app/js/ui/get-started.js';
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
  const wait=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('UI timed out');};
  const calls=[];let installed=false,configured=false,hold=false,release;
  window.studioDesktop={agentSetup:async(op,value)=>{
    calls.push({op,value});
    if(op==='preview')return {skillPath:'/home/.agents/skills/screenshot-studio',configPath:'/home/.codex/config.toml',skillInstalled:installed,skillCurrent:installed,mcpConfigured:configured,skillRevision:installed?'skill-hash':'missing',configRevision:configured?'config-hash':'missing',activeProject:'/Screenshots/Current.sss',projectName:'Current',configuration:'[mcp_servers.screenshot-studio]'};
    if(op==='install-skill'){installed=true;return {path:'/skill'};}
    if(op==='test')return {tools:8,mode:'active-app',project:'/Screenshots/Current.sss'};
    if(op==='configure'){if(hold)await new Promise(r=>release=r);configured=true;return {path:'/config',backup:'/backup'};}
  }};
  try{
    openGetStarted('mcp');await wait(()=>button('Install skill')&&!button('Install skill').disabled);
    check(calls.every(c=>c.op==='preview'),'Opening help only reads status');
    check(!button('Set up MCP').disabled&&!button('Test MCP').disabled,'App connection needs no separate workspace');
    check(!button('Choose workspace…'),'Fixed workspace picker is removed');
    check(document.querySelector('.agent-setup').textContent.includes('/Screenshots/Current.sss'),'Setup identifies the project shown in the app');
    button('Install skill').click();await wait(()=>button('Skill installed'));
    check(calls.find(c=>c.op==='install-skill').value.skillRevision==='missing','Skill install uses the displayed revision');
    check(button('Skill installed').disabled,'Current skill cannot be installed repeatedly');
    check(document.querySelector('.agent-setup-config').textContent.includes('mcp_servers'),'Connection preview follows the app');
    button('Install the skill').click();check(!button('Set up MCP').disabled,'Help pages preserve app connection');
    button('Test MCP').click();await wait(()=>document.querySelector('[role=status]').textContent.includes('8 tools'));
    check(!calls.some(c=>c.op==='configure'),'Test does not write the client config');
    hold=true;button('Set up MCP').click();await wait(()=>release);
    check(button('Set up MCP').disabled&&document.querySelector('[aria-label="AI client"]').disabled,'Setup prevents overlapping writes');
    release();await wait(()=>button('Update MCP connection')&&!button('Update MCP connection').disabled);
    const saved=calls.find(c=>c.op==='configure').value;
    check(!('workspaceToken' in saved)&&saved.configRevision==='missing','Setup uses the app connection and current config revision');
    check(document.querySelector('[role=status]').textContent.includes('Restart or reload'),'Saved configuration is not presented as a connected conversation');
    check(document.querySelector('[role=status]').textContent.includes('/backup'),'Backup location is reported');
    const select=document.querySelector('[aria-label="AI client"]');select.value='claude-code';select.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(()=>calls.some(c=>c.op==='preview'&&c.value.client==='claude-code'));
    document.querySelector('#result').textContent='PASS: explicit skill/MCP actions, read-only opening, active project display, no fixed workspace, revision checks, page persistence, duplicate/busy protection, test without config writes, backup and honest reconnect status';
  }catch(e){document.querySelector('#result').textContent='FAIL: '+e.stack;}
  `);
  service = createStudioService({ appPath, projectPath, exportPath: path.join(projectPath, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { stdout } = await runBrowserTest(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-sandbox', `--user-data-dir=${path.join(temp, 'chrome')}`, '--window-size=1100,900', `http://127.0.0.1:${server.address().port}/app/agent-test.html`]);
  const verdict = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]; assert.match(verdict, /^PASS:/, verdict); console.log(verdict);
} finally { server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); service?.close(); fs.rmSync(temp, { recursive: true, force: true }); }
