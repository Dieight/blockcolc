import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {atlasDefinition,atlasAppearance,bakeAtlasVertex} from './atlas-source.mjs';
import {collectWorldPackets} from './world-packets.mjs';
import {decodeResourceWire,encodeResourceWire} from './resource-wire.mjs';
import {atlasAnimationCode} from './atlas-runtime-input.mjs';

function fixture(){
  const example=JSON.parse(readFileSync(new URL('./fixtures/reviewed-atlas-programs.json',import.meta.url))).programs[0];
  const material=new THREE.MeshStandardMaterial({map:new THREE.Texture()}),u={},textureIds=new Map([[material.map,0]]);
  for(const [name,value]of Object.entries(example.uniforms)){
    const v=Array.isArray(value)?value.length===2?new THREE.Vector2(...value):new THREE.Vector3(...value)
      :value&&typeof value==='object'?new THREE.Texture():value;
    if(v?.isTexture)textureIds.set(v,textureIds.size);u[name]={value:v};
  }
  material.customProgramCacheKey=()=>example.definition.cacheKey;
  material.onBeforeCompile=s=>{s.uniforms=u;s.vertexShader=example.definition.vertex;s.fragmentShader=example.definition.fragment;};
  const program={...example.definition,uniforms:u};
  const geometry=new THREE.BoxGeometry(1,1,1),count=30,full=4194303;
  for(const name of ['instanceFaceTilesA','instanceFaceTilesB'])geometry.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(count*3).fill(0),3));
  for(const name of ['instanceFaceUvWordA0','instanceFaceUvWordA1','instanceFaceUvWordB0','instanceFaceUvWordB1'])
    geometry.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(count*3).fill(name.includes('B')?full:0),3));
  geometry.setAttribute('instanceFaceTintKinds',new THREE.InstancedBufferAttribute(new Float32Array(count),1));
  geometry.setAttribute('instanceFaceOcclusion',new THREE.InstancedBufferAttribute(Float32Array.from({length:count},(_,i)=>i),1));
  geometry.setAttribute('instanceMaterialResponse',new THREE.InstancedBufferAttribute(new Float32Array(count),1));
  return {material,program,geometry,count,textureIds};
}
test('atlas UV / tint is evaluated once per reusable appearance, not expanded per voxel or AO value',()=>{
  const f=fixture(),mesh=new THREE.InstancedMesh(f.geometry,f.material,f.count),root=new THREE.Group();root.add(mesh);
  for(let i=0;i<f.count;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i,0,0));root.updateMatrixWorld(true);
  const original=f.geometry.getAttribute('uv').array.slice();
  const packets=collectWorldPackets(root,{textureIds:f.textureIds,chunkSize:64});
  assert.equal(packets.geometries.length,1);assert.equal(packets.inventory.sourceInstances,30);
  assert.equal(packets.packets.reduce((n,p)=>n+p.instances.length/20,0),30);
  assert.equal(packets.geometries[0].vertexPreparation,'atlas-static-v1');
  assert.ok(!packets.unsupported.some(g=>g.kind==='unported-attribute'));
  assert.deepEqual(f.geometry.getAttribute('uv').array,original);
});
test('cropped / rotated cube UVs and non-finite packed words are handled explicitly',()=>{
  const f=fixture(),d=atlasDefinition(f.material,f.program),a=atlasAppearance(f.geometry,0,d);
  const v=bakeAtlasVertex({uv:[0,0],position:[-.5,.5,-.5],normal:[0,1,0]},a,d);
  assert.equal(v.color[3],1);assert.ok(v.uv.every(Number.isFinite));
  f.geometry.getAttribute('instanceFaceUvWordA0').setX(0,NaN);
  assert.throws(()=>atlasAppearance(f.geometry,0,d),/packed/);
});
test('normalized pack preserves PNG bytes without packaging any archive',()=>{
  const m={schemaVersion:1,textures:[{png:new Uint8Array([0,255,33])}],models:[]},identity={kind:'mc263',sha256:'a'.repeat(64)};
  const raw=encodeResourceWire(m,identity),r=decodeResourceWire(raw);
  assert.deepEqual(r.manifest.textures[0].png,m.textures[0].png);assert.ok(!raw.includes('.jar'));
  assert.throws(()=>decodeResourceWire('{"schema":2}'));
  assert.notEqual(atlasAnimationCode({width:1,height:1,tileCount:1,sequences:[]},0),atlasAnimationCode({width:1,height:1,tileCount:1,sequences:[]},1));
});

test('nonzero source face rotation overrides the intermediate flowing top UV',()=>{
  const f=fixture(),d=atlasDefinition(f.material,f.program),a=atlasAppearance(f.geometry,0,d);
  a.uvA[1]=3*4194304;
  const v={uv:[.2,.8],position:[-.5,.5,-.5],normal:[0,1,0]};
  const still=bakeAtlasVertex(v,a,d),flow=bakeAtlasVertex(v,{...a,flow:1000000+65536+32768+4095},d);
  assert.deepEqual(flow,still);
});
