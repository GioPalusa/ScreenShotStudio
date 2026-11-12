import { resolveClipboardImages, clipboardImageFiles } from './figma-clipboard-images.js';
import { resolveDesignFonts } from './import-fonts.js';
import { engine,state,api,checkpoint,saveCopy,saveStudio,uploadAsset } from '../store.js';
import { pasteLayerClipboard } from '../layer-transfer.js';
import { sharedLayerId } from '../shared-canvas.js';
import { parseSVG } from '../svg-import.js';
import { parseFigmaProperties,propertiesForLayer } from '../figma-properties.js';
import { scaleFigmaLayers } from '../figma-layout.js';
import { selectionBounds } from '../selection.js';
import { parseAdobeText, layoutAdobeText } from '../adobe-text.js';
import { ProjectFonts } from '../project-fonts.js';
import { openImportFigma } from './import-figma.js';
import { h,modal,toast } from './helpers.js';
export async function pasteAdobeText(ed,source,active=()=>true){
  const project=engine.project,current=()=>active()&&project===engine.project,fonts=new ProjectFonts();
  try{
    if(!ed.scene)throw Error('Wait for the canvas preview before pasting text.');
    const document=parseAdobeText(source),requests=document.paragraphs.flatMap(p=>p.runs.map(run=>({type:'text',...run.style})));
    const typography=await resolveDesignFonts(requests,current);if(!typography||!current())return;
    let at=0;for(const paragraph of document.paragraphs)for(const run of paragraph.runs){const {type,...style}=typography.layers[at++];run.style=style;}
    const families=new Set(typography.layers.map(l=>l.fontFamily)),files=mergeProjectFonts(engine.project.fonts?.files,typography.fonts).filter(f=>families.has(f.family));
    const failed=await fonts.prepare(files,engine.projectURL);if(!current())return;
    if(failed.length)throw Error(`Could not load the copied text font: ${failed.join(', ')}.`);
    const canvas=window.document.createElement('canvas'),ctx=canvas.getContext('2d');
    const design=layoutAdobeText(document,(text,style)=>{
      ctx.font=`${style.figmaText.italic?'italic ':''}${style.weight} ${style.size}px ${JSON.stringify(fonts.family(style.fontFamily))}, system-ui, sans-serif`;
      ctx.fontKerning='normal';ctx.textRendering='optimizeLegibility';ctx.letterSpacing=`${style.figmaText.letterSpacing}px`;return ctx.measureText(text).width;
    });
    if(!design.layers.length)throw Error('The Illustrator selection contains no text.');
    const scale=Math.min(1,ed.scene.W*.8/design.width,ed.scene.H*.8/design.height),entries=scaleFigmaLayers(design,design.width*scale,design.height*scale).map(layer=>({layer,text:{[state.ui.locale]:{value:design.texts[layer.field],needsReview:true}}}));
    if(!current())return;
    checkpoint(null,{copyLocales:[state.ui.locale]});
    if(typography.fonts.length){engine.project.fonts??={};engine.project.fonts.files=mergeProjectFonts(engine.project.fonts.files,typography.fonts);}
    const result=pasteLayerClipboard({entries},{block:ed.block(),resolved:ed.scene.allLayers,copy:engine.data.copy,slideIds:[ed.slide().id],shared:ed.allScreens(),dx:(ed.scene.W-design.width*scale)/2,dy:(ed.scene.H-design.height*scale)/2});
    ed.selectedIds=new Set(result.layers.map(l=>ed.allScreens()?sharedLayerId(l.id):l.id));ed.selectedId=[...ed.selectedIds].at(-1);
    result.changedLocales.forEach(saveCopy);saveStudio();ed.refresh({immediate:true,inspector:true,rail:true});
    toast(result.layers.length===1?'Editable text pasted from Illustrator.':`${result.layers.length} editable text layers pasted from Illustrator.`);
  }catch(error){if(current())toast(error.message,{error:true});}
  finally{fonts.dispose();}
}
export async function pasteSVGDesign(ed,text,active=()=>true,{selection=false}={}){
  try{
    if(!ed.scene)throw new Error('Wait for the canvas preview before pasting SVG.');
    const project=engine.project,design=parseSVG(text),assets={};
    if(design.layers.some(l=>l.type==='text'))toast('Checking fonts for pasted text…');
    const typography=await resolveDesignFonts(design.layers,()=>active()&&project===engine.project);if(!typography)return;design.layers=typography.layers;
    for(const [ref,image] of Object.entries(design.embeddedImages??{})){
      const file=new File([Uint8Array.from(atob(image.data),c=>c.charCodeAt(0))],`${ref}.${image.mime==='image/jpeg'?'jpg':image.mime==='image/webp'?'webp':'png'}`,{type:image.mime}),bitmap=await createImageBitmap(file);
      try{if(bitmap.width>16384||bitmap.height>16384||bitmap.width*bitmap.height>40000000)throw new Error('An SVG image exceeds the image size limit.');}finally{bitmap.close();}
      if(!active()||project!==engine.project)return;assets[ref]=(await uploadAsset(file)).file;
    }
    const bounds=selection?selectionBounds(design.layers.filter(l=>!l.hidden&&!l.maskOnly).map(l=>({_box:{x:l.type==='text'?l.x:l.cx-l.w/2,y:l.type==='text'?l.capTop:l.cy-l.h/2,w:l.w,h:l.boxHeight??l.h,rot:l.rotate??0}}))):{x:0,y:0,w:design.width,h:design.height};
    if(!bounds)throw Error('The copied SVG has no visible artwork.');
    const scale=selection?Math.min(1,ed.scene.W*.8/bounds.w,ed.scene.H*.8/bounds.h):1;
    const entries=scaleFigmaLayers(design,design.width*scale,design.height*scale,assets).map(layer=>({layer,text:layer.type==='text'?{[state.ui.locale]:{value:design.texts[layer.field],needsReview:true}}:{}}));
    if(!active()||project!==engine.project)return;
    checkpoint(null,{copyLocales:[state.ui.locale]});
    if(typography.fonts.length){engine.project.fonts??={};engine.project.fonts.files=mergeProjectFonts(engine.project.fonts.files,typography.fonts);}
    const result=pasteLayerClipboard({entries},{block:ed.block(),resolved:ed.scene.allLayers,copy:engine.data.copy,slideIds:[ed.slide().id],shared:ed.allScreens(),dx:(ed.scene.W-bounds.w*scale)/2-bounds.x*scale,dy:(ed.scene.H-bounds.h*scale)/2-bounds.y*scale});
    ed.selectedIds=new Set(result.layers.map(l=>ed.allScreens()?sharedLayerId(l.id):l.id));ed.selectedId=[...ed.selectedIds].at(-1);
    result.changedLocales.forEach(saveCopy);saveStudio();ed.refresh({immediate:true,inspector:true,rail:true});
    toast(design.warnings.length?`SVG imported as native layers. ${design.warnings.join(' ')}`:`${result.layers.length} editable SVG layers pasted.`,{timeout:design.warnings.length?15000:5000});
  }catch(error){toast(error.message,{error:true});}
}
export function pasteDesignText(ed,text,active){
  if(/^\s*(?:(?:<\?xml[^>]*>|<!--[\s\S]*?-->)\s*)*<svg[\s>]/i.test(text??'')){void pasteSVGDesign(ed,text,active);return true;}
  if(/^https:\/\/(?:www\.)?figma\.com\/(?:design|file)\//.test(text??'')){openImportFigma(ed.ctx,{url:text.trim()});return true;}
  const properties=parseFigmaProperties(text);if(!properties)return false;
  const layers=ed.selectionLayers();if(!layers.length){toast('Select a layer before pasting CSS properties.');return true;}
  const body=h('div',null,h('p',null,`Apply CSS properties to ${layers.length} selected layer${layers.length===1?'':'s'}?`),h('pre',null,JSON.stringify(properties,null,2)));
  const dialog=modal({title:'Paste properties',body,actions:[h('button',{class:'btn',onClick:()=>dialog.close()},'Cancel'),h('button',{class:'btn primary',onClick:()=>{
    if(!active())return;
    checkpoint();for(const layer of layers)ed.writePatch(layer,propertiesForLayer(layer,properties));saveStudio();dialog.close();ed.refresh({immediate:true,inspector:true,rail:true});
  }},'Apply properties')]});return true;
}
import { mergeProjectFonts } from '../project-fonts.js';

const pendingFigmaPastes = new WeakSet();
export async function pasteFigmaClipboard(ed,html,active=()=>true) {
  if(pendingFigmaPastes.has(ed))return;
  const project=engine.project,current=()=>active()&&project===engine.project;
  pendingFigmaPastes.add(ed);
  try{
    if(!ed.scene)throw Error('Wait for the canvas preview before pasting.');
    const decoded=await api('/api/import/figma-clipboard',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({html})});
    if(!current())return;
    const data=await resolveClipboardImages(decoded,current);if(!data||!current())return;
    let design=data.designs[0];
    if(!design?.layers.length){toast('Nothing remains to paste after skipping the missing images.');return;}
    const files=await clipboardImageFiles(data.images);if(!current())return;
    const typography=await resolveDesignFonts(design.layers,current);if(!typography||!current())return;
    design={...design,layers:typography.layers};
    const assets={};
    for(const [ref,file] of Object.entries(files)){
      if(!current())return;assets[ref]=(await uploadAsset(file)).file;
    }
    if(!current())return;
    const entries=scaleFigmaLayers(design,design.width,design.height,assets).map(layer=>({layer,text:layer.type==='text'?{[state.ui.locale]:{value:design.texts[layer.field],needsReview:true}}:{}}));
    checkpoint(null,{copyLocales:[state.ui.locale]});
    if(typography.fonts.length){engine.project.fonts??={};engine.project.fonts.files=mergeProjectFonts(engine.project.fonts.files,typography.fonts);}
    const result=pasteLayerClipboard({entries},{block:ed.block(),resolved:ed.scene.allLayers,copy:engine.data.copy,slideIds:[ed.slide().id],shared:ed.allScreens(),dx:(ed.scene.W-design.width)/2,dy:(ed.scene.H-design.height)/2});
    ed.selectedIds=new Set(result.layers.map(l=>ed.allScreens()?sharedLayerId(l.id):l.id));ed.selectedId=[...ed.selectedIds].at(-1);
    result.changedLocales.forEach(saveCopy);saveStudio();ed.refresh({immediate:true,inspector:true,rail:true});
    const skipped=data.skippedImages?.length??0;
    toast(`${result.layers.length} editable Figma layers pasted.${skipped?` ${skipped} missing image${skipped===1?'':'s'} skipped.`:''}`,{timeout:5000});
  }catch(error){if(current())toast(error.message,{error:true});}
  finally{pendingFigmaPastes.delete(ed);}
}
