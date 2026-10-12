/** Languages without an explicit order follow the original language's current order. */
export function orderedSlides(project, localeId) {
  const original = project.locales?.find(l => l.id === project.sourceLocale)?.id ?? project.locales?.[0]?.id;
  const order = project.slideOrders?.[localeId] ?? project.slideOrders?.[original] ?? [];
  const remaining = new Map((project.slides ?? []).map(slide => [slide.id, slide]));
  const result = [];
  for (const id of order) {
    if (remaining.has(id)) { result.push(remaining.get(id)); remaining.delete(id); }
  }
  return [...result, ...remaining.values()];
}
