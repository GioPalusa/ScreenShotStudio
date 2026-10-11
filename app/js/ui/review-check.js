import { needsReview, setTextCheck } from '../store.js';
import { h } from './helpers.js';

export function checkControl(locale, slide, field, changed = () => {}) {
  const button = h('button', { type: 'button', class: 'check-chip', dataset: { check: field }, 'aria-label': `Check ${field}`, onClick: e => {
    e.preventDefault(); e.stopPropagation();
    setTextCheck(locale, slide, field, !needsReview(locale, slide, field));
    button.refreshCheck(); changed();
  } });
  button.refreshCheck = () => {
    const pending = needsReview(locale, slide, field);
    button.setAttribute('aria-pressed', String(pending));
    button.title = pending ? 'Needs review. Click after checking this text to mark it reviewed.' : 'Reviewed. Click to flag this text for another check.';
    button.textContent = pending ? '⚑ Check' : '✓ Reviewed';
  };
  button.refreshCheck();
  return button;
}
