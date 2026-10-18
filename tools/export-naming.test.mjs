import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportPlan, exportTimestamp } from '../app/js/export-naming.js';
import { ExportSessions } from '../host/export-sessions.mjs';
import { exportGuide } from '../host/export-guide.mjs';

const fixture = () => ({ locales: [{ id: 'sv' }, { id: 'en-US' }], devices: {
  phone: { label: 'Android phone', target: 'play-phone', size: [1080, 1920] },
  phone2: { label: 'Large phone', target: 'play-phone', size: [1440, 2560] },
  tablet: { label: 'Tablet', target: 'play-tablet-10', size: [1080, 1920] },
  apple: { label: 'iPhone', target: 'iphone', size: [1320, 2868] },
}, slides: [{ id: 'one', name: 'Välkommen hem' }, { id: 'two', name: 'Explore' }, { id: 'three', name: 'Explore' }] });

test('filenames identify selected-batch position, store, section, size, locale and slide', () => {
  const plan = exportPlan(fixture(), { locales: ['sv'], devices: ['phone'], slides: ['three', 'one'] });
  assert.deepEqual(plan.map(f => [f.position, f.sourcePosition, f.filename]), [
    [1, 1, '1080x1920__google-play__phone__sv__01__valkommen-hem.png'],
    [2, 3, '1080x1920__google-play__phone__sv__02__explore.png'],
  ]);
  assert.equal(plan[1].requestPath, 'sv/phone/03-three.png');
});

test('positions are unique across same-section canvases and reset for each language and store section', () => {
  const plan = exportPlan(fixture());
  const section = plan.filter(f => f.locale === 'sv' && f.target === 'play-phone');
  assert.deepEqual(section.map(f => f.position), [1, 2, 3, 4, 5, 6]);
  assert.equal(plan.find(f => f.locale === 'en-US').position, 1);
  assert.equal(plan.find(f => f.device === 'tablet').position, 1);
  assert.equal(plan.find(f => f.device === 'apple').position, 1);
  assert.equal(new Set(plan.map(f => f.path)).size, plan.length);
  assert.match(plan.find(f => f.device === 'apple').filename, /1320x2868__app-store__iphone-dynamic-island-large/);
});

test('export folder timestamps use local calendar fields including leading zeroes', () => {
  assert.equal(exportTimestamp(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02_03-04-05');
});

test('host freezes upload metadata, rejects wrong images and publishes its guide atomically', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-export-names-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), output = path.join(root, 'output'); fs.mkdirSync(project);
  const doc = fixture(); fs.writeFileSync(path.join(project, 'studio.json'), JSON.stringify(doc));
  const sessions = new ExportSessions(project, output); t.after(() => sessions.close());
  const run = sessions.start('final', { locales: ['sv'], devices: ['phone'], slides: ['one', 'three'] });
  doc.slides.reverse(); doc.devices.phone.label = 'Changed later'; fs.writeFileSync(path.join(project, 'studio.json'), JSON.stringify(doc));
  assert.throws(() => sessions.write(run.id, 'sv/phone/02-two.png', Buffer.from('png'), [1080, 1920]), /not part/);
  assert.throws(() => sessions.write(run.id, 'sv/phone/01-one.png', Buffer.from('png'), [1920, 1080]), /dimensions/);
  const first = sessions.write(run.id, 'sv/phone/01-one.png', Buffer.from('png'), [1080, 1920]);
  assert.equal(first.canvas, 'Android phone');
  assert.throws(() => sessions.write(run.id, 'sv/phone/01-one.png', Buffer.from('png'), [1080, 1920]), /already written/);
  assert.throws(() => sessions.finish(run.id, { warnings: [] }), /incomplete/);
  sessions.write(run.id, 'sv/phone/03-three.png', Buffer.from('png'), [1080, 1920]);
  const folder = sessions.finish(run.id, { warnings: [] });
  assert.match(path.basename(folder), /^final-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-f0-9]{8}$/);
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json')));
  assert.equal(manifest.format, 2); assert.ok(manifest.timeZone); assert.equal(manifest.files[1].position, 2);
  assert.ok(fs.existsSync(path.join(folder, first.path)));
  const guide = fs.readFileSync(path.join(folder, 'UPLOAD-GUIDE.html'), 'utf8');
  assert.match(guide, /Google Play \/ Android phone/); assert.ok(guide.includes(first.filename));
  assert.match(guide, /Project slide 3/); assert.ok(!fs.existsSync(run.staging));
});

test('upload guide escapes project names and shows draft warnings without remote assets', () => {
  const doc = fixture(); doc.slides[0].name = '<img src=x onerror=alert(1)>'; doc.devices.phone.label = '<script>bad</script>';
  const files = exportPlan(doc, { locales: ['sv'], devices: ['phone'], slides: ['one'] });
  const html = exportGuide({ files, mode: 'draft', localStarted: '2026-10-08_20-00-00', timeZone: 'Europe/Stockholm', report: { warnings: ['<bad>'] } });
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;')); assert.ok(html.includes('&lt;bad&gt;'));
  assert.ok(!html.includes('src="http')); assert.match(html, /Draft export/);
});

test('exports remain in the portable document after reopen and Save As while snapshots omit previous runs', async t => {
  const { copyProject } = await import('../host/files.mjs');
  const { createStudioService } = await import('../host/service.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-saved-exports-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'Original.sss'), output = path.join(root, 'external');
  fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'studio.json'), JSON.stringify(fixture()));
  const sessions = new ExportSessions(project, output); t.after(() => sessions.close());
  const run = sessions.start('draft', { locales: ['sv'], devices: ['apple'], slides: ['one'] });
  const file = [...run.plan.values()][0]; sessions.write(run.id, file.requestPath, Buffer.from('saved-image'), file.size);
  const external = sessions.finish(run.id, { issues: [], warnings: [], skipped: [] });
  const archive = path.join(project, 'export', path.basename(external));
  assert.ok(fs.readFileSync(path.join(archive, file.path)).equals(fs.readFileSync(path.join(external, file.path))));
  const next = sessions.start('draft', {});
  assert.equal(fs.existsSync(path.join(next.source, 'export')), false); sessions.abort(next.id);
  const copy = path.join(root, 'Copy.sss'); copyProject(project, copy);
  assert.ok(fs.existsSync(path.join(copy, 'export', path.basename(external), file.path)));
  const service = createStudioService({ appPath: path.resolve('app'), projectPath: copy, exportPath: path.join(copy, 'export'), origin: 'studio://local' }); t.after(() => service.close());
  const response = await service.request(new Request('studio://local/api/export-runs'));
  const { runs } = await response.json(); assert.equal(runs.length, 1); assert.equal(runs[0].count, 1);
  assert.equal(service.uploadExportPath(runs[0].path), runs[0].path);
  assert.throws(() => service.uploadExportPath(path.join(root, 'unselected')), /Choose/);
  assert.equal(service.retainSavedExport(runs[0].path), runs[0].path, 'Choosing an archived run does not duplicate it');
});
