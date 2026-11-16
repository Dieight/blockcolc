import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {completeSceneSource} from './sky-source.mjs';
import {collectWorldPackets,sourceLayer} from './world-packets.mjs';
test('source sky points and sprites become real instances without mutating source ownership',()=>{
  const scene=new THREE.Scene(),root=new THREE.Group(),sky=new THREE.Group();sky.name='layeredSky';scene.add(root,sky);
  const geo=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([1,2,3,4,5,6],3));
  const points=new THREE.Points(geo,new THREE.PointsMaterial({size:1.45,sizeAttenuation:false}));points.name='deterministicStars';
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({color:0xabcdef}));sprite.name='squareSun';sprite.scale.set(8,9,1);sky.add(points,sprite);
  const outsiders=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());scene.add(outsiders);
  scene.updateMatrixWorld(true);const policy=completeSceneSource({root,fullBatch:()=>null}),children=sky.children.slice();
  assert.equal(policy.selectObject(outsiders),false);assert.equal(policy.selectObject(points),true);
  const converted=policy.resolveMesh(points);assert.equal(converted,policy.resolveMesh(points));assert.equal(converted.count,2);
  assert.equal(sourceLayer(converted),'sky');assert.equal(converted.material.userData.nativeBillboard,2);
  const packed=collectWorldPackets(scene,policy);
  assert.equal(packed.inventory.sourceInstances,3);assert.equal(packed.inventory.layers.sky,2);
  assert.deepEqual(packed.packets.map(p=>p.priority),[1,2]);assert.equal(packed.unsupported.length,0);
  assert.deepEqual(sky.children,children);assert.equal(points.parent,sky);assert.equal(sprite.parent,sky);
  assert.equal(points.material.sizeAttenuation,false);assert.equal(points.geometry,geo);policy.dispose();
});
test('unsupported point rasterization is refused and hidden sky stays hidden',()=>{
  const root=new THREE.Group(),scene=new THREE.Scene(),sky=new THREE.Group();scene.add(root,sky);sky.name='layeredSky';
  const point=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3)),new THREE.PointsMaterial());sky.add(point);
  const policy=completeSceneSource({root,fullBatch:()=>null});assert.throws(()=>policy.resolveMesh(point),/Unreviewed source point/);
  sky.visible=false;assert.equal(policy.selectObject(point),false);policy.dispose();
});

test('a partially visible star field preserves the actual point drawRange',()=>{
  const scene=new THREE.Scene(),root=new THREE.Group(),sky=new THREE.Group();sky.name='layeredSky';scene.add(root,sky);
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([1,2,3,4,5,6,7,8,9],3));
  geometry.setDrawRange(1,1);const points=new THREE.Points(geometry,new THREE.PointsMaterial({sizeAttenuation:false}));sky.add(points);
  const policy=completeSceneSource({root,fullBatch:()=>null}),view=policy.resolveMesh(points),matrix=new THREE.Matrix4();
  assert.equal(view.count,1);view.getMatrixAt(0,matrix);assert.deepEqual(matrix.elements.slice(12,15),[4,5,6]);
  assert.equal(geometry.drawRange.start,1);assert.equal(geometry.drawRange.count,1);policy.dispose();
});
