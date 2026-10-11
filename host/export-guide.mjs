const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const storeLabel = store => ({ 'app-store': 'Apple App Store', 'google-play': 'Google Play', custom: 'Custom / marketing' })[store] ?? store;

/** A portable, offline contact sheet, using only the images in this completed export. */
export function exportGuide(manifest) {
  const groups = new Map();
  for (const file of manifest.files) {
    const key = `${file.locale}:${file.bucket}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const sections = [...groups.values()].map(files => {
    const first = files[0];
    const rows = files.sort((a, b) => a.position - b.position).map(file => {
      const url = file.path.split('/').map(encodeURIComponent).join('/');
      return `<tr><td class="position">${String(file.position).padStart(2, '0')}</td><td><a href="${url}"><img loading="lazy" src="${url}" alt="${escape(file.slide)}"></a></td><td><b>${escape(file.slide)}</b><p>${escape(file.canvas)} · ${file.size.join(' × ')} px</p><a class="filename" href="${url}">${escape(file.filename)}</a><p class="muted">Project slide ${file.sourcePosition} · ${escape(file.device)}</p></td></tr>`;
    }).join('');
    return `<section><h2>${escape(storeLabel(first.store))} / ${escape(first.section)}</h2><p>${escape(first.locale)} · ${files.length} image${files.length === 1 ? '' : 's'}</p><table><thead><tr><th>Position</th><th>Preview</th><th>Image</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join('');
  const warnings = [...(manifest.report.warnings ?? []), ...(manifest.report.skipped ?? [])];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"><title>Screenshot Studio — Upload guide</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f4f6f8;color:#172934;margin:0 auto;padding:36px;max-width:1100px}h1{margin-bottom:6px}h2{font-size:21px}p{margin:6px 0}section{background:white;border:1px solid #dce3e6;border-radius:16px;padding:24px;margin:24px 0}table{width:100%;border-collapse:collapse}th{text-align:left;color:#536371;font-size:13px}td,th{padding:14px 10px;border-bottom:1px solid #e2e8eb;vertical-align:middle}img{max-width:150px;max-height:180px;display:block;border:1px solid #dce3e6}a{color:#075b8c}.position{font-size:26px;font-weight:650;width:70px}.filename{overflow-wrap:anywhere;font:13px ui-monospace,monospace}.muted{color:#61717c;font-size:13px}.notice{background:#fff0d5;padding:16px;border-radius:10px}details li{overflow-wrap:anywhere}@media(max-width:650px){body{padding:16px}section{padding:12px}img{max-width:80px;max-height:120px}td,th{padding:8px 4px}}</style>
<h1>Upload guide</h1><p>${escape(manifest.mode.toUpperCase())} · ${escape(manifest.localStarted)} · ${escape(manifest.timeZone)}</p>
<p>Use the numbered order within each language and store section below. Positions describe this selected batch; project slide numbers are listed separately. Files are grouped into language and canvas folders.</p>
${manifest.mode === 'draft' ? '<p class="notice">Draft export — review warnings before uploading.</p>' : ''}
${warnings.length ? `<details class="notice"><summary>${warnings.length} export warnings / skipped images</summary><ul>${warnings.map(w => `<li>${escape(w)}</li>`).join('')}</ul></details>` : ''}
${sections}<p class="muted">RGB PNG · no transparency. Store content review and listing completeness must still be checked in the store console. Keep this guide beside its image folders.</p></html>`;
}
