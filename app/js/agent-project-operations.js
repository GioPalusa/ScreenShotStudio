import { addDevice, resizeDevice, removeDevice, renameSlide, reorderSlides } from './project-ops.js';
import { setCanvasOrientation } from './canvas-orientation.js';
import { setLayoutIndependent, saveAsTemplate, followTemplate, detachTemplate, splitBlockForDevice } from './layer-ops.js';
import { setSharedSpacing } from './shared-canvas.js';
import { slideSupportsCanvas, isStoreCanvas } from './slide-order.js';
import { validateDocument } from './document.js';
import { plain } from './agent-edits.js';

/** Structural edits share the same canvas/template/order rules as the editor. */
export function editProject(studio, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 100) throw new Error('Supply 1–100 project edits.');
  plain(edits);
  const project = structuredClone(studio), results = [];
  for (const edit of edits) {
    const device = edit.device ? project.devices[edit.device] : null;
    const slide = edit.slide ? project.slides.find(s => s.id === edit.slide) : null;
    if (edit.device && !device) throw new Error(`Unknown canvas: ${edit.device}`);
    if (edit.slide && !slide) throw new Error(`Unknown slide: ${edit.slide}`);
    if (edit.locale && !project.locales.some(l => l.id === edit.locale)) throw new Error(`Unknown locale: ${edit.locale}`);
    let result = { op: edit.op };
    if (['resize_canvas', 'orient_canvas', 'remove_canvas', 'independent_layout', 'shared_spacing'].includes(edit.op) && !device) throw new Error('Supply a canvas ID.');
    if (['rename_slide', 'reorder_slide', 'orient_canvas', 'independent_layout', 'save_template', 'apply_template', 'detach_template'].includes(edit.op) && !slide) throw new Error('Supply a slide ID.');
    switch (edit.op) {
      case 'add_canvas': {
        if (!edit.canvas?.label || !['phone', 'tablet', 'wide', 'outer'].includes(edit.canvas.layout ?? 'phone')) throw new Error('Supply a canvas label and a supported layout class.');
        if (edit.canvas.reuseFrom && !project.devices[edit.canvas.reuseFrom]) throw new Error('Unknown source canvas.');
        if (!Array.isArray(edit.canvas.size) || edit.canvas.size.length !== 2 || edit.canvas.size.some(n => !Number.isInteger(n) || n < 100 || n > 12000)) throw new Error('Canvas size must contain two integers from 100 to 12000.');
        result.device = addDevice(project, { layout: 'phone', ...edit.canvas });
        break;
      }
      case 'resize_canvas':
        if (!Array.isArray(edit.size) || edit.size.length !== 2 || edit.size.some(n => !Number.isInteger(n) || n < 100 || n > 12000)) throw new Error('Canvas size must contain two integers from 100 to 12000.');
        if (edit.mode && !['scale', 'keep'].includes(edit.mode)) throw new Error('Choose scale or keep.');
        resizeDevice(project, edit.device, edit.size, { mode: edit.mode ?? 'scale' });
        break;
      case 'remove_canvas':
        if (Object.keys(project.devices).length === 1) throw new Error('Keep at least one canvas.');
        removeDevice(project, edit.device);
        break;
      case 'orient_canvas':
        if (!slideSupportsCanvas(project, slide, edit.device)) throw new Error('This slide does not belong to that canvas.');
        setCanvasOrientation(project, slide, edit.device, edit.orientation);
        break;
      case 'rename_slide':
        if (typeof edit.name !== 'string' || !edit.name.trim()) throw new Error('Supply a screen name.');
        renameSlide(project, edit.slide, edit.name);
        break;
      case 'reorder_slide':
        if (!project.slides.some(s => s.id === edit.relativeTo)) throw new Error('Choose a screen to move relative to.');
        reorderSlides(project, edit.slide, edit.relativeTo, edit.after ?? true, edit.locale ?? project.sourceLocale ?? project.locales[0].id, edit.allLanguages ?? false);
        break;
      case 'independent_layout':
        if (typeof edit.independent !== 'boolean') throw new Error('Supply independent: true or false.');
        if (!slideSupportsCanvas(project, slide, edit.device)) throw new Error('This slide does not belong to that canvas.');
        setLayoutIndependent(project, slide, edit.device, edit.independent, edit.locale);
        break;
      case 'shared_spacing':
        if (isStoreCanvas(device)) throw new Error('Independent store images do not have a shared screenshot row.');
        if (!['app-store', 'google-play', 'custom'].includes(edit.preset) || !setSharedSpacing(project, edit.device, edit.preset, edit.gap)) throw new Error('Choose a spacing preset or a custom gap ratio from 0 to 1.');
        break;
      case 'save_template':
        if (typeof edit.name !== 'string' || !edit.name.trim()) throw new Error('Supply a template name.');
        result.template = saveAsTemplate(project, slide, edit.name);
        break;
      case 'apply_template':
        if (!project.templates?.[edit.template]) throw new Error('Unknown project template.');
        if (edit.devices && (!edit.devices.length || edit.devices.some(id => !project.devices[id] || !slideSupportsCanvas(project, slide, id)))) throw new Error('Choose canvases belonging to this screen.');
        for (const device of edit.devices ?? []) splitBlockForDevice(project, slide, device);
        followTemplate(project, slide, edit.template, { deviceIds: edit.devices ?? null });
        break;
      case 'detach_template': detachTemplate(project, slide); break;
      default: throw new Error(`Unknown project operation: ${edit.op}`);
    }
    results.push(result);
  }
  validateDocument(project);
  return { studio: project, results };
}
