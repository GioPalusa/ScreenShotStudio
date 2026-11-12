// Paint controls share the document's editable paint data; no rendered snapshots.
import {shapePaints,paintOpacity} from './shape-ops.js';
const rgb=c=>/^#[a-f\d]{6,8}$/i.test(c??'')?c.slice(0,7):'#ffffff';
const enabled=p=>p.type==='solid'?paintOpacity(p.color)>0:p.type==='image'?(p.opacity??1)>0:p.stops?.some(s=>paintOpacity(s.color)>0);
export function toolbarPaints(layer,ink='#142039'){
 const text=layer.type==='text',fills=text?[layer.textPaint??{type:'solid',color:layer.color??ink}]:shapePaints(layer),fill=fills.find(enabled)??fills[0]??layer.savedFillPaints?.[0]??{type:'solid',color:'#ffffff'},stroke=layer.stroke??layer.savedOutline??{color:'#142039',width:0},scale=layer.shape==='path'?layer.w/(layer.pathSize?.[0]??layer.w):1;
 return {fill:rgb(fill.color??fill.stops?.[0]?.color),stroke:rgb(stroke.color),fillEnabled:fills.some(enabled),strokeEnabled:!text&&(layer.stroke?.width??0)>0&&paintOpacity(layer.stroke?.color)>0,width:(layer.stroke?.width??0)*scale,fillPaint:fill,canStroke:!text,canSwap:!text&&fills.length<=1&&fill.type==='solid'};
}
export function toolbarPaintPatch(layer,action,{target='fill',color,width,ink}={}){
 if(action==='width')target='stroke';
 const p=toolbarPaints(layer,ink),text=layer.type==='text',scale=layer.shape==='path'?layer.w/(layer.pathSize?.[0]??layer.w):1;
 if(action==='swap'){
  if(!p.canSwap)return {};
  const fill=p.strokeEnabled?layer.stroke.color:p.stroke+'00';
  return {fill,paints:[{type:'solid',color:fill}],gradient:undefined,savedFillPaints:undefined,savedOutline:undefined,stroke:{...layer.stroke,color:p.fill,width:p.fillEnabled?(p.width||2)/scale:0}};
 }
 if(target==='stroke'){
  if(text)return {};
  const stroke={color:p.stroke,width:0,...layer.stroke};
  if(action==='none'&&!p.strokeEnabled)return {};
  if(action==='none')return {savedOutline:stroke,stroke:{...stroke,width:0}};
  if(action==='width')return {stroke:{...stroke,width:width/scale}};
  return {savedOutline:undefined,stroke:{...stroke,...(action==='color'?{color}:{}),width:stroke.width||layer.savedOutline?.width||2/scale}};
 }
 if(action==='none'&&!p.fillEnabled)return {};
 const fills=text?[layer.textPaint??{type:'solid',color:layer.color??ink??'#142039'}]:shapePaints(layer);
 if(action==='none')return text?{savedFillPaints:fills,color:p.fill+'00',textPaint:undefined}:{savedFillPaints:fills,paints:[],gradient:undefined,fill:p.fill+'00'};
 const fillIndex=Math.max(0,fills.findIndex(enabled));
 const restored=action==='restore'?(layer.savedFillPaints??fills).map(f=>f.type==='solid'?{...f,color:paintOpacity(f.color)===0?rgb(f.color):f.color}:f):(fills.length?fills.map((f,i)=>i===fillIndex?{type:'solid',color}:f):[{type:'solid',color}]);
 const first=restored[0]??{type:'solid',color:p.fill};
 return text?{savedFillPaints:undefined,color:first.color??p.fill,textPaint:first.type==='solid'?undefined:first}:{savedFillPaints:undefined,paints:restored.length?restored:[first],gradient:undefined,fill:first.color??p.fill};
}
export function paintPreview(paint){
 if(paint?.type==='linear'||paint?.type==='radial')return `${paint.type==='radial'?'radial-gradient(circle':'linear-gradient(135deg'}, ${(paint.stops??[]).map(s=>`${s.color} ${s.position*100}%`).join(', ')})`;
 if(paint?.type==='image')return 'repeating-conic-gradient(#aaa 0% 25%, #555 0% 50%) 0 / 8px 8px';
 return paint?.color??'#ffffff';
}
