import test from 'node:test';
import assert from 'node:assert/strict';
import { translationPlan, translationBatches, translatedCopy, validateTranslations } from '../app/js/translation.js';
import { translateText } from '../host/translation.mjs';
const project = { locales: [{ id: 'en-US' }, { id: 'sv-SE' }], slides: [{ id: 'one', name: 'First' }, { id: 'two' }] };
const copy = { 'en-US': { one: { headline: 'Hello\n{name}', bullets: ['One', '', 'Two %1$s'] }, two: { headline: 'Next' } }, 'sv-SE': { _meta: { status: 'approved', needsReview: [] }, one: { headline: 'Existing' } } };
const plan = options => translationPlan({ project, copy, source: 'en-US', target: 'sv-SE', ...options });
const result = p => ({ translations: p.entries.map(e => ({ id: e.id, text: `SV ${e.text}` })) });
test('translation scopes, missing-only, lists, line breaks and review state', () => {
  const p = plan(); assert.equal(p.fields.length, 2); assert.equal(p.entries.length, 3);
  const next = translatedCopy(project, copy, p, result(p));
  assert.equal(next.one.headline, 'Existing'); assert.deepEqual(next.one.bullets, ['SV One', '', 'SV Two %1$s']);
  assert.deepEqual(next._meta, { status: 'draft', needsReview: ['*'] }); assert.equal(copy['sv-SE']._meta.status, 'approved');
  const selected = plan({ missingOnly: false, slideId: 'one' }); assert.equal(selected.fields.length, 2);
  assert.equal(translatedCopy(project, copy, selected, result(selected)).one.headline, 'SV Hello\n{name}');
  assert.throws(() => plan({ target: 'en-US' }), /different/);
});
test('translation rejects partial/duplicate/unknown IDs and changed placeholders or concurrent edits', () => {
  const p = plan({ missingOnly: false }); const output = result(p);
  assert.throws(() => validateTranslations(p.entries, { translations: output.translations.slice(1) }), /incomplete/);
  const duplicate = structuredClone(output); duplicate.translations[1].id = duplicate.translations[0].id;
  assert.throws(() => validateTranslations(p.entries, duplicate), /match/);
  const bad = structuredClone(output); bad.translations[0].text = 'Hej'; assert.throws(() => validateTranslations(p.entries, bad), /placeholder/);
  const edited = structuredClone(copy); edited['sv-SE'].one.headline = 'New edit'; assert.throws(() => translatedCopy(project, edited, p, output), /changed/);
  edited['sv-SE'].one.headline = 'Existing'; edited['en-US'].one.headline = 'Changed source'; assert.throws(() => translatedCopy(project, edited, p, output), /changed/);
  assert.equal(translationBatches(Array.from({ length: 70 }, (_, i) => ({ id: `t${i}`, text: 'Text' }))).length, 2);
});
for (const provider of ['openai', 'claude']) test(`${provider} request, structured response and credential isolation`, async () => {
  const entries = [{ id: 't0', text: 'Hello', context: 'headline' }]; let called;
  const output = { translations: [{ id: 't0', text: 'Hej' }] };
  const fetchImpl = async (url, options) => {
    called = { url, ...options, body: JSON.parse(options.body) };
    return Response.json(provider === 'openai' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }] });
  };
  assert.deepEqual(await translateText({ provider, token: 'test-only-key', source: 'en-US', target: 'sv-SE', entries }, { fetchImpl }), output);
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
