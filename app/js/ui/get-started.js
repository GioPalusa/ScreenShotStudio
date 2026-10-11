import { GET_STARTED } from '../onboarding.js';
import { h, modal } from './helpers.js';
export function guideContent() {
  return h('ol', { class: 'getting-started' }, GET_STARTED.map(([title, body]) => h('li', null, h('strong', null, title), h('p', null, body))));
}
export function openGetStarted() {
  if (document.querySelector('.modal-backdrop')) return;
  modal({ title: 'Get started with Screenshot Studio', body: h('div', null, h('p', { class: 'hint' }, 'Your projects stay on your Mac. Autosave keeps edits safe; ⌘Z undoes a change.'), guideContent()), actions: [] });
}
