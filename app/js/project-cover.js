import { Engine } from './render.js';
import { originalLocale } from './copy-review.js';
import { orderedSlides, slideSupportsCanvas } from './slide-order.js';

/** Small, read-only covers made by the same renderer as the editor and export. */
export async function projectCover(bundle, projectURL, { active = () => true } = {}) {
  const renderer = new Engine(); renderer.setData(bundle); renderer.projectURL = projectURL;
  try {
    const project = renderer.project, locale = originalLocale(project);
    const independent = (slide, device) => Boolean(slide.localeLayouts?.[locale]?.[device]?.independent);
    const score = device => project.slides.reduce((sum, slide) => sum + Number(independent(slide,device)) * 1000 + Number(Boolean(slide.layouts?.[device]?.layers?.length)) * 10 + Number(slideSupportsCanvas(project,slide,device)), 0);
    const devices = Object.keys(project.devices).sort((a,b) => score(b) - score(a));
    const device = devices[0], slides = orderedSlides(project, locale, device).sort((a,b) => Number(independent(b,device)) - Number(independent(a,device))).slice(0, 6), images = []; let first;
    for (const slide of slides) {
      if (!active()) return null;
      const scene = renderer.scene(slide.id, device, locale);
      if (scene.layers.length > 2000) continue;
      const canvas = document.createElement('canvas');
      await renderer.render(canvas, scene, { scale: Math.min(1, 540 / scene.H, 860 / scene.W) });
      if (!active()) return null;
      first ??= canvas;
      const originalArt = scene.layers.some(l => l.type === 'shape' && l.shape === 'path' || l.type === 'art' && scene.assets.art[l.id] || l.type === 'device' && scene.assets.captures[l.id]?.image);
      const missingCapture = scene.layers.some(l => l.type === 'device' && scene.assets.captures[l.id]?.missing);
      const content = originalArt || !missingCapture && scene.layers.some(l => l.type === 'text' && l._layout);
      if (content) images.push(canvas);
      if (images.length === 3) break;
    }
    if (!first) throw Error('No preview available');
    const empty = !images.length;
    if (empty) images.push(first);
    const cover = document.createElement('canvas'); cover.width = 960; cover.height = 600;
    const ctx = cover.getContext('2d');
    // Extend the artwork's own background around the miniature screens.
    const pixel = images[0].getContext('2d').getImageData(0,0,1,1).data;
    ctx.fillStyle = `rgb(${pixel[0]} ${pixel[1]} ${pixel[2]})`; ctx.fillRect(0,0,960,600);
    const gap = 24, height = Math.min(516, (880 - gap * (images.length - 1)) / images.reduce((sum, image) => sum + image.width / image.height, 0));
    const width = images.reduce((sum, image) => sum + height * image.width / image.height, 0) + gap * (images.length - 1);
    let x = (960 - width) / 2;
    for (const image of images) {
      const w = height * image.width / image.height, y = (600 - height) / 2;
      ctx.save(); ctx.shadowColor = '#00000026'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
      ctx.drawImage(image, x, y, w, height); ctx.restore();
      ctx.strokeStyle = '#ffffff33'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, height); x += w + gap;
    }
    const blob = await new Promise(resolve => cover.toBlob(resolve, 'image/webp', .85));
    if (!blob) throw Error('No preview available');
    return { url: URL.createObjectURL(blob), empty };
  } finally { renderer.projectFonts.dispose(); }
}
