import { parentPort, workerData } from 'node:worker_threads';
import { decodeFigKiwiCanvas } from '@open-pencil/kiwi/fig/parse';
import { convertFigmaFrame } from '../app/js/figma-layout.js';

const id = guid => guid ? `${guid.sessionID}:${guid.localID}` : '';
const identity = { m00:1,m01:0,m02:0,m10:0,m11:1,m12:0 };
const matrix = m => [[m.m00,m.m01,m.m02],[m.m10,m.m11,m.m12]];
const weight = style => /black|heavy/i.test(style)?900:/extra.?bold/i.test(style)?800:/semi.?bold|demi/i.test(style)?600:/bold/i.test(style)?700:/medium/i.test(style)?500:/extra.?light|ultra.?light/i.test(style)?200:/light/i.test(style)?300:/thin/i.test(style)?100:400;

function pathFromBlob(bytes) {
  if (!bytes || bytes.length > 4*1024*1024) throw Error('Vector geometry is unavailable in this clipboard selection.');
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), parts=[]; let at=0;
  while(at<bytes.length){
    const op=bytes[at++],cmd={0:['Z',0],1:['M',2],2:['L',2],3:['Q',4],4:['C',6]}[op];
    if(!cmd || at+cmd[1]*4>bytes.length)throw Error('Unsupported clipboard vector command.');
    const numbers=[];for(let i=0;i<cmd[1];i++){const n=view.getFloat32(at,true);at+=4;if(!Number.isFinite(n))throw Error('Invalid vector coordinate.');numbers.push(n);}
    parts.push(cmd[0]+numbers.join(' '));
  }
  return parts.join(' ');
}

// Figma clipboard networks store vertices, cubic tangents and region segment loops.
function networkPaths(node, blobs) {
  const bytes=blobs[node.vectorData?.vectorNetworkBlob];if(!bytes)return [];
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
  const read=(float=false)=>{if(at+4>bytes.length)throw Error('Incomplete clipboard vector network.');const n=float?view.getFloat32(at,true):view.getUint32(at,true);at+=4;if(!Number.isFinite(n))throw Error('Invalid vector network coordinate.');return n;};
  const nv=read(),ns=read(),nr=read();if(nv>100000||ns>100000||nr>10000)throw Error('Copy a smaller vector network.');
  const normalized=node.vectorData?.normalizedSize,sx=normalized?.x>0?node.size.x/normalized.x:1,sy=normalized?.y>0?node.size.y/normalized.y:1;
  const vertices=Array.from({length:nv},()=>{read();return [read(true)*sx,read(true)*sy];});
  const segments=Array.from({length:ns},()=>{read();const a=read(),ta=[read(true)*sx,read(true)*sy],b=read(),tb=[read(true)*sx,read(true)*sy];if(!vertices[a]||!vertices[b])throw Error('Invalid vector endpoint.');return {a,b,ta,tb};});
  function trace(indices,closed){
    if(!indices.length)return '';const remaining=new Set(indices);if(remaining.size!==indices.length)throw Error('Unsupported repeated vector edge.');
    let current=null,start=null,out='';
    while(remaining.size){let index,reverse=false;
      for(const i of remaining){const s=segments[i];if(!s)throw Error('Invalid vector edge.');if(current===null||s.a===current||s.b===current){index=i;reverse=current!==null&&s.b===current;break;}}
      if(index===undefined){if(closed)throw Error('Disconnected vector region.');current=null;continue;}
      remaining.delete(index);const s=segments[index],a=reverse?s.b:s.a,b=reverse?s.a:s.b,ta=reverse?s.tb:s.ta,tb=reverse?s.ta:s.tb,p=vertices[a],q=vertices[b];
      if(current===null){out+=`M${p.join(' ')} `;start=a;}
      out+=ta.some(Boolean)||tb.some(Boolean)?`C${p[0]+ta[0]} ${p[1]+ta[1]} ${q[0]+tb[0]} ${q[1]+tb[1]} ${q.join(' ')} `:`L${q.join(' ')} `;current=b;
      if(current===start){if(closed)out+='Z ';current=null;}
    }
    return out.trim();
  }
  const paths=[];for(let r=0;r<nr;r++){const style=read(),loops=read();if(loops>10000)throw Error('Too many vector loops.');let path='';for(let l=0;l<loops;l++){const count=read();if(count>ns)throw Error('Invalid vector loop.');path+=trace(Array.from({length:count},()=>read()),true)+' ';}paths.push({path:path.trim(),windingRule:style&1?'NONZERO':'EVENODD'});}
  if(!paths.length&&segments.length)paths.push({path:trace(segments.map((_,i)=>i),false),windingRule:'NONZERO'});
  return paths;
}

