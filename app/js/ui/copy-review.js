import { engine, state, prepareReviewExport, importReviewedCopy, flushSaves } from '../store.js';
import { exportReviewCSV, parseReviewCSV, planReviewImport } from '../review-exchange.js';
import { h, modal, toast, localeLabel } from './helpers.js';

export function openCopyReview(ctx) {
  const language = h('select', { class: 'input', 'aria-label': 'Review file languages' },
    h('option', { value: '*', selected: true }, 'All languages'),
    engine.project.locales.map(locale => h('option', { value: locale.id }, localeLabel(locale))));
  const result = h('div', { class: 'hint', role: 'status' });
  const exportButton = h('button', { class: 'btn primary', onClick: async () => {
    exportButton.disabled = true;
    try {
      await prepareReviewExport();
      const text = exportReviewCSV(engine.project, engine.data.copy, language.value === '*' ? undefined : [language.value]);
      const name = `${(state.projectName ?? 'Screenshot Studio').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80)}-review-${language.value === '*' ? 'all' : language.value}.csv`;
      if (window.studioDesktop?.saveReview) {
        const saved = await window.studioDesktop.saveReview({ name, text });
        if (!saved) return;
        result.textContent = 'Review file saved.';
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
        const a = h('a', { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        result.textContent = 'Review file downloaded.';
      }
    } catch (error) { result.className = 'hint err'; result.textContent = error.message; }
    finally { exportButton.disabled = false; }
  } }, 'Export CSV…');
  const picker = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onChange: async () => {
    const file = picker.files?.[0]; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a CSV smaller than 20 MB.');
      const rows = parseReviewCSV(await file.text());
      const plan = planReviewImport(engine.project, engine.data.copy, rows);
      openImportPreview(ctx, rows, plan, file.name, () => dialog.close());
    } catch (error) { result.className = 'hint err'; result.textContent = error.message; }
    finally { picker.value = ''; }
  } });
  const dialog = modal({ title: 'Text review files', body: h('div', { class: 'field review-files' },
    h('p', null, 'Send text to a reviewer and bring their changes back into this project.'),
    h('div', { class: 'review-section' }, h('h4', null, 'Export'), h('div', { class: 'row wrap' }, language, exportButton),
      h('div', { class: 'hint' }, 'Includes every screen, English reference text and the current Check status.')),
    h('div', { class: 'review-section' }, h('h4', null, 'For the reviewer'),
      h('ol', null,
        h('li', null, 'Open the UTF-8 CSV in Numbers, Excel or another spreadsheet app.'),
        h('li', null, 'Edit the text column. Bullet lists use one line per bullet; json-list rows keep their JSON array.'),
        h('li', null, 'In decision, enter reviewed after checking the text, or check if it needs more work. Leave blank to make no review decision.'),
        h('li', null, 'Keep IDs and the original/source columns unchanged. Save or export as UTF-8 CSV.'))),
    h('div', { class: 'review-section' }, h('h4', null, 'Import'),
      h('button', { class: 'btn', onClick: () => picker.click() }, 'Choose reviewed CSV…'), picker,
      h('div', { class: 'hint' }, 'Preview changes before applying. New screens stay untouched; deleted screens are skipped. Conflicts and cleared text require an explicit choice.')),
    result) });
  return dialog;
}

const showValue = value => value === null ? 'No text · uses English fallback' : Array.isArray(value) ? value.map(v => `• ${v}`).join('\n') : value;
function openImportPreview(ctx, rows, plan, filename, imported) {
  const selected = new Set(plan.filter(row => row.status === 'ready' && !row.deletion).map(row => row.key));
  const actionable = plan.filter(row => ['ready', 'conflict'].includes(row.status));
  const conflicts = plan.filter(row => row.status === 'conflict').length;
  const skipped = plan.filter(row => row.status === 'skipped');
  const unchanged = plan.filter(row => row.status === 'unchanged').length;
  const summary = h('div', { class: 'banner' }, `${actionable.length} changes · ${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'} · ${skipped.length} skipped · ${unchanged} unchanged`);
  const status = h('div', { class: 'hint', role: 'status' });
  const apply = h('button', { class: 'btn primary', onClick: async () => {
    apply.disabled = true;
    try {
      const choices = actionable.filter(row => selected.has(row.key));
      importReviewedCopy(rows, choices);
      // Mutation has succeeded. Do not permit a second import while a failed save is retried.
      dialog.close(); imported(); ctx.go({});
      try { await flushSaves(); toast(`Imported ${choices.length} reviewed text ${choices.length === 1 ? 'entry' : 'entries'}`); }
      catch (error) { toast(`Review changes are in the editor but are not saved: ${error.message}. Use Retry to save them.`, { error: true, timeout: 0 }); }
    } catch (error) { status.textContent = error.message; status.className = 'hint err'; updateCount(); }
  } });
  const updateCount = () => { apply.textContent = `Apply ${selected.size} ${selected.size === 1 ? 'change' : 'changes'}`; apply.disabled = !selected.size; };
  updateCount();
  const body = h('div', { class: 'review-import' }, h('div', { class: 'hint' }, filename), summary,
    h('div', { class: 'hint' }, 'Selected rows replace the text and review status shown below. Conflicts are unchecked; select one only if the file should replace the current version. You can undo the import with ⌘Z.'));
  for (const row of actionable) {
    const check = h('input', { type: 'checkbox', checked: selected.has(row.key), 'aria-label': `Import ${row.language} ${row.screenName} ${row.field}`, onChange: () => { if (check.checked) selected.add(row.key); else selected.delete(row.key); updateCount(); } });
    body.append(h('section', { class: `review-change${row.status === 'conflict' ? ' conflict' : ''}` },
      h('label', { class: 'row check' }, check, h('b', null, `${row.screenName} · ${row.language} · ${row.field}`), h('span', { class: 'chip' }, row.status === 'conflict' ? 'Conflict' : row.deletion ? 'Clear text' : 'Change')),
      row.reason ? h('div', { class: 'hint warn' }, row.reason) : null,
      h('div', { class: 'review-comparison' },
        h('div', null, h('small', null, `Current · ${row.currentCheck ? 'Check' : 'Reviewed'}`), h('pre', null, showValue(row.current))),
        h('div', null, h('small', null, `From file · ${row.pending ? 'Check' : 'Reviewed'}`), h('pre', null, showValue(row.incoming)))),
      row.reason?.includes('English source') ? h('div', { class: 'hint' }, `Current English: ${showValue(row.currentSource)}`) : null));
  }
  if (skipped.length) body.append(h('details', null, h('summary', null, `${skipped.length} skipped entries`), skipped.map(row => h('div', { class: 'hint' }, `${row.screen_name} · ${row.language} · ${row.field}: ${row.reason}`))));
  if (!actionable.length) body.append(h('p', null, 'There are no changes to apply.'));
  body.append(status);
  const dialog = modal({ title: 'Review import', wide: true, body, actions: [h('button', { class: 'btn', onClick: () => dialog.close() }, 'Cancel'), apply] });
}
