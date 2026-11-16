import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {zipSync,unzipSync,strToU8} from 'fflate';
import * as THREE from 'three';
import {bakeAtlasVertex} from './atlas-source.mjs';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const source=`export * from './packages/resource-pack/src/index';export * from './packages/voxel/src/resource-geometry';export * from './packages/voxel/src/visual-biome';export {resolveBlockStateTint} from './packages/voxel/src/resource-textures';`;
const bundle=buildSync({absWorkingDir:repo,stdin:{contents:source,resolveDir:repo,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,metafile:true});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceHashes=Object.fromEntries(Object.keys(bundle.metafile.inputs).filter(p=>!p.startsWith('<')).map(p=>[p.replaceAll('\\','/'),sha(fs.readFileSync(path.join(repo,p)))]));
sourceHashes['apps/native-android/tools/atlas-source.mjs']=sha(fs.readFileSync(new URL('./atlas-source.mjs',import.meta.url)));
const producerPath=path.join(repo,'apps/native-android/world-core/build/generated/native-resource-blocks-oracle/native-resource-blocks-oracle.json');
const producer=JSON.parse(fs.readFileSync(producerPath,'utf8'));for(const[p,h]of Object.entries(producer.sourceHashes))assert.equal(sha(fs.readFileSync(path.join(repo,p))),h);
const rawCases=producer.cases.map(c=>({name:c.name,zip:c.zip,queries:c.resolutions.map(({blockId,state,position})=>({blockId,state,...(position?{position}:{})}))}));
const base=unzipSync(Buffer.from(producer.cases.find(c=>c.name==='simple').zip,'base64'));
const faces=['down','up','north','south','west','east'];
function record(name,id,model,queries=[{blockId:id,state:{}}],extra={}){
 const files={...base,...extra,[`assets/${id.replace(':','/blockstates/')}.json`]:strToU8(JSON.stringify({variants:{'':{model:'minecraft:block/test'}}})),
  'assets/minecraft/models/block/test.json':strToU8(JSON.stringify(model))};
 rawCases.push({name,zip:Buffer.from(zipSync(files)).toString('base64'),queries});
}
const model=(tintIndex,rotation=0)=>({textures:{all:'block/a'},elements:[{from:[0,0,0],to:[16,16,16],faces:Object.fromEntries(faces.map(f=>[f,{texture:'#all',rotation,...(tintIndex===null?{}:{tintindex:tintIndex})}]))}]});
const tintIds=['oak_leaves','jungle_leaves','acacia_leaves','dark_oak_leaves','mangrove_leaves','vine','grass_block','short_grass','tall_grass','fern','large_fern','potted_fern','bush','sugar_cane','water','bubble_column','water_cauldron','leaf_litter','spruce_leaves','birch_leaves','lily_pad','attached_melon_stem','attached_pumpkin_stem','unknown_vanilla','pink_petals','wildflowers'];
for(const id of tintIds)for(const index of [0,1])record(`tint:${id}:${index}`,`minecraft:${id}`,model(index));
for(const id of ['redstone_wire','melon_stem','pumpkin_stem']){
 const key=id==='redstone_wire'?'power':'age',maximum=id==='redstone_wire'?15:7;
 const states=[...Array.from({length:maximum+1},(_,i)=>String(i)),'-1','01','1.0','NaN','99','', '9999999999999999999'];
 record(`state-tint:${id}`,`minecraft:${id}`,model(0),[{},...states.map(v=>({[key]:v}))].map(state=>({blockId:`minecraft:${id}`,state})));
}
record('unknown-mod-tint','test:unknown',model(0));record('unknown-mod-no-tint','test:unknown',model(null));
for(const rotation of [0,90,180,270])for(const reverse of [false,true]){
 const m=model(null,rotation);m.elements[0].from=reverse?[16,2,15]:[1,2,3];m.elements[0].to=reverse?[1,16,3]:[15,16,14];
 for(const f of Object.values(m.elements[0].faces))f.uv=[15,2,1,14];record(`crop:${rotation}:${reverse}`,'minecraft:test',m);
}
// A varied, entirely synthetic pack for an actual normal-world GPU gallery.
// Uses the same parser/model/compiler as user packs, without distributing MC artwork.
const galleryFiles={...base},galleryQueries=[];
const element=(from,to,more={})=>({...model(null).elements[0],from,to,...more});
const galleryModels=[model(null),{textures:{all:'block/a'},elements:[element([0,0,0],[16,8,16])]},
 {textures:{all:'block/b'},elements:[element([0,0,0],[16,8,16]),element([0,8,8],[16,16,16])]},
 {textures:{all:'block/c'},elements:[element([8,0,0],[8,16,16]),element([0,0,8],[16,16,8])]},
 {textures:{all:'block/b'},elements:[element([6,0,6],[10,16,10]),element([0,4,7],[16,7,9]),element([0,11,7],[16,14,9])]},
 {textures:{all:'block/a'},elements:[element([0,0,0],[16,3,16],{rotation:{origin:[8,8,8],axis:'z',angle:22.5,rescale:true}})]},
 {textures:{all:'block/c'},elements:[element([2,0,2],[14,16,14],{rotation:{origin:[8,8,8],x:15,y:-35,z:20}})]},
 {textures:{all:{sprite:'block/a',force_translucent:true}},elements:[element([7,0,0],[9,16,16])]}];
for(let i=0;i<9;i++){
 const id=`minecraft:gallery${i}`;galleryFiles[`assets/minecraft/blockstates/gallery${i}.json`]=strToU8(JSON.stringify({variants:{'':{model:`block/gallery${i}`}}}));
 if(galleryModels[i])galleryFiles[`assets/minecraft/models/block/gallery${i}.json`]=strToU8(JSON.stringify(galleryModels[i]));
 galleryQueries.push({blockId:id,state:{}});
}
rawCases.push({name:'render-gallery',zip:Buffer.from(zipSync(galleryFiles)).toString('base64'),queries:galleryQueries});
const colormaps=[]; // Palette sampling is covered separately below with raw fixed RGBA inputs.
const paletteSamples=[];
for(const [temperature,downfall]of [[.8,.4],[0,0],[1,1],[-1,3],[.5,.5]]){
 const maps=['grass','foliage','dry_foliage'].map((kind,k)=>{const rgba=Uint8Array.from({length:256*256*4},(_,i)=>i%4===3?255:((i>>2)*(k+3)+i%4*37)%256);return {kind,width:256,height:256,rgba};});
 paletteSamples.push({temperature,downfall,maps:maps.map(m=>({kind:m.kind,rgba:Buffer.from(m.rgba).toString('base64')})),expected:api.createVisualBiomePalette(maps,{temperature,downfall})});
}
const cases=[];let queryCount=0,accepted=0;
for(const row of rawCases){
 const parsed=api.parseJava16xResourcePack(Buffer.from(row.zip,'base64'));const atlas=api.buildJava16xTextureAtlas(parsed);const palette=api.createVisualBiomePalette(colormaps);
 const queries=row.queries.map(q=>{
  queryCount++;const resolved=api.resolveBlockGeometry(parsed,q.blockId,q.state,q.position),mapped=api.mapBlockGeometryToAtlas(resolved,atlas);
  if(mapped.status!=='resolved_geometry')return {...q,expected:{fallback:mapped.reason}};
  const voxel={x:0,y:0,z:0,materialId:'stone',buildOrder:0,sourceBlockId:q.blockId,sourceBlockState:q.state};
  const plans=api.compileMappedGeometryVoxelPages(voxel,mapped);if(!plans)return {...q,expected:{fallback:'UNCOMPILED'}};
  accepted++;
  const parts=plans.map(plan=>{
   const batch={...plan,signature:plan.topology.signature,entries:[plan]},geometry=api.createAtlasGeometry(batch),page=atlas.pages[plan.page];
   const names=['foliage','grass','water','dryFoliage','spruceLeaves','birchLeaves','lilyPad'];
   const tints=[[1,1,1],...names.map(n=>new THREE.Color(palette[n]).toArray()),...Array.from({length:3},()=>new THREE.Color(plan.stateTintRgb??0xffffff).toArray())];
   const definition={shape:true,size:[page.width,page.height],columns:page.columns,cell:page.textureSize+atlas.gutter*2,padding:atlas.gutter,
    matrix:[1,0,0,0,1,0,0,0,1],vertexColors:false,tints};
   const appearance={tiles:plan.faceTiles,tint:plan.faceTintWord,flow:0};
   const vertex=[];for(let i=0;i<geometry.getAttribute('position').count;i++){
    const attr=(name,size)=>Array.from({length:size},(_,k)=>geometry.getAttribute(name).array[i*size+k]);
    const p=attr('position',3),n=attr('normal',3),uv=attr('uv',2);
    const baked=bakeAtlasVertex({position:p,normal:n,uv,slot:attr('faceSlot',1)[0],occlusionSlot:attr('faceOcclusionSlot',1)[0],shade:attr('faceShadeFactor',1)[0]},appearance,definition);
    vertex.push(...[...p,...n,...baked.uv,...baked.color].map(Math.fround));
   }
   const result={page:plan.page,alphaMode:plan.alphaMode,vertex,indices:Array.from(geometry.index.array)};geometry.dispose();return result;
  });return {...q,expected:{parts}};
 });cases.push({...row,queries});
}
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-resource-geometry-oracle.json'),JSON.stringify({schema:1,sourceHashes,producerSha256:sha(fs.readFileSync(producerPath)),cases,paletteSamples}));
console.log(JSON.stringify({cases:cases.length,queries:queryCount,accepted,sourceFiles:Object.keys(sourceHashes).length}));
