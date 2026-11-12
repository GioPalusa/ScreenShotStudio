import { figmaURL, figmaFrames, findFigmaNode, convertFigmaFrame,isFigmaNodeId } from '../app/js/figma-layout.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function bytes(response,limit){const chunks=[];let size=0;for await(const chunk of response.body??[]){size+=chunk.length;if(size>limit)throw fail(502,'The Figma response is too large. Import fewer views.');chunks.push(chunk);}return Buffer.concat(chunks);}
/** Read-only Figma REST adapter. Credentials never enter documents, caches or logs. */
export async function importFigma(input,{fetchImpl=fetch,signal}={}){
  const {url,token,action='inspect',ids=[],version}=input??{};
  let fileKey,nodeId;try{({fileKey,nodeId}=figmaURL(url));}catch(error){throw fail(400,error.message);}
  if(typeof token!=='string'||!token.trim()||token.length>2048||/[\r\n]/.test(token))throw fail(400,'Enter a Figma personal access token with file_content:read access.');
  if(!['inspect','load'].includes(action)||!Array.isArray(ids)||ids.length>100||ids.some(id=>!isFigmaNodeId(id))||version!=null&&(typeof version!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(version)))throw fail(400,'Invalid Figma import selection.');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
  async function json(endpoint){
    const response=await fetchImpl(`https://api.figma.com/v1/${endpoint}`,{headers:{'X-Figma-Token':token.trim()},redirect:'error',signal:combined});
    if(!response.ok){
      let auth=response.status===401;
      if(response.status===403){try{const body=JSON.parse((await bytes(response,64000)).toString());auth=/invalid.*token|token.*(?:expired|invalid|revoked)|expired.*token/i.test(String(body.err??body.message??''));}catch{}}else await response.body?.cancel();
      if(auth)throw Object.assign(fail(401,'The Figma key is invalid, expired or revoked. Replace the key to continue.'),{code:'figma-auth'});
      throw fail(response.status===429?429:response.status===403?403:502,response.status===403?'This key cannot read the file. Check file_content:read permission and file access. The saved key has not been removed.':response.status===404?'Figma could not find this file or frame.':response.status===429?'Figma’s rate limit was reached. Try again later.':'Figma could not load this design.');
    }
    try{return JSON.parse((await bytes(response,32*1024*1024)).toString('utf8'));}catch(error){if(error.status)throw error;throw fail(502,'Figma returned an invalid response.');}
  }
  try{
    if(action==='inspect'){
      const data=await json(nodeId?`files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&geometry=paths`:`files/${fileKey}?depth=2`);
      const frames=figmaFrames(data);if(!frames.length)throw fail(400,'No frames were found. Paste a link to a Figma Design frame.');
      return {name:String(data.name??'Figma'),version:data.version,frames};
    }
    const selected=ids.length?ids:nodeId?[nodeId]:[];if(!selected.length)throw fail(400,'Choose at least one Figma view.');
    const data=await json(`files/${fileKey}/nodes?ids=${encodeURIComponent(selected.join(','))}&geometry=paths${version?`&version=${encodeURIComponent(version)}`:''}`);
    const designs=selected.map(id=>{const node=findFigmaNode(data,id);if(!node)throw fail(400,'A selected Figma view is unavailable. Load the file again.');const design=convertFigmaFrame(node,{minSize:1});if(design.width<100||design.height<100){design.width=Math.max(100,design.width);design.height=Math.max(100,design.height);design.warnings.push('This small selection is placed at its original size on a canvas of at least 100 × 100 px.');}return {id,...design};});
    if(designs.reduce((n,d)=>n+d.layers.length,0)>10000)throw fail(400,'Import up to 10000 layers at a time.');
    const refs=new Set(designs.flatMap(d=>d.images)),images=Object.create(null);let total=0;
    if(refs.size){
      const sources=await json(`files/${fileKey}/images`);
      for(const ref of refs){
        const location=sources.meta?.images?.[ref];let asset;
        try{asset=new URL(location);}catch{throw fail(502,'A Figma image is unavailable.');}
        if(asset.protocol!=='https:'||asset.username||asset.password||asset.port||!(/(?:^|\.)figma\.com$/.test(asset.hostname)||/^figma[^.]*\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(asset.hostname)||/^s3[-.][a-z0-9-]+\.amazonaws\.com$/.test(asset.hostname)))throw fail(502,'Figma returned an unsupported image location.');
        const response=await fetchImpl(asset.href,{redirect:'error',signal:combined});
        if(!response.ok){await response.body?.cancel();throw fail(502,'A Figma image could not be downloaded.');}
        const image=await bytes(response,32*1024*1024);total+=image.length;if(total>128*1024*1024)throw fail(502,'The Figma images exceed 128 MB. Import fewer views.');
        const mime=image.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'image/png':image[0]===255&&image[1]===216?'image/jpeg':image.subarray(0,4).toString()==='RIFF'&&image.subarray(8,12).toString()==='WEBP'?'image/webp':null;
        if(!mime)throw fail(502,'A Figma image has an unsupported format.');
        images[ref]={mime,data:image.toString('base64')};
      }
    }
    return {designs,images};
  }catch(error){if(error.status)throw error;throw fail(502,combined.aborted?'Figma import cancelled or timed out.':'Could not read Figma. Check the connection and file access.');}
}
