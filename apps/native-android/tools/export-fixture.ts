import * as THREE from 'three';
import {createVoxelRenderer,type WorldSnapshot} from '../../../packages/voxel/src/renderer';
import {BUILTIN_BLUEPRINT_CATALOG} from '../../../packages/voxel/src/blueprint';
// @ts-expect-error Plain JS shared with node:test and the browser exporter.
import {collectWorldPackets,encodeWorldPackets,sourceLayer} from './world-packets.mjs';
// @ts-expect-error Tool-only producer adapter.
import {fullMapSource} from './full-map-source.mjs';
// @ts-expect-error Tool-only lighting snapshot.
import {captureEnvironment} from './environment-frame.mjs';
// @ts-expect-error Tool-only source primitive adapter.
import {completeSceneSource} from './sky-source.mjs';
// @ts-expect-error Tool-only particle / image inventory.
import {precipitationSource,materialTextures,encodeTexture} from './precipitation-source.mjs';
import {captureSourceAnimals,completeAnimalSource} from './animal-source';
import {parseJava16xResourcePack,type ResourcePackManifest} from '../../../packages/resource-pack/src/index';
// @ts-expect-error Shared frozen scope, with node:test coverage.
import {fixtureForStyle} from './fixture-scope.mjs';
// @ts-expect-error Tool-only normalized asset transport.
import {encodeResourceWire,decodeResourceWire} from './resource-wire.mjs';
// @ts-expect-error Tool-only atlas identities.
import {atlasRuntimeInput} from './atlas-runtime-input.mjs';

