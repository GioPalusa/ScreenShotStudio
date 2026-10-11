const HELP = {
  New: 'Create a slide and choose its layout.', Duplicate: 'Copy the selected slide, including its text in every language.',
  Remove: 'Remove this slide after confirmation. The change can be undone.',
  Details: 'Edit the selected device, text, image or shape.',
  Layers: 'Select, rename, arrange and style individual layers.', Design: 'Load or save a screen design and change its colours.',
  Editor: 'Edit the current slide on the canvas.', Languages: 'Write and review translations for all slides.',
  Overview: 'Compare the complete screenshot set.', Setup: 'Manage canvases, devices, frames and saved designs.',
  Canvas: 'Choose a canvas, or add an Apple or Android device.', Language: 'Choose the language to preview and edit.',
  'All changes saved': 'Your edits are saved automatically. Click to retry pending saves.',
};

/** Supply hover help for labelled controls; specific descriptions always win. */
export function installTooltips(root) {
  const describe = e => {
    const control = e.target.closest?.('button,input,select,textarea,a');
    if (!control || control.title) return;
    const field = control.closest('.field'), row = control.closest('label,.shadow-row,.geom');
    const label = control.getAttribute('aria-label') ?? (control.tagName === 'BUTTON' || control.tagName === 'A' ? control.textContent.trim() : row?.querySelector('span')?.textContent ?? field?.querySelector('label')?.textContent ?? control.placeholder);
    if (!label) return;
    const inheritedHelp = control.closest('[title]')?.title;
    if (inheritedHelp) { control.title = inheritedHelp; return; }
    const hint = field?.querySelector('.hint')?.textContent;
    control.title = HELP[label] ?? (hint ? `${label}. ${hint}` : label);
  };
  root.addEventListener('mouseover', describe);
  root.addEventListener('focusin', describe);
}
