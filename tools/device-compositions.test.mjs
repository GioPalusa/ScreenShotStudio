import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_COMPOSITIONS, compositionFamily, compositionGeometry, compositionHardware, withDeviceComposition, newCompositionSlide } from '../app/js/device-compositions.js';
import { resolveLayers } from '../app/js/layouts.js';
import { deviceForLayer, profilesFor } from '../app/js/profiles.js';
import { frameOuterSize } from '../app/js/frames.js';
const fixture=()=>({themes:{brand:{name:'Brand',bg:'#112233',ink:'#ffffff'}},locales:[{id:'en-US'},{id:'sv'}],devices:{phone:{layout:'phone',size:[1320,2868]},tablet:{layout:'tablet',size:[2064,2752]}},slides:[{id:'first',theme:'brand',capture:'home',layouts:{phone:{template:'custom',panorama:false,layers:[{id:'hero',type:'device',profile:'iphone',capture:'screen-a',tag:'product',opacity:.8},{id:'second-device',type:'device',profile:'iphone',capture:'screen-b'},{id:'headline',type:'text',field:'headline',x:10,w:200,capTop:20}]}}}]});
test('side-by-side devices retain a visible gap for wide hardware',()=>{
  for(const ratio of [1206/2622,422/514,1.6]){
    const [left,right]=compositionGeometry('parallel',1320,2868,ratio);
    assert.ok(right.cx-right.w/2-(left.cx+left.w/2)>=1320*.035);
  }
});
for(const design of DEVICE_COMPOSITIONS)test(`${design.name}: rotation-aware placement for phones, tablets, Watch and wide screens`,()=>{
  for(const [W,H]of [[1320,2868],[2064,2752],[422,514],[2880,1800],[1000,1000]])for(const ratio of [1206/2622,1640/2360,422/514,1.6]){
    const boxes=compositionGeometry(design.id,W,H,ratio);assert.equal(boxes.length,design.count);
    for(const b of boxes){assert.ok(Object.values(b).every(Number.isFinite));assert.ok(b.w>0&&b.h>0);
      const a=b.rotate*Math.PI/180,w=Math.abs(b.w*Math.cos(a))+Math.abs(b.h*Math.sin(a)),h=Math.abs(b.w*Math.sin(a))+Math.abs(b.h*Math.cos(a));
      if(!design.crop)assert.ok(b.cx-w/2>=-.01&&b.cy-h/2>=-.01&&b.cx+w/2<=W+.01&&b.cy+h/2<=H+.01);
    }
  }
});
test('30 distinct compositions include intentional crops, rotations and one through five devices',()=>{
  assert.equal(DEVICE_COMPOSITIONS.length,30);
  assert.equal(new Set(DEVICE_COMPOSITIONS.map(d=>JSON.stringify(d.poses))).size,30);
  assert.deepEqual([...new Set(DEVICE_COMPOSITIONS.map(d=>d.count))].sort(),[1,2,3,4,5]);
});
test('new slides are neutral, have stable IDs and scale into every canvas without mutating the project',()=>{
  const project=fixture(),before=structuredClone(project);
  const slide=newCompositionSlide(project,{designId:'fan',profileId:'iphone',palette:project.themes.brand,theme:'brand'},()=> 'new-review-id');
  assert.deepEqual(project,before);assert.equal(slide.reviewId,'new-review-id');assert.equal(slide.capture,null);
  for(const id of Object.keys(project.devices)){const {layers}=resolveLayers({project,slide,deviceId:id});assert.equal(layers.length,3);assert.ok(layers.every(l=>l.type==='device'));assert.equal(slide.layouts[id].panorama,false);}
  assert.equal(JSON.stringify(slide).includes('Map my day'),false);
  project.slides.push(slide);assert.equal(newCompositionSlide(project,{designId:'fan',profileId:'iphone'},()=> 'another').id,'fan-2');
});
test('applying poses preserves text, screenshot choices, tags, appearance and unrelated canvases',()=>{
  const project=fixture(),slide=project.slides[0],before=structuredClone(slide);
  const next=withDeviceComposition(project,slide,{designId:'fan',profileId:'iphone',deviceIds:['phone']});
  assert.deepEqual(slide,before);
  const layers=next.layouts.phone.layers,devices=layers.filter(l=>l.type==='device');
  assert.deepEqual(layers.find(l=>l.type==='text'),before.layouts.phone.layers[2]);
  assert.deepEqual(devices.map(l=>l.capture),['screen-a','screen-b',undefined]);
  assert.equal(devices[0].tag,'product');assert.equal(devices[0].opacity,.8);
  assert.deepEqual(resolveLayers({project,slide:next,deviceId:'tablet'}),resolveLayers({project,slide,deviceId:'tablet'}));
  assert.equal(JSON.stringify(next).includes('"_'),false);
});
test('intentional crops have explicit export permission and hardware ratio includes bezel dimensions',()=>{
  const project=fixture(),frames={phone:{screen:{w:1206,h:2622},size:[1380,2860]}};
  assert.equal(compositionHardware(project,'iphone',frames).ratio,1380/2860);
  const next=withDeviceComposition(project,project.slides[0],{designId:'close-up',profileId:'iphone',deviceIds:['phone'],frames});
  assert.equal(next.layouts.phone.layers[0].allowCrop,true);
  assert.throws(()=>withDeviceComposition(project,project.slides[0],{designId:'missing',profileId:'iphone',deviceIds:['phone']}));
});

