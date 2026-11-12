import {expandableNumberControl} from './expandable-number.js';
import {toolbarPaints,toolbarPaintPatch,paintPreview} from '../toolbar-paints.js';
import {h,toast} from './helpers.js';
import {icon} from './icons.js';
import {state,rememberUI} from '../store.js';
import {dragShape,penPath,penVector,drawingStyle} from '../drawing-ops.js';
const TOOLS=[
 ['select','Select','V','lucide/mouse-pointer-2'],
 ['points','Edit points','A','lucide/mouse-pointer'],
 ['bend','Bend path','B','lucide/spline'],
 ['rect','Rectangle','R','lucide/rectangle-horizontal'],
 ['ellipse','Ellipse / circle','O','lucide/circle'],
 ['line','Line','L','lucide/slash'],
 ['pen','Pen / vector','P','lucide/pen-tool'],
 ['text','Text','T','textformat'],
 ['image','Image','I','photo'],
];
const svg=(tag,attrs)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};

export function createDrawingTools(ed,{scale,point,redraw,hitTest,vectorEditor}){
 let tool='select',gesture=null,nodes=[],hover=null,context=null,lastFinish=0;
 const toolbar=h('div',{class:'drawing-tools',role:'toolbar','aria-label':'Canvas tools','aria-orientation':'vertical'}),buttons=new Map();
 const saved=state.ui.drawingStyle??{},style={fill:/^#[a-f\d]{6}$/i.test(saved.fill??'')?saved.fill:'#f5f7fb',stroke:/^#[a-f\d]{6}$/i.test(saved.stroke??'')?saved.stroke:'#142039',fillEnabled:saved.fillEnabled!==false,strokeEnabled:saved.strokeEnabled!==false,width:Number.isFinite(saved.width)?Math.max(0,Math.min(200,saved.width)):2};
 const keepStyle=()=>{syncPaints();state.ui.drawingStyle={...style};state.ui.drawingPaintTarget=paintTarget;rememberUI();redraw();};
 const contextKey=()=>`${ed.scene?.slideId}|${ed.scene?.deviceId}|${ed.scene?.localeId}`;
 const consume=e=>{e.preventDefault();e.stopPropagation();};
 const focus=()=>{ed.overlay.tabIndex=0;ed.overlay.focus({preventScroll:true});};
 const ink=()=>ed.scene?.theme.ink??'#142039';
 function update(){const active=vectorEditor.isBending(ed.selectedId)?'bend':vectorEditor.isEditing(ed.selectedId)?'points':tool;for(const [id,b]of buttons)b.setAttribute('aria-pressed',String(active===id));ed.overlay.style.cursor=['rect','ellipse','line','pen'].includes(tool)?'crosshair':'default';}
 function clear(){gesture=null;nodes=[];hover=null;context=contextKey();}
 function choose(id){
  clear();if(vectorEditor.active)vectorEditor.exit();
  if(id==='text'||id==='image'){tool='select';update();redraw();if(id==='text')ed.addLayer('text');else ed.addImage();return;}
  else{tool=id;if(id==='points'||id==='bend'){const target=ed.layerById(ed.selectedId);if(target?.shape==='path'&&!target.locked)vectorEditor.enter(target,null,{bend:id==='bend'});}}
  update();redraw();focus();
 }
 for(const [id,label,key,symbol]of TOOLS){const b=h('button',{type:'button',class:'drawing-tool',title:`${label} (${key})`,'aria-label':`${label} tool`,'aria-keyshortcuts':key.toLowerCase(),'aria-pressed':'false',onClick:()=>choose(id)},icon(symbol));if(id==='points')b.title='Direct selection · Edit points (A)';buttons.set(id,b);toolbar.append(b);}
 let paintTarget=state.ui.drawingPaintTarget==='stroke'?'stroke':'fill';
 const paints=h('div',{class:'drawing-paints','aria-label':'Next shape appearance'}),swatches=h('div',{class:'drawing-colours'}),inputs={},paintButtons={};
 const paintName=key=>key==='fill'?'Fill':'Outline';
 const targetLabel=h('span',{class:'drawing-paint-target','aria-live':'polite'});
 const selected=()=>ed.selectionLayers().filter(l=>l.type==='shape'||l.type==='text');
 function appearance(){const layers=selected();return layers.length?toolbarPaints(layers[0],ink()):style;}
 function changePaint(action,options={}){
  const layers=selected();
  if(layers.length){const edits=layers.map(layer=>({layer,patch:toolbarPaintPatch(layer,action,{target:paintTarget,ink:ink(),...options})})).filter(e=>Object.keys(e.patch).length);ed.setLayerPaints(edits,action==='color'||action==='width'?`toolbar:${layers.map(l=>l.id).join(',')}:${paintTarget}:${action}`:null);syncPaints();return;}
  if(action==='color'){style[paintTarget]=options.color;style[paintTarget+'Enabled']=true;}
  if(action==='none')style[paintTarget+'Enabled']=false;
  if(action==='restore')style[paintTarget+'Enabled']=true;
  if(action==='width')style.width=options.width;
  if(action==='swap'){[style.fill,style.stroke]=[style.stroke,style.fill];[style.fillEnabled,style.strokeEnabled]=[style.strokeEnabled,style.fillEnabled];}
  keepStyle();
 }
 function selectPaint(key){paintTarget=key;keepStyle();}
 function swapPaints(){if(selected().some(l=>!toolbarPaints(l,ink()).canSwap))return;changePaint('swap');}
 function syncPaints(){
  const layers=selected(),p=appearance(),all=layers.map(l=>toolbarPaints(l,ink()));
  paints.setAttribute('aria-label',layers.length?'Selected object appearance':'Next shape appearance');width.title=layers.length?'Selected object outline width (px)':'Outline width for the next shape (px)';
  for(const [key,button]of Object.entries(paintButtons)){
   const enabled=p[key+'Enabled'],mixed=all.some(other=>other[key]!==p[key]||other[key+'Enabled']!==enabled||(key==='fill'&&JSON.stringify(other.fillPaint)!==JSON.stringify(p.fillPaint)));
   button.classList.toggle('active',paintTarget===key);button.classList.toggle('no-paint',!enabled&&!mixed);button.classList.toggle('mixed-paint',mixed);button.style.setProperty('--paint-colour',p[key]);button.style.setProperty('--paint-preview',key==='fill'?paintPreview(p.fillPaint??{color:p.fill}):p.stroke);button.setAttribute('aria-pressed',String(paintTarget===key));button.title=paintName(key)+(mixed?' · Mixed':enabled?' · '+(key==='fill'&&p.fillPaint?.type!=='solid'&&p.fillPaint? p.fillPaint.type:p[key]):' · No colour')+' · Double-click to edit';button.disabled=key==='stroke'&&layers.length>0&&all.every(x=>!x.canStroke);inputs[key].value=p[key];
  }
  const strokeUnsupported=paintTarget==='stroke'&&layers.length>0&&all.every(x=>!x.canStroke);
  targetLabel.textContent=paintName(paintTarget);colour.style.setProperty('--paint-colour',p[paintTarget]);none.setAttribute('aria-pressed',String(!p[paintTarget+'Enabled']));colour.setAttribute('aria-pressed',String(p[paintTarget+'Enabled']));none.disabled=colour.disabled=strokeUnsupported;swap.disabled=layers.length>0&&all.some(x=>!x.canSwap);swap.title=swap.disabled?'Swap requires a single solid fill and an outline':'Swap fill and outline (Shift+X)';widthControl.sync(p.width,layers.length>0&&all.every(x=>!x.canStroke));
 }
 for(const key of ['fill','stroke']){
  const input=h('input',{type:'color',class:'drawing-colour-input',value:style[key],tabIndex:-1,'aria-label':`Drawing ${key} colour`,onInput:e=>{paintTarget=key;changePaint('color',{color:e.target.value});}});inputs[key]=input;
  const button=h('button',{type:'button',class:`drawing-swatch swatch-${key}`,'aria-label':`${paintName(key)} paint`,'aria-pressed':'false',onClick:()=>selectPaint(key),onDblclick:()=>{selectPaint(key);input.click();},onKeydown:e=>{if(e.key==='Enter'){e.preventDefault();selectPaint(key);input.click();}}},h('span',{class:'paint-face','aria-hidden':'true'}));paintButtons[key]=button;swatches.append(button,input);
 }
 const none=h('button',{type:'button',class:'drawing-paint-action no-colour',title:'No colour (/)','aria-label':'No colour','aria-pressed':'false',onClick:()=>{changePaint('none');}},icon('lucide/square-slash'));
 const colour=h('button',{type:'button',class:'drawing-paint-action restore-colour',title:'Use the last colour','aria-label':'Use colour','aria-pressed':'true',onClick:()=>{changePaint('restore');}},h('span',{'aria-hidden':'true'}));
 const swap=h('button',{type:'button',class:'drawing-swap',title:'Swap fill and outline (Shift+X)','aria-label':'Swap fill and outline colours',onClick:swapPaints},icon('lucide/arrow-left-right'));
 const widthControl=expandableNumberControl({value:style.width,label:'Drawing outline width',title:'Outline width',onChange:value=>changePaint('width',{width:value})}),width=widthControl.input;
 paints.append(swatches,swap,targetLabel,h('div',{class:'drawing-paint-actions',role:'group','aria-label':'Paint type'},colour,none),h('div',{class:'drawing-paint-width'},h('span',null,'px'),widthControl.el));toolbar.append(paints);syncPaints();

 function finish(closed=false){
  if(nodes.length<(closed?3:2)){toast(closed?'Add at least three points to close a vector.':'Add at least two points to draw a vector.');return;}
  const layer=drawingStyle(penVector(nodes,closed),style,{open:!closed});layer.name=closed?'Vector shape':'Vector path';clear();tool='select';lastFinish=Date.now();ed.addLayer('shape',layer);update();redraw();focus();
 }
 function render(){
  if(context!==null&&context!==contextKey())clear();syncPaints();update();
  if(!gesture&&!nodes.length)return false;
  const preview=svg('svg',{class:'drawing-preview',viewBox:`0 0 ${ed.scene.W} ${ed.scene.H}`,width:'100%',height:'100%','aria-hidden':'true'}),attrs={fill:'none',stroke:style.strokeEnabled?style.stroke:'none','stroke-width':style.width};
  if(gesture&&tool!=='pen'){
   const l=dragShape(tool,gesture.start,gesture.end,gesture.modifiers);
   if(tool==='line')preview.append(svg('path',{...attrs,d:l.paths[0].d}));else if(tool==='ellipse')preview.append(svg('ellipse',{...attrs,cx:l.cx,cy:l.cy,rx:l.w/2,ry:l.h/2,fill:style.fillEnabled?style.fill:'none'}));else preview.append(svg('rect',{...attrs,x:l.cx-l.w/2,y:l.cy-l.h/2,width:l.w,height:l.h,fill:style.fillEnabled?style.fill:'none'}));
  }else if(nodes.length){
   const outline=nodes.length>1?penPath(nodes):'';preview.append(svg('path',{...attrs,d:outline}));
   if(hover&&!gesture){preview.append(svg('path',{...attrs,d:penPath([nodes.at(-1),{point:[hover.x,hover.y]}]),'stroke-dasharray':'4 4',opacity:.6}));}
   for(const [i,n]of nodes.entries()){
    for(const handle of [n.in,n.out].filter(Boolean)){preview.append(svg('line',{x1:n.point[0],y1:n.point[1],x2:handle[0],y2:handle[1],stroke:'var(--accent)','stroke-width':1,'vector-effect':'non-scaling-stroke'}));preview.append(svg('circle',{cx:handle[0],cy:handle[1],r:3/scale(),fill:'var(--panel)',stroke:'var(--accent)','stroke-width':1/scale()}));}
    preview.append(svg('rect',{x:n.point[0]-4/scale(),y:n.point[1]-4/scale(),width:8/scale(),height:8/scale(),fill:i===0?'var(--accent)':'var(--panel)',stroke:'var(--accent)','stroke-width':1/scale()}));
   }
  }
  ed.overlay.append(preview);
  const message=tool==='pen'?'Click for corners · Drag for curves · Click first point to close · Enter to finish · Esc to cancel':'Drag to draw · Shift: square / circle / 45° · Option: from centre · Esc to cancel';
  ed.overlay.append(h('div',{class:'drawing-hint',role:'status'},message));return true;
 }
 function down(e){
  if(!ed.scene||tool==='select'||e.button!==0||e.target.closest('[data-handle]'))return false;
  if(tool==='points'||tool==='bend'){
   const hit=hitTest(point(e));if(['path','rect'].includes(hit?.shape)&&!hit.locked){ed.select(hit.id,{from:'stage',individual:true});if(hit.shape==='path')vectorEditor.enter(hit,null,{bend:tool==='bend'});update();}else toast('Select a vector path to edit its points.');consume(e);return true;
  }
  consume(e);focus();context=contextKey();const p=point(e);
  if(tool==='pen'){
   if(nodes.length>=3&&Math.hypot(p.x-nodes[0].point[0],p.y-nodes[0].point[1])*scale()<10){finish(true);return true;}
   if(nodes.length>=2&&Math.hypot(p.x-nodes.at(-1).point[0],p.y-nodes.at(-1).point[1])*scale()<3){finish();return true;}
   if(nodes.length>=2000){toast('Finish this path before adding more points.');return true;}
   nodes.push({point:[p.x,p.y]});gesture={start:p,end:p};
  }else{ed.select(null);gesture={start:p,end:p,modifiers:{shift:e.shiftKey,alt:e.altKey}};}
  ed.overlay.setPointerCapture(e.pointerId);redraw();return true;
 }
 function move(e){
  if(!ed.scene||!['pen','rect','ellipse','line'].includes(tool))return false;
  if(!gesture&&!nodes.length&&e.target.closest('[data-handle]'))return false;
  const p=point(e);hover=p;
  if(gesture){gesture.end=p;gesture.modifiers={shift:e.shiftKey,alt:e.altKey};if(tool==='pen'&&Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)*scale()>3){const node=nodes.at(-1);node.out=[p.x,p.y];node.in=[2*node.point[0]-p.x,2*node.point[1]-p.y];}}
  if(gesture||nodes.length)redraw();return true;
 }
 function up(e){
  if(!gesture)return false;consume(e);try{ed.overlay.releasePointerCapture(e.pointerId);}catch{}
  if(e.type==='pointercancel'){clear();redraw();return true;}
  const g=gesture;gesture=null;
  if(tool!=='pen'){
   const l=drawingStyle(dragShape(tool,g.start,g.end,g.modifiers),style,{open:tool==='line'});
   if(Math.hypot(g.end.x-g.start.x,g.end.y-g.start.y)*scale()>=3&&(tool==='line'||l.w>0&&l.h>0)){
    l.name=tool==='rect'?'Rectangle':tool==='ellipse'?'Ellipse':'Line';ed.addLayer('shape',l);
   }
  }
  redraw();return true;
 }
 function key(e){
  const mod=e.metaKey||e.ctrlKey,k=e.key.toLowerCase();
  if(!mod&&!e.altKey&&!e.repeat&&k==='x'){consume(e);if(e.shiftKey)swapPaints();else selectPaint(paintTarget==='fill'?'stroke':'fill');return true;}
  if(!mod&&!e.altKey&&!e.shiftKey&&e.key==='/'){consume(e);changePaint('none');return true;}
  if(nodes.length&&mod&&k==='z'){consume(e);nodes.pop();gesture=null;redraw();return true;}
  if(!mod&&!e.altKey&&!e.shiftKey&&!e.repeat){const id={v:'select',a:'points',r:'rect',o:'ellipse',l:'line',p:'pen',b:'bend'}[k];if(id){consume(e);choose(id);return true;}}
  if(e.key==='Escape'&&(tool!=='select'||gesture||nodes.length)){if(vectorEditor.dragging)return false;consume(e);choose('select');return true;}
  if(tool==='pen'&&e.key==='Enter'){consume(e);finish();return true;}
  if(nodes.length&&['Backspace','Delete'].includes(e.key)){consume(e);nodes.pop();gesture=null;redraw();return true;}
  return false;
 }
 update();return {toolbar,render,down,move,up,key,choose,double(){if(tool==='pen'){finish();return true;}return Date.now()-lastFinish<300;},get tool(){return tool;},get pending(){return Boolean(gesture||nodes.length);},get dragging(){return Boolean(gesture);},cancel(){clear();redraw();}};
}
