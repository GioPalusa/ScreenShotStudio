// App Asset Library API. Secrets and signed upload URLs never leave the host.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, assertInside } from './files.mjs';
import { uploadChecks } from '../app/js/upload-checks.js';
import { uploadImageKey, uploadScreenGroups } from '../app/js/upload-selection.js';

const API = 'https://api.appstoreconnect.apple.com';
const editableStates = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED']);
export const editableVersion = version => editableStates.has(version?.attributes?.appStoreState);
const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(value)) throw new Error('Invalid App Store Connect resource.');
  return encodeURIComponent(value);
};
const relation = (type, resourceId) => ({ data: { type, id: resourceId } });
const resource = (type, attributes, relationships, resourceId) => ({ data: { type, ...(resourceId ? { id: resourceId } : {}), attributes, ...(relationships ? { relationships } : {}) } });
export function validateCredentials(value) {
  if (!/^[A-Z0-9]{10}$/.test(value?.keyId ?? '') || (value.issuerId && !/^[a-f0-9-]{36}$/i.test(value.issuerId))) throw new Error('Enter a valid Key ID and Issuer ID (leave Issuer ID empty for an individual key).');
  try {
    const key = crypto.createPrivateKey(value.privateKey);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
  } catch { throw new Error('Choose a valid App Store Connect .p8 private key.'); }
  return { keyId: value.keyId, issuerId: value.issuerId || '', privateKey: value.privateKey };
}
export function tokenFor(value, now = Math.floor(Date.now() / 1000)) {
  const credentials = validateCredentials(value);
  const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const input = `${encode({ alg: 'ES256', kid: credentials.keyId, typ: 'JWT' })}.${encode({ ...(credentials.issuerId ? { iss: credentials.issuerId } : { sub: 'user' }), iat: now - 10, exp: now + 300, aud: 'appstoreconnect-v1' })}`;
  return `${input}.${crypto.sign('sha256', Buffer.from(input), { key: credentials.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
const apiURL = input => {
  const url = new URL(input, API);
  if (url.origin !== API || !url.pathname.startsWith('/v1/')) throw new Error('Invalid App Store Connect URL.');
  return url;
};
export class AppStoreClient {
  constructor(credentials, { fetchImpl = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.credentials = validateCredentials(credentials); this.fetch = fetchImpl; this.sleep = sleep;
  }
  async request(url, { method = 'GET', body, signal } = {}) {
    signal?.throwIfAborted();
    url = apiURL(url);
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.fetch(url, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${tokenFor(this.credentials)}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      } catch { throw new Error(signal?.aborted ? 'Upload stopped.' : 'Could not reach App Store Connect. Check your connection. If a write was interrupted, review App Store Connect before trying again.'); }
      if (response.status === 204) return {};
      const json = await response.json().catch(() => ({}));
      if (response.ok) return json;
      // Writes are never blindly retried: Apple may have accepted a timed-out request.
      if (method === 'GET' && [429, 500, 502, 503, 504].includes(response.status) && attempt < 2) { await this.sleep(1000 * (attempt + 1)); continue; }
      const detail = (json.errors ?? []).map(e => e.detail || e.title).filter(Boolean).join(' ').slice(0, 1000);
      throw new Error(`App Store Connect (${response.status}): ${detail || (response.status === 401 ? 'Check your API key and Mac clock.' : response.status === 403 ? 'Your API key needs access to this app and permission to manage screenshots.' : 'The request failed.')}`);
    }
  }
  async list(url, options) {
    const result = [], seen = new Set();
    while (url) {
      const key = String(apiURL(url));
      if (seen.has(key) || seen.size >= 100) throw new Error('App Store Connect returned an invalid page list.');
      seen.add(key); const page = await this.request(url, options);
      if (!Array.isArray(page.data)) throw new Error('App Store Connect returned an unexpected response.');
      result.push(...page.data); url = page.links?.next;
    }
    return result;
  }
  apps() { return this.list('/v1/apps?limit=200'); }
  versions(appId, options) { return this.list(`/v1/apps/${id(appId)}/appStoreVersions?limit=200`, options); }
  localizations(versionId, options) { return this.list(`/v1/appStoreVersions/${id(versionId)}/appStoreVersionLocalizations?limit=200`, options); }
  placements(localizationId, options) { return this.list(`/v1/appStoreVersionLocalizations/${id(localizationId)}/placements?filter[placementType]=APP_SCREENSHOT&sort=placementGroupPosition&limit=200`, options); }
  async uploadImage(libraryId, file, group, signal, progress) {
    const bytes = readExportImage(file.root, file);
    // Names are unique across the app's entire asset library, including unplaced
    // images from an earlier attempt. Keep the UUID outside the truncated label.
    const referenceName = `${`Screenshot Studio · ${file.locale} · ${file.device} · ${file.slide}`.slice(0, 160)} · ${crypto.randomUUID()}`;
    const reservation = (await this.request('/v1/appAssetLibraryImages', { method: 'POST', signal, body: resource('appAssetLibraryImages', { fileName: file.filename, fileSize: bytes.length, category: 'APP_SCREENSHOTS_AND_PREVIEWS', referenceName }, { assetLibrary: relation('appAssetLibraries', libraryId) }) })).data;
    if (!reservation?.id) throw new Error('Apple did not return an image reservation.');
    progress({ imageId: reservation.id, state: 'Uploading' });
    const operations = reservation.attributes?.uploadOperations;
    if (!Array.isArray(operations) || !operations.length) throw new Error('Apple did not return upload operations.');
    let end = 0;
    for (const op of [...operations].sort((a, b) => a.offset - b.offset)) {
      const url = new URL(op.url);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.apple.com') || url.username || url.password || op.method !== 'PUT' || op.offset !== end || !Number.isSafeInteger(op.length) || op.length <= 0 || op.offset + op.length > bytes.length) throw new Error('Apple returned invalid upload operations.');
      const headers = Object.fromEntries((op.requestHeaders ?? []).map(h => [h.name, h.value]));
      if (Object.keys(headers).some(h => /^(authorization|cookie|proxy-authorization)$/i.test(h))) throw new Error('Apple returned unexpected upload headers.');
      let response;
      try { response = await this.fetch(url, { method: 'PUT', redirect: 'error', headers, body: bytes.subarray(op.offset, op.offset + op.length), signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) }); }
      catch { throw new Error(signal.aborted ? 'Upload stopped.' : 'Image transfer failed. Review the upload report before trying again.'); }
      if (!response.ok) throw new Error(`Image transfer failed (${response.status}).`);
      end += op.length;
    }
    if (end !== bytes.length) throw new Error('Apple upload operations did not cover the entire image.');
    const committed = (await this.request(`/v1/appAssetLibraryImages/${id(reservation.id)}`, { method: 'PATCH', signal, body: resource('appAssetLibraryImages', { uploaded: true }, null, reservation.id) })).data;
    if (committed?.attributes?.state === 'FAILED') throw new Error('Apple rejected this image. Check its status in App Store Connect.');
    if (committed?.attributes?.specId && !group.specIds.includes(committed.attributes.specId)) throw new Error('Apple accepted this image for a different screen specification.');
    progress({ state: 'Uploaded', appleState: committed?.attributes?.state ?? 'UPLOAD_COMPLETE' });
    return reservation.id;
  }
}

// Read a completed, frozen export. Verify the exact bytes again before uploading.
export function readExportImage(root, file) {
  if (typeof file.path !== 'string' || path.isAbsolute(file.path)) throw new Error('Invalid export image path.');
  const resolved = fs.realpathSync(path.join(root, file.path)); assertInside(fs.realpathSync(root), resolved);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length !== file.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Export image changed: ${file.filename}. Export it again.`);
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes[24] !== 8 || bytes[25] !== 2 || bytes.readUInt32BE(16) !== file.size[0] || bytes.readUInt32BE(20) !== file.size[1]) throw new Error(`Invalid RGB screenshot: ${file.filename}.`);
  return bytes;
}
export function inspectUploadExport(root) {
  const manifestPath = fs.realpathSync(path.join(root, 'manifest.json')); assertInside(fs.realpathSync(root), manifestPath);
  const bytes = fs.readFileSync(manifestPath), manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.format !== 2 || !['draft', 'final'].includes(manifest.mode) || !manifest.completed || !Array.isArray(manifest.files) || !manifest.files.length || !Array.isArray(manifest.report?.issues) || !Array.isArray(manifest.report?.skipped) || !Array.isArray(manifest.report?.warnings)) throw new Error('Choose a completed Screenshot Studio export folder containing manifest.json and its images.');
  const checks = uploadChecks(manifest.report);
  const files = manifest.files.filter(f => f.store === 'app-store').map(file => ({ ...file, root }));
  if (!files.length) checks.errors.push({ level: 'error', message: 'This export contains no App Store screenshots.' });
  const paths = new Set();
  for (const file of files) {
    try {
      if (!Array.isArray(file.size) || file.size.length !== 2 || !file.size.every(n => Number.isSafeInteger(n) && n > 0) || !Number.isSafeInteger(file.position) || file.position < 1 || !['locale', 'device', 'filename'].every(k => typeof file[k] === 'string' && file[k]) || paths.has(file.path)) throw new Error('Invalid or duplicate screenshot metadata in the export. Export the images again.');
      paths.add(file.path); readExportImage(root, file);
    } catch (error) { checks.errors.push({ level: 'error', message: error.message }); }
  }
  return { ...checks, files, completed: manifest.completed, manifestHash: crypto.createHash('sha256').update(bytes).digest('hex') };
}
export function loadUploadExport(root) {
  const result = inspectUploadExport(root);
  if (result.errors.length) throw new Error(result.errors.map(e => e.message).join('\n'));
  return result.files;
}
export function screenshotGroups(catalog, platform) {
  // App versions and asset profiles use separate platform enums. Watch screenshots
  // belong to the iOS listing; iMessage uses a different placement type.
  const profilePlatforms = {
    IOS: ['IPHONE_APP_STORE', 'IPAD_APP_STORE', 'WATCH_APP_STORE'],
    MAC_OS: ['MAC_APP_STORE'],
    TV_OS: ['TV_APP_STORE'],
    VISION_OS: ['VISION_PRO_APP_STORE'],
  }[platform];
  if (!profilePlatforms) throw new Error(`Screenshot upload does not support the app version's platform (${platform ?? 'unknown'}).`);
  const type = catalog.placementTypes?.find(t => t.placementTypeId === 'APP_SCREENSHOT');
  const policy = catalog.features?.find(f => f.featureId === 'APP_STORE_VERSIONS')?.placementPolicies?.find(p => p.placementType === 'APP_SCREENSHOT');
  if (!type?.acceptsAssetCategories?.includes('APP_SCREENSHOTS_AND_PREVIEWS') || !policy) throw new Error('Apple has not enabled screenshot placements for this app.');
  return (type.specMappings ?? []).flatMap(mapping => {
    const profile = catalog.placementProfileGroups?.find(p => p.placementProfileGroupId === mapping.placementGroupId);
    const limit = policy.groupLimits?.find(l => l.groupIds?.includes(mapping.placementGroupId))?.maxCount;
    if (!profilePlatforms.includes(profile?.platform) || !Number.isSafeInteger(limit) || limit <= 0) return [];
    const specs = (catalog.imageSpecs ?? []).filter(s => mapping.specs?.includes(s.specId) && s.mimeTypes?.includes('image/png') && s.fileExtensions?.includes('.png'));
    return [{ id: mapping.placementGroupId, label: mapping.placementGroupId === 'IPHONE_DUO_PROFILE' ? 'iPhone Duo' : mapping.placementGroupId.replace(/_/g, ' ').toLowerCase(), maxCount: limit, specs }];
  });
}
export function matchScreenshot(file, groups) {
  return groups.flatMap(group => {
    const specs = group.specs.filter(s => s.dimensions?.minWidth === file.size[0] && s.dimensions?.maxWidth === file.size[0] && s.dimensions?.minHeight === file.size[1] && s.dimensions?.maxHeight === file.size[1] && file.bytes <= s.maxFileSize);
    return specs.length ? [{ id: group.id, label: group.label, maxCount: group.maxCount, specIds: specs.map(s => s.specId) }] : [];
  });
}

