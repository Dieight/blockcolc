import * as THREE from 'three';
import {precipitationFieldForView,rainCrossSectionScaleForView} from '../../../packages/voxel/src/precipitation-field.ts';
import {precipitationCountForVolume} from '../../../packages/voxel/src/precipitation-density.ts';
import {precipitationMotion,patchPrecipitationMaterial} from '../../../packages/voxel/src/precipitation-motion.ts';
import {captureMaterialProgram,describeProgram} from './material-program.mjs';

export function weatherOracle() {
  const fields=[],motion=[],density=[],crossSection=[];
  for(const distance of [30,100,500,1300])for(const pitch of [.08,Math.PI/6,1.1])for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const yaw of [0,.4]){
    const eye={x:distance*Math.cos(pitch)*Math.sin(angle),y:distance*Math.sin(pitch),z:distance*Math.cos(pitch)*Math.cos(angle)};
    const input={cameraPosition:eye,cameraDirection:{x:-eye.x,y:-eye.y,z:-eye.z},cameraUp:{x:0,y:1,z:0},
      fovDegrees:34,aspect:.75,near:.1,far:3000,rootRotationY:yaw,precipitationMinY:-2,precipitationMaxY:80,
      target:{x:0,y:0,z:0},bounds:{minX:-600,maxX:600,minZ:-400,maxZ:400},minSpanX:24,minSpanZ:24,maxSpanX:1200,maxSpanZ:800,edgeMargin:6};
    fields.push({input,output:precipitationFieldForView(input)});
  }
  for(const override of [{cameraDirection:{x:0,y:0,z:0}},{cameraUp:{x:0,y:0,z:0}},{fovDegrees:0},{bounds:{minX:0,maxX:0,minZ:0,maxZ:0}}]){
    const input={...fields[0].input,...override};fields.push({input,output:precipitationFieldForView(input)});
  }
  for(const phase of [0,.25,.9,1])for(const elapsedMs of [0,16,1000,123456])for(const snow of [false,true])for(const speed of [.72,1.3]){
    motion.push({input:{phase,elapsedMs,snow,speed},output:precipitationMotion(phase,elapsedMs,snow,speed)});
  }
  for(const spanX of [24,80,400,1200])for(const spanZ of [24,80,700])for(const capacity of [32768,49152]){
    const input={referenceCount:680,qualityDensity:1,spanX,spanZ,spanY:40,capacity};density.push({input,output:precipitationCountForVolume(input)});
  }
  for(const baseCrossSection of [.022,.036,.36])for(const cameraDistance of [25,200,1300])for(const viewportHeightCss of [480,960]){
    const input={baseCrossSection,cameraDistance,viewportHeightCss,fovDegrees:34,targetProjectedCssPx:1.8,maximumScale:2.8};
    crossSection.push({input,output:rainCrossSectionScaleForView(input)});
  }
  return {fields,motion,density,crossSection};
}
export function weatherPrograms() {
  return [false,true].map(snow=>{
    const material=new THREE.MeshBasicMaterial(),ground=new THREE.DataTexture(new Float32Array([3]),1,1,THREE.RedFormat,THREE.FloatType);
    patchPrecipitationMaterial(material,snow,.2,40,snow?1:1.1,{texture:{value:ground},bounds:{value:[-500,-400,1000,800]}});
    const program=describeProgram(captureMaterialProgram(material,null),new Map([[ground,0]]));
    material.dispose();ground.dispose();return {snow,definition:program.definition,uniforms:program.uniforms};
  });
}
