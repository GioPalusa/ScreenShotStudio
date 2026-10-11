import { engine, state, api, applyTranslation, flushSaves } from '../store.js';
import { translationPlan, translationBatches, TRANSLATION_MODELS } from '../translation.js';
import { h, modal, selectInput, toast } from './helpers.js';
import { openAddLanguage } from './locale-dialogs.js';

export function translateIcon() {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', 'M3 5h12M9 3v2M5 8c1.5 4 4 6.5 8 8M13 5c-.7 6-4 10-10 13M13 21l4.5-11L22 21M15 17h5'); svg.append(path); return svg;
}
export function translateButton(ctx, options = {}, small = false) {
  return h('button', { class: `btn ${small ? 'small' : 'primary'} translate-button`, title: 'Translate screenshot text with OpenAI or Claude', onClick: () => openTranslate(ctx, options) }, translateIcon(), 'Translate…');
}
export function openTranslate(ctx, { target = state.ui.locale, slideId = null, fields = null } = {}) {
  const projectId = state.projectId, project = engine.project;
  if (project.locales.length < 2) { openAddLanguage(ctx); toast('Add a target language, then choose Translate.'); return; }
  const controller = new AbortController(); let closed = false, busy = false;
  let source = project.locales.some(l => l.id === 'en-US') ? 'en-US' : project.locales[0].id;
  if (target === source) target = project.locales.find(l => l.id !== source).id;
  const sourceInput = selectInput({ value: source, options: project.locales.map(l => [l.id, l.name]), onChange: update });
  const targetInput = selectInput({ value: target, options: project.locales.map(l => [l.id, l.name]), onChange: update });
  const provider = selectInput({ value: 'openai', options: [['openai', 'OpenAI'], ['claude', 'Claude (Anthropic)']], onChange: value => { model.value = TRANSLATION_MODELS[value]; key.value = ''; update(); } });
  const model = h('input', { class: 'input', 'aria-label': 'Translation model', value: TRANSLATION_MODELS.openai, autocomplete: 'off' });
  const key = h('input', { class: 'input', type: 'password', 'aria-label': 'API key', placeholder: 'Paste your API key', autocomplete: 'off', spellcheck: 'false', onInput: update });
  const scope = selectInput({ value: fields ? 'field' : slideId ? 'slide' : 'all', options: [...(fields ? [['field', 'Selected text']] : []), ['slide', 'Current slide'], ['all', 'All slides']], onChange: update });
  const mode = selectInput({ value: 'missing', options: [['missing', 'Only missing text'], ['replace', 'Replace existing text']], onChange: update });
  const summary = h('p', { class: 'notice', role: 'status' }), status = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const plan = () => {
    const p = translationPlan({ project: engine.project, copy: engine.data.copy, source: sourceInput.value, target: targetInput.value, slideId: scope.value !== 'all' ? (slideId ?? state.ui.slideId) : null, missingOnly: mode.value === 'missing' });
    if (fields && scope.value === 'field') { p.fields = p.fields.filter(f => fields.includes(f.field)); const ids = new Set(p.fields.flatMap(f => f.ids)); p.entries = p.entries.filter(e => ids.has(e.id)); }
    return p;
  };
  const run = h('button', { class: 'btn primary', onClick: async () => {
    if (busy || closed) return;
    let request;
    try { request = plan(); translationBatches(request.entries); } catch (error) { status.textContent = error.message; return; }
    if (!request.entries.length || !key.value.trim()) return;
    busy = true; for (const input of controls) input.disabled = true; run.disabled = true;
    const providerId = provider.value, token = key.value, modelId = model.value.trim();
    try {
      const batches = translationBatches(request.entries), translations = [];
      for (const [index, entries] of batches.entries()) {
        status.textContent = `Translating ${project.locales.find(l => l.id === request.target)?.name} · ${index + 1} of ${batches.length}…`;
        const result = await api('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ provider: providerId, token, model: modelId, source: request.source, target: request.target, entries }) });
        translations.push(...result.translations);
      }
      if (closed) return;
      if (state.projectId !== projectId || engine.project !== project) throw new Error('The project changed. Open Translate again.');
      applyTranslation(request, { translations });
      dialog.close(); ctx.go({ locale: request.target });
      toast(`${request.fields.length} text field${request.fields.length === 1 ? '' : 's'} translated · needs review`);
      try { await flushSaves(); } catch { toast('Translation is in the editor. Saving needs attention; use the save status to retry.', { error: true }); }
    } catch (error) { if (!closed) status.textContent = error.message; }
    finally { busy = false; if (!closed) { for (const input of controls) input.disabled = false; update(); } }
  } }, 'Translate');
  const controls = [sourceInput, targetInput, provider, model, key, scope, mode];
  function update() {
    if (busy) return;
    try { const p = plan(); summary.textContent = `${p.fields.length} text field${p.fields.length === 1 ? '' : 's'} → ${project.locales.find(l => l.id === targetInput.value)?.name}. ${mode.value === 'replace' ? 'Existing text in this scope will be replaced.' : 'Existing translations will be kept.'} You can undo the result.`; run.disabled = !p.entries.length || !key.value.trim(); }
    catch (error) { summary.textContent = error.message; run.disabled = true; }
  }
  const field = (label, input) => h('label', { class: 'f' }, h('span', null, label), input);
  const body = h('div', { class: 'translation-dialog' },
    h('p', null, 'Translate your screenshot copy, then review it in context.'),
    h('div', { class: 'translation-grid' }, field('From', sourceInput), field('To', targetInput), field('Slides', scope), field('Text to translate', mode), field('Provider', provider), field('Model', model)),
    field('API key', key), h('p', { class: 'hint' }, 'Your key is used only in this dialog and is never saved in the project. Screenshot text is sent directly to the selected provider. API usage is billed by that provider; a ChatGPT or Claude subscription is separate.'), summary, status);
  const dialog = modal({ title: 'Translate screenshots', body, actions: [h('button', { class: 'btn', onClick: () => dialog.close() }, 'Cancel'), run], onClose: () => { closed = true; key.value = ''; controller.abort(); } });
  update(); key.focus();
}
