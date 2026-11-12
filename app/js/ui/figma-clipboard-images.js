import { h, modal } from './helpers.js';
import { skipClipboardImages } from '../figma-clipboard.js';

export async function clipboardImageFile(file) {
  if (file.size > 32 * 1024 * 1024) throw Error('Choose an image smaller than 32 MB.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('Choose a PNG, JPEG or WebP image.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw Error('This image could not be read. Choose another file.'); }
  try {
    if (bitmap.width > 16384 || bitmap.height > 16384 || bitmap.width * bitmap.height > 40000000) throw Error('Choose an image with at most 40 megapixels and 16384 px per side.');
  } finally { bitmap.close(); }
  return file;
}
async function encode(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { mime: file.type, data: btoa(binary) };
}

/** Ask only for missing media, before any destination edits or asset uploads. */
export async function resolveClipboardImages(data, active = () => true) {
  const missing = data.missingImages ?? [];
  if (!missing.length) return data;
  const decision = await new Promise(resolve => {
    const files = new Map(), skipped = new Set(), rows = h('div', { class: 'paste-missing-images' });
    let loading = 0, closed = false;
    const finish = () => {
      if (!active() || loading) return;
      resolve({ files, skipped }); dialog.close();
    };
    const proceed = h('button', { class: 'btn primary', disabled: true, onClick: finish }, 'Continue paste');
    const skipAll = h('button', { class: 'btn', onClick: () => {
      for (const image of missing) if (!files.has(image.ref)) skipped.add(image.ref);
      finish();
    } }, 'Skip missing images');
    const update = () => {
      proceed.disabled = Boolean(loading) || missing.some(image => !files.has(image.ref) && !skipped.has(image.ref));
      skipAll.disabled = Boolean(loading);
    };
    for (const image of missing) {
      const label = image.names.join(', '), status = h('p', { class: 'hint', role: 'status' });
      const skip = h('input', { type: 'checkbox', 'aria-label': `Skip image ${label}`, onChange: () => {
        if (skip.checked) skipped.add(image.ref); else skipped.delete(image.ref);
        update();
      } });
      const picker = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': `Attach image ${label}`, onChange: async () => {
        const file = picker.files[0]; if (!file) return;
        loading++; picker.disabled = true; status.textContent = 'Checking image…'; update();
        try {
          await clipboardImageFile(file);
          if (closed || !active()) return;
          files.set(image.ref, file); skipped.delete(image.ref); skip.checked = false; status.textContent = file.name;
        } catch (error) { if (!closed) status.textContent = error.message; }
        finally { loading--; picker.disabled = false; picker.value = ''; update(); }
      } });
      rows.append(h('section', { class: 'paste-missing-image' }, h('strong', null, label),
        h('p', { class: 'hint' }, image.reason === 'unsupported-format' ? 'This copied image needs a PNG, JPEG or WebP replacement.' : 'Figma did not include this image in the copied selection.'),
        h('label', { class: 'field' }, 'Attach image', picker), h('label', { class: 'row check' }, skip, 'Skip this image'), status));
    }
    const dialog = modal({ title: 'Missing images', body: h('div', null,
      h('p', null, 'Add the image files, or skip them and paste the rest of the design.'), rows),
      actions: [h('button', { class: 'btn', onClick: () => dialog.close() }, 'Cancel'), skipAll, proceed],
      onClose: () => { closed = true; resolve(null); } });
  });
  if (!decision || !active()) return null;
  const images = { ...data.images };
  for (const [ref, file] of decision.files) if (!decision.skipped.has(ref)) images[ref] = await encode(file);
  if (!active()) return null;
  return { ...data, images, designs: data.designs.map(design => skipClipboardImages(design, decision.skipped)), missingImages: [], skippedImages: [...decision.skipped] };
}

export async function clipboardImageFiles(images) {
  const files = {};
  for (const [ref, image] of Object.entries(images ?? {})) {
    const bytes = Uint8Array.from(atob(image.data), c => c.charCodeAt(0));
    files[ref] = await clipboardImageFile(new File([bytes], `figma-image.${image.mime === 'image/jpeg' ? 'jpg' : image.mime === 'image/webp' ? 'webp' : 'png'}`, { type: image.mime }));
  }
  return files;
}
