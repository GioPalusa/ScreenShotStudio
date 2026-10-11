// Synthetic legacy document: no user copy, screenshots or third-party artwork.
export function layoutProject() {
  const layouts = () => Object.fromEntries(['phone', 'tablet', 'wide', 'outer'].map(id => [id, { template: 'text-top' }]));
  return {
    version: 1, fonts: { default: { family: 'system-ui' } },
    themes: { sky: { bg: '#cceeff', ink: '#112233' }, red: { bg: '#bb2233', ink: '#ffffff' }, green: { bg: '#228855', ink: '#ffffff' } },
    locales: [{ id: 'en-US', name: 'English', dir: 'ltr' }, { id: 'sv', name: 'Swedish', dir: 'ltr' }],
    devices: {
      iphone: { label: 'Phone', size: [1320, 2868], layout: 'phone', capture: 'iphone', frame: { type: 'bezel', name: 'iphone-17-pro-orange' } },
      ipad: { label: 'Tablet', size: [2064, 2752], layout: 'tablet', capture: 'ipad', frame: { type: 'plain' } },
      'duo-inner': { label: 'Legacy wide', size: [2853, 2007], layout: 'wide', capture: 'duo-inner', frame: { type: 'duo', display: 'inner', orientation: 'landscape' } },
      'duo-outer': { label: 'Legacy outer', size: [1398, 2034], layout: 'outer', capture: 'duo-outer', frame: { type: 'duo', display: 'outer' } },
    },
    slides: [{ id: 'sample', name: 'Synthetic sample', theme: 'sky', capture: 'sample', layouts: layouts() }],
  };
}
