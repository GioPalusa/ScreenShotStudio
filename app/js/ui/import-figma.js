import { figmaProjectSeed } from '../figma-project.js';
import { importFontControls } from './import-fonts.js';
import { engine,state,api,uploadAsset,importExternalDesigns,flushSaves } from '../store.js';
import { Engine } from '../render.js';
import { applyExternalImport } from '../external-import.js';
import { h,modal,selectInput,toast } from './helpers.js';

/** Entire connection, selection, preview and import stays in the app. */
export function openImportFigma(ctx,{url:initialURL='',onImported,newProject=false,clipboardHTML=null,onPaste=null}={}){
  const owner=engine.project,projectId=state.projectId;
  const seed=newProject?figmaProjectSeed():null,project=seed?.project??owner,copy=seed?.copy??engine.data.copy;
  const projectName=h('input',{class:'input',value:'Figma import',maxlength:80,'aria-label':'Imported project name'});
  let closed=false,busy=false,source=null,rows=[],files={},images={},controller,clipboardData;
  const previewRenderers=[],requestIds=[];
  const active=()=>!closed&&owner===engine.project&&projectId===state.projectId;
  const fontControls=importFontControls({active,existing:project.fonts?.files??[],onChange:changed=>{if(changed==='fonts'){rows=[];previews.replaceChildren();}update();}});
  const url=h('input',{class:'input',type:'url',value:initialURL,placeholder:'https://www.figma.com/design/…','aria-label':'Figma link'});
  const key=h('input',{class:'input',type:'password',autocomplete:'off',spellcheck:'false','aria-label':'Figma access token'});
  let connectionInfo=null;
  const connection=h('p',{class:'hint',role:'status'}),expiry=h('input',{class:'input',type:'date','aria-label':'Figma key expiry date'});
  const lifetime=selectInput({value:'custom',options:[['1','1 day'],['7','7 days'],['30','30 days'],['90','90 days'],['custom','Custom date']],onChange:value=>{expiryRow.hidden=value!=='custom';if(value==='custom'){expiry.value='';return;}const date=new Date(Date.now()+Number(value)*86400000);expiry.value=date.toISOString().slice(0,10);}});lifetime.setAttribute('aria-label','Figma key lifetime');
  const lifetimeRow=h('label',{class:'f'},'Key lifetime',lifetime);
  const keyRow=h('label',{class:'f'},'Figma personal access token',key),expiryRow=h('label',{class:'f'},'Expires on (optional)',expiry);
  const replaceKey=h('button',{class:'btn small',onClick:()=>{saveExpiry.hidden=true;keyRow.hidden=false;lifetimeRow.hidden=false;expiryRow.hidden=lifetime.value!=='custom';key.focus();}},'Replace key');
  const forgetKey=h('button',{class:'btn small',onClick:async()=>{try{await window.studioDesktop.figmaSettings('forget');key.value='';expiry.value='';lifetime.value='custom';keyRow.hidden=false;lifetimeRow.hidden=false;expiryRow.hidden=lifetime.value!=='custom';connection.textContent='Key removed from macOS Keychain.';forgetKey.hidden=true;replaceKey.hidden=editExpiry.hidden=saveExpiry.hidden=true;}catch(error){connection.textContent=error.message;}}},'Forget key');
  const saveExpiry=h('button',{class:'btn small',hidden:true,onClick:async()=>{try{await window.studioDesktop.figmaSettings('expiry',{expiresAt:expiry.value?expiry.value+'T23:59:59Z':null});saveExpiry.hidden=true;await refreshConnection();}catch(error){connection.textContent=error.message;}}},'Save expiry');
  const editExpiry=h('button',{class:'btn small',hidden:true,onClick:()=>{keyRow.hidden=true;lifetimeRow.hidden=false;expiryRow.hidden=false;lifetime.value='custom';expiry.value=connectionInfo?.expiresAt?.slice(0,10)??'';saveExpiry.hidden=false;}},'Edit expiry');
  replaceKey.hidden=forgetKey.hidden=true;
  async function refreshConnection(){if(clipboardHTML||!window.studioDesktop?.figmaSettings)return;try{const value=await window.studioDesktop.figmaSettings('load');if(!active())return;connectionInfo=value;editExpiry.hidden=!value.stored;replaceKey.hidden=forgetKey.hidden=!value.stored;keyRow.hidden=lifetimeRow.hidden=value.stored&&!value.expired&&!value.invalid;expiryRow.hidden=keyRow.hidden||lifetime.value!=='custom';connection.textContent=value.expired||value.invalid?'The saved key has expired or been revoked. Replace it to continue.':value.stored?`Key saved in macOS Keychain.${value.expiresAt?' Expires '+new Date(value.expiresAt).toLocaleDateString()+'.':' Expiry date unknown; Figma will be checked on connection.'}`:'A working key will be saved in macOS Keychain.';}catch(error){connection.textContent=error.message;}}
  function requestError(error){if(error.code==='figma-auth'||error.status===401){keyRow.hidden=lifetimeRow.hidden=false;expiryRow.hidden=lifetime.value!=='custom';connection.textContent='The key is invalid, expired or revoked. Enter a replacement; the file and selection are retained.';key.focus();}return error.message;}
  const status=h('p',{class:'hint',role:'status','aria-live':'polite'}),list=h('div'),previews=h('div',{class:'import-design-preview'});
  const canvas=selectInput({value:'',options:[['','Original view sizes · new canvases'],...Object.entries(project.devices).map(([id,d])=>[id,d.label])],onChange:()=>{rows=[];previews.replaceChildren();update();}});canvas.setAttribute('aria-label','Figma import canvas');
  const language=selectInput({value:newProject?project.locales[0].id:state.ui.locale,options:project.locales.map(l=>[l.id,l.name]),onChange:value=>{for(const row of rows)row.locale=value;}});language.setAttribute('aria-label','Figma import language');
  const request=async(action,ids)=>{controller=new AbortController();const requestId=crypto.randomUUID();requestIds.push(requestId);const input={requestId,action,url:url.value.trim(),token:key.value,expiresAt:expiry.value?expiry.value+'T23:59:59Z':null,ids,version:source?.version};
    if(window.studioDesktop?.figmaImport){const result=await window.studioDesktop.figmaImport(input);if(!result.ok)throw Object.assign(Error(result.error),{status:result.status,code:result.code});if(active()){key.value='';await refreshConnection();}return result.result;}
    return api('/api/import/figma',{method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,body:JSON.stringify(input)});
  };
  function update(){load.disabled=busy;preview.disabled=busy||!list.querySelector('input:checked');apply.disabled=busy||!rows.length||!fontControls.ready;apply.textContent=onPaste?'Paste editable selection':newProject?`Create project with ${rows.length} view${rows.length===1?'':'s'}…`:`Import ${rows.length} view${rows.length===1?'':'s'}`;}
  function setBusy(value){busy=value;for(const el of [url,key,lifetime,expiry,replaceKey,forgetKey,editExpiry,saveExpiry,projectName,canvas,language,...list.querySelectorAll('input,button')])el.disabled=value;update();}
  function clear(){source=null;rows=[];list.replaceChildren();previews.replaceChildren();update();}
  url.addEventListener('input',clear);key.addEventListener('input',()=>{rows=[];previews.replaceChildren();update();});
  const load=h('button',{class:'btn primary',onClick:async()=>{
    if(busy||!active())return;setBusy(true);status.textContent='Loading Figma views…';rows=[];previews.replaceChildren();
    try{
      if(clipboardHTML){clipboardData=await api('/api/import/figma-clipboard',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({html:clipboardHTML})});source={name:'Copied Figma selection',frames:clipboardData.designs.map(d=>({id:d.id,name:d.name,width:d.width,height:d.height}))};}
      else source=await request('inspect');if(!active())return;
      if(newProject&&projectName.value==='Figma import')projectName.value=source.name.slice(0,80);
      list.replaceChildren(h('p',null,source.name),h('div',{class:'row'},h('button',{class:'btn small',onClick:()=>{if(busy)return;for(const el of list.querySelectorAll('input[type=checkbox]'))el.checked=true;rows=[];previews.replaceChildren();update();}},'Select all'),h('button',{class:'btn small',onClick:()=>{if(busy)return;for(const el of list.querySelectorAll('input[type=checkbox]'))el.checked=false;rows=[];previews.replaceChildren();update();}},'Deselect all')),...source.frames.map(f=>h('label',{class:'row check'},h('input',{type:'checkbox',value:f.id,checked:source.frames.length===1,onChange:()=>{rows=[];previews.replaceChildren();update();}}),`${f.page?f.page+' / ':''}${f.name} · ${Math.round(f.width)} × ${Math.round(f.height)}`)));
      status.textContent='Choose the views to preview.';
    }catch(error){if(active()){if(error.code!=='figma-auth'&&error.status!==401){source=null;list.replaceChildren();}status.textContent=requestError(error);}}
    finally{if(active()){setBusy(false);if(clipboardData)preview.click();}}
  }},'Load views');
  const preview=h('button',{class:'btn',disabled:true,onClick:async()=>{
    if(busy||!active())return;setBusy(true);rows=[];previews.replaceChildren();status.textContent='Reading editable layers and images…';
    try{
      const ids=[...list.querySelectorAll('input:checked')].map(i=>i.value),data=clipboardData?{...clipboardData,designs:clipboardData.designs.filter(d=>ids.includes(d.id))}:await request('load',ids);if(!active())return;
      files={};images=data.images;const previewAssets={};
      for(const [ref,image] of Object.entries(data.images)){
        const bytes=Uint8Array.from(atob(image.data),c=>c.charCodeAt(0)),file=new File([bytes],`figma-${Object.keys(files).length+1}.${image.mime==='image/jpeg'?'jpg':image.mime==='image/webp'?'webp':'png'}`,{type:image.mime});
        const bitmap=await createImageBitmap(file);try{if(bitmap.width>16384||bitmap.height>16384||bitmap.width*bitmap.height>40000000)throw new Error('A Figma image exceeds the image-size limit.');}finally{bitmap.close();}
        files[ref]=file;previewAssets[ref]=`data:${image.mime};base64,${image.data}`;
      }
      await fontControls.resolve(data.designs.flatMap(d=>d.layers));if(!active())return;
      if(!(await fontControls.reviewMissing())||!active())return;
      data.designs=data.designs.map(design=>({...design,layers:fontControls.replaceLayers(design.layers)}));
      rows=data.designs.map(design=>({kind:'figma-editable',path:design.id,group:design.id,name:design.name,file:{width:design.width,height:design.height},locale:language.value,design}));
      for(const row of rows){
        const result=applyExternalImport(project,copy,[row],{canvasId:canvas.value||null,assets:previewAssets,fonts:fontControls.previewFonts});
        const renderer=new Engine();previewRenderers.push(renderer);renderer.setData({...engine.data,studio:result.project,copy:result.copy});
        const baseURL=renderer.assetUrl.bind(renderer);renderer.assetUrl=(kind,file)=>file.startsWith('data:')?file:baseURL(kind,file);
        const image=h('canvas',{'aria-label':`Figma preview ${row.name}`});image.style.width='120px';image.style.height='auto';
        await renderer.render(image,renderer.scene(result.slides[0],result.deviceId,row.locale),{scale:Math.min(1,240/row.design.width)});if(!active())return;
        const types=row.design.layers.reduce((m,l)=>(m[l.type]=(m[l.type]??0)+1,m),{}),warnings=[...row.design.warnings];

        previews.append(h('article',{class:'import-design-row'},image,h('div',null,h('b',null,row.name),h('p',null,`${types.text??0} editable text layers · ${row.design.layers.filter(l=>l.shape==='path').length} vector layers · ${row.design.layers.filter(l=>l.type==='shape'&&l.shape!=='path').length} shapes`),...warnings.map(w=>h('p',{class:'hint'},w)))));
      }
      status.textContent='Review the native layers above. No text, shapes or vectors will be flattened into images.';
    }catch(error){if(active()){rows=[];previews.replaceChildren();status.textContent=requestError(error);}}
    finally{if(active())setBusy(false);}
  }},'Preview selected views');
  const apply=h('button',{class:'btn primary',disabled:true,onClick:async()=>{
    if(busy||!rows.length||!active()||!fontControls.ready)return;setBusy(true);status.textContent='Importing editable views…';
    try{
      if(newProject){
        status.textContent='Choose where to save the new project…';
        const result=await window.studioDesktop.createFigmaProject({name:projectName.value.trim(),rows,images,fonts:fontControls.files});
        if(result?.error)throw Error(result.error);
        if(result?.canceled){status.textContent='Nothing was created. The import preview is still here.';return;}
        return;
      }
      const assets={};applyExternalImport(project,copy,rows,{canvasId:canvas.value||null,assets:Object.fromEntries(Object.keys(files).map(ref=>[ref,'preview.png']))});
      for(const [ref,file] of Object.entries(files)){assets[ref]=(await uploadAsset(file)).file;if(!active())return;}
      const fonts=await fontControls.save();if(!active())return;
      if(onPaste){await onPaste({design:rows[0].design,assets,fonts});dialog.close();return;}
      const result=importExternalDesigns(rows,{canvasId:canvas.value||null,assets,fonts});
      dialog.close();onImported?.();ctx.go({view:'editor',slideId:result.slides[0],device:result.deviceId,locale:language.value});toast(`${result.slides.length} editable Figma views imported.`);
      try{await flushSaves();}catch{toast('The imported views are in the editor. Saving needs attention; use the save status to retry.',{error:true});}
    }catch(error){if(active())status.textContent=requestError(error);}
    finally{if(active())setBusy(false);}
  }},'Import 0 views');
  const body=h('div',{class:'import-designs'},h('p',null,newProject?'Create a new editable project from Figma views or a selection.':'Import native text, shapes and vector paths directly from Figma.'),...(newProject?[h('label',{class:'f'},'Project name',projectName)]:[]),...(clipboardHTML?[h('p',{class:'hint'},'Copied Figma layers are decoded locally. No Figma key is needed.')]:[h('label',{class:'f'},'Figma file or selection link',url),keyRow,...(window.studioDesktop?.figmaSettings?[lifetimeRow,expiryRow,connection,h('div',{class:'row'},replaceKey,editExpiry,saveExpiry,forgetKey)]:[]),h('p',{class:'hint'},window.studioDesktop?.figmaSettings?'Requires file_content:read access. The key is stored in macOS Keychain, never in projects or ordinary settings files. Match the lifetime chosen in Figma. Use Custom date for an existing key. This does not extend the key’s lifetime; expired PATs need a replacement.':'Requires file_content:read access. The key is used only while this dialog is open and is never saved in the project.')]),load,list,h('div',{class:'translation-grid'},...(newProject||onPaste?[]:[h('label',{class:'f'},'Canvas',canvas)]),h('label',{class:'f'},'Language',language)),fontControls.el,preview,previews,status);
  const dialog=modal({title:onPaste?'Paste from Figma':newProject?'New project from Figma':'Import from Figma',body,wide:true,actions:[h('button',{class:'btn',onClick:()=>dialog.close()},'Cancel'),apply],onClose:()=>{closed=true;controller?.abort();for(const id of requestIds)void window.studioDesktop?.cancelFigmaImport?.(id);fontControls.close();for(const renderer of previewRenderers)renderer.projectFonts.dispose();key.value='';files={};images={};}});
  update();
  if(clipboardHTML)load.click();else void refreshConnection();
  return dialog;
}