function convert(html) {
  const encoded=html.match(/\(figma\)([A-Za-z0-9+/=\s]+)\(\/figma\)/)?.[1];
  if(!encoded)throw Error('No native Figma selection was found.');
  const {nodeChanges,blobs}=decodeFigKiwiCanvas(Buffer.from(encoded,'base64'));
  if(nodeChanges.length>10000 || blobs.reduce((n,b)=>n+b.length,0)>128*1024*1024)throw Error('Copy a smaller Figma selection.');
  const images={}, byId=new Map(), warnings=new Set();
  const paths = list => (list??[]).map(p=>({path:pathFromBlob(blobs[p.commandsBlob]),windingRule:p.windingRule==='ODD'?'EVENODD':p.windingRule}));
  function paints(list){return (list??[]).map(p=>{
    if(p.type==='IMAGE'){
      const bytes=blobs[p.image?.dataBlob];if(!bytes)throw Error('The copied image is not embedded. Import this selection through its Figma link instead.');
      const ref=`clipboard-image-${p.image.dataBlob}`,data=Buffer.from(bytes),magic=data.subarray(0,8).toString('hex');
      const mime=magic==='89504e470d0a1a0a'?'image/png':data[0]===255&&data[1]===216?'image/jpeg':data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP'?'image/webp':null;
      if(!mime)throw Error('The clipboard image format is not supported.');images[ref]={mime,data:data.toString('base64')};
      return {...p,imageRef:ref,scaleMode:p.imageScaleMode??'FILL',imageTransform:p.transform?matrix(p.transform):undefined};
    }
    if(p.type?.startsWith('GRADIENT')){
      const t=p.transform??identity,det=t.m00*t.m11-t.m01*t.m10;
      if(!det)throw Error('Invalid clipboard gradient.');
      const point=(x,y)=>({x:(t.m11*(x-t.m02)-t.m01*(y-t.m12))/det,y:(-t.m10*(x-t.m02)+t.m00*(y-t.m12))/det});
      return {...p,gradientStops:p.stops,gradientHandlePositions:[point(0,.5),point(1,.5),point(0,1.5)]};
    }
    return p;
  });}
  for(const n of nodeChanges){
    if(!n.guid || n.styleType || n.phase==='REMOVED' || ['DOCUMENT','CANVAS','STYLE','STYLE_SET','VARIABLE','VARIABLE_SET','VARIABLE_COLLECTION','INTERNAL_ONLY_NODE'].includes(n.type))continue;
    const m=n.transform??identity,styleName=n.fontName?.style??'';
    if(n.type==='INSTANCE')warnings.add('Clipboard component instances need review; source geometry is retained when embedded.');
    const line=n.lineHeight,spacing=n.letterSpacing;
    const node={id:id(n.guid),type:n.type==='ROUNDED_RECTANGLE'?'RECTANGLE':n.type==='SYMBOL'?'COMPONENT':n.type,name:n.name,size:n.size,relativeTransform:matrix(m),absoluteBoundingBox:{x:m.m02,y:m.m12,width:n.size?.x??1,height:n.size?.y??1},visible:n.visible,opacity:n.opacity,blendMode:n.blendMode,cornerRadius:n.cornerRadius,rectangleCornerRadii:n.rectangleCornerRadii,clipsContent:n.clipsContent??(n.type==='FRAME'&&n.frameMaskDisabled!==true),isMask:n.mask,fills:paints(n.fillPaints??n.backgroundPaints),strokes:paints(n.strokePaints),strokeWeight:n.strokeWeight,strokeAlign:n.strokeAlign,effects:n.effects?.map(e=>({...e,type:e.type==='FOREGROUND_BLUR'?'LAYER_BLUR':e.type})),fillGeometry:n.fillGeometry?.length?paths(n.fillGeometry):networkPaths(n,blobs),strokeGeometry:paths(n.strokeGeometry),characters:n.textData?.characters,style:{fontFamily:n.fontName?.family??'sans-serif',fontSize:n.fontSize??24,fontWeight:n.fontWeight??weight(styleName),italic:/italic|oblique/i.test(styleName),textAlignHorizontal:n.textAlignHorizontal,textAlignVertical:n.textAlignVertical,lineHeightPx:line?.units==='PIXELS'?line.value:n.derivedTextData?.baselines?.[0]?.lineHeight,lineHeightUnit:line?.units==='PERCENT'?'FONT_SIZE_%':'PIXELS',lineHeightPercentFontSize:line?.units==='PERCENT'?line.value:undefined,letterSpacing:spacing?.units==='PERCENT'?(n.fontSize??24)*spacing.value/100:spacing?.value??0},children:[],_parent:id(n.parentIndex?.guid),_position:n.parentIndex?.position??''};
    if(n.textData?.styleOverrideTable?.length)node.characterStyleOverrides=n.textData.characterStyleIDs;
    byId.set(node.id,node);
  }
  const roots=[];
  for(const node of byId.values()){const parent=byId.get(node._parent);if(parent)parent.children.push(node);else roots.push(node);}
  const visit=(node,depth=0)=>{if(depth>64)throw Error('Copy fewer nested groups.');node.children.sort((a,b)=>a._position.localeCompare(b._position));for(const child of node.children)visit(child,depth+1);delete node._parent;delete node._position;};
  roots.forEach(n=>visit(n));if(!roots.length)throw Error('The clipboard has no supported design layers.');
  let root=roots[0];
  if(roots.length>1){
    const x=Math.min(...roots.map(n=>n.absoluteBoundingBox.x)),y=Math.min(...roots.map(n=>n.absoluteBoundingBox.y)),right=Math.max(...roots.map(n=>n.absoluteBoundingBox.x+n.size.x)),bottom=Math.max(...roots.map(n=>n.absoluteBoundingBox.y+n.size.y));
    for(const n of roots){n.relativeTransform[0][2]-=x;n.relativeTransform[1][2]-=y;}
    root={id:'clipboard',name:'Figma selection',type:'FRAME',size:{x:right-x,y:bottom-y},children:roots};
  }
  const design=convertFigmaFrame(root,{minSize:1});design.width=Math.max(100,design.width);design.height=Math.max(100,design.height);design.warnings.push(...warnings);
  return {designs:[{id:root.id,...design}],images};
}

try { parentPort.postMessage({result:convert(workerData)}); }
catch(error) { parentPort.postMessage({error:error.message}); }
