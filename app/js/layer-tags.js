/** An explicit empty tag suppresses the legacy decoration label without changing layer behaviour. */
export const layerTag = layer => typeof layer.tag === 'string' ? layer.tag : layer._origin === 'panorama' || layer.panoramaLayer ? 'decoration' : '';
export const normalizeTag = value => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
