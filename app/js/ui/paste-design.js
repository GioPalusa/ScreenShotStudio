import { engine,state,checkpoint,saveCopy,saveStudio,uploadAsset } from '../store.js';
import { pasteLayerClipboard } from '../layer-transfer.js';
import { sharedLayerId } from '../shared-canvas.js';
import { parseSVG } from '../svg-import.js';
import { parseFigmaProperties,propertiesForLayer } from '../figma-properties.js';
import { scaleFigmaLayers } from '../figma-layout.js';
import { openImportFigma } from './import-figma.js';
import { h,modal,toast } from './helpers.js';
export async function pasteSVGDesign(ed,text,active=()=>true){
  try{
    if(!ed.scene)throw new Error('Wait for the canvas preview before pasting SVG.');
    const project=engine.project,design=parseSVG(text),assets={};
    for(const [ref,image] of Object.entries(design.embeddedImages??{})){
      const file=new File([Uint8Array.from(atob(image.data),c=>c.charCodeAt(0))],`${ref}.${image.mime==='image/jpeg'?'jpg':image.mime==='image/webp'?'webp':'png'}`,{type:image.mime}),bitmap=await createImageBitmap(file);
      try{if(bitmap.width>16384||bitmap.height>16384||bitmap.width*bitmap.height>40000000)throw new Error('An SVG image exceeds the image size limit.');}finally{bitmap.close();}
      if(!active()||project!==engine.project)return;assets[ref]=(await uploadAsset(file)).file;
    }
    const entries=scaleFigmaLayers(design,design.width,design.height,assets).map(layer=>({layer,text:layer.type==='text'?{[state.ui.locale]:{value:design.texts[layer.field],needsReview:true}}:{}}));
    if(!active()||project!==engine.project)return;
    checkpoint(null,{copyLocales:[state.ui.locale]});
    const result=pasteLayerClipboard({entries},{block:ed.block(),resolved:ed.scene.allLayers,copy:engine.data.copy,slideIds:[ed.slide().id],shared:ed.allScreens(),dx:(ed.scene.W-design.width)/2,dy:(ed.scene.H-design.height)/2});
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

export function pasteFigmaClipboard(ed,html,active) {
  openImportFigma(ed.ctx,{clipboardHTML:html,onPaste:async({design,assets,fonts})=>{
    if(!active())throw Error('The destination changed. Return to your screen and paste again.');
    const entries=scaleFigmaLayers(design,design.width,design.height,assets).map(layer=>({layer,text:layer.type==='text'?{[state.ui.locale]:{value:design.texts[layer.field],needsReview:true}}:{}}));
    checkpoint(null,{copyLocales:[state.ui.locale]});
    if(fonts.length){engine.project.fonts??={};engine.project.fonts.files=mergeProjectFonts(engine.project.fonts.files,fonts);}
    const result=pasteLayerClipboard({entries},{block:ed.block(),resolved:ed.scene.allLayers,copy:engine.data.copy,slideIds:[ed.slide().id],shared:ed.allScreens(),dx:(ed.scene.W-design.width)/2,dy:(ed.scene.H-design.height)/2});
    ed.selectedIds=new Set(result.layers.map(l=>ed.allScreens()?sharedLayerId(l.id):l.id));ed.selectedId=[...ed.selectedIds].at(-1);
    result.changedLocales.forEach(saveCopy);saveStudio();ed.refresh({immediate:true,inspector:true,rail:true});
    toast(`${result.layers.length} editable Figma layers pasted.`);
  }});
}
