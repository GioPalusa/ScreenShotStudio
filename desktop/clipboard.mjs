// Native clipboard formats stay in the host. Read only in response to a paste action.
const SVG_FORMATS=['com.adobe.illustrator.svg','com.adobe.illustrator.svgm','public.svg-image','com.adobe.svg'];
const isSVG=text=>/^\s*(?:(?:<\?xml[^>]*>|<!--[\s\S]*?-->)\s*)*<svg[\s>]/i.test(text);
export async function readDesignClipboard(clipboard) {
  const items=await clipboard.read(),result={};
  const read=async(item,type,limit)=>{
    const blob=await item.getType(type);
    if(blob.size>limit)throw Error('The copied artwork exceeds the clipboard size limit.');
    return blob;
  };
  for(const item of items)for(const type of ['text/plain','text/html'])if(item.types.includes(type)&&!result[type])result[type]=await(await read(item,type,type==='text/html'?34*1024*1024:8*1024*1024)).text();
  for(const item of items){
    const types=[...SVG_FORMATS.map(format=>`electron application/osclipboard;format="${format}"`),'image/svg+xml'];
    for(const type of types)if(item.types.includes(type)){
      const blob=await item.getType(type);
      if(blob.size>8*1024*1024){if(type==='image/svg+xml')continue;throw Error('The copied artwork exceeds the clipboard size limit.');}
      const text=await blob.text();
      // Some macOS providers advertise SVG but Electron returns raster bytes for that MIME.
      if(isSVG(text)){result.svg=text;break;}
    }
    if(result.svg)break;
  }
  if(!result.svg)for(const item of items){
    const type='electron application/osclipboard;format="com.adobe.cc-text-interchange"';
    if(item.types.includes(type)){
      const value=await(await read(item,type,8*1024*1024)).text();if(value.trim()){result.adobeText=value;break;}
    }
  }
  if(!result.svg&&!result.adobeText)for(const item of items){
    for(const type of ['image/webp','image/png','image/jpeg'])if(item.types.includes(type)){
      const bytes=Buffer.from(await(await read(item,type,32*1024*1024)).arrayBuffer());
      const mime=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null;
      if(mime){result.image={mime,data:bytes.toString('base64')};break;}
    }
    if(result.image)break;
  }
  return {text:result['text/plain']??'',html:result['text/html']??'',...(result.svg?{svg:result.svg}:{}),...(result.adobeText?{adobeText:result.adobeText}:{}),...(result.image?{image:result.image}:{})};
}
