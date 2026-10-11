// A canvas chooses the dimensions; each screen chooses their orientation.
import { acceptedFormat, exportTarget } from './export-targets.js';

export const orientationOf = size => size[0] > size[1] ? 'landscape' : 'portrait';
export function orientedSize(size, orientation) {
  if (!['portrait', 'landscape'].includes(orientation) || orientationOf(size) === orientation) return [...size];
  return [size[1], size[0]];
}

/** Non-mutating canvas resolution shared by the editor, renderer and export manifest. */
export function canvasForSlide(project, slide, deviceId) {
  const device = project.devices[deviceId];
  const orientation = slide?.canvasOrientations?.[deviceId];
  if (!device || !orientation || orientationOf(device.size) === orientation) return device;
  const size = orientedSize(device.size, orientation);
  // Keep the same output/design scale, including documents with legacy design dimensions.
  const scale = device.size[0] / (device.designSize?.[0] ?? device.size[0]);
  return { ...device, size, ...(device.designSize ? { designSize: size.map(n => n / scale) } : {}) };
}

export function canvasOrientationOptions(device) {
  return ['portrait', 'landscape'].filter(orientation => {
    const candidate = { ...device, size: orientedSize(device.size, orientation) };
    return exportTarget(device) === 'custom' || Boolean(acceptedFormat(candidate));
  });
}

export function setCanvasOrientation(project, slide, deviceId, orientation) {
  const device = project.devices[deviceId];
  if (!device || !canvasOrientationOptions(device).includes(orientation)) throw new Error('This orientation is not supported by the selected canvas format.');
  if (orientationOf(canvasForSlide(project, slide, deviceId).size) === orientation) return false;
  (slide.canvasOrientations ??= {})[deviceId] = orientation;
  return true;
}
