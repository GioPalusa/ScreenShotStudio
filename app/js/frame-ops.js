import { profilesFor } from './profiles.js';
import { genericFrame } from './generic-frame.js';

/** Reference holders, including saved linked layouts and locale-specific overrides. */
export function frameReferences(project, name, frames = {}) {
  const uses = [];
  const add = (holder, owner) => {
    if (holder?.frame?.type === 'bezel' && holder.frame.name === name) uses.push({ holder, owner });
  };
  for (const [id, device] of Object.entries(project.devices ?? {})) add(device, `device:${id}`);
  for (const [id, profile] of Object.entries(profilesFor(project, frames))) {
    if (profile.frame?.type === 'bezel' && profile.frame.name === name) uses.push({ holder: profile, owner: `profile:${id}`, profileId: id });
  }
  const block = (value, owner) => {
    if (!value) return;
    if (value.linkedLayout) block(value.linkedLayout, owner);
    for (const layer of [...(value.layers ?? []), ...Object.values(value.overrides ?? {})]) add(layer, owner);
  };
  const scan = (value, owner) => {
    for (const layout of Object.values(value.layouts ?? {})) block(layout, owner);
    for (const layouts of Object.values(value.localeLayouts ?? {})) for (const layout of Object.values(layouts)) block(layout, owner);
  };
  for (const [id, layout] of Object.entries(project.sharedCanvas ?? {})) block(layout, `all-screens:${id}`);
  for (const slide of project.slides ?? []) scan(slide, slide.id);
  for (const [id, template] of Object.entries(project.templates ?? {})) scan(template, `template:${id}`);
  return uses;
}

/** Keep the removed bezel's screen proportions; canvas size is independent of hardware. */
export function replaceFrameReferences(project, name, frames = {}) {
  const uses = frameReferences(project, name, frames);
  for (const { holder, profileId } of uses) {
    const screen = frames[name]?.screen;
    const ref = genericFrame({ screen: screen ? [screen.w, screen.h] : holder.screen ?? [1206, 2622] });
    if (profileId) (project.profiles ??= {})[profileId] = { ...holder, frame: ref };
    else holder.frame = ref;
  }
  return uses.length;
}
