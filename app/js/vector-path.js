// SVG geometry as editable anchors and handles. Pure data; no DOM or host APIs.
const sizes={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
const end=c=>c.v.slice(-2);
const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6;
const copy=commands=>commands.map(c=>({cmd:c.cmd,v:[...c.v]}));
export function parseVectorPath(d){
 if(typeof d!=='string'||d.length>1000000)throw Error('This vector is too large to edit.');
 const tokens=d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)??[];
 if(d.replace(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[\s,]/g,''))throw Error('Unsupported vector data.');
 const out=[];let i=0,command,point=[0,0],start=[0,0],previous;
 while(i<tokens.length){
  if(/^[a-zA-Z]$/.test(tokens[i]))command=tokens[i++];
  const kind=command?.toUpperCase(),relative=command!==kind,count=sizes[kind];if(count===undefined)throw Error('Invalid vector command.');
  if(kind==='Z'){out.push({cmd:'Z',v:[]});point=[...start];previous='Z';command=null;continue;}
  if(i+count>tokens.length)throw Error('Incomplete vector command.');
  const v=tokens.slice(i,i+count).map(Number);if(!v.every(Number.isFinite))throw Error('Invalid vector coordinate.');i+=count;
  let cmd=kind,values;
  const xy=(x,y)=>[x+(relative?point[0]:0),y+(relative?point[1]:0)];
  if(kind==='H'){cmd='L';values=[v[0]+(relative?point[0]:0),point[1]];}
  else if(kind==='V'){cmd='L';values=[point[0],v[0]+(relative?point[1]:0)];}
  else if(kind==='A'){if(![0,1].includes(v[3])||![0,1].includes(v[4]))throw Error('Invalid arc flags.');values=[Math.abs(v[0]),Math.abs(v[1]),v[2],v[3],v[4],...xy(v[5],v[6])];}
  else{values=[];for(let n=0;n<v.length;n+=2)values.push(...xy(v[n],v[n+1]));
   if(kind==='S'){cmd='C';const last=out.at(-1);const handle=['C','S'].includes(previous)&&last?.cmd==='C'?last.v.slice(2,4):point;values=[2*point[0]-handle[0],2*point[1]-handle[1],...values];}
   if(kind==='T'){cmd='Q';const last=out.at(-1);const handle=['Q','T'].includes(previous)&&last?.cmd==='Q'?last.v.slice(0,2):point;values=[2*point[0]-handle[0],2*point[1]-handle[1],...values];}
  }
  if(!out.length&&cmd!=='M')throw Error('A path must begin with a point.');
  out.push({cmd,v:values});point=end(out.at(-1));if(cmd==='M')start=[...point];previous=kind;
  if(kind==='M')command=relative?'l':'L';if(out.length>20000)throw Error('Edit a smaller vector.');
 }
 return out;
}
export const writeVectorPath=commands=>commands.map(c=>c.cmd+c.v.map(v=>Math.round(v*1e6)/1e6).join(' ')).join(' ');
export function vectorAnchors(commands){
 const anchors=[];let subpath=[];
 for(let i=0;i<commands.length;i++){
  const c=commands[i];if(c.cmd==='Z'){
   if(subpath.length>1){const first=subpath[0],last=subpath.at(-1);if(same(first.point,last.point)){first.refs.push(...last.refs);first.handles.push(...last.handles.filter(h=>h.kind==='incoming'));anchors.splice(anchors.indexOf(last),1);}}
   subpath=[];continue;
  }
  if(c.cmd==='M')subpath=[];
  const node={index:i,point:end(c),refs:[i],handles:[],subpath:commands.findLastIndex((v,j)=>j<=i&&v.cmd==='M')};
  if(c.cmd==='C')node.handles.push({command:i,offset:2,kind:'incoming',point:c.v.slice(2,4)});
  if(c.cmd==='Q')node.handles.push({command:i,offset:0,kind:'incoming',point:c.v.slice(0,2)});
  const next=commands[i+1];if(next?.cmd==='C'||next?.cmd==='Q')node.handles.push({command:i+1,offset:0,kind:'outgoing',point:next.v.slice(0,2)});
  anchors.push(node);subpath.push(node);
 }
 return anchors;
}
export function moveVectorAnchor(commands,index,point){
 const result=copy(commands),node=vectorAnchors(commands).find(n=>n.index===index);if(!node)throw Error('Choose a vector point.');
 const dx=point[0]-node.point[0],dy=point[1]-node.point[1];
 for(const ref of node.refs){const c=result[ref];c.v[c.v.length-2]+=dx;c.v[c.v.length-1]+=dy;}
 for(const h of node.handles){result[h.command].v[h.offset]+=dx;result[h.command].v[h.offset+1]+=dy;}
 return result;
}
export function moveVectorHandle(commands,command,offset,point,{linked=false}={}){
 const result=copy(commands);if(!['C','Q'].includes(result[command]?.cmd))throw Error('Choose a curve handle.');
 result[command].v.splice(offset,2,...point);
 if(linked){const node=vectorAnchors(commands).find(n=>n.handles.some(h=>h.command===command&&h.offset===offset)),opposite=node?.handles.find(h=>h.command!==command||h.offset!==offset);if(opposite){const dx=point[0]-node.point[0],dy=point[1]-node.point[1],distance=Math.hypot(dx,dy);if(distance>1e-8){const length=Math.hypot(opposite.point[0]-node.point[0],opposite.point[1]-node.point[1])||distance;result[opposite.command].v.splice(opposite.offset,2,node.point[0]-dx*length/distance,node.point[1]-dy*length/distance);}}}
 return result;
}