export class AppStoreUploads {
  constructor({ client, reportDirectory }) { this.client = client; this.reportDirectory = reportDirectory; this.plans = new Map(); this.jobs = new Map(); }
  async prepare({ root, appId, versionId, mappings = {}, replace = false, excludedImages = [] }) {
    const inspected = inspectUploadExport(root), { files, warnings, manifestHash } = inspected;
    if (inspected.errors.length) throw new Error(inspected.errors.map(e => e.message).join('\n'));
    const available = new Set(files.map(uploadImageKey));
    if (!Array.isArray(excludedImages) || excludedImages.some(key => !available.has(key))) throw new Error('Invalid screenshot selection. Review the export again.');
    const excluded = new Set(excludedImages);
    const [versions, locales, reference, library] = await Promise.all([
      this.client.versions(appId), this.client.localizations(versionId), this.client.request('/v1/appAssetLibraryRefData'), this.client.request(`/v1/apps/${id(appId)}/assetLibrary`),
    ]);
    const version = versions.find(v => v.id === versionId);
    if (!editableVersion(version)) throw new Error('Choose an editable app version.');
    if (!library.data?.id) throw new Error('Apple did not return an asset library.');
    const groups = screenshotGroups(reference.data?.[0]?.attributes ?? {}, version.attributes.platform);
    if (!groups.some(g => g.specs.length)) throw new Error('Could not find screenshot specifications for this app version in Apple\'s catalog. Try reviewing again.');
    const remote = new Map();
    for (const locale of new Set(files.map(f => f.locale))) {
      const localization = locales.find(l => l.attributes?.locale === locale);
      if (!localization) throw new Error(`Add ${locale} to this app version in App Store Connect first.`);
      remote.set(locale, { id: localization.id, placements: await this.client.placements(localization.id) });
    }
    const errors = [], batches = new Map();
    const candidates = files.map(file => {
      const choices = matchScreenshot(file, groups), chosen = mappings[file.device] || (choices.length === 1 ? choices[0].id : '');
      const group = choices.find(g => g.id === chosen);
      const selected = !excluded.has(uploadImageKey(file));
      if (selected && !group) errors.push(`${file.canvas}: ${choices.length ? 'choose an Apple screen group' : `Apple does not accept ${file.size.join(' × ')} px for this platform`}.`);
      const entry = { ...file, choices, group, groupId: group?.id, selected, localizationId: remote.get(file.locale).id };
      if (selected && group) {
        const key = `${file.locale}:${group.id}`;
        if (!batches.has(key)) batches.set(key, { locale: file.locale, localizationId: entry.localizationId, group, entries: [], existing: remote.get(file.locale).placements.filter(p => p.attributes?.placementGroup === group.id) });
        batches.get(key).entries.push(entry);
      }
      return entry;
    });
    const keptGroups = [], uploadBatches = [];
    for (const batch of batches.values()) {
      // Order by the frozen export's per-store positions, with stable ordering between canvases.
      batch.entries.sort((a, b) => a.position - b.position);
      if (!replace && batch.existing.length) {
        keptGroups.push({ locale: batch.locale, label: batch.group.label, existing: batch.existing.length, skipped: batch.entries.length });
        continue;
      }
      if (batch.entries.length > batch.group.maxCount) errors.push(`${batch.locale} · ${batch.group.label}: ${batch.entries.length} selected exceeds Apple's limit of ${batch.group.maxCount}. Choose fewer screenshots for this screen group; the selection applies to every language.`);
      uploadBatches.push(batch);
    }
    const entries = uploadBatches.flatMap(b => b.entries);
    if (!entries.length) errors.push(keptGroups.length ? 'All selected language and screen groups already have screenshots. Choose replacement to upload these images again.' : 'Choose at least one screenshot to upload.');
    const planId = crypto.randomUUID();
    const plan = { planId, appId, versionId, root, manifestHash, warnings, libraryId: library.data.id, replace: Boolean(replace), batches: uploadBatches, entries, keptGroups, created: Date.now(), errors: [...new Set(errors)] };
    this.plans.clear(); this.plans.set(planId, plan);
    const publicEntry = ({ root: _root, group: _group, ...entry }) => entry;
    return { planId, errors: plan.errors, warnings, replace: plan.replace, entries: entries.map(publicEntry), screens: uploadScreenGroups(candidates.map(publicEntry)), keptGroups, locales: [...remote.keys()], groups: plan.batches.map(b => ({ locale: b.locale, label: b.group.label, incoming: b.entries.length, existing: b.existing.length })) };
  }
  start(planId, { acknowledgeWarnings = false } = {}) {
    if ([...this.jobs.values()].some(j => j.state === 'running')) throw new Error('An upload is already running.');
    const plan = this.plans.get(planId);
    if (!plan || Date.now() - plan.created > 15 * 60 * 1000 || plan.errors.length) throw new Error('Review the screenshots again before uploading.');
    if (plan.warnings.length && acknowledgeWarnings !== true) throw new Error('Review the warnings and choose to upload anyway.');
    const inspected = inspectUploadExport(plan.root);
    if (inspected.manifestHash !== plan.manifestHash || inspected.errors.length) throw new Error('The export changed or has technical errors. Review it again before uploading.');
    this.plans.delete(planId);
    const job = { id: crypto.randomUUID(), state: 'running', message: 'Checking App Store Connect…', total: plan.entries.length, uploaded: 0, files: [], appId: plan.appId, versionId: plan.versionId, replace: plan.replace, keptGroups: plan.keptGroups, locales: [...new Set([...plan.entries.map(e => e.locale), ...plan.keptGroups.map(g => g.locale)])], warnings: plan.warnings, warningsAcknowledged: plan.warnings.length > 0 && acknowledgeWarnings === true, started: new Date().toISOString(), controller: new AbortController() };
    this.jobs.set(job.id, job); this.run(job, plan).catch(error => {
      job.state = job.controller.signal.aborted ? 'stopped' : 'failed'; job.message = job.controller.signal.aborted ? 'Upload stopped. Completed changes remain in App Store Connect.' : error.message;
      try { this.saveReport(job); } catch { job.message += ' The report could not be saved; keep the details shown here.'; }
    });
    return { id: job.id };
  }
  status(jobId) {
    const job = this.jobs.get(jobId); if (!job) throw new Error('Upload not found.');
    const { controller, ...status } = job; return structuredClone(status);
  }
  stop(jobId) { this.jobs.get(jobId)?.controller.abort(); }
  saveReport(job) {
    const { controller, ...report } = job;
    atomicWrite(path.join(this.reportDirectory, `${job.id}.json`), JSON.stringify(report, null, 2));
  }
  async checkRemote(plan, signal) {
    const version = (await this.client.versions(plan.appId, { signal })).find(v => v.id === plan.versionId);
    if (!editableVersion(version)) throw new Error('This app version is no longer editable.');
    for (const batch of plan.batches) {
      const placements = (await this.client.placements(batch.localizationId, { signal })).filter(p => p.attributes?.placementGroup === batch.group.id);
      if (JSON.stringify(placements.map(p => p.id)) !== JSON.stringify(batch.existing.map(p => p.id))) throw new Error('Screenshots changed in App Store Connect. Review them again.');
    }
  }
  async run(job, plan) {
    const signal = job.controller.signal;
    signal.throwIfAborted();
    this.saveReport(job); // Fail before remote writes if the durable report cannot be written.
    await this.checkRemote(plan, signal);
    // Transfer the remaining files while Apple processes previously committed ones.
    // Every transfer must be committed before existing placements change. Apple
    // supports ASSET_PROCESSING placements, so processing never blocks completion.
    for (const batch of plan.batches) for (const file of batch.entries) {
      signal.throwIfAborted();
      job.message = `Uploading ${job.files.length + 1} / ${plan.entries.length} · ${file.locale} · ${file.slide}`;
      const record = { filename: file.filename, locale: file.locale, group: batch.group.id, state: 'Preparing' };
      job.files.push(record); this.saveReport(job);
      record.imageId = await this.client.uploadImage(plan.libraryId, file, batch.group, signal, update => { Object.assign(record, update); this.saveReport(job); });
      job.uploaded++; this.saveReport(job);
    }
    await this.checkRemote(plan, signal);
    let index = 0;
    for (const batch of plan.batches) {
      const ordered = plan.replace ? [] : batch.existing.map(p => p.id);
      if (plan.replace) for (const placement of batch.existing) {
        signal.throwIfAborted();
        await this.client.request(`/v1/appAssetLibraryPlacements/${id(placement.id)}`, { method: 'DELETE', signal });
        job.removed ??= []; job.removed.push(placement.id); this.saveReport(job);
      }
      for (const file of batch.entries) {
        signal.throwIfAborted(); const record = job.files[index++];
        job.message = `Placing ${file.locale} · ${file.slide}`;
        const placement = (await this.client.request('/v1/appAssetLibraryPlacements', { method: 'POST', signal, body: resource('appAssetLibraryPlacements', { placementType: 'APP_SCREENSHOT', placementGroup: batch.group.id }, { image: relation('appAssetLibraryImages', record.imageId), appStoreVersionLocalization: relation('appStoreVersionLocalizations', batch.localizationId) }) })).data;
        if (!placement?.id) throw new Error('Apple did not return a screenshot placement.');
        record.placementId = placement.id; record.state = 'Placed'; ordered.push(placement.id); this.saveReport(job);
      }
      await this.client.request('/v1/appAssetLibraryPlacementOrderingRequests', { method: 'POST', signal, body: resource('appAssetLibraryPlacementOrderingRequests', { placementGroup: batch.group.id }, { orderedPlacements: { data: ordered.map(placementId => ({ type: 'appAssetLibraryPlacements', id: placementId })) }, appStoreVersionLocalization: relation('appStoreVersionLocalizations', batch.localizationId) }) });
      const verified = (await this.client.placements(batch.localizationId, { signal })).filter(p => p.attributes?.placementGroup === batch.group.id);
      if (JSON.stringify(verified.map(p => p.id)) !== JSON.stringify(ordered)) throw new Error('Could not verify screenshot order in App Store Connect. Review the upload report.');
      for (const record of job.files.filter(f => f.locale === batch.locale && f.group === batch.group.id)) {
        record.state = 'Uploaded'; record.placementVerified = true;
        record.applePlacementState = verified.find(p => p.id === record.placementId)?.attributes?.state;
      }
      this.saveReport(job);
    }
    job.state = 'complete'; job.message = `${job.files.length} screenshots uploaded to App Store Connect. Check processing there.`; job.completed = new Date().toISOString(); this.saveReport(job);
  }
}