const canvas=document.querySelector('canvas')!,status=document.querySelector('output')!;
let world:ReturnType<typeof createVoxelRenderer>|undefined;
let snapshots:WorldSnapshot[]=[];
let fixtureName='ocean',environmentProfile='day';
let resourcePack:{id:string;manifest:ResourcePackManifest}|null=null;
let resourcePackIdentity:{kind:string;sha256:string;bytes:number;wireSha256?:string}|null=null;
let encodedTextures=new WeakMap<THREE.Texture,{version:number;value:any}>();
const hook=()=> (canvas as any).closeup;
async function sha(bytes:Uint8Array) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function loadResourcePack(url:string,expectedSha256:string){
  if(url!=='/p1-controlled-client.jar'||!/^[a-f0-9]{64}$/.test(expectedSha256))throw Error('Invalid controlled pack input');
  if(world)throw Error('Load the controlled resource pack before preparing a world');
  const response=await fetch(url);if(!response.ok)throw Error('Controlled resource pack unavailable');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>64*1024*1024||await sha(bytes)!==expectedSha256)throw Error('Controlled resource pack identity differs');
  const started=performance.now(),manifest=parseJava16xResourcePack(bytes);
  resourcePackIdentity={kind:'mc263',sha256:expectedSha256,bytes:bytes.length};
  resourcePack={id:'p1-mc263-'+expectedSha256,manifest};
  return {identity:resourcePackIdentity,parseMs:performance.now()-started,summary:manifest.summary,
    modelCount:manifest.models.length,blockStateCount:manifest.blockStates.length};
}
async function packWire(){
  if(!resourcePack||!resourcePackIdentity)throw Error('No controlled pack');
  const {wireSha256:ignored,...identity}=resourcePackIdentity;
  const text=encodeResourceWire(resourcePack.manifest,identity);
  resourcePackIdentity.wireSha256=await sha(new TextEncoder().encode(text));return text;
}
async function loadResourcePackWire(identity:any){
  if(world||identity?.kind!=='mc263'||!/^[a-f0-9]{64}$/.test(identity.wireSha256))throw Error('Invalid frozen pack wire');
  const response=await fetch('/web/controlled-resource-pack.json');if(!response.ok)throw Error('Normalized source pack unavailable');
  const text=await response.text();if(await sha(new TextEncoder().encode(text))!==identity.wireSha256)throw Error('Normalized source pack identity differs');
  const parsed=decodeResourceWire(text);if(parsed.identity.sha256!==identity.sha256)throw Error('Wrong source resource pack');
  resourcePackIdentity=identity;resourcePack={id:'p1-mc263-'+identity.sha256,manifest:parsed.manifest};
}
function sourceCensus(){
  const h=hook(),policy=completeAnimalSource(precipitationSource(completeSceneSource(h)),h.animals());
  const layers:Record<string,{meshes:number;instances:number}>={},batches:{name:string;layer:string;count:number}[]=[];
  try{h.scene.traverse((original:any)=>{
    if(!policy.selectObject(original))return;const mesh=policy.resolveMesh(original);if(!mesh.isMesh)return;
    for(let branch=mesh;branch;branch=branch.parent)if(/outline|planned|debug/i.test(branch.name))return;
    const layer=sourceLayer(mesh),count=mesh.isInstancedMesh?mesh.count:1;
    const row=layers[layer]??(layers[layer]={meshes:0,instances:0});row.meshes++;row.instances+=count;
    batches.push({name:mesh.name||mesh.geometry.name||'unnamed',layer,count});
  });}finally{policy.dispose();}
  return {layers,totalInstances:Object.values(layers).reduce((sum,row)=>sum+row.instances,0),
    largestBatches:batches.sort((a,b)=>b.count-a.count).slice(0,12),
    scope:'Full source selection before encoding or budget admission; includes both static scenery LODs and full animal capacity'};
}
async function build(style:string,count=25,profile='day',firstProgress=10000) {
  const selected=fixtureForStyle(style,count);
  if(!['day','night','rain','snow'].includes(profile))throw Error('Unknown P1 environment profile');
  world?.dispose();
  encodedTextures=new WeakMap();
  fixtureName=selected.name;environmentProfile=profile;
  const supplements=BUILTIN_BLUEPRINT_CATALOG.filter(e=>e.blueprint.voxels.length>=1500&&e.blueprint.voxels.length<=12000).sort((a,b)=>b.blueprint.voxels.length-a.blueprint.voxels.length).slice(0,6);
  const catalog=[...BUILTIN_BLUEPRINT_CATALOG.slice(0,3),...supplements];
  if(!Number.isInteger(firstProgress)||firstProgress<0||firstProgress>10000)throw Error('Invalid first building progress');
  const worlds:WorldSnapshot[]=Array.from({length:count},(_,i)=>({projectId:'complex-'+i,settlementIndex:i,blueprintId:catalog[i%catalog.length]!.id,buildingCompletionBasisPoints:i===0?firstProgress:10000,buildingConditionBasisPoints:10000,isMonument:i!==0||firstProgress===10000}));
  snapshots=worlds;
  world=createVoxelRenderer(canvas,{environmentStyle:style as 'mosaic-coast',worldSeed:'world-default',lightingQuality:'cinematic',animals:true,scenery:true,
    initialEnvironment:{weather:null,astronomy:null,debug:{date:new Date(2026,9,19,profile==='night'?23:15).getTime(),
      weather:profile==='night'?{kind:'clear',cloudIntensity:0,precipitationIntensity:0}
        :profile==='rain'||profile==='snow'?{kind:profile,cloudIntensity:.8,precipitationIntensity:.65}
        :{kind:'cloudy',cloudIntensity:.65,precipitationIntensity:0}}}});
  world.setReducedMotion(true);await world.initializeWorlds(worlds,resourcePack);world.resize();hook().range(.1,.9);hook().zoom(.55);
  if(!await world.prepareInitialPresentation())throw Error('Production initial presentation did not complete');
  const deadline=performance.now()+30000;
  for(;;) {
    hook().prepareTick();const animals=(world.getDiagnostics() as any).animals;
    if(animals?.ready&&animals.count>0)break;
    if(performance.now()>deadline)throw Error('Production animals were not ready: '+JSON.stringify({animals,hidden:document.hidden}));
    await new Promise(resolve=>setTimeout(resolve,16));
  }
  status.textContent=style+' · production and animals ready';
  return {style,count,profile,resourcePack:resourcePackIdentity,blueprints:catalog.map(e=>({id:e.id,voxels:e.blueprint.voxels.length})),diagnostics:world.getDiagnostics(),sourceCensus:sourceCensus()};
}
async function bundle(ownerFilter:string|null=null,draw=true) {
  const h=hook();if(draw)h.draw();h.scene.updateMatrixWorld(true);
  const animal=captureSourceAnimals(h.animals(),ownerFilter);
  const sourcePolicy=ownerFilter===null?completeAnimalSource(precipitationSource(completeSceneSource(h)),h.animals()):precipitationSource(completeSceneSource(h));
  const textureSet=new Set<THREE.Texture>();
  h.scene.traverse((original:any)=>{if(!sourcePolicy.selectObject(original))return;const o=sourcePolicy.resolveMesh(original);
    if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])for(const texture of materialTextures(m,h.renderer))textureSet.add(texture);});
  const runtimeAtlas=await atlasRuntimeInput(h.atlas(),sha);
  const textureIds=new Map(),images=new Map<string,Uint8Array>(),textures:any[]=[];
  for(const texture of textureSet) {
    if(texture.matrixAutoUpdate)texture.updateMatrix();
    let encoded=encodedTextures.get(texture);
    if(!encoded||encoded.version!==texture.version){encoded={version:texture.version,value:await encodeTexture(texture,sha)};encodedTextures.set(texture,encoded);}
    const {filename,bytes,descriptor:rawDescriptor}=encoded.value;
    const descriptor={...rawDescriptor,...runtimeAtlas.tags.get(texture)};
    images.set(filename,bytes);
    const key=JSON.stringify(descriptor);let id=textures.findIndex(t=>t.key===key);
    if(id<0){id=textures.length;textures.push({id,key,...descriptor});}
    textureIds.set(texture,id);
  }
  const worldPackets=collectWorldPackets(h.scene,{textureIds,chunkSize:64,maxInstances:1024,renderer:h.renderer,ownerFilter,...sourcePolicy});
  sourcePolicy.dispose();
  const encoded=encodeWorldPackets(worldPackets);
  const animalFile=fixtureName+(ownerFilter===null?'':'-update')+'.animals.bin';
  images.set(animalFile,animal.bytes);
  const bounds=new THREE.Box3().setFromObject(h.root);
  let main:THREE.DirectionalLight|undefined;
  h.scene.traverse((o:any)=>{if(o.isDirectionalLight&&(!main||o.intensity>main.intensity))main=o;});
  const direction=main?main.getWorldPosition(new THREE.Vector3()).sub(main.target.getWorldPosition(new THREE.Vector3())).normalize().toArray():[.5,.8,.3];
  const atlasAnimations=await Promise.all(runtimeAtlas.pages.map(async({input:a,identity,page,activeTextureIndices}:any)=>{
    const texture=textureIds.get(a.texture),blendTexture=textureIds.get(a.blendTexture);
    if(texture===undefined||blendTexture===undefined)throw Error('Atlas runtime texture was not encoded');
    return {schema:1,identity,page,texture,blendTexture,width:a.width,height:a.height,tileCount:a.tileCount,
      sequences:a.sequences,activeTextureIndices,lookupPixelsSha256:await sha(a.pixels),blendPixelsSha256:await sha(a.blendPixels)};
  }));
  const metadata={...encoded.manifest,exportSchema:10,environmentProfile,resourcePack:resourcePackIdentity,atlasAnimations,sourcePolicy:'complete-world-sky-weather-and-animal-runtime-with-both-scenery-lods',textures:textures.map(({key,...t})=>t),camera:h.state(),cameraVolume:h.cameraVolume(),precipitation:h.precipitation(),
    animalRuntime:{...animal.descriptor,file:animalFile,sha256:await sha(animal.bytes),activityScale:h.animalActivityScale()},
    bounds:[bounds.min.toArray(),bounds.max.toArray()],lightDirection:direction,lightColor:main?.color.toArray()??[1,1,1],
    environment:captureEnvironment(h.scene,h.renderer,h.pipeline()),
    binarySha256:await sha(encoded.bytes),sourceDiagnostics:world!.getDiagnostics(),
    scope:'Production geometry, instance transforms and PBR parameters; custom programs and dynamic behavior remain explicit P1 gaps, not visual parity or cold-start evidence'};
  return {metadata,bytes:encoded.bytes,images};
}
async function replaceBuilding(exported=true) {
  snapshots=snapshots.map((value,index)=>index===0?{...value,buildingCompletionBasisPoints:6000,isMonument:false}:value);
  world!.setWorlds(snapshots);
  if(!await world!.preparePresentationFrame())throw Error('Replacement production frame not prepared');
  return exported?bundle('building:complex-0'):null;
}
function constructionOrders() {
  const blueprint=BUILTIN_BLUEPRINT_CATALOG.find(entry=>entry.id===snapshots[0]?.blueprintId)?.blueprint;
  if(!blueprint)throw Error('Unknown first blueprint');
  return {blueprintId:blueprint.id,orders:[...new Set([0,...blueprint.voxels.map(v=>v.buildOrder),10000])].sort((a,b)=>a-b)};
}
async function construction(progress:number,exported=true,cpuOnly=false) {
  if(!Number.isInteger(progress)||progress<0||progress>10000)throw Error('Invalid construction progress');
  if(cpuOnly)world!.setVisible(false);
  snapshots=snapshots.map((value,index)=>index===0?{...value,buildingCompletionBasisPoints:progress,isMonument:progress===10000}:value);
  world!.setWorlds(snapshots);
  if(!cpuOnly&&!await world!.preparePresentationFrame())throw Error('Production construction preparation failed');
  return exported?bundle('building:complex-0',!cpuOnly):null;
}
async function constructionOwner(progress:number){
  if(!Number.isInteger(progress)||progress<0||progress>10000)throw Error('Invalid owner construction progress');
  world!.setVisible(false);
  snapshots=snapshots.map((value,index)=>index===0?{...value,buildingCompletionBasisPoints:progress,isMonument:progress===10000}:value);
  return hook().ownerConstruction('complex-0',progress);
}
async function staticSignature() {
  const h=hook();h.draw();h.root.updateMatrixWorld(true);
  const policy=fullMapSource(h.fullBatch),rows:any[]=[];
  let instances=0;
  const jobs:Promise<void>[]=[];
  h.root.traverse((original:any)=>{
    if(!original.isMesh||!policy.selectObject(original))return;
    if(sourceLayer(original)!=='static')return;
    for(let p=original;p;p=p.parent)if(/outline|planned|debug/i.test(p.name))return;
    const mesh=policy.resolveMesh(original),count=mesh.isInstancedMesh?mesh.count:1;
    instances+=count;
    const buffers=[...(mesh.isInstancedMesh?[mesh.instanceMatrix]:[]),...(mesh.instanceColor?[mesh.instanceColor]:[]),...Object.values(mesh.geometry.attributes)] as THREE.BufferAttribute[];
    const row={id:mesh.uuid,count,matrix:mesh.matrixWorld.toArray(),geometry:mesh.geometry.uuid,channels:[] as string[]};rows.push(row);
    jobs.push(Promise.all(buffers.map(attribute=>sha(new Uint8Array(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength)))).then(hashes=>{row.channels=hashes;}));
  });
  await Promise.all(jobs);
  return {meshes:rows.length,instances,sha256:await sha(new TextEncoder().encode(JSON.stringify(rows)))};
}
async function auditAngles() {
  const h=hook(),before=h.state(),results:any[]=[];
  try {
    for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
      h.lookAt(...before.target,angle);results.push({angle,...await staticSignature()});
    }
  } finally {
    const [x,,z]=before.position;h.lookAt(...before.target,Math.atan2(z-before.target[2],x-before.target[0]));
    h.draw();
  }
  if(new Set(results.map(row=>row.sha256)).size!==1)throw Error('Static full-map source changed with camera: '+JSON.stringify(results));
  return results;
}
Object.assign(window,{nativeP1:{build,bundle,replaceBuilding,constructionOrders,construction,constructionOwner,auditAngles,loadResourcePack,packWire,loadResourcePackWire,hook,
  assetState:()=>({resourcePack:resourcePackIdentity,diagnostics:world!.getDiagnostics()}),runtime:(enabled:boolean)=>world!.setReducedMotion(!enabled)}});
status.textContent='P1 exporter ready';
