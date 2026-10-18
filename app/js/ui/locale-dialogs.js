// Adding, configuring and removing languages.

import { engine, state, addLocale, removeLocale, restoreLocale, saveStudio, rememberUI } from '../store.js';
import { localeCatalog, localeEntry, customLocaleEntry, isLocaleId } from '../locales.js';
import { h, toast, modal, confirmDialog, selectInput, localeLabel } from './helpers.js';

/** Pick a language from App Store Connect's list (or type its code) and add it to the project. */
export function openAddLanguage(ctx) {
  const taken = new Set(engine.project.locales.map((l) => l.id));
  const catalog = localeCatalog().filter((c) => !taken.has(c.id));
  let chosen = null;
  let prefill = ''; // empty by default: untranslated text shows English *and is flagged*, so it cannot ship unnoticed

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search languages…', style: { width: '100%' }, 'aria-label': 'Search languages' });
  const list = h('div', { class: 'lang-pick', role: 'listbox', 'aria-label': 'Languages' });
  const custom = h('input', { class: 'input', placeholder: 'e.g. fil, sw-KE, zh-HK', style: { width: '160px' }, 'aria-label': 'Other language code' });
  const addBtn = h('button', { class: 'btn primary', disabled: true }, 'Add language');
  const summary = h('div', { class: 'hint' }, 'Choose a language.');

  const setChosen = (entry) => {
    chosen = entry;
    addBtn.disabled = !entry;
    summary.textContent = entry ? `${entry.name} · ${entry.native} · ${entry.id}${entry.dir === 'rtl' ? ' · right-to-left' : ''}${entry.font ? ' · uses a script-specific system font' : ''}` : 'Choose a language.';
    for (const row of list.children) row.setAttribute('aria-selected', String(row.dataset.id === entry?.id));
  };

  function renderList() {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    const shown = catalog.filter((c) => !q || `${c.name} ${c.native} ${c.id}`.toLowerCase().includes(q));
    if (!shown.length) list.append(h('div', { class: 'hint' }, q ? 'Nothing matches. Enter the language code used by your store below.' : 'Every language in the list is already in the project.'));
    for (const c of shown) {
      list.append(h('div', { class: 'lang-pick-row', role: 'option', tabindex: 0, dataset: { id: c.id }, 'aria-selected': String(chosen?.id === c.id), onClick: () => setChosen(localeEntry(c)), onDblclick: () => { setChosen(localeEntry(c)); addBtn.click(); } },
        h('span', { class: 'name' }, c.name),
        h('span', { class: 'native', lang: c.lang, dir: c.dir }, c.native),
        h('span', { class: 'code' }, c.id),
        c.dir === 'rtl' ? h('span', { class: 'chip' }, 'RTL') : null));
    }
    for (const row of list.children) row.addEventListener?.('keydown', (e) => { if (e.key === 'Enter') row.click(); });
  }
  search.addEventListener('input', renderList);

  const useCustom = h('button', { class: 'btn small', onClick: () => {
    const id = custom.value.trim();
    if (!isLocaleId(id)) { toast('Use a store language code such as “fil” or “pt-BR”.', { error: true }); return; }
    if (taken.has(id)) { toast(`${id} is already in the project.`, { error: true }); return; }
    setChosen(customLocaleEntry(id));
  } }, 'Use this code');

  const from = selectInput({
    options: [['', 'Empty: shows English, flagged, until translated'], ...engine.project.locales.map((l) => [l.id, `Start from a copy of ${l.name}`])],
    value: prefill,
    onChange: (v) => { prefill = v; },
  });

  addBtn.addEventListener('click', async () => {
    if (!chosen) return;
    addBtn.disabled = true;
    try {
      await addLocale(chosen, { prefillFrom: prefill || null });
      state.ui.locale = chosen.id;
      rememberUI();
      m.close();
      ctx.go({});
      toast(`Added ${chosen.name}. ${prefill ? 'Its text starts as a copy: select text in Editor to edit its Details, or open Translate.' : 'It shows English (flagged) until you type its translations.'} Marked as a draft.`, { timeout: 9000 });
    } catch (err) {
      addBtn.disabled = false;
      toast(err.message, { error: true });
    }
  });

  const m = modal({
    title: 'Add a language',
    body: h('div', { class: 'settings-form' },
      search, list, summary,
      h('details', { class: 'disclosure settings-disclosure' }, h('summary', null, 'More options'),
        h('div', { class: 'disclosure-body' },
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Custom language'), h('div', { class: 'row wrap' }, custom, useCustom)),
          h('label', { class: 'field' }, 'Starting text', from),
          h('p', { class: 'hint' }, 'Use your store’s language code. New text stays draft until reviewed.')))),
    wide: true,
    actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), addBtn],
  });
  renderList();
  search.focus();
}