const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
export function vectorSegments(commands){let point=[0,0],start=[0,0];return commands.flatMap((c,index)=>{if(c.cmd==='M'){point=end(c);start=point;return [];}const from=point,to=c.cmd==='Z'?start:end(c);point=to;return [{index,from,to,cmd:c.cmd,v:c.v}];});}
export function segmentPoint(segment,t){const {from:a,to:b,cmd,v}=segment;if(cmd==='C'){const p=mix(a,v.slice(0,2),t),q=mix(v.slice(0,2),v.slice(2,4),t),r=mix(v.slice(2,4),b,t);return mix(mix(p,q,t),mix(q,r,t),t);}if(cmd==='Q')return mix(mix(a,v.slice(0,2),t),mix(v.slice(0,2),b,t),t);if(cmd==='A')return arcPoint(a,v,t);return mix(a,b,t);}
function arcPoint(from,v,t){
 const [rx0,ry0,angle,large,sweep,x,y]=v;if(!rx0||!ry0||same(from,[x,y]))return mix(from,[x,y],t);
 const phi=angle*Math.PI/180,co=Math.cos(phi),si=Math.sin(phi),dx=(from[0]-x)/2,dy=(from[1]-y)/2,xp=co*dx+si*dy,yp=-si*dx+co*dy;
 let rx=rx0,ry=ry0;const lambda=xp*xp/(rx*rx)+yp*yp/(ry*ry);if(lambda>1){rx*=Math.sqrt(lambda);ry*=Math.sqrt(lambda);}
 const factor=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp)/(rx*rx*yp*yp+ry*ry*xp*xp))),cxp=factor*rx*yp/ry,cyp=-factor*ry*xp/rx,cx=co*cxp-si*cyp+(from[0]+x)/2,cy=si*cxp+co*cyp+(from[1]+y)/2;
 const first=Math.atan2((yp-cyp)/ry,(xp-cxp)/rx);let delta=Math.atan2((-yp-cyp)/ry,(-xp-cxp)/rx)-first;if(sweep&&delta<0)delta+=2*Math.PI;if(!sweep&&delta>0)delta-=2*Math.PI;const theta=first+delta*t;return [cx+co*rx*Math.cos(theta)-si*ry*Math.sin(theta),cy+si*rx*Math.cos(theta)+co*ry*Math.sin(theta)];
}
export function splitVectorSegment(commands,index,t=.5){
 const segment=vectorSegments(commands).find(s=>s.index===index);if(!segment)throw Error('Choose a segment.');t=Math.max(.001,Math.min(.999,t));const result=copy(commands),{from:a,to:b,cmd,v}=segment;let parts;
 if(cmd==='C'){const p=mix(a,v.slice(0,2),t),q=mix(v.slice(0,2),v.slice(2,4),t),r=mix(v.slice(2,4),b,t),u=mix(p,q,t),w=mix(q,r,t),s=mix(u,w,t);parts=[{cmd:'C',v:[...p,...u,...s]},{cmd:'C',v:[...w,...r,...b]}];}
 else if(cmd==='Q'){const p=mix(a,v.slice(0,2),t),q=mix(v.slice(0,2),b,t),s=mix(p,q,t);parts=[{cmd:'Q',v:[...p,...s]},{cmd:'Q',v:[...q,...b]}];}
 else if(cmd==='A'){const p=segmentPoint(segment,t),phi=v[2]*Math.PI/180,dx=(a[0]-b[0])/2,dy=(a[1]-b[1])/2,xp=Math.cos(phi)*dx+Math.sin(phi)*dy,yp=-Math.sin(phi)*dx+Math.cos(phi)*dy,factor=Math.max(1,Math.hypot(xp/v[0],yp/v[1])),radii=[v[0]*factor,v[1]*factor,v[2]];if(!Number.isFinite(factor)){result.splice(index,1,{cmd:'L',v:p},{cmd:'L',v:[...b]});return result;}parts=[{cmd:'A',v:[...radii,0,v[4],...p]},{cmd:'A',v:[...radii,0,v[4],...b]}]; // Arc flags below are derived from the actual angular spans.
  // Preserve long arcs by calculating which split side passes the original midpoint.
  const middle=segmentPoint(segment,t/2),test=arcPoint(a,parts[0].v,.5);if(!same(middle,test))parts[0].v[3]=1;
  const other=segmentPoint(segment,t+(1-t)/2),test2=arcPoint(p,parts[1].v,.5);if(!same(other,test2))parts[1].v[3]=1;
 }
 else{parts=[{cmd:'L',v:mix(a,b,t)},cmd==='Z'?{cmd:'Z',v:[]}:{cmd:'L',v:[...b]}];}
 result.splice(index,1,...parts);return result;
}
export function deleteVectorAnchor(commands,index){
 const nodes=vectorAnchors(commands),node=nodes.find(n=>n.index===index);if(!node)return copy(commands);if(nodes.filter(n=>n.subpath===node.subpath).length<=2)return copy(commands);
 const result=copy(commands);if(result[index].cmd==='M'){
  const next=index+1,p=end(result[next]);result[next]={cmd:'M',v:[...p]};
  if(node.refs.length>1){const close=result[node.refs[1]];close.v.splice(close.v.length-2,2,...p);}
 }
 for(const ref of [...node.refs].filter(i=>i===index||commands[index].cmd!=='M').sort((a,b)=>b-a))result.splice(ref,1);
 return result;
}
export function cornerVectorAnchor(commands,index){const result=copy(commands),node=vectorAnchors(commands).find(n=>n.index===index);if(!node)return result;for(const h of node.handles)result[h.command].v.splice(h.offset,2,...node.point);return result;}
export function smoothVectorAnchor(commands,index){
 const result=copy(commands),nodes=vectorAnchors(result),node=nodes.find(n=>n.index===index);if(!node)return result;
 const samePath=nodes.filter(n=>n.subpath===node.subpath),local=samePath.indexOf(node),endIndex=commands.findIndex((c,i)=>i>node.subpath&&(c.cmd==='Z'||c.cmd==='M')),closed=endIndex>=0&&commands[endIndex].cmd==='Z';
 const before=local>0?samePath[local-1].point:closed?samePath.at(-1).point:node.point,after=local<samePath.length-1?samePath[local+1].point:closed?samePath[0].point:node.point;
 const len=Math.hypot(after[0]-before[0],after[1]-before[1])||1,unit=[(after[0]-before[0])/len,(after[1]-before[1])/len];
 const incoming=node.refs.find(i=>commands[i].cmd!=='M')??(local===0&&closed?endIndex:null),outgoing=local<samePath.length-1?node.index+1:closed?endIndex:null;
 for(const ci of new Set([incoming,outgoing])){
  const seg=vectorSegments(result).find(s=>s.index===ci);if(!seg)continue;
  if(seg.cmd==='L'||seg.cmd==='Z'){
   const c={cmd:'C',v:[...mix(seg.from,seg.to,1/3),...mix(seg.from,seg.to,2/3),...seg.to]};
   if(seg.cmd==='Z')result.splice(ci,0,c);else result[ci]=c;
  }else if(seg.cmd==='Q')result[ci]={cmd:'C',v:[...mix(seg.from,seg.v.slice(0,2),2/3),...mix(seg.to,seg.v.slice(0,2),2/3),...seg.to]};
 }
 const updated=vectorAnchors(result).find(n=>n.index===index);
 for(const handle of updated.handles){const distance=Math.hypot(...(handle.kind==='incoming'?before:after).map((v,i)=>v-updated.point[i]))/3,sign=handle.kind==='incoming'?-1:1;result[handle.command].v.splice(handle.offset,2,updated.point[0]+unit[0]*distance*sign,updated.point[1]+unit[1]*distance*sign);}
 return result;
}
/** Exact affine mapping used by the renderer, including reflection, skew and SVG origins. */
export function vectorMatrix(layer){
 const [W,H]=layer.pathSize??[layer.w,layer.h],sx=layer.w/W,sy=layer.h/H,[a,b,c,d]=layer.basis??[1,0,0,1],fx=layer.flipX?-1:1,fy=layer.flipY?-1:1,r=(layer.rotate??0)*Math.PI/180,co=Math.cos(r),si=Math.sin(r);
 const A=(co*a-si*b)*fx,B=(si*a+co*b)*fx,C=(co*c-si*d)*fy,D=(si*c+co*d)*fy,[ox,oy]=layer.pathOffset??[0,0];
 return [A*sx,B*sx,C*sy,D*sy,layer.cx-A*(layer.w/2+ox*sx)-C*(layer.h/2+oy*sy),layer.cy-B*(layer.w/2+ox*sx)-D*(layer.h/2+oy*sy)];
}
export function vectorToScene(layer,p){const [a,b,c,d,e,f]=vectorMatrix(layer);return [a*p[0]+c*p[1]+e,b*p[0]+d*p[1]+f];}
export function sceneToVector(layer,p){const [a,b,c,d,e,f]=vectorMatrix(layer),det=a*d-b*c;if(Math.abs(det)<1e-12)throw Error('This vector has a collapsed transform.');return [(d*(p[0]-e)-c*(p[1]-f))/det,(-b*(p[0]-e)+a*(p[1]-f))/det];}

