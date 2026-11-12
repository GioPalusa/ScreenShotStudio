// Copy as code -> CSS, or plain CSS properties. Never executes supplied code.
export function parseFigmaProperties(text){
  if(typeof text!=='string'||text.length>100000)return null;
  const css=text.replace(/\/\*[\s\S]*?\*\//g,''),values=new Map([...css.matchAll(/(?:^|[;{\n])\s*([a-z-]+)\s*:\s*([^;{}]+)/gi)].map(m=>[m[1].toLowerCase(),m[2].trim()]));
  const patch={},numeric=(property,key)=>{const value=values.get(property);if(value&&/^-?[\d.]+(?:px|deg)?$/.test(value)&&Number.isFinite(parseFloat(value)))patch[key]=parseFloat(value);};
  numeric('width','w');numeric('height','h');numeric('left','x');numeric('top','y');numeric('opacity','opacity');numeric('border-radius','radius');numeric('font-size','size');numeric('font-weight','weight');numeric('letter-spacing','letterSpacing');
  const family=values.get('font-family');if(family&&!/[;{}<>]/.test(family))patch.fontFamily=family.replace(/^['"]|['"]$/g,'');
  const color=value=>value&&/^(?:#[a-f\d]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]+)$/i.test(value)?value:undefined;
  const fill=color(values.get('background')??values.get('background-color')),ink=color(values.get('color'));
  if(fill)patch.fill=fill;if(ink)patch.color=ink;
  const border=values.get('border')?.match(/^([\d.]+)px\s+solid\s+(.+)$/i);if(border&&color(border[2]))patch.stroke={width:Number(border[1]),color:border[2]};
  const rotate=values.get('transform')?.match(/^rotate\((-?[\d.]+)deg\)$/);if(rotate)patch.rotate=Number(rotate[1]);
  const lh=values.get('line-height');if(lh&&/^[\d.]+(?:px)?$/.test(lh))patch.lineHeight=lh.endsWith('px')&&patch.size?parseFloat(lh)/patch.size:parseFloat(lh);
  return Object.keys(patch).length?patch:null;
}
export function propertiesForLayer(layer,properties){
  const patch={};for(const key of ['opacity','rotate','w','fontFamily'])if(properties[key]!==undefined&&(key!=='fontFamily'||layer.type==='text'))patch[key]=properties[key];
  if(layer.type==='text'){
    for(const key of ['x','size','weight','color','lineHeight'])if(properties[key]!==undefined)patch[key]=properties[key];
    if(properties.y!==undefined)patch.capTop=properties.y;if(properties.h!==undefined)patch.boxHeight=properties.h;
    if(properties.size!==undefined)patch.minSize=properties.size;
  }else{
    if(properties.h!==undefined)patch.h=properties.h;
    if(properties.x!==undefined)patch.cx=properties.x+(properties.w??layer.w??0)/2;
    if(properties.y!==undefined)patch.cy=properties.y+(properties.h??layer.h??0)/2;
    if(layer.type==='shape'){for(const key of ['fill','radius','stroke'])if(properties[key]!==undefined)patch[key]=properties[key];if(properties.fill!==undefined)patch.paints=undefined;if(properties.radius!==undefined)patch.radii=undefined;}
  }
  return patch;
}
