import { engine, state, api, applyTranslations, flushSaves } from '../store.js';
import { translationPlan, translationBatches, TRANSLATION_MODELS, TRANSLATION_MODEL_SUGGESTIONS } from '../translation.js';
import { originalLocale } from '../copy-review.js';
import { loadTranslationPreferences, saveTranslationPreferences } from '../translation-preferences.js';
import { h, modal, selectInput, toast } from './helpers.js';
import { openAddLanguage } from './locale-dialogs.js';

export function translateIcon() {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', 'M3 5h12M9 3v2M5 8c1.5 4 4 6.5 8 8M13 5c-.7 6-4 10-10 13M13 21l4.5-11L22 21M15 17h5'); svg.append(path); return svg;
}
export function translateButton(ctx, options = {}, small = false) {
  return h('button', { class: `btn ${small ? 'small' : 'primary'} translate-button`, title: 'Translate screenshot text with OpenAI or Claude', onClick: () => openTranslate(ctx, options) }, translateIcon(), options.target === 'all' ? 'Translate all…' : 'Translate…');
}
export function openTranslate(ctx, { target = state.ui.locale, slideId = null, fields = null } = {}) {
  const projectId = state.projectId, project = engine.project;
  if (project.locales.length < 2) { openAddLanguage(ctx); toast('Add a target language, then choose Translate.'); return; }
  const controller = new AbortController(); let closed = false, busy = false;
  let source = originalLocale(project);
  if (target === source) target = project.locales.find(l => l.id !== source).id;
  const sourceInput = selectInput({ value: source, options: project.locales.map(l => [l.id, l.name]), onChange: update });
  const targetInput = selectInput({ value: target, options: [['all', 'All target languages'], ...project.locales.map(l => [l.id, l.name])], onChange: update });
  targetInput.setAttribute('aria-label', 'Target languages');
  let modelChoices = TRANSLATION_MODEL_SUGGESTIONS.openai.map(id => ({ id, name: id }));
  const provider = selectInput({ value: 'openai', options: [['openai', 'OpenAI'], ['claude', 'Claude (Anthropic)']], onChange: value => { void restorePreferences(value); } });
  const model = selectInput({ value: TRANSLATION_MODELS.openai, options: [...TRANSLATION_MODEL_SUGGESTIONS.openai.map(id => [id, id]), ['custom', 'Other model…']], onChange: update });
  model.setAttribute('aria-label', 'Translation model');
  const customModel = h('input', { class: 'input', 'aria-label': 'Other translation model', placeholder: 'Model ID', autocomplete: 'off', onInput: update });
  const modelId = () => model.value === 'custom' ? customModel.value.trim() : model.value;
  function setModels(models, preferred) {
    modelChoices = models;
    model.replaceChildren(...models.map(m => h('option', { value: m.id }, m.name === m.id ? m.id : `${m.name} · ${m.id}`)), h('option', { value: 'custom' }, 'Other model…'));
    model.value = models.some(m => m.id === preferred) ? preferred : models[0]?.id ?? 'custom';
  }
  const key = h('input', { class: 'input', type: 'password', 'aria-label': 'API key', placeholder: 'Paste your API key', autocomplete: 'off', spellcheck: 'false', onInput: update });
  const scope = selectInput({ value: fields ? 'field' : slideId ? 'slide' : 'all', options: [...(fields ? [['field', 'Selected text']] : []), ['slide', 'Current slide'], ['all', 'All slides']], onChange: update });
  const mode = selectInput({ value: 'missing', options: [['missing', 'Missing or untranslated text'], ['replace', 'Replace existing text']], onChange: update });
  const summary = h('p', { class: 'notice', role: 'status' }), status = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  async function savePreferences(includeKey = false) {
    if (!modelId()) return;
    await saveTranslationPreferences({ provider: provider.value, model: modelId(), models: modelChoices, ...(includeKey && key.value.trim() && window.studioDesktop?.translationSettings ? { token: key.value } : {}) });
  }
  async function restorePreferences(providerId = null) {
    busy = true; controls.forEach(input => { input.disabled = true; }); run.disabled = true; loadModels.disabled = true;
    key.value = ''; status.textContent = 'Loading saved translation settings…';
    try {
      const prefs = await loadTranslationPreferences(providerId);
      if (closed) return;
      provider.value = prefs.provider;
      const choices = prefs.models?.length ? prefs.models : TRANSLATION_MODEL_SUGGESTIONS[prefs.provider].map(id => ({ id, name: id }));
      setModels(choices, prefs.model ?? TRANSLATION_MODELS[prefs.provider]);
      customModel.value = '';
      if (prefs.model && !choices.some(m => m.id === prefs.model)) { model.value = 'custom'; customModel.value = prefs.model; }
      key.value = prefs.token ?? ''; status.textContent = prefs.keyError ?? (key.value ? 'API key loaded from macOS Keychain.' : '');
      await savePreferences();
    } catch (error) {
      if (!closed) { const id = providerId ?? 'openai'; provider.value = id; setModels(TRANSLATION_MODEL_SUGGESTIONS[id].map(id => ({ id, name: id })), TRANSLATION_MODELS[id]); status.textContent = error.message; }
    } finally { busy = false; if (!closed) { controls.forEach(input => { input.disabled = false; }); update(); } }
  }
  const loadModels = h('button', { class: 'btn small', type: 'button', onClick: async () => {
    if (busy || closed || !key.value.trim()) return;
    busy = true; for (const input of controls) input.disabled = true; run.disabled = true; loadModels.disabled = true;
    status.textContent = 'Loading models from the provider…';
    try {
      await savePreferences(true);
      if (closed) return;
      const result = await api('/api/translate/models', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ provider: provider.value, token: key.value }) });
      if (closed) return;
      if (!result.models.length) throw new Error('No translation models were returned for this key. You can enter a model ID with Other model.');
      setModels(result.models, modelId());
      await savePreferences();
      status.textContent = `${result.models.length} model${result.models.length === 1 ? '' : 's'} loaded for your API key. Choose a model that supports structured output.`;
    } catch (error) { if (!closed) status.textContent = error.message; }
    finally { busy = false; if (!closed) { for (const input of controls) input.disabled = false; update(); } }
  } }, 'Load models from API');
  const plans = () => (targetInput.value === 'all' ? engine.project.locales.filter(l => l.id !== sourceInput.value).map(l => l.id) : [targetInput.value]).map(target => {
    const p = translationPlan({ project: engine.project, copy: engine.data.copy, source: sourceInput.value, target, slideId: scope.value !== 'all' ? (slideId ?? state.ui.slideId) : null, missingOnly: mode.value === 'missing' });
    if (fields && scope.value === 'field') { p.fields = p.fields.filter(f => fields.includes(f.field)); const ids = new Set(p.fields.flatMap(f => f.ids)); p.entries = p.entries.filter(e => ids.has(e.id)); }
    return p;
  });
  const run = h('button', { class: 'btn primary', onClick: async () => {
    if (busy || closed) return;
    let request;
    try { request = plans().filter(p => p.entries.length); request.forEach(p => translationBatches(p.entries)); } catch (error) { status.textContent = error.message; return; }
    if (!request.length || !key.value.trim()) return;
    busy = true; for (const input of controls) input.disabled = true; run.disabled = true; loadModels.disabled = true;
    const providerId = provider.value, token = key.value, selectedModel = modelId();
    try {
      await savePreferences(true);
      if (closed) return;
      const results = [];
      for (const [languageIndex, p] of request.entries()) {
        const batches = translationBatches(p.entries), translations = [];
        for (const [index, entries] of batches.entries()) {
          status.textContent = `Translating ${project.locales.find(l => l.id === p.target)?.name} · language ${languageIndex + 1} of ${request.length} · text ${index + 1} of ${batches.length}…`;
          const result = await api('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ provider: providerId, token, model: selectedModel, source: p.source, target: p.target, entries }) });
          translations.push(...result.translations);
        }
        results.push({ plan: p, result: { translations } });
      }
      if (closed) return;
      if (state.projectId !== projectId || engine.project !== project) throw new Error('The project changed. Open Translate again.');
      applyTranslations(results);
      dialog.close(); ctx.go({ locale: targetInput.value === 'all' ? state.ui.locale : request[0].target });
      toast(`${request.reduce((n, p) => n + p.fields.length, 0)} text fields translated across ${request.length} language${request.length === 1 ? '' : 's'} · needs review`);
      try { await flushSaves(); } catch { toast('Translation is in the editor. Saving needs attention; use the save status to retry.', { error: true }); }
    } catch (error) { if (!closed) status.textContent = error.message; }
    finally { busy = false; if (!closed) { for (const input of controls) input.disabled = false; update(); } }
  } }, 'Translate');
  const controls = [sourceInput, targetInput, provider, model, customModel, key, scope, mode];
  for (const input of [model, customModel, key]) input.addEventListener('change', () => {
    void savePreferences(input === key).catch(error => { if (!closed) status.textContent = error.message; });
  });
  const forgetKey = window.studioDesktop?.translationSettings ? h('button', { class: 'btn small', onClick: async () => {
    if (busy) return;
    try { await window.studioDesktop.translationSettings('forget', provider.value); key.value = ''; status.textContent = 'API key removed from macOS Keychain.'; update(); } catch (error) { status.textContent = error.message; }
  } }, 'Forget saved key') : null;
  function update() {
    if (busy) return;
    customModel.style.display = model.value === 'custom' ? '' : 'none';
    loadModels.disabled = !key.value.trim();
    try { const p = plans(), count = p.reduce((n, item) => n + item.fields.length, 0); summary.textContent = `${count} text field${count === 1 ? '' : 's'} → ${targetInput.value === 'all' ? `${p.length} target languages` : project.locales.find(l => l.id === targetInput.value)?.name}. ${mode.value === 'replace' ? 'Existing text in this scope will be replaced.' : 'Existing translations will be kept.'} You can undo the result.`; run.disabled = !count || !key.value.trim() || !modelId(); }
    catch (error) { summary.textContent = error.message; run.disabled = true; }
  }
  const field = (label, input) => h('label', { class: 'f' }, h('span', null, label), input);
  const body = h('div', { class: 'translation-dialog' },
    h('p', null, 'Translate your screenshot copy, then review it in context.'),
    h('div', { class: 'translation-grid' }, field('From', sourceInput), field('To', targetInput), field('Slides', scope), field('Text to translate', mode), field('Provider', provider), field('Model', h('div', null, model, customModel))),
    field('API key', key), forgetKey, loadModels, h('p', { class: 'hint' }, `Model choices are remembered. ${window.studioDesktop?.translationSettings ? 'Your API key is saved in macOS Keychain.' : 'API keys are not saved in browser mode.'} Keys are never saved in the project. Screenshot text is sent directly to the selected provider. API usage is billed by that provider; a ChatGPT or Claude subscription is separate.`), summary, status);
  const dialog = modal({ title: 'Translate screenshots', body, actions: [h('button', { class: 'btn', onClick: () => dialog.close() }, 'Cancel'), run], onClose: () => { closed = true; key.value = ''; controller.abort(); } });
  update(); void restorePreferences();
}
