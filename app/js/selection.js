// Geometry operations shared by keyboard, inspector and direct manipulation.
export function selectionBounds(layers) {
  const boxes = layers.map(l => l._box).filter(Boolean).map(b => {
    const angle = (b.rot ?? 0) * Math.PI / 180;
    const w = Math.abs(b.w * Math.cos(angle)) + Math.abs(b.h * Math.sin(angle));
    const h = Math.abs(b.w * Math.sin(angle)) + Math.abs(b.h * Math.cos(angle));
    return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
  });
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
}

/** Uniform group transform. Members retain their proportions and relative angles. */
export function transformSelection(members, start, next) {
  const scale = next.w / start.w, rotation = (next.rot ?? 0) - (start.rot ?? 0);
  const angle = rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return members.map(({ layer, box }) => {
    const x = (box.x + box.w / 2 - start.x - start.w / 2) * scale;
    const y = (box.y + box.h / 2 - start.y - start.h / 2) * scale;
    const w = box.w * scale, h = box.h * scale;
    return { layer, scale, box: { x: next.x + next.w / 2 + x * c - y * s - w / 2, y: next.y + next.h / 2 + x * s + y * c - h / 2, w, h, rot: (box.rot ?? 0) + rotation } };
  });
}

export function arrangeSelection(layers, operation, canvas) {
  const items = layers.filter(l => l._box && !l.locked);
  const bounds = items.length === 1 ? { x: 0, y: 0, w: canvas.W, h: canvas.H } : selectionBounds(items);
  if (!bounds) return [];
  const visible = layer => selectionBounds([layer]);
  const axis = operation.endsWith('x') ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  if (operation.startsWith('distribute')) {
    if (items.length < 3) return [];
    const sorted = [...items].sort((a, b) => visible(a)[axis] - visible(b)[axis]);
    const gap = (bounds[size] - sorted.reduce((sum, l) => sum + visible(l)[size], 0)) / (sorted.length - 1);
    let cursor = bounds[axis];
    return sorted.map(layer => { const bounds = visible(layer); const box = { ...layer._box, [axis]: layer._box[axis] + cursor - bounds[axis] }; cursor += bounds[size] + gap; return { layer, box }; });
  }
  return items.map(layer => {
    const box = { ...layer._box }, current = visible(layer);
    if (operation === 'left') box.x += bounds.x - current.x;
    if (operation === 'right') box.x += bounds.x + bounds.w - current.x - current.w;
    if (operation === 'top') box.y += bounds.y - current.y;
    if (operation === 'bottom') box.y += bounds.y + bounds.h - current.y - current.h;
    if (operation === 'center-x') box.x = bounds.x + (bounds.w - box.w) / 2;
    if (operation === 'center-y') box.y = bounds.y + (bounds.h - box.h) / 2;
    return { layer, box };
  });
}

/** Nearest edge distances along each axis, in canvas pixels. */
export function distanceGuides(box,others){
 const result=[];
 for(const axis of ['x','y']){
  const cross=axis==='x'?'y':'x',size=axis==='x'?'w':'h',span=axis==='x'?'h':'w';
  const band=others.filter(b=>Math.min(box[cross]+box[span],b[cross]+b[span])>=Math.max(box[cross],b[cross]));
  for(const direction of [-1,1]){
   const matches=band.map(b=>({b,gap:direction<0?box[axis]-b[axis]-b[size]:b[axis]-box[axis]-box[size]})).filter(v=>v.gap>=0).sort((a,b)=>a.gap-b.gap);
   if(!matches.length)continue;const {b,gap}=matches[0],at=(Math.max(box[cross],b[cross])+Math.min(box[cross]+box[span],b[cross]+b[span]))/2,from=direction<0?b[axis]+b[size]:box[axis]+box[size],to=from+gap;
   result.push({axis,from,to,at,distance:gap,equal:false});
  }
 }
 for(const axis of ['x','y']){const pair=result.filter(g=>g.axis===axis);if(pair.length===2&&Math.abs(pair[0].distance-pair[1].distance)<.1)pair.forEach(g=>g.equal=true);}
 return result;
}
/** Equal-gap snapping between neighbours or beside an existing pair. */
export function snapEqualSpacing(box,others,threshold=7){
 const next={...box},references=[];
 for(const axis of ['x','y']){
  const cross=axis==='x'?'y':'x',size=axis==='x'?'w':'h',span=axis==='x'?'h':'w',band=others.filter(b=>Math.min(next[cross]+next[span],b[cross]+b[span])>Math.max(next[cross],b[cross])).sort((a,b)=>a[axis]-b[axis]);
  const candidates=[];
  for(let i=0;i<band.length-1;i++){
   const a=band[i],b=band[i+1],gap=b[axis]-a[axis]-a[size];if(gap<0)continue;
   const middle=(a[axis]+a[size]+b[axis]-next[size])/2;
   if(middle>=a[axis]+a[size]&&middle+next[size]<=b[axis])candidates.push({position:middle});
   candidates.push({position:b[axis]+b[size]+gap,ref:{axis,from:a[axis]+a[size],to:b[axis],at:(Math.max(a[cross],b[cross])+Math.min(a[cross]+a[span],b[cross]+b[span]))/2,distance:gap,equal:true}});
   candidates.push({position:a[axis]-gap-next[size],ref:{axis,from:a[axis]+a[size],to:b[axis],at:(Math.max(a[cross],b[cross])+Math.min(a[cross]+a[span],b[cross]+b[span]))/2,distance:gap,equal:true}});
  }
  const match=candidates.filter(c=>Math.abs(c.position-next[axis])<=threshold&&threshold>0).sort((a,b)=>Math.abs(a.position-next[axis])-Math.abs(b.position-next[axis]))[0];
  if(match){next[axis]=match.position;if(match.ref)references.push(match.ref);}
 }
 const guides=distanceGuides(next,others);for(const ref of references){for(const guide of guides)if(guide.axis===ref.axis&&Math.abs(guide.distance-ref.distance)<.1)guide.equal=true;guides.push(ref);}
 return {box:next,guides};
}
