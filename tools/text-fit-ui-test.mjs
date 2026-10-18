// Real canvas metrics and inspector diagnostics for line limits versus physical overflow.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execBrowserTest } from './browser-test-runner.mjs';
import { createStudioService } from '../host/service.mjs';
import { createNewProject } from '../host/new-project.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-text-fit-'));
const appPath = path.join(temp, 'app'), projectPath = path.join(temp, 'Text fit.sss');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean).find(fs.existsSync);
assert.ok(chrome, 'Install Chrome or set CHROME_PATH.');
let service, server;
try {
  fs.cpSync(path.join(root, 'app'), appPath, { recursive: true });
  createNewProject(projectPath, {});
  const doc = JSON.parse(fs.readFileSync(path.join(projectPath, 'studio.json')));
  doc.devices = { iphone: { label: 'iPhone', size: [1206, 2622], designSize: [1000, 2174], target: 'iphone', layout: 'phone', capture: 'iphone' } };
  doc.locales = [{ id: 'en-US', name: 'English', lang: 'en', dir: 'ltr' }, { id: 'hi', name: 'Hindi', lang: 'hi', dir: 'ltr', font: { family: '"Kohinoor Devanagari", sans-serif', lineHeight: 1.16 } }];
  doc.fonts = { default: { family: 'Helvetica Neue' } };
  const base = { type: 'text', field: 'headlineAccent', x: 50, capTop: 80, w: 870, size: 40, minSize: 40, boxHeight: 180, maxLines: 10, weight: 700 };
  doc.slides = ['a', 'b'].map(id => ({ id, name: 'Screen ' + id, theme: Object.keys(doc.themes)[0], colors: { bg: '#dff2fa', ink: '#17283b' }, layouts: { iphone: { template: 'custom', panorama: false, layers: [{ ...base, id: 'local', ...(id === 'b' ? { boxHeight: 10 } : {}) }] } } }));
  doc.sharedCanvas = { iphone: { gap: .06, layers: [
    { ...base, id: 'accent', copySlideId: 'a', capTop: 289.7, boxHeight: 292.57272727272743, size: 111, minSize: 77.89999999999999, maxLines: 1, lineHeight: 1.04, fontFamily: 'Helvetica Neue', align: 'start', block: 'start', anchor: 'top', color: '#C0338B' },
    { ...base, id: 'other-accent', copySlideId: 'b', x: 1110, capTop: 600 },
  ] } };
  fs.writeFileSync(path.join(projectPath, 'studio.json'), JSON.stringify(doc));
  for (const [locale, headline] of [['hi', 'आपकी बनाई हुई, जिसे दूसरों के साथ साझा किया जा सकता है'], ['en-US', 'Made by you, ready to share with others']]) {
    fs.writeFileSync(path.join(projectPath, 'copy', locale + '.json'), JSON.stringify({ _meta: { status: 'draft', needsReview: ['*'] }, a: { headlineAccent: headline }, b: { headlineAccent: 'Hello' } }));
  }
  if (process.env.TEXT_FIT_QA_PROJECT) fs.cpSync(projectPath, process.env.TEXT_FIT_QA_PROJECT, { recursive: true });
  // Optional before/after pixel check against the source captured before this change.
  const baseline = process.env.TEXT_FIT_BASELINE;
  if (baseline) {
    fs.copyFileSync(path.join(baseline, 'text.js'), path.join(appPath, 'js/text-baseline.js'));
    fs.writeFileSync(path.join(appPath, 'js/render-baseline.js'), fs.readFileSync(path.join(baseline, 'render.js'), 'utf8').replace("from './text.js'", "from './text-baseline.js'"));
  }
  fs.writeFileSync(path.join(appPath, 'text-fit-test.html'), '<!doctype html><html><head><link rel="stylesheet" href="/app/css/studio.css"></head><body><div id="root" style="height:900px"></div><pre id="result">PENDING</pre><script type="module" src="/app/text-fit-test.js"></script></body></html>');
  fs.writeFileSync(path.join(appPath, 'text-fit-test.js'), `
const result = document.querySelector('#result');
const check = (value, message) => { if (!value) throw new Error(message); };
const waitFor = async fn => { for (let i = 0; i < 500; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Timed out: ' + fn); };
const button = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name);
try {
  const { engine, state, loadAll, flushSaves, undo, redo } = await import('/app/js/store.js');
  const { createEditor } = await import('/app/js/ui/editor.js');
  const { layoutText, textOverflowMessage } = await import('/app/js/text.js');
  const { installTooltips } = await import('/app/js/ui/tooltips.js');
  installTooltips(document);
  await loadAll();
  const ctx = document.createElement('canvas').getContext('2d');
  const options = { family: 'Helvetica Neue', size: 40, minSize: 40, boxW: 800, maxHeight: 200, heightIncludesGlyphs: true, maxLines: 1 };
  const lines = layoutText(ctx, 'Hello\\nworld', options);
  check(lines.overflow && lines.overflowReasons.map(r => r.code).join() === 'lines', 'Explicit line breaks inside a tall box only exceed the line limit');
  const height = layoutText(ctx, 'Hello\\nworld', { ...options, maxLines: 2, maxHeight: 20 });
  check(height.overflowReasons.map(r => r.code).join() === 'height', 'A short box must report physical height');
  const width = layoutText(ctx, 'Supercalifragilisticexpialidocious', { ...options, boxW: 40 });
  check(width.overflowReasons.map(r => r.code).join() === 'width', 'An unbroken word must report physical width');
  const mixed = layoutText(ctx, 'Hello\\nworld', { ...options, boxW: 10, maxHeight: 10 });
  check(mixed.overflowReasons.map(r => r.code).join() === 'lines,width,height', 'Simultaneous constraints must all be retained');
  check(textOverflowMessage(mixed.overflowReasons).includes('Max lines is 1') && textOverflowMessage(mixed.overflowReasons).includes('wider') && textOverflowMessage(mixed.overflowReasons).includes('taller'), 'All violated limits must be explained');
  const fits = layoutText(ctx, 'Hello\\nworld', { ...options, maxLines: 2 });
  check(!fits.overflow && fits.overflowReasons.length === 0, 'Allowed lines within the box fit');
  const unlimited = layoutText(ctx, 'Hello\\nworld', { ...options, maxLines: 0 });
  check(!unlimited.overflow && unlimited.lines.length === 2 && unlimited.size === fits.size, 'Zero permits every line that fits the box');
  const manyLines = layoutText(ctx, Array(120).fill('Hello').join('\\n'), { ...options, maxLines: 0, maxHeight: Infinity });
  check(!manyLines.overflow && manyLines.lines.length === 120, 'Zero is unlimited, not the previous default of 99 lines');
  const zeroHeight = layoutText(ctx, 'Hello\\nworld', { ...options, maxLines: 0, maxHeight: 20 });
  check(zeroHeight.overflowReasons.map(r => r.code).join() === 'height', 'Zero retains the height constraint');
  const zeroWidth = layoutText(ctx, 'Supercalifragilisticexpialidocious', { ...options, maxLines: 0, boxW: 40 });
  check(zeroWidth.overflowReasons.map(r => r.code).join() === 'width', 'Zero retains the width constraint');
  const filled = layoutText(ctx, 'Hello\\nworld', { ...options, fitFrame: true });
  check(!filled.overflow && filled.lines.length === 2 && filled.overflowReasons.length === 0, 'Fill frame ignores the manual line limit and preserves Enter');
  const swedish = layoutText(ctx, 'DU KOMMER ALDRIG\\nATT SOVA PÅ SAMMA SÄTT', { family: 'Impact', weight: 400, size: 245, minSize: 160, boxW: 1280, maxHeight: 476.6129105839416, heightIncludesGlyphs: true, maxLines: 0, lineHeight: 1.03 });
  check(!swedish.overflow, 'The Swedish Impact headline fits its visible frame: ' + JSON.stringify(swedish));
  ${baseline ? `const { Engine } = await import('/app/js/render-baseline.js');
  const before = new Engine(); before.setData(structuredClone(engine.data));
  for (const locale of ['hi', 'en-US']) for (const allScreens of [false, true]) {
    const a = document.createElement('canvas'), b = document.createElement('canvas');
    await before.render(a, before.scene('a', 'iphone', locale, { allScreens }));
    await engine.render(b, engine.scene('a', 'iphone', locale, { allScreens }));
    const oldPixels = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
    const newPixels = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    check(oldPixels.length === newPixels.length && oldPixels.every((v, i) => v === newPixels[i]), 'Before/after pixels must match: ' + locale + ', allScreens=' + allScreens);
  }` : ''}
  state.ui.locale = 'hi'; state.ui.device = 'iphone'; state.ui.slideId = 'a'; state.ui.allScreens = false; state.ui.tab = 'details';
  const editor = createEditor({ go() {}, openExport() {} }), ed = editor.ed;
  document.querySelector('#root').append(editor.el); editor.build(); editor.activate();
  await waitFor(() => ed.scene?.texts['shared:accent']);
  const hint = () => document.querySelector('.details-panel [data-fit="headlineAccent"]');
  ed.select('shared:accent', { from: 'stage' });
  // Weight shares a containing field with the nested font picker. Hovering it must
  // never use the font label plus every installed font as its description.
  const hover = control => { control.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return control.title; };
  const weight = [...document.querySelectorAll('.details-panel select')].find(s => [...s.options].some(o => o.text === 'Bold'));
  check(hover(weight) === 'Weight', 'Weight tooltip must use its own row label: ' + weight.title);
  const font = document.querySelector('[aria-label="Font"]'), fontTitle = font.title;
  check(hover(font) === fontTitle && fontTitle.startsWith('Choose an installed font.'), 'Explicit font help must win');
  const fixture = document.createElement('div');
  fixture.innerHTML = '<div class="field"><label>Font<select><option>Arial</option><option>Helvetica</option></select></label><div class="row"><span class="label">Mode</span><select><option>One</option><option>Two</option></select></div><div class="row"><select aria-label="Device"><option>Phone</option></select></div></div><div class="field"><label for="qa-format">Format</label><select id="qa-format"><option>PNG</option><option>JPEG</option></select><div class="hint">Choose a file format.</div></div><div title="Parent help"><select><option>Value</option></select></div><div class="field"><label>Unrelated<select><option>Secret option</option></select></label><input></div>';
  document.body.append(fixture);
  const controls = fixture.querySelectorAll('select,input');
  check(hover(controls[0]) === 'Font', 'Wrapping labels must exclude option text');
  check(hover(controls[1]) === 'Mode', 'Nested font lists must not leak into sibling dropdowns');
  controls[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  check(controls[2].title === 'Device', 'Keyboard focus must use the accessible label');
  check(hover(controls[3]) === 'Format. Choose a file format.', 'Associated labels retain relevant direct hints');
  check(hover(controls[4]) === 'Parent help', 'Explicit parent help must be retained');
  check(hover(controls[6]) === '', 'An unlabelled input must not borrow another control label');
  fixture.remove();
  const fit = ed.scene.texts['shared:accent'];
  check(fit.lines === 3 && fit.overflowReasons.map(r => r.code).join() === 'lines', 'The reported Hindi case fits physically but exceeds Max lines=1: ' + JSON.stringify(fit));
  check(hint().textContent.includes('Uses 3 lines, but Max lines is 1'), 'Inspector must use the selected shared object, not the first matching field');
  check(!hint().textContent.includes('Too long') && !hint().textContent.includes('taller'), 'Line limit must not be described as physical overflow');
  check(ed.scene.warnings.some(w => w.layer === 'shared:accent' && w.message.includes(textOverflowMessage(fit.overflowReasons))), 'Preflight and inspector must use the same diagnosis');
  button('Allow 3 lines').click();
  await waitFor(() => !ed.scene.texts['shared:accent'].overflow && !button('Allow 3 lines'));
  check(engine.project.sharedCanvas.iphone.layers[0].maxLines === 3, 'Action updates the shared source');
  check(engine.project.slides[0].layouts.iphone.layers[0].maxLines === 10, 'Other layers using this field are untouched');
  check(hint().textContent.includes('Fits') || hint().textContent.includes('Smaller'), 'Inspector refreshes immediately after the action');
  undo(); await waitFor(() => button('Allow 3 lines'));
  redo(); await waitFor(() => !button('Allow 3 lines') && !ed.scene.texts['shared:accent'].overflow);
  await flushSaves();
  const saved = await (await fetch('/project/studio.json')).json();
  check(saved.sharedCanvas.iphone.layers[0].maxLines === 3, 'Resolved line limit persists to the document');
  document.querySelector('.all-screens-option').click(); await waitFor(() => ed.scene?.allScreens && ed.scene.texts['b:local']);
  ed.select('screen:b:local', { from: 'stage' });
  check(hint().textContent.includes('taller than the box'), 'All-screens local proxy must use its own height report');
  check(!button('Allow 3 lines'), 'A line-limit action must not promise to solve a height error');
  ed.select('shared:other-accent', { from: 'stage' });
  check(hint().textContent.includes('Fits at full size'), 'Another shared object with the same field uses its own fitting result');
  ed.select('shared:accent', { from: 'stage' });
  ed.setLayer(ed.layerById('shared:accent'), { maxLines: 1 }, { rebuild: true });
  await waitFor(() => button('Allow 3 lines'));
  button('Allow 3 lines').click(); await waitFor(() => !ed.scene.texts['shared:accent'].overflow);
  const maxLinesInput = () => document.querySelector('[aria-label="Max lines"]');
  check(maxLinesInput().min === '0' && maxLinesInput().parentElement.textContent.includes('0 = unlimited'), 'Zero must be allowed and explained beside the input');
  maxLinesInput().value = '0'; maxLinesInput().dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => ed.layerById('shared:accent').maxLines === 0);
  check(!ed.scene.texts['shared:accent'].overflow && !button('Allow 3 lines'), 'Zero clears the line limit in the real editor');
  undo(); await waitFor(() => ed.layerById('shared:accent').maxLines === 3);
  redo(); await waitFor(() => ed.layerById('shared:accent').maxLines === 0);
  check(maxLinesInput().value === '0', 'Undo/Redo keeps zero visible in the control');
  maxLinesInput().value = '-1'; maxLinesInput().dispatchEvent(new Event('change', { bubbles: true }));
  check(maxLinesInput().value === '0' && ed.layerById('shared:accent').maxLines === 0, 'Negative line limits must not be stored');
  await flushSaves();
  const zeroSaved = await (await fetch('/project/studio.json')).json();
  check(zeroSaved.sharedCanvas.iphone.layers[0].maxLines === 0, 'Unlimited must persist as JSON zero, never Infinity or null');
  // Replay the reported Swedish layer through the renderer and real inspector,
  // without loading or changing the user's document.
  editor.el.remove();
  const reported = structuredClone(engine.data);
  reported.studio.locales.push({ id: 'sv', name: 'Swedish', lang: 'sv', dir: 'ltr' });
  delete reported.studio.sharedCanvas;
  const reportedLayer = { id: 'headline', type: 'text', field: 'headline', x: 76, capTop: 145, w: 1280, boxHeight: 476.6129105839416, size: 245, minSize: 160, maxLines: 0, weight: 400, lineHeight: 1.03, align: 'start', anchor: 'top', fontFamily: 'Impact', color: '#fff5e5', block: 'start' };
  reported.studio.devices.iphone.size = reported.studio.devices.iphone.designSize = [1672, 941];
  reported.studio.slides = [{ id: 'a', name: 'Search result image', theme: Object.keys(reported.studio.themes)[0], layouts: { iphone: { template: 'custom', panorama: false, layers: [reportedLayer] } } }];
  reported.copy['en-US'].a = { headline: 'YOU WILL NEVER\\nSLEEP THE SAME' };
  reported.copy.sv = { a: { headline: 'DU KOMMER ALDRIG\\nATT SOVA PÅ SAMMA SÄTT' } };
  engine.setData(reported);
  state.ui.locale = 'sv'; state.ui.slideId = 'a'; state.ui.allScreens = false;
  const swedishEditor = createEditor({ go() {}, openExport() {} });
  document.querySelector('#root').append(swedishEditor.el); swedishEditor.build(); swedishEditor.activate();
  await waitFor(() => swedishEditor.ed.scene?.texts.headline);
  swedishEditor.ed.select('headline', { from: 'stage' });
  const reportedScene = swedishEditor.ed.scene;
  check(reportedScene.texts.headline.lines === 3 && !reportedScene.warnings.some(w => w.code === 'overflow'), 'The reported three-line headline must not produce a screen/preflight overflow warning');
  const swedishHint = document.querySelector('.details-panel [data-fit="headline"]');
  check(swedishHint && !swedishHint.classList.contains('err') && !swedishHint.textContent.includes('taller'), 'The selected Swedish text inspector must clear the false height error');
  const fixedSize = { ...reportedLayer, size: 160, minSize: 160 };
  const actual = layoutText(ctx, reported.copy.sv.a.headline, { family: 'Impact', weight: 400, size: 160, minSize: 160, boxW: 1280, maxHeight: fixedSize.boxHeight, heightIncludesGlyphs: true, maxLines: 0, lineHeight: 1.03 });
  check(actual.height + actual.ascent + actual.descent <= fixedSize.boxHeight, 'The exact rendered glyph block fits the reported height');
  ${baseline ? `const oldFixed = new Engine(), newFixed = new engine.constructor();
  for (const target of [oldFixed, newFixed]) { const data = structuredClone(reported); data.studio.slides[0].layouts.iphone.layers = [fixedSize]; target.setData(data); }
  const a = document.createElement('canvas'), b = document.createElement('canvas');
  const oldScene = oldFixed.scene('a', 'iphone', 'sv'), newScene = newFixed.scene('a', 'iphone', 'sv');
  await oldFixed.render(a, oldScene); await newFixed.render(b, newScene);
  check(oldScene.texts.headline.overflow && !newScene.texts.headline.overflow, 'Only the false height verdict changes at the same font size');
  const oldPixels = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
  const newPixels = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
  check(oldPixels.every((v, i) => v === newPixels[i]), 'Swedish text at the same size must remain pixel-identical');` : ''}
  result.textContent = 'PASS: Swedish Impact accented-line regression in renderer and inspector; Hindi three-line regression; line, width, height and combined constraints; zero means unlimited with width/height checks; Fill frame; scoped dropdown tooltips; selected-layer identity on single/all screens; fix action; Undo/Redo and saved zero${baseline ? '; unchanged before/after pixels in Hindi, English and fixed-size Swedish' : ''}';
} catch (e) { result.textContent = 'FAIL: ' + e.stack; }
`);
  service = createStudioService({ appPath, projectPath, exportPath: path.join(temp, 'export') });
  server = http.createServer((req, res) => service.handle(req, res, server.address().port));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const output = await new Promise((resolve, reject) => execBrowserTest(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${path.join(temp, 'chrome')}`, '--window-size=1500,1100', `http://127.0.0.1:${server.address().port}/app/text-fit-test.html`], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => { fs.writeFileSync('/tmp/studio-text-fit-test.log', stderr); error ? reject(error) : resolve(stdout); }));
  const verdict = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'No test result';
  assert.match(verdict, /^PASS:/, verdict); console.log(verdict);
} finally {
  server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); service?.close(); fs.rmSync(temp, { recursive: true, force: true });
}
