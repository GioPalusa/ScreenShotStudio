import test from 'node:test';
import assert from 'node:assert/strict';
import { translationPlan, translationBatches, translatedCopy, translatedCopies, validateTranslations, translationReviewFor } from '../app/js/translation.js';
import { captureSourceFor, captureUsage } from '../app/js/media.js';
import { cleanTranslationSettings, createTranslationSettings } from '../desktop/translation-settings.mjs';
import { translateText, listTranslationModels } from '../host/translation.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';
import { copyFields } from '../app/js/copy-fields.js';
import { localeNeedsReview, setSlideReviewed } from '../app/js/copy-review.js';
import { resolveLayers } from '../app/js/layouts.js';
import { editBlock, removeLayer } from '../app/js/layer-ops.js';
const project = { locales: [{ id: 'en-US' }, { id: 'sv-SE' }], devices: { phone: { size: [1320, 2868] } }, slides: ['one', 'two'].map(id => ({ id, layouts: { phone: { template: 'custom', layers: (id === 'one' ? ['headline', 'bullets'] : ['headline']).map(field => ({ id: field, type: 'text', field })) } } })) };
const copy = { 'en-US': { one: { headline: 'Hello\n{name}', bullets: ['One', '', 'Two %1$s'] }, two: { headline: 'Next' } }, 'sv-SE': { _meta: { status: 'approved', needsReview: [] }, one: { headline: 'Existing' } } };
const plan = options => translationPlan({ project, copy, source: 'en-US', target: 'sv-SE', ...options });
const result = p => ({ translations: p.entries.map(e => ({ id: e.id, text: `SV ${e.text}` })) });
test('saved model preferences exclude secrets and retain provider model IDs', () => {
  const prefs = cleanTranslationSettings({ provider: 'openai', model: 'gpt-qa', models: [{ id: 'gpt-qa', name: 'QA' }], token: 'fake-credential', unrelated: 'value' });
  assert.deepEqual(prefs, { model: 'gpt-qa', models: [{ id: 'gpt-qa', name: 'QA' }] });
  assert.throws(() => cleanTranslationSettings({ provider: 'other', model: 'gpt-qa', models: [] }), /Invalid/);
});
test('model lists and selection survive restart even when Keychain is unavailable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-preferences-test-'));
  try {
    const options = { root, userData: root, packaged: true };
    await createTranslationSettings(options).save({ provider: 'claude', model: 'qa-model', models: [{ id: 'qa-model', name: 'QA' }] });
    const restored = await createTranslationSettings(options).load();
    assert.equal(restored.provider, 'claude'); assert.equal(restored.model, 'qa-model');
    assert.deepEqual(restored.models, [{ id: 'qa-model', name: 'QA' }]);
    assert.equal(restored.token, ''); assert.match(restored.keyError, /helper is missing/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('all-language results validate together and never partially change copy', () => {
  const p = structuredClone(project); p.locales.push({ id: 'de-DE' });
  const plans = ['sv-SE', 'de-DE'].map(target => translationPlan({ project: p, copy, source: 'en-US', target, missingOnly: false }));
  const results = plans.map(plan => ({ plan, result: result(plan) }));
  const before = JSON.stringify(copy), docs = translatedCopies(p, copy, results);
  assert.deepEqual(Object.keys(docs), ['sv-SE', 'de-DE']); assert.equal(JSON.stringify(copy), before);
  assert.equal(docs['de-DE']._meta.status, 'draft');
  results[1].result.translations.pop(); assert.throws(() => translatedCopies(p, copy, results), /incomplete/);
  assert.equal(JSON.stringify(copy), before);
});
test('screenshots prefer the language override, standard image, then original image', () => {
  const p = { ...project, sourceLocale: 'sv-SE', devices: { phone: { size: [1320,2868], capture: 'phone' } }, slides: [{ id: 'one', layouts: { phone: { template: 'custom', layers: [{ id: 'device', type: 'device', capture: 'screen' }] } } }] };
  const captures = { 'sv-SE': { phone: { screen: { file: 'original.png' } } }, default: { phone: { screen: { file: 'standard.png' } } } };
  assert.equal(captureSourceFor(p, captures, 'en-US', 'phone', 'screen').file, 'standard.png');
  delete captures.default;
  assert.deepEqual(captureSourceFor(p, captures, 'en-US', 'phone', 'screen'), { file: 'original.png', scope: 'sv-SE', localized: false });
  assert.ok(captureUsage(p, captures, { scope: 'sv-SE', set: 'phone', name: 'screen' }).some(u => u.localeId === 'en-US'));
  captures['en-US'] = { phone: { screen: { file: 'localized.png' } } };
  assert.equal(captureSourceFor(p, captures, 'en-US', 'phone', 'screen').file, 'localized.png');
  assert.equal(captureSourceFor(p, captures, 'en-US', 'phone', 'absent'), null);
});
test('translation scopes, missing-only, lists, line breaks and review state', () => {
  const p = plan(); assert.equal(p.fields.length, 2); assert.equal(p.entries.length, 3);
  const next = translatedCopy(project, copy, p, result(p));
  assert.equal(next.one.headline, 'Existing'); assert.deepEqual(next.one.bullets, ['SV One', '', 'SV Two %1$s']);
  assert.equal(next._meta.status, 'draft'); assert.deepEqual(next._meta.needsReview, ['*']); assert.equal(next._meta.translationReview.length, 2); assert.equal(copy['sv-SE']._meta.status, 'approved');
  const selected = plan({ missingOnly: false, slideId: 'one' }); assert.equal(selected.fields.length, 2);
  assert.equal(translatedCopy(project, copy, selected, result(selected)).one.headline, 'SV Hello\n{name}');
  assert.throws(() => plan({ target: 'en-US' }), /different/);
});
test('unreviewed source copies are translated while reviewed identical text is kept', () => {
  const data = structuredClone(copy); data['sv-SE'] = structuredClone(copy['en-US']); data['sv-SE']._meta = { status: 'draft', needsReview: ['*'] };
  assert.equal(translationPlan({project,copy:data,source:'en-US',target:'sv-SE'}).fields.length,3);
  data['sv-SE']._meta = {status:'approved',needsReview:[]};
  assert.equal(translationPlan({project,copy:data,source:'en-US',target:'sv-SE'}).fields.length,0);
});
test('translation rejects partial/duplicate/unknown IDs and changed placeholders or concurrent edits', () => {
  const p = plan({ missingOnly: false }); const output = result(p);
  assert.throws(() => validateTranslations(p.entries, { translations: output.translations.slice(1) }), /incomplete/);
  const duplicate = structuredClone(output); duplicate.translations[1].id = duplicate.translations[0].id;
  assert.throws(() => validateTranslations(p.entries, duplicate), /match/);
  const bad = structuredClone(output); bad.translations[0].text = 'Hej'; assert.throws(() => validateTranslations(p.entries, bad), /placeholder/);
  const edited = structuredClone(copy); edited['sv-SE'].one.headline = 'New edit'; assert.throws(() => translatedCopy(project, edited, p, output), /changed/);
  edited['sv-SE'].one.headline = 'Existing'; edited['en-US'].one.headline = 'Changed source'; assert.throws(() => translatedCopy(project, edited, p, output), /changed/);
  assert.equal(translationBatches(Array.from({ length: 70 }, (_, i) => ({ id: `t${i}`, text: 'Text' }))).length, 70);
});
for (const provider of ['openai', 'claude']) test(`${provider} request, structured response and credential isolation`, async () => {
  const entries = [{ id: 't0', text: 'Hello', context: 'headline' }]; let called;
  const output = { translations: [{ id: 't0', text: 'Hej' }] };
  const reviewed = { translations: [{ ...output.translations[0], review: { status: 'passed', corrected: false, issues: [] } }] };
  const fetchImpl = async (url, options) => {
    called = { url, ...options, body: JSON.parse(options.body) };
    const prompt = JSON.parse(provider === 'openai' ? called.body.input : called.body.messages[0].content);
    const response = prompt.sourceText ? { status: 'passed', issues: [] } : output;
    return providerReply(provider, response);
  };
  assert.deepEqual(await translateText({ provider, token: 'test-only-key', source: 'en-US', target: 'sv-SE', entries }, { fetchImpl }), reviewed);
  assert.equal(called.redirect, 'error'); assert.equal(JSON.stringify(called.body).includes('test-only-key'), false);
  assert.equal(called.url, provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages');
  if (provider === 'openai') { assert.equal(called.body.store, false); assert.equal(called.body.text.format.strict, true); }
  else { assert.equal(called.headers['anthropic-version'], '2023-06-01'); assert.equal(called.body.output_config.format.type, 'json_schema'); }
});
test('provider errors, truncated output, malformed and refused results are safe and never echo secrets', async () => {
  const input = { provider: 'openai', token: 'test-only-secret', source: 'en-US', target: 'sv-SE', entries: [{ id: 't0', text: 'Hello', context: '' }] };
  for (const status of [401, 429, 500]) await assert.rejects(translateText(input, { fetchImpl: async () => new Response('test-only-secret', { status }) }), error => error.status === 502 && !error.message.includes(input.token));
  await assert.rejects(translateText(input, { fetchImpl: async () => { throw new Error(input.token); } }), error => !error.message.includes(input.token));
  await assert.rejects(translateText(input, { fetchImpl: async () => Response.json({ status: 'incomplete' }) }), /did not finish/);
  await assert.rejects(translateText(input, { fetchImpl: async () => Response.json({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }) }), /incomplete or invalid/);
  await assert.rejects(translateText({ ...input, provider: 'https://evil.example' }), /provider/);
});

test('removed text disappears from translation and review while stored copy survives undo', () => {
  const p = structuredClone(project), c = structuredClone(copy), slide = p.slides[0];
  const layer = resolveLayers({ project: p, slide, deviceId: 'phone', localeId: 'en-US' }).layers.find(l => l.field === 'headline');
  removeLayer(editBlock(p, slide, 'phone'), layer);
  assert.deepEqual(copyFields(p, c, slide, 'en-US'), ['bullets']);
  assert.ok(!translationPlan({ project: p, copy: c, source: 'en-US', target: 'sv-SE', missingOnly: false }).fields.some(f => f.slideId === 'one' && f.field === 'headline'));
  assert.equal(c['en-US'].one.headline, copy['en-US'].one.headline);
  c['sv-SE']._meta.needsReview = ['one.headline'];
  assert.equal(localeNeedsReview(p, c, 'sv-SE', 'one'), false);
});

test('original language is exempt; reviewing a screen leaves other screens pending', () => {
  const p = structuredClone(project), c = structuredClone(copy);
  c['en-US']._meta = c['sv-SE']._meta = { status: 'draft', needsReview: ['*'] };
  assert.equal(localeNeedsReview(p, c, 'en-US'), false);
  assert.equal(localeNeedsReview(p, c, 'sv-SE'), true);
  setSlideReviewed(p, c, 'sv-SE', 'one');
  assert.equal(localeNeedsReview(p, c, 'sv-SE', 'one'), false);
  assert.equal(localeNeedsReview(p, c, 'sv-SE', 'two'), true);
  setSlideReviewed(p, c, 'sv-SE', 'two');
  assert.equal(localeNeedsReview(p, c, 'sv-SE'), false);
  p.sourceLocale = 'sv-SE';
  assert.equal(localeNeedsReview(p, c, 'en-US'), true);
  assert.equal(localeNeedsReview(p, c, 'sv-SE'), false);
  p.locales = [{ id: 'sv-SE' }]; delete p.sourceLocale;
  c['sv-SE']._meta = { status: 'draft', needsReview: ['*'] };
  assert.equal(localeNeedsReview(p, c, 'sv-SE'), false);
});

test('fields used on another canvas, in a locale layout or by a cross-screen layer remain editable', () => {
  const p = structuredClone(project), c = structuredClone(copy);
  p.devices.tablet = { size: [2000, 2000], layout: 'phone' };
  p.slides[1].layouts.tablet = { template: 'custom' };
  p.slides[0].layouts.tablet = { template: 'custom', layers: [{ id: 'extra', type: 'text', field: 'extra' }] };
  p.slides[0].localeLayouts = { 'sv-SE': { phone: { layers: [{ id: 'local', type: 'text', field: 'local' }] } } };
  p.slides[1].layouts.phone.layers.push({ id: 'shared', type: 'text', field: 'shared', copySlideId: 'one' });
  assert.deepEqual(copyFields(p, c, p.slides[0], 'sv-SE'), ['headline', 'bullets', 'local', 'extra', 'shared']);
});

test('API model discovery filters non-text models, deduplicates and follows Claude pagination', async () => {
  const input = { provider: 'openai', token: 'test-only-key' };
  const result = await listTranslationModels(input, { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models'); assert.equal(options.headers.authorization, 'Bearer test-only-key');
    return Response.json({ data: ['gpt-test', 'gpt-test', 'text-embedding-3-small', 'gpt-audio', 'gpt-image-1', 'o3', 'bad id'].map(id => ({ id })) });
  } });
  assert.deepEqual(result.models.map(m => m.id), ['gpt-test', 'o3']);
  let page = 0;
  const claude = await listTranslationModels({ ...input, provider: 'claude' }, { fetchImpl: async (url, options) => {
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    if (page++ === 0) return Response.json({ data: [{ id: 'claude-one', display_name: 'One' }], has_more: true, last_id: 'claude-one' });
    assert.ok(url.endsWith('&after_id=claude-one'));
    return Response.json({ data: [{ id: 'claude-two', display_name: 'Two' }], has_more: false });
  } });
  assert.deepEqual(claude.models.map(m => m.id), ['claude-one', 'claude-two']);
  await assert.rejects(listTranslationModels(input, { fetchImpl: async () => new Response(input.token, { status: 401 }) }), e => !e.message.includes(input.token));
});

test('desktop studio protocol completes translation and model discovery without Node response errors', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-translation-protocol-'));
  const projectPath = path.join(root, 'Test.sss'); createNewProject(projectPath, {});
  const service = createStudioService({ appPath: path.resolve('app'), projectPath, exportPath: path.join(root, 'export'), origin: 'studio://local' });
  t.after(() => { service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-test' }] });
    const body = JSON.parse(options.body), prompt = JSON.parse(body.input);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(prompt.sourceText ? { status: 'passed', issues: [] } : { translations: prompt.entries.map(e => ({ id: e.id, text: 'Hej' })) }) }] }] });
  });
  const input = { provider: 'openai', token: 'test-only-key', source: 'en-US', target: 'sv-SE', entries: [{ id: 't0', text: 'Hello', context: 'headline' }] };
  for (const endpoint of ['/api/translate', '/api/translate/models']) {
    const response = await service.request(new Request(`studio://local${endpoint}`, { method: 'POST', headers: { origin: 'studio://local' }, body: JSON.stringify(input) }));
    assert.equal(response.status, 200); const result = await response.json();
    assert.ok(endpoint.endsWith('/models') ? result.models[0].id === 'gpt-test' : result.translations[0].text === 'Hej');
    assert.ok(!JSON.stringify(result).includes(input.token));
  }
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); started();
  }));
  const pending = service.request(new Request('studio://local/api/translate', { method: 'POST', headers: { origin: 'studio://local' }, body: JSON.stringify(input), signal: controller.signal }));
  await ready; controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.status, 502); assert.match((await cancelled.json()).error, /cancelled/);
});

