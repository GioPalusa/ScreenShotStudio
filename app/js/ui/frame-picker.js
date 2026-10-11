import { engine } from '../store.js';
import { allFrames, sameFrame, frameScreenSize } from '../frames.js';
import { composeDuo, composeAndroid, composeGeneric, composePlain } from '../devices.js';
import { genericFrame } from '../generic-frame.js';
import { framesForTarget, frameSizeText, frameGroups, frameModels } from '../frame-matching.js';
import { h, modal } from './helpers.js';

/** The same frame artwork used by exports, reduced to a gallery thumbnail. */
export function frameThumbnail(ref, { screenSize, capture } = {}) {
  if (ref.type === 'bezel') return h('img', { src: engine.assetUrl('frames', ref.name), alt: '', loading: 'lazy' });
  const options = { def: ref.type === 'plain' ? { ...ref, screen: ref.screen ?? screenSize ?? [360, 640] } : ref, capture, placeholder: [], fit: 'fill', align: 'center' };
  const composed = ref.type === 'android' ? composeAndroid(options) : ref.type === 'duo' ? composeDuo(options) : ref.type === 'generic' ? composeGeneric(options) : composePlain(options);
  const thumb = h('canvas', { 'aria-hidden': 'true' });
  const scale = Math.min(240 / composed.w, 180 / composed.h);
  const density = Math.min(window.devicePixelRatio || 1, 2);
  thumb.style.width = `${Math.round(composed.w * scale)}px`; thumb.style.height = `${Math.round(composed.h * scale)}px`;
  thumb.width = Math.round(composed.w * scale * density); thumb.height = Math.round(composed.h * scale * density);
  thumb.getContext('2d').drawImage(composed.canvas, 0, 0, thumb.width, thumb.height);
  return thumb;
}

export function chooseFrame({ selected, defaultFrame, target, onPick, onManage }) {
  const project = engine.project, frames = engine.data.frames;
  const options = target ? framesForTarget(target, frames) : allFrames(frames);
  const groups = frameGroups(options, frames);
  const current = selected ?? defaultFrame ?? { type: 'plain' };
  const currentGroup = groups.find(group => group.options.some(option => sameFrame(option.ref, current)));
  let family = currentGroup?.id ?? groups.find(group => group.id === target?.family)?.id ?? groups[0]?.id;
  const body = h('div', { class: 'frame-picker' });
  const status = h('div', { class: 'hint err', role: 'alert' });
  const pick = ref => {
    if (engine.project !== project) { status.textContent = 'The project changed. Reopen the frame picker.'; return; }
    m.close();
    onPick(ref ? structuredClone(ref) : undefined);
  };
  const m = modal({ title: current.type === 'plain' ? 'Add a device frame' : 'Choose a device frame', wide: true, body,
    actions: [
      h('button', { class: 'btn', 'aria-pressed': String(current.type === 'plain'), onClick: () => pick({ type: 'plain', ...(target?.screen ? { screen: [...target.screen] } : {}) }) }, 'No frame'),
      target?.screen ? h('button', { class: 'btn', 'aria-pressed': String(current.type === 'generic'), onClick: () => pick(genericFrame(target)) }, 'Generic frame') : null,
      selected && defaultFrame && defaultFrame.type !== 'plain' && !sameFrame(selected, defaultFrame) ? h('button', { class: 'btn', onClick: () => pick(undefined) }, 'Use device default') : null,
      status, h('span', { class: 'spacer' }),
      onManage ? h('button', { class: 'btn', onClick: () => { m.close(); onManage(); } }, 'Get more frames') : null,
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
    ] });
  const card = ({ ref, label, fit, meta }) => h('button', {
    class: 'frame-choice', title: `Use ${label}`, 'aria-label': `Use ${label}`, 'aria-pressed': String(sameFrame(current, ref)),
    onClick: () => pick(ref),
  }, h('div', { class: 'frame-thumb' }, frameThumbnail(ref, { screenSize: target?.screen })),
  h('b', null, meta?.variant ?? label),
  fit ? h('span', { class: `chip ${fit.kind === 'exact' ? 'ok' : ''}` }, fit.label) : null,
  h('small', null, `${frameSizeText(fit?.screen ?? frameScreenSize(ref, { frames }))} screen`));
  const tabs = h('div', { class: 'frame-families', role: 'group', 'aria-label': 'Device type' });
  const gallery = h('div', { class: 'frame-gallery' });
  const show = id => {
    family = id;
    for (const button of tabs.children) button.setAttribute('aria-pressed', String(button.dataset.family === family));
    const group = groups.find(item => item.id === family);
    gallery.replaceChildren();
    if (!group) return;
    gallery.append(h('div', { class: 'frame-group-heading' }, h('h4', null, group.label), h('span', { class: 'hint' }, `${group.options.length} frames`)));
    for (const model of frameModels(group.options, frames)) {
      gallery.append(h('section', { class: 'frame-model' }, h('h5', null, model.label), h('div', { class: 'frame-picker-grid' }, model.options.map(card))));
    }
  };
  for (const group of groups) tabs.append(h('button', { class: 'btn small', dataset: { family: group.id }, onClick: () => show(group.id) }, group.label));
  body.append(h('p', { class: 'hint' }, 'Click a frame to apply it. To add Apple bezels, use Get more frames below.'), tabs);
  if (target) body.append(h('p', { class: 'hint' }, `${target.label} · ${frameSizeText(target.screen)} screen. Other sizes are fitted automatically; check cropping in Screenshot.`));
  body.append(gallery);
  show(family);
}
