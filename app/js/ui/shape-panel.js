import {expandableNumberControl} from './expandable-number.js';
import {h,selectInput,numberInput,inspectorGroup} from './helpers.js';
import {shapePaints,paintOpacity,editShapePaint,changePaintType,editGradientStop,gradientAngle,turnGradient} from '../shape-ops.js';
import {openImagePicker} from './image-picker.js';
import {paletteSwatches} from './palettes.js';

export function shapeFields(ed,layer){
 const fresh=()=>{const resolved=ed.layerById(layer.id)??layer,source=ed.sourceFor(resolved);return {...resolved,...source.block.layers?.find(l=>l.id===source.layer.id),...source.block.overrides?.[source.layer.id],id:resolved.id};},set=(patch,options={})=>ed.setLayer(fresh(),patch,options),key=name=>`${name}:${layer.id}`;
 const number=(label,value,change,{min=0,max=2048,step=1}={})=>{const input=numberInput({value,min,max,step,onChange:v=>change(Math.max(min,Math.min(max,v)))});input.setAttribute('aria-label',label);return h('label',{class:'shape-number'},h('span',null,label),input);};
 const color=(label,value,change)=>h('label',{class:'shape-colour'},h('span',null,label),h('input',{type:'color','aria-label':label,value:(value??'#ffffff').slice(0,7),onInput:e=>change(e.target.value)}));
 const paints=shapePaints(layer),parts=[];
 if(layer.shape==='path')parts.push(h('div',{class:'vector-edit-entry'},h('button',{class:'btn primary','aria-pressed':String(ed.isVectorEditing?.(layer.id)??false),onClick:()=>ed.editVector(layer)},ed.isVectorEditing?.(layer.id)?'Done editing points':'Edit points'),h('p',{class:'hint'},'Drag points and curve handles on the canvas. Double-click an edge to add a point.')));
 else parts.push(selectInput({value:layer.shape??'rect',options:[['rect','Rectangle'],['ellipse','Ellipse']],onChange:v=>set({shape:v},{rebuild:true})}));
 for(const [i,paint]of paints.entries()){
  const title=paints.length>1?`Fill ${i+1}`:'Fill',fields=[];
  const patch=(p,rebuild=false)=>set(editShapePaint(fresh(),i,p),{key:key(`paint-${i}`),rebuild});
  const type=selectInput({value:paint.type,options:[['solid','Solid'],['linear','Linear gradient'],['radial','Radial gradient'],...(paint.type==='image'?[['image','Image']]:[])],onChange:v=>set(changePaintType(fresh(),i,v),{rebuild:true})});type.setAttribute('aria-label',`${title} type`);fields.push(type);
  if(paint.type==='image')fields.push(h('button',{class:'btn small',onClick:async()=>{const image=await openImagePicker({title:'Replace image fill'});if(image)patch({src:image.file},true);}},'Change image fill…'));
  else if(paint.type==='solid'){
   fields.push(color(`${title} colour`,paint.color,v=>patch({color:v.length===7&&paintOpacity(shapePaints(fresh())[i].color)<1?v+Math.round(paintOpacity(shapePaints(fresh())[i].color)*255).toString(16).padStart(2,'0'):v})),number(`${title} opacity`,Math.round(paintOpacity(paint.color)*100),v=>patch({color:(shapePaints(fresh())[i].color??'#ffffff').slice(0,7)+Math.round(v*2.55).toString(16).padStart(2,'0')}),{max:100}));
   fields.push(paletteSwatches(ed,v=>patch({color:v})));
  }else{
   fields.push(h('button',{class:'btn small',onClick:()=>ed.editGradient(layer,i)},ed.isGradientEditing?.(layer.id,i)?'Done editing gradient':'Edit gradient on canvas'));
   fields.push(h('div',{class:'gradient-stop-labels','aria-hidden':'true'},h('span',null,'Colour'),h('span',null,'Position %'),h('span',null,'Opacity %'),h('span')));
   for(const [j,stop]of (paint.stops??[]).entries()){
    const update=p=>set(editGradientStop(fresh(),i,j,p),{key:key(`stop-${i}-${j}`)});
    fields.push(h('div',{class:'gradient-stop'},color(`Stop ${j+1} colour`,stop.color,v=>update({color:v})),number(`Stop ${j+1} position`,Math.round(stop.position*100),v=>update({position:v/100}),{max:100}),number(`Stop ${j+1} opacity`,Math.round(paintOpacity(stop.color)*100),v=>update({opacity:v/100}),{max:100}),h('button',{class:'btn small',title:`Remove colour ${j+1}`,'aria-label':`Remove colour ${j+1}`,disabled:paint.stops.length<=2,onClick:()=>{const stops=structuredClone(shapePaints(fresh())[i].stops);stops.splice(j,1);patch({stops},true);}},'×')));
   }
   fields.push(h('button',{class:'btn small',disabled:paint.stops.length>=32,onClick:()=>{const stops=structuredClone(shapePaints(fresh())[i].stops);let at=0;for(let k=1;k<stops.length-1;k++)if(stops[k+1].position-stops[k].position>stops[at+1].position-stops[at].position)at=k;stops.splice(at+1,0,{position:(stops[at].position+stops[at+1].position)/2,color:stops[at].color});patch({stops},true);}},'Add colour'));
   fields.push(number(`${title} angle`,Math.round(gradientAngle(layer,paint)),v=>set(turnGradient(fresh(),i,v),{key:key(`angle-${i}`)}),{max:360}));
  }
  parts.push(inspectorGroup(`shape-fill-${i}`,title,fields));
 }
 parts.push(h('button',{class:'btn small',onClick:()=>set({paints:[...shapePaints(fresh()),{type:'solid',color:'#ffffff80'}],gradient:undefined},{rebuild:true})},'Add fill'));
 const scale=layer.shape==='path'?layer.w/(layer.pathSize?.[0]??layer.w):1;
 const stroke=patch=>set({stroke:{color:'#ffffff',width:0,...fresh().stroke,...patch}},{key:key('stroke')});
 const alignment=selectInput({value:layer.stroke?.align??'center',options:[['center','Centre'],['inside','Inside'],['outside','Outside']],onChange:v=>stroke({align:v})});alignment.setAttribute('aria-label','Outline alignment');
 const widthControl=expandableNumberControl({value:(layer.stroke?.width??0)*scale,label:'Outline width',onChange:v=>stroke({width:v/scale})});
 parts.push(inspectorGroup('shape-outline','Outline',[h('div',{class:'shape-number'},h('span',null,'Outline width'),widthControl.el),color('Outline colour',layer.stroke?.color,v=>stroke({color:v})),alignment]));
 const scalar=(label,value,onChange,options={})=>{const control=expandableNumberControl({label,value,onChange,...options});return h('div',{class:'shape-number'},h('span',null,options.title??label),control.el);};
 parts.push(inspectorGroup('shape-blur','Blur',[scalar('Layer blur pixels',layer.blur??0,v=>set({blur:v},{key:key('blur')}),{title:'Blur',sliderLabel:'Layer blur',max:2048,sliderMax:100,step:.5})]));
 if(layer.shape==='rect'){
  const max=Math.min(layer.w,layer.h)/2,individual=[];
  const common=expandableNumberControl({label:'Corner radius',value:layer.radius??0,max,sliderMax:Math.min(100,max),onChange:v=>{individual.forEach(c=>c.sync(v));set({radius:v,radii:fresh().radii?Array(4).fill(v):undefined},{key:key('radius')});}});
  parts.push(h('div',{class:'shape-number'},h('span',null,'Corner radius'),common.el));
  if(layer.radii)for(const [i,name]of ['Top left','Top right','Bottom right','Bottom left'].entries()){
   const control=expandableNumberControl({label:`${name} radius`,value:layer.radii[i],max,sliderMax:Math.min(100,max),onChange:v=>{const radii=[...(fresh().radii??Array(4).fill(fresh().radius??0))];radii[i]=v;const radius=radii.every(r=>r===radii[0])?radii[0]:0;common.sync(radius);set({radii,radius},{key:key(`radius-${i}`)});}});individual.push(control);parts.push(h('div',{class:'shape-number'},h('span',null,`${name} radius`),control.el));
  }
 }
 if(layer.shape==='path')parts.push(inspectorGroup('vector-code','Advanced path data',(layer.paths??[]).map((p,i)=>{const input=h('textarea',{'aria-label':`Vector path ${i+1}`,rows:3,value:p.d});input.addEventListener('change',()=>{try{new Path2D(input.value);const paths=structuredClone(fresh().paths);paths[i].d=input.value;set({paths,cornerSourcePaths:undefined,cornerRadii:undefined});input.setCustomValidity('');}catch{input.setCustomValidity('Enter a valid SVG path.');input.reportValidity();}});return input;}),{open:false}));
 return h('div',{class:'shape-fields'},...parts);
}