for (const provider of ['openai', 'claude']) test(`${provider} isolates city-guide meaning from neighbouring text and slide context`, async () => {
  const entries = [
    { id: 't0', text: 'A city guide', context: 'Tokyo · headline' },
    { id: 't1', text: 'Explore Tokyo', context: 'Tokyo · subtitle' },
    { id: 't2', text: 'Save your favourites', context: 'Tokyo · bullets' },
  ];
  const expected = ['En stadsguide', 'Utforska Tokyo', 'Spara dina favoriter'];
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = JSON.parse(provider === 'openai' ? body.input : body.messages[0].content);
    if (prompt.sourceText) {
      assert.deepEqual(prompt, { source: 'en-US', target: 'sv-SE', sourceText: entries[calls.length - 1].text, candidate: expected[calls.length - 1] });
      return providerReply(provider, { status: 'passed', issues: [] });
    }
    const index = calls.length;
    assert.deepEqual(prompt, { source: 'en-US', target: 'sv-SE', entries: [{ id: entries[index].id, text: entries[index].text }] });
    calls.push(prompt);
    const translations = [{ id: entries[index].id, text: expected[index] }];
    return Response.json(provider === 'openai'
      ? { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ translations }) }] }] }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ translations }) }] });
  };
  const translated = await translateText({ provider, token: 'test-only-key', source: 'en-US', target: 'sv-SE', entries }, { fetchImpl });
  assert.equal(calls.length, entries.length);
  assert.deepEqual(translated.translations, entries.map((e, i) => ({ id: e.id, text: expected[i], review: { status: 'passed', corrected: false, issues: [] } })));
  assert.deepEqual(translationBatches(entries), entries.map(e => [e]));
});

