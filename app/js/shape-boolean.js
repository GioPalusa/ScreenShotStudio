// Curve geometry stays native path data. Paper.js is injected by the host/UI.
import {parseVectorPath,vectorMatrix,reframeVectorPatch} from './vector-path.js';
import {copyAppearance,appearancePatch} from './layer-ops.js';
import {shapePaints} from './shape-ops.js';
export function shapePathData(layer){
 if(layer.shape==='path')return layer.paths??[];
 const w=layer.w,h=layer.h;
 if(layer.shape==='ellipse')return [{d:`M0 ${h/2}A${w/2} ${h/2} 0 1 0 ${w} ${h/2}A${w/2} ${h/2} 0 1 0 0 ${h/2}Z`,rule:'nonzero'}];
 const raw=layer.radii??Array(4).fill(layer.radius??0),r=Array.from({length:4},(_,i)=>Math.max(0,raw[i]??raw[0]??0));
 // A zero sum imposes no radius restriction.
 const factor=Math.min(1,...[[w,r[0]+r[1]],[w,r[2]+r[3]],[h,r[0]+r[3]],[h,r[1]+r[2]]].filter(([,sum])=>sum>0).map(([size,sum])=>size/sum));r.forEach((v,i)=>r[i]=v*factor);
 const arc=(radius,x,y)=>radius?`A${radius} ${radius} 0 0 1 ${x} ${y}`:`L${x} ${y}`;
 return [{d:`M${r[0]} 0L${w-r[1]} 0${arc(r[1],w,r[1])}L${w} ${h-r[2]}${arc(r[2],w-r[2],h)}L${r[3]} ${h}${arc(r[3],0,h-r[3])}L0 ${r[0]}${arc(r[0],r[0],0)}Z`,rule:'nonzero'}];
}
export function canCombineShapes(layers){
 if(layers.length<2||layers.length>100||layers.some(l=>l.type!=='shape'||l.locked||l.maskMembership))return false;
 try{return layers.every(l=>shapePathData(l).length&&shapePathData(l).every(p=>{if(p.d.length>200000)return false;let closed=true;for(const c of parseVectorPath(p.d)){if(c.cmd==='M'){if(!closed)return false;closed=false;}if(c.cmd==='Z')closed=true;}return closed;}));}catch{return false;}
}
export function booleanShape(layers,operation,paper){
 if(!['unite','subtract','intersect','exclude'].includes(operation)||!canCombineShapes(layers))throw Error('Select two or more closed shapes to combine.');
 const base=layers[0],scope=new paper.PaperScope();new scope.Project();
 try{
  const items=layers.map(layer=>{let item;for(const p of shapePathData(layer)){const piece=new scope.CompoundPath({pathData:p.d,insert:false});piece.fillRule=p.rule??'nonzero';item=item?item.unite(piece,{insert:false}):piece;}item.transform(new scope.Matrix(...vectorMatrix(layer.shape==='path'?layer:{...layer,pathSize:[layer.w,layer.h],pathOffset:[0,0]})));return item;});
  let result=items[0];for(const item of items.slice(1))result=result[operation](item,{insert:false});
  if(result.isEmpty()||Math.abs(result.area)<1e-8)throw Error('No shape remains from this operation.');
  const basis=base.shape==='path'?base:{...base,pathSize:[base.w,base.h],pathOffset:[0,0]};result.transform(new scope.Matrix(...vectorMatrix(basis)).inverted());
  const paths=[{d:result.getPathData(null,8),rule:'nonzero'}],geometry=reframeVectorPatch({...basis,gradient:undefined,paints:[]},paths),[oldW,oldH]=basis.pathSize,[oldX,oldY]=basis.pathOffset??[0,0],[x,y]=geometry.pathOffset,[W,H]=geometry.pathSize;
  const paints=shapePaints(base).map(p=>{
   if(p.handles)return {...p,handles:p.handles.map(h=>[(h[0]*oldW+oldX-x)/W,(h[1]*oldH+oldY-y)/H])};
   if(p.type==='image'&&p.transform){const m=p.transform,a=W/oldW,d=H/oldH,tx=(x-oldX)/oldW,ty=(y-oldY)/oldH;return {...p,transform:[[m[0][0]*a,m[0][1]*d,m[0][0]*tx+m[0][1]*ty+m[0][2]],[m[1][0]*a,m[1][1]*d,m[1][0]*tx+m[1][1]*ty+m[1][2]]]};}
   return structuredClone(p);
  });
  return {type:'shape',shape:'path',name:({unite:'Union',subtract:'Subtract',intersect:'Intersect',exclude:'Exclude'})[operation],...appearancePatch({...base,...geometry,shape:'path'},copyAppearance(base)),...geometry,paints,gradient:undefined,radius:0,radii:undefined,rotate:base.rotate,basis:structuredClone(base.basis),flipX:base.flipX,flipY:base.flipY,compositing:structuredClone(base.compositing)};
 }finally{scope.project.remove();}
}
