const screenKey = file => file.slideId ?? file.slide ?? file.path;
/** Show each main screen once; translations and alternate sizes are represented by counts. */
export function exportPreviews(files, limit = 4, { appStoreOnly = true } = {}) {
  const eligible = appStoreOnly && files.some(file => file.store === 'app-store') ? files.filter(file => file.store === 'app-store') : files;
  const locale = eligible.some(file => file.locale === 'en-US') ? 'en-US' : eligible[0]?.locale;
  const rank = file => file.target === 'iphone' || file.device === 'iphone' ? 0 : /header|search|feature|banner/.test(file.target ?? '') ? 2 : 1;
  // Prefer the main language, but retain screens that only exist in another language.
  const candidates = [...eligible].sort((a, b) => Number(b.locale === locale) - Number(a.locale === locale) || rank(a) - rank(b) || (a.sourcePosition ?? a.position ?? 0) - (b.sourcePosition ?? b.position ?? 0));
  const seen = new Set(), images = [];
  for (const file of candidates) {
    const key = screenKey(file);
    if (seen.has(key)) continue;
    seen.add(key); images.push(file);
  }
  images.sort((a, b) => (a.sourcePosition ?? a.position ?? 0) - (b.sourcePosition ?? b.position ?? 0));
  return { locale, total: images.length, images: images.slice(0, limit) };
}

/** Counts come from real files, since every screen need not support every size. */
export function exportContentsInfo(files) {
  return {
    count: files.length,
    screenCount: new Set(files.map(screenKey)).size,
    sizeCount: new Set(files.map(file => file.device ?? file.canvas ?? file.size?.join('x'))).size,
    locales: [...new Set(files.map(file => file.locale))],
    canvases: [...new Set(files.map(file => file.canvas ?? file.device))].filter(Boolean),
  };
}
