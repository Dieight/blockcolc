import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const source='packages/voxel/src/renderer.ts',text=fs.readFileSync(path.join(repo,source),'utf8').replace(/\r\n/g,'\n');
function section(start,end){const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a,`Construction source moved: ${start}`);return text.slice(a,b);}
const colors=section('const colors: Record<string, number> = {','\n};')+'\n};';
const material=section('  function material(id: string): THREE.MeshStandardMaterial {','  function flatDebugColorFor(');
const overlays=section('  function addVines(', '  function addWorldScenery(');
const entry=`import * as THREE from 'three';
import {parseFallbackVisualKey} from ${JSON.stringify(path.join(repo,'packages/voxel/src/fallback-visual.ts'))};
import {materialResponse,materialResponseForMaterialId} from ${JSON.stringify(path.join(repo,'packages/voxel/src/material-response.ts'))};
import {createOriginalMaterialTexture,originalPatternForMaterialId} from ${JSON.stringify(path.join(repo,'packages/voxel/src/original-materials.ts'))};
${colors}
const materials=new Map(),originalMaterialTextures=new Map(),options={},animalsEnabled=false;
let plannedOutlineVoxelCount=0;
function trackMaterialEffects(value,edge){value.userData.edgeStrength=edge;}
${material}
${overlays}
export function subject(input){
 const root=new THREE.Group();addVines(root,input.vines);addPlannedOutline(root,input.blueprint,input.completion,input.visible);
 const p=input.placement,parent=new THREE.Matrix4().makeTranslation(...p.position).multiply(new THREE.Matrix4().makeRotationY(p.rotation)).multiply(new THREE.Matrix4().makeTranslation(p.offset[0],0,p.offset[1]));
 root.applyMatrix4(parent);root.updateMatrixWorld(true);
 return root.children.map(mesh=>{const m=mesh.material,matrices=[];
  for(let index=0;index<mesh.count;index++){const local=new THREE.Matrix4();mesh.getMatrixAt(index,local);matrices.push(...new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld,local).elements);}
  return {kind:mesh.userData.decayFeature==='vines'?'vines':'outline',count:mesh.count,matrices,
   material:{color:m.color.toArray(),opacity:m.opacity,roughness:m.roughness,metalness:m.metalness,transparent:m.transparent,depthWrite:m.depthWrite,
    castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow,texture:m.map?Array.from(m.map.image.data):null,textureWidth:m.map?.image.width??0,textureHeight:m.map?.image.height??0,
    edgeStrength:m.userData.edgeStrength??null}};
 });
}`;
const compiled=await build({stdin:{contents:entry,loader:'ts',resolveDir:repo},bundle:true,write:false,platform:'node',format:'esm',metafile:true,logLevel:'silent'});
const {subject}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const blueprints=[];
for(const kind of ['solid','plate','sparse']){
 const voxels=[];for(let x=0;x<3;x++)for(let y=0;y<(kind==='plate'?1:3);y++)for(let z=0;z<3;z++){
  if(kind==='sparse'&&x===1&&z===1&&y===1)continue;
  voxels.push({x:x-3,y:y-2,z:z-1,materialId:'stone',stage:'walls',buildOrder:1000+((x+y+z)%3)*3500});
 }
 blueprints.push({schemaVersion:1,id:kind,title:kind,bounds:{minX:-3,maxX:-1,minY:-2,maxY:kind==='plate'?-2:0,minZ:-1,maxZ:1},voxels});
}
const cases=[];
for(const blueprint of blueprints)for(const completion of [0,4500,9999,10000])for(const visible of [false,true])for(const rotated of [false,true]){
 const placement={position:rotated?[350,7,-120]:[0,0,0],rotation:rotated?Math.PI/2:0,offset:rotated?[2,-3]:[0,0]};
 const vines=cases.length%3===0?[]:Array.from({length:cases.length%3===1?2:12},(_,i)=>({x:-2+(i%2)*.51,y:1+i*.12,z:i%2?-.51:0,axis:i%2?'z':'x'}));
 const input={blueprint,completion,visible,placement,vines};cases.push({input,meshes:subject(input)});
}
const self=path.relative(repo,fileURLToPath(import.meta.url)).replaceAll('\\','/');
const inputs=new Set([source,self,'package-lock.json']);
for(const input of Object.keys(compiled.metafile.inputs))if(input!=='<stdin>'){
 const name=path.relative(repo,path.resolve(input)).replaceAll('\\','/');assert.ok(!name.startsWith('../'));inputs.add(name);
}
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-construction-oracle.json'),JSON.stringify({schema:1,sourceHashes:Object.fromEntries([...inputs].sort().map(p=>[p,sha(p)])),cases}));
console.log(`Native construction details: ${cases.length} actual renderer/Three inputs.`);
