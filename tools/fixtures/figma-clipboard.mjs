// Synthetic native clipboard message. No user Figma contents are stored here.
import { figmaSchema } from '@open-pencil/kiwi/fig';
import { compileSchema, encodeBinarySchema } from '@open-pencil/kiwi/schema-runtime';
import { deflateRawSync } from 'node:zlib';

export function clipboardFixture({network=false,booleanOperation=null,booleanTransform=null,missingImage=false}={}) {
  const nodes = [
    {guid:{sessionID:1,localID:1},type:'FRAME',name:'Copied frame',size:{x:375,y:808},fillPaints:[{type:'SOLID',color:{r:1,g:1,b:1,a:1}}]},
    {guid:{sessionID:1,localID:2},parentIndex:{guid:{sessionID:1,localID:1},position:'a'},type:'TEXT',name:'Copied headline',size:{x:300,y:100},transform:{m00:1,m01:0,m02:30,m10:0,m11:1,m12:30},fontName:{family:'Mulish',style:'Bold',postscript:'Mulish-Bold'},fontSize:32,textData:{characters:'Editable clipboard text'},fillPaints:[{type:'SOLID',color:{r:0,g:0,b:0,a:1}}]},
    {guid:{sessionID:1,localID:3},parentIndex:{guid:{sessionID:1,localID:1},position:'b'},type:'VECTOR',name:'Copied vector',size:{x:200,y:300},transform:{m00:1,m01:0,m02:50,m10:0,m11:1,m12:300},fillPaints:[{type:'SOLID',color:{r:0,g:0,b:1,a:1}}],fillGeometry:[{commandsBlob:0,windingRule:'NONZERO'}]},
  ];
  const path=Buffer.alloc(1+8+1+8+1+8+1);let at=0;
  for(const [command,args] of [[1,[0,300]],[2,[100,0]],[2,[200,300]],[0,[]]]){path[at++]=command;for(const value of args){path.writeFloatLE(value,at);at+=4;}}
  if(missingImage){
    nodes.push({guid:{sessionID:1,localID:7},parentIndex:{guid:nodes[0].guid,position:'c'},type:'ROUNDED_RECTANGLE',name:'Cover art',size:{x:100,y:100},transform:{m00:1,m01:0,m02:80,m10:0,m11:1,m12:200},fillPaints:[{type:'IMAGE',image:{hash:new Uint8Array(20).fill(1),name:'Cover art',dataBlob:missingImage==='unsupported'?0:999},imageScaleMode:'FILL'}]});
  }
  if(booleanOperation){
    const operand=nodes[2];
    const back={guid:{sessionID:1,localID:4},parentIndex:{guid:nodes[0].guid,position:'a'},type:'BOOLEAN_OPERATION',name:'Back',size:{x:300,y:300},transform:{m00:1,m01:0,m02:20,m10:0,m11:1,m12:40},booleanOperation,fillPaints:[{type:'SOLID',color:{r:1,g:0,b:0,a:1}}]};
    const children=[0,100].map((x,i)=>({...operand,guid:{sessionID:1,localID:5+i},parentIndex:{guid:back.guid,position:String(i)},transform:booleanTransform??{m00:1,m01:0,m02:x,m10:0,m11:1,m12:0}}));
    return encode([nodes[0],back,...children],path);
  }
  if(network){
    // Cubic network with one reversed edge and normalized coordinates, plus a detached effect style.
    const bytes=Buffer.alloc(12+3*12+3*28+8+4+3*4);let offset=0;
    const uint=n=>{bytes.writeUInt32LE(n,offset);offset+=4;},float=n=>{bytes.writeFloatLE(n,offset);offset+=4;};
    uint(3);uint(3);uint(1);
    for(const [x,y] of [[0,150],[50,0],[100,150]]){uint(0);float(x);float(y);}
    for(const [a,b,tx,ty] of [[0,1,10,-5],[2,1,0,0],[2,0,0,0]]){uint(0);uint(a);float(tx);float(ty);uint(b);float(0);float(0);}
    uint(1);uint(1);uint(3);uint(0);uint(1);uint(2);
    nodes[2].fillGeometry=undefined;nodes[2].vectorData={vectorNetworkBlob:0,normalizedSize:{x:100,y:150}};
    nodes.push({guid:{sessionID:9,localID:1},type:'ROUNDED_RECTANGLE',styleType:'EFFECT',name:'Detached effect style',size:{x:100,y:100}});
    return encode(nodes,bytes);
  }
  return encode(nodes,path);
}
function encode(nodes,path){
  const message={type:'NODE_CHANGES',nodeChanges:nodes,blobs:[{bytes:new Uint8Array(path)}]},codec=compileSchema(figmaSchema);
  const chunks=[deflateRawSync(encodeBinarySchema(figmaSchema)),deflateRawSync(codec.encodeMessage(message))],header=Buffer.alloc(12);header.write('fig-kiwi');header.writeUInt32LE(15,8);
  const parts=[header];for(const chunk of chunks){const length=Buffer.alloc(4);length.writeUInt32LE(chunk.length);parts.push(length,chunk);}
  return `<span data-buffer="<!--(figma)${Buffer.concat(parts).toString('base64')}(/figma)-->"></span>`;
}
