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

// A wrapping label may contain a select with hundreds of options. Only its caption
// belongs in hover help; control values and nested help are not label text.
function caption(node) {
  if (!node) return '';
  const copy = node.cloneNode(true);
  copy.querySelectorAll('button,input,select,textarea,output,.hint,.sub,.ref').forEach(child => child.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
}

function controlLabel(control) {
  const aria = control.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  if (control.matches('button,a')) return caption(control);
  const associated = [...(control.labels ?? [])].map(caption).filter(Boolean).join(' ');
  if (associated) return associated;
  const row = control.closest('.row,.shadow-row,.geom');
  const rowLabel = row && [...row.children].find(child => child.matches('.label,span,label') && !child.contains(control));
  if (rowLabel) return caption(rowLabel);
  const field = control.closest('.field');
  const fieldLabel = field && [...field.children].find(child => child.matches('label') && (!child.control || child.control === control));
  return caption(fieldLabel) || control.placeholder;
}

/** Supply hover help for labelled controls; specific descriptions always win. */
export function installTooltips(root) {
  const describe = e => {
    const control = e.target.closest?.('button,input,select,textarea,a');
    if (!control || control.title) return;
    const inheritedHelp = control.parentElement?.closest('[title]')?.title;
    if (inheritedHelp) { control.title = inheritedHelp; return; }
    const label = controlLabel(control);
    if (!label) return;
    const field = control.closest('.field');
    const ownsField = field && (control.parentElement === field || control.closest('label')?.parentElement === field);
    const hint = ownsField && caption([...field.children].find(child => child.matches('.hint')));
    control.title = HELP[label] ?? (hint ? `${label}. ${hint}` : label);
  };
  root.addEventListener('mouseover', describe);
  root.addEventListener('focusin', describe);
}
