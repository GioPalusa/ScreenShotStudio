import { copyFields } from './copy-fields.js';

export const originalLocale = project => project.locales?.find(l => l.id === project.sourceLocale)?.id ?? project.locales?.[0]?.id;
export const isOriginalLocale = (project, locale) => originalLocale(project) === locale;

/** Review applies to translations and only to fields still used by the design. */
export function localeNeedsReview(project, copy, locale, slideId = null, field = null) {
  if (isOriginalLocale(project, locale)) return false;
  return project.slides.filter(s => slideId === null || s.id === slideId).some(slide =>
    copyFields(project, copy, slide, locale).some(key => (field === null || key === field) && copyNeedsReview(copy[locale], slide.id, key)));
}

export function setSlideReviewed(project, copy, locale, slideId) {
  const slide = project.slides.find(s => s.id === slideId);
  if (!slide) return;
  for (const field of copyFields(project, copy, slide, locale)) setFieldReview(project, copy, locale, slideId, field, false);
}

// One review policy for the editor, exchange files and final-export validation.
export function copyNeedsReview(doc, slideId = null, field = null) {
  const meta = doc?._meta;
  if (meta?.status !== 'approved' && meta?.reviewMode !== 'fields') return true;
  return (meta.needsReview ?? []).some(key => slideId === null || key === '*' || key === slideId ||
    (field === null ? key.startsWith(`${slideId}.`) : key === `${slideId}.${field}`));
}

/** Expand legacy whole-language/slide flags before clearing one field. Other text stays pending. */
export function setFieldReview(project, copy, localeId, slideId, field, pending) {
  const doc = (copy[localeId] ??= {});
  const explicit = doc._meta?.reviewMode === 'fields' && !(doc._meta.needsReview ?? []).some(key => key === '*' || project.slides.some(slide => key === slide.id));
  const list = new Set(explicit ? doc._meta.needsReview : []);
  for (const slide of explicit ? [] : project.slides) {
    for (const key of copyFields(project, copy, slide, localeId)) if (copyNeedsReview(doc, slide.id, key)) list.add(`${slide.id}.${key}`);
  }
  const key = `${slideId}.${field}`;
  if (pending) list.add(key); else list.delete(key);
  doc._meta = { ...(doc._meta ?? {}), reviewMode: 'fields', status: list.size ? 'draft' : 'approved', needsReview: [...list] };
}
