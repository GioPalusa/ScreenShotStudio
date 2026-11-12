import {h} from './helpers.js';
// One compact field, with an optional top-layer slider and exact input.
export function expandableNumberControl({value=0,label='Value',title=label,sliderLabel=`${label} slider`,min=0,max=200,step=.5,sliderMin=min,sliderMax=40,unit='px',onChange}){
 let closing=false;
 const rangeMin=v=>Math.max(min,Math.min(max,sliderMin,v));
 const rangeMax=v=>Math.min(max,Math.max(min,sliderMax,v));
 const read=el=>el.value===''||!Number.isFinite(Number(el.value))?null:Math.max(min,Math.min(max,Number(el.value)));
 const input=h('input',{type:'number',class:'input num',min,max,step,value,'aria-label':label,'aria-haspopup':'dialog','aria-expanded':'false'});
 const range=h('input',{type:'range',min:rangeMin(value),max:rangeMax(value),step,value,'aria-label':sliderLabel});
 const exact=h('input',{type:'number',class:'input num',min,max,step,value,'aria-label':`${label} exact value`});
 const popup=h('div',{class:'expandable-number-popup',popover:'auto','aria-label':`${label} controls`},h('span',{class:'expandable-number-title'},title),h('div',{class:'expandable-number-row'},range,exact,h('span',{class:'hint'},unit)));
 const el=h('div',{class:'expandable-number-control'},input,popup);
 function sync(v,disabled=false){
  for(const field of [input,exact]){field.disabled=disabled;if(document.activeElement!==field)field.value=v;}
  range.disabled=disabled;if(document.activeElement!==range){range.min=rangeMin(v);range.max=rangeMax(v);range.value=v;}
  if(disabled&&popup.matches(':popover-open'))popup.hidePopover();
 }
 function commit(field){const v=read(field);if(v===null)return;field.value=v;for(const other of [input,exact])if(other!==field)other.value=v;if(field!==range){range.min=rangeMin(v);range.max=rangeMax(v);range.value=v;}onChange(v);}
 function open(){
  if(closing||input.disabled||!el.isConnected)return;
  const r=input.getBoundingClientRect(),w=Math.min(280,window.innerWidth-16);popup.style.width=`${w}px`;popup.style.left=`${Math.max(8,Math.min(window.innerWidth-w-8,r.right+8))}px`;popup.style.top=`${Math.max(8,Math.min(window.innerHeight-100,r.top-8))}px`;
  popup.setAttribute('role','dialog');if(!popup.matches(':popover-open'))popup.showPopover();input.setAttribute('aria-expanded','true');
 }
 input.addEventListener('focus',open);input.addEventListener('click',open);input.addEventListener('change',()=>commit(input));exact.addEventListener('change',()=>commit(exact));range.addEventListener('input',()=>commit(range));
 popup.addEventListener('toggle',()=>{const open=popup.matches(':popover-open');input.setAttribute('aria-expanded',String(open));if(!open)popup.removeAttribute('role');});
 el.addEventListener('keydown',e=>{if(e.key==='Escape'&&popup.matches(':popover-open')){e.preventDefault();e.stopPropagation();popup.hidePopover();popup.removeAttribute('role');closing=true;input.focus({preventScroll:true});closing=false;input.setAttribute('aria-expanded','false');}else if(popup.contains(e.target))e.stopPropagation();});
 return {el,input,range,exact,popup,sync};
}
