// Font faces belong to a document/preview. Unique aliases prevent one open project's
// fonts from changing another project's canvas. No global font installation is needed.
let serial = 0;
export class ProjectFonts {
  constructor() { this.faces = new Map(); this.families = new Map(); this.disposed = false; }
  dispose() { this.disposed = true; for (const { face } of this.faces.values()) document.fonts.delete(face); this.faces.clear(); this.families.clear(); }
  retryFailed() { for (const [key, record] of this.faces) if (record.failed) { document.fonts.delete(record.face); this.faces.delete(key); } }
  family(name) { return this.families.get(name)?.alias ?? name; }
  async prepare(entries, baseURL) {
    const active = new Set(), failures = [];
    for (const entry of entries ?? []) {
      if (!entry || typeof entry.family !== 'string' || typeof entry.file !== 'string') continue;
      const url = entry.file.startsWith('data:font/') ? entry.file : `${baseURL}/assets/fonts/${encodeURIComponent(entry.file)}`;
      const key = JSON.stringify([entry.family, entry.weight, entry.style, url]); active.add(key);
      if (!this.faces.has(key)) {
        let family = this.families.get(entry.family);
        if (!family) { family = { alias: `Studio document font ${++serial}` }; this.families.set(entry.family, family); }
        const face = new FontFace(family.alias, `url(${JSON.stringify(url)})`, { weight: String(entry.weight ?? 400), style: entry.style ?? 'normal' });
        const record = { face, family: entry.family };
        record.promise = Promise.race([face.load(), new Promise((_, reject) => { record.timer = setTimeout(() => reject(Error('Font loading timed out')), 15000); })])
          .then(() => { if (!this.disposed) { document.fonts.add(face); record.loaded = true; } })
          .catch(() => { record.failed = true; })
          .finally(() => clearTimeout(record.timer));
        this.faces.set(key, record);
      }
      const record = this.faces.get(key); await record.promise;
      if (record.failed) failures.push(entry.family);
    }
    for (const [key, record] of this.faces) if (!active.has(key)) { document.fonts.delete(record.face); this.faces.delete(key); }
    for (const name of this.families.keys()) if (![...this.faces.values()].some(r => r.family === name)) this.families.delete(name);
    return [...new Set(failures)];
  }
}

export function mergeProjectFonts(existing = [], added = []) {
  const entries = new Map(existing.map(f => [`${f.family}:${f.style}:${f.weight}`, f]));
  for (const font of added) entries.set(`${font.family}:${font.style}:${font.weight}`, font);
  return [...entries.values()];
}
