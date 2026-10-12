import { translationReviewFor } from '../translation.js';
import { copyNeedsReview, isOriginalLocale } from '../copy-review.js';
import { engine } from '../store.js';
import { h } from './helpers.js';

/** Automatic checks remain separate from the user's review decision. */
export function meaningReviewNote(locale, slideId, field) {
  const node = h('div', { dataset: { meaningReview: field }, 'aria-live': 'polite' });
  node.refreshMeaningReview = () => {
    const report = translationReviewFor(engine.data.copy, locale, slideId, field);
    node.hidden = !report || isOriginalLocale(engine.project, locale);
    if (node.hidden) { node.replaceChildren(); return; }
    const pending = copyNeedsReview(engine.data.copy[locale], slideId, field);
    const passed = report.status === 'passed';
    node.className = `hint ${passed ? 'ok' : 'warn'}`;
    const label = passed ? `Meaning check passed${report.corrected ? ' after correction' : ''}`
      : report.status === 'stale' ? 'Meaning check outdated' : pending ? 'Manual meaning check needed' : 'Meaning issue marked reviewed';
    const snapshot = engine.data.copy[locale]._meta.translationReview.find(r => r.slideId === slideId && r.field === field);
    const source = engine.data.copy[snapshot.sourceLocale]?.[slideId]?.[field];
    node.replaceChildren(h('strong', null, label),
      h('div', { class: 'ref' }, `Source (${snapshot.sourceLocale}): ${Array.isArray(source) ? source.join(' · ') : source ?? '(removed)'}`),
      ...report.issues.map(issue => h('div', null, issue)),
      passed && pending ? h('div', null, 'Automatic check only. Review the text before marking it reviewed.') : null);
  };
  node.refreshMeaningReview();
  return node;
}
