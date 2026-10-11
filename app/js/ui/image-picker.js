import { openMediaLibrary } from './media-library.js';

export const openImagePicker = ({ title = 'Choose an image' } = {}) => openMediaLibrary({ kind: 'images', pick: 'images', title });
