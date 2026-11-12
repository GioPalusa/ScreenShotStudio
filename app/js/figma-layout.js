// Figma REST data -> native Studio layers. Pure data; no DOM, network or Node.
const identity = [1, 0, 0, 1, 0, 0];
export const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const num = (n, d = 0) => Number.isFinite(n) ? n : d;
const rgba = (c, alpha = 1) => '#'+[num(c?.r),num(c?.g),num(c?.b),num(c?.a,1)*alpha].map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('').replace(/ff$/,'');
const visible = paints => (paints ?? []).filter(p => p.visible !== false);
const containers = new Set(['FRAME','GROUP','COMPONENT','COMPONENT_SET','INSTANCE','SECTION']);
export const isFigmaNodeId=value=>typeof value==='string'&&/^(?:I?\d+:\d+)(?:;I?\d+:\d+)*$/.test(value)&&value.length<=200;
export function figmaURL(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Paste a Figma file or frame link.'); }
  if (url.protocol !== 'https:' || !['figma.com','www.figma.com'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('Use an https://www.figma.com/design/… link.');
  const match = /^\/(?:design|file)\/([A-Za-z0-9]+)(?:\/|$)/.exec(url.pathname);
  const nodeId = url.searchParams.get('node-id')?.replace(/-/g, ':');
  if (!match || nodeId && !isFigmaNodeId(nodeId)) throw new Error('This Figma file or frame link is not supported.');
  const branch=/^\/(?:design|file)\/[A-Za-z0-9]+\/branch\/([A-Za-z0-9]+)(?:\/|$)/.exec(url.pathname);
  return { fileKey: branch?.[1]??match[1], nodeId: nodeId ?? null };
}
export function figmaFrames(data) {
  const roots = data?.nodes ? Object.values(data.nodes).map(n => n?.document).filter(Boolean) : [data?.document];
  const frames = [];
  function visit(node, page = '') {
    if (!node) return;
    if (node.type === 'CANVAS') page = node.name;
    if (['FRAME','COMPONENT','INSTANCE'].includes(node.type)) { frames.push({ id: node.id, name: String(node.name ?? 'Figma view').slice(0,500), page, width: node.size?.x ?? node.absoluteBoundingBox?.width, height: node.size?.y ?? node.absoluteBoundingBox?.height }); return; }
    for (const child of node.children ?? []) visit(child, page);
  }
  for (const root of roots) {
    if (data?.nodes && root && !['DOCUMENT','CANVAS','FRAME','COMPONENT','INSTANCE'].includes(root.type)) frames.push({ id: root.id, name: String(root.name ?? 'Figma selection').slice(0,500), page: '', width: root.size?.x ?? root.absoluteBoundingBox?.width, height: root.size?.y ?? root.absoluteBoundingBox?.height });
    else visit(root);
  }
  if (frames.length > 1000) throw new Error('This file has too many views. Paste a link to a specific frame.');
  return frames;
}
export function findFigmaNode(data, id) {
  if (data?.nodes?.[id]?.document) return data.nodes[id].document;
  const walk = node => node?.id === id ? node : (node?.children ?? []).map(walk).find(Boolean);
  return walk(data?.document);
}
export function convertFigmaFrame(root, { minSize = 100 } = {}) {
  const width = Math.round(root?.size?.x ?? root?.absoluteBoundingBox?.width), height = Math.round(root?.size?.y ?? root?.absoluteBoundingBox?.height);
  if (![width,height].every(n => Number.isInteger(n) && n >= minSize && n <= 12000) || width*height > 40000000) throw new Error('Figma views must be 100–12000 px per edge and at most 40 megapixels.');
  const layers = [], texts = {}, images = new Set(), warnings = new Set(); let serial = 0, pathBytes = 0;
  const name = n => String(n.name ?? n.type).slice(0,500);
  function paths(list) {
    return (list ?? []).map(p => {
      const d = p.path ?? p.data;
      if (typeof d !== 'string' || d.length > 1000000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+\-]*$/.test(d) || (pathBytes += d.length) > 10000000) throw new Error('A Figma vector contains invalid or excessive path data.');
      return { d, rule: p.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero' };
    });
  }
  function paints(list, n) {
    return visible(list).map(p => {
      if (p.type === 'SOLID') return { type: 'solid', color: rgba(p.color,p.opacity ?? 1) };
      if (['GRADIENT_LINEAR','GRADIENT_RADIAL','GRADIENT_ANGULAR','GRADIENT_DIAMOND'].includes(p.type)) {
        if (!['GRADIENT_LINEAR','GRADIENT_RADIAL'].includes(p.type)) warnings.add(`“${name(n)}”: angular/diamond gradient uses a radial approximation.`);
        return { type: p.type === 'GRADIENT_LINEAR' ? 'linear' : 'radial', handles: p.gradientHandlePositions?.map(h => [num(h.x),num(h.y)]), stops: (p.gradientStops ?? []).map(s => ({ position: Math.max(0,Math.min(1,num(s.position))), color: rgba(s.color,p.opacity ?? 1) })) };
      }
      if (p.type === 'IMAGE' && typeof p.imageRef === 'string') { images.add(p.imageRef); return { type: 'image', ref: p.imageRef, mode: p.scaleMode ?? 'FILL', transform: p.imageTransform,opacity:num(p.opacity,1) }; }
      warnings.add(`“${name(n)}”: unsupported ${p.type ?? 'unknown'} paint. It has not been rasterized.`); return null;
    }).filter(Boolean);
  }
  function transform(n, parent) {
    const m = n.relativeTransform;
    if (Array.isArray(m) && m.length === 2 && m.every(r => Array.isArray(r) && r.length === 3 && r.every(Number.isFinite))) return multiply(parent,[m[0][0],m[1][0],m[0][1],m[1][1],m[0][2],m[1][2]]);
    const b = n.absoluteBoundingBox;
    warnings.add(`“${name(n)}”: Figma omitted local geometry; using its absolute bounding box.`);
    return [1,0,0,1,num(b?.x)-num(root.absoluteBoundingBox?.x),num(b?.y)-num(root.absoluteBoundingBox?.y)];
  }
  function walk(n, matrix, scopes, hidden = false, maskOnly = false, depth = 0) {
    if (++serial > 5000 || depth > 64) throw new Error('Import up to 5000 layers and 64 nested groups per view.');
    if (n.type === 'SLICE') return null;
    hidden ||= n.visible === false;
    const w = Math.max(.001,num(n.size?.x,num(n.absoluteBoundingBox?.width,1))), h = Math.max(.001,num(n.size?.y,num(n.absoluteBoundingBox?.height,1)));
    const sx = Math.hypot(matrix[0],matrix[1]) || 1, sy = Math.hypot(matrix[2],matrix[3]) || 1;
    const rotate = Math.atan2(matrix[1],matrix[0])*180/Math.PI;
    const cx = matrix[0]*w/2+matrix[2]*h/2+matrix[4], cy = matrix[1]*w/2+matrix[3]*h/2+matrix[5];
    const fill = paints(n.fills ?? n.background,n), strokes = paints(n.strokes,n);
    const effects = (n.effects ?? []).filter(e=>e.visible !== false);
    const shadows=effects.filter(e=>e.type==='DROP_SHADOW').map(e=>({color:rgba(e.color),blur:num(e.radius),dx:num(e.offset?.x),dy:num(e.offset?.y)}));
    const shadow = effects.find(e=>e.type === 'DROP_SHADOW');
    const innerShadows=effects.filter(e=>e.type==='INNER_SHADOW').map(e=>({color:rgba(e.color),blur:num(e.radius),dx:num(e.offset?.x),dy:num(e.offset?.y),blend:e.blendMode}));
    const layerBlur = effects.find(e=>e.type === 'LAYER_BLUR');
    if (effects.some(e=>!['DROP_SHADOW','LAYER_BLUR','INNER_SHADOW'].includes(e.type))) warnings.add(`“${name(n)}”: inner shadows and blur effects need review. Geometry remains editable.`);
    const shadowData = shadow ? { color: rgba(shadow.color), blur: num(shadow.radius), dx: num(shadow.offset?.x), dy: num(shadow.offset?.y) } : undefined;
    const ownScope = containers.has(n.type) ? { id: `figma-group-${serial}`, opacity: num(n.opacity,1), blend: n.blendMode, ...(shadows.length ? { shadows } : {}), ...(layerBlur ? {blur:num(layerBlur.radius)} : {}), ...(n.clipsContent ? { clip: { matrix, w, h, radius: n.rectangleCornerRadii ?? num(n.cornerRadius) } } : {}) } : null;
    if (ownScope) scopes = [...scopes,ownScope];
    const id = `figma-${serial}`;
    const common = { ...(innerShadows.length?{innerShadows}:{}),id, name: name(n), compositing: scopes, hidden, maskOnly, opacity: ownScope ? 1 : num(n.opacity,1), ...(ownScope ? {} : { blend: n.blendMode, ...(layerBlur ? {blur:num(layerBlur.radius)} : {}), ...(shadowData ? {shadow:shadowData} : {}) }) };
    if(scopes.some(s=>s.clip))common.allowCrop=true;
    const geometry = { cx,cy,w:w*sx,h:h*sy,rotate };
    const firstLayer=layers.length;
    let primary;
    if (n.type === 'TEXT') {
      const style = n.style ?? {}, size = Math.max(1,num(style.fontSize,24))*sx, field = `figmaText${serial}`;
      texts[field] = String(n.characters ?? '');
      if (Object.keys(n.styleOverrideTable ?? {}).length) warnings.add(`“${name(n)}”: mixed text styles use the main text style; the text remains editable.`);
      const lineHeight = style.lineHeightUnit === 'FONT_SIZE_%' ? num(style.lineHeightPercentFontSize,120)/100 : num(style.lineHeightPx,num(style.fontSize,24)*1.2)/Math.max(1,num(style.fontSize,24));
      primary = { ...common,type:'text',field,x:cx-w*sx/2,capTop:cy-h*sy/2,w:w*sx,boxHeight:h*sy,size,minSize:size,maxLines:0,balanced:false,lineHeight,weight:num(style.fontWeight,400),fontFamily:String(style.fontFamily ?? 'sans-serif'),color:fill.find(p=>p.type==='solid')?.color ?? '#171717',align:style.textAlignHorizontal==='CENTER'?'center':style.textAlignHorizontal==='RIGHT'?'end':'start',block:style.textAlignHorizontal==='CENTER'?'center':style.textAlignHorizontal==='RIGHT'?'end':'start',rotate,figmaText:{vertical:style.textAlignVertical ?? 'TOP',letterSpacing:num(style.letterSpacing)*sx,italic:style.italic===true,...(Number.isFinite(style.baselineOffset)?{baselineOffset:style.baselineOffset*sx}:{})} };
      layers.push(primary);
      const textGradient=fill.find(p=>p.type==='linear'||p.type==='radial');if(textGradient)primary.textPaint=textGradient;
      if(Number.isFinite(style.baselineOffset)){primary.figmaText.baselineRatio=style.baselineOffset/Math.max(1,num(style.fontSize,24));delete primary.figmaText.baselineOffset;}
    } else if (fill.length || strokes.length || maskOnly) {
      const simple = ['RECTANGLE','ELLIPSE','FRAME','COMPONENT','INSTANCE','SECTION'].includes(n.type) && !n.cornerSmoothing;
      const vectorPaths = simple ? undefined : paths(n.fillGeometry ?? n.vectorPaths);
      if (!simple && !vectorPaths?.length && !n.strokeGeometry?.length) throw new Error(`“${name(n)}”: vector geometry is missing. Figma must return geometry=paths.`);
      primary = { ...common,...geometry,type:'shape',shape:n.type==='ELLIPSE'?'ellipse':simple?'rect':'path',radius:num(n.cornerRadius)*sx,...(n.rectangleCornerRadii ? {radii:n.rectangleCornerRadii.map(r=>num(r)*sx)} : {}),fill:fill.find(p=>p.type==='solid')?.color ?? 'transparent',paints:fill,stroke:strokes.length?{color:strokes.find(p=>p.type==='solid')?.color ?? '#171717',width:num(n.strokeWeight)*(simple?sx:1),align:n.strokeAlign?.toLowerCase()}:undefined,...(vectorPaths ? {paths:vectorPaths,pathSize:[w,h]} : {}) };
      if(n.pathOffset)primary.pathOffset=[...n.pathOffset];
      const gradient=fill.find(p=>p.type==='linear'||p.type==='radial');
      if(gradient?.stops.length){const a=gradient.handles?.[0]??[0,0],b=gradient.handles?.[1]??[1,1];primary.gradient={type:gradient.type,from:gradient.stops[0].color,to:gradient.stops.at(-1).color,fromAlpha:1,toAlpha:1,angle:Math.atan2(b[0]-a[0],a[1]-b[1])*180/Math.PI};}
      layers.push(primary);
      if (!simple && n.strokeGeometry?.length) {
        primary.stroke = undefined;
        layers.push({...primary,id:`${id}-outline`,name:`${name(n)} · outline`,paths:paths(n.strokeGeometry),paints:strokes,fill:strokes.find(p=>p.type==='solid')?.color ?? 'transparent'});
      }
    }
    if(primary){const shear=(matrix[0]*matrix[2]+matrix[1]*matrix[3])/(sx*sy),vertical=(matrix[0]*matrix[3]-matrix[1]*matrix[2])/(sx*sy);if(Math.abs(shear)>.00001||Math.abs(vertical-1)>.00001)for(const layer of layers.slice(firstLayer))layer.basis=[1,0,shear,vertical];}
    if (containers.has(n.type)) {
      let mask;
      for (const child of n.children ?? []) {
        const childMatrix = transform(child,matrix);
        if (child.isMask) { const layer=walk(child,childMatrix,scopes,hidden,true,depth+1); mask=layer?{id:`${layer.id}-mask`,maskId:layer.id}:null; }
        else walk(child,childMatrix,mask?[...scopes,mask]:scopes,hidden,false,depth+1);
      }
    }
    return primary;
  }
  walk(root,identity,[]);
  layers.forEach((layer,i)=>{layer.zOrder=i;});
  if (!layers.length) warnings.add('This view contains no visible paint or text.');
  return { width,height,name:name(root),layers,texts,images:[...images],warnings:[...warnings] };
}
export function scaleFigmaLayers(design, W, H, assets = {}) {
  const scale = Math.min(W/design.width,H/design.height), dx=(W-design.width*scale)/2,dy=(H-design.height*scale)/2;
  return design.layers.map(input=>{
    const l=structuredClone(input);
    for(const key of ['w','h','size','minSize','boxHeight','radius','blur'])if(typeof l[key]==='number')l[key]*=scale;
    if(l.type==='text'){l.x=l.x*scale+dx;l.capTop=l.capTop*scale+dy;if(l.figmaText)l.figmaText.letterSpacing*=scale;}
    else{l.cx=l.cx*scale+dx;l.cy=l.cy*scale+dy;}
    if(l.stroke&&l.shape!=='path')l.stroke.width*=scale;
    if(l.figmaText?.baselineOffset!==undefined)l.figmaText.baselineOffset*=scale;
    for(const shadow of [l.shadow,...(l.innerShadows??[]),...(l.compositing??[]).flatMap(s=>[s.shadow,...(s.shadows??[])])].filter(Boolean))for(const k of ['blur','dx','dy'])if(Number.isFinite(shadow[k]))shadow[k]*=scale;
    if(l.radii)l.radii=l.radii.map(r=>r*scale);
    for(const scope of l.compositing??[])if(scope.blur)scope.blur*=scale;
    for(const scope of l.compositing??[])if(scope.clip){const m=scope.clip.matrix;scope.clip.matrix=m.map((v,i)=>v*scale+(i===4?dx:i===5?dy:0));}
    for(const paint of l.paints??[])if(paint.type==='image'){if(!assets[paint.ref])throw new Error('An imported Figma image is missing.');paint.src=assets[paint.ref];delete paint.ref;}
    return l;
  });
}
