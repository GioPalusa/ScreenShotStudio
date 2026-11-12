import { z } from 'zod';
const text = z.string().min(1);
const json = z.record(z.string(), z.unknown());
const ids = z.array(text).min(1).max(200);
const scope = { device: text.describe('Output canvas ID, separate from the hardware profile or capture collection.'), slide: text.optional(), shared: z.boolean().optional(), locale: text.optional() };
const selection = { ids: ids.describe('Selected raw layer IDs from inspect_layers. Operations reject locked layers.') };
const edit = (op, fields = {}) => z.object({ op: z.literal(op), ...scope, ...fields });
const point = z.tuple([z.number(), z.number()]);
export const layerEdits = z.array(z.discriminatedUnion('op', [
  edit('add', { layer: json }),
  edit('patch', { id: text, patch: json.describe('Shallow property patch. null clears an override; nested paint/effect objects replace that property.') }),
  edit('remove', { id: text }),
  edit('group', { ...selection, group: text.optional() }),
  edit('ungroup', selection),
  edit('reorder', { ...selection, direction: z.enum(['forward', 'backward', 'front', 'back']) }),
  edit('appearance', { ...selection, source: text.describe('Copy appearance from this layer within the same scope.').optional(), appearance: json.optional() }),
  edit('shadow', { ...selection, enabled: z.boolean().optional(), preset: text.optional(), distance: z.number().nonnegative().optional(), angle: z.number().optional(), shadow: z.object({ color: text.optional(), alpha: z.number().min(0).max(1).optional(), blur: z.number().nonnegative().optional(), dx: z.number().optional(), dy: z.number().optional() }).optional() }),
  edit('paint', { ...selection, action: z.enum(['color', 'none', 'restore', 'swap', 'width', 'type', 'stop', 'angle', 'patch', 'add', 'remove']), target: z.enum(['fill', 'stroke']).optional(), color: text.optional(), width: z.number().nonnegative().optional(), index: z.number().int().nonnegative().optional(), paintType: z.enum(['solid', 'linear', 'radial']).optional(), paint: json.optional(), stop: z.number().int().nonnegative().optional(), position: z.number().min(0).max(1).optional(), opacity: z.number().min(0).max(1).optional(), angle: z.number().optional() }),
  edit('corners', { ...selection, radius: z.number().nonnegative(), corner: text.describe('Corner key from inspect_layers; omitted means all corners.').optional(), all: z.boolean().optional() }),
  edit('vector', { id: text, action: z.enum(['move_anchor', 'move_handle', 'split', 'delete_anchor', 'corner', 'smooth', 'bend', 'replace']), path: z.number().int().nonnegative().optional(), command: z.number().int().nonnegative().optional(), offset: z.number().int().nonnegative().optional(), point: point.describe('Original path coordinates, from inspect_layers(vectors=true).').optional(), delta: point.optional(), t: z.number().min(.001).max(.999).optional(), linked: z.boolean().optional(), d: text.optional() }),
  edit('mask', { ...selection, mask: text.describe('Mask layer among ids; defaults to frontmost selected object.').optional() }),
  edit('unmask', selection),
  edit('boolean', { ...selection, operation: z.enum(['unite', 'subtract', 'intersect', 'exclude']), resultId: text.optional() }),
])).min(1).max(200);

const projectEdit = (op, fields) => z.object({ op: z.literal(op), ...fields });
const size = z.tuple([z.number().int().min(100).max(12000), z.number().int().min(100).max(12000)]);
export const projectEdits = z.array(z.discriminatedUnion('op', [
  projectEdit('add_canvas', { canvas: z.object({ label: text, short: text.optional(), size, layout: z.enum(['phone', 'tablet', 'wide', 'outer']).default('phone'), target: text.optional(), capture: text.optional(), frame: json.optional(), reuseFrom: text.optional() }) }),
  projectEdit('resize_canvas', { device: text, size, mode: z.enum(['scale', 'keep']).optional() }),
  projectEdit('remove_canvas', { device: text }),
  projectEdit('orient_canvas', { device: text, slide: text, orientation: z.enum(['portrait', 'landscape']) }),
  projectEdit('rename_slide', { slide: text, name: text }),
  projectEdit('reorder_slide', { slide: text, relativeTo: text, after: z.boolean().optional(), locale: text.optional(), allLanguages: z.boolean().optional() }),
  projectEdit('independent_layout', { device: text, slide: text, locale: text.optional(), independent: z.boolean() }),
  projectEdit('shared_spacing', { device: text, preset: z.enum(['app-store', 'google-play', 'custom']), gap: z.number().min(0).max(1).optional() }),
  projectEdit('save_template', { slide: text, name: text }),
  projectEdit('apply_template', { slide: text, template: text, devices: ids.optional() }),
  projectEdit('detach_template', { slide: text }),
])).min(1).max(100);
