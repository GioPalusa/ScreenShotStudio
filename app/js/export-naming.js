import { canvasForSlide } from './canvas-orientation.js';
import { orderedSlides } from './project-ops.js';
import { acceptedFormat, exportTarget, EXPORT_TARGETS } from './export-targets.js';

const slug = (value, fallback = 'image') => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback;
const pad = n => String(n).padStart(2, '0');

/** Local wall-clock time for Finder; the manifest also retains the unambiguous UTC timestamp. */
export function exportTimestamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function exportDestination(device, deviceId) {
  const target = exportTarget(device), spec = EXPORT_TARGETS[target];
  const store = spec?.store === 'google-play' ? 'google-play' : target === 'custom' || target === 'unknown' ? 'custom' : 'app-store';
  const format = store === 'app-store' ? acceptedFormat(device)?.label : null;
  const section = [spec?.label ?? 'Unspecified canvas', format].filter(Boolean).join(' · ');
  return { store, target, section, sectionId: slug([target.replace(/^play-/, ''), format].filter(Boolean).join('-')),
    bucket: store === 'custom' ? `custom:${deviceId}` : `${store}:${target}:${target === 'watch' ? '' : format ?? ''}` };
}

/** Deterministic order within each store section, regardless of checkbox click order. */
export function exportPlan(project, selection = {}) {
  const wanted = (kind, id) => !selection[kind] || selection[kind].includes(id);
  const plan = [], counters = new Map();
  for (const locale of project.locales ?? []) if (wanted('locales', locale.id)) {
    for (const [deviceId, device] of Object.entries(project.devices ?? {})) if (wanted('devices', deviceId)) {
      const destination = exportDestination(device, deviceId);
      for (const slide of orderedSlides(project, locale.id)) if (wanted('slides', slide.id)) {
        const output = canvasForSlide(project, slide, deviceId);
        const index = project.slides.findIndex(s => s.id === slide.id);
        const key = `${locale.id}:${destination.bucket}`, position = (counters.get(key) ?? 0) + 1;
        counters.set(key, position);
        const filename = `${output.size.join('x')}__${destination.store}__${destination.sectionId}__${locale.id}__${pad(position)}__${slug(slide.name, slide.id)}.png`;
        plan.push({ requestPath: `${locale.id}/${deviceId}/${pad(index + 1)}-${slide.id}.png`,
          path: `${locale.id}/${deviceId}/${filename}`, filename, locale: locale.id, device: deviceId,
          canvas: device.label ?? deviceId, size: [...output.size], slideId: slide.id, slide: slide.name ?? slide.id,
          sourcePosition: index + 1, position, ...destination });
      }
    }
  }
  return plan;
}
