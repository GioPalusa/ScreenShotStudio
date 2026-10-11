// An inspector rebuild is a repaint, not navigation. Keep its viewport and disclosures.
export function createInspectorMemory() {
  const entries = new Map();
  return {
    capture(key, panel) {
      if (!panel || !key) return;
      entries.delete(key);
      entries.set(key, { top: panel.scrollTop, sections: new Map([...panel.querySelectorAll('details[data-section]')].map(node => [node.dataset.section, node.open])) });
      if (entries.size > 80) entries.delete(entries.keys().next().value);
    },
    restore(key, panel) {
      const saved = entries.get(key);
      if (!saved) return;
      for (const node of panel.querySelectorAll('details[data-section]')) {
        if (saved.sections.has(node.dataset.section)) node.open = saved.sections.get(node.dataset.section);
      }
      panel.scrollTop = saved.top;
    },
  };
}
