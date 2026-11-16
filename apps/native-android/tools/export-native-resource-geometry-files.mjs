import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {buildSync} from 'esbuild';import * as THREE from 'three';
import {bakeAtlasVertex} from './atlas-source.mjs';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),output=path.resolve(process.argv[2]??'');
assert.ok(output.startsWith(path.join(repo,'artifacts/experiments/v3.0.0')+path.sep),'Keep external asset references in experiment evidence.');
const inputs=process.argv.slice(3).map(p=>path.resolve(p));assert.equal(inputs.length,5,'Client followed by the four user packs.');
const source=`export * from './packages/resource-pack/src/index';export * from './packages/voxel/src/resource-geometry';export * from './packages/voxel/src/visual-biome';`;
const bundle=buildSync({absWorkingDir:repo,stdin:{contents:source,resolveDir:repo,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,metafile:true});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceHashes=Object.fromEntries(Object.keys(bundle.metafile.inputs).filter(p=>!p.startsWith('<')).map(p=>[p.replaceAll('\\','/'),sha(fs.readFileSync(path.join(repo,p)))]));
sourceHashes['apps/native-android/tools/atlas-source.mjs']=sha(fs.readFileSync(new URL('./atlas-source.mjs',import.meta.url)));
function parts(parsed,atlas,palette,q){
 const mapped=api.mapBlockGeometryToAtlas(api.resolveBlockGeometry(parsed,q.blockId,q.state,q.position),atlas);
 if(mapped.status!=='resolved_geometry')return {fallback:mapped.reason};
 const voxel={x:q.position.x,y:q.position.y,z:q.position.z,materialId:'stone',buildOrder:0,sourceBlockId:q.blockId,sourceBlockState:q.state};
 const plans=api.compileMappedGeometryVoxelPages(voxel,mapped);if(!plans)return {fallback:'UNCOMPILED'};
 return {parts:plans.map(plan=>{
  const g=api.createAtlasGeometry({...plan,signature:plan.topology.signature,entries:[plan]}),page=atlas.pages[plan.page];
  const names=['foliage','grass','water','dryFoliage','spruceLeaves','birchLeaves','lilyPad'];
  const tints=[[1,1,1],...names.map(n=>new THREE.Color(palette[n]).toArray()),...Array.from({length:3},()=>new THREE.Color(plan.stateTintRgb??0xffffff).toArray())];
  const d={shape:true,size:[page.width,page.height],columns:page.columns,cell:page.textureSize+atlas.gutter*2,padding:atlas.gutter,matrix:[1,0,0,0,1,0,0,0,1],vertexColors:false,tints};
  const appearance={tiles:plan.faceTiles,tint:plan.faceTintWord,flow:0};const vertex=[];
  for(let i=0;i<g.getAttribute('position').count;i++){
   const attr=(name,size)=>Array.from({length:size},(_,k)=>g.getAttribute(name).array[i*size+k]);const p=attr('position',3),n=attr('normal',3);
   const baked=bakeAtlasVertex({position:p,normal:n,uv:attr('uv',2),slot:attr('faceSlot',1)[0],occlusionSlot:attr('faceOcclusionSlot',1)[0],shade:attr('faceShadeFactor',1)[0]},appearance,d);
   vertex.push(...[...p,...n,...baked.uv,...baked.color].map(Math.fround));
  }
  const result={page:plan.page,alphaMode:plan.alphaMode,vertex,indices:Array.from(g.index.array)};g.dispose();return result;
 })};
}
const archives=[];let base;let queries=0,resolved=0;
for(const file of inputs){
 const bytes=fs.readFileSync(file),single=api.parseJava16xResourcePack(bytes),parsed=base?api.layerResourcePackManifests(base,single):single;if(!base)base=single;
 const atlas=api.buildJava16xTextureAtlas(parsed),palette=api.createVisualBiomePalette((parsed.colormaps??[]).map(c=>({...c,rgba:api.decodeResourcePackColormap(c)})));
 const rows=[];
 for(const block of parsed.blockStates){
  const variants=block.variants;
  const states=block.multipart?[Object.assign({},...block.multipart.flatMap(p=>p.when.clauses).map(c=>Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v[0]]))))]
   :[...new Set([0,Math.floor(variants.length/2),variants.length-1])].filter(i=>i>=0&&i<variants.length).map(i=>variants[i].conditions);
  for(const state of states){const q={blockId:block.resourceId,state,position:{x:19,y:64,z:-31}},expected=parts(parsed,atlas,palette,q);rows.push({...q,expected});queries++;if(expected.parts)resolved++;}
 }
 archives.push({path:file,sha256:sha(bytes),states:parsed.blockStates.length,models:parsed.models.length,atlasEntries:atlas.entries.length,palette,queries:rows});
}
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({schema:1,sourceHashes,archives}));
console.log(JSON.stringify({archives:archives.length,queries,resolved,sourceFiles:Object.keys(sourceHashes).length,bytes:fs.statSync(output).size}));
