// Portable, inert Figma exchange. No credentials, remote URLs or executable content.
export const FIGMA_FORMAT = 'screenshot-studio-figma';
export function parseFigmaImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('The Figma export is not valid JSON.'); }
  if (data?.format !== FIGMA_FORMAT || data.version !== 1 || !Array.isArray(data.frames) || !data.frames.length || data.frames.length > 100) throw new Error('Choose a Screenshot Studio Figma export (version 1, up to 100 views).');
  let count = 0, bytes = 0;
  const dimension = n => Number.isInteger(n) && n >= 100 && n <= 12000;
  return data.frames.map((frame, i) => {
    if (!frame || !dimension(frame.width) || !dimension(frame.height) || frame.width * frame.height > 40000000 || typeof frame.name !== 'string' || frame.name.length > 500 || !Array.isArray(frame.layers) || !frame.layers.length) throw new Error('A Figma view has invalid dimensions, name or layers.');
    const layers = frame.layers.map((layer, j) => {
      if (++count > 300) throw new Error('Import up to 300 Figma layers at a time.');
      if (!layer || typeof layer.name !== 'string' || layer.name.length > 500 || typeof layer.png !== 'string' || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(layer.png) || layer.png.length % 4) throw new Error('A Figma layer is not a valid embedded PNG.');
      bytes += layer.png.length * .75;
      if (bytes > 128 * 1024 * 1024 || layer.png.length > 32 * 1024 * 1024 * 4 / 3) throw new Error('The Figma export exceeds the image import limits.');
      return { path: `figma-${i + 1}/layer-${j + 1}.png`, name: layer.name, png: layer.png };
    });
    return { path: `figma-${i + 1}/view.png`, name: frame.name, width: frame.width, height: frame.height, layers,
      flattened: frame.flattened === true };
  });
}
