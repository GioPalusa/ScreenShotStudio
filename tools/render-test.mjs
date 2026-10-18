// Integration test of the real CLI renderer, with synthetic local assets. Needs Chrome for CLI mode.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePNG, decodePNG } from './png.mjs';
import { setLayoutIndependent } from '../app/js/layer-ops.js';
import { DEVICE_COMPOSITIONS, newCompositionSlide, compositionGeometry, compositionHardware } from '../app/js/device-compositions.js';
import { ANDROID_FRAMES, androidGeometry } from '../app/js/android-hardware.js';
import { playCanvasDefaults } from '../app/js/google-play.js';
import { STARTER_DESIGNS, previewStarterDesign } from '../app/js/design-library.js';
import { genericFrame, genericGeometry } from '../app/js/generic-frame.js';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-render-test-'));
const project = path.join(temp, 'project'), output = path.join(temp, 'export');
const exported = (run, locale, device, slideId) => {
  const file = JSON.parse(fs.readFileSync(path.join(run, 'manifest.json'))).files.find(f => f.locale === locale && f.device === device && f.slideId === slideId);
  assert.ok(file, `Missing manifest entry for ${locale}/${device}/${slideId}`);
  return path.join(run, file.path);
};
const write = (name, data) => { const file = path.join(project, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data); };
const solid = (width, height, color) => { const data = Buffer.alloc(width * height * 4); for (let i = 0; i < data.length; i += 4) { data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255; } return encodePNG({ width, height, data, channels: 3 }); };
try {
  write('studio.json', { version: 2, fonts: { default: { family: 'system-ui' } }, themes: { white: { bg: '#ffffff', ink: '#111111' } }, locales: [{ id: 'en-US', name: 'English', lang: 'en', dir: 'ltr' }, { id: 'sv', name: 'Swedish', lang: 'sv', dir: 'ltr' }], devices: { canvas: { label: 'Mixed devices', size: [1000, 1000], layout: 'phone', capture: 'unused' } }, slides: [{ id: 'mixed', name: 'Mixed devices', theme: 'white', layouts: { canvas: { template: 'custom', panorama: false, layers: [
    { id: 'phone', type: 'device', profile: 'iphone', capture: 'sample', cx: 250, top: 300, w: 300 },
    { id: 'watch', type: 'device', profile: 'watch-ultra', capture: 'sample', cx: 750, top: 300, w: 300 },
    { id: 'text', type: 'text', field: 'headline', x: 60, w: 880, capTop: 70, size: 70, boxHeight: 160, rotate: 5, maxLines: 2 },
    { id: 'art', type: 'art', src: 'graphic.png', cx: 750, cy: 800, w: 200, h: 200, fit: 'cover', mask: 'ellipse' },
  ] } }, localeLayouts: { sv: { canvas: { overrides: { text: { rotate: -5, x: 80 } }, layers: [{ id: 'local-text', type: 'text', field: 'note', x: 50, w: 500, capTop: 210, size: 32, maxLines: 1 }] } } } }] });
  write('copy/en-US.json', { _meta: { status: 'approved', needsReview: [] }, mixed: { headline: 'Phone and Watch' } });
  write('copy/sv.json', { _meta: { status: 'approved', needsReview: [] }, mixed: { headline: 'Telefon och klocka', note: 'Bara svenska' } });
  for (const [locale, phone, watch] of [['en-US', [220, 20, 40], [20, 80, 220]], ['sv', [20, 180, 60], [240, 180, 20]]]) {
    write(`captures/${locale}/iphone/sample.png`, solid(1206, 2622, phone)); write(`captures/${locale}/watch-ultra/sample.png`, solid(422, 514, watch));
  }
  write('assets/art/graphic.png', solid(400, 200, [100, 50, 160]));
  execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', output, '--strict'], { cwd: root, stdio: 'inherit' });
  const folders = fs.readdirSync(output); assert.equal(folders.length, 1); assert.ok(folders[0].startsWith('final-'));
  const folder = path.join(output, folders[0]);
  const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
  for (const [locale, phone, watch] of [['en-US', [220, 20, 40], [20, 80, 220]], ['sv', [20, 180, 60], [240, 180, 20]]]) {
    const bytes = fs.readFileSync(exported(folder, locale, 'canvas', 'mixed'));
    assert.equal(bytes[25], 2, 'PNG must be RGB, without alpha');
    const image = decodePNG(bytes); assert.equal(image.width, 1000); assert.equal(image.height, 1000);
    assert.deepEqual(pixel(image, 250, 450), phone); assert.deepEqual(pixel(image, 750, 450), watch);
    assert.deepEqual(pixel(image, 750, 800), [100, 50, 160]); assert.deepEqual(pixel(image, 651, 701), [255, 255, 255]);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'))); assert.equal(manifest.files.length, 2); assert.equal(manifest.report.warnings.length, 0);
  // Freezing either scope must preserve the rendered pixels, including local additions and rotation.
  const frozen = JSON.parse(fs.readFileSync(path.join(project, 'studio.json')));
  setLayoutIndependent(frozen, frozen.slides[0], 'canvas', true);
  setLayoutIndependent(frozen, frozen.slides[0], 'canvas', true, 'sv');
  write('studio.json', frozen);
  const independentOutput = path.join(temp, 'independent-export');
  execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', independentOutput, '--strict'], { cwd: root, stdio: 'inherit' });
  const independentRun = path.join(independentOutput, fs.readdirSync(independentOutput)[0]);
  for (const locale of ['en-US', 'sv']) {
    assert.deepEqual(decodePNG(fs.readFileSync(exported(independentRun, locale, 'canvas', 'mixed'))).data, decodePNG(fs.readFileSync(exported(folder, locale, 'canvas', 'mixed'))).data, 'Independent layout must be pixel-identical');
  }
  const doc = JSON.parse(fs.readFileSync(path.join(project, 'studio.json'))); doc.slides.push({ id: 'empty', theme: 'white', layouts: { canvas: { template: 'custom', panorama: false } } }); write('studio.json', doc);
  assert.throws(() => execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', output, '--strict', '--slide', 'empty'], { cwd: root, stdio: 'pipe' }), error => error.status === 2);
  assert.equal(fs.readdirSync(output).length, 1, 'Rejected final export must publish no partial files');
  doc.devices.canvas.target = 'iphone'; write('studio.json', doc);
  assert.throws(() => execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', output, '--strict', '--slide', 'mixed'], { cwd: root, stdio: 'pipe' }), error => error.status === 2 && /not an accepted iPhone/.test(error.stdout.toString() + error.stderr.toString()));
  assert.equal(fs.readdirSync(output).length, 1, 'Invalid App Store dimensions must publish no partial files');
  execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', output, '--slide', 'mixed'], { cwd: root, stdio: 'pipe' });
  const draft = fs.readdirSync(output).find(name => name.startsWith('draft-'));
  const draftManifest = JSON.parse(fs.readFileSync(path.join(output, draft, 'manifest.json')));
  assert.equal(draftManifest.files.length, 2);
  assert.equal(draftManifest.report.warnings.length, 1, 'Size issue must appear once, not once per language or slide');
  assert.match(draftManifest.report.warnings[0], /not an accepted iPhone/);
  // Generic frames preserve capture geometry, paint a visible rim, and keep rounded outer corners.
  const generic = { ...doc, devices: {}, slides: [], locales: [doc.locales[0]] };
  for (const [id, screen] of [['iphone', [400, 800]], ['ipad', [600, 800]], ['watch', [422, 514]], ['mac', [800, 500]]]) {
    const frame = genericFrame({ screen, family: id }), { size, rim } = genericGeometry(frame);
    generic.devices[id] = { label: id, size: size.map(v => v + 40), target: 'custom', layout: 'phone', capture: id, frame };
    write(`captures/en-US/${id}/generic.png`, solid(...screen, [220, 20, 40]));
    generic.slides.push({ id, theme: 'white', layouts: { [id]: { template: 'custom', panorama: false, layers: [{ id: 'device', type: 'device', capture: 'generic', cx: size[0] / 2 + 20, top: 20, w: size[0] }] } } });
  }
  write('studio.json', generic);
  const genericOutput = path.join(temp, 'generic-export');
  for (const id of Object.keys(generic.devices)) execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', genericOutput, '--strict', '--device', id, '--slide', id], { cwd: root, stdio: 'pipe' });
  for (const folder of fs.readdirSync(genericOutput)) {
    const run = path.join(genericOutput, folder), manifest = JSON.parse(fs.readFileSync(path.join(run, 'manifest.json'))), id = manifest.files[0].device;
    const bytes = fs.readFileSync(exported(run, 'en-US', id, id)), image = decodePNG(bytes), canvas = generic.devices[id], { size, rim } = genericGeometry(canvas.frame);
    assert.equal(bytes[25], 2); assert.deepEqual([image.width, image.height], canvas.size);
    assert.deepEqual(pixel(image, Math.floor(size[0] / 2) + 20, Math.floor(size[1] / 2) + 20), [220, 20, 40]);
    assert.ok(pixel(image, 20 + Math.floor(rim / 2), 20 + Math.floor(size[1] / 2)).every(c => c < 130), 'Generic rim must be visible beside the screen');
    assert.deepEqual(pixel(image, 20, 20), [255, 255, 255], 'Outer frame corners must be rounded');
    assert.deepEqual(manifest.report.warnings, []);
  }
  console.log('Generic frames: phone, tablet, watch and landscape exported with visible rims, intact screen pixels and rounded corners.');
  const library = {
    version: 2, fonts: { default: { family: 'system-ui' } }, themes: { white: { bg: '#f2eee7', ink: '#243139' } },
    locales: doc.locales, devices: {}, slides: [],
  };
  for (const [id, size, target] of [['phone', [1320, 2868], 'iphone'], ['tablet', [2064, 2752], 'ipad'], ['watch', [422, 514], 'watch'], ['landscape', [1600, 900], 'custom']]) {
    library.devices[id] = { label: id, size, target, layout: 'phone', capture: id, frame: { type: 'plain', screen: size, radius: 30 } };
    for (const locale of ['en-US', 'sv']) write(`captures/${locale}/${id}/sample.png`, solid(...size, locale === 'sv' ? [20, 180, 60] : [20, 80, 220]));
  }
  const devices = Object.keys(library.devices);
  for (const design of STARTER_DESIGNS) library.slides.push(previewStarterDesign(library, { id: design.id, theme: 'white', capture: 'sample' }, { designId: design.id, deviceIds: devices }));
  write('studio.json', library);
  for (const locale of ['en-US', 'sv']) write(`copy/${locale}.json`, { _meta: { status: 'approved', needsReview: [] }, ...Object.fromEntries(STARTER_DESIGNS.map(d => [d.id, { headline: locale === 'sv' ? 'Dina minnen' : 'Your memories', caption: locale === 'sv' ? 'Varje plats. Varje dag.' : 'Every place. Every day.' }])) });
  const libraryOutput = path.join(temp, 'library-export');
  execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', libraryOutput, '--strict'], { cwd: root, stdio: 'inherit' });
  const run = path.join(libraryOutput, fs.readdirSync(libraryOutput)[0]);
  const libraryManifest = JSON.parse(fs.readFileSync(path.join(run, 'manifest.json')));
  assert.equal(libraryManifest.files.length, 24); assert.equal(libraryManifest.report.warnings.length, 0);
  for (const [i, slide] of library.slides.entries()) for (const deviceId of devices) for (const locale of ['en-US', 'sv']) {
    const bytes = fs.readFileSync(exported(run, locale, deviceId, slide.id));
    assert.equal(bytes[25], 2);
    const image = decodePNG(bytes), canvas = library.devices[deviceId];
    assert.deepEqual([image.width, image.height], canvas.size);
    const device = slide.layouts[deviceId].layers.find(l => l.type === 'device');
    const y = device.top + device.w * canvas.size[1] / canvas.size[0] / 2;
    assert.deepEqual(pixel(image, Math.round(device.cx), Math.round(y)), locale === 'sv' ? [20, 180, 60] : [20, 80, 220]);
  }
  // Every new device pose runs through the production renderer, including rotated overlaps and crops.
  const compositions = { ...library, locales: [library.locales[0]], devices: { canvas: { label: 'Canvas', size: [600, 1000], target: 'custom', layout: 'phone', capture: 'iphone' } }, slides: [] };
  for (const design of DEVICE_COMPOSITIONS) {
    const slide = newCompositionSlide(compositions, {designId:design.id,profileId:'iphone',theme:'white'},()=>design.id);
    slide.capture = 'sample'; compositions.slides.push(slide);
  }
  write('studio.json', compositions);
  const compositionsOutput = path.join(temp, 'compositions-export');
  execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', compositionsOutput, '--strict'], { cwd: root, stdio: 'inherit' });
  const compositionsRun = path.join(compositionsOutput, fs.readdirSync(compositionsOutput)[0]);
  const compositionsManifest = JSON.parse(fs.readFileSync(path.join(compositionsRun, 'manifest.json')));
  assert.equal(compositionsManifest.files.length, DEVICE_COMPOSITIONS.length); assert.deepEqual(compositionsManifest.report.warnings, []);
  for (const [i, slide] of compositions.slides.entries()) {
    const bytes = fs.readFileSync(exported(compositionsRun, 'en-US', 'canvas', slide.id));
    assert.equal(bytes[25],2);
    const image = decodePNG(bytes); assert.deepEqual([image.width,image.height],[600,1000]);
    // Topmost device centre is visible even in overlapping compositions.
    const b = compositionGeometry(DEVICE_COMPOSITIONS[i].id,600,1000,1206/2622).at(-1);
    assert.deepEqual(pixel(image,Math.round(b.cx),Math.round(b.cy)),[220,20,40]);
  }
  console.log('Device compositions: all 30 exported as final RGB, with rotation/crop pixel checks and zero preflight warnings.');
  // Match canvas must use the actual iPad bezel and both Duo frames, including the hardware rim.
  const tabletMeta={size:[1900,2620],screen:{x:130,y:130,w:1640,h:2360,radius:0,mode:'hole'}};
  const bezel=Buffer.alloc(1900*2620*4);
  for(let y=0;y<2620;y++)for(let x=0;x<1900;x++){
    const offset=(y*1900+x)*4;
    bezel[offset]=bezel[offset+1]=bezel[offset+2]=20;
    bezel[offset+3]=x>=130 && x<1770 && y>=130 && y<2490 ? 0 : 255;
  }
  write('assets/frames/tablet.png',encodePNG({width:1900,height:2620,data:bezel,channels:4}));
  write('assets/frames/tablet.json',tabletMeta);
  const hardwareProject={...compositions,devices:{
    ipad:{label:'iPad',size:[600,800],layout:'tablet',target:'custom',capture:'ipad',frame:{type:'bezel',name:'tablet'}},
    'duo-inner':{label:'Duo open',size:[852,600],layout:'wide',target:'custom',capture:'duo-inner',frame:{type:'duo',display:'inner',orientation:'landscape'}},
    'duo-outer':{label:'Duo closed',size:[550,800],layout:'outer',target:'custom',capture:'duo-outer',frame:{type:'duo',display:'outer'}},
  },slides:[]};
  const hardwareFrames={tablet:tabletMeta};
  for(const [id,size]of [['ipad',[1640,2360]],['duo-inner',[2853,2007]],['duo-outer',[1398,2034]]])write(`captures/en-US/${id}/sample.png`,solid(...size,[220,20,40]));
  for(const design of DEVICE_COMPOSITIONS){
    const slide=newCompositionSlide(hardwareProject,{designId:design.id,frames:hardwareFrames,theme:'white'},()=>design.id);
    slide.capture='sample';hardwareProject.slides.push(slide);
  }
  write('studio.json',hardwareProject);
  const hardwareOutput=path.join(temp,'hardware-export');
  execFileSync(process.execPath,['studio.mjs','export','--project',project,'--output',hardwareOutput,'--strict'],{cwd:root,stdio:'inherit'});
  const hardwareRun=path.join(hardwareOutput,fs.readdirSync(hardwareOutput)[0]);
  const hardwareManifest=JSON.parse(fs.readFileSync(path.join(hardwareRun,'manifest.json')));
  assert.equal(hardwareManifest.files.length,90);assert.deepEqual(hardwareManifest.report.warnings,[]);
  for(const [i,slide]of hardwareProject.slides.entries())for(const [id,canvas]of Object.entries(hardwareProject.devices)){
    const bytes=fs.readFileSync(exported(hardwareRun, 'en-US', id, slide.id));
    assert.equal(bytes[25],2);const image=decodePNG(bytes);assert.deepEqual([image.width,image.height],canvas.size);
    const {ratio}=compositionHardware(hardwareProject,'',hardwareFrames,id);
    const box=compositionGeometry(DEVICE_COMPOSITIONS[i].id,...canvas.size,ratio).at(-1);
    const [r,g,b]=pixel(image,Math.round(box.cx),Math.round(box.cy));
    assert.ok(r>150 && g<70 && b<90,`${id}/${slide.id}: screenshot must be visible inside the frame`);
  }
  console.log('Hardware compositions: 90 final RGB exports passed for iPad, Duo open and Duo closed, with no preflight warnings.');
  // Every bundled Android bezel goes through the production compositor and export pipeline.
  const android = { ...library, locales: [doc.locales[0]], devices: { canvas: { label: 'Android artwork', target: 'custom', size: [1000, 1000], layout: 'phone', capture: 'unused' } }, slides: [] };
  for (const [i, { ref }] of ANDROID_FRAMES.entries()) {
    const geom = androidGeometry(ref), captureSet = `android-${i}`, ratio = geom.size[0] / geom.size[1];
    write(`captures/en-US/${captureSet}/sample.png`, solid(...geom.screen, [220, 20, 40]));
    const w = Math.min(geom.size[0], 700, 700 * ratio), h = w / ratio;
    android.slides.push({ id: `frame-${i}`, theme: 'white', layouts: { canvas: { template: 'custom', panorama: false, layers: [{ id: 'device', type: 'device', capture: 'sample', captureSet, frame: ref, cx: 500, top: (1000 - h) / 2, w }] } } });
  }
  write('studio.json', android);
  const androidOutput = path.join(temp, 'android-export');
  execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', androidOutput, '--strict'], { cwd: root, stdio: 'inherit' });
  const androidRun = path.join(androidOutput, fs.readdirSync(androidOutput)[0]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(androidRun, 'manifest.json'))).files.length, ANDROID_FRAMES.length);
  for (const [i, slide] of android.slides.entries()) {
    const bytes = fs.readFileSync(exported(androidRun, 'en-US', 'canvas', slide.id));
    assert.equal(bytes[25], 2);
    const image = decodePNG(bytes); assert.deepEqual([image.width, image.height], [1000, 1000]);
    const center = pixel(image, 500, 500); assert.ok(center[0] > 180 && center[1] < 30 && center[2] < 50, `Android frame ${i}: capture must fill the bezel`);
    assert.deepEqual(pixel(image, 0, 0), [242, 238, 231]);
  }
  const play = { ...android, devices: { wear: { label: 'Wear OS', target: 'play-wear', size: [454, 454], layout: 'phone', ...playCanvasDefaults('play-wear', [454, 454]) } }, slides: [] };
  for (let i = 0; i < 2; i++) {
    const slide = newCompositionSlide(play, { designId: 'center', theme: 'white' }, () => `play-${i}`);
    slide.layouts.wear.layers[0].capture = 'sample'; play.slides.push(slide);
  }
  write('captures/en-US/android-watch/sample.png', solid(454, 454, [20, 80, 220]));
  write('studio.json', play);
  const playOutput = path.join(temp, 'play-export');
  execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', playOutput, '--strict'], { cwd: root, stdio: 'inherit' });
  const playRun = path.join(playOutput, fs.readdirSync(playOutput)[0]);
  const wearImage = decodePNG(fs.readFileSync(exported(playRun, 'en-US', 'wear', play.slides[0].id)));
  assert.deepEqual(pixel(wearImage, 0, 0), [20, 80, 220]); assert.deepEqual(pixel(wearImage, 453, 453), [20, 80, 220]);
  play.slides[0].layouts.wear.layers[0].frame = { type: 'android', model: 'watch' }; write('studio.json', play);
  assert.throws(() => execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', playOutput, '--strict'], { cwd: root, stdio: 'pipe' }), error => error.status === 2);
  assert.equal(fs.readdirSync(playOutput).length, 1, 'Framed Wear export must not publish partial files');
  console.log('Android: all 14 bundled bezels rendered to final RGB exports; full-canvas Wear pixels and rejection of framed Wear exports passed.');
  // Decorations retain their original affine/path coordinate system until edited.
  const decorations = { ...library, devices: { canvas: { label: 'Canvas', size: [1000, 1000], layout: 'phone', capture: 'none' } }, themes: { white: { bg: '#ffffff', ink: '#000000' } }, locales: [doc.locales[0]],
    panorama: { phone: { offsets: [0], route: { d: 'M100 250 L300 250', width: 20, dash: [1000], color: '#ff0000', opacity: 1 }, art: [{ id: 'globe', src: 'graphic.png', matrix: [0.5, 0, 0, 0.5, 100, 400] }] } },
    slides: [{ id: 'decoration', theme: 'white', layouts: { canvas: { template: 'custom' } } }] };
  const renderDecorations = label => {
    write('studio.json', decorations);
    const out = path.join(temp, label);
    execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', out], { cwd: root, stdio: 'pipe' });
    return decodePNG(fs.readFileSync(exported(path.join(out, fs.readdirSync(out)[0]), 'en-US', 'canvas', 'decoration')));
  };
  const original = renderDecorations('original-decorations');
  assert.deepEqual(pixel(original, 150, 450), [100, 50, 160]);
  assert.deepEqual(pixel(original, 150, 250), [255, 0, 0]);
  decorations.slides[0].layouts.canvas.overrides = {
    globe: { decorationBox: { x: 500, y: 600, w: 100, h: 200, rot: 0 } },
    route: { decorationBox: { x: 0, y: 100, w: 1000, h: 1000, rot: 0 } },
  };
  const edited = renderDecorations('edited-decorations');
  assert.deepEqual(pixel(edited, 150, 450), [255, 255, 255]);
  assert.deepEqual(pixel(edited, 550, 700), [100, 50, 160]);
  assert.deepEqual(pixel(edited, 150, 250), [255, 255, 255]);
  assert.deepEqual(pixel(edited, 150, 350), [255, 0, 0]);
  decorations.slides[0].layouts.canvas.overrides.globe.decorationBox.rot = 90;
  const rotated = renderDecorations('rotated-decorations');
  assert.deepEqual(pixel(rotated, 475, 700), [100, 50, 160]);
  assert.deepEqual(pixel(rotated, 550, 775), [255, 255, 255]);
  console.log('Decoration rendering: original affine image/path, moved and resized image, moved route, and 90-degree rotation passed pixel checks.');
  console.log('Design library: 24 final RGB exports passed across three designs, four canvas formats and two languages, with zero preflight warnings.');
  // Each creative format goes through the real strict RGB export pipeline.
  const { CREATIVE_TARGETS } = await import('../app/js/export-targets.js');
  const creative = { version: 2, fonts: { default: { family: 'system-ui' } }, themes: { white: { bg: '#ffffff', ink: '#111111' } }, locales: [{ id: 'en-US', name: 'English', dir: 'ltr' }], devices: {}, slides: [{ id: 'creative', name: 'Creative image', theme: 'white', layouts: {} }] };
  for (const [target, spec] of Object.entries(CREATIVE_TARGETS)) for (const [index, format] of spec.formats.entries()) {
    const id = `${target}-${index}`;
    creative.devices[id] = { label: spec.label, target, size: format.size, layout: 'wide', capture: 'unused' };
    creative.slides[0].layouts[id] = { template: 'custom', panorama: false, layers: [{ id: 'title', type: 'text', field: 'headline', x: 100, capTop: 100, w: 1400, size: 80, maxLines: 2 }] };
  }
  write('studio.json', creative); write('copy/en-US.json', { _meta: { status: 'approved', needsReview: [] }, creative: { headline: 'Your next idea' } });
  for (const [id, device] of Object.entries(creative.devices)) {
    const out = path.join(temp, id);
    execFileSync(process.execPath, ['studio.mjs', 'export', '--project', project, '--output', out, '--device', id, '--strict'], { cwd: root, stdio: 'pipe' });
    const run = path.join(out, fs.readdirSync(out).find(name => name.startsWith('final-')));
    const bytes = fs.readFileSync(exported(run, 'en-US', id, 'creative'));
    assert.equal(bytes[25], 2); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], device.size);
  }
  console.log('App Store creative images: all five header/search formats passed strict export with exact RGB dimensions.');
  execFileSync(process.execPath, ['tools/browser-runner-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/orientation-render-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/overview-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/appearance-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/app-store-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/export-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/screen-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/warnings-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/profiles-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/viewport-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/details-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/text-fit-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/agent-setup-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/translation-view-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/translation-import-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/orientation-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/frame-import-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/connected-render-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/store-images-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/connected-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/shared-canvas-render-test.mjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/shared-canvas-ui-test.mjs'], { cwd: root, stdio: 'inherit' });
  console.log('Rendering integration passed: mixed device sources, locale overrides, text rotation/height, image mask, exact RGB dimensions, manifest, rejected blank/invalid-size final exports and draft with one size warning.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
