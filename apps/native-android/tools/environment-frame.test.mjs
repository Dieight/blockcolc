import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureEnvironment} from './environment-frame.mjs';

function renderer(){return {outputColorSpace:THREE.SRGBColorSpace,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:.91,
  shadowMap:{enabled:true,type:THREE.PCFShadowMap,autoUpdate:false},getClearColor:color=>color.setRGB(.1,.2,.3),getClearAlpha:()=>1};}
test('environment records source intensity, exposure, hemisphere and linear fog',()=>{
  const scene=new THREE.Scene(),sun=new THREE.DirectionalLight(0xffedc5,1.81),hemi=new THREE.HemisphereLight(0xaaccff,0x223344,.77);
  sun.position.set(2,3,4);sun.target.position.set(1,1,1);sun.castShadow=true;scene.add(sun,sun.target,hemi);
  scene.fog=new THREE.Fog(0x778899,12,220);const result=captureEnvironment(scene,renderer());
  assert.equal(result.toneMapping,THREE.ACESFilmicToneMapping);assert.equal(result.exposure,.91);
  assert.equal(result.lights[0].intensity,1.81);assert.deepEqual(result.lights[0].direction,new THREE.Vector3(-1,-2,-3).normalize().toArray());
  assert.deepEqual(result.lights[1].groundColor,hemi.groundColor.toArray());assert.equal(result.fog.far,220);
  assert.deepEqual(result.gaps,[]);
});
test('ancestor-hidden lights stay hidden and unsupported models remain explicit',()=>{
  const scene=new THREE.Scene(),group=new THREE.Group(),light=new THREE.PointLight(0xffffff,4,8);
  group.visible=false;group.add(light);scene.add(group,new THREE.SpotLight());
  const result=captureEnvironment(scene,renderer());assert.equal(result.lights[0].visible,false);
  assert.deepEqual(result.gaps,['light-model:SpotLight']);
});
test('world rotations transform light directions without changing colors or intensities',()=>{
  const scene=new THREE.Scene(),group=new THREE.Group(),sun=new THREE.DirectionalLight(0xffffff,2);
  sun.position.set(0,1,1);group.add(sun,sun.target);group.rotation.y=Math.PI/2;scene.add(group);
  const result=captureEnvironment(scene,renderer());assert.ok(result.lights[0].direction[0]<-.7);
  assert.ok(Math.abs(result.lights[0].direction[2])<1e-8);assert.equal(result.lights[0].intensity,2);
});
