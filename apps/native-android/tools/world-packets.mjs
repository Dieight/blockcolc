import * as THREE from 'three';
import {captureMaterialProgram,describeProgram} from './material-program.mjs';
import {atlasDefinition,atlasAppearance,bakeAtlasVertex,ATLAS_INSTANCE_NAMES,ATLAS_VERTEX_NAMES} from './atlas-source.mjs';

export const WORLD_PACKET_VERSION = 5;
export const PACKET_MAGIC = 0x31504342; // BCP1, little endian.
const MAX_GEOMETRY_BYTES = 192 * 1024 * 1024;
const finite = values => values.every(Number.isFinite);
// Original-material geometry also carries dormant external-atlas channels.
// Drop only these known channels when no selected vertex program reads them.
const atlasChannels=new Set(['instanceFaceTilesA','instanceFaceTilesB','instanceFaceUvWordA0','instanceFaceUvWordA1',
  'instanceFaceUvWordB0','instanceFaceUvWordB1','instanceFaceTintKinds']);
function expandedVertex(material,program) {
  let source=program?.vertex??(material.isMeshStandardMaterial?THREE.ShaderLib.standard.vertexShader
    :material.isMeshBasicMaterial?THREE.ShaderLib.basic.vertexShader:material.isMeshLambertMaterial?THREE.ShaderLib.lambert.vertexShader:null);
  if(source===null)return null;
  for(let i=0;i<20&&/#include </.test(source);i++)source=source.replace(/#include <([\w]+)>/g,(_,name)=>{
    if(typeof THREE.ShaderChunk[name]!=='string')throw Error('Unknown source shader chunk: '+name);
    return THREE.ShaderChunk[name];
  });
  if(/#include </.test(source))throw Error('Vertex shader include budget');
  return source;
}
function bytesOf(array) { return new Uint8Array(array.buffer, array.byteOffset, array.byteLength); }
function same(a,b) { return a.length===b.length && a.every((value,i)=>value===b[i]); }
function hashArrays(arrays) {
  let hash=2166136261;
  for (const array of arrays) for (const byte of bytesOf(array)) hash=Math.imul(hash^byte,16777619);
  return hash>>>0;
}
function sourceOwner(object) {
  for(let current=object;current;current=current.parent) {
    const id=current.userData.animalObstacle?.id;
    if(typeof id==='string' && /^(building|reward):/.test(id)) return id;
  }
  return 'world';
}
function sourceLod(object) {
  for(let branch=object;branch;branch=branch.parent)if(['full','distant'].includes(branch.name)&&branch.parent?.userData.sceneryObject){
    const group=branch.parent,info=group.userData.sceneryObject;
    const center=new THREE.Vector3(0,3,0).applyMatrix4(group.matrixWorld).toArray(),width=Math.max(info.width,info.depth);
    if(!finite(center)||!Number.isFinite(width)||width<=0)throw Error('Invalid source LOD');
    return {id:group.name,detail:branch.name,center,width};
  }
  return null;
}
export function sourceLayer(object) {
  for(let current=object;current;current=current.parent) {
    if (current.name==='world-animals') return 'animals';
    if (current.name==='world-clouds') return 'clouds';
    if (current.name==='layeredSky') return 'sky';
    if (['world-rain','world-snow'].includes(current.name)) return 'precipitation';
  }
  return 'static';
}
function sourceVisible(object) {
  for(let parent=object;parent;parent=parent.parent)if(!parent.visible)return false;
  return true;
}

/** Preserve real GPU instances; no expanded vertex copy and no ordinary node per voxel.
 * textureIds must identify encoded content AND its sampler state, not just a display name.
 * Unsupported custom programs remain explicit gaps for the P1 gate. */
