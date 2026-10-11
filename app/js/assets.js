// Browser-side helpers for image files: choosing them, reading their size, measuring frame bezels.

import { measureFrameData } from './measure.js';

/** Open the system file dialog and resolve with the chosen files ([] when the dialog is cancelled). */
export function pickFiles({ accept = 'image/*', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    input.click();
  });
}

/** Natural size of an image file: { width, height }. SVGs are read from their viewBox / width / height. */
export async function readImageInfo(file) {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name ?? '')) {
    const text = await file.text();
    const num = (v) => (v ? parseFloat(v) : NaN);
    const width = num(/<svg[^>]*\swidth="([\d.]+)(?:px)?"/i.exec(text)?.[1]);
    const height = num(/<svg[^>]*\sheight="([\d.]+)(?:px)?"/i.exec(text)?.[1]);
    if (width > 0 && height > 0) return { width, height };
    const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i.exec(text);
    if (vb) return { width: parseFloat(vb[1]), height: parseFloat(vb[2]) };
    return { width: 1024, height: 1024 };
  }
  const bitmap = await createImageBitmap(file);
  const info = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return info;
}

/** Decode an image file to a canvas at its natural size. */
export async function fileToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

/** Find the screen in a bezel image file. Returns { canvas, meta } (meta as in project/assets/frames/*.json). */
export async function measureFrameFile(file) {
  const canvas = await fileToCanvas(file);
  const meta = measureFrameData(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height));
  return { canvas, meta };
}

export const canvasToPNG = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

/** Files dropped or pasted that are images. */
export const imageFilesOf = (list) => [...(list ?? [])].filter((f) => f.type?.startsWith('image/'));

/** Natural size of an image that is already on the server (e.g. in the project library). */
export async function imageInfoFromUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  const type = res.headers.get('content-type') ?? blob.type;
  return readImageInfo(new File([blob], url.split('?')[0].split('/').pop(), { type }));
}
