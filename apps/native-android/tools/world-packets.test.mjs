import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {collectWorldPackets,encodeWorldPackets,PACKET_MAGIC} from './world-packets.mjs';
import {fullMapSource} from './full-map-source.mjs';

function fixture(count=25){
  const root=new THREE.Group(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
  const mesh=new THREE.InstancedMesh(geometry,material,count);
  for(let i=0;i<count;i++){mesh.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i%5,0,Math.floor(i/5)));mesh.setColorAt(i,new THREE.Color(i%2?.4:.8,.5,.3));}
  mesh.castShadow=true;root.add(mesh);return {root,mesh,geometry,material};
}
test('25 instances preserve one geometry and one real draw packet',()=>{
  const {root}=fixture();const result=collectWorldPackets(root);
  assert.equal(result.geometries.length,1);assert.equal(result.packets.length,1);
  assert.equal(result.packets[0].instances.length,25*20);assert.equal(result.inventory.triangles,25*12);
  assert.equal(result.geometries[0].vertex.length,24*12);assert.equal(result.inventory.skippedSingular,0);
});
test('partition budget and source ownership do not merge buildings',()=>{
  const {root,mesh}=fixture(12);root.userData.animalObstacle={id:'building:first'};
  const other=new THREE.Group();other.userData.animalObstacle={id:'building:second'};other.add(mesh.clone());
  const all=new THREE.Group();all.add(root,other);
  const result=collectWorldPackets(all,{maxInstances:5});
  assert.equal(result.geometries.length,1);assert.equal(result.packets.length,6);
  assert.deepEqual(result.inventory.owners,['building:first','building:second']);
});
test('selected drawRange and material groups retain only rendered indices',()=>{
  const {root,mesh,geometry,material}=fixture(1);mesh.material=[material,material];
  geometry.clearGroups();geometry.addGroup(0,3,0);geometry.addGroup(3,3,1);geometry.setDrawRange(3,3);
  const result=collectWorldPackets(root);assert.equal(result.inventory.triangles,1);
  assert.deepEqual([...result.geometries[0].index],[0,1,2]);
  const positions=geometry.getAttribute('position');
  for(const [at,source] of [2,3,1].entries())assert.deepEqual([...result.geometries[0].vertex.slice(at*12,at*12+3)],
    [positions.getX(source),positions.getY(source),positions.getZ(source)]);
});
test('packet bounds include rotated and scaled instances',()=>{
  const {root,mesh}=fixture(2);mesh.setMatrixAt(0,new THREE.Matrix4().makeScale(2,4,6));
  mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(20,2,2));
  const result=collectWorldPackets(root);assert.deepEqual(result.packets[0].bounds,[[-1,-2,-3],[20.5,2.5,3]]);
});
test('singular hidden instances remain accounted for, not drawn',()=>{
  const {root,mesh}=fixture(2);mesh.setMatrixAt(1,new THREE.Matrix4().makeScale(0,0,0));
  const result=collectWorldPackets(root);assert.equal(result.inventory.skippedSingular,1);
  assert.equal(result.inventory.sourceInstances,1);assert.equal(result.inventory.triangles,12);
});
test('bad numeric data and missing textures fail closed',()=>{
  const {root,geometry,material}=fixture(1);geometry.getAttribute('position').setX(0,NaN);
  assert.throws(()=>collectWorldPackets(root),/Non-finite vertex/);
  geometry.getAttribute('position').setX(0,1);material.map=new THREE.Texture();
  assert.throws(()=>collectWorldPackets(root),/not prepared/);
});
test('texture, shadow and transparency identities remain separate',()=>{
  const {root,mesh,geometry}=fixture(1);const other=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({transparent:true,opacity:.5}));
  other.castShadow=false;root.add(other);const result=collectWorldPackets(root);
  assert.equal(result.materials.length,2);assert.equal(result.packets.length,2);
  assert.notEqual(result.packets[0].castShadow,result.packets[1].castShadow);
  assert.equal(mesh.castShadow,true);
});
test('content dedup verifies complete buffers rather than trusting object identity',()=>{
  const {root,geometry,material}=fixture(1);root.add(new THREE.Mesh(geometry.clone(),material));
  const result=collectWorldPackets(root);assert.equal(result.geometries.length,1);
});
test('unused source vertices do not get duplicated for every material group',()=>{
  const {root,mesh,geometry,material}=fixture(1);mesh.material=[material,material];
  geometry.clearGroups();geometry.addGroup(0,3,0);geometry.addGroup(3,3,1);
  const result=collectWorldPackets(root);
  assert.equal(result.inventory.triangles,2);
  assert.ok(result.geometries.every(g=>g.vertex.length===3*12));
});
test('hidden material is not drawn and shadow-only geometry keeps colorWrite disabled',()=>{
  const {root,material}=fixture(1);material.colorWrite=false;
  assert.equal(collectWorldPackets(root).materials[0].colorWrite,false);
  material.visible=false;assert.equal(collectWorldPackets(root).packets.length,0);
});
test('encoded buffer has bounded aligned sections and deterministic inventory',()=>{
  const {root}=fixture();const packed=encodeWorldPackets(collectWorldPackets(root));
  const header=new Uint32Array(packed.bytes.buffer,0,4);
  assert.equal(header[0],PACKET_MAGIC);assert.equal(header[2],packed.bytes.length);
  assert.equal(packed.manifest.packets[0].count,25);
  for(const geometry of packed.manifest.geometries)for(const range of [geometry.vertex,geometry.index]){
    assert.equal(range.offset%4,0);assert.ok(range.offset>=16&&range.offset+range.bytes<=packed.bytes.length);
  }
});
test('shader applies rotated instances before the camera-relative model matrix',()=>{
  const shader=readFileSync(new URL('../world-filament/src/main/materials/instanced.mat.in',import.meta.url),'utf8');
  assert.match(shader,/float4 localPosition = getPosition\(\)/);
  assert.match(shader,/getWorldFromModelMatrix\(\)\s*\*\s*transform\s*\*\s*localPosition/);
  const cameraOrigin=new THREE.Matrix4().makeTranslation(-30,-20,-40);
  const instance=new THREE.Matrix4().makeRotationY(Math.PI/2).setPosition(5,0,12);
  const point=new THREE.Vector3(1,2,3);
  const expected=point.clone().applyMatrix4(instance).applyMatrix4(cameraOrigin);
  const right=point.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(cameraOrigin,instance));
  const wrong=point.clone().applyMatrix4(cameraOrigin).applyMatrix4(instance);
  assert.ok(right.distanceTo(expected)<1e-8);assert.ok(wrong.distanceTo(expected)>10);
});
test('same hook body with different closure uniforms does not merge materials',()=>{
  const {root,geometry,material}=fixture(1);
  const make=value=>{const m=material.clone();m.onBeforeCompile=shader=>{shader.uniforms.tint={value};};return m;};
  root.children[0].material=make(.2);root.add(new THREE.Mesh(geometry,make(.8)));
  const result=collectWorldPackets(root);
  assert.equal(result.programs.length,1);assert.equal(result.materials.length,2);
  assert.deepEqual(result.materials.map(m=>m.recipe.uniforms.tint),[.2,.8]);
  assert.ok(result.unsupported.some(gap=>gap.kind==='custom-program'));
});
test('different patched sources are separate programs even with the same cache key',()=>{
  const {root,geometry,material}=fixture(1);
  const other=material.clone();material.customProgramCacheKey=other.customProgramCacheKey=()=>'same-key';
  material.onBeforeCompile=shader=>{shader.fragmentShader+='\n// first';};
  other.onBeforeCompile=shader=>{shader.fragmentShader+='\n// second';};
  root.add(new THREE.Mesh(geometry,other));
  const result=collectWorldPackets(root);assert.equal(result.programs.length,2);assert.equal(result.materials.length,2);
});
test('attributes, sprites, deformation and non-PBR models are explicit unported gaps',()=>{
  const {root,mesh,geometry}=fixture(1);
  geometry.setAttribute('faceUvWord',new THREE.InstancedBufferAttribute(new Float32Array([20]),1));
  geometry.morphAttributes.position=[geometry.getAttribute('position').clone()];
  mesh.material=new THREE.MeshLambertMaterial();root.add(new THREE.Sprite());
  const gaps=collectWorldPackets(root).unsupported;
  for(const kind of ['unported-attribute','unported-deformation','unported-material-model','Sprite'])assert.ok(gaps.some(gap=>gap.kind===kind));
});
test('source budget is checked before reading or allocating instance transforms',()=>{
  const {root,mesh}=fixture(1);mesh.count=300001;
  mesh.getMatrixAt=()=>{throw Error('should not touch data');};
  assert.throws(()=>collectWorldPackets(root),/Source instance budget/);
});
test('default visibility stays conservative; full-map source restores uncropped buffers without mutation',()=>{
  const {root,mesh}=fixture(4);const source=mesh.instanceMatrix.array.slice();
  const sourceColor=mesh.instanceColor.array.slice();mesh.count=0;mesh.castShadow=false;
  const shadow=mesh.clone();shadow.userData.sceneryShadowCopy=true;shadow.count=4;shadow.castShadow=true;root.add(shadow);
  const near=new THREE.Group(),lod=new THREE.Group();lod.name='test-landmark';lod.userData.sceneryObject={width:8,depth:6};near.name='full';near.visible=false;
  near.add(new THREE.Mesh(mesh.geometry,mesh.material));lod.add(near);root.add(lod);
  assert.equal(collectWorldPackets(root).inventory.triangles,48); // depth copy only, near hidden
  const options=fullMapSource(object=>object===mesh?{count:4,castShadow:true,copies:[
    {attribute:mesh.instanceMatrix,source},{attribute:mesh.instanceColor,source:sourceColor}]}:null);
  const result=collectWorldPackets(root,options);
  assert.equal(result.inventory.triangles,60); // complete grove plus canonical near detail
  assert.equal(result.inventory.sourceInstances,5);assert.equal(result.packets[0].castShadow,true);
  assert.equal(mesh.count,0);assert.equal(mesh.castShadow,false);assert.equal(near.visible,false);
  assert.deepEqual([...mesh.instanceMatrix.array],[...source]);
});
test('owner-only packet export cannot collect other buildings',()=>{
  const {root,mesh}=fixture(1);root.userData.animalObstacle={id:'building:a'};
  const second=new THREE.Group();second.userData.animalObstacle={id:'building:b'};second.add(mesh.clone());
  const scene=new THREE.Group();scene.add(root,second);
  const result=collectWorldPackets(scene,{ownerFilter:'building:a'});
  assert.deepEqual(result.inventory.owners,['building:a']);assert.equal(result.inventory.sourceInstances,1);
});
test('snow blocks and blueprint names do not become weather or animal layers',()=>{
  const {root,mesh}=fixture(1);mesh.name='original-shape-minecraft:snow_layer';root.name='animal-cloud-snow-house';
  assert.equal(collectWorldPackets(root).packets[0].layer,'static');
  root.name='world-snow';assert.equal(collectWorldPackets(root).packets[0].layer,'precipitation');
  root.name='world-animals';assert.equal(collectWorldPackets(root).packets[0].layer,'animals');
  root.name='world-clouds';assert.equal(collectWorldPackets(root).packets[0].layer,'clouds');
});
test('fluid instance channels survive packet partitioning and singular-instance removal',()=>{
  const {root,mesh,geometry}=fixture(4);
  mesh.setMatrixAt(1,new THREE.Matrix4().makeScale(0,0,0));
  geometry.setAttribute('instanceFaceOcclusion',new THREE.InstancedBufferAttribute(new Float32Array([1000001,0,1098304,1065536]),1));
  geometry.setAttribute('instanceMaterialResponse',new THREE.InstancedBufferAttribute(new Float32Array([16777215,0,262144,63]),1));
  const result=collectWorldPackets(root,{maxInstances:2}),encoded=encodeWorldPackets(result);
  assert.equal(encoded.manifest.version,5);assert.equal(result.inventory.auxiliaryBytes,48);
  assert.deepEqual(result.packets.map(p=>[...p.aux]),[[1000001,16777215,0,0,1098304,262144,0,0],[1065536,63,0,0]]);
  assert.ok(result.packets.every(p=>p.auxChannels.join(',')==='instanceFaceOcclusion,instanceMaterialResponse'));
  assert.ok(!result.unsupported.some(g=>g.kind==='unported-attribute'));
  for(const p of encoded.manifest.packets)assert.deepEqual([...new Float32Array(encoded.bytes.buffer,p.aux.offset,p.count*4)],
    [...result.packets[p.id].aux]);
});
test('auxiliary layouts and nonintegral packed values fail instead of being coerced',()=>{
  for(const bad of [NaN,-1,.25,16777216]){
    const {root,geometry}=fixture(1);
    geometry.setAttribute('instanceFaceOcclusion',new THREE.InstancedBufferAttribute(new Float32Array([bad]),1));
    assert.throws(()=>collectWorldPackets(root),/Invalid packed/);
  }
  for(const options of [{size:2,count:4,rate:1},{size:1,count:1,rate:1},{size:1,count:4,rate:2},{size:1,count:4,rate:1,normalized:true}]){
    const {root,geometry}=fixture(2);
    geometry.setAttribute('instanceFaceOcclusion',new THREE.InstancedBufferAttribute(new Float32Array(options.count),options.size,options.normalized??false,options.rate));
    assert.throws(()=>collectWorldPackets(root),/Unsupported auxiliary/);
  }
});
test('fine night reflections do not traverse the mobile mediump view-vector getter',()=>{
  const compiler=readFileSync(new URL('./compile-materials.mjs',import.meta.url),'utf8');
  assert.match(compiler,/normalize\(getWorldPosition\(\) - getWorldCameraPosition\(\)\)/);
  assert.doesNotMatch(compiler,/sourceReflection\(materialParams\.roughness, -getWorldViewVector\(\)/);
  const shader=readFileSync(new URL('../world-filament/src/main/materials/instanced.mat.in',import.meta.url),'utf8');
  assert.match(shader,/name : skyGalaxyNormal, precision : high/);
});

test('cloud center and velocity share one auxiliary texel without losing signed fractions',()=>{
  const {root,geometry}=fixture(2);
  geometry.setAttribute('cloudCenter',new THREE.InstancedBufferAttribute(new Float32Array([-12.5,3.25,2,-9]),2));
  geometry.setAttribute('cloudVelocity',new THREE.InstancedBufferAttribute(new Float32Array([.15,-.3,-.2,.1]),2));
  const result=collectWorldPackets(root);
  assert.deepEqual(result.packets[0].auxChannels,['cloudCenter','cloudVelocity']);
  assert.deepEqual([...result.packets[0].aux],[-12.5,3.25,Math.fround(.15),Math.fround(-.3),2,-9,Math.fround(-.2),Math.fround(.1)]);
  assert.equal(result.unsupported.filter(g=>g.kind==='unported-attribute').length,0);
  geometry.deleteAttribute('cloudCenter');assert.throws(()=>collectWorldPackets(root),/incomplete/);
});

test('weather phases and offsets retain their source prefix index across packet boundaries',()=>{
  const {root,geometry}=fixture(4);
  geometry.setAttribute('weatherPhase',new THREE.InstancedBufferAttribute(new Float32Array([0,.25,.5,.75]),1));
  geometry.setAttribute('weatherOffset',new THREE.InstancedBufferAttribute(new Float32Array([-.5,.5,.25,-.25,0,0,.1,-.1]),2));
  const result=collectWorldPackets(root,{maxInstances:2});
  assert.ok(result.packets.every(p=>p.auxChannels.join(',')==='weatherPhase,weatherOffset'));
  assert.deepEqual(result.packets.flatMap(p=>[...p.aux].filter((_,i)=>i%4===3)),[0,1,2,3]);
  assert.equal(result.unsupported.length,0);
  geometry.getAttribute('weatherPhase').setX(1,1.1);
  assert.throws(()=>collectWorldPackets(root),/Invalid weather/);
  geometry.deleteAttribute('weatherPhase');assert.throws(()=>collectWorldPackets(root),/incomplete/);
});

test('animal slots remain in moving batches rather than birth-position chunks',()=>{
  const {root,mesh,geometry}=fixture(4);root.name='world-animals';
  for(let i=0;i<4;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i*100,0,0));
  geometry.setAttribute('animalSlot',new THREE.InstancedBufferAttribute(new Float32Array([0,0,1,1,0,1,2,0,0,3,0,0]),3));
  const result=collectWorldPackets(root,{maxInstances:2});
  assert.equal(result.packets.length,2);assert.ok(result.packets.every(p=>p.chunk.join(',')==='0,0'&&p.layer==='animals'));
  assert.deepEqual(result.packets.flatMap(p=>[...p.aux].filter((_,i)=>i%4===0)),[0,1,2,3]);
  assert.deepEqual(result.packets.flatMap(p=>[...p.aux].filter((_,i)=>i%4===2)),[1,1,0,0]);
  for(const [channel,value]of [[0,-1],[0,.5],[0,1536],[1,4],[2,.5]]){
    const a=geometry.getAttribute('animalSlot'),at=a.array[channel];a.array[channel]=value;
    assert.throws(()=>collectWorldPackets(root),/Invalid animal rig slot/);a.array[channel]=at;
  }
  geometry.setAttribute('weatherPhase',new THREE.InstancedBufferAttribute(new Float32Array(4),1));
  assert.throws(()=>collectWorldPackets(root),/Mixed or incomplete/);
});

