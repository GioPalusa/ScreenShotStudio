import { agentSetupPanel } from './agent-setup.js';
import { SHORTCUTS } from '../shortcuts.js';
import { GET_STARTED } from '../onboarding.js';
import { h, modal, toast } from './helpers.js';
import { icon } from './icons.js';
const steps = items => h('ol', { class: 'getting-started guide-steps' }, items.map(([title, body, symbol = 'square.stack.3d.up'], index) =>
  h('li', null, h('span', { class: 'guide-pictogram' }, icon(symbol)), h('div', null, h('strong', null, h('span', { class: 'guide-step-number' }, `${index + 1}. `), title), h('p', null, body)))));
const more = (title, ...body) => h('details', { class: 'disclosure guide-more' }, h('summary', null, title), h('div', { class: 'disclosure-body' }, ...body));
export function guideContent() {
  return steps(GET_STARTED);
}
const code = text => h('div', { class: 'guide-code' }, h('pre', null, text), h('button', { class: 'btn small', onClick: async () => {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select and copy the text above.'); }
} }, 'Copy'));


export function openGetStarted(initial = 'start') {
  if (document.querySelector('.modal-backdrop')) return;
  let setupPanel;
  const setup = () => setupPanel ??= agentSetupPanel();
  const pages = [
    ['start', 'Get started', () => h('div', null, h('p', { class: 'hint' }, 'Your projects stay on your Mac. Autosave keeps edits safe; ⌘Z undoes a change.'), guideContent(),
      more('Projects, frames and store images',
        h('h3', null, 'Your portable project'), h('p', null, 'Screenshots, artwork and exports stay in your .sss project. Earlier exports are available in Export and Upload.'),
        h('h3', null, 'Device frames'), h('p', null, 'Select a device, then choose a frame in Screenshot → Frame. Import downloaded frames in Setup → Frames.'),
        h('h3', null, 'Store images'), h('p', null, 'Add screens → Store images creates an App Store Search result image and Header image, or a Google Play feature graphic.')))],
    ['mcp', 'Connect MCP', () => h('div', null, setup(),
      steps([['Connect', 'Choose your AI app and set up the connection.', 'square.on.square'], ['Restart your AI app', 'Look for Screenshot Studio in its tools.', 'arrow.uturn.forward'], ['Start creating', 'Keep Screenshot Studio open on the project you want to edit.', 'textformat']]),
      more('Tool details', h('p', null, 'Ask the agent to call read_project to read your open project, catalog to see available formats, and add_store_images to add store artwork. The connection needs no API key. Uploads happen in the Mac app.')))],
    ['skills', 'Install the skill', () => h('div', null, setup(),
      h('p', null, 'Install the skill, then restart your AI app. It teaches the agent how to create editable screenshots.'),
      h('h3', null, 'Try a first request'), code('Use the Screenshot Studio skill and MCP to create four editable App Store screenshots for my app. Read captures from inputs/ in the configured workspace. Start with the main benefit, keep copy short, and show me a draft before final export.'),
      more('Installation details', h('p', null, 'Codex reads ~/.agents/skills; Claude Code reads ~/.claude/skills. AI translations stay draft until you review them.')))],
    ['shortcuts', 'Keyboard shortcuts', () => h('div', { class: 'shortcut-grid' }, SHORTCUTS.map(([group, items]) => h('section', null, h('h3', null, group), h('dl', null, items.map(([key, label]) => h('div', { class: 'shortcut-row' }, h('dt', null, label), h('dd', null, h('kbd', null, key))))))))],
    ['ideas', 'What you can do', () => h('div', null, h('h3', null, 'From captures to editable designs'), steps([
      ['Tell a story', 'Give the agent your app’s main benefits and real screenshots.', 'rectangle.3.group'],
      ['Reach more people', 'Add languages and store sizes to the same project.', 'globe'],
      ['Add artwork', 'Generate an image and import it as an editable layer.', 'photo'],
      ['Preview and refine', 'Check one screen before exporting the full set.', 'eye'],
      ['Finish in the app', 'Fine-tune your design, review text and upload.', 'square.and.arrow.up'],
    ]), more('Example prompts', code('Read my open project. Add an App Store Header image and Search result image. Keep the artwork and copy editable, then show me a preview.'),
      code('Preview the first screen in English and Swedish. Check text and screenshot framing. Keep Swedish as draft for my review.')))],
  ];
  const body = h('div', { class: 'guide-page' });
  const nav = h('nav', { class: 'row wrap guide-nav', 'aria-label': 'Guide pages' });
  const show = id => {
    const page = pages.find(p => p[0] === id) ?? pages[0];
    for (const button of nav.children) button.setAttribute('aria-pressed', String(button.dataset.page === page[0]));
    body.replaceChildren(page[2]()); body.scrollTop = 0;
  };
  for (const [id, label] of pages) nav.append(h('button', { class: 'btn small', dataset: { page: id }, onClick: () => show(id) }, label));
  modal({ title: 'Screenshot Studio guide', wide: true, body: h('div', null, nav, body), actions: [] }); show(typeof initial === 'string' ? initial : 'start');
}
