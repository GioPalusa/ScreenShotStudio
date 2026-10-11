// Direct manipulation on the preview: click to select, drag to move, handles to resize, a knob to rotate,
// guides that snap to the canvas and to other layers, arrow keys to nudge.
//
// Everything is in design pixels (the same units the layouts use). The overlay is a plain <div> stacked on
// the preview canvas; the canvas itself is only ever drawn by the engine.
//
// The editor ("ed") supplies the scene and takes the edits:
//   ed.scene, ed.stageWidth, ed.selectedId, ed.select(id), ed.layerById(id)
//   ed.startEdit(key)            history checkpoint + returns the block being edited
//   ed.applyBox(layer, box, o)   writes the geometry of a layer and repaints synchronously
//   ed.finishEdit()              save, redraw everything, refresh the inspector numbers

import { selectionBounds, transformSelection } from '../selection.js';
import { paintOrder } from '../layouts.js';
import { layerLabel } from '../layer-ops.js';
import { h } from './helpers.js';

const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const MIN_SIZE = 24;
const DRAG_THRESHOLD = 3; // css px before a press becomes a drag

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const normalizeAngle = (a) => { let v = ((a + 180) % 360 + 360) % 360 - 180; if (v === -180) v = 180; return v; };

const selectable = (layer) => layer._box && !layer.locked;

/** Pointer position relative to a box's centre, in the box's own (unrotated) axes. */
function toLocal(box, px, py) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const a = -rad(box.rot ?? 0);
  const dx = px - cx;
  const dy = py - cy;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

/** Which handles a layer offers. Devices keep their proportions; text boxes only change width. */
const handlesFor = () => Object.keys(HANDLES);
const canRotate = () => true;
const keepsAspect = (layer) => layer.type === 'device' || layer.type === 'art';

/** New box for a resize drag. `p` is the pointer in design pixels. */
export function resizeBox(start, handle, p, { keepAspect, fromCenter }) {
  const c = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
  const local = toLocal(start, p.x, p.y);
  const hw = start.w / 2;
  const hh = start.h / 2;
  const east = handle.includes('e');
  const west = handle.includes('w');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let L = -hw, R = hw, T = -hh, B = hh;
  if (east) R = local.x;
  if (west) L = local.x;
  if (south) B = local.y;
  if (north) T = local.y;
  if (fromCenter) {
    if (east) L = -R;
    if (west) R = -L;
    if (south) T = -B;
    if (north) B = -T;
  }
  // never collapse or flip
  if (R - L < MIN_SIZE) { if (east && !fromCenter) R = L + MIN_SIZE; else if (west && !fromCenter) L = R - MIN_SIZE; else { L = -MIN_SIZE / 2; R = MIN_SIZE / 2; } }
  if (B - T < MIN_SIZE) { if (south && !fromCenter) B = T + MIN_SIZE; else if (north && !fromCenter) T = B - MIN_SIZE; else { T = -MIN_SIZE / 2; B = MIN_SIZE / 2; } }

  if (keepAspect) {
    const aspect = start.w / start.h;
    const midX = (L + R) / 2;
    const midY = (T + B) / 2;
    const corner = (east || west) && (north || south);
    if (corner) {
      const s = Math.max((R - L) / start.w, (B - T) / start.h);
      const w = start.w * s;
      const hgt = start.h * s;
      if (fromCenter) { L = -w / 2; R = w / 2; T = -hgt / 2; B = hgt / 2; }
      else {
        if (west) L = R - w; else R = L + w;
        if (north) T = B - hgt; else B = T + hgt;
      }
    } else if (east || west) {
      const hgt = (R - L) / aspect;
      T = midY - hgt / 2;
      B = midY + hgt / 2;
    } else {
      const w = (B - T) * aspect;
      L = midX - w / 2;
      R = midX + w / 2;
    }
  }

  const w = R - L;
  const hgt = B - T;
  const rot = rad(start.rot ?? 0);
  const lc = { x: (L + R) / 2, y: (T + B) / 2 };
  const gc = { x: c.x + lc.x * Math.cos(rot) - lc.y * Math.sin(rot), y: c.y + lc.x * Math.sin(rot) + lc.y * Math.cos(rot) };
  return { x: gc.x - w / 2, y: gc.y - hgt / 2, w, h: hgt, rot: start.rot ?? 0 };
}

