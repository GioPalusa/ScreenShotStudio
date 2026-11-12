import {h} from './helpers.js';
import {cornerControls,cornerRadiusPatch} from '../corner-ops.js';
import {vectorToScene,sceneToVector} from '../vector-path.js';
export function createCornerEditor(ed,{scale,point,redraw,direct}){
 let drag=null;
 const localLayer=l=>l.shape==='rect'?{...l,pathSize:[l.w,l.h],pathOffset:[0,0]}:l;
 const target=()=>ed.selectionLayers().length===1?ed.layerById(ed.selectedId):null;
 const consume=e=>{e.preventDefault();e.stopPropagation();};
 function render(){
  const layer=target();if(!layer||layer.locked)return;
  for(const c of cornerControls(layer)){
   const origin=vectorToScene(localLayer(layer),c.point),directionEnd=vectorToScene(localLayer(layer),c.point.map((v,i)=>v+c.direction[i])),pixelsPerUnit=Math.hypot(directionEnd[0]-origin[0],directionEnd[1]-origin[1])*scale(),inset=c.radius+12/Math.max(.001,pixelsPerUnit),position=vectorToScene(localLayer(layer),c.point.map((v,i)=>v+c.direction[i]*inset));
   ed.overlay.append(h('button',{type:'button',class:'corner-widget','aria-label':`Corner radius ${c.key}`,title:`Corner radius: ${Math.round(c.radius*10)/10} px · ${direct()?'this corner':'all corners'}`,dataset:{corner:c.key},style:{left:`${position[0]*scale()}px`,top:`${position[1]*scale()}px`}}));
  }
 }
 function down(e){const key=e.target.closest('[data-corner]')?.dataset.corner,layer=target();if(key===undefined||!layer||e.button!==0)return false;const corner=cornerControls(layer).find(c=>c.key===key);if(!corner)return false;consume(e);drag={layer:structuredClone(layer),corner,start:point(e),all:!direct(),active:false};ed.overlay.setPointerCapture(e.pointerId);return true;}
 function move(e){if(!drag)return false;consume(e);const p=point(e);if(!drag.active){if(Math.hypot(p.x-drag.start.x,p.y-drag.start.y)*scale()<3)return true;ed.startEdit();drag.active=true;}
  const l=localLayer(drag.layer),a=sceneToVector(l,[drag.start.x,drag.start.y]),b=sceneToVector(l,[p.x,p.y]),radius=drag.corner.radius+(b[0]-a[0])*drag.corner.direction[0]+(b[1]-a[1])*drag.corner.direction[1];
  ed.applyVector(target(),cornerRadiusPatch(drag.layer,drag.corner.key,radius,{all:drag.all}));redraw();return true;
 }
 function up(e){if(!drag)return false;consume(e);const active=drag.active;drag=null;try{ed.overlay.releasePointerCapture(e.pointerId);}catch{}if(active){if(e.type==='pointercancel')ed.cancelEdit();else{ed.finishEdit();ed.refresh({immediate:true,inspector:true});}}redraw();return true;}
 return {render,down,move,up,cancelDrag(){drag=null;},get active(){return Boolean(drag?.active);},get dragging(){return Boolean(drag);}};
}
