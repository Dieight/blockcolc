import type { BlueprintVoxel } from './blueprint';
import { TERRAIN_MATERIALS, type MergedGeometryData } from './terrain';
import type { WorldSceneCache } from './world-scene-cache';

type Mesh = Pick<MergedGeometryData,'positions'|'indicesByMaterial'|'sideIndices'|'triangleCount'>;
type Style = Omit<BlueprintVoxel,'x'|'y'|'z'|'buildOrder'>;
const FORMAT = 'blockcolc-cpu-scene-2';
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_VOXELS = 500_000;
const lists = (mesh: Mesh) => [...TERRAIN_MATERIALS.map(m=>mesh.indicesByMaterial[m]),mesh.sideIndices.dirt,mesh.sideIndices.stone];
const meshBytes = (mesh: Mesh) => mesh.positions.length*8+lists(mesh).reduce((n,a)=>n+a.length*4,0);
const styleKey = (voxel:BlueprintVoxel) => JSON.stringify([voxel.materialId,voxel.sourceBlockId??null,voxel.sourceBlockState??null]);

/** Only estimates small metadata and shared-block counts; no buffers allocated
 * on the focus/settlement command path. Encoding happens in scheduled idle work. */
export function packedWorldSceneCacheBytes(entry:WorldSceneCache):number {
  let size=meshBytes(entry.terrain.data)+(entry.terrain.renderMesh?meshBytes(entry.terrain.renderMesh):0)
    +(entry.terrain.key.length+(entry.scenery?.key.length??0))*2+16_384;
  const unique=new Set<BlueprintVoxel>(),styles=new Set<string>();
  for(const object of entry.scenery?.plan.objects??[]) {
    size+=(object.voxels.length+object.distantVoxels.length)*4+object.id.length*2+256;
    for(const voxel of object.voxels)unique.add(voxel);
    for(const voxel of object.distantVoxels)unique.add(voxel);
  }
  for(const voxel of unique)styles.add(styleKey(voxel));
  for(const style of styles)size+=style.length*2+64;
  return size+unique.size*36+entry.terrain.data.naturalTrees.length*64;
}

function packMesh<T extends Mesh>(mesh:T) {
  return {...mesh,positions:new Float64Array(mesh.positions),
    indicesByMaterial:Object.fromEntries(TERRAIN_MATERIALS.map(m=>[m,new Uint32Array(mesh.indicesByMaterial[m])])),
    sideIndices:{dirt:new Uint32Array(mesh.sideIndices.dirt),stone:new Uint32Array(mesh.sideIndices.stone)}};
}

/** Palette + global block table retains exact coordinates and object identity,
 * including near/far subsets and independent far models. No lossy float32. */
export function packWorldSceneCache(entry:WorldSceneCache):unknown {
  const voxels:BlueprintVoxel[]=[],ids=new Map<BlueprintVoxel,number>();
  const references=(values:readonly BlueprintVoxel[])=>Uint32Array.from(values,voxel=>{
    let id=ids.get(voxel);if(id===undefined){id=voxels.length;ids.set(voxel,id);voxels.push(voxel);}return id;
  });
  const scenery=entry.scenery?{...entry.scenery,plan:{...entry.scenery.plan,objects:entry.scenery.plan.objects.map(object=>
    ({...object,voxels:references(object.voxels),distantVoxels:references(object.distantVoxels)}))}}:null;
  const palette:Style[]=[],styleIds=new Map<string,number>(),coordinates=new Float64Array(voxels.length*4);
  const styles=Uint32Array.from(voxels,(voxel,index)=>{
    coordinates.set([voxel.x,voxel.y,voxel.z,voxel.buildOrder],index*4);
    const key=styleKey(voxel);let id=styleIds.get(key);
    if(id===undefined){id=palette.length;styleIds.set(key,id);palette.push({materialId:voxel.materialId,
      ...(voxel.sourceBlockId===undefined?{}:{sourceBlockId:voxel.sourceBlockId}),
      ...(voxel.sourceBlockState===undefined?{}:{sourceBlockState:voxel.sourceBlockState})});}
    return id;
  });
  return {...entry,format:FORMAT,terrain:{...entry.terrain,data:packMesh(entry.terrain.data),
    ...(entry.terrain.renderMesh?{renderMesh:packMesh(entry.terrain.renderMesh)}:{})},scenery,coordinates,styles,palette};
}

