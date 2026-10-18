import type {SurfaceSource} from './terrain-surface-table';
import type * as THREE from 'three';

/** At overview distances tiny fish are not readable anyway. Returning to an
 * opaque far surface avoids accumulated transparency across overlapping LOD
 * sheets; nearby water remains clear enough to inspect real underwater bodies. */
export function patchAnimalWaterVisibility(material:THREE.MeshStandardMaterial):void {
  const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=(shader,renderer)=>{
    previous(shader,renderer);
    const anchor='#include <alphatest_fragment>';
    if(!shader.fragmentShader.includes(anchor))throw Error('Water visibility shader anchor changed.');
    shader.fragmentShader=shader.fragmentShader.replace(anchor,`
      diffuseColor.a = mix(diffuseColor.a, 1.0, smoothstep(24.0, 60.0, length(vViewPosition)));
      ${anchor}`);
  };
  material.customProgramCacheKey=()=>`${key()}|animal-water-visibility-24-60-v1`;
}

/** A bounded-depth bed under existing non-coast water quads. The water mask,
 * shore, ground and world seed stay untouched; no floating opaque fish layer. */
export function createAnimalWaterBed(surfaces:SurfaceSource){
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(const s of surfaces){
    if(!s.water||s.minX>=s.maxX||s.minZ>=s.maxZ)continue;
    const y=s.supportY-.5-2.4,i=positions.length/3;
    for(const [x,z] of [[s.minX,s.minZ],[s.minX,s.maxZ],[s.maxX,s.maxZ],[s.maxX,s.minZ]]){
      positions.push(x!,y,z!);normals.push(0,1,0);uvs.push(x!/6,z!/6);
    }
    indices.push(i,i+1,i+2,i,i+2,i+3);
  }
  return {positions,normals,uvs,indices};
}
