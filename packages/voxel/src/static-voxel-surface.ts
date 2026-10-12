import type { BlueprintVoxel } from './blueprint';
import type { LocalOcclusionField } from './local-occlusion';

const FACES = [
  { normal: [1,0,0], corners: [[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]] },
  { normal: [-1,0,0], corners: [[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]] },
  { normal: [0,1,0], corners: [[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]] },
  { normal: [0,-1,0], corners: [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]] },
  { normal: [0,0,1], corners: [[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]] },
  { normal: [0,0,-1], corners: [[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]] },
] as const;

/** Only contiguous opaque reef cubes use this route. Leaves, glass, partial
 * models, animated construction and imported pack geometry keep their routes. */
export function isReefSolid(voxel: BlueprintVoxel): boolean {
  return /^minecraft:(sand|(?:dead_)?(?:tube|brain|bubble|fire|horn)_coral_block)$/.test(voxel.sourceBlockId ?? '');
}

/** Preserve individual block UVs and AO, omitting only fully hidden faces.
 * One geometry per existing material; no face-mask batches or extra draws. */
export function staticVoxelSurface(voxels: readonly BlueprintVoxel[], field: LocalOcclusionField) {
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[],voxelIndices:number[]=[];
  voxels.forEach((voxel,voxelIndex) => {
    for(const {normal,corners} of FACES) {
      const x=voxel.x+normal[0],y=voxel.y+normal[1],z=voxel.z+normal[2];
      if(field.has ? field.has(x,y,z) : field.occupied.has(`${x}:${y}:${z}`))continue;
      const base=positions.length/3;
      for(const corner of corners){positions.push(voxel.x+corner[0],voxel.y+corner[1],voxel.z+corner[2]);normals.push(...normal);voxelIndices.push(voxelIndex);}
      uvs.push(0,0,1,0,1,1,0,1);indices.push(base,base+1,base+2,base,base+2,base+3);
    }
  });
  return {positions,normals,uvs,indices,voxelIndices};
}
