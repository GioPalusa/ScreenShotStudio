import { openNewDesignGallery } from './design-gallery.js';
export { drawCompositionPreview } from './composition-preview.js';

export function openDesignLibrary({ newSlide = false, ...options }) {
  return openNewDesignGallery({ ...options, mode: newSlide ? 'add' : 'load' });
}
