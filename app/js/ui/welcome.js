import { h, selectInput } from './helpers.js';
import { icon } from './icons.js';
import { appearanceControl } from './appearance-control.js';
import { productMark } from './brand.js';
import { creatorCredit } from './brand.js';
import { WELCOME_PALETTES } from '../onboarding.js';
import { TARGET_OPTIONS } from '../export-targets.js';
import { guideContent, openGetStarted } from './get-started.js';
import { openSavedUpload } from './uploads.js';
let palette = structuredClone(WELCOME_PALETTES[0]);
const desktop = window.studioDesktop;
const root = document.getElementById('root');
const preview = h('div', { class: 'welcome-preview', 'aria-label': 'Live palette preview' });
const choices = h('div', { class: 'welcome-palettes' });
const error = h('p', { class: 'welcome-error', role: 'alert' });
const name = h('input', { class: 'input', value: 'My app', maxlength: 80, 'aria-label': 'Project name' });
const paletteName = h('input', { class: 'input', value: palette.name, maxlength: 60, 'aria-label': 'Palette name', onInput: e => { palette.name = e.target.value; } });
const target = selectInput({ options: TARGET_OPTIONS.filter(o => o.group), value: 'iphone' }); target.setAttribute('aria-label', 'Store destination');
const colors = h('div', { class: 'welcome-colors' });
function update() {
  preview.style.setProperty('--preview-bg', palette.bg); preview.style.setProperty('--preview-ink', palette.ink); preview.style.setProperty('--preview-accent', palette.swatches[0]);
  paletteName.value = palette.name;
  choices.replaceChildren(...WELCOME_PALETTES.map(p => h('button', { class: 'palette-choice', 'aria-pressed': String(p.name === palette.name), onClick: () => { palette = structuredClone(p); update(); } }, h('span', { class: 'palette-swatches', 'aria-hidden': 'true' }, [p.bg, p.ink, p.swatches[0]].map(c => h('i', { style: { background: c } }))), h('span', null, p.name))));
  colors.replaceChildren(...[['Background','bg'],['Text','ink'],['Accent','accent']].map(([label,key]) => h('label', null, h('input', { type: 'color', value: key === 'accent' ? palette.swatches[0] : palette[key], 'aria-label': `${label} colour`, onInput: e => { if (key === 'accent') palette.swatches[0] = e.target.value; else palette[key] = e.target.value; preview.style.setProperty(`--preview-${key === 'bg' ? 'bg' : key === 'ink' ? 'ink' : 'accent'}`, e.target.value); choices.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed','false')); } }), h('span', null, label))));
}
preview.append(h('span', { class: 'welcome-preview-label' }, 'YOUR FIRST DESIGN'), h('h2', null, 'Your app.', h('br'), 'Your story.'), h('div', { class: 'welcome-phone', 'aria-hidden': 'true' }, h('i'), h('div', { class: 'welcome-phone-art' }, h('span'), h('span'), h('span'))), h('p', null, 'A palette that feels like you.'));
const recent = h('section', { class: 'welcome-recent', 'aria-label': 'Recent projects' });
const create = h('button', { class: 'btn primary welcome-create', onClick: async () => {
  error.textContent = '';
  const projectName = name.value.trim();
  if (!projectName || /[\/]/.test(projectName)) { error.textContent = 'Give your project a name without slashes.'; name.focus(); return; }
  create.disabled = true;
  try { const result = await desktop.createProject({ name: projectName, target: target.value, palette }); if (result?.error) error.textContent = result.error; }
  catch(e) { error.textContent = e.message; }
  finally { create.disabled = false; }
} }, 'Create project…');
root.append(h('main', { class: 'welcome' }, h('header', { class: 'welcome-header' }, h('strong', null, productMark({ large: true }), 'Screenshot Studio'), creatorCredit(), appearanceControl(), h('button', { class: 'btn guide-button', title: 'Guides, MCP connection and skills', onClick: openGetStarted }, icon('book'), 'Guide & MCP')), h('div', { class: 'welcome-grid' }, h('section', { class: 'welcome-setup' }, h('p', { class: 'welcome-eyebrow' }, 'A fresh canvas for your next idea'), h('h1', null, 'Make it yours.'), h('p', { class: 'welcome-intro' }, 'Choose your colours. Bring your screenshots. Build a design in your own style.'), h('label', { class: 'field' }, 'Project name', name), h('label', { class: 'field' }, 'Store destination', target), h('fieldset', null, h('legend', null, 'Start with a palette'), choices, h('details', { class: 'disclosure welcome-customize' }, h('summary', null, 'Customise colours'), colors, h('label', { class: 'field' }, 'Palette name', paletteName))), error, h('div', { class: 'row wrap' }, create, h('button', { class: 'btn', onClick: () => desktop.action('open') }, 'Open existing project…')), h('p', { class: 'hint' }, 'Saved as a portable .sss project. Your work stays on your Mac.'), recent), preview), h('details', { class: 'welcome-guide' }, h('summary', null, 'From your first screenshot to export'), guideContent())));
desktop?.onFlush(async () => {});
document.querySelector('.welcome-header').append(h('button', { class: 'btn', onClick: openSavedUpload }, 'Upload screenshots…'));
desktop?.onCommand(command => { if (command === 'guide') openGetStarted(); if (command === 'guide:mcp') openGetStarted('mcp'); if (command === 'upload' && !document.querySelector('.modal-backdrop')) openSavedUpload(); });
update();

desktop?.recentProjects().then(projects => {
  if (!projects.length) return;
  recent.append(h('h2', null, 'Recent projects'), ...projects.slice(0, 3).map(p => h('button', { class: 'btn', title: p.path, onClick: () => desktop.action(`recent:${p.path}`) }, p.name)));
}).catch(e => { error.textContent = e.message; });
