import {h,toast} from './helpers.js';
import {parseVectorPath,writeVectorPath,vectorAnchors,vectorSegments,segmentPoint,moveVectorAnchor,moveVectorHandle,splitVectorSegment,deleteVectorAnchor,cornerVectorAnchor,smoothVectorAnchor,vectorToScene,sceneToVector,vectorMatrix,bendVectorSegment,reframeVectorPatch} from '../vector-path.js';
import {shapePaints,editShapePaint} from '../shape-ops.js';
const svgElement=(tag,attrs)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};
export function createVectorEditor(ed,{scale,point,redraw}){
 let mode=null,drag=null,pointer=null;
 function updateVectorCursor(){
  let cursor='point';
  if(layer()&&ed.overlay.isConnected&&mode.paintIndex===null&&pointer){
   const hit=document.elementFromPoint(pointer.x,pointer.y);
   const kind=drag?.kind??(ed.overlay.contains(hit)?hit?.closest('[data-vector-kind]')?.dataset.vectorKind:null);
   if(kind==='handle')cursor='handle';
   if(kind==='anchor')cursor=mode.option||mode.pointTool==='remove'?'remove-point':'point';
   if(kind==='segment')cursor=!mode.option&&(mode.shift||mode.pointTool==='add')?'add-point':'bend';
  }else if(layer()&&mode.paintIndex!==null)cursor='gradient';
  ed.overlay.dataset.vectorCursor=cursor;
 }
 window.addEventListener('pointermove',e=>{pointer={x:e.clientX,y:e.clientY};updateVectorCursor();},{capture:true,passive:true});
 window.addEventListener('pointerout',e=>{if(!e.relatedTarget){pointer=null;updateVectorCursor();}},{passive:true});
 window.addEventListener('scroll',()=>updateVectorCursor(),{capture:true,passive:true});
 const context=()=>`${ed.scene?.slideId}|${ed.scene?.deviceId}|${ed.scene?.localeId}`;
 const layer=()=>mode&&ed.selectedId===mode.id&&mode.context===context()?ed.layerById(mode.id):null;
 const consume=e=>{e.preventDefault();e.stopPropagation();};
 const focus=()=>{ed.overlay.tabIndex=0;ed.overlay.focus({preventScroll:true});};
 function exit(){mode=null;drag=null;redraw();ed.rebuildInspector();ed.refresh({immediate:true});}
 function enter(target,paintIndex=null,{bend=false}={}){
  if(mode?.id===target.id&&mode.paintIndex===paintIndex&&mode.bend===bend){exit();return;}
  if(target.locked||target._decorationBase){toast('Select an unlocked vector on its own screen to edit points.');return;}
  try{if(paintIndex===null)for(const p of target.paths??[])parseVectorPath(p.d);sceneToVector(target,[target.cx,target.cy]);}catch(error){toast(error.message,{error:true});return;}
  mode={id:target.id,context:context(),paintIndex,bend,path:0,node:null,linked:true,pointTool:"select",option:false,shift:false};drag=null;redraw();ed.rebuildInspector();ed.refresh({immediate:true});focus();
 }
 const pathsPatch=(target,pathIndex,commands)=>{const paths=structuredClone(target.paths);paths[pathIndex].d=writeVectorPath(commands);return {...reframeVectorPatch(target,paths),cornerSourcePaths:undefined,cornerRadii:undefined};};
 function act(operation){const target=layer();if(!target||mode.paintIndex!==null||mode.node===null)return;const commands=parseVectorPath(target.paths[mode.path].d),updated=operation(commands,mode.node);if(writeVectorPath(commands)===writeVectorPath(updated))return;ed.startEdit();ed.applyVector(target,pathsPatch(target,mode.path,updated));ed.finishEdit();if(operation===smoothVectorAnchor)mode.linked=true;redraw();focus();}
 function remove(){act(deleteVectorAnchor);mode.node=null;redraw();}
 function cursors({option=mode?.option,shift=mode?.shift}={}){
  if(mode){mode.option=Boolean(option);mode.shift=Boolean(shift);}
  ed.overlay.classList.toggle('remove-point-modifier',Boolean(mode?.paintIndex===null&&option));
  ed.overlay.classList.toggle('add-point-modifier',Boolean(mode?.paintIndex===null&&shift&&!option));
  ed.overlay.dataset.pointTool=mode?.paintIndex===null?mode.pointTool:'select';
  updateVectorCursor();
 }
 window.addEventListener('keydown',e=>{if(layer()&&['Alt','Shift'].includes(e.key))cursors({option:e.key==='Alt'||e.altKey,shift:e.key==='Shift'||e.shiftKey});});
 window.addEventListener('keyup',e=>{if(['Alt','Shift'].includes(e.key))cursors({option:e.key!=='Alt'&&e.altKey,shift:e.key!=='Shift'&&e.shiftKey});});
 window.addEventListener('blur',()=>{pointer=null;cursors({option:false,shift:false});});
 function choosePointTool(tool){mode.pointTool=tool;redraw();focus();}
 function toolbar(){
  return h('div',{class:'vector-toolbar',role:'toolbar','aria-label':mode.paintIndex===null?'Vector points':'Gradient handles'},h('strong',null,mode.paintIndex===null?(mode.bend?'Bend path':'Edit points'):'Edit gradient'),...(mode.paintIndex===null?[...['select','add','remove'].map((tool,i)=>h('button',{class:'btn small','aria-pressed':String(mode.pointTool===tool),title:['Select points (A)','Add point (+)','Remove point (−)'][i],onClick:()=>choosePointTool(tool)},['Select points','+ Add point','− Remove point'][i])),h('button',{class:'btn small','aria-pressed':String(mode.bend),onClick:()=>{mode.bend=!mode.bend;redraw();}},'Bend segments'),h('button',{class:'btn small',disabled:mode.node===null,onClick:()=>act(cornerVectorAnchor)},'Corner'),h('button',{class:'btn small',disabled:mode.node===null,onClick:()=>act(smoothVectorAnchor)},'Smooth'),h('button',{class:'btn small',disabled:mode.node===null,onClick:remove},'Delete point'),h('label',{class:'vector-link'},h('input',{type:'checkbox',checked:mode.linked,'aria-label':'Link curve handles',onChange:e=>{mode.linked=e.target.checked;} }),h('span',null,'Link handles'))]:[]),h('button',{class:'btn small primary',onClick:exit},'Done'));
 }
 function button(position,label,data,selected,handle=false){
  const [x,y]=vectorToScene(layer(),position),f=scale();
  return h('button',{type:'button',class:`vector-node${handle?' curve-handle':''}${selected?' active':''}`,'aria-label':label,'aria-pressed':String(Boolean(selected)),title:label,dataset:data,style:{left:`${x*f}px`,top:`${y*f}px`}},h('span'));
 }
 function render(){
  cursors();
  const target=layer();if(!target){mode=null;drag=null;ed.vectorToolbar.replaceChildren();return false;}
  const f=scale(),svg=svgElement('svg',{class:'vector-lines',width:'100%',height:'100%',viewBox:`0 0 ${ed.scene.W} ${ed.scene.H}`,'aria-hidden':'true'});
  ed.overlay.append(svg);ed.overlay.classList.add('editing-vector');
  const line=(a,b)=>{const p=vectorToScene(target,a),q=vectorToScene(target,b);svg.append(svgElement('line',{x1:p[0],y1:p[1],x2:q[0],y2:q[1]}));};
  if(mode.paintIndex!==null){
   const paint=shapePaints(target)[mode.paintIndex];if(!paint||!['linear','radial'].includes(paint.type)){exit();return false;}
   const [W,H]=target.pathSize??[target.w,target.h],[ox,oy]=target.pathOffset??[0,0],handles=paint.handles??[[0,.5],[1,.5],[0,1.5]],points=handles.map(p=>[p[0]*W+ox,p[1]*H+oy]);
   line(points[0],points[1]);if(paint.type==='radial')line(points[0],points[2]);
   for(const [i,p]of points.entries())if(i<2||paint.type==='radial')ed.overlay.append(button(p,['Gradient start','Gradient end','Gradient width'][i],{vectorKind:'gradient',handleIndex:i},false,true));
  }else{
   for(const [pathIndex,path]of target.paths.entries()){
    svg.append(svgElement('path',{d:path.d,transform:`matrix(${vectorMatrix(target).join(' ')})`,class:'vector-outline'}));
    const commands=parseVectorPath(path.d);
    for(const segment of vectorSegments(commands).filter(s=>s.cmd!=='A')){const d=`M${segment.from.join(' ')} `+(segment.cmd==='Z'?`L${segment.to.join(' ')}`:writeVectorPath([commands[segment.index]]));svg.append(svgElement('path',{d,transform:`matrix(${vectorMatrix(target).join(' ')})`,class:'vector-segment-hit','data-vector-kind':'segment','data-path-index':pathIndex,'data-command':segment.index}));}
    const nodes=vectorAnchors(commands),selected=pathIndex===mode.path?nodes.find(n=>n.index===mode.node):null;
    for(const handle of selected?.handles??[]){line(selected.point,handle.point);ed.overlay.append(button(handle.point,`${handle.kind==='incoming'?'Incoming':'Outgoing'} curve handle`,{vectorKind:'handle',pathIndex,command:handle.command,offset:handle.offset},false,true));}
    for(const [i,node]of nodes.entries())ed.overlay.append(button(node.point,`Point ${i+1} · path ${pathIndex+1}`,{vectorKind:'anchor',pathIndex,command:node.index},pathIndex===mode.path&&mode.node===node.index));
   }
  }
  const controls=toolbar();
  if(mode.paintIndex===null)controls.append(h('span',{class:'vector-toolbar-hint'},'Shift-click segment: add (+) · ⌥ / Alt-click point: remove (−) · + / −: choose tool · Delete: remove selected'));
  ed.vectorToolbar.replaceChildren(controls);ed.vectorToolbar.hidden=false;updateVectorCursor();return true;
 }
 function down(e){
  if(!layer()||e.button!==0)return false;
  if(e.target.closest('.vector-toolbar'))return true;
  consume(e);focus();const control=e.target.closest('[data-vector-kind]');
  if(!control){mode.node=null;redraw();return true;}
  const target=layer(),data=control.dataset;
  if(data.vectorKind==='anchor'){mode.path=Number(data.pathIndex);mode.node=Number(data.command);const n=vectorAnchors(parseVectorPath(target.paths[mode.path].d)).find(n=>n.index===mode.node);if(n?.handles.length===2){const [a,b]=n.handles.map(h=>[h.point[0]-n.point[0],h.point[1]-n.point[1]]),length=Math.hypot(...a)*Math.hypot(...b);mode.linked=length<1e-8||Math.abs(a[0]*b[1]-a[1]*b[0])/length<.001&&a[0]*b[0]+a[1]*b[1]<=0;}}
  let t=.5;if(data.vectorKind==='segment'){mode.path=Number(data.pathIndex);mode.node=null;const segment=vectorSegments(parseVectorPath(target.paths[Number(data.pathIndex)].d)).find(s=>s.index===Number(data.command)),p=point(e);let best=Infinity;for(let k=4;k<=76;k++){const q=vectorToScene(target,segmentPoint(segment,k/80)),d=Math.hypot(q[0]-p.x,q[1]-p.y);if(d<best){best=d;t=k/80;}}}
  drag={t,pointAction:mode.pointTool,editPoint:e.altKey,addPoint:e.shiftKey&&!e.altKey,breakLinked:e.altKey,target:structuredClone(target),kind:data.vectorKind,path:Number(data.pathIndex),command:Number(data.command),offset:Number(data.offset),handle:Number(data.handleIndex),start:point(e),pointerId:e.pointerId,active:false};
  ed.overlay.setPointerCapture(e.pointerId);redraw();return true;
 }
 function move(e){
  if(!layer())return false;cursors({option:e.altKey,shift:e.shiftKey});if(!drag)return true;consume(e);
  const p=point(e);if(drag.pointAction!=="select"){if(Math.hypot(p.x-drag.start.x,p.y-drag.start.y)*scale()>=3)drag.moved=true;return true;}if(!drag.active){if(Math.hypot(p.x-drag.start.x,p.y-drag.start.y)*scale()<3)return true;ed.startEdit();drag.active=true;}
  if(e.altKey)drag.breakLinked=true;
  const source=drag.target;let local=sceneToVector(source,[p.x,p.y]);
  if(drag.kind==='gradient'){
   const paint=shapePaints(source)[mode.paintIndex],handles=structuredClone(paint.handles??[[0,.5],[1,.5],[0,1.5]]),[W,H]=source.pathSize??[source.w,source.h],[ox,oy]=source.pathOffset??[0,0];
   const next=[(local[0]-ox)/W,(local[1]-oy)/H];if(drag.handle===0){const dx=next[0]-handles[0][0],dy=next[1]-handles[0][1];for(let i=1;i<handles.length;i++){handles[i][0]+=dx;handles[i][1]+=dy;}}
   if(drag.handle===1&&paint.type==='linear'&&handles[2]){const a=handles[0],old=handles[1],delta=Math.atan2((next[1]-a[1])*H,(next[0]-a[0])*W)-Math.atan2((old[1]-a[1])*H,(old[0]-a[0])*W),x=(handles[2][0]-a[0])*W,y=(handles[2][1]-a[1])*H;handles[2]=[a[0]+(x*Math.cos(delta)-y*Math.sin(delta))/W,a[1]+(x*Math.sin(delta)+y*Math.cos(delta))/H];}
   handles[drag.handle]=next;ed.applyVector(layer(),editShapePaint(source,mode.paintIndex,{handles}));
  }else{
   const commands=parseVectorPath(source.paths[drag.path].d);
   if(e.shiftKey){const start=sceneToVector(source,[drag.start.x,drag.start.y]);const d=[local[0]-start[0],local[1]-start[1]];if(Math.abs(d[0])>Math.abs(d[1]))local[1]=start[1];else local[0]=start[0];}
   const start=sceneToVector(source,[drag.start.x,drag.start.y]);
   const updated=drag.kind==='segment'?bendVectorSegment(commands,drag.command,drag.t,[local[0]-start[0],local[1]-start[1]]):drag.kind==='anchor'?moveVectorAnchor(commands,drag.command,local):moveVectorHandle(commands,drag.command,drag.offset,local,{linked:mode.linked&&!drag.breakLinked&&!e.altKey});ed.applyVector(layer(),pathsPatch(source,drag.path,updated));
  }
  return true;
 }
 function insert(target,pathIndex,commands,command,t){
  const updated=splitVectorSegment(commands,command,t);
  if(writeVectorPath(updated)===writeVectorPath(commands))return;
  ed.startEdit();mode.path=pathIndex;mode.node=command;ed.applyVector(target,pathsPatch(target,pathIndex,updated));ed.finishEdit();redraw();focus();
 }
 function up(e){
  if(!layer())return false;if(!drag)return true;consume(e);
  const finished=drag;drag=null;
  try{ed.overlay.releasePointerCapture(e.pointerId);}catch{}
  if(finished.active){if(finished.breakLinked)mode.linked=false;if(e.type==='pointercancel')ed.cancelEdit();else{ed.finishEdit();ed.refresh({immediate:true,inspector:true});}}
  else if(e.type!=='pointercancel'&&!finished.moved&&mode.paintIndex===null){
   const option=finished.editPoint||e.altKey;
   if(finished.kind==='anchor'&&(option||finished.pointAction==='remove'))remove();
   else if(finished.kind==='segment'&&(!option&&(finished.addPoint||e.shiftKey||finished.pointAction==='add')))insert(layer(),finished.path,parseVectorPath(finished.target.paths[finished.path].d),finished.command,finished.t);
  }
  redraw();return true;
 }
 function double(e){
  const target=layer();if(!target||mode.paintIndex!==null)return false;if(e.target.closest('button'))return true;
  const p=point(e);let best=null;
  for(const [pathIndex,path]of target.paths.entries()){const commands=parseVectorPath(path.d);for(const segment of vectorSegments(commands)){for(let k=1;k<80;k++){const t=k/80,q=vectorToScene(target,segmentPoint(segment,t)),distance=Math.hypot(q[0]-p.x,q[1]-p.y);if(!best||distance<best.distance)best={pathIndex,commands,segment,t,distance};}}}
  if(best&&best.distance*scale()<14){consume(e);insert(target,best.pathIndex,best.commands,best.segment.index,best.t);}return true;
 }
 function key(e){
  if(!layer())return false;if(e.metaKey||e.ctrlKey)return false;
  if(mode.paintIndex===null&&!drag&&['+','=','-','a','A'].includes(e.key)){consume(e);choosePointTool(e.key==='-'?'remove':['a','A'].includes(e.key)?'select':'add');return true;}
  if(e.key==='Escape'&&!drag){consume(e);exit();return true;}
  if(mode.paintIndex!==null){if(['Delete','Backspace', 'ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){consume(e);return true;}return false;}
  if(['Delete','Backspace'].includes(e.key)){consume(e);remove();return true;}
  const arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if(arrows[e.key]&&mode.node!==null){consume(e);const target=layer(),commands=parseVectorPath(target.paths[mode.path].d),node=vectorAnchors(commands).find(n=>n.index===mode.node);if(!node)return true;const p=vectorToScene(target,node.point),[dx,dy]=arrows[e.key],step=e.shiftKey?10:1;ed.startEdit(`vector-nudge:${mode.id}:${mode.path}:${mode.node}`);ed.applyVector(target,pathsPatch(target,mode.path,moveVectorAnchor(commands,mode.node,sceneToVector(target,[p[0]+dx*step,p[1]+dy*step]))));ed.finishEdit();return true;}
  if(e.key==='Enter'){consume(e);exit();return true;}return false;
 }
 return {render,down,move,up,double,key,enter,exit,get active(){return Boolean(layer());},get dragging(){return Boolean(drag?.active);},cancelDrag(){drag=null;},isBending:id=>mode?.id===id&&mode.paintIndex===null&&mode.bend,isEditing:id=>mode?.id===id&&mode.paintIndex===null,isGradient:(id,index)=>mode?.id===id&&mode.paintIndex===index};
}