test('dormant atlas attributes are audited, but an active declaration or unknown attribute remains a gap',()=>{
  const {root,geometry,material}=fixture(1);
  geometry.setAttribute('instanceFaceTilesA',new THREE.InstancedBufferAttribute(new Float32Array([1,2,3]),3));
  let result=collectWorldPackets(root);assert.equal(result.inactiveAttributes.instanceFaceTilesA,1);assert.equal(result.unsupported.length,0);
  material.onBeforeCompile=shader=>{shader.vertexShader='attribute vec3 instanceFaceTilesA;\n'+shader.vertexShader;};
  result=collectWorldPackets(root);assert.ok(result.unsupported.some(g=>g.name==='instanceFaceTilesA'));
  geometry.setAttribute('unknownChannel',new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count),1));
  assert.ok(collectWorldPackets(root).unsupported.some(g=>g.name==='unknownChannel'));
});

test('both scenery levels stay separate and retain a stable selector without changing source visibility',()=>{
  const {root,mesh}=fixture(1),landmark=new THREE.Group(),near=new THREE.Group(),far=new THREE.Group();
  landmark.name='wreck-1';landmark.position.set(20,2,30);landmark.userData.sceneryObject={width:12,depth:9};
  near.name='full';far.name='distant';far.visible=false;near.add(mesh.clone());far.add(mesh.clone());landmark.add(near,far);root.add(landmark);
  const packed=collectWorldPackets(root,fullMapSource(()=>null,{includeDistant:true}));
  assert.deepEqual(packed.packets.filter(p=>p.lod).map(p=>p.lod),[
    {id:'wreck-1',detail:'full',center:[20,5,30],width:12},{id:'wreck-1',detail:'distant',center:[20,5,30],width:12}]);
  assert.equal(far.visible,false);assert.equal(near.visible,true);assert.equal(packed.packets.length,3);
});
