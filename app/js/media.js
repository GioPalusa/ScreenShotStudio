import { resolveLayers } from './layouts.js';
import { deviceForLayer, profilesFor } from './profiles.js';
import { originalLocale } from './copy-review.js';

/** A language override wins; otherwise use the shared image or the original language's image. */
export function captureSourceFor(project, captures, localeId, set, name) {
  for (const scope of [...new Set([localeId, 'default', originalLocale(project)])]) {
    const hit = captures[scope]?.[set]?.[name];
    if (hit) return { ...hit, scope, localized: scope === localeId };
  }
  return null;
}

export function screenshotCollections(project, captures = {}) {
  const labels = new Map();
  for (const profile of Object.values(profilesFor(project))) labels.set(profile.capture, profile.label);
  for (const device of Object.values(project.devices)) labels.set(device.capture, device.short ?? device.label);
  for (const scope of Object.values(captures)) for (const set of Object.keys(scope)) if (!labels.has(set)) labels.set(set, set.replace(/[-_]/g, ' '));
  return [...labels].filter(([id]) => id).map(([id, label]) => ({ id, label }));
}

/** Count every visible or hidden reference, including language fallback. Never delete an in-use capture. */
export function captureUsage(project, captures, { scope, set, name }) {
  const uses = [];
  for (const slide of project.slides) for (const [deviceId, canvas] of Object.entries(project.devices)) for (const locale of project.locales) {
    for (const layer of resolveLayers({ project, slide, deviceId, localeId: locale.id }).layers) {
      if (layer.type !== 'device' || layer.capture !== name || deviceForLayer(project, canvas, layer).capture !== set) continue;
      const source = captureSourceFor(project, captures, locale.id, set, name)?.scope;
      if (source === scope) uses.push({ slideId: slide.id, deviceId, localeId: locale.id, layerId: layer.id });
    }
  }
  // Preserve dormant template/restore references, even when no current slide resolves them.
  const scan = value => {
    if (!value || typeof value !== 'object') return;
    if (value.capture === name && (!value.captureSet || value.captureSet === set)) uses.push({ owner: 'saved layout' });
    for (const child of Object.values(value)) scan(child);
  };
  for (const template of Object.values(project.templates ?? {})) scan(template);
  for (const slide of project.slides) for (const block of [...Object.values(slide.layouts ?? {}), ...Object.values(slide.localeLayouts ?? {}).flatMap(Object.values)]) if (block.linkedLayout) scan(block.linkedLayout);
  return uses;
}

export function captureItems(captures, localeId = null) {
  const items = [];
  for (const [scope, sets] of Object.entries(captures ?? {})) {
    if (localeId && scope !== 'default' && scope !== localeId) continue;
    for (const [set, files] of Object.entries(sets)) for (const [name, meta] of Object.entries(files)) {
      if (localeId && scope === 'default' && captures[localeId]?.[set]?.[name]) continue;
      items.push({ kind: 'screenshots', scope, set, name, ...meta, key: `capture:${scope}:${set}:${name}` });
    }
  }
  return items;
}

export function imageUsage(project, file) {
  const uses = [];
  const scan = (owner, label) => {
    for (const [key, block] of Object.entries({ ...(owner.layouts ?? {}), ...Object.fromEntries(Object.entries(owner.localeLayouts ?? {}).flatMap(([loc, layouts]) => Object.entries(layouts).map(([id, b]) => [`${loc}/${id}`, b]))) })) {
      if (block?.linkedLayout) scan({ layouts: { linked: block.linkedLayout } }, label);
      const layers = [...(block?.layers ?? []), ...Object.entries(block?.overrides ?? {}).filter(([, o]) => o && typeof o === 'object').map(([id, patch]) => ({ ...patch, id }))];
      for (const layer of layers) {
        const srcs = [layer.src, ...Object.values(layer.variants ?? {})];
        if (srcs.includes(file) || srcs.includes(file.replace(/\.png$/, ''))) uses.push({ owner: label, deviceKey: key, layerId: layer.id });
      }
    }
  };
  scan({ layouts: project.sharedCanvas }, 'All screens');
  for (const slide of project.slides) scan(slide, slide.id);
  for (const [id, tpl] of Object.entries(project.templates ?? {})) scan(tpl, `template:${id}`);
  for (const pano of Object.values(project.panorama ?? {})) for (const art of pano.art ?? []) {
    const srcs = [art.src, ...Object.values(art.variants ?? {})];
    if (srcs.includes(file) || srcs.includes(file.replace(/\.png$/, ''))) uses.push({ owner: 'decorations', deviceKey: '', layerId: art.id });
  }
  return uses;
}