test('failure after an isolated text succeeds rejects the entire translation result', async () => {
  let calls = 0;
  await assert.rejects(translateText({ provider: 'openai', token: 'test-only-key', source: 'en-US', target: 'sv-SE', entries: [
    { id: 't0', text: 'A city guide', context: '' }, { id: 't1', text: 'Explore Tokyo', context: '' },
  ] }, { fetchImpl: async () => ++calls === 1
    ? Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ translations: [{ id: 't0', text: 'En stadsguide' }] }) }] }] })
    : calls === 2 ? providerReply('openai', { status: 'passed', issues: [] }) : new Response('', { status: 500 }) }), /unavailable/);
  assert.equal(calls, 3);
});

function providerReply(provider, value) {
  return Response.json(provider === 'openai'
    ? { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }
    : { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(value) }] });
}

for (const provider of ['openai', 'claude']) {
  const examples = [
    ['A city guide.', 'Un guide de Tokyo.', 'Un guide de ville.', 'Added Tokyo, absent from source.'],
    ['A month’s worth of moments.', 'Целый месяц ярких мгновений.', 'Целый месяц мгновений.', 'Added bright, absent from source.'],
    ['Works offline.', 'Requires an internet connection.', 'Fonctionne hors ligne.', 'Reversed the connectivity claim.'],
    ['Save 10 places.', 'Enregistrez 100 lieux.', 'Enregistrez 10 lieux.', 'Changed the number from 10 to 100.'],
    ['Save and share places.', 'Enregistrez des lieux.', 'Enregistrez et partagez des lieux.', 'Omitted sharing.'],
  ];
  for (const [sourceText, bad, good, issue] of examples) test(`${provider} corrects and rechecks: ${issue}`, async () => {
    const prompts = [];
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body), prompt = JSON.parse(provider === 'openai' ? body.input : body.messages[0].content);
      prompts.push(prompt);
      if (prompt.sourceText) return providerReply(provider, { status: prompt.candidate === bad ? 'needs_correction' : 'passed', issues: prompt.candidate === bad ? [issue] : [] });
      return providerReply(provider, { translations: [{ id: 't0', text: prompt.candidate ? good : bad }] });
    };
    const result = await translateText({ provider, token: 'test-only-key', source: 'en-US', target: 'fr-FR', entries: [{ id: 't0', text: sourceText, context: 'ignored' }] }, { fetchImpl });
    assert.deepEqual(result.translations, [{ id: 't0', text: good, review: { status: 'passed', corrected: true, issues: [] } }]);
    assert.equal(prompts.length, 4);
    assert.deepEqual(prompts[2], { source: 'en-US', target: 'fr-FR', entries: [{ id: 't0', text: sourceText }], candidate: bad, issues: [issue] });
    assert.equal(prompts[3].candidate, good);
  });
  for (const [sourceText, natural] of [
    ["Look how far you’ve come.", 'Voyez tout le chemin parcouru.'],
    ['Your days. Rediscovered.', 'Redécouvrez vos journées.'],
    ['Little badges. Big memories.', 'De petits badges. De grands souvenirs.'],
  ]) test(`${provider} accepts natural wording without a literal rewrite: ${natural}`, async () => {
    let calls = 0;
    const result = await translateText({ provider, token: 'test-only-key', source: 'en-US', target: 'fr-FR', entries: [{ id: 't0', text: sourceText, context: '' }] }, { fetchImpl: async (_url, options) => {
      calls++;
      const body = JSON.parse(options.body), instructions = provider === 'openai' ? body.instructions : body.system;
      if (calls === 2) assert.match(instructions, /Accept natural, idiomatic translations/);
      return providerReply(provider, calls === 1 ? { translations: [{ id: 't0', text: natural }] } : { status: 'passed', issues: [] });
    } });
    assert.equal(calls, 2);
    assert.deepEqual(result.translations[0], { id: 't0', text: natural, review: { status: 'passed', corrected: false, issues: [] } });
  });
  test(`${provider} unresolved errors and ambiguous sources require manual checks`, async () => {
    for (const status of ['needs_correction', 'manual']) {
      let calls = 0;
      const result = await translateText({ provider, token: 'test-only-key', source: 'en-US', target: 'sv-SE', entries: [{ id: 't0', text: 'A city guide.', context: '' }] }, { fetchImpl: async (_url, options) => {
        calls++;
        const body = JSON.parse(options.body), prompt = JSON.parse(provider === 'openai' ? body.input : body.messages[0].content);
        return providerReply(provider, prompt.sourceText ? { status, issues: ['Check the intended meaning.'] } : { translations: [{ id: 't0', text: 'En Tokyoguide.' }] });
      } });
      assert.equal(calls, status === 'manual' ? 2 : 4);
      assert.deepEqual(result.translations[0].review, { status: 'manual', corrected: false, issues: ['Check the intended meaning.'] });
    }
  });
}

