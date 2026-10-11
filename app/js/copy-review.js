import { copyFields } from './copy-fields.js';

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
