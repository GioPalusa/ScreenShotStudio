export function importMenu({ enabled, send }) {
  return { label: 'Import', submenu: [
    { label: 'From Figma…', enabled: true, click: () => send('import:figma') },
    { label: 'Designs and screenshots…', enabled, accelerator: 'CmdOrCtrl+Shift+I', click: () => send('import:designs') },
    { label: 'Font files…', enabled, click: () => send('import:fonts') },
  ] };
}