/** Name, direction, font and whether the app itself is translated into the language. */
export function openLanguageSettings(ctx, localeId) {
  const locale = engine.project.locales.find((l) => l.id === localeId);
  if (!locale) return;
  const name = h('input', { class: 'input', value: locale.name, style: { width: '100%' } });
  const native = h('input', { class: 'input', value: locale.native ?? '', style: { width: '100%' } });
  const lang = h('input', { class: 'input', value: locale.lang ?? locale.id, style: { width: '100%' } });
  const dir = selectInput({ options: [['ltr', 'Left to right'], ['rtl', 'Right to left (mirrors the layout)']], value: locale.dir ?? 'ltr', onChange: () => {} });
  const family = h('input', { class: 'input', value: locale.font?.family ?? '', placeholder: 'Inherited: the project font for this language', style: { width: '100%' } });
  const lineHeight = h('input', { class: 'input', type: 'number', min: 0.8, max: 2, step: 0.01, value: locale.font?.lineHeight ?? '', placeholder: 'auto', style: { width: '90px' } });
  const appUI = h('input', { type: 'checkbox', checked: Boolean(locale.appUI) });
  const save = h('button', { class: 'btn primary', onClick: () => {
    locale.name = name.value.trim() || locale.name;
    locale.native = native.value.trim() || locale.name;
    locale.lang = lang.value.trim() || locale.id;
    locale.dir = dir.value;
    locale.appUI = appUI.checked;
    const font = {};
    if (family.value.trim()) font.family = family.value.trim();
    if (lineHeight.value) font.lineHeight = Number(lineHeight.value);
    if (Object.keys(font).length) locale.font = font; else delete locale.font;
    saveStudio();
    engine.invalidate({ assets: false });
    m.close();
    ctx.go({});
  } }, 'Save');
  const m = modal({
    title: `${localeLabel(locale)} · settings`,
    body: h('div', { class: 'settings-form' },
      h('div', { class: 'settings-grid' },
        h('label', { class: 'field' }, 'Name', name),
        h('label', { class: 'field' }, 'Name in its own language', native)),
      h('label', { class: 'row check' }, appUI, 'App screenshots are translated into this language'),
      h('details', { class: 'disclosure settings-disclosure' }, h('summary', null, 'Typography and language'),
        h('div', { class: 'disclosure-body' },
          h('div', { class: 'settings-grid' },
            h('label', { class: 'field' }, 'Language tag', lang),
            h('label', { class: 'field' }, 'Direction', dir)),
          h('label', { class: 'field' }, 'Font', family),
          h('label', { class: 'field' }, 'Line height', lineHeight),
          h('p', { class: 'hint' }, 'Leave font and line height empty to use the project defaults. The language tag controls line breaking and font choice.')))),
    actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), save],
  });
}

/** Remove a language from the project, keeping its files in project/_removed/ so it can be restored. */
export async function removeLanguage(ctx, localeId) {
  const locale = engine.project.locales.find((l) => l.id === localeId);
  if (!locale) return;
  if (localeId === 'en-US') { toast('English (US) is the source language: it supplies the text any other language is missing, so it stays.', { error: true, timeout: 7000 }); return; }
  if (engine.project.locales.length <= 1) { toast('A project needs at least one language.', { error: true }); return; }
  const ok = await confirmDialog({
    title: `Remove ${locale.name}?`,
    body: h('div', { class: 'field' },
      h('p', { class: 'modal-text' }, `${locale.name} (${locale.id}) leaves the project: it disappears from the editor, the overview and exports.`),
      h('p', { class: 'modal-text' }, 'Nothing is deleted. Its text (project/copy/' + locale.id + '.json) and any screenshots made only for it move to project/_removed/, and you can restore it from the Languages view. Images already exported to export/ are not touched.')),
    confirmLabel: 'Remove language', danger: true,
  });
  if (!ok) return;
  try {
    const result = await removeLocale(localeId);
    ctx.go({});
    toast(`Removed ${locale.name}`, {
      timeout: 15000,
      action: { label: 'Undo', onClick: async () => { try { await restoreLocale(result.folder, { entry: result.entry, index: result.index }); ctx.go({}); toast(`${locale.name} is back`); } catch (err) { toast(err.message, { error: true }); } } },
    });
  } catch (err) { toast(err.message, { error: true }); }
}
