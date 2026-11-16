import * as THREE from 'three';
import {AnimalModels} from '../../../packages/voxel/src/animal-models';
import {obstacleSolids} from '../../../packages/voxel/src/animal-habitat';
// @ts-expect-error Shared bounded binary encoder.
import {encodeAnimalHabitat} from './animal-runtime-input.mjs';

/** The reference executes production behavior, but starts from the exact same
 * captured population as native. Cooperative population preparation can pick
 * a different valid water-seed order in another rendering context. */
export function restoreSourceAnimalInput(animals:any,input:any){
  const community=animals?.community,rows=input?.community?.agents;
  if(!community||input.schema!==1||input.scope!=='full'||!Array.isArray(rows)||rows.length!==community.agents.length)throw Error('Frozen source animal population differs');
  for(const raw of rows){
    const a=community.agents.find((a:any)=>a.id===raw.id);
    if(!a||a.kind!==raw.kind||a.species!==raw.species||raw.route||!Object.values(raw.position).every(Number.isFinite))throw Error('Invalid frozen source animal');
    if(a.walker&&(!animals.habitat.world.clear(raw.position,a.walker.navigator.body)||!animals.habitat.world.supported(raw.position,a.walker.navigator.body)))throw Error('Frozen land pose is unsafe in source habitat');
    if(a.kind==='fish'&&!animals.habitat.swimClear(raw.position))throw Error('Frozen fish pose is unsafe in source habitat');
    if(a.kind==='bird'&&raw.position.y<animals.habitat.flightFloor(raw.position.x,raw.position.z))throw Error('Frozen bird pose is unsafe in source habitat');
    const {walker,...state}=structuredClone(raw);Object.assign(a,state);delete a.route;
    if(a.walker){Object.assign(a.walker,walker);a.walker.position={...raw.position};a.walker.route=null;a.walker.goal=null;}
  }
  community.time=input.community.time;community.sequence=input.community.sequence;community.seed=input.community.seed;
  animals.lastAt=animals.lastFrameAt=animals.lastPoseAt=0;animals.updates=0;animals.visible=new Set();
}

/** Tool-only access to this fixture's private runtime, never the formal app.
 * Capture source collision semantics before choosing a native representation. */
export function captureSourceAnimals(animals:any,owner:string|null=null,sourceOverride?:any[]){
  const habitat=animals?.habitat;
  if(!habitat||!owner&&(!habitat.ready||!animals.community))throw Error('Animal habitat not ready for capture');
  if(animals.parent.rotation.x!==0||animals.parent.rotation.y!==0||animals.parent.rotation.z!==0||animals.parent.position.lengthSq()!==0
    ||!animals.parent.scale.equals(new THREE.Vector3(1,1,1)))throw Error('Animal source root transform is outside the frozen P1 scope');
  let ignoredNonAreaSurfaces=0;
  const surfaces:any[]=[];
  if(owner===null)for(const s of habitat.surfaces){
    if(s.minX>=s.maxX||s.minZ>=s.maxZ){ignoredNonAreaSurfaces++;continue;}
    surfaces.push({minX:s.minX,maxX:s.maxX,minZ:s.minZ,maxZ:s.maxZ,top:s.supportY-.5,water:s.water,grass:s.material==='grass'});
    if(surfaces.length>500000)throw Error('Animal terrain input budget');
  }
  if(sourceOverride&&(owner===null||sourceOverride.some(source=>source.id!==owner)))throw Error('Owner collision override is outside the admitted scope');
  const sources=sourceOverride??habitat.sources.filter((s:any)=>owner===null||s.id===owner),solids:any[]=[];
  for(const source of sources)for(let index=0;index<source.voxels.length;index++){
    for(const solid of obstacleSolids(source,source.voxels[index],index)){
      solids.push(solid);if(solids.length>500000)throw Error('Animal collider input budget');
    }
  }
  const encoded=encodeAnimalHabitat(surfaces,solids);
  const common={schema:1,scope:owner===null?'full':'owner-update',owner,rootRotationY:0,owners:encoded.owners,
    surfaceCount:encoded.surfaceCount,solidCount:encoded.solidCount,ignoredNonAreaSurfaces,
    sourceObstacleCount:sources.length,indexedSourceVoxels:sources.reduce((n:number,s:any)=>n+s.voxels.length,0)};
  if(owner!==null)return {bytes:encoded.bytes,descriptor:common};
  const community=animals.community;
  const agents=community.agents.map((a:any)=>{
    if(a.route||a.walker?.moving)throw Error('Initial animal snapshot must be frozen before it starts a trajectory');
    const {walker,...pose}=a;
    return {...structuredClone(pose),walker:walker?{position:{...walker.position},heading:walker.heading,traveled:walker.traveled,
      reactionRemaining:walker.reactionRemaining,speedScale:walker.speedScale,curve:walker.curve}:null};
  });
  if(agents.length>64)throw Error('Animal population budget');
  return {bytes:encoded.bytes,descriptor:{...common,bounds:{...habitat.bounds},center:{...habitat.center},
    landSeeds:habitat.landSeeds.map((p:any)=>({...p})),waterSeeds:habitat.waterSeeds.map((p:any)=>({...p})),
    community:{seed:community.seed,sequence:community.sequence,time:community.time,agents}}};
}

/** Original model code emits complete initial poses into temporary arrays.
 * It never expands / reparents the live fixture or changes its visible prefix. */
export function completeAnimalSource(policy:any,animals:any){
  if(!animals?.community)throw Error('Source animal population missing');
  const model=new AnimalModels();model.update(animals.community.agents,animals.community.time);
  const keys=['parts','faces','contacts','ripples'] as const,virtual=new Map(),owned:any[]=[];
  const identity=new THREE.Matrix4(),white=new THREE.Color(1,1,1);
  for(const [kind,key]of keys.entries()){
    const mesh=model[key],original=animals.models[key],count=mesh.count,capacity=mesh.instanceMatrix.count;
    const slots=new Float32Array(capacity*3);
    for(let i=0;i<capacity;i++){
      slots.set([i,kind,i<count?1:0],i*3);
      if(i>=count){mesh.setMatrixAt(i,identity);mesh.setColorAt(i,white);}
    }
    mesh.geometry.setAttribute('animalSlot',new THREE.InstancedBufferAttribute(slots,3));mesh.count=capacity;
    owned.push(mesh.material);mesh.material=original.material;
    mesh.matrixWorld.copy(original.matrixWorld);mesh.parent=original.parent;mesh.visible=original.visible;
    mesh.castShadow=original.castShadow;mesh.receiveShadow=original.receiveShadow;
    virtual.set(original,mesh);
  }
  return {...policy,resolveMesh(object:any){return virtual.get(object)??policy.resolveMesh(object);},dispose(){
    for(const [i,key]of keys.entries())model[key].material=owned[i];model.dispose();policy.dispose();
  }};
}
