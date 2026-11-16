import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {precipitationSource,encodeTexture,materialTextures} from './precipitation-source.mjs';
const hash=async b=>createHash('sha256').update(b).digest('hex');
test('weather inventory preserves full capacity without mutating the current draw prefix',()=>{
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),8);mesh.name='world-rain';mesh.count=2;
  const phase=new THREE.InstancedBufferAttribute(new Float32Array(8),1),offset=new THREE.InstancedBufferAttribute(new Float32Array(16),2);
  mesh.geometry.setAttribute('weatherPhase',phase);mesh.geometry.setAttribute('weatherOffset',offset);
  const policy=precipitationSource({resolveMesh:o=>o,selectObject:()=>true,dispose(){}}),view=policy.resolveMesh(mesh);
  assert.equal(view.count,8);assert.equal(mesh.count,2);assert.equal(view.instanceMatrix,mesh.instanceMatrix);
  assert.equal(view.geometry,mesh.geometry);assert.equal(view,policy.resolveMesh(mesh));
});
test('ground encoding retains signed fractional heights and refuses non-finite or quantized layouts',async()=>{
  const texture=new THREE.DataTexture(new Float32Array([-2.5,.125,40,3.75]),2,2,THREE.RedFormat,THREE.FloatType);
  const encoded=await encodeTexture(texture,hash),view=new DataView(encoded.bytes.buffer);
  assert.equal(encoded.descriptor.encoding,'r32f-le');assert.equal(encoded.bytes.byteLength,16);
  assert.deepEqual(Array.from({length:4},(_,i)=>view.getFloat32(i*4,true)),[-2.5,.125,40,3.75]);
  texture.image.data[0]=NaN;await assert.rejects(encodeTexture(texture,hash),/Invalid ground/);
  texture.image.data[0]=0;texture.magFilter=THREE.LinearFilter;
  await assert.rejects(encodeTexture(texture,hash),/Unreviewed floating/);
});
test('uniform samplers participate in texture inventory even without material.map',()=>{
  const texture=new THREE.DataTexture(new Float32Array([3]),1,1,THREE.RedFormat,THREE.FloatType);
  const material=new THREE.MeshBasicMaterial();material.onBeforeCompile=s=>{s.uniforms.weatherGround={value:texture};};
  assert.deepEqual([...materialTextures(material,null)],[texture]);
});
