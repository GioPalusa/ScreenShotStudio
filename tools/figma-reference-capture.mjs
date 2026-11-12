// Developer verification only. The native Keychain adapter supplies authentication
// in memory; credentials and expiring download URLs are never logged or saved.
import fs from 'node:fs';
import path from 'node:path';
import { createFigmaKeychain,createFigmaSettings } from '../desktop/figma-settings.mjs';
import { figmaURL,figmaFrames,findFigmaNode,convertFigmaFrame } from '../app/js/figma-layout.js';
const [url,out,appRoot]=process.argv.slice(2);
if(!url||!out||!appRoot)throw Error('Usage: node tools/figma-reference-capture.mjs FIGMA_URL OUTPUT_FOLDER PACKAGED_APP_RESOURCE_ROOT');
const {fileKey}=figmaURL(url),destination=path.resolve(out);
if(destination.startsWith(path.resolve('.')+path.sep))throw Error('Keep user design references outside the repository.');
fs.mkdirSync(destination,{recursive:true});
const connection=createFigmaSettings({keychain:createFigmaKeychain({root:appRoot,userData:'',packaged:true})});
const safeAsset=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!(/(?:^|\.)figma\.com$/.test(u.hostname)||/^figma[^.]*\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)||/^s3[-.][a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)))throw Error('Unsupported Figma asset host.');return u;};
const getBytes=async response=>{if(!response.ok)throw Error(`Figma asset HTTP ${response.status}`);const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>64*1024*1024)throw Error('Reference asset exceeds 64 MB.');return bytes;};
await connection.request({},async({token})=>{
 const json=async endpoint=>{const r=await fetch(`https://api.figma.com/v1/${endpoint}`,{headers:{'X-Figma-Token':token},redirect:'error',signal:AbortSignal.timeout(120000)});if(!r.ok){console.log(JSON.stringify({status:r.status,retryAfter:r.headers.get('retry-after'),rateLimitType:r.headers.get('x-figma-rate-limit-type')}));throw Error('Reference capture stopped at Figma API limit/access error.');}return r.json();};
 const sourceFile=path.join(destination,'source.json');let source;
 if(fs.existsSync(sourceFile))source=JSON.parse(fs.readFileSync(sourceFile));
 else{const data=await json(`files/${fileKey}?geometry=paths`);source={name:data.name,version:data.version,document:data.document};fs.writeFileSync(sourceFile,JSON.stringify(source));}
 const frames=figmaFrames(source);fs.writeFileSync(path.join(destination,'frames.json'),JSON.stringify(frames,null,2));console.log(`Source: ${frames.length} views.`);
 const missing=frames.filter(f=>!fs.existsSync(path.join(destination,`reference-${f.id.replaceAll(':','-')}.png`)));
 if(missing.length){const data=await json(`images/${fileKey}?ids=${encodeURIComponent(missing.map(f=>f.id).join(','))}&format=png&scale=1&use_absolute_bounds=true&version=${encodeURIComponent(source.version)}`);
  for(const frame of missing){if(!data.images?.[frame.id])throw Error(`No reference for ${frame.name}`);const r=await fetch(safeAsset(data.images[frame.id]),{redirect:'error'});fs.writeFileSync(path.join(destination,`reference-${frame.id.replaceAll(':','-')}.png`),await getBytes(r));console.log(`Reference ${frame.name}`);}
 }
 if(process.argv.includes('--svg')){
  const missingSVG=frames.filter(f=>!fs.existsSync(path.join(destination,`reference-${f.id.replaceAll(':','-')}.svg`)));
  if(missingSVG.length){const data=await json(`images/${fileKey}?ids=${encodeURIComponent(missingSVG.map(f=>f.id).join(','))}&format=svg&svg_outline_text=false&use_absolute_bounds=true&version=${encodeURIComponent(source.version)}`);for(const frame of missingSVG){const r=await fetch(safeAsset(data.images[frame.id]),{redirect:'error',signal:AbortSignal.timeout(60000)});fs.writeFileSync(path.join(destination,`reference-${frame.id.replaceAll(':','-')}.svg`),await getBytes(r));}console.log(`Captured ${missingSVG.length} typography references.`);}
 }
 const refs=new Set(frames.flatMap(f=>convertFigmaFrame(findFigmaNode(source,f.id),{minSize:1}).images));const fills={};
 const absent=[...refs].filter(ref=>!fs.existsSync(path.join(destination,`fill-${ref}.bin`)));
 const locations=absent.length?(await json(`files/${fileKey}/images`)).meta?.images:{};
 for(const ref of refs){const file=`fill-${ref}.bin`;if(!/^[A-Za-z0-9.-]+$/.test(file))throw Error('Invalid image reference.');if(!fs.existsSync(path.join(destination,file)))fs.writeFileSync(path.join(destination,file),await getBytes(await fetch(safeAsset(locations[ref]),{redirect:'error',signal:AbortSignal.timeout(60000)})));fills[ref]=file;}
 fs.writeFileSync(path.join(destination,'fills.json'),JSON.stringify(fills));console.log(`Captured ${frames.length} references and ${refs.size} original fills.`);

 return {};
});
