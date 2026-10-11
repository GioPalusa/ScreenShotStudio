// Both extensions contain the same portable directory package; no lossy conversion is needed.
export const PROJECT_EXTENSIONS = ['sss', 'screenshotstudio'];
export const isProjectFile = name => /\.(sss|screenshotstudio)$/i.test(name);
export const projectName = name => name.replace(/\.(sss|screenshotstudio)$/i, '');
export const projectFilename = name => `${projectName(name)}.sss`;
