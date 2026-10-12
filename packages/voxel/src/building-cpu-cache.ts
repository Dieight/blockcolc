import * as THREE from 'three';
import type { BlueprintV1, BlueprintVoxel } from './blueprint-model';
import { conditionVisualForVoxels, type ConditionVisual } from './environment';
import { blockOcclusionFor, createLocalOcclusionField } from './local-occlusion';
import { planMovingPistonRenderVoxels } from './resource-special-piston';

export const BUILDING_CPU_CACHE_REVISION=1;
export const BUILDING_CPU_CACHE_MAX_BYTES=32*1024*1024;
export interface CpuGeometry {
  attributes: Record<string,{array:Float32Array;itemSize:number}>;
  index: Uint32Array|null;
}
export interface OriginalCpuBatch {
  topologyKey:string;materialId:string;emissiveKind:string;emissiveLevel:number;
  indices:Uint32Array;matrices:Float32Array;geometry:CpuGeometry;
}
export interface OriginalCpuPlan {
  batches:OriginalCpuBatch[];handled:Uint32Array;topologies:number;topologyOverflow:number;
  materialGroups:number;materialOverflow:number;fallbackCount:number;
}
export interface BuildingCpuRecipe {
  key:string;visual:ConditionVisual;occlusion:Float32Array;
  originals:Map<string,OriginalCpuPlan>;
  cubeMatrices:Map<string,Float32Array>;
}
export interface BuildingCpuCache {
  revision:typeof BUILDING_CPU_CACHE_REVISION;recipes:BuildingCpuRecipe[];
}
export interface BuildingCpuCachePort { read():Promise<unknown>;write(entry:BuildingCpuCache):void }

