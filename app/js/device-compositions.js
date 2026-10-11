import { canvasForSlide } from './canvas-orientation.js';
import { PLAY_TARGETS } from './google-play.js';
// Device-only compositions: normalised poses shared by neutral previews and editable layouts.
import { canvasMetrics, resolveLayers } from './layouts.js';
import { profilesFor } from './profiles.js';
import { frameScreenSize, frameOuterSize } from './frames.js';
import { uniqueId, slugify } from './layer-ops.js';
const stripPrivate = layer => structuredClone(Object.fromEntries(Object.entries(layer).filter(([key])=>!key.startsWith('_'))));
const p = (x, y, h, rotate = 0) => ({ x, y, h, rotate });
const d = (id, name, poses, crop = false) => ({ id, name, poses, crop, count: poses.length });
export const DEVICE_COMPOSITIONS = [
  d('center', 'Centre stage', [p(.5,.5,.78)]),
  d('lower', 'Room above', [p(.5,.65,.62)]),
  d('upper', 'Room below', [p(.5,.35,.62)]),
  d('left', 'Left anchor', [p(.28,.5,.70)]),
  d('right', 'Right anchor', [p(.72,.5,.70)]),
  d('lean-left', 'Lean left', [p(.5,.52,.74,-12)]),
  d('lean-right', 'Lean right', [p(.5,.52,.74,12)]),
  d('diagonal', 'Diagonal', [p(.5,.5,.85,-32)]),
  d('horizontal', 'Horizontal', [p(.5,.5,.80,90)]),
  d('close-up', 'Close-up', [p(.5,.72,1.15)], true),
  d('edge-left', 'Edge reveal', [p(.12,.62,.9,12)], true),
  d('edge-top', 'From above', [p(.5,.20,.95,-14)], true),
  d('parallel', 'Side by side', [p(.28,.5,.65),p(.72,.5,.65)]),
  d('duet', 'Duet', [p(.32,.50,.65,-10),p(.68,.50,.65,10)]),
  d('cross', 'Cross paths', [p(.42,.46,.66,-22),p(.60,.54,.66,22)]),
  d('overlap', 'Layered pair', [p(.35,.43,.65,-6),p(.62,.57,.69,6)]),
  d('stagger', 'Stagger', [p(.30,.35,.56),p(.70,.65,.56)]),
  d('sidekick', 'Sidekick', [p(.43,.48,.78),p(.73,.67,.42,12)]),
  d('bookends', 'Bookends', [p(.15,.52,.76,-14),p(.85,.52,.76,14)], true),
  d('stack', 'Vertical pair', [p(.50,.26,.43,90),p(.50,.74,.43,90)]),
  d('fan', 'Fan', [p(.24,.52,.59,-18),p(.76,.52,.59,18),p(.50,.48,.70)]),
  d('cascade', 'Cascade', [p(.26,.30,.49,-12),p(.50,.50,.49,-12),p(.74,.70,.49,-12)]),
  d('steps', 'Three steps', [p(.22,.36,.47),p(.50,.50,.47),p(.78,.64,.47)]),
  d('trio', 'Trio', [p(.19,.50,.55),p(.50,.50,.65),p(.81,.50,.55)]),
  d('triangle', 'Triangle', [p(.50,.28,.45),p(.28,.70,.45,-8),p(.72,.70,.45,8)]),
  d('orbit', 'Orbit', [p(.24,.33,.45,-25),p(.73,.42,.48,18),p(.43,.76,.45,-8)]),
  d('grid', 'Four square', [p(.27,.27,.43),p(.73,.27,.43),p(.27,.73,.43),p(.73,.73,.43)]),
  d('tilted-grid', 'Tilted tiles', [p(.26,.24,.42,-14),p(.72,.33,.42,-14),p(.28,.68,.42,-14),p(.74,.77,.42,-14)]),
  d('wall', 'Screen wall', [p(.15,.24,.39),p(.50,.24,.39),p(.85,.24,.39),p(.32,.73,.39),p(.68,.73,.39)]),
  d('scatter', 'Constellation', [p(.22,.20,.34,-16),p(.73,.22,.34,14),p(.48,.50,.44),p(.20,.80,.34,10),p(.79,.78,.34,-14)]),
];

