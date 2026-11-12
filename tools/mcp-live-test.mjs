// Opt-in end-to-end verification against the real open Mac app and its installed MCP.
// --prepare makes a new disposable fixture; open it in the app before --run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createNewProject } from '../host/new-project.mjs';
import { encodePNG, decodePNG } from './png.mjs';
import { clipboardFixture } from './fixtures/figma-clipboard.mjs';
import { verifyActiveMCPProcess } from './mcp-process-check.mjs';

const [action, directory] = process.argv.slice(2);
if (!['--prepare', '--run', '--resume', '--reopen'].includes(action) || !directory || !path.isAbsolute(directory)) throw Error('Use --prepare, --run, --resume or --reopen with an absolute new test directory.');
const project = path.join(directory, 'MCP live verification.sss'), marker = path.join(directory, 'live-test.json');
const rect = (id, cx = 100, cy = 100, extra = {}) => ({ id, type: 'shape', shape: 'rect', cx, cy, w: 100, h: 80, fill: '#ce4160', ...extra });
const vector = id => ({ id, type: 'shape', shape: 'path', cx: 300, cy: 400, w: 180, h: 180, pathSize: [180, 180], pathOffset: [0, 0], paths: [{ d: 'M0 0C40 0 140 120 180 120L180 180L0 180Z', rule: 'nonzero' }], paints: [{ type: 'solid', color: '#6758c6' }] });