const fingerprints=new WeakMap<object,string>();
/** Content, not ID/title: replacing a blueprint with the same ID invalidates it. */
export function blueprintGeometryFingerprint(blueprint:BlueprintV1):string {
  const existing=fingerprints.get(blueprint);if(existing)return existing;
  const payload=JSON.stringify([blueprint.bounds,blueprint.voxels]);
  let a=0x9e3779b9,b=0x85ebca6b,c=0xc2b2ae35,d=0x27d4eb2f;
  for(let i=0;i<payload.length;i++){
    const code=payload.charCodeAt(i);a=Math.imul(a^code,0x85ebca6b);b=Math.imul(b^code,0xc2b2ae35);
    c=Math.imul(c^code,0x27d4eb2f);d=Math.imul(d^code,0x165667b1);
  }
  const fingerprint=`${payload.length}:${blueprint.voxels.length}:${[a,b,c,d].map(v=>(v>>>0).toString(16)).join(':')}`;
  // Only immutable blueprint graphs may retain a content fingerprint.
  if(Object.isFrozen(blueprint)&&Object.isFrozen(blueprint.voxels))fingerprints.set(blueprint,fingerprint);
  return fingerprint;
}
export function buildingCpuKey(blueprint:BlueprintV1,projectId:string,completion:number,condition:number):string {
  return JSON.stringify([BUILDING_CPU_CACHE_REVISION,blueprintGeometryFingerprint(blueprint),projectId,completion,condition]);
}
export function prepareBuildingCpuRecipe(key:string,blueprint:BlueprintV1,projectId:string,completion:number,condition:number):BuildingCpuRecipe {
  const voxels=planMovingPistonRenderVoxels(blueprint.voxels).displayVoxels.filter(v=>v.buildOrder<=completion);
  const visual=conditionVisualForVoxels(projectId,voxels,condition);
  const field=createLocalOcclusionField(visual.intactVoxels);
  return {key,visual,occlusion:Float32Array.from(visual.intactVoxels,v=>blockOcclusionFor(v,field)),originals:new Map(),cubeMatrices:new Map()};
}
export function captureCpuGeometry(geometry:THREE.BufferGeometry):CpuGeometry {
  const attributes:CpuGeometry['attributes']={};
  for(const [name,attribute] of Object.entries(geometry.attributes)){
    attributes[name]={array:Float32Array.from(attribute.array),itemSize:attribute.itemSize};
  }
  return {attributes,index:geometry.index?Uint32Array.from(geometry.index.array):null};
}
export function restoreCpuGeometry(data:CpuGeometry):THREE.BufferGeometry {
  const geometry=new THREE.BufferGeometry();
  for(const [name,attribute] of Object.entries(data.attributes))geometry.setAttribute(name,new THREE.BufferAttribute(attribute.array,attribute.itemSize));
  if(data.index)geometry.setIndex(new THREE.BufferAttribute(data.index,1));
  return geometry;
}
export function buildingCpuCacheBytes(entry:BuildingCpuCache):number {
  let bytes=0;const visited=new WeakSet<object>();
  const count=(value:unknown):void=>{
    if(typeof value==='string'){bytes+=value.length*2;return;}
    if(typeof value==='number'||typeof value==='boolean'){bytes+=8;return;}
    if(value===null||typeof value!=='object'||visited.has(value))return;
    visited.add(value);bytes+=32;
    if(ArrayBuffer.isView(value)){bytes+=value.byteLength;return;}
    if(map(value)){for(const [key,item] of value){count(key);count(item);}return;}
    for(const item of Object.values(value))count(item);
  };
  count(entry);return bytes;
}
const record=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const map=(v:unknown):v is Map<unknown,any>=>Object.prototype.toString.call(v)==='[object Map]';
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
const floats=(v:unknown):v is Float32Array=>ArrayBuffer.isView(v)&&Object.prototype.toString.call(v)==='[object Float32Array]'&&(v as Float32Array).length<=8_000_000&&(v as Float32Array).every(number);
const indices=(v:unknown,count:number):v is Uint32Array=>ArrayBuffer.isView(v)&&Object.prototype.toString.call(v)==='[object Uint32Array]'&&(v as Uint32Array).length<=2_000_000&&(v as Uint32Array).every(i=>i<count);
function validGeometry(value:unknown):value is CpuGeometry {
  if(!record(value)||!record(value.attributes)||!record(value.attributes.position))return false;
  const attributes=Object.entries(value.attributes);if(attributes.length>16)return false;
  for(const [name,attribute] of attributes){
    if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)||!record(attribute)||!Number.isInteger(attribute.itemSize)
      ||attribute.itemSize<1||attribute.itemSize>4||!floats(attribute.array)||attribute.array.length%attribute.itemSize)return false;
  }
  const position=value.attributes.position;
  const count=position.array.length/position.itemSize;
  return position.itemSize===3&&attributes.every(([,v])=>v.array.length/v.itemSize===count)
    &&(value.index===null||indices(value.index,count)&&value.index.length%3===0);
}
/** Corrupt/old derived records are discarded; authoritative blueprints stay untouched. */
export function restoreBuildingCpuCache(value:unknown):BuildingCpuCache|null {
  try{
    if(!record(value)||value.revision!==BUILDING_CPU_CACHE_REVISION||!Array.isArray(value.recipes)||value.recipes.length>256)return null;
    let voxels=0;
    for(const recipe of value.recipes){
      if(!record(recipe)||typeof recipe.key!=='string'||recipe.key.length>2048||!record(recipe.visual)||!map(recipe.originals)||recipe.originals.size>4||!map(recipe.cubeMatrices)||recipe.cubeMatrices.size>256)return null;
      for(const [key,matrices] of recipe.cubeMatrices)if(typeof key!=='string'||key.length>4_000_000||!floats(matrices)||matrices.length%16)return null;
      const visual=recipe.visual;
      if(!Array.isArray(visual.intactVoxels)||!Array.isArray(visual.missingVoxels)||!Array.isArray(visual.vines)||visual.vines.length>250_000
        ||!number(visual.weathering)||visual.weathering<0||visual.weathering>1||!floats(recipe.occlusion)||recipe.occlusion.length!==visual.intactVoxels.length)return null;
      voxels+=visual.intactVoxels.length+visual.missingVoxels.length;if(voxels>500_000)return null;
      for(const v of [...visual.intactVoxels,...visual.missingVoxels]){
        if(!record(v)||!['x','y','z','buildOrder'].every(k=>number(v[k]))||typeof v.materialId!=='string'||v.stage!==undefined&&typeof v.stage!=='string'
          ||v.sourceBlockId!==undefined&&typeof v.sourceBlockId!=='string'
          ||v.sourceBlockState!==undefined&&(!record(v.sourceBlockState)||!Object.values(v.sourceBlockState).every(s=>typeof s==='string')))return null;
      }
      if(!visual.vines.every((v:unknown)=>record(v)&&['x','y','z'].every(k=>number(v[k]))&&['x','z'].includes(v.axis)))return null;
      for(const [key,plan] of recipe.originals){
        if(typeof key!=='string'||key.length>4_000_000||!record(plan)||!Array.isArray(plan.batches)||plan.batches.length>64
          ||!indices(plan.handled,visual.intactVoxels.length)||!['topologies','topologyOverflow','materialGroups','materialOverflow','fallbackCount'].every(k=>Number.isSafeInteger(plan[k])&&plan[k]>=0))return null;
        for(const batch of plan.batches){
          if(!record(batch)||typeof batch.topologyKey!=='string'||typeof batch.materialId!=='string'||batch.materialId.length>1024
            ||typeof batch.emissiveKind!=='string'||!number(batch.emissiveLevel)||batch.emissiveLevel<0||batch.emissiveLevel>15
            ||!indices(batch.indices,visual.intactVoxels.length)||!floats(batch.matrices)||batch.matrices.length!==batch.indices.length*16||!validGeometry(batch.geometry))return null;
        }
      }
    }
    return buildingCpuCacheBytes(value as BuildingCpuCache)<=BUILDING_CPU_CACHE_MAX_BYTES?value as BuildingCpuCache:null;
  }catch{return null;}
}

/** Bound live recipes and retain only current/recent building states. */
export function createBuildingCpuCache(){
  const recipes=new Map<string,BuildingCpuRecipe>();
  const sizes=new Map<string,number>();let total=0;
  const snapshot=():BuildingCpuCache=>({revision:BUILDING_CPU_CACHE_REVISION,recipes:[...recipes.values()]});
  const trim=()=>{while(recipes.size>256||total>BUILDING_CPU_CACHE_MAX_BYTES){const key=recipes.keys().next().value!;total-=sizes.get(key)??0;recipes.delete(key);sizes.delete(key);}};
  const put=(recipe:BuildingCpuRecipe)=>{total-=sizes.get(recipe.key)??0;const bytes=buildingCpuCacheBytes({revision:BUILDING_CPU_CACHE_REVISION,recipes:[recipe]});sizes.set(recipe.key,bytes);total+=bytes;recipes.set(recipe.key,recipe);trim();};
  return {
    restore(value:unknown){const entry=restoreBuildingCpuCache(value);if(!entry)return false;for(const recipe of entry.recipes)put(recipe);return true;},
    get(key:string){const recipe=recipes.get(key);if(recipe){recipes.delete(key);recipes.set(key,recipe);}return recipe;},
    put,
    snapshot(){trim();return snapshot();},
  };
}
