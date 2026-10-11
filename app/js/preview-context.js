/** Read-only context around the active slide, in the project's export order. */
export function adjacentSlides(slides, id) {
  const index = slides.findIndex(slide => slide.id === id);
  return index < 0 ? [null, null] : [slides[index - 1] ?? null, slides[index + 1] ?? null];
}

/** One badge per warning kind, with every affected text retained in the tooltip. */
export function previewWarnings(warnings) {
  const groups = new Map();
  const labels = { shrunk: 'Text scaled to fit', overflow: 'Text too long', 'missing-translation': 'Using English', 'capture-missing': 'No screenshot' };
  for (const warning of warnings) {
    if (warning.level === 'info') continue;
    const key = `${warning.level}:${warning.code}`;
    const group = groups.get(key);
    if (group) group.message += `\n${warning.message}`;
    else groups.set(key, { ...warning, label: labels[warning.code] ?? warning.code });
  }
  return [...groups.values()].sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error'));
}

/** Preferences stay in local UI storage, independent of project/export data. */
export function neighborPreferences(ui) {
  const opacity = Number.isFinite(ui.neighborOpacity) ? Math.min(100, Math.max(0, ui.neighborOpacity)) : 70;
  return { visible: ui.showNeighbors !== false, opacity };
}
