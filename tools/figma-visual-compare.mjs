// Offline real-file comparison: requires references captured separately from Figma.
// This harness never reads a token and never alters the supplied Studio document.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';
import {figmaFrames,findFigmaNode,convertFigmaFrame} from '../app/js/figma-layout.js';
import {createFigmaProject} from '../host/figma-project.mjs';import {createStudioService} from '../host/service.mjs';import {runBrowserTest} from './browser-test-runner.mjs';
const [capture,original,label='current']=process.argv.slice(2);if(!capture||!original||!/^[a-zA-Z0-9-]+$/.test(label))throw Error('Usage: node tools/figma-visual-compare.mjs CAPTURE_FOLDER FONT_SOURCE_PROJECT LABEL');
const source=JSON.parse(fs.readFileSync(path.join(capture,'source.json'))),frames=figmaFrames(source),rows=frames.map(f=>{const design=convertFigmaFrame(findFigmaNode(source,f.id),{minSize:1});return {kind:'figma-editable',path:f.id,group:f.id,name:f.name,file:design,locale:'en-US',design};});
const images=Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(capture,'fills.json')))).map(([ref,file])=>{const bytes=fs.readFileSync(path.join(capture,file));return [ref,{data:bytes.toString('base64')}];}));
const originalDoc=JSON.parse(fs.readFileSync(path.join(original,'studio.json'))),fonts=originalDoc.fonts.files.map(f=>({...f,data:fs.readFileSync(path.join(original,'assets/fonts',f.file)).toString('base64'),license:f.license?fs.readFileSync(path.join(original,'assets/fonts',f.license),'utf8'):''}));
const out=path.join(capture,label);fs.mkdirSync(out,{recursive:true});const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-figma-fidelity-')),project=path.join(temp,'Compared.sss');createFigmaProject(project,{rows,images,fonts});
const doc=JSON.parse(fs.readFileSync(path.join(project,'studio.json')));const entries=frames.map((f,i)=>({...f,slide:doc.slides[i].id,canvas:doc.slides[i].canvasIds[0],warnings:rows[i].design.warnings}));fs.writeFileSync(path.join(out,'views.json'),JSON.stringify(entries,null,2));
let server;const service=createStudioService({appPath:path.resolve('app'),projectPath:project,exportPath:path.join(temp,'export')});
try{
 server=http.createServer(async(req,res)=>{
  if(req.url==='/audit.html'){res.setHeader('content-type','text/html');res.end(`<!doctype html><pre id="result">PENDING</pre><script type="module">
   import {Engine} from '/app/js/render.js';
   try{const engine=new Engine();engine.setData(await(await fetch('/api/project')).json());const entries=${JSON.stringify(entries)};
   for(let i=0;i<entries.length;i++){const e=entries[i],canvas=document.createElement('canvas'),scene=engine.scene(e.slide,e.canvas,'en-US');await engine.render(canvas,scene,{scale:1});const blob=await new Promise(r=>canvas.toBlob(r));const response=await fetch('/result/'+i,{method:'POST',body:blob});if(!response.ok)throw Error('Capture failed');canvas.width=canvas.height=1;}
   engine.projectFonts.dispose();document.querySelector('#result').textContent='PASS: '+entries.length+' real Figma views rendered with editable Studio layers';}catch(e){document.querySelector('#result').textContent='FAIL: '+e.stack;}
  </script>`);return;}
  const match=/^\/result\/(\d+)$/.exec(req.url);if(match&&req.method==='POST'){const e=entries[Number(match[1])];if(!e){res.writeHead(400);res.end();return;}const chunks=[];for await(const c of req)chunks.push(c);fs.writeFileSync(path.join(out,`studio-${e.id.replaceAll(':','-')}.png`),Buffer.concat(chunks));console.log('Rendered '+e.name);res.end('ok');return;}
  service.handle(req,res,server.address().port);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const {stdout}=await runBrowserTest(chrome,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${path.join(temp,'chrome')}`,`http://127.0.0.1:${server.address().port}/audit.html`],{timeout:180000});
 const verdict=stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];if(!verdict?.startsWith('PASS:'))throw Error(verdict??'No comparison result');console.log(verdict);
 // Preserve the newly generated project as an explicit review artifact, outside source control.
 const review=path.join(out,'Compared.sss');if(fs.existsSync(review))throw Error('Choose a new label; review artifacts are never overwritten.');fs.cpSync(project,review,{recursive:true});
}finally{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));service.close();fs.rmSync(temp,{recursive:true,force:true});}
