// Geometry for canvas drawing tools. Pure JSON, independent of the host and UI.
export function dragShape(tool,start,end,{shift=false,alt=false}={}){
 let dx=end.x-start.x,dy=end.y-start.y;
 if(shift){if(tool==='line'){const length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;dx=Math.cos(angle)*length;dy=Math.sin(angle)*length;}else{const size=Math.max(Math.abs(dx),Math.abs(dy));dx=Math.sign(dx||1)*size;dy=Math.sign(dy||1)*size;}}
 const a=alt?{x:start.x-dx,y:start.y-dy}:start,b={x:start.x+dx,y:start.y+dy};
 if(tool==='line')return penVector([{point:[a.x,a.y]},{point:[b.x,b.y]}]);
 return {shape:tool,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y),radius:0,opacity:1};
}
export function penPath(nodes,closed=false){
 if(!nodes.length)return '';
 const n=v=>Math.round(v*1e4)/1e4,xy=p=>p.map(n).join(' '),parts=[`M${xy(nodes[0].point)}`];
 const segment=(a,b)=>{if(a.out||b.in)parts.push(`C${xy(a.out??a.point)} ${xy(b.in??b.point)} ${xy(b.point)}`);else parts.push(`L${xy(b.point)}`);};
 for(let i=1;i<nodes.length;i++)segment(nodes[i-1],nodes[i]);if(closed){segment(nodes.at(-1),nodes[0]);parts.push('Z');}return parts.join(' ');
}
export function penVector(nodes,closed=false){
 const points=nodes.flatMap(n=>[n.point,...(n.in?[n.in]:[]),...(n.out?[n.out]:[])]),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(1,Math.max(...xs)-x),h=Math.max(1,Math.max(...ys)-y);
 return {shape:'path',cx:x+w/2,cy:y+h/2,w,h,pathSize:[w,h],pathOffset:[x,y],paths:[{d:penPath(nodes,closed),rule:'nonzero'}],fill:closed?'#ffffff':'#ffffff00',opacity:1,radius:0};
}

/** Drawing defaults affect only newly created layers, never the current selection. */
export function drawingStyle(layer,style,{open=false}={}){
 return {...layer,fill:!open&&style.fillEnabled?style.fill:'#ffffff00',opacity:1,stroke:{color:style.stroke,width:style.strokeEnabled?style.width:0,align:'center'}};
}
