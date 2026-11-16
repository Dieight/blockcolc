import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const source='packages/voxel/src/resource-special-block-entity.ts';
const entry=`import * as THREE from 'three';
import {createStaticBlockEntityDisplayRenderer,planStaticSignDisplay,planStaticCampfireItemMarkers,staticItemMarkerAppearance,standingSignYaw} from ${JSON.stringify(path.join(repo,source))};
// Only replace the platform Canvas, never the source planner or geometry. Glyph
// raster parity is separately tested with the actual Android implementation.
globalThis.document={createElement(){return {width:0,height:0,getContext(){return new Proxy({}, {get(o,k){return o[k]??(()=>{});},set(o,k,v){o[k]=v;return true;}})}}}};
function meshFact(mesh){
 const g=mesh.geometry,m=mesh.material,instances=[],colors=[];
 const count=mesh.isInstancedMesh?mesh.count:1;
 for(let i=0;i<count;i++){const matrix=new THREE.Matrix4();if(mesh.isInstancedMesh)mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);instances.push(...matrix.elements);
  const color=new THREE.Color(1,1,1);if(mesh.instanceColor)mesh.getColorAt(i,color);colors.push(...color.toArray());}
 const uv=Array.from(g.attributes.uv?.array??[]);
 if(mesh.userData.specialBlockKind==='approximate_sign_text')for(let i=0;i<uv.length;i+=2){uv[i]=(uv[i]*8)%1;uv[i+1]=(uv[i+1]*8)%1;}
 return {kind:mesh.userData.specialBlockKind,position:Array.from(g.attributes.position.array),normal:Array.from(g.attributes.normal.array),uv,
  indices:g.index?Array.from(g.index.array):Array.from({length:g.attributes.position.count},(_,i)=>i),instances,colors,
  material:{color:m.color.toArray(),roughness:m.roughness??null,metalness:m.metalness??null,emission:m.emissive?.toArray()??[0,0,0],emissionStrength:m.emissiveIntensity??0,
   unlit:!!m.isMeshBasicMaterial,texture:!!m.map,opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite,side:m.side,toneMapped:m.toneMapped,fog:m.fog,
   castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow}};
}
export function subject(requests){
 const renderer=createStaticBlockEntityDisplayRenderer(),results=[];
 for(const r of requests){const root=new THREE.Group(),fallback=r.fallback==null?r.voxels:r.fallback.map(i=>r.voxels[i]);
  const replaced=renderer.add(root,r.voxels,fallback);root.updateMatrixWorld(true);
  results.push({replaced:[...replaced].map(v=>r.voxels.indexOf(v)),signs:r.voxels.map(planStaticSignDisplay).map(p=>p?{mounting:p.mounting,yaw:p.yaw}:null),
   markers:r.voxels.map(planStaticCampfireItemMarkers),meshes:root.children.map(meshFact)});
 }
 renderer.reset();return results;
}
export const yaw=standingSignYaw;
export const appearance=staticItemMarkerAppearance;`;
const compiled=await build({stdin:{contents:entry,loader:'ts',resolveDir:repo},bundle:true,write:false,platform:'node',format:'esm',metafile:true,logLevel:'silent'});
const {subject,yaw,appearance}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const face=(lines=['Blockcolc','方块钟','', '26.3'],dyeColor='black',glowing=false)=>({lines,dyeColor,glowing});
const sign=(kind,state,front=face(),back=face(['Back'],'blue',true))=>({x:2,y:4,z:-3,materialId:'wood',stage:'detail',buildOrder:0,sourceBlockId:'minecraft:'+kind,sourceBlockState:state,sign:{front,back}});
const camp=(kind,state)=>({x:2,y:4,z:-3,materialId:'wood',stage:'detail',buildOrder:0,sourceBlockId:'minecraft:'+kind,sourceBlockState:state,
 campfire:{slots:[{slot:3,itemId:'minecraft:beef',count:64},{slot:0,itemId:'minecraft:potato',count:1},{slot:2,itemId:'mod:汉字_😀',count:2}]}});
const cases=[];
for(const kind of ['oak_sign','spruce_hanging_sign'])for(let rotation=0;rotation<16;rotation++)for(const fallback of [null,[]]){
 const input={owner:'building:one',voxels:[sign(kind,{rotation:String(rotation)})],fallback};cases.push({input,expected:subject([input])[0]});}
for(const kind of ['oak_wall_sign','birch_wall_hanging_sign'])for(const facing of ['north','east','south','west','invalid']){
 const input={owner:'building:one',voxels:[sign(kind,{facing})],fallback:null};cases.push({input,expected:subject([input])[0]});}
for(const kind of ['campfire','soul_campfire'])for(const facing of ['north','east','south','west','invalid'])for(const lit of ['false','true'])for(const fallback of [null,[]]){
 const input={owner:'building:one',voxels:[camp(kind,{facing,lit})],fallback};cases.push({input,expected:subject([input])[0]});}
for(const f of [face(['','','','']),face(['No glow'],'unknown',false),face(['\u0000safe\u007f','very long text that shrinks to the board'])]){
 const input={owner:'building:one',voxels:[sign('oak_sign',{rotation:'16'},f,f)],fallback:null};cases.push({input,expected:subject([input])[0]});}
const budget=[];
for(const mode of ['signs','faces','campfires']){
 const requests=Array.from({length:3},(_,owner)=>({owner:'building:b'+owner,voxels:Array.from({length:120},(_,i)=>mode==='campfires'?camp('campfire',{facing:'south'}):sign('oak_sign',{},mode==='faces'?face([String(owner*120+i)]):face(),face(['','','',''])))}));
 const expected=subject(requests).map(r=>({replaced:r.replaced,textFaces:r.meshes.filter(m=>m.kind==='approximate_sign_text').reduce((n,m)=>n+m.indices.length/6,0),tokens:r.meshes.filter(m=>m.kind==='approximate_campfire_item_markers').reduce((n,m)=>n+m.instances.length/16,0)}));
 budget.push({mode,requests,expected});
}
const inputs=new Set([source,path.relative(repo,fileURLToPath(import.meta.url)).replaceAll('\\','/'),'package-lock.json']);
for(const input of Object.keys(compiled.metafile.inputs))if(input!=='<stdin>'){const p=path.relative(repo,path.resolve(input)).replaceAll('\\','/');assert.ok(!p.startsWith('../'));inputs.add(p);}
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,p))).digest('hex');
const rotations=[null,'',' ','0','15','16','-1','1.5','bad','2e0','0x4'].map(value=>({value,yaw:yaw(value??undefined)}));
const items=['minecraft:beef','minecraft:potato','mod:汉字_😀',''].map(id=>({id,expected:appearance(id)}));
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-block-entities-oracle.json'),JSON.stringify({schema:1,sourceHashes:Object.fromEntries([...inputs].sort().map(p=>[p,sha(p)])),cases,budget,rotations,items}));
console.log('Static block entities: '+cases.length+' actual renderer cases, '+budget.length+' world-budget sequences. Canvas glyphs excluded from reference scope.');
