// Runs before styles are painted, and is also safe to import from browser UI modules.
(() => {
  if (typeof window === 'undefined' || window.studioAppearance) return;
  const key = 'screenshot-studio:appearance', modes = ['system', 'light', 'dark'];
  const valid = value => modes.includes(value) ? value : 'system';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system', generation = 0;
  try { preference = valid(localStorage.getItem(key)); } catch { /* Private browser storage. */ }
  function apply(value, persist = true) {
    preference = valid(value);
    const theme = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
    document.documentElement.dataset.appearance = preference;
    document.documentElement.dataset.theme = theme;
    if (persist) try { localStorage.setItem(key, preference); } catch { /* Appearance still works for this window. */ }
    window.dispatchEvent(new CustomEvent('studio:appearance', { detail: { preference, theme } }));
  }
  window.studioAppearance = {
    get preference() { return preference; },
    get theme() { return document.documentElement.dataset.theme; },
    async set(value) {
      if (!modes.includes(value)) throw new Error('Choose System, Light or Dark appearance.');
      const mine = ++generation;
      if (window.studioDesktop?.appearance) value = await window.studioDesktop.appearance('set', value);
      if (mine === generation) apply(value);
    },
  };
  media.addEventListener('change', () => { if (preference === 'system') apply(preference, false); });
  window.addEventListener('storage', event => { if (event.key === key) { generation++; apply(event.newValue, false); } });
  window.studioDesktop?.onAppearance?.(value => { generation++; apply(value); });
  apply(preference, false);
  const mine = generation;
  window.studioDesktop?.appearance?.('get').then(value => { if (mine === generation) apply(value); }).catch(() => {});
})();
