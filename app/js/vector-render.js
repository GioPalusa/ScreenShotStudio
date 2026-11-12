// Resolution-independent paths and compositing. Saved data stays JSON, never SVG scripts.
export function shapePaths(layer) {
  if (layer.shape === 'path') return (layer.paths ?? []).map(p=>{let path=new Path2D(p.d);if(layer.pathOffset){const normalized=new Path2D();normalized.addPath(path,new DOMMatrix([1,0,0,1,-layer.pathOffset[0],-layer.pathOffset[1]]));path=normalized;}return {path,rule:p.rule ?? 'nonzero'};});
  const path=new Path2D(),w=layer.w,h=layer.h;
  if(layer.shape==='ellipse')path.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2);
  else path.roundRect(0,0,w,h,layer.radii ?? Math.max(0,Math.min(layer.radius??0,w/2,h/2)));
  return [{path,rule:'nonzero'}];
}
export function nativePaintStyle(ctx,paint,W,H,x=0,y=0){
  if(paint.type==='solid')return paint.color;
  const handles=paint.handles??[[0,0],[1,1],[0,1]],a=handles[0],b=handles[1];let gradient;
  if(paint.type==='linear'){
    let bx=b[0]*W,by=b[1]*H;const ax=a[0]*W,ay=a[1]*H,c=paint.handles?.[2];
    if(c){const ux=bx-ax,uy=by-ay,vx=c[0]*W-ax,vy=c[1]*H-ay,det=ux*vy-uy*vx;
      if(Math.abs(det)>1e-10){const nx=vy/det,ny=-vx/det,n2=nx*nx+ny*ny;bx=ax+nx/n2;by=ay+ny/n2;}}
    gradient=ctx.createLinearGradient(x+ax,y+ay,x+bx,y+by);
  }
  else{const c=handles[2]??[a[0]-(b[1]-a[1]),a[1]+(b[0]-a[0])];ctx.save();ctx.transform((b[0]-a[0])*W,(b[1]-a[1])*H,(c[0]-a[0])*W,(c[1]-a[1])*H,x+a[0]*W,y+a[1]*H);gradient=ctx.createRadialGradient(0,0,0,0,0,1);ctx.restore();}
  for(const stop of paint.stops)gradient.addColorStop(stop.position,stop.color);return gradient;
}
export function drawNativeShape(ctx,scene,layer,shadow) {
  const w=layer.w,h=layer.h;
  layer._box={x:layer.cx-w/2,y:layer.cy-h/2,w,h,rot:layer.rotate??0};
  ctx.globalAlpha=layer.opacity??1;
  ctx.translate(layer.cx,layer.cy);ctx.rotate((layer.rotate??0)*Math.PI/180);if(layer.basis)ctx.transform(...layer.basis,0,0);ctx.scale(layer.flipX?-1:1,layer.flipY?-1:1);ctx.translate(-w/2,-h/2);
  shadow?.();
  let W=w,H=h;
  if(layer.shape==='path'){[W,H]=layer.pathSize??[w,h];ctx.scale(w/W,h/H);}
  const paths=shapePaths(layer);
  let paints=layer.paints;
  if(!paints&&layer.gradient){
    const g=layer.gradient,a=(g.angle??180)*Math.PI/180,half=(Math.abs(W*Math.sin(a))+Math.abs(H*Math.cos(a)))/2;
    const alpha=(c,a)=>/^#[a-f\d]{6}$/i.test(c??'')?c+Math.round((a??1)*255).toString(16).padStart(2,'0'):c;
    paints=[{type:g.type==='radial'?'radial':'linear',handles:g.type==='radial'?[[.5,.5],[1,.5]]:[[.5-Math.sin(a)*half/W,.5+Math.cos(a)*half/H],[.5+Math.sin(a)*half/W,.5-Math.cos(a)*half/H]],stops:[{position:0,color:alpha(g.from??'#ffffff',g.fromAlpha)},{position:1,color:alpha(g.to??'#ffffff',g.toAlpha??0)}]}];
  }
  paints??=[{type:'solid',color:layer.fill??'#ffffff'}];
  for(const {path,rule} of paths)for(const [i,paint] of paints.entries()){
    ctx.save();
    if(paint.type==='solid'){ctx.fillStyle=paint.color;ctx.fill(path,rule);}
    else if(paint.type==='radial'){
      // Canvas gradients use the transform at paint time. Clip the editable path
      // first, then paint in the gradient's own elliptical coordinate system.
      ctx.clip(path,rule);const handles=paint.handles??[[.5,.5],[1,.5],[.5,1]],a=handles[0],b=handles[1],c=handles[2]??[a[0]-(b[1]-a[1]),a[1]+(b[0]-a[0])];
      const m=new DOMMatrix([(b[0]-a[0])*W,(b[1]-a[1])*H,(c[0]-a[0])*W,(c[1]-a[1])*H,a[0]*W,a[1]*H]);
      if(Math.abs(m.a*m.d-m.b*m.c)>1e-10){const inverse=m.inverse(),corners=[[0,0],[W,0],[W,H],[0,H]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(inverse));ctx.transform(m.a,m.b,m.c,m.d,m.e,m.f);const gradient=ctx.createRadialGradient(0,0,0,0,0,1);for(const stop of paint.stops)gradient.addColorStop(stop.position,stop.color);ctx.fillStyle=gradient;const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys);ctx.fillRect(left,top,Math.max(...xs)-left,Math.max(...ys)-top);}
    }else if(paint.type==='linear'){
      ctx.fillStyle=nativePaintStyle(ctx,paint,W,H);ctx.fill(path,rule);
    }else if(paint.type==='image'){
      ctx.globalAlpha*=paint.opacity??1;
      const image=scene.assets.art[`${layer.id}:paint:${i}`];
      if(image){ctx.clip(path,rule);const m=paint.transform;
        if(m?.length===2){const inverse=new DOMMatrix([m[0][0],m[1][0],m[0][1],m[1][1],m[0][2],m[1][2]]).inverse();ctx.transform(W*inverse.a/image.naturalWidth,H*inverse.b/image.naturalWidth,W*inverse.c/image.naturalHeight,H*inverse.d/image.naturalHeight,W*inverse.e,H*inverse.f);ctx.drawImage(image,0,0);}
        else{const scale=paint.mode==='FIT'?Math.min(W/image.naturalWidth,H/image.naturalHeight):Math.max(W/image.naturalWidth,H/image.naturalHeight);const iw=image.naturalWidth*scale,ih=image.naturalHeight*scale;ctx.drawImage(image,(W-iw)/2,(H-ih)/2,iw,ih);}
      }
    }
    ctx.restore();
  }
  const visibleColor=c=>!/^#[a-f\d]{6}00$/i.test(c??'')&&c!=='transparent';
  const hasFill=paints.some(p=>p.type==='solid'?visibleColor(p.color):p.type==='image'?(p.opacity??1)>0:p.stops?.some(s=>visibleColor(s.color)));
  if(layer.stroke?.width){if(hasFill)ctx.shadowColor='transparent';ctx.strokeStyle=layer.stroke.color;ctx.lineWidth=layer.stroke.width;for(const {path,rule} of paths){ctx.save();if(layer.stroke.align==='inside'){ctx.clip(path,rule);ctx.lineWidth*=2;}else if(layer.stroke.align==='outside'){const outside=new Path2D();outside.rect(-W*2-100,-H*2-100,W*5+200,H*5+200);outside.addPath(path);ctx.clip(outside,'evenodd');ctx.lineWidth*=2;}ctx.stroke(path);ctx.restore();}}
}
const blend = value => ({NORMAL:'source-over',PASS_THROUGH:'source-over',LINEAR_BURN:'color-burn',LINEAR_DODGE:'color-dodge'})[value] ?? (value??'source-over').toLowerCase().replaceAll('_','-');
/** Composite ancestor groups once; leaves stay individually selectable and editable. */
export function paintLayerTree(ctx,scene,layers,paint,applyShadow) {
  const root={children:[],groups:new Map()},byId=new Map(layers.flatMap(l=>[[l.id,l],...(l._sharedId?[[l._sharedId,l]]:[]),...(l._sourceLayerId?[[l._sourceLayerId,l]]:[])]));
  for(const layer of layers){
    if(layer.maskOnly)continue;
    let parent=root;
    for(const scope of layer.compositing??[]){let node=parent.groups.get(scope.id);if(!node){node={scope,children:[],groups:new Map()};parent.groups.set(scope.id,node);parent.children.push(node);}parent=node;}
    parent.children.push({layer});
  }
  const canvas=()=>{const c=document.createElement('canvas');c.width=ctx.canvas.width;c.height=ctx.canvas.height;return c;};
  function visit(context,node){
    if(node.layer){
      const layer=node.layer,inners=layer.innerShadows??[],px=scene.px??1;
      context.save();context.globalCompositeOperation=blend(layer.blend);
      if(layer.blur>0||inners.length){
        const pad=Math.ceil(Math.max(layer.blur??0,...inners.map(s=>s.blur*2+Math.abs(s.dx)+Math.abs(s.dy)))*px*2);
        const buffer=canvas();if((buffer.width+pad*2)*(buffer.height+pad*2)>64000000)throw Error('This layer effect exceeds the renderer size limit. Reduce its blur or output size.');buffer.width+=pad*2;buffer.height+=pad*2;const g=buffer.getContext('2d');g.scale(px,px);g.translate(pad/px,pad/px);
        try{
          paint(g,layer);
          if(inners.length){
            const mask=document.createElement('canvas');mask.width=buffer.width;mask.height=buffer.height;const m=mask.getContext('2d');m.drawImage(buffer,0,0);
            const alpha=m.getImageData(0,0,mask.width,mask.height);for(let i=3;i<alpha.data.length;i+=4)alpha.data[i]=Math.min(255,alpha.data[i]*127);m.putImageData(alpha,0,0);
            for(const shadow of inners){const inner=document.createElement('canvas');inner.width=buffer.width;inner.height=buffer.height;const ic=inner.getContext('2d');
              try{ic.fillStyle=shadow.color;ic.fillRect(0,0,inner.width,inner.height);ic.globalCompositeOperation='destination-out';ic.filter=`blur(${shadow.blur*px/2}px)`;ic.drawImage(mask,(shadow.dx??0)*px,(shadow.dy??0)*px);ic.filter='none';ic.globalCompositeOperation='destination-in';ic.drawImage(mask,0,0);g.save();g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation=blend(shadow.blend);g.drawImage(inner,0,0);g.restore();}finally{inner.width=inner.height=1;}}
            mask.width=mask.height=1;
          }
          if(layer.blur>0)context.filter=`blur(${layer.blur*px/2}px)`;
          context.drawImage(buffer,-pad/px,-pad/px,buffer.width/px,buffer.height/px);
        }finally{buffer.width=buffer.height=1;}
      }else paint(context,layer);
      context.restore();return;
    }
    const scope=node.scope;
    if(!scope){for(const child of node.children)visit(context,child);return;}
    if(!scope.clip&&!scope.maskId&&!scope.shadow&&!scope.shadows?.length&&!scope.blur&&(scope.opacity??1)===1&&['NORMAL','PASS_THROUGH',undefined].includes(scope.blend)){for(const child of node.children)visit(context,child);return;}
    const buffer=canvas(),g=buffer.getContext('2d'),backdrop=['PASS_THROUGH',undefined].includes(scope.blend)&&!scope.blur&&!scope.shadow&&!scope.shadows?.length;
    let coverage;g.scale(buffer.width/scene.W,buffer.height/scene.H);
    try{
      if(scope.clip){const c=scope.clip,previous=g.getTransform(),p=new Path2D();g.transform(...c.matrix);p.roundRect(0,0,c.w,c.h,c.radius??0);g.clip(p);g.setTransform(previous);}
      if(backdrop){
        g.drawImage(context.canvas,0,0,scene.W,scene.H);
        coverage=canvas();const c=coverage.getContext('2d');c.scale(coverage.width/scene.W,coverage.height/scene.H);
        if(scope.clip){const clip=scope.clip,p=new Path2D();c.transform(...clip.matrix);p.roundRect(0,0,clip.w,clip.h,clip.radius??0);c.fill(p);}else c.fillRect(0,0,scene.W,scene.H);
      }
      for(const child of node.children)visit(g,child);
      if(scope.maskId){const mask=byId.get(scope.maskId);if(mask){const mc=canvas(),m=mc.getContext('2d');try{m.scale(mc.width/scene.W,mc.height/scene.H);paint(m,mask);g.globalCompositeOperation='destination-in';g.drawImage(mc,0,0,scene.W,scene.H);if(coverage){const c=coverage.getContext('2d');c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='destination-in';c.drawImage(mc,0,0);}}finally{mc.width=mc.height=1;}}}
      context.save();context.globalAlpha=scope.opacity??1;
      if(backdrop){context.globalCompositeOperation='destination-out';context.drawImage(coverage,0,0,scene.W,scene.H);context.globalCompositeOperation='lighter';}
      else context.globalCompositeOperation=blend(scope.blend);applyShadow(context,scope.shadow);
      for(const shadow of scope.shadows??[]){const c=canvas(),g=c.getContext('2d');try{g.drawImage(buffer,0,0);g.globalCompositeOperation='source-in';g.fillStyle=shadow.color;g.fillRect(0,0,c.width,c.height);context.save();context.filter=`blur(${shadow.blur*(scene.px??1)/2}px)`;context.drawImage(c,shadow.dx??0,shadow.dy??0,scene.W,scene.H);context.restore();}finally{c.width=c.height=1;}}
      if(scope.blur>0)context.filter=`blur(${scope.blur*(scene.px??1)/2}px)`;context.drawImage(buffer,0,0,scene.W,scene.H);context.restore();
    }finally{buffer.width=buffer.height=1;if(coverage)coverage.width=coverage.height=1;}
  }
  visit(ctx,root);
  // Masks also need geometry for native selection/resize controls.
  for(const layer of layers.filter(l=>l.maskOnly)){if(layer.type==='shape')layer._box={x:layer.cx-layer.w/2,y:layer.cy-layer.h/2,w:layer.w,h:layer.h,rot:layer.rotate??0};}
}
