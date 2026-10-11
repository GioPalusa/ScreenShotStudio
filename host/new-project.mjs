import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { starterProject } from '../app/js/onboarding.js';
import { atomicWrite } from './files.mjs';
import { isProjectFile } from '../app/js/project-file.js';

/** Publish a complete new document; replacement requires the native dialog's consent. */
export function createNewProject(destination, options, { replace = false } = {}) {
  const { project, copy } = starterProject(options);
  const checkDestination = () => {
    if (!fs.existsSync(destination)) return false;
    if (!replace) throw new Error('Existing projects are never overwritten.');
    if (!isProjectFile(destination) || !fs.lstatSync(destination).isDirectory() || !fs.existsSync(path.join(destination, 'studio.json')) || !fs.lstatSync(path.join(destination, 'studio.json')).isFile()) throw new Error('Choose an existing Screenshot Studio project to replace.');
    return true;
  };
  checkDestination();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.studio-new-'));
  let preserveStaging = false;
  try {
    atomicWrite(path.join(staging, 'studio.json'), JSON.stringify(project, null, 2));
    for (const [locale, text] of Object.entries(copy)) atomicWrite(path.join(staging, 'copy', `${locale}.json`), JSON.stringify(text, null, 2));
    if (checkDestination()) {
      const version = `replaced-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
      const previous = path.join(staging, '.versions', version);
      fs.mkdirSync(path.dirname(previous));
      fs.renameSync(destination, previous);
      try { fs.renameSync(staging, destination); }
      catch (error) {
        try { fs.renameSync(previous, destination); }
        catch {
          preserveStaging = true;
          throw new Error(`The new project could not be created. The previous project is preserved at ${previous}.`, { cause: error });
        }
        throw error;
      }
    } else fs.renameSync(staging, destination);
  } finally { if (!preserveStaging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true }); }
}
