import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppStoreClient, AppStoreUploads, tokenFor, validateCredentials, screenshotGroups, creativeGroups, matchScreenshot, loadUploadExport, inspectUploadExport } from '../host/app-store-connect.mjs';
import { uploadChecks } from '../app/js/upload-checks.js';
import { encodePNG } from './png.mjs';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const credentials = { keyId: 'TESTKEY123', issuerId: '12345678-1234-1234-1234-123456789abc', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const catalog = {
  features: [{ featureId: 'APP_STORE_VERSIONS', placementPolicies: [{ placementType: 'APP_SCREENSHOT', groupLimits: [{ groupIds: ['TEST_IPHONE_PROFILE'], maxCount: 10 }] }] }],
  placementTypes: [{ placementTypeId: 'APP_SCREENSHOT', acceptsAssetCategories: ['APP_SCREENSHOTS_AND_PREVIEWS'], specMappings: [{ placementGroupId: 'TEST_IPHONE_PROFILE', specs: ['spec-1'] }] }],
  placementProfileGroups: [{ placementProfileGroupId: 'TEST_IPHONE_PROFILE', platform: 'IPHONE_APP_STORE', displayClassId: 'IPHONE' }],
  imageSpecs: [{ specId: 'spec-1', dimensions: { minWidth: 2, maxWidth: 2, minHeight: 3, maxHeight: 3 }, mimeTypes: ['image/png'], fileExtensions: ['.png'], maxFileSize: 100000 }],
};
function fixture(t, count = 2) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-asc-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = encodePNG({ width: 2, height: 3, channels: 3, data: Buffer.alloc(2 * 3 * 4, 255) });
  const files = Array.from({ length: count }, (_, i) => ({ path: `${i}.png`, filename: `${i}.png`, store: 'app-store', size: [2, 3], bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), locale: 'en-US', device: 'iphone', canvas: 'iPhone', slide: `Slide ${i + 1}`, position: i + 1 }));
  for (const file of files) fs.writeFileSync(path.join(root, file.path), bytes);
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ format: 2, mode: 'final', completed: new Date().toISOString(), files, report: { issues: [], warnings: [], skipped: [] } }));
  return { root, bytes, files };
}
function apple({ bytes, existing = [], commitFailsAt = 0, wrongSpec = false, mutate = false, reference = catalog, onCommit, locales = ['en-US'] } = {}) {
  const names = new Set(), calls = [], images = new Map(), placements = [...existing]; let imageCount = 0, placementCount = 0, reads = 0, commits = 0;
  const localized = new Map(locales.map((locale, i) => [`locale-${i + 1}`, i === 0 ? placements : []]));
  const fetchImpl = async (input, options) => {
    const url = new URL(input), method = options.method, body = options.body && method !== 'PUT' ? JSON.parse(options.body) : null;
    calls.push({ url, method, body, headers: options.headers, bytes: method === 'PUT' ? Buffer.from(options.body) : null });
    const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
    if (url.origin !== 'https://api.appstoreconnect.apple.com') {
      assert.equal(url.hostname, 'store-030.blobstore.apple.com'); assert.equal(options.headers.Authorization, undefined);
      return response({});
    }
    assert.match(options.headers.Authorization, /^Bearer /);
    const p = url.pathname;
    if (p === '/v1/apps') return response({ data: [{ id: 'app-1', attributes: { name: 'Test app', bundleId: 'test.example' } }] });
    if (p === '/v1/apps/app-1/appStoreVersions') return response({ data: [{ id: 'version-1', attributes: { appStoreState: 'PREPARE_FOR_SUBMISSION', platform: 'IOS' } }] });
    if (p === '/v1/appStoreVersions/version-1/appStoreVersionLocalizations') return response({ data: locales.map((locale, i) => ({ id: `locale-${i + 1}`, attributes: { locale } })) });
    if (p === '/v1/appAssetLibraryRefData') return response({ data: [{ attributes: reference }] });
    if (p === '/v1/apps/app-1/assetLibrary') return response({ data: { id: 'library-1' } });
    if (/^\/v1\/appStoreVersionLocalizations\/locale-\d+\/placements$/.test(p)) {
      const placements = localized.get(p.split('/')[3]);
      reads++;
      if (mutate && reads === 2) placements.push({ id: 'other-person', attributes: { placementGroup: 'TEST_IPHONE_PROFILE' } });
      return response({ data: placements });
    }
    if (p === '/v1/appAssetLibraryImages' && method === 'POST') {
      const name = body.data.attributes.referenceName;
      if (names.has(name)) return response({ errors: [{ detail: 'Reference name is already in use' }] }, 409);
      names.add(name);
      const imageId = `image-${++imageCount}`; images.set(imageId, false);
      assert.equal(body.data.attributes.fileSize, bytes.length);
      assert.equal(body.data.relationships.assetLibrary.data.id, 'library-1');
      return response({ data: { id: imageId, attributes: { uploadOperations: [{ method: 'PUT', url: 'https://store-030.blobstore.apple.com/part1', offset: 0, length: 10, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] }, { method: 'PUT', url: 'https://store-030.blobstore.apple.com/part2', offset: 10, length: bytes.length - 10 }] } } }, 201);
    }
    if (p.startsWith('/v1/appAssetLibraryImages/')) {
      const imageId = p.split('/').at(-1);
      if (method === 'PATCH') {
        assert.deepEqual(body.data.attributes, { uploaded: true });
        if (++commits === commitFailsAt) return response({ errors: [{ detail: 'Image commit failed.' }] }, 409);
        images.set(imageId, true); onCommit?.();
        return response({ data: { id: imageId, attributes: { state: 'UPLOAD_COMPLETE', specId: wrongSpec ? 'unexpected-spec' : null } } });
      }
      throw new Error('Image processing must not be polled.');
    }
    if (p.startsWith('/v1/appAssetLibraryPlacements/') && method === 'DELETE') { placements.splice(placements.findIndex(x => x.id === p.split('/').at(-1)), 1); return response(null, 204); }
    if (p === '/v1/appAssetLibraryPlacements') {
      assert.ok(['APP_SCREENSHOT', 'PRODUCT_PAGE_HEADER_ASSET', 'APP_STORE_SEARCH_RESULTS_ASSET'].includes(body.data.attributes.placementType));
      const placements = localized.get(body.data.relationships.appStoreVersionLocalization.data.id);
      const placement = { id: `placed-${++placementCount}`, attributes: { placementType: body.data.attributes.placementType, placementGroup: body.data.attributes.placementGroup, state: 'ASSET_PROCESSING' } }; placements.push(placement);
      return response({ data: placement }, 201);
    }
    if (p === '/v1/appAssetLibraryPlacementOrderingRequests') {
      const placements = localized.get(body.data.relationships.appStoreVersionLocalization.data.id);
      const ids = body.data.relationships.orderedPlacements.data.map(x => x.id);
      placements.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); return response({ data: { id: 'order-1' } }, 201);
    }
    throw new Error(`Unexpected request ${method} ${p}`);
  };
  return { calls, images, placements, localized, client: new AppStoreClient(credentials, { fetchImpl, sleep: async () => {} }) };
}
async function finish(uploads, jobId) {
  for (let i = 0; i < 500; i++) { const job = uploads.status(jobId); if (job.state !== 'running') return job; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('Upload did not finish');
}
test('JWT uses ES256, correct claims and a short lifetime; individual keys use sub', () => {
  const token = tokenFor(credentials, 1000), [header, payload, signature] = token.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iss: credentials.issuerId, iat: 990, exp: 1300, aud: 'appstoreconnect-v1' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  const claims = JSON.parse(Buffer.from(tokenFor({ ...credentials, issuerId: '' }).split('.')[1], 'base64url'));
  assert.equal(claims.sub, 'user'); assert.equal(claims.iss, undefined);
  assert.throws(() => validateCredentials({ ...credentials, privateKey: 'invalid' }), /valid.*p8/);
});
test('catalog mapping uses runtime groups, exact sizes, platform and byte limits', () => {
  const groups = screenshotGroups(catalog, 'IOS');
  assert.equal(matchScreenshot({ size: [2, 3], bytes: 50 }, groups)[0].id, 'TEST_IPHONE_PROFILE');
  assert.deepEqual(matchScreenshot({ size: [3, 2], bytes: 50 }, groups), []);
  assert.deepEqual(matchScreenshot({ size: [2, 3], bytes: 100001 }, groups), []);
  assert.deepEqual(screenshotGroups(catalog, 'MAC_OS'), []);
});
test('Apple reference data matches iPhone and iPad screenshots in one IOS version review', async t => {
  // Minimized from Apple's reference endpoint: profile platforms differ from AppStoreVersion.platform.
  const reference = JSON.parse(fs.readFileSync(new URL('./fixtures/app-store-screenshot-catalog.json', import.meta.url)));
  const { root, files } = fixture(t);
  const screens = [
    { size: [1206, 2622], device: 'iphone', canvas: 'iPhone 18 Pro', group: 'IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE' },
    { size: [2064, 2752], device: 'ipad', canvas: 'iPad Air 13-inch (M4)', group: 'IPAD_13_PROFILE' },
  ];
  for (const [index, screen] of screens.entries()) {
    const [width, height] = screen.size;
    const bytes = encodePNG({ width, height, channels: 3, data: Buffer.alloc(width * height * 4, 255) });
    Object.assign(files[index], { size: screen.size, device: screen.device, canvas: screen.canvas, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    fs.writeFileSync(path.join(root, files[index].path), bytes);
  }
  const manifestPath = path.join(root, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.files = files; fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const fake = apple({ reference }), uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.entries.map(e => e.groupId), screens.map(s => s.group));
  assert.ok(plan.entries.every(e => e.choices.length === 1));
  assert.equal(plan.groups.length, 2);
  assert.ok(fake.calls.every(c => c.method === 'GET'), 'Review stays read-only');
});
test('Apple reference groups stay within the selected app version platform', () => {
  const reference = JSON.parse(fs.readFileSync(new URL('./fixtures/app-store-screenshot-catalog.json', import.meta.url)));
  assert.deepEqual(screenshotGroups(reference, 'IOS').map(g => g.id).sort(), ['IPAD_13_PROFILE', 'IPHONE_DUO_PROFILE', 'IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE', 'WATCH_ULTRA_PROFILE']);
  assert.deepEqual(screenshotGroups(reference, 'MAC_OS').map(g => g.id), ['MAC_PROFILE']);
  assert.deepEqual(screenshotGroups(reference, 'TV_OS').map(g => g.id), ['TV_PROFILE']);
  assert.deepEqual(screenshotGroups(reference, 'VISION_OS').map(g => g.id), ['VISION_PRO_PROFILE']);
  assert.throws(() => screenshotGroups(reference, 'UNKNOWN'), /does not support.*platform/);
});
test('missing catalog groups report a catalog problem before blaming image dimensions', async t => {
  const { root } = fixture(t), reference = structuredClone(catalog);
  reference.placementProfileGroups[0].platform = 'UNRECOGNIZED_APP_STORE';
  const fake = apple({ reference }), uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  await assert.rejects(uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' }), /image specifications.*catalog/);
  assert.ok(fake.calls.every(c => c.method === 'GET'));
});
test('completed drafts are accepted; changed bytes, alpha and paths escaping the export are rejected', t => {
  const { root, files } = fixture(t, 1);
  assert.equal(loadUploadExport(root).length, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  manifest.mode = 'draft'; fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(loadUploadExport(root).length, 1);
  manifest.mode = 'final'; manifest.files[0].path = '../secret.png'; fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => loadUploadExport(root));
  manifest.files = files;
  const original = fs.readFileSync(path.join(root, files[0].path));
  const alpha = encodePNG({ width: 2, height: 3, channels: 4, data: Buffer.alloc(2 * 3 * 4, 255) });
  manifest.files[0].bytes = alpha.length; manifest.files[0].sha256 = crypto.createHash('sha256').update(alpha).digest('hex');
  fs.writeFileSync(path.join(root, files[0].path), alpha); fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => loadUploadExport(root), /Invalid RGB/);
  manifest.files[0].bytes = original.length; manifest.files[0].sha256 = crypto.createHash('sha256').update(original).digest('hex');
  fs.writeFileSync(path.join(root, files[0].path), original); fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  fs.appendFileSync(path.join(root, files[0].path), 'changed'); assert.throws(() => loadUploadExport(root), /changed/);
});
test('layout and review checks are advisory while missing assets and unknown errors remain technical', () => {
  const issues = [
    { level: 'error', code: 'overflow', message: 'Text exceeds its line limit' },
    { level: 'warn', code: 'copy-review', message: 'Translation needs review' },
    { level: 'warn', code: 'shrunk', message: 'Text is smaller' },
    { level: 'error', code: 'capture-missing', message: 'Screenshot missing' },
    { level: 'warn', code: 'asset-missing', message: 'Image missing' },
    { level: 'error', message: 'Invalid output dimensions' },
  ];
  const result = uploadChecks({ issues, warnings: issues.map(i => i.message), skipped: ['en-US · skipped'] });
  assert.equal(result.warnings.length, 3); assert.ok(result.warnings.every(i => i.level === 'warn'));
  assert.equal(result.errors.length, 4);
});
test('draft warnings require explicit acknowledgment; a fresh host can upload an older export', async t => {
  const { root, bytes } = fixture(t), manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath)); manifest.mode = 'draft';
  manifest.report.issues = [{ level: 'error', code: 'overflow', message: 'Text exceeds its line limit' }, { level: 'warn', code: 'copy-review', message: 'Translation needs review' }];
  manifest.report.warnings = manifest.report.issues.map(i => i.message); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const fake = apple({ bytes }), uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  assert.deepEqual(plan.errors, []); assert.equal(plan.warnings.length, 2);
  assert.throws(() => uploads.start(plan.planId), /warnings/);
  assert.throws(() => uploads.start(plan.planId, { acknowledgeWarnings: 'true' }), /warnings/);
  assert.ok(fake.calls.every(c => c.method === 'GET'));
  const job = await finish(uploads, uploads.start(plan.planId, { acknowledgeWarnings: true }).id);
  assert.equal(job.state, 'complete', job.message); assert.equal(job.warningsAcknowledged, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'reports', `${job.id}.json`))).warnings.length, 2);
});
test('technical errors, missing images and incomplete exports cannot be bypassed by warning consent', async t => {
  const { root, bytes, files } = fixture(t), manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath)); manifest.mode = 'draft';
  const fake = apple({ bytes }), uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  for (const code of ['capture-missing', 'asset-missing', 'frame-missing', 'unknown-technical-error']) {
    manifest.report.issues = [{ level: 'error', code, message: 'Technical failure' }]; fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.equal(inspectUploadExport(root).errors.length, 1);
    await assert.rejects(uploads.prepare({ root, appId: 'app-1', versionId: 'version-1', acknowledgeWarnings: true }), /Technical failure/);
  }
  assert.equal(fake.calls.length, 0);
  manifest.report.issues = []; delete manifest.completed; fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => loadUploadExport(root), /completed/);
  manifest.completed = new Date().toISOString(); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.unlinkSync(path.join(root, files[0].path)); assert.equal(inspectUploadExport(root).errors.length, 1);
});
test('changes after review stop upload before any remote writes', async t => {
  const { root, bytes, files } = fixture(t), fake = apple({ bytes });
  const uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  fs.appendFileSync(path.join(root, files[0].path), 'changed');
  assert.throws(() => uploads.start(plan.planId, { acknowledgeWarnings: true }), /changed/);
  assert.ok(fake.calls.every(c => c.method === 'GET'));
});
test('upload sends multipart bytes without JWT, commits, places and verifies order; report contains no secrets', async t => {
  const { root, bytes } = fixture(t); const fake = apple({ bytes });
  const uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  assert.deepEqual(plan.errors, []);
  assert.equal(fake.calls.some(c => c.method !== 'GET'), false, 'Review is read-only');
  const { id } = uploads.start(plan.planId); const job = await finish(uploads, id);
  assert.equal(job.state, 'complete', job.message); assert.equal(job.files.length, 2);
  assert.ok(job.files.every(f => f.state === 'Uploaded' && f.placementVerified && f.applePlacementState === 'ASSET_PROCESSING'));
  const parts = fake.calls.filter(c => c.method === 'PUT'); assert.deepEqual(Buffer.concat(parts.slice(0, 2).map(c => c.bytes)), bytes);
  const report = fs.readFileSync(path.join(root, 'reports', `${id}.json`), 'utf8');
  assert.ok(!report.includes('PRIVATE KEY') && !report.includes('Bearer') && !report.includes('blobstore'));
  assert.throws(() => uploads.start(plan.planId), /Review/);
});
test('replacement commits every image before removing existing screenshots', async t => {
  const { root, bytes } = fixture(t); const fake = apple({ bytes, existing: [{ id: 'old-1', attributes: { placementGroup: 'TEST_IPHONE_PROFILE' } }] });
  const uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1', replace: true });
  assert.equal(plan.groups[0].existing, 1);
  const job = await finish(uploads, uploads.start(plan.planId).id); assert.equal(job.state, 'complete', job.message);
  const deleted = fake.calls.findIndex(c => c.method === 'DELETE');
  const commits = fake.calls.map((c, i) => c.method === 'PATCH' ? i : -1).filter(i => i >= 0);
  assert.ok(commits.every(i => i < deleted)); assert.deepEqual(job.removed, ['old-1']);
});
test('upload completes while Apple is still processing; no image processing polls', async t => {
  const { root, bytes } = fixture(t);
  const fake = apple({ bytes, existing: [{ id: 'old-1', attributes: { placementGroup: 'TEST_IPHONE_PROFILE' } }] });
  const uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1', replace: true });
  const job = await finish(uploads, uploads.start(plan.planId).id);
  assert.equal(job.state, 'complete', job.message);
  assert.equal(job.uploaded, 2); assert.equal(job.total, 2);
  assert.ok(job.files.every(f => f.applePlacementState === 'ASSET_PROCESSING' && f.placementVerified));
  assert.ok(!fake.calls.some(c => c.method === 'GET' && c.url.pathname.startsWith('/v1/appAssetLibraryImages/')));
  assert.match(job.message, /2 images uploaded/);
});
test('stop after a committed image preserves its receipt and stops further uploads', async t => {
  const { root, bytes } = fixture(t); let uploads, jobId;
  const fake = apple({ bytes, onCommit: () => uploads.stop(jobId) });
  uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  jobId = uploads.start(plan.planId).id;
  const job = await finish(uploads, jobId);
  assert.equal(job.state, 'stopped'); assert.equal(job.uploaded, 1);
  assert.equal(job.files[0].state, 'Uploaded');
  assert.equal(fake.calls.filter(c => c.method === 'POST' && c.url.pathname === '/v1/appAssetLibraryImages').length, 1);
  assert.ok(!fake.calls.some(c => c.method === 'DELETE' || c.method === 'POST' && c.url.pathname === '/v1/appAssetLibraryPlacements'));
});
test('a failed commit never confirms all uploads or removes existing screenshots', async t => {
  const { root, bytes } = fixture(t);
  const fake = apple({ bytes, commitFailsAt: 2, existing: [{ id: 'old-1', attributes: { placementGroup: 'TEST_IPHONE_PROFILE' } }] });
  const uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1', replace: true });
  const job = await finish(uploads, uploads.start(plan.planId).id);
  assert.equal(job.state, 'failed'); assert.match(job.message, /Image commit failed/);
  assert.equal(job.uploaded, 1); assert.equal(job.total, 2);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'reports', `${job.id}.json`)));
  assert.equal(report.uploaded, 1); assert.ok(report.files[0].imageId);
  assert.ok(!fake.calls.some(c => c.method === 'DELETE' || c.method === 'POST' && c.url.pathname === '/v1/appAssetLibraryPlacements'));
});
test('remote edits invalidate review before any writes', async t => {
  const { root, bytes } = fixture(t); const fake = apple({ bytes, mutate: true });
  const uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  const job = await finish(uploads, uploads.start(plan.planId).id);
  assert.equal(job.state, 'failed'); assert.match(job.message, /changed/); assert.ok(fake.calls.every(c => c.method === 'GET'));
});
for (const [label, options] of [['commit failure', { commitFailsAt: 1 }], ['wrong specification returned by commit', { wrongSpec: true }]]) test(`${label} leaves existing placements intact and saves image ID`, async t => {
  const { root, bytes } = fixture(t); const fake = apple({ bytes, ...options, existing: [{ id: 'old-1', attributes: { placementGroup: 'TEST_IPHONE_PROFILE' } }] });
  const uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1', replace: true });
  const job = await finish(uploads, uploads.start(plan.planId).id);
  assert.equal(job.state, 'failed'); assert.ok(job.files[0].imageId); assert.ok(!fake.calls.some(c => c.method === 'DELETE'));
});
test('keeping existing groups does not block missing groups; replacement still enforces the limit', async t => {
  const { root, bytes } = fixture(t, 11); const fake = apple({ bytes, existing: Array.from({ length: 10 }, (_, i) => ({ id: `old-${i}`, attributes: { placementGroup: 'TEST_IPHONE_PROFILE' } })) });
  const uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const kept = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  assert.equal(kept.keptGroups.length, 1); assert.equal(kept.entries.length, 0);
  assert.match(kept.errors[0], /already have screenshots/);
  assert.throws(() => uploads.start(kept.planId), /Review/);
  const blocked = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1', replace: true });
  assert.match(blocked.errors[0], /limit of 10/);
});
test('pagination cannot forward authentication to another origin; writes are never auto-retried', async () => {
  let calls = 0;
  const client = new AppStoreClient(credentials, { fetchImpl: async () => { calls++; return new Response(JSON.stringify({ data: [], links: { next: 'https://example.com/v1/apps' } })); } });
  await assert.rejects(client.apps(), /Invalid.*URL/); assert.equal(calls, 1);
  const failing = new AppStoreClient(credentials, { fetchImpl: async () => { calls++; return new Response('{}', { status: 503 }); } });
  await assert.rejects(failing.request('/v1/appAssetLibraryImages', { method: 'POST', body: {} }), /503/); assert.equal(calls, 2);
});

