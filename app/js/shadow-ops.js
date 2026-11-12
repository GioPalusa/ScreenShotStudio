// Shadow geometry in canvas pixels; angle increases clockwise from the right.
export const SHADOW_PRESETS = [
 {id:'subtle',name:'Subtle',shadow:{color:'#000000',alpha:.15,blur:12,dx:0,dy:4}},
 {id:'soft',name:'Soft',shadow:{color:'#000000',alpha:.2,blur:32,dx:0,dy:12}},
 {id:'floating',name:'Floating',shadow:{color:'#000000',alpha:.3,blur:50,dx:0,dy:24}},
 {id:'crisp',name:'Crisp',shadow:{color:'#000000',alpha:.3,blur:0,dx:6,dy:6}},
 {id:'dramatic',name:'Dramatic',shadow:{color:'#000000',alpha:.45,blur:64,dx:16,dy:32}},
 {id:'lifted',name:'Lifted',shadow:{color:'#000000',alpha:.25,blur:20,dx:0,dy:8}},
 {id:'left',name:'Left',shadow:{color:'#000000',alpha:.3,blur:24,dx:-12,dy:8}},
 {id:'long',name:'Long',shadow:{color:'#000000',alpha:.3,blur:8,dx:24,dy:24}},
 {id:'glow',name:'Glow',shadow:{color:'#ffffff',alpha:.65,blur:36,dx:0,dy:0,angle:90}},
];
export const shadowAngle = value => ((value % 360) + 360) % 360;
export function shadowPolar(shadow={}){
 const dx=shadow.dx??0,dy=shadow.dy??0,distance=Math.hypot(dx,dy);
 return {distance,angle:shadowAngle(distance?Math.atan2(dy,dx)*180/Math.PI:shadow.angle??90)};
}
export function shadowFromPolar(shadow,{distance=shadowPolar(shadow).distance,angle=shadowPolar(shadow).angle}={}){
 const degrees=shadowAngle(angle),radians=degrees*Math.PI/180,round=v=>Math.round(v*10000)/10000||0;
 return {...shadow,dx:round(Math.max(0,distance)*Math.cos(radians)),dy:round(Math.max(0,distance)*Math.sin(radians)),angle:degrees};
}
export function shadowPreset(id){const preset=SHADOW_PRESETS.find(p=>p.id===id);if(!preset)throw Error('Unknown shadow preset.');return structuredClone(preset.shadow);}

export function shadowPresetId(shadow){return SHADOW_PRESETS.find(p=>['color','alpha','blur','dx','dy'].every(key=>shadow?.[key]===p.shadow[key]))?.id??'custom';}