if (action === '--prepare') {
  if (fs.existsSync(directory)) throw Error('Choose a new test directory. Existing files are preserved.');
  fs.mkdirSync(directory, { recursive: true }); createNewProject(project, {});
  const file = path.join(project, 'studio.json'), studio = JSON.parse(fs.readFileSync(file));
  studio.sourceLocale = 'en-US';
  studio.locales.push({ id: 'sv-SE', name: 'Swedish', lang: 'sv-SE', dir: 'ltr' });
  studio.devices = Object.fromEntries([['iphone', [600, 800]], ['ipad', [800, 1000]]].map(([id, size]) => [id, { label: id === 'iphone' ? 'Phone test' : 'Tablet test', size, target: 'custom', layout: 'phone', capture: 'test-phone', frame: { type: 'plain', screen: [300, 600], radius: 16 } }]));
  studio.slides = ['native', 'typography', 'template-target', 'figma-local', 'figma-clipboard', 'figma-remote'].map(id => ({ id, name: id, theme: 'starter', capture: 'test-screen', layouts: { phone: { template: 'custom', panorama: false, layers: id === 'native' ? [rect('a'), rect('b', 150), rect('c', 350)] : [] } } }));
  fs.writeFileSync(file, JSON.stringify(studio, null, 2));
  for (const locale of studio.locales) fs.writeFileSync(path.join(project, 'copy', `${locale.id}.json`), JSON.stringify({ _meta: { status: 'draft', needsReview: ['*'] }, native: { headline: locale.id === 'en-US' ? 'Native MCP, verified' : 'MCP, verifierad i appen' }, typography: { headline: 'Precision you can see', caption: 'Editable vectors, effects and type.' } }, null, 2));
  const inputs = path.join(project, 'inputs'); fs.mkdirSync(inputs);
  const bytes = encodePNG({ width: 300, height: 600, channels: 3, data: Buffer.from(Array.from({ length: 300 * 600 * 3 }, (_, i) => [35, 100 + Math.floor(i / 900) % 100, 190][i % 3])) });
  fs.writeFileSync(path.join(inputs, 'screen.png'), bytes); fs.writeFileSync(path.join(inputs, 'art.png'), bytes);
  fs.copyFileSync(new URL('./fixtures/fonts/Mulish.ttf', import.meta.url), path.join(inputs, 'Mulish.ttf'));
  fs.writeFileSync(path.join(inputs, 'figma.html'), clipboardFixture());
  fs.writeFileSync(path.join(inputs, 'figma.json'), JSON.stringify({ id: '1:1', type: 'FRAME', name: 'Editable local Figma', size: { x: 300, y: 400 }, fills: [], children: [
    { id: '1:2', type: 'RECTANGLE', name: 'Native photo fill', size: { x: 240, y: 300 }, relativeTransform: [[1, 0, 30], [0, 1, 80]], fills: [{ type: 'IMAGE', imageRef: 'photo', scaleMode: 'FILL' }] },
    { id: '1:3', type: 'TEXT', name: 'Native Figma title', size: { x: 260, y: 60 }, relativeTransform: [[1, 0, 20], [0, 1, 10]], characters: 'Editable Figma', style: { fontFamily: 'Mulish', fontSize: 28, fontWeight: 600 }, fills: [{ type: 'SOLID', color: { r: .1, g: .1, b: .2 } }] },
  ] }));
  fs.writeFileSync(marker, JSON.stringify({ format: 'Screenshot Studio live MCP test', project }));
  console.log(project);
  process.exit(0);
}
assert.equal(JSON.parse(fs.readFileSync(marker)).project, project, 'Only a newly prepared test fixture may be changed.');
const client = new Client({ name: 'screenshot-studio-live-verification', version: '1.0' });
const transport = new StdioClientTransport({ command: '/Applications/Screenshot Studio.app/Contents/MacOS/Screenshot Studio', args: ['--screenshot-studio-mcp', '--active-app', '--app-data', path.join(os.homedir(), 'Library/Application Support/Screenshot Studio')], stderr: 'pipe' });
const reportFile = path.join(directory, 'verification.json');
const report = action === '--resume' ? JSON.parse(fs.readFileSync(reportFile)) : { project, started: new Date().toISOString(), checks: [], tools: [], layerOperations: [], projectOperations: [] };
assert.equal(report.project, project);
if (action === '--resume') { delete report.failure; report.resumed = new Date().toISOString(); }
const used = new Set(report.tools), layerOps = new Set(report.layerOperations), projectOps = new Set(report.projectOperations); let session;
function saveReport() { fs.writeFileSync(reportFile, JSON.stringify({ ...report, tools: [...used], layerOperations: [...layerOps], projectOperations: [...projectOps] }, null, 2)); }
async function rpc(name, args = {}, { fail = false, raw = false } = {}) {
  used.add(name);
  let result;
  for (let attempt = 0; attempt < 20; attempt++) {
    result = await client.callTool({ name, arguments: { ...args, ...(session && !['catalog', 'read_project', 'read_image'].includes(name) ? { projectSession: session } : {}) } }, undefined, { timeout: 180000 });
    if (!result.isError || !result.content?.some(c => c.type === 'text' && /finishing a document action/.test(c.text))) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (fail) { assert.equal(result.isError, true, `${name} should reject this request`); return result; }
  assert.ok(!result.isError, `${name}: ${result.content?.find(c => c.type === 'text')?.text}`);
  return raw ? result : result.structuredContent;
}
async function read() { const doc = await rpc('read_project'); assert.equal(doc.project, project, 'The active app switched documents; stopping before any writes.'); session = doc.projectSession; return doc; }
async function layers(edits, scope = { device: 'iphone', slide: 'native' }) { const doc = await read(); const result = await rpc('edit_layers', { revision: doc.revisions.studio, edits: edits.map(edit => ({ ...scope, ...edit })) }); edits.forEach(e => layerOps.add(e.op)); return result; }
async function structure(edits) { const doc = await read(); const result = await rpc('edit_project', { revision: doc.revisions.studio, edits }); edits.forEach(e => projectOps.add(e.op)); return result; }
const inspect = (args = {}) => rpc('inspect_layers', { device: 'iphone', slide: 'native', ...args });
const layer = async (id, args = {}) => (await inspect({ ...args, ids: [id] })).layers[0];
async function check(name, run) {
  if (report.checks.some(c => c.name === name && c.passed)) { console.log(`ALREADY PASSED: ${name}`); return; }
  await run(); report.checks.push({ name, passed: true }); saveReport(); console.log(`PASS: ${name}`);
}

try {
  await client.connect(transport, { timeout: 20000 });
  await read();
  if (action === '--reopen') {
    const previous = JSON.parse(fs.readFileSync(reportFile));
    assert.ok(previous.completed, 'Run the feature checks before reopening.');
    const doc = await read(); assert.equal(doc.revisions.studio, previous.finalRevision);
    assert.notEqual(session, previous.finalSession, 'Reopen the document in the GUI before this check.');
    const stale = await client.callTool({ name: 'edit_project', arguments: { projectSession: previous.finalSession, revision: doc.revisions.studio, edits: [{ op: 'rename_slide', slide: 'native', name: 'Must not be saved from the old session' }] } });
    assert.equal(stale.isError, true); assert.equal((await read()).revisions.studio, previous.finalRevision);
    assert.equal((await layer('proof-title')).text.value, 'MCP VERIFIED');
    const preview = await rpc('preview_project', { devices: ['iphone'], slides: ['native'], locales: ['en-US'], details: true });
    assert.ok(preview.scenes[0].layers.some(l => l.id === 'proof-title' && l.text.lines > 0));
    previous.reopened = { passed: true, revision: doc.revisions.studio, preview: preview.file, at: new Date().toISOString() };
    fs.writeFileSync(reportFile, JSON.stringify(previous, null, 2)); console.log(`PASS: saved design reopened through the GUI and rendered through a fresh installed MCP session\n${reportFile}`);
  } else {
    const catalog = await rpc('catalog'); assert.equal(catalog.editing.version, 1);
    const available = (await client.listTools()).tools.map(t => t.name); assert.equal(available.length, 18);
    report.proxy = verifyActiveMCPProcess(transport.pid);
    await check('18 installed tools, 4 guide resources, 5 prompts and native capabilities', async () => {
      assert.equal((await client.listResources()).resources.length, 4);
      assert.match((await client.readResource({ uri: 'screenshot-studio://guide/advanced-editing' })).contents[0].text, /vector/);
      const prompts = (await client.listPrompts()).prompts; assert.equal(prompts.length, 5);
      for (const prompt of prompts) assert.ok((await client.getPrompt({ name: prompt.name, arguments: { request: 'Verify native editing.' } })).messages[0].content.text.length > 50);
    });
    await check('native add, patch, remove and canvas/locale isolation', async () => {
      await layers([{ op: 'add', layer: rect('temporary', 200, 200) }, { op: 'patch', id: 'temporary', patch: { opacity: .4 } }]); assert.equal((await layer('temporary')).data.opacity, .4);
      await layers([{ op: 'remove', id: 'temporary' }, { op: 'patch', id: 'a', locale: 'sv-SE', patch: { opacity: .6 } }]);
      assert.equal((await layer('a', { locale: 'sv-SE' })).data.opacity, .6); assert.equal((await layer('a')).data.opacity, undefined);
      assert.equal((await layer('a', { device: 'ipad' })).data.opacity, undefined);
    });
    await check('groups, whole-mask release, all stacking directions and appearance transfer', async () => {
      await layers([{ op: 'group', ids: ['a', 'b'], group: 'test-group' }, { op: 'mask', ids: ['a', 'b'], mask: 'b' }]); assert.equal((await layer('b')).data.maskOnly, true);
      await layers([{ op: 'unmask', ids: ['a'] }]); assert.deepEqual((await inspect()).groups['test-group'], ['a', 'b']);
      await layers([{ op: 'ungroup', ids: ['a'] }]); assert.equal((await layer('b')).data.group, undefined);
      for (const direction of ['front', 'backward', 'back', 'forward']) await layers([{ op: 'reorder', ids: ['a'], direction }]);
      await layers([{ op: 'appearance', ids: ['a'], appearance: { opacity: .8, blur: 2, paint: { fill: '#336699', paints: [{ type: 'solid', color: '#336699' }], radius: 12 } } }, { op: 'appearance', ids: ['b'], source: 'a' }]);
      assert.equal((await layer('b')).data.opacity, .8); assert.equal((await layer('b')).data.cx, 150);
    });
    await check('all shadow presets, polar/custom geometry, disable and restoration', async () => {
      for (const preset of catalog.editing.shadows.presets) { await layers([{ op: 'shadow', ids: ['a'], preset: preset.id }]); assert.equal((await layer('a')).data.shadow.blur, preset.shadow.blur); }
      await layers([{ op: 'shadow', ids: ['a'], preset: 'soft', shadow: { color: '#123456', alpha: .25, blur: 14 }, distance: 20, angle: 180 }]);
      const shadow = (await layer('a')).data.shadow; assert.equal(shadow.dx, -20); assert.equal(shadow.dy, 0); assert.equal(shadow.alpha, .25);
      await layers([{ op: 'shadow', ids: ['a'], enabled: false }, { op: 'shadow', ids: ['a'] }]); assert.deepEqual((await layer('a')).data.shadow, shadow);
    });
    await check('every fill/outline/gradient action and rectangle/path live corners', async () => {
      await layers([{ op: 'paint', ids: ['a'], action: 'color', color: '#355e76' }, { op: 'paint', ids: ['a'], action: 'none' }, { op: 'paint', ids: ['a'], action: 'restore' }, { op: 'paint', ids: ['a'], action: 'color', target: 'stroke', color: '#edaf4a' }, { op: 'paint', ids: ['a'], action: 'width', width: 4 }, { op: 'paint', ids: ['a'], action: 'swap' }]);
      assert.equal((await layer('a')).data.paints[0].color, '#edaf4a');
      await layers([{ op: 'paint', ids: ['a'], action: 'type', paintType: 'linear' }, { op: 'paint', ids: ['a'], action: 'stop', stop: 1, color: '#c73b73', opacity: .7 }, { op: 'paint', ids: ['a'], action: 'angle', angle: 125 }, { op: 'paint', ids: ['a'], action: 'add', paint: { type: 'solid', color: '#ffffff20' } }, { op: 'paint', ids: ['a'], action: 'patch', index: 1, paint: { color: '#ffffff10' } }, { op: 'paint', ids: ['a'], action: 'remove', index: 1 }, { op: 'corners', ids: ['a'], radius: 18 }]);
      assert.equal((await layer('a')).data.paints.length, 1); assert.equal((await layer('a')).data.paints[0].stops[1].color, '#c73b73b3');
      await layers([{ op: 'add', layer: { ...vector('polygon'), paths: [{ d: 'M0 0L180 0L180 180L0 180Z' }] } }, { op: 'corners', ids: ['polygon'], radius: 16 }]);
      assert.ok((await layer('polygon')).corners.every(c => c.radius === 16));
    });
    await check('all eight vector point/handle/segment operations', async () => {
      const actions = ['move_anchor', 'move_handle', 'split', 'delete_anchor', 'corner', 'smooth', 'bend', 'replace'];
      await layers(actions.map(action => ({ op: 'add', layer: vector(`vector-${action.replaceAll('_', '-')}`) })));
      for (const action of actions) {
        const id = `vector-${action.replaceAll('_', '-')}`, before = (await layer(id, { vectors: true })).data.paths[0].d;
        await layers([{ op: 'vector', id, action, command: action === 'delete_anchor' ? 2 : 1, ...(action === 'move_anchor' ? { point: [190, 110] } : action === 'move_handle' ? { offset: 0, point: [60, 20], linked: false } : action === 'bend' ? { delta: [8, -12], t: .4 } : action === 'replace' ? { d: 'M0 0L180 0L180 160L0 160Z' } : {}) }]);
        const after = await layer(id, { vectors: true }); assert.ok(after.vector.paths[0].anchors.length >= 3); if (!['corner', 'smooth'].includes(action)) assert.notEqual(after.data.paths[0].d, before);
      }
    });
    await check('all four editable boolean operations respect scene stacking', async () => {
      for (const [operation, width] of [['unite', 150], ['subtract', 50], ['intersect', 50], ['exclude', 150]]) {
        await layers([{ op: 'add', layer: rect(`left-${operation}`, 100, 300) }, { op: 'add', layer: rect(`right-${operation}`, 150, 300) }, { op: 'boolean', ids: [`right-${operation}`, `left-${operation}`], operation, resultId: `boolean-${operation}` }]);
        const result = (await layer(`boolean-${operation}`)).data; assert.equal(result.shape, 'path'); assert.equal(result.w, width);
      }
    });
    await check('all canvas, orientation, language order, independent-layout, spacing and template operations', async () => {
      const added = await structure([{ op: 'add_canvas', canvas: { label: 'Probe canvas', size: [500, 700], reuseFrom: 'ipad' } }]), device = added.results[0].device;
      await structure([{ op: 'resize_canvas', device, size: [700, 500], mode: 'keep' }, { op: 'orient_canvas', device: 'iphone', slide: 'native', orientation: 'landscape' }, { op: 'rename_slide', slide: 'native', name: 'Native MCP verification' }, { op: 'reorder_slide', slide: 'typography', relativeTo: 'native', after: false, locale: 'sv-SE' }]);
      assert.deepEqual((await inspect()).designSize, [800, 600]);
      let doc = await read(); assert.equal(doc.studio.slideOrders['sv-SE'][0], 'typography'); assert.equal(doc.studio.slideOrders['en-US'], undefined);
      await structure([{ op: 'orient_canvas', device: 'iphone', slide: 'native', orientation: 'portrait' }, { op: 'independent_layout', device: 'iphone', slide: 'native', independent: true }]);
      assert.equal((await read()).studio.slides[0].layouts.iphone.independent, true);
      await structure([{ op: 'independent_layout', device: 'iphone', slide: 'native', independent: false }]);
      for (const preset of ['app-store', 'google-play', 'custom']) await structure([{ op: 'shared_spacing', device: 'iphone', preset, ...(preset === 'custom' ? { gap: .08 } : {}) }]);
      const saved = await structure([{ op: 'save_template', slide: 'native', name: 'MCP native cards' }]);
      await structure([{ op: 'apply_template', slide: 'template-target', template: saved.results[0].template, devices: ['iphone'] }]);
      assert.equal((await read()).studio.slides.find(s => s.id === 'template-target').layouts.iphone.use, saved.results[0].template);
      await structure([{ op: 'detach_template', slide: 'template-target' }, { op: 'remove_canvas', device }]); assert.equal((await read()).studio.devices[device], undefined);
    });
    await check('shared-row editing and grouping use raw IDs and preserve other canvases', async () => {
      await layers([{ op: 'add', layer: rect('flow-a', 100, 700) }, { op: 'add', layer: rect('flow-b', 800, 700) }, { op: 'group', ids: ['flow-a', 'flow-b'] }, { op: 'shadow', ids: ['flow-a'], preset: 'subtle' }], { device: 'iphone', shared: true });
      const row = await rpc('inspect_layers', { device: 'iphone', shared: true }); assert.ok(row.layers.some(l => l.id === 'flow-b')); assert.ok(row.designSize[0] > 600);
      assert.equal((await read()).studio.sharedCanvas.ipad, undefined);
      await layers([{ op: 'ungroup', ids: ['flow-a'] }, { op: 'remove', id: 'flow-a' }, { op: 'remove', id: 'flow-b' }], { device: 'iphone', shared: true });
    });
    await check('installed and portable local/Google Fonts discovery and embedding', async () => {
      let doc = await read(); const imported = await rpc('import_fonts', { sources: [path.join(project, 'inputs/Mulish.ttf')], revision: doc.revisions.studio }); assert.equal(imported.fonts[0].family, 'Mulish');
      const fonts = await rpc('font_catalog', { search: 'Mulish' }); assert.ok(fonts.embedded.some(f => f.family === 'Mulish')); assert.ok(fs.existsSync(path.join(project, 'assets/fonts', imported.fonts[0].file)));
      doc = await read(); const google = await rpc('import_fonts', { families: ['Mulish'], revision: doc.revisions.studio }); assert.deepEqual(google.missing, []); assert.ok(google.fonts.some(f => f.license));
    });
    await check('capture/art imports, copy drafts and actual measured alignment/distribution', async () => {
      await rpc('import_media', { kind: 'capture', source: path.join(project, 'inputs/screen.png'), device: 'test-phone', name: 'test-screen' });
      const art = await rpc('import_media', { kind: 'art', source: path.join(project, 'inputs/art.png') });
      await layers([{ op: 'add', layer: { id: 'real-device', type: 'device', capture: 'test-screen', cx: 300, top: 220, w: 220 } }, { op: 'add', layer: { id: 'real-text', type: 'text', field: 'headline', fontFamily: 'Mulish', x: 90, capTop: 50, w: 420, boxHeight: 140, size: 52, minSize: 30 } }, { op: 'add', layer: { id: 'real-art', type: 'art', src: art.file, cx: 150, cy: 600, w: 80, h: 160 } }], { device: 'iphone', slide: 'typography' });
      let doc = await read(); await rpc('save_copy', { locale: 'sv-SE', revision: doc.revisions['copy:sv-SE'], copy: { ...doc.copy['sv-SE'], typography: { headline: 'Precision som syns', caption: 'Redigerbara former och typsnitt.' } } });
      doc = await read(); assert.equal(doc.copy['sv-SE']._meta.status, 'draft');
      await rpc('arrange_layers', { device: 'iphone', slide: 'typography', ids: ['real-device', 'real-text'], operation: 'center-x', revision: doc.revisions.studio });
      await layers([{ op: 'add', layer: rect('spacing-a', 80, 500, { w: 40 }) }, { op: 'add', layer: rect('spacing-b', 200, 500, { w: 40 }) }, { op: 'add', layer: rect('spacing-c', 500, 500, { w: 40 }) }]);
      doc = await read(); await rpc('arrange_layers', { device: 'iphone', slide: 'native', ids: ['spacing-a', 'spacing-b', 'spacing-c'], operation: 'distribute-x', revision: doc.revisions.studio });
      const spaced = (await inspect({ ids: ['spacing-a', 'spacing-b', 'spacing-c'] })).layers.map(l => l.data.cx).sort((a, b) => a - b); assert.equal(spaced[1] - spaced[0], spaced[2] - spaced[1]);
      const preview = await rpc('preview_project', { devices: ['iphone'], slides: ['typography'], locales: ['en-US', 'sv-SE'], details: true }); assert.ok(preview.scenes[0].layers.some(l => l.id === 'real-device' && !l.capture.missing)); assert.ok(preview.scenes[1].layers.some(l => l.id === 'real-text' && l.text.lines > 0)); report.typographyPreview = preview.file;
    });
    async function importDesign(source, format, slide, extra = {}) {
      const selected = await rpc('prepare_design_import', { action: 'inspect', source, format, ...extra }); assert.ok(selected.frames.length);
      const doc = await read(), plan = await rpc('prepare_design_import', { action: 'prepare', source, format, ids: [selected.frames[0].id], device: 'iphone', slide, locale: 'en-US', revision: doc.revisions.studio, ...extra });
      assert.equal(plan.applied, false); assert.ok(plan.edits.some(e => e.layer.type === 'text'));
      await rpc('edit_layers', { revision: plan.revision, edits: plan.edits }); await rpc('save_copy', { locale: 'en-US', revision: plan.copyRevision, copy: plan.copy });
      const preview = await rpc('preview_project', { devices: ['iphone'], slides: [slide], locales: ['en-US'], details: true }); assert.ok(preview.scenes[0].layers.some(l => l.type === 'text' && l.text.lines > 0)); return { selected, plan, preview: preview.file };
    }
    await check('native Figma REST JSON/image fills and native binary clipboard imports', async () => {
      const json = await importDesign(path.join(project, 'inputs/figma.json'), 'figma-json', 'figma-local', { images: { photo: path.join(project, 'inputs/art.png') } });
      assert.ok(json.plan.edits.some(e => e.layer.paints?.some(p => p.type === 'image' && p.src)));
      await importDesign(path.join(project, 'inputs/figma.html'), 'figma-clipboard', 'figma-clipboard'); report.localFigmaPreview = json.preview;
    });
    if (process.env.STUDIO_TEST_FIGMA_URL && !report.remoteFigmaBlocked) {
      try { await check('real Figma URL, saved Keychain connection and editable imported result', async () => {
        const result = await importDesign(undefined, undefined, 'figma-remote', { url: process.env.STUDIO_TEST_FIGMA_URL }); report.remoteFigma = { frames: result.selected.frames.map(f => ({ id: f.id, name: f.name })), layerCount: result.plan.edits.length, warnings: result.plan.warnings, fonts: result.plan.fonts, preview: result.preview }; delete report.remoteFigmaBlocked;
      }); } catch (error) {
        if (!/Figma.s rate limit was reached/.test(error.message)) throw error;
        report.remoteFigmaBlocked = { message: 'The real Figma API returned its rate limit response. A successful remote import is not verified.', at: new Date().toISOString() }; saveReport(); console.log('BLOCKED: real Figma URL — Figma API rate limit; continuing local feature verification');
      }
    }
    await check('invalid batches and stale sessions/revisions reject without saving', async () => {
      const doc = await read(); await rpc('edit_layers', { revision: doc.revisions.studio, edits: [{ op: 'patch', device: 'iphone', slide: 'native', id: 'a', patch: { opacity: .01 } }, { op: 'corners', device: 'iphone', slide: 'native', ids: ['missing'], radius: 5 }] }, { fail: true }); assert.equal((await read()).revisions.studio, doc.revisions.studio);
      const stale = await client.callTool({ name: 'edit_project', arguments: { projectSession: 'old-session', revision: doc.revisions.studio, edits: [{ op: 'rename_slide', slide: 'native', name: 'Should not save' }] } }); assert.equal(stale.isError, true);
      await rpc('edit_project', { revision: 'a'.repeat(64), edits: [{ op: 'rename_slide', slide: 'native', name: 'Should not save' }] }, { fail: true }); assert.equal((await read()).revisions.studio, doc.revisions.studio);
    });
    await check('built-in designs and independent store artwork are usable through the live app', async () => {
      let doc = await read(); await rpc('apply_design', { slide: 'template-target', devices: ['iphone'], design: 'spotlight', revision: doc.revisions.studio }); doc = await read();
      const result = await rpc('add_store_images', { store: 'google-play', revision: doc.revisions.studio }); assert.equal(result.images.length, 1); report.storeImage = result.images[0];
    });
    await check('persisted proof design, image preview, preflight and strict RGB output/rejection', async () => {
      let doc = await read(), studio = doc.studio, proof = studio.slides.find(s => s.id === 'native');
      const visible = (await inspect()).layers;
      const union = (visible.find(l => l.id === 'boolean-unite') ?? visible.find(l => l.id === 'proof-vector')).data;
      proof.layouts.iphone = { template: 'custom', panorama: false, layers: [
        { id: 'proof-title', type: 'text', field: 'proof', fontFamily: 'Mulish', x: 48, capTop: 56, w: 504, boxHeight: 140, size: 62, minSize: 40, weight: 800, color: '#173346' },
        { ...rect('proof-card', 300, 400, { w: 440, h: 340, fill: '#ffffff', radius: 28 }), shadow: { color: '#173346', alpha: .18, blur: 24, dx: 0, dy: 14 } },
        { ...union, id: 'proof-vector', cx: 300, cy: 365, w: 270, h: 144, paints: [{ type: 'linear', handles: [[0, 0], [1, 1]], stops: [{ position: 0, color: '#2e7191' }, { position: 1, color: '#a564bf' }] }] },
        { id: 'proof-caption', type: 'text', field: 'proofCaption', fontFamily: 'Mulish', x: 80, capTop: 495, w: 440, boxHeight: 50, size: 20, minSize: 16, weight: 600, color: '#173346', align: 'center' },
      ] };
      proof.localeLayouts = {}; studio.sharedCanvas.iphone.layers = [];
      await rpc('save_document', { studio, revision: doc.revisions.studio }); doc = await read();
      await rpc('save_copy', { locale: 'en-US', revision: doc.revisions['copy:en-US'], copy: { ...doc.copy['en-US'], native: { ...doc.copy['en-US'].native, proof: 'MCP VERIFIED', proofCaption: 'Native vectors · fonts · effects · real app' } } });
      doc = await read();
      await rpc('save_copy', { locale: 'sv-SE', revision: doc.revisions['copy:sv-SE'], copy: { ...doc.copy['sv-SE'], native: { ...doc.copy['sv-SE'].native, proof: 'MCP VERIFIERAD', proofCaption: 'Vektorer · typsnitt · effekter · riktig app' } } });
      const preview = await rpc('preview_project', { devices: ['iphone'], slides: ['native'], locales: ['en-US'], details: true }); report.proofPreview = preview.file;
      const image = await rpc('read_image', { file: preview.file }, { raw: true }); assert.equal(image.content[0].type, 'image');
      const check = await rpc('preflight_project', { devices: ['iphone'], slides: ['native'], locales: ['sv-SE'], details: true }); assert.ok(check.report.issues.some(i => i.code === 'copy-review'));
      await rpc('export_project', { devices: ['iphone'], slides: ['native'], locales: ['sv-SE'], mode: 'final' }, { fail: true });
      const exported = await rpc('export_project', { devices: ['iphone'], slides: ['native'], locales: ['en-US'], mode: 'draft' });
      const bytes = fs.readFileSync(exported.files[0].absolutePath), png = decodePNG(bytes); assert.equal(bytes[25], 2); assert.deepEqual([png.width, png.height], [600, 800]); report.proofExport = exported.files[0].absolutePath;
      const store = report.storeImage; await layers([{ op: 'add', layer: rect('strict-content', 512, 250, { w: 900, h: 400, fill: '#173346' }) }], { device: store.deviceId, slide: store.slideId });
      const final = await rpc('export_project', { devices: [store.deviceId], slides: [store.slideId], locales: ['en-US'], mode: 'final' }); assert.equal(fs.readFileSync(final.files[0].absolutePath)[25], 2); report.strictExport = final.files[0].absolutePath;
    });
    assert.deepEqual([...used].sort(), [...available].sort()); assert.deepEqual([...layerOps].sort(), [...catalog.editing.layerOperations].sort()); assert.deepEqual([...projectOps].sort(), [...catalog.editing.projectOperations].sort());
    report.finalRevision = (await read()).revisions.studio; report.finalSession = session; report.completed = new Date().toISOString(); saveReport(); console.log(`COMPLETE: ${used.size} tools, ${layerOps.size} layer operations, ${projectOps.size} project operations\n${reportFile}`);
  }
} catch (error) { report.failure = { message: error.message, stack: error.stack }; saveReport(); console.error(error.stack); process.exitCode = 1; }
finally { await client.close(); }
