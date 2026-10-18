export const APPEARANCE_MODES = ['system', 'light', 'dark'];
export const appearanceBackground = dark => dark ? '#121019' : '#F7F5F2';

/** Keep native controls, window backgrounds and every renderer on the same preference. */
export function createAppearance({ nativeTheme, read, write, windows, onChange = () => {} }) {
  const get = () => APPEARANCE_MODES.includes(read()) ? read() : 'system';
  const notify = () => {
    for (const win of windows()) {
      if (!win || win.isDestroyed()) continue;
      win.setBackgroundColor(appearanceBackground(nativeTheme.shouldUseDarkColors));
      win.webContents.send('studio:appearance', get());
    }
    onChange();
  };
  nativeTheme.themeSource = get();
  nativeTheme.on('updated', notify);
  return {
    get,
    set(value) {
      if (!APPEARANCE_MODES.includes(value)) throw new Error('Choose System, Light or Dark appearance.');
      write(value); // Persist before changing the native theme or notifying windows.
      nativeTheme.themeSource = value;
      notify();
      return value;
    },
  };
}
