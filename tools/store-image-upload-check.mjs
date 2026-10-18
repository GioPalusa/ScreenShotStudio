// Verify real rendered exports against the upload planner and simulated Apple placements.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AppStoreUploads, inspectUploadExport, readExportImage } from '../host/app-store-connect.mjs';

export async function verifyStoreImageUpload(root) {
 const types={ 'app-store-search':'APP_STORE_SEARCH_RESULTS_ASSET', 'app-store-header':'PRODUCT_PAGE_HEADER_ASSET' };
 const inspected=inspectUploadExport(root);assert.deepEqual(inspected.errors,[]);
 const screenshots=inspected.files.filter(f=>!types[f.target]);
 assert.equal(inspected.files.filter(f=>types[f.target]).length,2,'Both App Store store images are present');
 assert.ok(inspected.files.every(f=>f.store==='app-store'),'Google Play artwork is excluded');
 const expectedCount=2+screenshots.length;
 const sizes=[[5244,2950],[3840,2560],[1920,1280],[3840,1646]];
 const catalog={
  features:[{featureId:'APP_STORE_VERSIONS',placementPolicies:Object.values(types).map(placementType=>({placementType,groupLimits:[{groupIds:['CREATIVE_IMAGE'],maxCount:1}]}))}],
  placementTypes:Object.values(types).map(placementTypeId=>({placementTypeId,acceptsAssetCategories:['CREATIVE_ASSETS'],specMappings:[{placementGroupId:'CREATIVE_IMAGE',specs:(placementTypeId===types['app-store-search']?[0,1,2]:[0,3]).map(i=>'spec-'+i)}]})),
  imageSpecs:sizes.map(([w,h],i)=>({specId:'spec-'+i,dimensions:{minWidth:w,maxWidth:w,minHeight:h,maxHeight:h},aspectRatio:i===0?'16:9':i===3?'21:9':'3:2',mimeTypes:['image/png'],fileExtensions:['.png'],maxFileSize:50*1024*1024})),
 };
 if(screenshots.length){
  catalog.features[0].placementPolicies.push({placementType:'APP_SCREENSHOT',groupLimits:[{groupIds:['PHONE_IMAGES'],maxCount:10}]});
  catalog.placementTypes.push({placementTypeId:'APP_SCREENSHOT',acceptsAssetCategories:['APP_SCREENSHOTS_AND_PREVIEWS'],specMappings:[{placementGroupId:'PHONE_IMAGES',specs:screenshots.map((_,i)=>'phone-'+i)}]});
  catalog.placementProfileGroups=[{placementProfileGroupId:'PHONE_IMAGES',platform:'IPHONE_APP_STORE'}];
  catalog.imageSpecs.push(...screenshots.map((f,i)=>({specId:'phone-'+i,dimensions:{minWidth:f.size[0],maxWidth:f.size[0],minHeight:f.size[1],maxHeight:f.size[1]},mimeTypes:['image/png'],fileExtensions:['.png'],maxFileSize:50*1024*1024})));
 }
 const placements=[{id:'existing-screenshot',attributes:{placementType:'APP_SCREENSHOT',placementGroup:'CREATIVE_IMAGE'}}];
 const sent=[],requests=[],locales=[...new Set(inspected.files.map(f=>f.locale))];
 const client={
  versions:async()=>[{id:'version',attributes:{platform:'IOS',appStoreState:'PREPARE_FOR_SUBMISSION'}}],
  localizations:async()=>locales.map(locale=>({id:locale,attributes:{locale}})),
  placements:async()=>structuredClone(placements),
  uploadImage:async(library,file,group)=>{
   assert.equal(library,'library');assert.equal(group.category??'APP_SCREENSHOTS_AND_PREVIEWS',types[file.target]?'CREATIVE_ASSETS':'APP_SCREENSHOTS_AND_PREVIEWS');assert.equal(group.placementType??'APP_SCREENSHOT',types[file.target]??'APP_SCREENSHOT');
   const bytes=readExportImage(file.root,file);assert.equal(bytes[25],2);
   const imageId='image-'+sent.length;sent.push({file,group,imageId});return imageId;
  },
  request:async(url,options={})=>{
   if(url==='/v1/appAssetLibraryRefData')return {data:[{attributes:catalog}]};
   if(url==='/v1/apps/app/assetLibrary')return {data:{id:'library'}};
   requests.push({url,...options});
   if(options.method==='POST'&&url==='/v1/appAssetLibraryPlacements'){
    const value=options.body.data;const record={id:'placement-'+requests.length,attributes:{...value.attributes,state:'ASSET_PROCESSING'}};
    assert.ok([...Object.values(types),'APP_SCREENSHOT'].includes(record.attributes.placementType));
    assert.equal(value.relationships.appStoreVersionLocalization.data.id,locales[0]);
    placements.push(record);return {data:record};
   }
   if(options.method==='POST'&&url==='/v1/appAssetLibraryPlacementOrderingRequests'){
    assert.equal(options.body.data.attributes.placementGroup,'PHONE_IMAGES');return {data:{id:'order'}};
   }
   if(options.method==='DELETE'){
    const index=placements.findIndex(p=>url.endsWith('/'+p.id));assert.ok(index>=0);assert.notEqual(placements[index].id,'existing-screenshot');placements.splice(index,1);return {};
   }
   throw new Error('Unexpected Apple mutation: '+url);
  },
 };
 const uploads=new AppStoreUploads({client,reportDirectory:path.join(root,'test-upload-reports')});
 const finish=async id=>{for(let i=0;i<500;i++){const status=uploads.status(id);if(status.state!=='running')return status;await new Promise(r=>setTimeout(r,5));}throw new Error('Upload timed out');};
 const review=await uploads.prepare({root,appId:'app',versionId:'version'});
 assert.deepEqual(review.errors,[]);assert.equal(review.screens.length,expectedCount,'same group ID keeps search/header separate');assert.equal(review.entries.length,expectedCount);
 const first=await finish(uploads.start(review.planId).id);assert.equal(first.state,'complete',first.message);assert.ok(first.files.every(f=>f.placementVerified));
 assert.deepEqual(new Set(sent.map(s=>s.group.placementType??'APP_SCREENSHOT')),new Set([...Object.values(types),...(screenshots.length?['APP_SCREENSHOT']:[])]));
 const kept=await uploads.prepare({root,appId:'app',versionId:'version'});assert.equal(kept.keptGroups.length,expectedCount);assert.equal(kept.entries.length,0);
 const replacement=await uploads.prepare({root,appId:'app',versionId:'version',replace:true});assert.deepEqual(replacement.errors,[]);
 const second=await finish(uploads.start(replacement.planId).id);assert.equal(second.state,'complete',second.message);
 assert.equal(requests.filter(r=>r.method==='DELETE').length,expectedCount);assert.ok(placements.some(p=>p.id==='existing-screenshot'));
 assert.ok(requests.filter(r=>r.url.includes('OrderingRequests')).every(r=>r.body.data.attributes.placementGroup==='PHONE_IMAGES'),'Only ordinary screenshots use ordering');
 // Apple can disable a creative placement; a review must block before any new upload.
 catalog.placementTypes=catalog.placementTypes.filter(t=>t.placementTypeId!==types['app-store-search']);
 const unavailable=await uploads.prepare({root,appId:'app',versionId:'version',replace:true});assert.ok(unavailable.errors.some(error=>error.includes('not enabled this creative placement')));assert.throws(()=>uploads.start(unavailable.planId),/Review/);
 assert.equal(sent.length,expectedCount*2);
 fs.rmSync(path.join(root,'test-upload-reports'),{recursive:true,force:true});
 console.log('PASS: real App Store store-image exports route to search/header creative placements, exclude Google Play, preserve screenshots, verify placements, replace per type and block unavailable Apple destinations (simulated Apple API).');
}