const rec=(v:any)=>v!==null&&typeof v==='object';
function unpackMesh(value:any):any {
  if(!rec(value)||!(value.positions instanceof Float64Array)||value.positions.length>6_000_000
    ||!rec(value.indicesByMaterial)||!rec(value.sideIndices))throw Error('Invalid packed mesh');
  const decode=(v:any)=>{
    if(!(v instanceof Uint32Array)||v.length>6_000_000)throw Error('Invalid packed indices');return Array.from(v);
  };
  return {...value,positions:Array.from(value.positions),
    indicesByMaterial:Object.fromEntries(TERRAIN_MATERIALS.map(m=>[m,decode(value.indicesByMaterial[m])])),
    sideIndices:{dirt:decode(value.sideIndices.dirt),stone:decode(value.sideIndices.stone)}};
}

/** Bound the encoded input before allocating decoded arrays; ordinary legacy
 * objects still go through the main validator and revision check. */
export function unpackWorldSceneCache(value:unknown):unknown {
  const v=value as any;if(!rec(v)||v.format!==FORMAT)return value;
  if(!rec(v.terrain)||!(v.coordinates instanceof Float64Array)||!(v.styles instanceof Uint32Array)
    ||v.styles.length>MAX_VOXELS||v.coordinates.length!==v.styles.length*4
    ||!Array.isArray(v.palette)||v.palette.length>4096)throw Error('Invalid packed blocks');
  let size=v.coordinates.byteLength+v.styles.byteLength;
  for(const mesh of [v.terrain.data,v.terrain.renderMesh].filter(Boolean)){
    if(!rec(mesh)||!(mesh.positions instanceof Float64Array)||!rec(mesh.indicesByMaterial)||!rec(mesh.sideIndices))throw Error('Invalid mesh');
    size+=mesh.positions.byteLength;
    for(const list of [...TERRAIN_MATERIALS.map(m=>mesh.indicesByMaterial[m]),mesh.sideIndices.dirt,mesh.sideIndices.stone]){
      if(!(list instanceof Uint32Array))throw Error('Invalid indices');size+=list.byteLength;
    }
  }
  if(size>MAX_BYTES)throw Error('Packed scene exceeds budget');
  for(const style of v.palette){
    if(!rec(style)||typeof style.materialId!=='string'||style.materialId.length>256
      ||(style.sourceBlockId!==undefined&&(typeof style.sourceBlockId!=='string'||style.sourceBlockId.length>512))
      ||(style.sourceBlockState!==undefined&&(!rec(style.sourceBlockState)||Object.keys(style.sourceBlockState).length>64
        ||!Object.entries(style.sourceBlockState).every(([k,s])=>k.length<=128&&typeof s==='string'&&s.length<=256))))throw Error('Invalid palette');
  }
  const blocks=Array.from(v.styles,(id:number,index:number)=>{
    if(id>=v.palette.length)throw Error('Invalid palette index');
    return {x:v.coordinates[index*4],y:v.coordinates[index*4+1],z:v.coordinates[index*4+2],buildOrder:v.coordinates[index*4+3],...v.palette[id]};
  });
  let references=0;
  const decodeRefs=(list:any)=>{
    if(!(list instanceof Uint32Array)||(references+=list.length)>MAX_VOXELS)throw Error('Invalid block references');
    return Array.from(list,(id:number)=>{if(id>=blocks.length)throw Error('Invalid block index');return blocks[id];});
  };
  if(v.scenery!==null&&(!rec(v.scenery)||!rec(v.scenery.plan)||!Array.isArray(v.scenery.plan.objects)||v.scenery.plan.objects.length>4096))throw Error('Invalid scenery');
  const scenery=v.scenery?{...v.scenery,plan:{...v.scenery.plan,objects:v.scenery.plan.objects.map((object:any)=>
    ({...object,voxels:decodeRefs(object.voxels),distantVoxels:decodeRefs(object.distantVoxels)}))}}:null;
  return {revision:v.revision,terrain:{key:v.terrain.key,data:unpackMesh(v.terrain.data),
    ...(v.terrain.renderMesh?{renderMesh:unpackMesh(v.terrain.renderMesh)}:{})},scenery};
}
