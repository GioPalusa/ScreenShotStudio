import { convertFigmaFrame, multiply } from './figma-layout.js';
const I=[1,0,0,1,0,0],number=(s,d=0)=>Number.isFinite(parseFloat(s))?parseFloat(s):d;
function matrix(text=''){
  let m=I;
  for(const match of text.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)){
    const a=match[2].trim().split(/[\s,]+/).map(Number);if(a.some(v=>!Number.isFinite(v)||Math.abs(v)>1e8))throw new Error('Invalid SVG transform.');
    const r=(a[0]??0)*Math.PI/180;let next;
    if(match[1]==='matrix'){if(a.length!==6)throw new Error('Invalid SVG matrix.');next=a;}
    if(match[1]==='translate')next=[1,0,0,1,a[0]??0,a[1]??0];
    if(match[1]==='scale')next=[a[0],0,0,a[1]??a[0],0,0];
    if(match[1]==='rotate'){next=[Math.cos(r),Math.sin(r),-Math.sin(r),Math.cos(r),0,0];if(a.length===3)next=multiply(multiply([1,0,0,1,a[1],a[2]],next),[1,0,0,1,-a[1],-a[2]]);}
    if(match[1]==='skewX')next=[1,0,Math.tan(r),1,0,0];
    if(match[1]==='skewY')next=[1,Math.tan(r),0,1,0,0];
    m=multiply(m,next);
  }
  return [[m[0],m[2],m[4]],[m[1],m[3],m[5]]];
}
/** Parse inert SVG into editable geometry. SVG is never embedded/executed as HTML. */
export function parseSVG(text){
  if(typeof text!=='string'||text.length>8*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Choose an SVG smaller than 8 MB without external entities.');
  const doc=new DOMParser().parseFromString(text,'image/svg+xml'),svg=doc.documentElement;
  if(svg.localName!=='svg'||doc.querySelector('parsererror'))throw new Error('The clipboard does not contain valid SVG.');
  if(doc.querySelector('script,foreignObject')||[...doc.querySelectorAll('*')].some(el=>[...el.attributes].some(a=>/^on/i.test(a.name))))throw new Error('SVG scripts and embedded HTML are not supported.');
  const view=(svg.getAttribute('viewBox')??'').trim().split(/[\s,]+/).map(Number),W=svg.getAttribute('width')?.endsWith('%')?view[2]:number(svg.getAttribute('width'),view[2]),H=svg.getAttribute('height')?.endsWith('%')?view[3]:number(svg.getAttribute('height'),view[3]);
  if(!(W>0&&H>0&&W<=12000&&H<=12000))throw new Error('SVG needs a valid width/height or viewBox.');
  let serial=0;const warnings=[];const styles=[],embeddedImages={};
  for(const style of doc.querySelectorAll('style'))for(const match of style.textContent.matchAll(/([^{}]+)\{([^{}]*)\}/g))styles.push([match[1].trim(),match[2]]);
  const declarations=text=>Object.fromEntries(text.split(';').map(x=>x.split(/:(.*)/s).slice(0,2)).filter(x=>x.length===2).map(([k,v])=>[k.trim(),v.trim()]));
  const meter=document.createElementNS('http://www.w3.org/2000/svg','svg');meter.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden';document.body.append(meter);
  const colorCanvas=document.createElement('canvas');colorCanvas.width=colorCanvas.height=1;const ctx=colorCanvas.getContext('2d',{willReadFrequently:true});
  const color=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle='#000';ctx.fillStyle=value.replace(/var\([^,]+,\s*([^)]*)\)/g,'$1');ctx.fillRect(0,0,1,1);const c=ctx.getImageData(0,0,1,1).data;return {r:c[0]/255,g:c[1]/255,b:c[2]/255,a:c[3]/255};};
  function paint(value,opacity=1){
    if(!value||value==='none')return [];
    const local=/^url\(["']?#([^)'"\s]+)["']?\)$/.exec(value);
    if(value.includes('url(')&&!local)throw new Error('External SVG resources are not imported.');
    if(local){const gradient=doc.getElementById(local[1]);
      if(gradient?.localName==='pattern'){
        const use=gradient.querySelector('use'),ref=use?.getAttribute('href')??use?.getAttribute('xlink:href'),image=ref?.startsWith('#')?doc.getElementById(ref.slice(1)):gradient.querySelector('image'),href=image?.getAttribute('href')??image?.getAttribute('xlink:href');
        const data=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(href??'');
        if(data){const id=`svg-image-pattern-${serial}`;embeddedImages[id]={mime:data[1],data:data[2]};return [{type:'IMAGE',imageRef:id,scaleMode:'FILL'}];}
      }
      if(!gradient||!['linearGradient','radialGradient'].includes(gradient.localName)){warnings.push(`SVG paint #${local[1]} is not supported.`);return [];}
      const n=(name,d)=>{const v=gradient.getAttribute(name);return v?.endsWith('%')?number(v)/100:number(v,d);};
      return [{type:gradient.localName==='linearGradient'?'GRADIENT_LINEAR':'GRADIENT_RADIAL',opacity,svgUnits:gradient.getAttribute('gradientUnits'),svgTransform:matrix(gradient.getAttribute('gradientTransform')??''),gradientHandlePositions:gradient.localName==='linearGradient'?[{x:n('x1',0),y:n('y1',0)},{x:n('x2',1),y:n('y2',0)},{x:0,y:1}]:[{x:n('cx',.5),y:n('cy',.5)},{x:n('cx',.5)+n('r',.5),y:n('cy',.5)},{x:n('cx',.5),y:n('cy',.5)+n('r',.5)}],gradientStops:[...gradient.querySelectorAll('stop')].map(stop=>{const s=declarations(stop.getAttribute('style')??'');return {position:stop.getAttribute('offset')?.endsWith('%')?number(stop.getAttribute('offset'))/100:number(stop.getAttribute('offset')),color:{...color(s['stop-color']??stop.getAttribute('stop-color')??'#000'),a:number(s['stop-opacity']??stop.getAttribute('stop-opacity'),1)}};})}];
    }
    return [{type:'SOLID',color:color(value),opacity}];
  }
  function styleFor(el,inherited){
    const style={...inherited};for(const [selector,css] of styles){try{if(el.matches(selector))Object.assign(style,declarations(css));}catch{/* unsupported selector */}}
    for(const attr of ['fill','stroke','stroke-width','fill-rule','fill-opacity','stroke-opacity','font-family','font-size','font-weight','font-style','letter-spacing','text-anchor','display','visibility'])if(el.hasAttribute(attr))style[attr]=el.getAttribute(attr);
    Object.assign(style,declarations(el.getAttribute('style')??''));
    return style;
  }
  function convert(el,inherited={},depth=0){
    if(++serial>5000||depth>64)throw new Error('SVG has too many layers or nested groups.');
    const tag=el.localName;if(['defs','style','title','desc','metadata','linearGradient','radialGradient','clipPath','mask'].includes(tag))return null;
    const style=styleFor(el,inherited);
    const node={id:`svg-${serial}`,name:el.getAttribute('id')??el.getAttribute('aria-label')??tag,type:'GROUP',relativeTransform:matrix(el.getAttribute('transform')??''),opacity:number(el.getAttribute('opacity')??style.opacity,1),visible:style.display!=='none'&&style.visibility!=='hidden',fills:paint(style.fill??'#000',number(style['fill-opacity'],1)),strokes:paint(style.stroke??'none',number(style['stroke-opacity'],1)),strokeWeight:number(style['stroke-width'],1)};
    const origin=[0,0],translate=(x,y)=>{origin[0]+=x;origin[1]+=y;const m=node.relativeTransform;const p=multiply([m[0][0],m[1][0],m[0][1],m[1][1],m[0][2],m[1][2]],[1,0,0,1,x,y]);node.relativeTransform=[[p[0],p[2],p[4]],[p[1],p[3],p[5]]];};
    if(['g','svg','a','symbol'].includes(tag)){node.fills=[];node.strokes=[];node.children=[...el.children].map(c=>convert(c,{...style,opacity:undefined},depth+1)).filter(Boolean);}
    else if(tag==='rect'){node.type='RECTANGLE';node.size={x:number(el.getAttribute('width')),y:number(el.getAttribute('height'))};translate(number(el.getAttribute('x')),number(el.getAttribute('y')));node.cornerRadius=number(el.getAttribute('rx'));}
    else if(tag==='circle'||tag==='ellipse'){const rx=number(el.getAttribute(tag==='circle'?'r':'rx')),ry=number(el.getAttribute(tag==='circle'?'r':'ry'));node.type='ELLIPSE';node.size={x:rx*2,y:ry*2};translate(number(el.getAttribute('cx'))-rx,number(el.getAttribute('cy'))-ry);}
    else if(['path','line','polyline','polygon'].includes(tag)){
      let d=el.getAttribute('d');if(tag==='line')d=`M${number(el.getAttribute('x1'))} ${number(el.getAttribute('y1'))}L${number(el.getAttribute('x2'))} ${number(el.getAttribute('y2'))}`;
      if(tag==='polyline'||tag==='polygon'){const points=(el.getAttribute('points')??'').trim();d=`M${points}${tag==='polygon'?'Z':''}`;}
      if(!d||!/^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+\-]*$/.test(d))throw new Error('SVG contains an invalid vector path.');
      const path=document.createElementNS(meter.namespaceURI,'path');path.setAttribute('d',d);meter.append(path);const b=path.getBBox();path.remove();node.type='VECTOR';node.size={x:Math.max(b.width,.001),y:Math.max(b.height,.001)};node.pathOffset=[b.x,b.y];translate(b.x,b.y);node.fillGeometry=[{path:d,windingRule:style['fill-rule']==='evenodd'?'EVENODD':'NONZERO'}];
    }else if(tag==='image'){
      const href=el.getAttribute('href')??el.getAttribute('xlink:href'),data=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(href??'');
      if(!data)throw new Error('SVG images must be embedded PNG, JPEG or WebP; external images are not fetched.');
      if(data[2].length>32*1024*1024*4/3)throw new Error('An embedded SVG image exceeds 32 MB.');
      const ref=`svg-image-${serial}`;embeddedImages[ref]={mime:data[1],data:data[2]};node.type='RECTANGLE';node.size={x:number(el.getAttribute('width')),y:number(el.getAttribute('height'))};node.fills=[{type:'IMAGE',imageRef:ref,scaleMode:'FIT'}];node.strokes=[];translate(number(el.getAttribute('x')),number(el.getAttribute('y')));
    }else if(tag==='text'&&el.querySelector('tspan')){
      node.fills=[];node.strokes=[];node.children=[];
      const cursor={x:number(el.getAttribute('x')),y:number(el.getAttribute('y'))};
      function runs(parent,inherited,level){
        if(level>64)throw Error('SVG has too many nested text spans.');
        const current=styleFor(parent,inherited);
        if(parent.hasAttribute('x'))cursor.x=number(parent.getAttribute('x'));
        if(parent.hasAttribute('y'))cursor.y=number(parent.getAttribute('y'));
        cursor.x+=number(parent.getAttribute('dx'));cursor.y+=number(parent.getAttribute('dy'));
        for(const child of parent.childNodes){
          if(child.nodeType===1){if(child.localName==='tspan')runs(child,current,level+1);else warnings.push(`SVG text ${child.localName} is not supported.`);}
          else if(child.nodeType===3&&child.textContent&&!(child.textContent.includes('\n')&&!child.textContent.trim())){
            const run=doc.createElementNS(svg.namespaceURI,'text');run.textContent=child.textContent.replace(/\s+/g,' ');run.setAttribute('x',cursor.x);run.setAttribute('y',cursor.y);
            const converted=convert(run,{...current,opacity:undefined},level+1);node.children.push(converted);cursor.x+=converted.textAdvance??converted.size.x;
          }
        }
      }
      runs(el,style,depth);
    }else if(tag==='text'){
      const size=number(style['font-size'],16),families=(style['font-family']??'sans-serif').split(',').map(f=>f.trim().replace(/^['"]|['"]$/g,''));
      let family=families[0];if(families[1]&&family.replace(/-(?:Bold|Regular|Medium|SemiBold|Heavy|Black|Light|Italic|Oblique|Roman)$/i,'').replace(/\s/g,'').toLowerCase()===families[1].replace(/\s/g,'').toLowerCase())family=families[1];
      const spacing=number(style['letter-spacing'])*(String(style['letter-spacing']).endsWith('em')?size:1);
      // SVG text has no wrapping box. Allow subpixel font-size rounding after scaling.
      node.type='TEXT';node.characters=el.textContent;node.style={fontFamily:family,fontSize:size,fontWeight:number(style['font-weight'],style['font-weight']==='bold'?700:400),italic:style['font-style']==='italic',lineHeightPx:size*1.2,letterSpacing:spacing,textAlignHorizontal:'LEFT',baselineOffset:size};ctx.font=`${node.style.italic?'italic ':''}${node.style.fontWeight} ${size}px ${JSON.stringify(family)}`;ctx.letterSpacing=`${spacing}px`;const w=ctx.measureText(node.characters).width;ctx.letterSpacing='0px';node.size={x:Math.max(w+.5,1),y:size*1.2};node.textAdvance=w;translate(number(el.getAttribute('x'))-(style['text-anchor']==='middle'?w/2:style['text-anchor']==='end'?w:0),number(el.getAttribute('y'))-size);
    }else if(tag==='use'){
      const ref=el.getAttribute('href')??el.getAttribute('xlink:href');if(!ref?.startsWith('#'))throw new Error('External SVG references are not supported.');const target=doc.getElementById(ref.slice(1));if(!target)throw new Error('An SVG reference is missing.');node.fills=[];node.strokes=[];node.children=[convert(target,style,depth+1)].filter(Boolean);translate(number(el.getAttribute('x')),number(el.getAttribute('y')));
    }else{warnings.push(`SVG ${tag} is not supported and was omitted.`);return null;}
    for(const p of [...node.fills,...node.strokes])if(p.gradientHandlePositions){const m=p.svgTransform;p.gradientHandlePositions=p.gradientHandlePositions.map(h=>{const x=m[0][0]*h.x+m[0][1]*h.y+m[0][2],y=m[1][0]*h.x+m[1][1]*h.y+m[1][2];return p.svgUnits==='userSpaceOnUse'?{x:(x-origin[0])/(node.size?.x??W),y:(y-origin[1])/(node.size?.y??H)}:{x,y};});}
    if(el.getAttribute('clip-path')){
      const id=/^url\(["']?#([^)'"\s]+)["']?\)$/.exec(el.getAttribute('clip-path'))?.[1],def=id?doc.getElementById(id):null;
      const child=def?.children?.length===1?convert(def.children[0],{fill:'#fff',stroke:'none'},depth+1):null;
      if(child&&child.type!=='GROUP'){child.isMask=true;const transform=node.relativeTransform;node.relativeTransform=[[1,0,0],[0,1,0]];return {id:`svg-clip-${serial}`,name:'Clipped vectors',type:'GROUP',relativeTransform:transform,children:[child,node]};}
      warnings.push('A complex SVG clip needs review; vector geometry is retained.');
    }
    if(el.getAttribute('mask')||el.getAttribute('filter'))warnings.push('SVG masks and filters need review; vector geometry is retained.');
    return node;
  }
  try{
    const content=convert(svg,{fill:'#000'});
    if(view.length===4&&view[2]>0&&view[3]>0){const aspect=svg.getAttribute('preserveAspectRatio')??'xMidYMid meet',sx=W/view[2],sy=H/view[3],k=aspect.includes('slice')?Math.max(sx,sy):Math.min(sx,sy),a=aspect==='none'?sx:k,b=aspect==='none'?sy:k,dx=(W-view[2]*a)*(aspect.includes('xMin')?0:aspect.includes('xMax')?1:.5),dy=(H-view[3]*b)*(aspect.includes('YMin')?0:aspect.includes('YMax')?1:.5);content.relativeTransform=[[a,0,dx-view[0]*a],[0,b,dy-view[1]*b]];}
    const design=convertFigmaFrame({id:'svg',type:'FRAME',name:'Pasted SVG',size:{x:Math.round(W),y:Math.round(H)},fills:[],children:[content]},{minSize:1});design.warnings.push(...new Set(warnings));design.embeddedImages=embeddedImages;return design;
  }finally{meter.remove();}
}
