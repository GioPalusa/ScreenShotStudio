import {h} from './helpers.js';
import {expandableNumberControl} from './expandable-number.js';
import {paintOpacity} from '../shape-ops.js';
export function shadowFields(ed,layer,fresh){
 const shadow=layer.shadow,defaults={color:'#000000',alpha:.3,blur:50,dx:0,dy:24};
 const set=(patch,key)=>ed.setLayer(fresh(),{shadow:{...fresh().shadow,...patch}},{key:`shadow:${key}:${layer.id}`});
 const toggle=h('button',{type:'button',class:'btn small','aria-label':shadow?'Remove shadow':'Add shadow',onClick:()=>{const l=fresh();ed.setLayer(l,shadow?{shadow:undefined,savedShadow:l.shadow}:{shadow:l.savedShadow??defaults,savedShadow:undefined},{rebuild:true});}},shadow?'Remove shadow':'Add shadow');
 const fields=[h('div',{class:'row'},h('span',{class:'label'},'Shadow'),toggle)];
 if(shadow){
  const opacity=shadow.alpha??paintOpacity(shadow.color),color=h('input',{type:'color','aria-label':'Shadow colour',value:(shadow.color??'#000000').slice(0,7),onInput:e=>set({color:e.target.value,alpha:fresh().shadow.alpha??paintOpacity(fresh().shadow.color)},'color')});
  fields.push(h('label',{class:'shape-colour'},h('span',null,'Shadow colour'),color));
  for(const [label,key,value,options]of [
   ['Shadow opacity','alpha',opacity*100,{max:100,sliderMax:100,step:1,unit:'%'}],
   ['Shadow blur','blur',shadow.blur??50,{max:2048,sliderMax:100}],
   ['Shadow X offset','dx',shadow.dx??0,{min:-2048,max:2048,sliderMin:-100,sliderMax:100}],
   ['Shadow Y offset','dy',shadow.dy??24,{min:-2048,max:2048,sliderMin:-100,sliderMax:100}],
  ]){const control=expandableNumberControl({label,value,...options,onChange:v=>set({[key]:key==='alpha'?v/100:v},key)});fields.push(h('div',{class:'shape-number'},h('span',null,label),control.el));}
 }
 return h('div',{class:'field'},fields);
}