// Wider hardware needs its own spacing, angles and visual hierarchy. Slots constrain the rotated
// frame in both dimensions, so a landscape Duo is not squeezed into a tall phone arrangement.
const slot = (x, y, w, h, rotate = 0) => ({ x, y, w, h, rotate });
const TABLET_POSES = {
  center: [slot(.5,.5,.78,.78)],
  lower: [slot(.5,.66,.80,.55)],
  upper: [slot(.5,.34,.80,.55)],
  left: [slot(.32,.5,.52,.80)],
  right: [slot(.68,.5,.52,.80)],
  'lean-left': [slot(.5,.5,.82,.80,-8)],
  'lean-right': [slot(.5,.5,.82,.80,8)],
  diagonal: [slot(.5,.5,.88,.82,-20)],
  horizontal: [slot(.5,.5,.88,.70,90)],
  'close-up': [slot(.5,.78,1.15,1.12)],
  'edge-left': [slot(.10,.52,.95,.92,8)],
  'edge-top': [slot(.5,.15,1.05,.92,-8)],
  parallel: [slot(.27,.5,.40,.72),slot(.73,.5,.40,.72)],
  duet: [slot(.28,.42,.46,.61,-7),slot(.72,.58,.46,.61,7)],
  cross: [slot(.38,.38,.62,.62,-14),slot(.62,.62,.62,.62,14)],
  overlap: [slot(.35,.37,.58,.60,-5),slot(.63,.62,.62,.65,5)],
  stagger: [slot(.29,.29,.46,.45),slot(.71,.71,.46,.45)],
  sidekick: [slot(.40,.43,.65,.75),slot(.76,.73,.35,.40,8)],
  bookends: [slot(.08,.50,.66,.80,-8),slot(.92,.50,.66,.80,8)],
  stack: [slot(.50,.26,.80,.40),slot(.50,.74,.80,.40)],
  fan: [slot(.24,.58,.48,.56,-12),slot(.76,.58,.48,.56,12),slot(.50,.40,.52,.64)],
  cascade: [slot(.28,.24,.47,.42,-7),slot(.50,.50,.47,.42,-7),slot(.72,.76,.47,.42,-7)],
  steps: [slot(.20,.25,.30,.39),slot(.50,.50,.30,.39),slot(.80,.75,.30,.39)],
  trio: [slot(.18,.52,.26,.61),slot(.50,.48,.32,.72),slot(.82,.52,.26,.61)],
  triangle: [slot(.50,.26,.43,.39),slot(.26,.73,.40,.43,-5),slot(.74,.73,.40,.43,5)],
  orbit: [slot(.26,.25,.40,.41,-14),slot(.75,.47,.39,.45,12),slot(.30,.77,.40,.37,-6)],
  grid: [slot(.26,.26,.40,.40),slot(.74,.26,.40,.40),slot(.26,.74,.40,.40),slot(.74,.74,.40,.40)],
  'tilted-grid': [slot(.27,.24,.39,.38,-8),slot(.74,.30,.39,.38,-8),slot(.26,.70,.39,.38,-8),slot(.73,.76,.39,.38,-8)],
  wall: [slot(.18,.26,.25,.40),slot(.50,.26,.25,.40),slot(.82,.26,.25,.40),slot(.33,.73,.32,.40),slot(.67,.73,.32,.40)],
  scatter: [slot(.21,.20,.31,.28,-9),slot(.76,.22,.32,.29,9),slot(.50,.50,.40,.34),slot(.23,.80,.32,.28,6),slot(.80,.78,.30,.28,-8)],
};
const WIDE_POSES = {
  center: [slot(.5,.5,.86,.78)],
  lower: [slot(.5,.70,.86,.48)],
  upper: [slot(.5,.30,.86,.48)],
  left: [slot(.31,.5,.50,.82)],
  right: [slot(.69,.5,.50,.82)],
  'lean-left': [slot(.5,.5,.88,.78,-6)],
  'lean-right': [slot(.5,.5,.88,.78,6)],
  diagonal: [slot(.5,.5,.90,.84,-16)],
  horizontal: [slot(.5,.5,.86,.72)],
  'close-up': [slot(.5,.82,1.20,1.10)],
  'edge-left': [slot(.08,.52,1.0,.90,6)],
  'edge-top': [slot(.5,.12,1.1,.95,-6)],
  parallel: [slot(.27,.5,.40,.82),slot(.73,.5,.40,.82)],
  duet: [slot(.30,.35,.49,.47,-5),slot(.70,.65,.49,.47,5)],
  cross: [slot(.37,.37,.63,.56,-10),slot(.63,.63,.63,.56,10)],
  overlap: [slot(.35,.33,.59,.52,-3),slot(.65,.67,.60,.53,3)],
  stagger: [slot(.32,.27,.52,.42),slot(.68,.73,.52,.42)],
  sidekick: [slot(.43,.38,.74,.64),slot(.77,.78,.34,.32,6)],
  bookends: [slot(.03,.52,.72,.85,-6),slot(.97,.52,.72,.85,6)],
  stack: [slot(.50,.27,.84,.40),slot(.50,.73,.84,.40)],
  fan: [slot(.30,.68,.55,.43,-9),slot(.70,.68,.55,.43,9),slot(.50,.32,.66,.47)],
  cascade: [slot(.29,.22,.48,.32,-4),slot(.50,.50,.48,.32,-4),slot(.71,.78,.48,.32,-4)],
  steps: [slot(.23,.22,.35,.32),slot(.50,.50,.35,.32),slot(.77,.78,.35,.32)],
  trio: [slot(.18,.5,.25,.64),slot(.50,.5,.34,.80),slot(.82,.5,.25,.64)],
  triangle: [slot(.50,.26,.55,.39),slot(.26,.73,.42,.40,-4),slot(.74,.73,.42,.40,4)],
  orbit: [slot(.29,.23,.45,.33,-9),slot(.74,.50,.40,.37,9),slot(.30,.78,.46,.32,-4)],
  grid: [slot(.26,.26,.40,.40),slot(.74,.26,.40,.40),slot(.26,.74,.40,.40),slot(.74,.74,.40,.40)],
  'tilted-grid': [slot(.27,.23,.41,.36,-5),slot(.73,.30,.41,.36,-5),slot(.27,.70,.41,.36,-5),slot(.73,.77,.41,.36,-5)],
  wall: [slot(.18,.27,.25,.38),slot(.50,.27,.25,.38),slot(.82,.27,.25,.38),slot(.31,.73,.36,.39),slot(.69,.73,.36,.39)],
  scatter: [slot(.22,.19,.33,.26,-6),slot(.77,.21,.32,.26,6),slot(.50,.50,.46,.33),slot(.22,.80,.33,.26,4),slot(.79,.79,.32,.26,-6)],
};
export const compositionFamily = ratio => ratio >= 1.08 ? 'wide' : ratio >= .62 ? 'tablet' : 'phone';
export const compositionById = id => {
  const design = DEVICE_COMPOSITIONS.find(d => d.id === id);
  if (!design) throw new Error('Choose a device composition.');
  return design;
};
export function compositionHardware(project, profileId, frames = {}, deviceId = null) {
  const canvas = project.devices[deviceId];
  const profile = profileId ? profilesFor(project, frames)[profileId] : canvas && {
    label: canvas.short ?? canvas.label ?? deviceId,
    screen: frameScreenSize(canvas.frame, { frames, deviceSize: canvas.size }) ?? canvas.size,
    capture: canvas.capture,
    frame: canvas.frame ?? { type: 'plain', screen: canvas.size },
  };
  if (!profile) throw new Error('Choose a device.');
  const frame = profile.frame ?? { type: 'plain', screen: profile.screen };
  const size = frameOuterSize(frame, { frames, deviceSize: profile.screen }) ?? profile.screen;
  return { profile, ratio: size[0] / size[1] };
}
export function compositionGeometry(id, W, H, ratio) {
  if (![W,H,ratio].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid composition dimensions.');
  const design = compositionById(id);
  const family = compositionFamily(ratio);
  const poses = family === 'wide' ? WIDE_POSES[id] : family === 'tablet' ? TABLET_POSES[id] : design.poses;
  const boxes = poses.map(pose => {
    const a = pose.rotate * Math.PI / 180;
    const h = pose.w === undefined ? pose.h * H : Math.min(
      pose.w * W / (Math.abs(ratio * Math.cos(a)) + Math.abs(Math.sin(a))),
      pose.h * H / (Math.abs(ratio * Math.sin(a)) + Math.abs(Math.cos(a))),
    );
    return { cx:pose.x*W, cy:pose.y*H, h, w:h*ratio, rotate:pose.rotate };
  });
  if (id === 'parallel') {
    // A side-by-side pair must keep its gap even for wide hardware such as Watch or Mac.
    const width = boxes[1].cx - boxes[0].cx - W * .04;
    const scale = Math.min(1, width / boxes[0].w);
    for (const box of boxes) { box.w *= scale; box.h *= scale; }
  }
  const bounds = list => {
    const parts = list.map(b => { const a=b.rotate*Math.PI/180, w=Math.abs(b.w*Math.cos(a))+Math.abs(b.h*Math.sin(a)), h=Math.abs(b.w*Math.sin(a))+Math.abs(b.h*Math.cos(a)); return { l:b.cx-w/2,r:b.cx+w/2,t:b.cy-h/2,b:b.cy+h/2 }; });
    return { l:Math.min(...parts.map(b=>b.l)), r:Math.max(...parts.map(b=>b.r)), t:Math.min(...parts.map(b=>b.t)), b:Math.max(...parts.map(b=>b.b)) };
  };
  if (!design.crop) {
    const a=bounds(boxes), margin=Math.min(W,H)*.05, scale=Math.min(1,(W-margin*2)/(a.r-a.l),(H-margin*2)/(a.b-a.t));
    for (const b of boxes) { b.cx=W/2+(b.cx-W/2)*scale; b.cy=H/2+(b.cy-H/2)*scale; b.w*=scale; b.h*=scale; }
    const b=bounds(boxes), dx=Math.max(0,margin-b.l)-Math.max(0,b.r-W+margin), dy=Math.max(0,margin-b.t)-Math.max(0,b.b-H+margin);
    for (const box of boxes) { box.cx+=dx; box.cy+=dy; }
  } else {
    // Keep a broad device usable on a portrait canvas while retaining the deliberate crop.
    const maxWidth = Math.max(...boxes.map(b=>b.w)), scale = Math.min(1, W*1.15/maxWidth);
    for (const box of boxes) { box.w*=scale; box.h*=scale; }
  }
  return boxes;
}

/** Replace device layers only. Keep text/art and each matching device's screenshot identity. */
export function withDeviceComposition(project, slide, { designId, deviceIds, profileId, frames = {}, palette = null }) {
  const design = compositionById(designId);
  if (!deviceIds?.length || deviceIds.some(id=>!project.devices[id])) throw new Error('Choose valid canvases.');
  const next = structuredClone(slide); next.layouts ??= {};
  for (const deviceId of new Set(deviceIds)) {
    if (slide.layouts?.[deviceId]?.independent) continue;
    const {ratio,profile} = compositionHardware(project, profileId, frames, deviceId);
    const {W,H} = canvasMetrics(canvasForSlide(project, slide, deviceId));
    const resolved = resolveLayers({project,slide,deviceId,includeShared:false});
    const old = resolved.layers.filter(l=>l.type==='device');
    const kept = resolved.layers.filter(l=>l.type!=='device' && l._origin!=='panorama').map(l=>stripPrivate(l));
    const used = new Set(kept.map(l=>l.id));
    const layers = compositionGeometry(designId,W,H,ratio).map((box,i)=>{
      const prior=old[i], id=uniqueId(used,prior?.id ?? `device-${i+1}`); used.add(id);
      const source = {};
      for (const key of ['capture','fit','align','languageNeutral','name','tag','locked','hidden','opacity','shadow','allowUpscale','zOrder']) if (prior?.[key] !== undefined && !(key==='capture' && prior._captureFrom==='block')) source[key]=structuredClone(prior[key]);
      if ((prior?.profile ?? '') === (profileId ?? '') && prior?.captureSet) source.captureSet=prior.captureSet;
      // Fix the plain viewport so a differently sized capture cannot change the composition later.
      const frame = profile.frame?.type === 'plain' ? { ...profile.frame, screen: profile.screen } : undefined;
      return {id,type:'device',name:`${profile.label} ${i+1}`,...source,...(profileId?{profile:profileId}:{}),...(frame?{frame}:{}),cx:box.cx,top:box.cy-box.h/2,w:box.w,rotate:box.rotate,...(design.crop?{allowCrop:true}:{})};
    });
    const decorations = new Set(resolved.layers.filter(l=>l._origin==='panorama').map(l=>l.id));
    const overrides = Object.fromEntries(Object.entries(resolved.layout.overrides ?? {}).filter(([id])=>decorations.has(id)));
    next.layouts[deviceId] = {template:'custom',panorama:resolved.layout.panorama ?? true, ...(Object.keys(overrides).length ? {overrides:structuredClone(overrides)} : {}),
      ...(resolved.layout.capture !== undefined ? {capture:resolved.layout.capture} : {}), layers:[...layers,...kept]};
  }
  if (palette) next.colors={bg:palette.bg,ink:palette.ink};
  return next;
}

/** New slides start without app-specific art, captures or text. All canvas sizes get editable poses. */
export function newCompositionSlide(project, options, makeId) {
  const design = compositionById(options.designId);
  const id=uniqueId(project.slides.map(s=>s.id),slugify(design.name,'slide'));
  const blank={id,reviewId:makeId(),name:design.name,theme:options.theme ?? Object.keys(project.themes ?? {})[0],capture:null,
    layouts:Object.fromEntries(Object.keys(project.devices).map(id=>[id,{template:'custom',panorama:false}]))};
  const next = withDeviceComposition(project,blank,{...options,deviceIds:Object.keys(project.devices)});
  for (const [id, canvas] of Object.entries(project.devices)) if (PLAY_TARGETS[canvas.target]?.raw) {
    const { W } = canvasMetrics(canvas);
    next.layouts[id] = { template: 'custom', panorama: false, layers: [{ id: 'device', type: 'device', capture: null,
      frame: { type: 'plain', screen: [...canvas.size], radius: 0 }, radius: 0, cx: W / 2, top: 0, w: W }] };
  }
  return next;
}