test('composition changes keep decoration edits and independent language layouts intact',()=>{
  const project=fixture(),slide=project.slides[0];
  project.panorama={phone:{offsets:[0],route:{d:'M0 0 L50 50',width:4},art:[{id:'globe',src:'globe',matrix:[1,0,0,1,0,0]}]}};
  slide.layouts.phone.panorama=true;
  slide.layouts.phone.overrides={globe:{tag:'brand',decorationBox:{x:12,y:34,w:200,h:200,rot:20}}};
  slide.localeLayouts={sv:{phone:{independent:true,template:'custom',layers:[{id:'local',type:'device',capture:'sv-shot'}]}}};
  const before=resolveLayers({project,slide,deviceId:'phone'}).layers.find(l=>l.id==='globe');
  const next=withDeviceComposition(project,slide,{designId:'duet',profileId:'iphone',deviceIds:['phone']});
  assert.deepEqual(resolveLayers({project,slide:next,deviceId:'phone'}).layers.find(l=>l.id==='globe'),before);
  assert.deepEqual(next.localeLayouts,slide.localeLayouts);
});

const hardwareFixture = () => ({...fixture(),devices:{
  iphone:{label:'iPhone',layout:'phone',size:[1320,2868],capture:'iphone',frame:{type:'plain',screen:[1206,2622]}},
  ipad:{label:'iPad',layout:'tablet',size:[2064,2752],capture:'ipad',frame:{type:'bezel',name:'ipad'}},
  'duo-inner':{label:'Duo open',layout:'wide',size:[2853,2007],capture:'duo-inner',frame:{type:'duo',display:'inner',orientation:'landscape',finish:'night-sky'}},
  'duo-outer':{label:'Duo closed',layout:'outer',size:[1398,2034],capture:'duo-outer',frame:{type:'duo',display:'outer'}},
}});
const hardwareFrames = {ipad:{size:[1900,2620],screen:{x:130,y:130,w:1640,h:2360}}};
test('Match canvas creates iPhone, iPad and both Duo frames with their own geometry',()=>{
  const project=hardwareFixture(),before=structuredClone(project);
  const slide=newCompositionSlide(project,{designId:'fan',profileId:'',frames:hardwareFrames},()=> 'hardware-review-id');
  assert.deepEqual(project,before);
  const rotations=[];
  for(const [id,canvas] of Object.entries(project.devices)){
    const hardware=compositionHardware(project,'',hardwareFrames,id);
    const expected=compositionGeometry('fan',...canvas.size,hardware.ratio);
    const {layers}=resolveLayers({project,slide,deviceId:id});
    assert.equal(layers.length,3);
    layers.forEach((layer,i)=>{
      assert.equal(layer.profile,undefined);
      assert.equal(deviceForLayer(project,canvas,layer,hardwareFrames).capture,canvas.capture);
      assert.deepEqual(layer.frame ?? canvas.frame,canvas.frame);
      assert.equal(layer.w,expected[i].w);assert.equal(layer.top,expected[i].cy-expected[i].h/2);
    });
    rotations.push(layers[0].rotate);
  }
  assert.deepEqual(rotations,[-18,-12,-9,-12]);
});
test('Duo outer dimensions include hardware padding and honour project orientation and finish',()=>{
  const project=hardwareFixture();
  assert.equal(compositionHardware(project,'duo-inner').ratio,2983/2137);
  assert.deepEqual(profilesFor(project)['duo-inner'].frame,project.devices['duo-inner'].frame);
  project.devices['duo-inner'].frame.orientation='portrait';
  assert.equal(compositionHardware(project,'duo-inner').ratio,2137/2983);
  assert.deepEqual(deviceForLayer(project,project.devices.ipad,{profile:'duo-outer'}).size,[1398,2034]);
  const padding=2*(63*1398/2007+2);
  assert.deepEqual(frameOuterSize(project.devices['duo-outer'].frame),[1398+padding,2034+padding]);
});
test('canvas matching uses the configured frame, even with custom canvas IDs and output aspect ratios',()=>{
  const project=hardwareFixture();project.devices.promo={...project.devices.ipad,size:[1600,900]};
  assert.equal(compositionHardware(project,'',hardwareFrames,'promo').ratio,1900/2620);
  assert.equal(compositionFamily(1900/2620),'tablet');assert.equal(compositionFamily(2983/2137),'wide');
  assert.equal(compositionFamily(1206/2622),'phone');
  const explicit=newCompositionSlide(project,{designId:'parallel',profileId:'duo-inner'},()=> 'explicit');
  for(const block of Object.values(explicit.layouts)) assert.ok(block.layers.every(layer=>layer.profile==='duo-inner'));
});
test('tablet and wide grids keep each complete frame separate instead of scaling an overlapping phone grid',()=>{
  for(const ratio of [1900/2620,2983/2137])for(const [W,H]of [[2064,2752],[2853,2007],[1320,2868]]){
    for(const id of ['parallel','trio','grid','wall','stack']){
      const boxes=compositionGeometry(id,W,H,ratio);
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i],b=boxes[j];
        assert.ok(Math.abs(a.cx-b.cx)>(a.w+b.w)/2 || Math.abs(a.cy-b.cy)>(a.h+b.h)/2,`${id}: ${ratio} on ${W}x${H}`);
      }
    }
  }
});
