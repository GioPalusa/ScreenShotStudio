import {parseVectorPath,writeVectorPath} from './vector-path.js';
const length=v=>Math.hypot(...v),sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b,s=1)=>a.map((v,i)=>v+b[i]*s),unit=v=>v.map(x=>x/length(v));
const clamp=(n,max)=>Math.max(0,Math.min(max,Number(n)||0));
function polygons(layer){
 const result=[];
 for(const [pathIndex,path]of (layer.cornerSourcePaths??layer.paths??[]).entries()){
  let commands;try{commands=parseVectorPath(path.d);}catch{continue;}
  let points=[],indices=[];
  for(const [index,c]of commands.entries()){
   if(c.cmd==='M'){points=[c.v];indices=[index];}
   else if(c.cmd==='L'&&points){points.push(c.v);indices.push(index);}
   else if(c.cmd==='Z'&&points){if(points.length>1&&length(sub(points[0],points.at(-1)))<1e-6){points.pop();indices.pop();}if(points.length>=3&&points.every((p,i)=>length(sub(p,points[(i+1)%points.length]))>1e-6))result.push({pathIndex,points,indices,start:indices[0],end:index});points=null;}
   else points=null;
  }
 }
 return result;
}
export function cornerControls(layer){
 if(layer?.type!=='shape')return [];
 if(layer.shape==='rect'){
  const max=Math.min(layer.w,layer.h)/2,r=layer.radii??Array(4).fill(layer.radius??0);
  return [[0,0],[layer.w,0],[layer.w,layer.h],[0,layer.h]].map((point,i)=>({key:String(i),point,direction:[[1,1],[-1,1],[-1,-1],[1,-1]][i].map(x=>x/Math.SQRT2),radius:clamp(r[i],max),max}));
 }
 if(layer.shape!=='path')return [];
 return polygons(layer).flatMap(({pathIndex,points,indices})=>points.flatMap((point,i)=>{
  const before=sub(points[(i+points.length-1)%points.length],point),after=sub(points[(i+1)%points.length],point);if(length(before)<1e-6||length(after)<1e-6)return [];
  const a=unit(before),b=unit(after),sum=add(a,b),theta=Math.acos(Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1])));if(length(sum)<1e-5||theta<1e-5)return [];
  const key=`${pathIndex}:${indices[i]}`,max=Math.min(length(before),length(after))/2*Math.tan(theta/2);
  return [{key,point,direction:unit(sum),radius:clamp(layer.cornerRadii?.[key],max),max}];
 }));
}
export function cornerRadiusPatch(layer,key,radius,{all=false}={}){
 const controls=cornerControls(layer),chosen=controls.find(c=>c.key===key);if(!chosen)return {};
 if(layer.shape==='rect'){const radii=controls.map(c=>all||c.key===key?clamp(radius,c.max):c.radius);return {radius:radii.every(v=>v===radii[0])?radii[0]:0,radii};}
 const cornerRadii={...layer.cornerRadii};for(const c of controls)if(all||c.key===key)cornerRadii[c.key]=clamp(radius,c.max);
 const paths=structuredClone(layer.cornerSourcePaths??layer.paths);
 for(const [pathIndex,path]of paths.entries()){
  const commands=parseVectorPath(path.d),groups=polygons({...layer,cornerSourcePaths:paths}).filter(g=>g.pathIndex===pathIndex).reverse();
  for(const {points,indices,start,end}of groups){
   const rounded=points.map((point,i)=>{
    const before=sub(points[(i+points.length-1)%points.length],point),after=sub(points[(i+1)%points.length],point),a=unit(before),b=unit(after),theta=Math.acos(Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1]))),r=cornerRadii[`${pathIndex}:${indices[i]}`]??0,d=r/Math.tan(theta/2);
    return {entry:add(point,a,d||0),exit:add(point,b,d||0),r,sweep:a[1]*b[0]-a[0]*b[1]>0?1:0};
   });
   const next=[];for(const [i,c]of rounded.entries()){next.push({cmd:i?'L':'M',v:c.entry});if(c.r>0)next.push({cmd:'A',v:[c.r,c.r,0,0,c.sweep,...c.exit]});}next.push({cmd:'Z',v:[]});commands.splice(start,end-start+1,...next);
  }
  path.d=writeVectorPath(commands);
 }
 return {paths,cornerSourcePaths:structuredClone(layer.cornerSourcePaths??layer.paths),cornerRadii};
}
