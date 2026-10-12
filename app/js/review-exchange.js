// Portable, spreadsheet-friendly review exchange. No filesystem or UI dependencies.
import { copyFields, safeCopyKey } from './copy-fields.js';
import { localeNeedsReview, setFieldReview, originalLocale } from './copy-review.js';

export const REVIEW_FORMAT = 'SSS-COPY-1';
export const REVIEW_COLUMNS = ['format', 'project_id', 'screen_uid', 'screen_id', 'screen_name', 'language', 'field', 'type', 'source_text', 'source_json', 'original_json', 'original_check', 'text', 'decision'];
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const validText = value => value === null || typeof value === 'string' || (Array.isArray(value) && value.every(v => typeof v === 'string'));
const fieldValue = (copy, locale, slide, field) => copy[locale]?.[slide]?.[field] ?? null;

/** IDs travel with Save As and never depend on a path, title or screen order. */
export function ensureReviewIdentity(project, makeId) {
  let changed = false;
  if (!project.reviewId) { project.reviewId = makeId(); changed = true; }
  const seen = new Set();
  for (const slide of project.slides) {
    if (!slide.reviewId || seen.has(slide.reviewId)) { slide.reviewId = makeId(); changed = true; }
    seen.add(slide.reviewId);
  }
  return changed;
}
const displayText = value => Array.isArray(value) ? value.join('\n') : value ?? '';
// Keep formula-like text literal in spreadsheets; escape a real leading apostrophe too.
const safeCell = value => /^[=+@\-\t\r\n']/.test(value) ? `'${value}` : value;
const readCell = value => /^'[=+@\-\t\r\n']/.test(value) ? value.slice(1) : value;
export function writeCSV(rows) {
  return '\ufeff' + rows.map(row => row.map(value => `"${safeCell(String(value ?? '')).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}
export function readCSV(text) {
  if (typeof text !== 'string' || text.length > 20 * 1024 * 1024) throw new Error('Choose a CSV review file smaller than 20 MB.');
  text = text.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Excel uses semicolon CSV in some system locales. Detect only separators outside quoted headers.
  let headerQuoted = false, separator = ',';
  for (const char of text.split('\n', 1)[0]) {
    if (char === '"') headerQuoted = !headerQuoted;
    else if (!headerQuoted && (char === ',' || char === ';')) { separator = char; break; }
  }
  const rows = []; let row = [], value = '', quoted = false, ended = false;
  const cell = () => { row.push(readCell(value)); value = ''; ended = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; ended = true; } }
      else value += c;
    } else if (c === separator) cell();
    else if (c === '\n') { cell(); if (row.some(Boolean)) rows.push(row); row = []; }
    else if (c === '"' && !value && !ended) quoted = true;
    else if (ended || c === '"') throw new Error('Invalid CSV quoting. Export as UTF-8 CSV from your spreadsheet app.');
    else value += c;
    if (rows.length > 100000 || value.length > 1024 * 1024) throw new Error('The review file is too large.');
  }
  if (quoted) throw new Error('The CSV file ends inside a quoted cell.');
  if (value || row.length || ended) { cell(); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

export function exportReviewCSV(project, copy, localeIds = project.locales.map(l => l.id)) {
  if (!project.reviewId || project.slides.some(s => !s.reviewId)) throw new Error('Save the project’s review IDs before exporting.');
  const rows = [REVIEW_COLUMNS];
  for (const locale of project.locales.filter(l => localeIds.includes(l.id))) for (const slide of project.slides) {
    for (const field of copyFields(project, copy, slide, locale.id)) {
      const original = fieldValue(copy, locale.id, slide.id, field), source = fieldValue(copy, originalLocale(project), slide.id, field);
      const list = Array.isArray(original) || Array.isArray(source) || field === 'bullets';
      const type = list ? (original ?? source ?? []).some(v => /[\r\n]/.test(v)) ? 'json-list' : 'list' : 'text';
      rows.push([REVIEW_FORMAT, project.reviewId, slide.reviewId, slide.id, slide.name ?? slide.id, locale.id, field, type,
        displayText(source), JSON.stringify(source), JSON.stringify(original), localeNeedsReview(project, copy, locale.id, slide.id, field) ? 'check' : 'reviewed',
        type === 'json-list' ? JSON.stringify(original ?? []) : displayText(original), '']);
    }
  }
  return writeCSV(rows);
}

export function parseReviewCSV(text) {
  const [headers, ...lines] = readCSV(text);
  if (!headers || new Set(headers).size !== headers.length || REVIEW_COLUMNS.some(key => !headers.includes(key))) throw new Error('This is not a Screenshot Studio review CSV. Keep the exported column names.');
  const seen = new Set();
  return lines.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2}: the column count has changed.`);
    const row = Object.fromEntries(headers.map((key, i) => [key, values[i]]));
    row.line = index + 2;
    if (row.format !== REVIEW_FORMAT) throw new Error(`Row ${row.line}: unsupported review format.`);
    if (!safeCopyKey(row.field) || !['text', 'list', 'json-list'].includes(row.type) || !['check', 'reviewed'].includes(row.original_check)) throw new Error(`Row ${row.line}: invalid field or review metadata.`);
    row.decision = row.decision.trim().toLowerCase();
    if (!['', 'check', 'reviewed'].includes(row.decision)) throw new Error(`Row ${row.line}: decision must be blank, check or reviewed.`);
    try {
      row.original = JSON.parse(row.original_json); row.source = JSON.parse(row.source_json);
      row.incoming = row.type === 'json-list' ? JSON.parse(row.text) : row.type === 'list' ? row.text === '' ? [] : row.text.split('\n') : row.text;
      if (!validText(row.original) || !validText(row.source) || !validText(row.incoming)) throw new Error();
      if (row.type === 'text' ? Array.isArray(row.original) || typeof row.incoming !== 'string' : (row.original !== null && !Array.isArray(row.original)) || !Array.isArray(row.incoming)) throw new Error();
    } catch { throw new Error(`Row ${row.line}: invalid original text or list. Keep the original/source JSON columns unchanged.`); }
    // Blank cells remove a translation, matching the editor's fallback behaviour.
    if (row.incoming === '' || (Array.isArray(row.incoming) && row.incoming.every(v => !v))) row.incoming = null;
    const key = JSON.stringify([row.screen_uid, row.language, row.field]);
    if (seen.has(key)) throw new Error(`Row ${row.line}: duplicate text entry. Each screen/language/field may appear only once.`);
    seen.add(key); row.key = key;
    return row;
  });
}

export function planReviewImport(project, copy, rows) {
  if (!rows.length) throw new Error('This review file has no text rows.');
  if (!project.reviewId || rows.some(row => row.project_id !== project.reviewId)) throw new Error('This review file belongs to a different project. Open the project it was exported from.');
  const slides = new Map(project.slides.map(s => [s.reviewId, s]));
  const locales = new Set(project.locales.map(l => l.id));
  const fields = new Map();
  return rows.map(row => {
    const slide = slides.get(row.screen_uid);
    const item = { ...row, slideId: slide?.id, screenName: slide?.name ?? row.screen_name };
    const skip = reason => ({ ...item, status: 'skipped', reason });
    if (!slide) return skip('Screen no longer exists');
    if (!locales.has(row.language)) return skip('Language no longer exists');
    const fieldKey = `${slide.id}/${row.language}`;
    if (!fields.has(fieldKey)) fields.set(fieldKey, copyFields(project, copy, slide, row.language));
    if (!fields.get(fieldKey).includes(row.field)) return skip('Text field no longer exists');
    const current = fieldValue(copy, row.language, slide.id, row.field);
    const check = localeNeedsReview(project, copy, row.language, slide.id, row.field);
    const changedText = !equal(row.incoming, row.original);
    const pending = row.decision ? row.decision === 'check' : changedText ? true : check;
    const currentSource = fieldValue(copy, originalLocale(project), slide.id, row.field);
    Object.assign(item, { current, currentCheck: check, currentSource, pending, deletion: changedText && row.incoming === null });
    if ((!changedText && !row.decision) || (equal(current, row.incoming) && (!row.decision || check === pending))) return { ...item, status: 'unchanged' };
    const reasons = [];
    if (!equal(current, row.original) && !equal(current, row.incoming)) reasons.push('Text changed in the project');
    if (check !== (row.original_check === 'check') && check !== pending) reasons.push('Review status changed in the project');
    if (row.language !== 'en-US' && !equal(currentSource, row.source)) reasons.push('English source changed');
    return { ...item, status: reasons.length ? 'conflict' : 'ready', reason: reasons.join(' · ') };
  });
}

/** Recheck the exact preview before producing replacement documents, then apply as one undo step. */
export function applyReviewImport(project, copy, rows, selected) {
  const fresh = new Map(planReviewImport(project, copy, rows).map(row => [row.key, row]));
  const next = structuredClone(copy), locales = new Set();
  for (const preview of selected) {
    const row = fresh.get(preview.key);
    if (!row || !['ready', 'conflict'].includes(row.status) || row.slideId !== preview.slideId || !equal(row.current, preview.current) || row.currentCheck !== preview.currentCheck || !equal(row.currentSource, preview.currentSource)) throw new Error('The project changed while this preview was open. Import the file again to review the latest changes.');
    const doc = (next[row.language] ??= {}), slide = (doc[row.slideId] ??= {});
    if (row.incoming === null) delete slide[row.field]; else slide[row.field] = structuredClone(row.incoming);
    setFieldReview(project, next, row.language, row.slideId, row.field, row.pending);
    locales.add(row.language);
  }
  return { copy: next, locales: [...locales] };
}