export function collectWorldPackets(source, {textureIds=new Map(),chunkSize=32,maxInstances=256,
  resolveMesh=object=>object,selectObject=sourceVisible,renderer,ownerFilter=null}={}) {
  if(!Number.isFinite(chunkSize)||chunkSize<8||chunkSize>128||!Number.isInteger(maxInstances)||maxInstances<1||maxInstances>1024) throw Error('Invalid packet partition');
  const geometries=[],materials=[],programs=[],packets=[],unsupported=[];
  const programKeys=new Map(),materialCache=new WeakMap(),programCache=new WeakMap(),inactiveAttributes={},evaluatedAttributes={};
  function programFor(input){if(!programCache.has(input))programCache.set(input,input.userData.nativeProgram??captureMaterialProgram(input,renderer));return programCache.get(input);}
  const geometryBuckets=new Map(),sourceGeometryCache=new WeakMap(),materialKeys=new Map(),batches=new Map();
  let skippedSingular=0,sourceMeshes=0,sourceInstances=0,totalBytes=0;
  source.updateMatrixWorld(true);
  function geometryFor(input,begin,end,atlas=null,appearance=null) {
    let cached=sourceGeometryCache.get(input);
    if(!cached){cached=new Map();sourceGeometryCache.set(input,cached);}
    const range=begin+':'+end+(appearance?':'+appearance.key:'');
    if(cached.has(range))return cached.get(range);
    const p=input.getAttribute('position'),n=input.getAttribute('normal'),uv=input.getAttribute('uv'),c=input.getAttribute('color');
    if(!p||p.count>4_000_000||end-begin>12_000_000||(end-begin)%3)throw Error('Invalid triangle geometry');
    const remap=new Map(),index=new Uint32Array(end-begin);
    for(let j=begin;j<end;j++) {
      const selected=input.index?.getX(j)??j;
      if(!Number.isInteger(selected)||selected<0||selected>=p.count)throw Error('Vertex index outside buffer');
      let mapped=remap.get(selected);if(mapped===undefined){mapped=remap.size;remap.set(selected,mapped);}
      index[j-begin]=mapped;
    }
    // Material groups often reference a small part of one large terrain VBO.
    // Copy only referenced vertices, not the entire terrain once per material.
    const vertex=new Float32Array(remap.size*12),bounds=new THREE.Box3(),point=new THREE.Vector3();
    for(const [j,mapped] of remap) {
      const position=[p.getX(j),p.getY(j),p.getZ(j)],normal=[n?.getX(j)??0,n?.getY(j)??1,n?.getZ(j)??0];
      let textureUv=[uv?.getX(j)??0,uv?.getY(j)??0],color=[c?.getX(j)??1,c?.getY(j)??1,c?.getZ(j)??1,c?.itemSize===4?c.getW(j):1];
      if(atlas){const baked=bakeAtlasVertex({uv:textureUv,position,normal,color,
        slot:input.getAttribute('faceSlot')?.getX(j),occlusionSlot:input.getAttribute('faceOcclusionSlot')?.getX(j),shade:input.getAttribute('faceShadeFactor')?.getX(j)},appearance,atlas);
        textureUv=baked.uv;color=baked.color;}
      vertex.set([...position,...normal,...textureUv,...color],mapped*12);
      bounds.expandByPoint(point.fromBufferAttribute(p,j));
    }
    if(!finite(vertex))throw Error('Non-finite vertex');
    const key=hashArrays([vertex,index])+':'+vertex.length+':'+index.length+':'+(atlas?'atlas-static-v1':'raw');
    const bucket=geometryBuckets.get(key)??[];
    let geometry=bucket.find(previous=>same(previous.vertex,vertex)&&same(previous.index,index));
    if(!geometry) {
      geometry={id:geometries.length,vertex,index,bounds:[bounds.min.toArray(),bounds.max.toArray()],vertexPreparation:atlas?'atlas-static-v1':null};
      totalBytes+=vertex.byteLength+index.byteLength;
      if(totalBytes>MAX_GEOMETRY_BYTES)throw Error('Unique geometry exceeds 192 MiB');
      geometries.push(geometry);bucket.push(geometry);geometryBuckets.set(key,bucket);
    }
    cached.set(range,geometry);return geometry;
  }
  function materialFor(input) {
    if(materialCache.has(input))return materialCache.get(input);
    const texture=input.map?textureIds.get(input.map):null;
    if(input.map && texture===undefined)throw Error('Texture content was not prepared');
    const recipe=describeProgram(programFor(input),textureIds);
    let recipeId=null;
    if(recipe) {
      const key=JSON.stringify(recipe.definition);
      recipeId=programKeys.get(key);
      if(recipeId===undefined){recipeId=programs.length;programKeys.set(key,recipeId);programs.push({id:recipeId,...recipe.definition});}
      unsupported.push({kind:'custom-program',name:input.name||'unnamed',program:recipeId},...recipe.gaps);
    }
    const description={color:input.color?.toArray()??[1,1,1],opacity:input.opacity??1,
      roughness:input.roughness??.95,metalness:input.metalness??0,
      emissive:input.emissive?.toArray()??[0,0,0],emissiveIntensity:input.emissiveIntensity??1,
      transparent:!!input.transparent,alphaTest:input.alphaTest??0,side:input.side??0,fog:input.fog!==false,
      vertexColors:!!input.vertexColors,unlit:!!input.isMeshBasicMaterial,depthWrite:input.depthWrite!==false,colorWrite:input.colorWrite!==false,
      texture,uvTransform:input.map?.matrix.toArray()??[1,0,0,0,1,0,0,0,1],flipY:input.map?.flipY??false,
      // Non-custom material models must not silently become standard PBR either.
      sourceType:input.type,depthTest:input.depthTest,depthFunc:input.depthFunc,blending:input.blending,
      billboard:input.userData.nativeBillboard??0,pointSize:input.userData.nativePointSize??0,
      billboardCenter:input.userData.nativeBillboardCenter??[.5,.5],
      primitiveSourceType:input.userData.nativeSourceType??input.type,
      recipe:recipe?{program:recipeId,uniforms:recipe.uniforms}:null,
      program:recipe?'custom':'standard'};
    if(!input.isMeshStandardMaterial&&!input.isMeshBasicMaterial)unsupported.push({kind:'unported-material-model',name:input.type});
    if(!finite([...description.color,...description.emissive,description.opacity,description.roughness,description.metalness,description.alphaTest,...description.uvTransform]))throw Error('Non-finite material');
    const key=JSON.stringify(description);
    let id=materialKeys.get(key);
    if(id===undefined){id=materials.length;materials.push({id,...description});materialKeys.set(key,id);}
    materialCache.set(input,id);
    return id;
  }
  // Visit invisible near-detail branches too; the selection policy, rather
  // than the current camera's visible flags, chooses one canonical LOD.
  source.traverse(original=>{
    if(!selectObject(original))return;
    const object=resolveMesh(original);
    if(!object.isMesh) {
      if(object.isPoints||object.isLine||object.isSprite)unsupported.push({kind:object.type,name:object.name||'unnamed'});
      return;
    }
    if(ownerFilter!==null&&sourceOwner(object)!==ownerFilter)return;
    for(let parent=object;parent;parent=parent.parent)if(/outline|planned|debug/i.test(parent.name))return;
    const input=object.geometry,p=input.getAttribute('position');if(!p)return;
    if(object.isSkinnedMesh||Object.values(input.morphAttributes).some(values=>values.length))
      unsupported.push({kind:'unported-deformation',name:object.name||'unnamed'});
    const fluidNames=['instanceFaceOcclusion','instanceMaterialResponse'].filter(name=>input.getAttribute(name)?.isInstancedBufferAttribute);
    const cloudNames=['cloudCenter','cloudVelocity'].filter(name=>input.getAttribute(name)?.isInstancedBufferAttribute);
    const weatherNames=['weatherPhase','weatherOffset'].filter(name=>input.getAttribute(name)?.isInstancedBufferAttribute);
    const animalNames=['animalSlot'].filter(name=>input.getAttribute(name)?.isInstancedBufferAttribute);
    if(cloudNames.length!==0&&cloudNames.length!==2||weatherNames.length!==0&&weatherNames.length!==2
      ||[fluidNames,cloudNames,weatherNames,animalNames].filter(names=>names.length).length>1)throw Error('Mixed or incomplete auxiliary instance channels');
    const auxNames=animalNames.length?animalNames:weatherNames.length?weatherNames:cloudNames.length?cloudNames:fluidNames;
    const sourceMaterials=Array.isArray(object.material)?object.material:[object.material];
    const atlas=sourceMaterials.map(m=>atlasDefinition(m,programFor(m)));
    const hasAtlas=atlas.some(Boolean);if(hasAtlas&&atlas.some(a=>!a))throw Error('Mixed prepared and unprepared atlas material groups');
    for(const [name,attribute] of Object.entries(input.attributes))if(!['position','normal','uv','color'].includes(name))
      if(!auxNames.includes(name)){
        if(hasAtlas&&(ATLAS_INSTANCE_NAMES.includes(name)||ATLAS_VERTEX_NAMES.includes(name))){evaluatedAttributes[name]=(evaluatedAttributes[name]??0)+1;continue;}
        const unused=atlasChannels.has(name)&&sourceMaterials.every(m=>{const vertex=expandedVertex(m,programFor(m));return vertex!==null&&!new RegExp('\\b'+name+'\\b').test(vertex);});
        if(unused)inactiveAttributes[name]=(inactiveAttributes[name]??0)+1;
        else unsupported.push({kind:'unported-attribute',name,size:attribute.itemSize,rate:attribute.isInstancedBufferAttribute?'instance':'vertex'});
      }
    const start=input.drawRange.start,end=Math.min(input.index?.count??p.count,start+input.drawRange.count);
    if(start<0||start>end||!Number.isInteger(start)||!Number.isInteger(end))throw Error('Invalid drawRange');
    const spans=(Array.isArray(object.material)?input.groups:[{start:0,count:end,materialIndex:0}])
      .map(span=>({begin:Math.max(start,span.start),end:Math.min(end,span.start+span.count),material:span.materialIndex??0}))
      .filter(span=>span.end>span.begin);
    if(!spans.length)return;
    const owner=sourceOwner(object),layer=sourceLayer(object),lod=sourceLod(object),count=object.isInstancedMesh?object.count:1;
    // Per-source batch admission stays bounded. Aggregate capacity is charged
    // against the existing 64 MiB native row budget (96 bytes per instance),
    // instead of a second arbitrary 300k total that rejected a 29 MiB world.
    if(!Number.isInteger(count)||count<0||count>300_000||(sourceInstances+count)*96>64*1024*1024)throw Error('Source instance budget exceeded');
    for(const name of auxNames){const attribute=input.getAttribute(name);
      if(attribute.itemSize!==(animalNames.length?3:cloudNames.length||name==='weatherOffset'?2:1)||attribute.meshPerAttribute!==1||attribute.count<count||attribute.normalized)throw Error('Unsupported auxiliary instance layout');}
    const valid=[];
    for(let i=0;i<count;i++) {
      const matrix=object.matrixWorld.clone();
      if(object.isInstancedMesh){const local=new THREE.Matrix4();object.getMatrixAt(i,local);matrix.multiply(local);}
      if(!finite(matrix.elements))throw Error('Non-finite transform');
      if(Math.abs(matrix.determinant())<1e-10){skippedSingular++;continue;}
      const color=new THREE.Color(1,1,1);if(object.instanceColor)object.getColorAt(i,color);
      if(!finite(color.toArray()))throw Error('Non-finite tint');
      let aux;
      if(animalNames.length){
        const a=input.getAttribute('animalSlot');aux=[a.getX(i),a.getY(i),a.getZ(i),0];
        if(!finite(aux)||!Number.isInteger(aux[0])||aux[0]<0||aux[0]>1535||!Number.isInteger(aux[1])||aux[1]<0||aux[1]>3||![0,1].includes(aux[2]))throw Error('Invalid animal rig slot');
      }else if(weatherNames.length){
        const phase=input.getAttribute('weatherPhase'),offset=input.getAttribute('weatherOffset');
        aux=[phase.getX(i),offset.getX(i),offset.getY(i),i];
        if(!finite(aux)||aux[0]<0||aux[0]>1||Math.abs(aux[1])>.5||Math.abs(aux[2])>.5)throw Error('Invalid weather instance channel');
      }else if(cloudNames.length){
        aux=cloudNames.flatMap(name=>[input.getAttribute(name).getX(i),input.getAttribute(name).getY(i)]);
        if(!finite(aux)||aux.some((v,k)=>Math.abs(v)>(k<2?1e6:100)))throw Error('Invalid cloud instance channel');
      }else{
        aux=['instanceFaceOcclusion','instanceMaterialResponse'].map(name=>auxNames.includes(name)?input.getAttribute(name).getX(i):0);
        if(!finite(aux)||aux.some(n=>n<0||n>16777215||!Number.isInteger(n)))throw Error('Invalid packed instance channel');
        aux.push(0,0);
      }
      valid.push({matrix,color,aux,index:i});
    }
    sourceMeshes++;sourceInstances+=valid.length;
    for(const span of spans) {
      const material=sourceMaterials[span.material];if(!material)throw Error('Material group outside list');
      if(material.visible===false)continue;
      const prepared=atlas[span.material],materialId=materialFor(material);
      for(const {matrix,color,aux,index} of valid) {
        const appearance=prepared?atlasAppearance(input,index,prepared):null;
        const geometry=geometryFor(input,span.begin,span.end,prepared,appearance);
        const bounds=new THREE.Box3(new THREE.Vector3(...geometry.bounds[0]),new THREE.Vector3(...geometry.bounds[1])).applyMatrix4(matrix);
        const center=bounds.getCenter(new THREE.Vector3()),chunk=layer==='animals'?[0,0]:[Math.floor(center.x/chunkSize),Math.floor(center.z/chunkSize)];
        const priority=layer==='sky'?(object.name==='threeLayerSkyDome'?0:object.name==='deterministicStars'?1:2):4;
        const key=JSON.stringify([owner,layer,geometry.id,materialId,object.castShadow,object.receiveShadow,chunk,auxNames,priority,lod]);
        let packet=batches.get(key);
        if(!packet||packet.transforms.length>=maxInstances) {
          packet={id:packets.length,owner,layer,geometry:geometry.id,material:materialId,chunk,priority,lod,
            castShadow:!!object.castShadow,receiveShadow:!!object.receiveShadow,transforms:[],auxTransforms:[],auxChannels:auxNames,bounds:new THREE.Box3()};
          packets.push(packet);batches.set(key,packet);
        }
        packet.transforms.push([...matrix.elements,...color.toArray(),1]);
        if(auxNames.length)packet.auxTransforms.push(aux);
        packet.bounds.union(bounds);
        if(packets.length>30_000)throw Error('Packet count budget exceeded');
      }
    }
  });
  for(const packet of packets){packet.instances=new Float32Array(packet.transforms.flat());packet.aux=packet.auxChannels.length?new Float32Array(packet.auxTransforms.flat()):null;
    delete packet.transforms;delete packet.auxTransforms;packet.bounds=[packet.bounds.min.toArray(),packet.bounds.max.toArray()];}
  const triangles=packets.reduce((total,packet)=>total+geometries[packet.geometry].index.length/3*packet.instances.length/20,0);
  return {version:WORLD_PACKET_VERSION,partition:{chunkSize,maxInstances},geometries,materials,packets,
    inventory:{sourceMeshes,sourceInstances,skippedSingular,uniqueGeometries:geometries.length,materials:materials.length,
      packets:packets.length,triangles,uniqueGeometryBytes:totalBytes,instanceBytes:packets.reduce((n,p)=>n+p.instances.byteLength,0),
      auxiliaryBytes:packets.reduce((n,p)=>n+(p.aux?.byteLength??0),0),
      owners:[...new Set(packets.map(p=>p.owner))],layers:Object.fromEntries(['static','animals','clouds','precipitation','sky'].map(layer=>[layer,packets.filter(p=>p.layer===layer).length]))},
    programs,unsupported,inactiveAttributes,evaluatedAttributes};
}