// ---------------------------------------------------------------------------------------------

export function createStage(ed) {
  const overlay = ed.overlay;
  let hoverId = null;
  let drag = null;
  let guides = [];
  let readout = '';

  const scene = () => ed.scene;
  const k = () => (scene() ? ed.stageWidth / scene().W : 1);
  const design = (e) => {
    const r = overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k(), y: (e.clientY - r.top) / k() };
  };

  function hitTest(p, { skip = 0 } = {}) {
    const hits = paintOrder(scene().layers).filter(l => selectable(l) && (l.type !== 'route' || l.id === ed.selectedId)).reverse().filter((l) => {
      if (l._clip && (p.x < l._clip.x || p.x > l._clip.x + l._clip.w || p.y < l._clip.y || p.y > l._clip.y + l._clip.h)) return false;
      const b = l._box;
      const q = toLocal(b, p.x, p.y);
      return Math.abs(q.x) <= b.w / 2 && Math.abs(q.y) <= b.h / 2;
    });
    return hits[Math.min(skip, hits.length - 1)] ?? null;
  }

  // ----- snapping

  function snapLines(movingId) {
    const s = scene();
    const xs = [0, s.W / 2, s.W];
    const ys = [0, s.H / 2, s.H];
    for (const l of s.layers) {
      if (ed.selectedIds.has(l.id) || l.id === movingId || !l._box || l._origin === 'panorama' || l.type === 'route' || l._box.rot) continue;
      const b = l._box;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  }

  const nearest = (values, lines, threshold) => {
    let best = null;
    for (const v of values) for (const line of lines) {
      const d = line - v;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, line };
    }
    return best;
  };

  // ----- overlay drawing

  function chrome(layer, { selected }) {
    const b = layer._box;
    const f = k();
    const box = h('div', {
      class: `sel${selected ? ' selected' : ' hover'}${layer.type === 'text' ? ' text' : ''}`,
      style: { left: `${b.x * f}px`, top: `${b.y * f}px`, width: `${b.w * f}px`, height: `${b.h * f}px`, transform: b.rot ? `rotate(${b.rot}deg)` : '' },
    });
    if (!selected) {
      box.append(h('span', { class: 'sel-tag' }, layerLabel(layer)));
      return box;
    }
    if (layer.locked) { box.classList.add('locked'); box.append(h('span', { class: 'sel-tag' }, `${layerLabel(layer)} · locked`)); return box; }
    if (ed.selectionLayers().length > 1 && layer.type !== 'selection') return box;
    for (const name of handlesFor(layer)) {
      const [fx, fy] = HANDLES[name];
      box.append(h('i', { class: 'handle', dataset: { handle: name }, style: { left: `${fx * 100}%`, top: `${fy * 100}%`, cursor: CURSORS[name] } }));
    }
    if (canRotate(layer)) box.append(h('i', { class: 'handle rotate', dataset: { handle: 'rotate' }, title: 'Rotate (hold Shift for 15° steps)' }));
    return box;
  }

  function render() {
    overlay.replaceChildren();
    const s = scene();
    if (!s) return;
    const selected = s.layers.find((l) => l.id === ed.selectedId && l._box);
    const hovered = hoverId && hoverId !== ed.selectedId ? s.layers.find((l) => l.id === hoverId && l._box) : null;
    if (hovered && !drag) overlay.append(chrome(hovered, { selected: false }));
    for (const layer of ed.selectionLayers()) overlay.append(chrome(layer, { selected: true }));
    if (ed.selectionLayers().length > 1) overlay.append(chrome({ type: 'selection', _box: selectionBounds(ed.selectionLayers()) }, { selected: true }));
    const f = k();
    for (const g of guides) {
      overlay.append(h('div', { class: `guide ${g.axis}`, style: g.axis === 'x' ? { left: `${g.at * f}px` } : { top: `${g.at * f}px` } }));
    }
    if (readout && selected) {
      const b = selected._box;
      overlay.append(h('div', { class: 'readout', style: { left: `${Math.min(Math.max(8, (b.x + b.w / 2) * f), ed.stageWidth - 8)}px`, top: `${Math.max(8, b.y * f - 34)}px` } }, readout));
    }
  }

  /** Move the selection chrome without rebuilding it (used while dragging). */
  function placeSelected(box) {
    const el = overlay.querySelector('.sel.selected');
    if (!el) return;
    const f = k();
    Object.assign(el.style, { left: `${box.x * f}px`, top: `${box.y * f}px`, width: `${box.w * f}px`, height: `${box.h * f}px`, transform: box.rot ? `rotate(${box.rot}deg)` : '' });
  }

  // ----- pointer handling

  function onPointerDown(e) {
    if (e.button !== 0 || !scene()) return;
    const p = design(e);
    const handle = e.target.dataset?.handle;
    const members = ed.selectionLayers().map(layer => ({ layer: structuredClone(layer), box: { ...layer._box } }));
    const selected = members.length > 1 ? { id: '__selection', type: 'selection', _box: selectionBounds(ed.selectionLayers()) } : ed.layerById(ed.selectedId);

    if (handle && selected?._box) {
      overlay.setPointerCapture(e.pointerId);
      const b = { ...selected._box };
      drag = {
        members: members.length > 1 ? members : null,
        kind: handle === 'rotate' ? 'rotate' : 'resize', handle, id: selected.id, start: p, startPx: { x: e.clientX, y: e.clientY }, box: b, active: false, key: `drag:${selected.id}:${Date.now()}`,
        startAngle: Math.atan2(p.y - (b.y + b.h / 2), p.x - (b.x + b.w / 2)), startRot: b.rot ?? 0,
      };
      e.preventDefault();
      return;
    }

    const hit = hitTest(p, { skip: e.altKey ? 1 : 0 });
    if (!hit) {
      if (ed.selectedId) ed.select(null);
      return;
    }
    if (e.shiftKey) { ed.select(hit.id, { from: 'stage', toggle: true, individual: e.altKey }); e.preventDefault(); return; }
    if (!ed.selectedIds.has(hit.id) || !ed.selectionVisible()) ed.select(hit.id, { from: 'stage', individual: e.altKey });
    ed.showDetails?.();
    overlay.setPointerCapture(e.pointerId);
    drag = { members: ed.selectionLayers().map(l => ({ layer: l, box: { ...l._box } })), kind: 'move', id: hit.id, start: p, startPx: { x: e.clientX, y: e.clientY }, box: { ...hit._box }, active: false, key: `drag:${hit.id}:${Date.now()}` };
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!scene()) return;
    if (!drag) {
      const hit = e.buttons ? null : hitTest(design(e));
      const id = hit?.id ?? null;
      overlay.style.cursor = e.target.dataset?.handle ? e.target.style.cursor || 'crosshair' : id ? (id === ed.selectedId ? 'move' : 'pointer') : 'default';
      if (id !== hoverId) { hoverId = id; render(); }
      return;
    }
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startPx.x, e.clientY - drag.startPx.y) < DRAG_THRESHOLD) return;
      drag.active = true;
      ed.startEdit(drag.key);
      hoverId = null;
    }
    const layer = drag.id === '__selection' ? { id: drag.id, type: 'selection', _box: drag.box } : ed.layerById(drag.id);
    if (!layer) return;
    const p = design(e);
    const threshold = (e.metaKey || e.ctrlKey ? 0 : 7) / k();
    guides = [];
    let box;

    if (drag.kind === 'move') {
      box = { ...drag.box, x: drag.box.x + (p.x - drag.start.x), y: drag.box.y + (p.y - drag.start.y) };
      if (e.shiftKey) { // constrain to one axis
        if (Math.abs(p.x - drag.start.x) > Math.abs(p.y - drag.start.y)) box.y = drag.box.y; else box.x = drag.box.x;
      }
      if (threshold) {
        const lines = snapLines(layer.id);
        const xs = drag.box.rot ? [box.x + box.w / 2] : [box.x, box.x + box.w / 2, box.x + box.w];
        const ys = drag.box.rot ? [box.y + box.h / 2] : [box.y, box.y + box.h / 2, box.y + box.h];
        const sx = nearest(xs, lines.xs, threshold);
        const sy = nearest(ys, lines.ys, threshold);
        if (sx) { box.x += sx.delta; guides.push({ axis: 'x', at: sx.line }); }
        if (sy) { box.y += sy.delta; guides.push({ axis: 'y', at: sy.line }); }
      }
      readout = `x ${Math.round(box.x)}  y ${Math.round(box.y)}`;
    } else if (drag.kind === 'resize') {
      let q = p;
      if (threshold && !drag.box.rot) {
        const lines = snapLines(layer.id);
        q = { ...p };
        if (drag.handle.includes('e') || drag.handle.includes('w')) {
          const sx = nearest([p.x], lines.xs, threshold);
          if (sx) { q.x = sx.line; guides.push({ axis: 'x', at: sx.line }); }
        }
        if (drag.handle.includes('n') || drag.handle.includes('s')) {
          const sy = nearest([p.y], lines.ys, threshold);
          if (sy) { q.y = sy.line; guides.push({ axis: 'y', at: sy.line }); }
        }
      }
      const lockAspect = layer.type === 'selection' ? true : layer.type === 'text' ? false : keepsAspect(layer) ? !e.shiftKey || layer.type === 'device' : e.shiftKey;
      box = resizeBox(drag.box, drag.handle, q, { keepAspect: lockAspect, fromCenter: e.altKey });
      readout = `${Math.round(box.w)} × ${Math.round(box.h)}`;
    } else {
      const c = { x: drag.box.x + drag.box.w / 2, y: drag.box.y + drag.box.h / 2 };
      let rot = drag.startRot + deg(Math.atan2(p.y - c.y, p.x - c.x) - drag.startAngle);
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      else for (const target of [0, 90, 180, -90, -180]) if (Math.abs(rot - target) < 2.5) rot = target;
      rot = normalizeAngle(rot);
      box = { ...drag.box, rot };
      readout = `${Math.round(rot * 10) / 10}°`;
    }
    if (drag.id === '__selection') {
      ed.applyGroup(transformSelection(drag.members, drag.box, box));
    } else if (drag.kind === 'move' && drag.members?.length > 1) {
      for (const item of drag.members) ed.applyBox(item.layer, { ...item.box, x: item.box.x + box.x - drag.box.x, y: item.box.y + box.y - drag.box.y });
    } else ed.applyBox(layer, box, { vertical: drag.kind === 'move' || drag.handle?.includes('n') || drag.handle?.includes('s') || drag.kind === 'rotate' });
    render();
  }

  function onPointerUp(e) {
    if (!drag) return;
    try { overlay.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    const wasActive = drag.active;
    drag = null;
    guides = [];
    readout = '';
    if (wasActive) ed.finishEdit();
    render();
  }

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('pointerleave', () => { if (!drag && hoverId) { hoverId = null; render(); } });
  overlay.addEventListener('dblclick', (e) => {
    const hit = hitTest(design(e));
    if (hit) ed.openLayer(hit);
  });
  overlay.addEventListener('contextmenu', e => {
    if (!scene()) return;
    const hit = hitTest(design(e));
    if (hit) ed.layerMenu(e, hit);
  });

  return {
    render,
    placeSelected,
    get dragging() { return Boolean(drag?.active); },
    /** Arrow-key nudge of the selected layer by (dx, dy) design pixels. */
    nudge(dx, dy) {
      const layer = ed.layerById(ed.selectedId);
      if (!layer?._box || layer.locked) return false;
      ed.startEdit(`nudge:${layer.id}`);
      for (const item of ed.selectionLayers()) { const b = item._box; ed.applyBox(item, { ...b, x: b.x + dx, y: b.y + dy }, { vertical: dy !== 0 }); }
      ed.finishEdit({ quick: true });
      return true;
    },
    cancelDrag() { drag = null; guides = []; readout = ''; render(); },
  };
}