/** Bend one segment by moving a point on its curve; both end anchors stay fixed. */
export function bendVectorSegment(commands,index,t,delta){
 const result=copy(commands),seg=vectorSegments(commands).find(s=>s.index===index);if(!seg||seg.cmd==='A')return result;
 t=Math.max(.05,Math.min(.95,t));let a,b;
 if(seg.cmd==='C'){a=seg.v.slice(0,2);b=seg.v.slice(2,4);}
 else if(seg.cmd==='Q'){a=mix(seg.from,seg.v.slice(0,2),2/3);b=mix(seg.to,seg.v.slice(0,2),2/3);}
 else{a=mix(seg.from,seg.to,1/3);b=mix(seg.from,seg.to,2/3);}
 const u=3*(1-t)**2*t,v=3*(1-t)*t*t,n=u*u+v*v;
 const curve={cmd:'C',v:[a[0]+delta[0]*u/n,a[1]+delta[1]*u/n,b[0]+delta[0]*v/n,b[1]+delta[1]*v/n,...seg.to]};
 if(seg.cmd==='Z')result.splice(index,0,curve);else result[index]=curve;
 return result;
}

/** Tight editing bounds keep resize/rotate handles around the edited path. */
export function reframeVectorPatch(layer,paths){
 if(layer.gradient||layer.paints?.some(p=>p.type==='image'))return {paths};
 const points=[];
 for(const path of paths){const commands=parseVectorPath(path.d);for(const c of commands)if(c.cmd==='M')points.push(c.v);for(const seg of vectorSegments(commands)){
  points.push(seg.from,seg.to);const times=[];
  if(seg.cmd==='C')for(let axis=0;axis<2;axis++){const p=seg.from[axis],q=seg.v[axis],r=seg.v[axis+2],s=seg.to[axis],a=-p+3*q-3*r+s,b=2*(p-2*q+r),c=q-p;if(Math.abs(a)<1e-12){if(Math.abs(b)>1e-12)times.push(-c/b);}else{const d=b*b-4*a*c;if(d>=0)times.push((-b+Math.sqrt(d))/(2*a),(-b-Math.sqrt(d))/(2*a));}}
  else if(seg.cmd==='Q')for(let axis=0;axis<2;axis++){const a=seg.from[axis]-2*seg.v[axis]+seg.to[axis];if(Math.abs(a)>1e-12)times.push((seg.from[axis]-seg.v[axis])/a);}
  else if(seg.cmd==='A')for(let i=1;i<128;i++)times.push(i/128);
  for(const t of times)if(t>0&&t<1)points.push(segmentPoint(seg,t));
 }}
 if(!points.length)return {paths};
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),ox=Math.min(...xs),oy=Math.min(...ys),W=Math.max(1,Math.max(...xs)-ox),H=Math.max(1,Math.max(...ys)-oy),[oldW,oldH]=layer.pathSize??[layer.w,layer.h],[oldX,oldY]=layer.pathOffset??[0,0],centre=vectorToScene(layer,[ox+W/2,oy+H/2]);
 const patch={paths,cx:centre[0],cy:centre[1],w:W*layer.w/oldW,h:H*layer.h/oldH,pathSize:[W,H],pathOffset:[ox,oy]};
 if(layer.paints)patch.paints=layer.paints.map(p=>p.handles?{...p,handles:p.handles.map(h=>[(h[0]*oldW+oldX-ox)/W,(h[1]*oldH+oldY-oy)/H])}:structuredClone(p));
 return patch;
}
