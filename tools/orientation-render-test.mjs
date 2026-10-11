// Final export with mixed orientations in one App Store row; legacy and explicit portrait pixel parity.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePNG, decodePNG } from './png.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-orientation-render-'));
try {
 const project=path.join(temp,'Mixed.sss'), output=path.join(temp,'export');
 fs.mkdirSync(path.join(project,'copy'),{recursive:true});
 fs.mkdirSync(path.join(project,'captures/en-US/iphone'),{recursive:true});
 const data=Buffer.alloc(1206*2622*4); for(let i=0;i<data.length;i+=4){data[i]=220;data[i+1]=20;data[i+2]=40;data[i+3]=255;}
 fs.writeFileSync(path.join(project,'captures/en-US/iphone/home.png'),encodePNG({width:1206,height:2622,data,channels:3}));
 const doc={version:2,fonts:{default:{family:'system-ui'}},themes:{light:{bg:'#ffffff',ink:'#111111'}},locales:[{id:'en-US',name:'English',native:'English',lang:'en',dir:'ltr'}],devices:{duo:{label:'Duo',target:'iphone',size:[1398,2034],layout:'phone',capture:'iphone'}},slides:['legacy','portrait','landscape'].map(id=>({id,name:id,theme:'light',...(id==='legacy'?{}:{canvasOrientations:{duo:id}}),layouts:{duo:{template:'custom',panorama:false,layers:[{id:'device',type:'device',profile:'iphone',capture:'home',cx:400,top:300,w:300}]}}}))};
 fs.writeFileSync(path.join(project,'studio.json'),JSON.stringify(doc));
 fs.writeFileSync(path.join(project,'copy/en-US.json'),JSON.stringify({_meta:{status:'approved',needsReview:[]}}));
 execFileSync(process.execPath,['studio.mjs','export','--project',project,'--output',output,'--strict'],{cwd:root,stdio:'inherit'});
 const run=path.join(output,fs.readdirSync(output)[0]); const manifest=JSON.parse(fs.readFileSync(path.join(run,'manifest.json')));
 assert.equal(manifest.files.length,3);assert.deepEqual(manifest.report.warnings,[]);
 assert.equal(new Set(manifest.files.map(f=>f.sectionId)).size,1);
 assert.deepEqual(manifest.files.map(f=>f.position),[1,2,3]);
 const images=manifest.files.map(file=>{const bytes=fs.readFileSync(path.join(run,file.path)); assert.equal(bytes[25],2,'RGB without alpha');const image=decodePNG(bytes);assert.deepEqual([image.width,image.height],file.size); return image;});
 assert.deepEqual([images[2].width,images[2].height],[2034,1398]);
 assert.deepEqual(images[0].data,images[1].data,'Explicit portrait must be pixel-identical to the original unmodified canvas');
 for(const image of images){const i=(400*image.width+400)*4;assert.deepEqual([...image.data.subarray(i,i+3)],[220,20,40],'Device stays upright in the same position');}
 console.log('PASS: one App Store row; mixed portrait/landscape final RGB exports; exact PNG/manifest dimensions; unchanged portrait pixels and device geometry.');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
