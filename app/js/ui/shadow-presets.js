import {h} from './helpers.js';
import {SHADOW_PRESETS,shadowPresetId} from '../shadow-ops.js';
let activeView='presets',serial=0;
/** Shared visual chooser for one object or a multiple selection. */
export function shadowChooser({shadow,onPreset,settings}){
 const id=`shadow-chooser-${++serial}`,buttons=new Map(),caption=h('p',{class:'shadow-preset-caption hint',role:'status'});
 const presets=h('div',{class:'shadow-preset-grid',role:'group','aria-label':'Shadow presets'},SHADOW_PRESETS.map(p=>{
  const s=p.shadow,alpha=Math.round(s.alpha*255).toString(16).padStart(2,'0'),preview=`${s.dx*.35}px ${s.dy*.35}px ${s.blur*.35}px ${s.color}${alpha}`;
  const b=h('button',{type:'button',class:`shadow-preset-tile${p.id==='glow'?' glow':''}`,'aria-label':`${p.name} shadow preset`,'aria-pressed':'false',title:`${p.name} · ${Math.round(s.alpha*100)}% · ${s.blur} px blur · ${s.dx}, ${s.dy} px offset`,onClick:()=>onPreset(p.id)},h('span',{class:'shadow-preset-preview','aria-hidden':'true'},h('span',{class:'shadow-preset-square'})),h('span',{class:'shadow-preset-name'},p.name));b.style.setProperty('--preset-shadow',preview);buttons.set(p.id,b);return b;
 }));
 presets.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const all=[...buttons.values()],at=all.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?all.length-1:Math.max(0,Math.min(all.length-1,at+({ArrowLeft:-1,ArrowRight:1,ArrowUp:-3,ArrowDown:3}[e.key])));all.forEach((b,i)=>b.tabIndex=i===next?0:-1);all[next].focus();});
 const presetPanel=h('div',{id:`${id}-presets`,role:'tabpanel','aria-label':'Shadow presets'},presets,caption),settingsPanel=h('div',{id:`${id}-settings`,role:'tabpanel','aria-label':'Shadow settings',class:'field'},settings);
 const tabs=[['presets','Presets'],['settings','Settings']].map(([value,label])=>h('button',{type:'button',role:'tab',id:`${id}-${value}-tab`,'aria-controls':`${id}-${value}`,'aria-label':`Shadow ${label.toLowerCase()}`,onClick:()=>select(value)},label));
 presetPanel.setAttribute('aria-labelledby',tabs[0].id);settingsPanel.setAttribute('aria-labelledby',tabs[1].id);
 function sync(){const current=shadow(),selected=current?shadowPresetId(current):'mixed';for(const [key,b]of buttons){b.setAttribute('aria-pressed',String(key===selected));b.tabIndex=key===(selected==='custom'||selected==='mixed'?SHADOW_PRESETS[0].id:selected)?0:-1;}caption.textContent=selected==='mixed'?'Mixed shadow settings':selected==='custom'?'Custom shadow':`${SHADOW_PRESETS.find(p=>p.id===selected).name} shadow`;}
 function select(value){activeView=value;tabs.forEach((tab,i)=>{const selected=(i===0?'presets':'settings')===value;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});presetPanel.hidden=value!=='presets';settingsPanel.hidden=value!=='settings';sync();}
 const tablist=h('div',{class:'shadow-view-tabs',role:'tablist','aria-label':'Shadow editor'},tabs);
 tablist.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const index=e.key==='Home'?0:e.key==='End'?1:activeView==='presets'?1:0;select(index===0?'presets':'settings');tabs[index].focus();});
 select(activeView);const el=h('div',{class:'shadow-chooser'},tablist,presetPanel,settingsPanel);el.addEventListener('keydown',e=>{if(['Enter',' ','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&e.target.closest('button'))e.stopPropagation();});return {el,sync};
}