export function encodeWorldPackets(world) {
  if(new Uint8Array(new Uint16Array([1]).buffer)[0]!==1)throw Error('Little-endian encoder required');
  const buffers=[],ranges=[];let offset=16;
  const section=array=>{const bytes=bytesOf(array);const range={offset,bytes:bytes.length};buffers.push(bytes);ranges.push(range);offset+=bytes.length;return range;};
  const geometries=world.geometries.map(({id,vertex,index,bounds,vertexPreparation})=>({id,vertex:section(vertex),index:section(index),vertexCount:vertex.length/12,indexCount:index.length,bounds,...(vertexPreparation?{vertexPreparation}:{})}));
  const packets=world.packets.map(({instances,aux,...packet})=>({...packet,instances:section(instances),aux:aux?section(aux):null,count:instances.length/20}));
  if(offset>256*1024*1024)throw Error('World buffer exceeds 256 MiB');
  const bytes=new Uint8Array(offset);new Uint32Array(bytes.buffer,0,4).set([PACKET_MAGIC,WORLD_PACKET_VERSION,offset,ranges.length]);
  buffers.forEach((buffer,i)=>bytes.set(buffer,ranges[i].offset));
  return {bytes,manifest:{version:world.version,partition:world.partition,geometries,materials:world.materials,programs:world.programs,packets,inventory:world.inventory,unsupported:world.unsupported,inactiveAttributes:world.inactiveAttributes,evaluatedAttributes:world.evaluatedAttributes}};
}
