import {expect,it} from 'vitest';
import {createLocalOcclusionField} from '../src/local-occlusion';
import {isReefSolid,staticVoxelSurface} from '../src/static-voxel-surface';
import type {BlueprintVoxel} from '../src/blueprint';

const cell=(x:number,y=0,z=0,id='sand'):BlueprintVoxel=>({x,y,z,sourceBlockId:`minecraft:${id}`,materialId:'stone',buildOrder:0});
it('keeps block UVs, outward normals and AO ownership on all six visible sides',()=>{
  const data=staticVoxelSurface([cell(0)],createLocalOcclusionField([cell(0)]));
  expect(data.indices.length/3).toBe(12);expect(data.voxelIndices).toEqual(Array(24).fill(0));
  expect(new Set(data.uvs)).toEqual(new Set([0,1]));
  for(let i=0;i<data.indices.length;i+=3){
    const [a,b,c]=data.indices.slice(i,i+3).map(index=>data.positions.slice(index*3,index*3+3));
    const u=b!.map((v,index)=>v-a![index]!),v=c!.map((n,index)=>n-a![index]!);
    const cross=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];
    expect(cross.map(n=>n===0?0:n)).toEqual(data.normals.slice(data.indices[i]!*3,data.indices[i]!*3+3));
  }
});
it('removes interior faces across material and spatial chunk boundaries, not exterior faces',()=>{
  const voxels=[cell(19),cell(20,0,0,'brain_coral_block')],field=createLocalOcclusionField(voxels);
  expect(staticVoxelSurface(voxels,field).indices.length/3).toBe(20);
  expect(staticVoxelSurface(voxels.slice(0,1),field).indices.length/3).toBe(10);
  const cube=[];for(let x=0;x<5;x++)for(let y=0;y<5;y++)for(let z=0;z<5;z++)cube.push(cell(x,y,z));
  expect(staticVoxelSurface(cube,createLocalOcclusionField(cube)).indices.length/3).toBe(6*5*5*2);
});
it('does not treat translucent blocks, plants, partial models or task geometry as reef solids',()=>{
  for(const id of ['glass','oak_leaves','water','tube_coral_fan','sandstone_stairs','oak_log'])expect(isReefSolid(cell(0,0,0,id))).toBe(false);
  for(const id of ['sand','tube_coral_block','dead_horn_coral_block'])expect(isReefSolid(cell(0,0,0,id))).toBe(true);
  const voxels=[cell(0),cell(1,0,0,'glass')];
  expect(staticVoxelSurface(voxels.slice(0,1),createLocalOcclusionField(voxels)).indices.length/3).toBe(12);
  // Reef fans use a crossed/partial model. They must not punch a cube-sized
  // hole in the merged bed behind them, even if the general AO field sees them.
  const fan=[cell(0),cell(1,0,0,'tube_coral_fan')];
  expect(staticVoxelSurface(fan.slice(0,1),createLocalOcclusionField(fan.filter(isReefSolid))).indices.length/3).toBe(12);
});