test('stop before image reservation leaves the remote screenshots unchanged', async t => {
  const { root, bytes } = fixture(t); const fake = apple({ bytes });
  const uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  const { id } = uploads.start(plan.planId); uploads.stop(id);
  const job = await finish(uploads, id);
  assert.equal(job.state, 'stopped'); assert.match(job.message, /stopped/);
  assert.ok(fake.calls.every(c => c.method === 'GET'));
});

function writeFiles(root, files) {
  const manifestPath = path.join(root, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.files = files; fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}
test('en-GB already uploaded keeps that group and uploads every other language', async t => {
  const locales = ['en-GB', 'ar-SA', 'sv', 'fr-FR', 'de-DE', 'he', 'hi', 'it', 'pt-BR', 'pt-PT', 'ru', 'es-ES', 'ja', 'ko'];
  const { root, bytes, files } = fixture(t, 28);
  files.forEach((f, i) => Object.assign(f, { locale: locales[Math.floor(i / 2)], slide: `Slide ${i % 2 + 1}`, position: i % 2 + 1 }));
  writeFiles(root, files);
  const existing = Array.from({ length: 10 }, (_, i) => ({ id: `old-${i}`, attributes: { placementGroup: 'TEST_IPHONE_PROFILE' } }));
  const fake = apple({ bytes, locales, existing }), uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  assert.deepEqual(plan.errors, []); assert.equal(plan.locales.length, 14);
  assert.deepEqual(plan.keptGroups.map(g => g.locale), ['en-GB']);
  assert.equal(plan.groups.length, 13); assert.equal(plan.entries.length, 26);
  const job = await finish(uploads, uploads.start(plan.planId).id);
  assert.equal(job.state, 'complete', job.message); assert.equal(job.uploaded, 26); assert.equal(job.locales.length, 14);
  assert.deepEqual(fake.localized.get('locale-1').map(p => p.id), existing.map(p => p.id));
  for (let i = 2; i <= 14; i++) assert.equal(fake.localized.get(`locale-${i}`).length, 2);
  assert.ok(!fake.calls.some(c => c.method === 'DELETE'));
});
test('Duo open and closed share one limit and one selection across all languages', async t => {
  const { root, bytes, files } = fixture(t, 28);
  const reference = JSON.parse(JSON.stringify(catalog).replaceAll('TEST_IPHONE_PROFILE', 'IPHONE_DUO_PROFILE'));
  files.forEach((f, i) => Object.assign(f, { locale: i < 14 ? 'en-US' : 'sv', device: i % 14 < 7 ? 'duo-closed' : 'duo-open', canvas: i % 14 < 7 ? 'Duo closed' : 'Duo open', slide: `Slide ${i % 7 + 1}`, position: i % 7 + 1 }));
  writeFiles(root, files);
  const fake = apple({ bytes, reference, locales: ['en-US', 'sv'] }), uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  const review = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  assert.equal(review.screens.length, 1); assert.equal(review.screens[0].images.length, 14); assert.equal(review.screens[0].maxCount, 10);
  assert.equal(review.errors.length, 2); assert.ok(review.errors.every(e => /14 selected.*limit of 10/.test(e)));
  assert.throws(() => uploads.start(review.planId), /Review/);
  const excludedImages = review.screens[0].images.filter(i => i.device === 'duo-open' && i.position > 3).map(i => i.key);
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1', excludedImages });
  assert.deepEqual(plan.errors, []); assert.equal(plan.entries.length, 20);
  assert.ok(plan.groups.every(g => g.incoming === 10));
  const job = await finish(uploads, uploads.start(plan.planId).id);
  assert.equal(job.state, 'complete', job.message); assert.equal(job.uploaded, 20);
  assert.equal(fake.localized.get('locale-1').length, 10); assert.equal(fake.localized.get('locale-2').length, 10);
  assert.ok(fake.calls.filter(c => c.url.pathname === '/v1/appAssetLibraryPlacements').every(c => c.body.data.attributes.placementGroup === 'IPHONE_DUO_PROFILE'));
});
test('empty or invalid screenshot selections cannot start an upload', async t => {
  const { root, bytes, files } = fixture(t), fake = apple({ bytes }), uploads = new AppStoreUploads({ client: fake.client, reportDirectory: path.join(root, 'reports') });
  await assert.rejects(uploads.prepare({ root, appId: 'app-1', versionId: 'version-1', excludedImages: ['unknown'] }), /Invalid screenshot selection/);
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1', excludedImages: files.map(f => JSON.stringify([f.device, f.slide])) });
  assert.match(plan.errors[0], /at least one/); assert.throws(() => uploads.start(plan.planId), /Review/);
  assert.ok(fake.calls.every(c => c.method === 'GET'));
});

test('asset reference names are unique across devices, retries and truncated slide names', async t => {
  const { root, bytes, files } = fixture(t, 3);
  files.forEach((f, i) => Object.assign(f, { slide: 'Same slide '.repeat(30), device: i === 1 ? 'ipad' : 'iphone' }));
  writeFiles(root, files);
  const fake = apple({ bytes });
  const progress = [];
  for (const file of files) await fake.client.uploadImage('library-1', { ...file, root }, { specIds: ['spec-1'] }, new AbortController().signal, value => progress.push(value));
  // Repeat the exact same exported image in a new upload attempt.
  await fake.client.uploadImage('library-1', { ...files[0], root }, { specIds: ['spec-1'] }, new AbortController().signal, value => progress.push(value));
  const names = fake.calls.filter(c => c.method === 'POST' && c.url.pathname === '/v1/appAssetLibraryImages').map(c => c.body.data.attributes.referenceName);
  assert.equal(names.length, 4); assert.equal(new Set(names).size, 4);
  assert.ok(names.every(name => name.length <= 200));
  assert.equal(progress.filter(p => p.state === 'Uploaded').length, 4);
});

test('Apple catalog puts the actual inner and outer Duo sizes in the same group', () => {
  const reference = JSON.parse(fs.readFileSync(new URL('./fixtures/app-store-screenshot-catalog.json', import.meta.url)));
  const groups = screenshotGroups(reference, 'IOS');
  for (const size of [[1398, 2034], [2853, 2007]]) {
    const choices = matchScreenshot({ size, bytes: 2097204 }, groups);
    assert.equal(choices.length, 1); assert.equal(choices[0].id, 'IPHONE_DUO_PROFILE'); assert.equal(choices[0].maxCount, 10);
  }
});


test('creative uploads use their category and placement, enforce limits and leave screenshot placements alone', async t => {
  const { root, bytes, files } = fixture(t, 1);
  const targets = [['app-store-header', 'PRODUCT_PAGE_HEADER_ASSET'], ['app-store-search', 'APP_STORE_SEARCH_RESULTS_ASSET']];
  const reference = structuredClone(catalog);
  for (const [target, type] of targets) {
    // Deliberately share a profile across types: batches and replacement must be scoped by type too.
    reference.features[0].placementPolicies.push({ placementType: type, groupLimits: [{ groupIds: ['TEST_IPHONE_PROFILE'], maxCount: 1 }] });
    reference.placementTypes.push({ placementTypeId: type, acceptsAssetCategories: ['CREATIVE_ASSETS'], specMappings: [{ placementGroupId: 'TEST_IPHONE_PROFILE', specs: ['spec-1'] }] });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  manifest.files = [files[0], ...targets.map(([target], i) => ({ ...files[0], target, path: `creative-${i}.png`, filename: `creative-${i}.png`, device: target, canvas: target, slide: target }))];
  for (const file of manifest.files) fs.writeFileSync(path.join(root, file.path), bytes);
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  const existing = [{ id: 'old-shot', attributes: { placementType: 'APP_SCREENSHOT', placementGroup: 'TEST_IPHONE_PROFILE' } }];
  const api = apple({ bytes, existing, reference });
  const uploads = new AppStoreUploads({ client: api.client, reportDirectory: path.join(root, 'reports') });
  const plan = await uploads.prepare({ root, appId: 'app-1', versionId: 'version-1' });
  assert.deepEqual(plan.errors, []); assert.equal(plan.entries.length, 2); assert.equal(plan.keptGroups.length, 1);
  assert.equal(plan.screens.length, 3, 'shared Apple group ids do not merge different placements in the UI');
  const job = await finish(uploads, uploads.start(plan.planId).id); assert.equal(job.state, 'complete', job.message);
  const reservations = api.calls.filter(c => c.url.pathname === '/v1/appAssetLibraryImages' && c.method === 'POST');
  assert.deepEqual(reservations.map(c => c.body.data.attributes.category), ['CREATIVE_ASSETS', 'CREATIVE_ASSETS']);
  const placements = api.calls.filter(c => c.url.pathname === '/v1/appAssetLibraryPlacements' && c.method === 'POST');
  assert.deepEqual(placements.map(c => c.body.data.attributes.placementType), targets.map(t => t[1]));
  assert.equal(api.calls.some(c => c.method === 'DELETE'), false);
  assert.equal(api.calls.some(c => c.url.pathname === '/v1/appAssetLibraryPlacementOrderingRequests'), false);
  assert.ok(api.placements.some(p => p.id === 'old-shot'));
  const groups = creativeGroups(reference, 'IOS');
  assert.equal(groups.length, 2); assert.equal(creativeGroups(reference, 'MAC_OS').length, 0);
  assert.equal(matchScreenshot(manifest.files[1], groups).length, 1);
});

test('a picked older export is retained in the current project and can be uploaded after restart', async t => {
  const { root, bytes, files } = fixture(t, 1);
  const { createNewProject } = await import('../host/new-project.mjs');
  const { createStudioService } = await import('../host/service.mjs');
  const project = path.join(root, 'Document.sss'); createNewProject(project, {});
  const options = { appPath: path.resolve('app'), projectPath: project, exportPath: path.join(project, 'export'), origin: 'studio://local' };
  const first = createStudioService(options); t.after(() => first.close());
  const retained = first.retainSavedExport(root);
  assert.ok(retained.startsWith(path.join(project, 'export') + path.sep));
  assert.deepEqual(fs.readFileSync(path.join(retained, files[0].path)), bytes);
  assert.equal(first.retainSavedExport(root), retained, 'Reimporting the same export is idempotent');
  fs.unlinkSync(path.join(root, files[0].path));
  const reopened = createStudioService(options); t.after(() => reopened.close());
  assert.equal(reopened.uploadExportPath(retained), retained);
  assert.equal(inspectUploadExport(retained).errors.length, 0);
  const { runs } = await (await reopened.request(new Request('studio://local/api/export-runs'))).json();
  assert.equal(runs.length, 1); assert.equal(runs[0].path, retained);
  assert.equal(runs[0].previews.length, 1);
  const previewURL = new URL(runs[0].previews[0].src, 'studio://local');
  const preview = await reopened.request(new Request(previewURL));
  assert.equal(preview.status, 200);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
  const badFile = new URL(previewURL); badFile.searchParams.set('file', '../studio.json');
  assert.equal((await reopened.request(new Request(badFile))).status, 404);
  const badRun = new URL(previewURL); badRun.searchParams.set('run', '../../');
  assert.equal((await reopened.request(new Request(badRun))).status, 404);
  fs.appendFileSync(path.join(retained, files[0].path), 'changed');
  assert.notEqual((await reopened.request(new Request(previewURL))).status, 200, 'Changed exports cannot supply misleading previews');

});

test('MCP invocation exports are discoverable and authorized for Upload after reopening', async t=>{
 const {root,files}=fixture(t,1);
 const {createNewProject}=await import('../host/new-project.mjs');
 const {createStudioService}=await import('../host/service.mjs');
 const project=path.join(root,'AI.sss');createNewProject(project,{});
 const options={appPath:path.resolve('app'),projectPath:project,exportPath:path.join(project,'export'),origin:'studio://local'};
 const run=path.join(project,'export','artwork','ai-invocation','final-test');
 fs.mkdirSync(run,{recursive:true});fs.copyFileSync(path.join(root,'manifest.json'),path.join(run,'manifest.json'));fs.copyFileSync(path.join(root,files[0].path),path.join(run,files[0].path));
 const service=createStudioService(options);t.after(()=>service.close());
 const response=await service.request(new Request('studio://local/api/export-runs'));const {runs}=await response.json();
 assert.deepEqual(runs.map(r=>r.path),[run]);assert.equal(service.uploadExportPath(run),run);
 const reopened=createStudioService(options);t.after(()=>reopened.close());assert.equal(reopened.uploadExportPath(run),run);
 const outside=path.join(root,'outside','final-test');fs.mkdirSync(outside,{recursive:true});fs.copyFileSync(path.join(root,'manifest.json'),path.join(outside,'manifest.json'));
 fs.symlinkSync(path.dirname(outside),path.join(project,'export','linked'));
 const second=await (await reopened.request(new Request('studio://local/api/export-runs'))).json();assert.equal(second.runs.length,1,'Symlinked exports are not discovered');
 await assert.rejects(async()=>reopened.uploadExportPath(outside),/Choose the saved export/);
});

test('all main screen previews remain accessible beyond the compact saved card sample', async t => {
  const { root, bytes, files } = fixture(t, 6);
  const { createNewProject } = await import('../host/new-project.mjs');
  const { createStudioService } = await import('../host/service.mjs');
  const project = path.join(root, 'Inventory.sss'); createNewProject(project, {});
  const service = createStudioService({ appPath: path.resolve('app'), projectPath: project, exportPath: path.join(project, 'export'), origin: 'studio://local' });
  t.after(() => service.close()); service.retainSavedExport(root);
  const { runs } = await (await service.request(new Request('studio://local/api/export-runs'))).json();
  assert.equal(runs[0].previews.length, 4);
  assert.equal(runs[0].screenCount, 6);
  const url = new URL(runs[0].previews[0].src, 'studio://local'); url.searchParams.set('file', files[5].path);
  const response = await service.request(new Request(url));
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