test('meaning reports survive JSON and preserve human review, list order and untouched reports', () => {
  const p = plan({ missingOnly: false });
  const output = result(p);
  output.translations = output.translations.map((row, i) => ({ ...row, review: { status: i === 1 ? 'manual' : 'passed', corrected: i === 0, issues: i === 1 ? ['Check this list item.'] : [] } }));
  const doc = JSON.parse(JSON.stringify(translatedCopy(project, copy, p, output)));
  const data = { ...copy, 'sv-SE': doc };
  assert.equal(doc._meta.status, 'draft');
  assert.equal(translationReviewFor(data, 'sv-SE', 'one', 'headline').corrected, true);
  assert.deepEqual(translationReviewFor(data, 'sv-SE', 'one', 'bullets').issues, ['Item 1: Check this list item.']);
  const limited = translationPlan({ project, copy: data, source: 'en-US', target: 'sv-SE', slideId: 'two', missingOnly: false });
  const updated = translatedCopy(project, data, limited, result(limited));
  assert.deepEqual(updated._meta.translationReview.filter(r => r.slideId === 'one'), doc._meta.translationReview.filter(r => r.slideId === 'one'));
  data['sv-SE'].one.headline = 'Edited';
  assert.equal(translationReviewFor(data, 'sv-SE', 'one', 'headline').status, 'stale');
  data['sv-SE'].one.headline = doc._meta.translationReview[0].value;
  data['en-US'] = structuredClone(copy['en-US']); data['en-US'].one.headline = 'Changed source';
  assert.equal(translationReviewFor(data, 'sv-SE', 'one', 'headline').status, 'stale');
  assert.equal(translationReviewFor(data, 'sv-SE', 'missing', 'headline'), null);
});

