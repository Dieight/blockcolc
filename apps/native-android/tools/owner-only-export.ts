import * as THREE from 'three';
import {collectWorldPackets,encodeWorldPackets} from './world-packets.mjs';
import {materialTextures,encodeTexture} from './precipitation-source.mjs';
import {captureEnvironment} from './environment-frame.mjs';
import {captureSourceAnimals} from './animal-source';
import {atlasRuntimeInput} from './atlas-runtime-input.mjs';

// No scenery/sky/particle normalization for a building-only cache. All sampler
// closures and atlas timelines actually used by this owner remain explicit.
const cache=new WeakMap<THREE.Texture,{version:number;value:any}>();
const owner='building:complex-0';
function belongs(object:any){for(let p=object;p;p=p.parent){const id=p.userData.animalObstacle?.id;if(typeof id==='string'&&/^(building|reward):/.test(id))return id===owner;}return false;}
async function sha(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function bundleOwner(fixture:string,progress:number,template:any,strategy:'world'|'owner'='world'){
 const api=(window as any).nativeP1;
 if(!api.construction.toString().includes('cpuOnly'))throw Error('Outdated producer module');
 const began=performance.now();
 const operation=strategy==='owner'?await api.constructionOwner(progress):(await api.construction(progress,false,true),null);
 const built=performance.now();
 const h=api.hook();h.scene.updateMatrixWorld(true);
 const overrides:any[]=[];
 if(strategy==='owner')h.scene.traverse((object:any)=>{const obstacle=object.userData.animalObstacle;if(obstacle?.id===owner)overrides.push(obstacle);});
 if(strategy==='owner'&&overrides.length!==1)throw Error('Expected exactly one newly built owner collider');
 const animal=captureSourceAnimals(h.animals(),owner,strategy==='owner'?overrides:undefined),atlas=await atlasRuntimeInput(h.atlas(),sha);
 const textures=new Set<THREE.Texture>();
 h.scene.traverse((o:any)=>{if(!belongs(o))return;
   for(let p=o;p;p=p.parent)if(!p.visible)return;
   if(o.isSprite||o.isPoints)throw Error('Unadmitted non-static fixture building');
   if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])for(const t of materialTextures(m,h.renderer))textures.add(t);
 });
 for(const {input:a}of atlas.pages){textures.add(a.texture);textures.add(a.blendTexture);}
 const textureIds=new Map(),images=new Map<string,Uint8Array>(),descriptors:any[]=[];
 for(const texture of textures){
   let item=cache.get(texture);if(!item||item.version!==texture.version){item={version:texture.version,value:await encodeTexture(texture,sha)};cache.set(texture,item);}
   const {filename,bytes,descriptor}=item.value,value={...descriptor,...atlas.tags.get(texture)},key=JSON.stringify(value);
   let index=descriptors.findIndex(x=>x.key===key);if(index<0){index=descriptors.length;descriptors.push({id:index,key,...value});}
   textureIds.set(texture,index);images.set(filename,bytes);
 }
 const packets=collectWorldPackets(h.scene,{textureIds,chunkSize:64,maxInstances:1024,renderer:h.renderer,ownerFilter:owner,
   selectObject:(o:any)=>{if(!belongs(o))return false;for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;}});
 const encoded=encodeWorldPackets(packets),animalFile=fixture+'-update.animals.bin';images.set(animalFile,animal.bytes);
 const animations=await Promise.all(atlas.pages.map(async({input:a,identity,page,activeTextureIndices}:any)=>({schema:1,identity,page,texture:textureIds.get(a.texture),blendTexture:textureIds.get(a.blendTexture),width:a.width,height:a.height,tileCount:a.tileCount,sequences:a.sequences,activeTextureIndices,lookupPixelsSha256:await sha(a.pixels),blendPixelsSha256:await sha(a.blendPixels)})));
 return {metadata:{...template,...encoded.manifest,exportSchema:10,textures:descriptors.map(({key,...d})=>d),atlasAnimations:animations,
   resourcePack:api.assetState().resourcePack,animalRuntime:{...animal.descriptor,file:animalFile,sha256:await sha(animal.bytes),activityScale:h.animalActivityScale()},
   environment:captureEnvironment(h.scene,h.renderer,h.pipeline()),camera:h.state(),cameraVolume:h.cameraVolume(),binarySha256:await sha(encoded.bytes),
   scope:'Owner-only exact production CPU construction; no full scenery, sky or weather conversion'},bytes:encoded.bytes,images,timing:{buildMs:built-began,totalMs:performance.now()-began,
    strategy,operation,stages:strategy==='world'?JSON.parse(h.renderer.domElement.dataset.worldRebuildStagesMs??'{}'):null,buildingHits:h.renderer.domElement.dataset.buildingMeshCacheHits,
    terrainHit:h.renderer.domElement.dataset.terrainGenerationCacheHit,terrainMeshHit:h.renderer.domElement.dataset.terrainMeshCacheHit}};
}
