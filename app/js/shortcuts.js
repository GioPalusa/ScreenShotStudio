export function isTextEditing(element) {
  if (!element) return false;
  if (element.isContentEditable || ['TEXTAREA', 'SELECT'].includes(element.tagName)) return true;
  return element.tagName === 'INPUT' && !/^(range|checkbox|radio|color|button|submit|file)$/.test(element.type);
}

export const SHORTCUTS = [
  ['Project', [['⌘N', 'New project'], ['⌘O', 'Open project'], ['⌘S', 'Save now'], ['⇧⌘S', 'Save as .sss'], ['⌘E', 'Export'], ['⇧⌘M', 'Media library'], ['?', 'Show shortcuts']]],
  ['Create', [['T', 'Text layer'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['D', 'Device'], ['I', 'Image from media']]],
  ['Layers', [['↵ / F2', 'Rename selected layer'], ['Arrows', 'Move 1 px'], ['⇧ Arrows', 'Move 10 px'], ['⌘C / ⌘V', 'Copy / paste selected objects'], ['⌘D', 'Duplicate'], ['Delete', 'Delete'], ['⌥↓ / ⌥↑', 'Send backward / bring forward'], ['⇧⌥↓ / ⇧⌥↑', 'Send to back / bring to front'], ['⌘G / ⇧⌘G', 'Group / ungroup'], ['⇧⌘L', 'Lock / unlock'], ['⇧⌘H', 'Hide / show'], ['⌘A', 'Select all unlocked layers'], ['Esc', 'Deselect / cancel drag']]],
  ['Navigate', [['[ / ]', 'Previous / next language'], ['1–9', 'Choose canvas'], ['↑ / ↓', 'Previous / next slide, with no layer selected'], ['Pinch', 'Zoom around the pointer'], ['Two-finger scroll', 'Pan the canvas'], ['0', 'Fit canvas'], ['− / +', 'Zoom out / in'], ['⌘Z / ⇧⌘Z', 'Undo / redo']]],
];

export function creationShortcut(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return null;
  return ({ t: 'text', r: 'rect', o: 'ellipse', d: 'device', i: 'image' })[event.key.toLowerCase()] ?? null;
}