test('malformed or failed meaning reviews reject the whole operation', async () => {
  for (const review of [{ status: 'passed', issues: ['Contradiction'] }, { status: 'manual', issues: [] }, { status: 'unknown', issues: [] }, { status: 'passed' }, null]) {
    let calls = 0;
    await assert.rejects(translateText({ provider: 'openai', token: 'test-only-key', source: 'en-US', target: 'sv-SE', entries: [{ id: 't0', text: 'A city guide.', context: '' }] }, { fetchImpl: async () => providerReply('openai', ++calls === 1 ? { translations: [{ id: 't0', text: 'En stadsguide.' }] } : review) }), /invalid meaning review/);
  }
  const p = plan({ missingOnly: false }), output = result(p);
  output.translations[0].review = { status: 'passed', corrected: false, issues: ['Not passed'] };
  assert.throws(() => translatedCopy(project, copy, p, output), /Invalid meaning review/);
});

test('review cancellation and provider failures never return an unchecked translation', async () => {
  const input = { provider: 'openai', token: 'test-only-key', source: 'en-US', target: 'sv-SE', entries: [{ id: 't0', text: 'A city guide.', context: '' }] };
  for (const cancel of [false, true]) {
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(translateText(input, { signal: controller.signal, fetchImpl: async () => {
      if (++calls === 1) return providerReply('openai', { translations: [{ id: 't0', text: 'En stadsguide.' }] });
      if (cancel) { controller.abort(); throw new Error('aborted'); }
      return new Response('', { status: 500 });
    } }), cancel ? /cancelled/ : /unavailable/);
    assert.equal(calls, 2);
  }
});

test('correction cannot bypass placeholder validation', async () => {
  let calls = 0;
  await assert.rejects(translateText({ provider: 'openai', token: 'test-only-key', source: 'en-US', target: 'sv-SE', entries: [{ id: 't0', text: 'Guide for {name}', context: '' }] }, { fetchImpl: async () => providerReply('openai', [
    { translations: [{ id: 't0', text: 'Tokyoguide för {name}' }] },
    { status: 'needs_correction', issues: ['Added Tokyo.'] },
    { translations: [{ id: 't0', text: 'En stadsguide' }] },
  ][calls++]) }), /invalid translations/);
  assert.equal(calls, 3);
});
