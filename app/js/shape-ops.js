// Inspector and renderer share the same paint data. Editing one fill preserves its siblings.
const alpha=(color,opacity=1)=>(color??'#ffffff').slice(0,7)+Math.round(Math.max(0,Math.min(1,opacity))*255).toString(16).padStart(2,'0');
export const paintOpacity=color=>/^#[a-f\d]{8}$/i.test(color??'')?parseInt(color.slice(7,9),16)/255:1;
export function shapePaints(layer){
 if(layer.paints)return structuredClone(layer.paints);
 if(!layer.gradient)return [{type:'solid',color:layer.fill??'#ffffff'}];
 const g=layer.gradient,[W,H]=layer.pathSize??[layer.w,layer.h],a=(g.angle??180)*Math.PI/180,half=(Math.abs(W*Math.sin(a))+Math.abs(H*Math.cos(a)))/2;
 return [{type:g.type==='radial'?'radial':'linear',handles:g.type==='radial'?[[.5,.5],[1,.5],[.5,1]]:[[.5-Math.sin(a)*half/W,.5+Math.cos(a)*half/H],[.5+Math.sin(a)*half/W,.5-Math.cos(a)*half/H]],stops:[{position:0,color:g.fromAlpha===undefined&&/^#[a-f\d]{8}$/i.test(g.from??'')?g.from:alpha(g.from,g.fromAlpha??1)},{position:1,color:/^#[a-f\d]{8}$/i.test(g.to??'')?g.to:alpha(g.to,g.toAlpha??0)}]}];
}
export function editShapePaint(layer,index,patch){const paints=shapePaints(layer);if(!paints[index])throw Error('Choose a fill.');paints[index]={...paints[index],...structuredClone(patch)};return {paints,gradient:undefined};}
export function changePaintType(layer,index,type){
 const paint=shapePaints(layer)[index],first=paint?.stops?.[0]?.color??paint?.color??'#ffffff',last=paint?.stops?.at(-1)?.color??first;
 return editShapePaint(layer,index,type==='solid'?{type,color:first}:{type,stops:paint?.stops??[{position:0,color:first},{position:1,color:last}],handles:paint?.handles??(type==='radial'?[[.5,.5],[1,.5],[.5,1]]:[[0,.5],[1,.5],[0,1.5]])});
}
export function editGradientStop(layer,index,stopIndex,patch){
 const paint=shapePaints(layer)[index],stops=structuredClone(paint.stops),stop=stops[stopIndex];if(!stop)throw Error('Choose a colour stop.');
 if(patch.color!==undefined)stop.color=alpha(patch.color,patch.opacity??paintOpacity(stop.color));else if(patch.opacity!==undefined)stop.color=alpha(stop.color,patch.opacity);
 if(patch.position!==undefined)stop.position=Math.max(stops[stopIndex-1]?.position??0,Math.min(stops[stopIndex+1]?.position??1,patch.position));
 return editShapePaint(layer,index,{stops});
}
export function gradientAngle(layer,paint){const [W,H]=layer.pathSize??[layer.w,layer.h],a=paint.handles?.[0]??[0,.5],b=paint.handles?.[1]??[1,.5];return (Math.atan2((b[1]-a[1])*H,(b[0]-a[0])*W)*180/Math.PI+360)%360;}
export function turnGradient(layer,index,angle){
 const paint=shapePaints(layer)[index],[W,H]=layer.pathSize??[layer.w,layer.h],handles=paint.handles??[[0,.5],[1,.5],[0,1.5]],origin=handles[0],r=(angle-gradientAngle(layer,paint))*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
 return editShapePaint(layer,index,{handles:handles.map(p=>{const x=(p[0]-origin[0])*W,y=(p[1]-origin[1])*H;return [origin[0]+(x*c-y*s)/W,origin[1]+(x*s+y*c)/H];})});
}
