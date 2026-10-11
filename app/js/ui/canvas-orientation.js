import { engine, checkpoint, saveStudio } from '../store.js';
import { canvasForSlide, canvasOrientationOptions, orientationOf, setCanvasOrientation } from '../canvas-orientation.js';
import { selectInput } from './helpers.js';

export function orientationPicker(slide, deviceId, refresh) {
  const project = engine.project, device = project.devices[deviceId];
  const options = canvasOrientationOptions(device);
  const current = orientationOf(canvasForSlide(project, slide, deviceId).size);
  if (!options.includes(current)) options.unshift(current);
  const input = selectInput({ options: options.map(value => [value, value === 'portrait' ? 'Portrait' : 'Landscape']), value: current,
    title: 'Canvas orientation · this screen, all languages', onChange: value => {
      if (project !== engine.project) return;
      checkpoint(); setCanvasOrientation(project, slide, deviceId, value); saveStudio(); refresh();
    } });
  input.setAttribute('aria-label', 'Canvas orientation');
  input.disabled = options.length < 2 || device.size[0] === device.size[1];
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
  return input;
}
