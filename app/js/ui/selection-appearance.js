import {paintOpacity} from '../shape-ops.js';
import {canCombineShapes} from '../shape-boolean.js';
import {h,selectInput} from './helpers.js';
import {expandableNumberControl} from './expandable-number.js';
import {toolbarPaints,toolbarPaintPatch} from '../toolbar-paints.js';
import {fontPicker} from './font-picker.js';
const same=values=>values.every(v=>JSON.stringify(v)===JSON.stringify(values[0]));
export function appearanceActions(ed){return h('div',{class:'row wrap'},h('button',{type:'button',class:'btn small','aria-label':ed.selectionLayers().some(l=>l.maskMembership)?'Release mask':'Use as mask',disabled:ed.selectionLayers().length<2&&!ed.selectionLayers().some(l=>l.maskMembership),onClick:()=>ed.maskSelection()},ed.selectionLayers().some(l=>l.maskMembership)?'Release mask':'Use as mask'),h('button',{type:'button',class:'btn small',title:'Copy appearance · ⌥⌘C',onClick:()=>ed.copyAppearance()},'Copy appearance'),h('button',{type:'button',class:'btn small',title:'Paste appearance · ⌥⌘V',onClick:()=>ed.pasteAppearance()},'Paste appearance'));}
export function selectionAppearance(ed){
 const layers=()=>ed.selectionLayers(),initial=layers(),fields=[h('p',{class:'hint'},'Changes apply to the selected unlocked objects. Different values are shown as Mixed.'),appearanceActions(ed)];
 if(initial.every(l=>l.type==='shape'))fields.push(h('div',{class:'row wrap',role:'group','aria-label':'Combine shapes'},[['unite','Union'],['subtract','Subtract'],['intersect','Intersect'],['exclude','Exclude']].map(([operation,label])=>h('button',{type:'button',class:'btn small',title:operation==='subtract'?'Subtract front shapes from the backmost shape':`${label} selected shapes`,disabled:!canCombineShapes(initial),onClick:()=>ed.combineSelection(operation)},label))));
 const edit=(patch,key,types=null)=>ed.editSelectedAppearance(patch,{key,types});
 const scalar=(label,targets,read,write,options={})=>{
  const values=targets.map(read),control=expandableNumberControl({label,value:values[0]??0,mixed:!same(values),onChange:v=>edit(layer=>write(layer,v),label,options.types),...options});return h('div',{class:'shape-number'},h('span',null,label),control.el);
 };
 fields.push(scalar('Opacity',initial,l=>(l.opacity??1)*100,(l,v)=>({opacity:v/100}),{max:100,sliderMax:100,step:1,unit:'%'}),scalar('Blur',initial,l=>l.blur??0,(l,v)=>({blur:v}),{max:2048,sliderMax:100}));
 const painted=initial.filter(l=>l.type==='shape'||l.type==='text'),shapes=initial.filter(l=>l.type==='shape'),rects=shapes.filter(l=>l.shape==='rect'),texts=initial.filter(l=>l.type==='text');
 function colour(label,targets,read,write,types){const values=targets.map(read),input=h('input',{type:'color','aria-label':label,value:values[0].slice(0,7),onInput:e=>edit(l=>write(l,e.target.value),label,types)});return h('label',{class:'shape-colour'},h('span',null,label),!same(values)?h('span',{class:'hint'},'Mixed'):null,input);}
 if(painted.length)fields.push(colour('Fill colour',painted,l=>toolbarPaints(l,ed.scene.theme.ink).fill,(l,color)=>toolbarPaintPatch(l,'color',{target:'fill',color}),['shape','text']));
 if(shapes.length)fields.push(h('p',{class:'hint'},`Outlines · ${shapes.length} shapes`),colour('Outline colour',shapes,l=>toolbarPaints(l).stroke,(l,color)=>toolbarPaintPatch(l,'color',{target:'stroke',color}),['shape']),scalar('Outline width',shapes,l=>toolbarPaints(l).width,(l,width)=>toolbarPaintPatch(l,'width',{width}),{types:['shape']}));
 if(rects.length)fields.push(scalar('Corner radius',rects,l=>l.radius??0,(l,v)=>l.shape==='rect'?{radius:Math.min(v,l.w/2,l.h/2),radii:undefined}:{},{max:Math.max(...rects.map(l=>Math.min(l.w,l.h)/2)),sliderMax:100,types:['shape']}));
 if(texts.length){
  fields.push(h('p',{class:'hint'},`Typography · ${texts.length} text layers`),fontPicker({mixed:!same(texts.map(l=>l.fontFamily)),value:same(texts.map(l=>l.fontFamily))?texts[0].fontFamily:undefined,inherited:ed.scene.fonts.family,onChange:fontFamily=>edit({fontFamily},'fontFamily',['text'])}),scalar('Text size',texts,l=>l.size??100,(l,size)=>({size}),{min:1,max:4000,sliderMax:200,types:['text']}));
  const weights=texts.map(l=>l.weight??700),weight=selectInput({value:same(weights)?String(weights[0]):'mixed',options:[...(!same(weights)?[['mixed','Mixed']]:[]),...[100,200,300,400,500,600,700,800,900].map(n=>[String(n),String(n)])],onChange:v=>{if(v!=='mixed')edit({weight:Number(v)},'weight',['text']);}});weight.setAttribute('aria-label','Text weight');fields.push(h('label',{class:'shape-number'},h('span',null,'Weight'),weight));
 }
 const shadows=initial.map(l=>l.shadow),allShadow=shadows.every(Boolean),anyShadow=shadows.some(Boolean);
 fields.push(h('div',{class:'row wrap'},h('span',{class:'label'},'Shadows'),h('button',{type:'button',class:'btn small','aria-label':allShadow?'Remove selected shadows':'Add shadow to selection',onClick:()=>{ed.setLayerPaints(layers().map(layer=>({layer,patch:allShadow?{savedShadow:layer.shadow,shadow:undefined}:{shadow:layer.shadow??layer.savedShadow??{color:'#000000',alpha:.3,blur:50,dx:0,dy:24}}})),null);}},allShadow?'Remove shadows':'Add shadows')));
 if(anyShadow){
  const defaults={color:'#000000',alpha:.3,blur:50,dx:0,dy:24},shadow=l=>({...defaults,...l.shadow,alpha:l.shadow?(l.shadow.alpha??paintOpacity(l.shadow.color)):.3});
  fields.push(colour('Shadow colour',initial,l=>shadow(l).color,(l,color)=>({shadow:{...shadow(l),color}}),null));
  for(const [label,key,options]of [['Shadow opacity','alpha',{max:100,sliderMax:100,step:1,unit:'%'}],['Shadow blur','blur',{max:2048,sliderMax:100}],['Shadow X offset','dx',{min:-2048,max:2048,sliderMin:-100,sliderMax:100}],['Shadow Y offset','dy',{min:-2048,max:2048,sliderMin:-100,sliderMax:100}]])fields.push(scalar(label,initial,l=>shadow(l)[key]*(key==='alpha'?100:1),(l,v)=>({shadow:{...shadow(l),[key]:v/(key==='alpha'?100:1)}}),options));
 }
 return h('div',{class:'field'},fields);
}
