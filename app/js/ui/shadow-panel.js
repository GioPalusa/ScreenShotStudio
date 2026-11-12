import {h,selectInput,inspectorGroup} from './helpers.js';
import {expandableNumberControl} from './expandable-number.js';
import {paintOpacity} from '../shape-ops.js';
import {SHADOW_PRESETS,shadowPolar,shadowFromPolar,shadowPreset,shadowAngle,shadowPresetId} from '../shadow-ops.js';
export function shadowFields(ed,layer,fresh){
 const shadow=layer.shadow,defaults=shadowPreset('floating');let live={...shadow},dialDrag=null;
 const toggle=h('button',{type:'button',class:'btn small shadow-toggle','aria-label':shadow?'Remove shadow':'Add shadow',onClick:()=>{const l=fresh();ed.setLayer(l,shadow?{shadow:undefined,savedShadow:l.shadow}:{shadow:l.savedShadow??defaults,savedShadow:undefined},{rebuild:true});}},shadow?'Remove shadow':'Add shadow');
 const fields=[h('div',{class:'row'},h('span',{class:'label'},'Drop shadow'),toggle)];
 if(shadow){
  const controls=new Map();
  const color=h('input',{type:'color','aria-label':'Shadow colour',value:(shadow.color??'#000000').slice(0,7),onInput:e=>set({color:e.target.value,alpha:live.alpha??paintOpacity(live.color)},'color')});
  const preset=selectInput({value:shadowPresetId(shadow),options:[['custom','Custom'],...SHADOW_PRESETS.map(p=>[p.id,p.name])],onChange:id=>{if(id!=='custom')ed.setLayer(fresh(),{shadow:shadowPreset(id)},{rebuild:true});}});preset.setAttribute('aria-label','Shadow preset');
  const dial=h('button',{type:'button',class:'shadow-angle-dial',role:'slider',tabIndex:0,'aria-label':'Shadow angle dial','aria-valuemin':0,'aria-valuemax':359,title:'Shadow direction: 0° right, 90° down. Drag to turn; arrow keys adjust by 1°, Shift by 10°.'},h('span',{class:'shadow-dial-arm','aria-hidden':'true'}));
  const valueFor=key=>key==='alpha'?(live.alpha??paintOpacity(live.color))*100:key==='distance'?shadowPolar(live).distance:key==='angle'?shadowPolar(live).angle:live[key]??defaults[key];
  function sync(){
   preset.value=shadowPresetId(live);color.value=(live.color??'#000000').slice(0,7);
   for(const [key,control]of controls)control.sync(Math.round(valueFor(key)*100)/100);
   const angle=shadowPolar(live).angle;dial.style.setProperty('--shadow-angle',`${angle}deg`);dial.setAttribute('aria-valuenow',String(Math.round(angle)));dial.setAttribute('aria-valuetext',`${Math.round(angle)} degrees`);
  }
  function set(patch,key){live={...live,...patch};ed.setLayer(fresh(),{shadow:live},{key:`shadow:${key}:${layer.id}`});sync();}
  function polar(patch,key){set(shadowFromPolar(live,patch),key);}
  const scalar=(label,key,options={})=>{const control=expandableNumberControl({label,value:Math.round(valueFor(key)*100)/100,...options,onChange:v=>['distance','angle'].includes(key)?polar({[key]:v},key):set({[key]:key==='alpha'?v/100:v},key)});controls.set(key,control);return h('div',{class:'shape-number'},h('span',null,key==='blur'?'Blur / size':label),control.el);};
  const turn=e=>{const r=dial.getBoundingClientRect();polar({angle:shadowAngle(Math.atan2(e.clientY-r.top-r.height/2,e.clientX-r.left-r.width/2)*180/Math.PI)},'angle');};
  dial.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();dial.focus();dialDrag=e.pointerId;dial.setPointerCapture?.(e.pointerId);turn(e);});
  dial.addEventListener('pointermove',e=>{if(e.pointerId===dialDrag)turn(e);});
  const release=e=>{if(dialDrag===e.pointerId){dialDrag=null;if(dial.hasPointerCapture?.(e.pointerId))dial.releasePointerCapture(e.pointerId);}};
  dial.addEventListener('pointerup',release);dial.addEventListener('pointercancel',release);
  dial.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();polar({angle:e.key==='Home'?0:e.key==='End'?359:shadowPolar(live).angle+(['ArrowRight','ArrowUp'].includes(e.key)?1:-1)*(e.shiftKey?10:1)},'angle');});
  fields.push(h('label',{class:'field'},'Preset',preset),h('label',{class:'shape-colour'},h('span',null,'Shadow colour'),color),scalar('Shadow opacity','alpha',{max:100,sliderMax:100,step:1,unit:'%'}),scalar('Shadow distance','distance',{max:2896,sliderMax:150}),h('div',{class:'shadow-angle-row'},dial,scalar('Shadow angle','angle',{max:360,sliderMax:360,step:1,unit:'°'})),scalar('Shadow blur','blur',{max:2048,sliderMax:100}));
  fields.push(inspectorGroup('shadow-offsets','Advanced · X / Y offsets',[scalar('Shadow X offset','dx',{min:-2048,max:2048,sliderMin:-100,sliderMax:100}),scalar('Shadow Y offset','dy',{min:-2048,max:2048,sliderMin:-100,sliderMax:100})],{open:false}));
  sync();
 }
 return h('div',{class:'field shadow-settings'},fields);
}
