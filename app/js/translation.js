// Provider-independent translation planning and validation. Never contains credentials.
export const TRANSLATION_MODELS = { openai: 'gpt-5-mini', claude: 'claude-sonnet-5-5' };
const own = (o, k) => Object.hasOwn(o ?? {}, k);
export function translationPlan({ project, copy, source, target, slideId = null, missingOnly = true }) {
  if (source === target || !project.locales.some(l => l.id === source) || !project.locales.some(l => l.id === target)) throw new Error('Choose different source and target languages.');
  const fields = [], entries = [];
  for (const slide of project.slides.filter(s => !slideId || s.id === slideId)) {
    for (const [field, value] of Object.entries(copy[source]?.[slide.id] ?? {})) {
      if (field.startsWith('_') || !((typeof value === 'string') || (Array.isArray(value) && value.every(v => typeof v === 'string')))) continue;
      const current = copy[target]?.[slide.id]?.[field];
      if (missingOnly && (typeof current === 'string' ? current.trim() : Array.isArray(current) && current.some(v => String(v).trim()))) continue;
      const values = Array.isArray(value) ? value : [value];
      if (!values.some(v => v.trim())) continue;
      const ids = values.map(text => { if (!text.trim()) return null; const id = `t${entries.length}`; entries.push({ id, text, context: `${slide.name ?? slide.id} · ${field}` }); return id; });
      fields.push({ slideId: slide.id, field, value: structuredClone(value), before: current === undefined ? null : structuredClone(current), ids });
    }
  }
  return { source, target, fields, entries };
}
export function translationBatches(entries) {
  const batches = []; let batch = [], size = 0;
  for (const item of entries) {
    if (item.text.length > 12000) throw new Error('A text field is too long to translate. Split it into smaller fields.');
    if (batch.length && (size + item.text.length > 12000 || batch.length >= 60)) { batches.push(batch); batch = []; size = 0; }
    batch.push(item); size += item.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
const placeholders = text => (text.match(/\{\{[^{}]+\}\}|\$\{[^{}]+\}|\{[\w.]+\}|%(?:\d+\$)?[-+0-9.#]*[sdif@]|%%/g) ?? []).sort();
export function validateTranslations(entries, result) {
  if (!Array.isArray(result?.translations) || result.translations.length !== entries.length) throw new Error('The translation was incomplete. No text was changed.');
  const expected = new Map(entries.map(e => [e.id, e])), found = new Map();
  for (const row of result.translations) {
    const source = expected.get(row?.id);
    if (!source || found.has(row.id) || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 24000) throw new Error('The translation response did not match the requested text. No text was changed.');
    if (JSON.stringify(placeholders(source.text)) !== JSON.stringify(placeholders(row.text))) throw new Error('A translation changed a text placeholder. No text was changed.');
    found.set(row.id, row.text);
  }
  return found;
}
export function translatedCopy(project, copy, plan, result) {
  if (!project.locales.some(l => l.id === plan.target)) throw new Error('The target language was removed.');
  const values = validateTranslations(plan.entries, result);
  for (const f of plan.fields) {
    const before = copy[plan.target]?.[f.slideId]?.[f.field] ?? null;
    if (!project.slides.some(s => s.id === f.slideId) || JSON.stringify(before) !== JSON.stringify(f.before) || JSON.stringify(copy[plan.source]?.[f.slideId]?.[f.field]) !== JSON.stringify(f.value)) throw new Error('Text changed while translating. Run the translation again to keep your latest edits.');
  }
  const doc = structuredClone(copy[plan.target] ?? {});
  for (const f of plan.fields) {
    if (!own(doc, f.slideId)) Object.defineProperty(doc, f.slideId, { value: {}, enumerable: true, writable: true, configurable: true });
    const value = f.ids.map((id, i) => id ? values.get(id) : (Array.isArray(f.value) ? f.value[i] : f.value));
    Object.defineProperty(doc[f.slideId], f.field, { value: Array.isArray(f.value) ? value : value[0], enumerable: true, writable: true, configurable: true });
  }
  doc._meta = { ...doc._meta, status: 'draft', needsReview: ['*'] };
  return doc;
}
