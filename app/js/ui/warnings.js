import { h, modal } from './helpers.js';

export const visibleWarnings = report => report.warnings.filter(w => w.level !== 'info');

export function warningList(issues) {
  return h('ul', { class: 'warning-list' }, issues.map(issue =>
    h('li', { class: issue.level === 'error' ? 'err' : 'warn' },
      h('span', { class: 'warning-mark', 'aria-label': issue.level === 'error' ? 'Error' : 'Warning' }, '⚠'),
      h('span', null, issue.message))));
}

export function warningButton({ issues, name, context, onOverview }) {
  const count = `${issues.length} warning${issues.length === 1 ? '' : 's'}`;
  const button = h('button', {
    type: 'button', class: `chip warning-button ${issues.some(w => w.level === 'error') ? 'err' : 'warn'}`,
    title: `Show ${count} for this screen`, 'aria-label': `Show ${count} for ${name}`, 'aria-haspopup': 'dialog',
    onClick: () => {
      const body = h('div', { class: 'screen-warnings' }, h('p', { class: 'hint' }, `${name} · ${context}`), warningList(issues));
      const overview = h('button', { class: 'btn', onClick: () => { dialog.close(); onOverview(); } }, 'View in Overview');
      const dialog = modal({ title: 'Screen warnings', body, actions: onOverview ? [overview] : [], onClose: () => { if (button.isConnected) button.focus(); } });
      dialog.el.querySelector('[aria-label="Close"]').focus();
    },
  }, h('span', { 'aria-hidden': 'true' }, '⚠'), h('span', { 'aria-hidden': 'true' }, String(issues.length)));
  return button;
}
