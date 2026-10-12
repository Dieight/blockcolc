import { expect,it } from 'vitest';
import { createReefField, reefCoverage } from '../src/reef-field';

it('builds large deterministic irregular beds with five coral colours, branches and waterlogged details',()=>{
  const first=createReefField(17,30,24),repeat=createReefField(17,30,24),other=createReefField(18,30,24);
  expect(first).toEqual(repeat);expect(first).not.toEqual(other);
  expect(first.voxels.length).toBeGreaterThan(2000);
  const coral=first.voxels.filter(v=>v.sourceBlockId!.endsWith('_coral_block'));
  expect(coral.length).toBeGreaterThan(800);
  expect(new Set(coral.map(v=>v.sourceBlockId)).size).toBe(5);
  expect(Math.max(...coral.map(v=>v.x))-Math.min(...coral.map(v=>v.x))).toBeGreaterThan(50);
  expect(Math.max(...coral.map(v=>v.z))-Math.min(...coral.map(v=>v.z))).toBeGreaterThan(35);
  expect(new Set(coral.map(v=>v.y)).size).toBeGreaterThan(2);
  const floor=new Set(first.voxels.filter(v=>v.y===0).map(v=>`${v.x}:${v.z}`));
  expect(floor.size).toBeLessThan(61*49*.9); // Irregular boundary and sandy channels.
  const todo=[...floor],seen=new Set<string>();let largest=0;
  for(const start of todo){if(seen.has(start))continue;const queue=[start];seen.add(start);let count=0;
    while(queue.length){const [x,z]=queue.pop()!.split(':').map(Number);count++;
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const key=`${x!+dx!}:${z!+dz!}`;if(floor.has(key)&&!seen.has(key)){seen.add(key);queue.push(key);}}}
    largest=Math.max(largest,count);
  }
  expect(largest).toBeGreaterThan(floor.size*.7);
  for(const v of first.voxels.filter(v=>/_coral_fan$|sea_pickle$/.test(v.sourceBlockId!)))expect(v.sourceBlockState?.waterlogged).toBe('true');
  expect(first.distantVoxels.every(v=>first.voxels.includes(v))).toBe(true);
});
it('clips all branches and footprint blocks to actual water',()=>{
  const clipped=createReefField(27,30,24,(x,z)=>x<8&&z<9);
  expect(clipped.voxels.length).toBeGreaterThan(500);
  expect(clipped.voxels.every(v=>v.x<8&&v.z<9)).toBe(true);
});
it('uses the same block field across culling tiles, including branches that cross their boundary',()=>{
  const tile=(originX:number,halfX:number)=>createReefField(27,halfX,20,(x,z)=>x>=-halfX&&x<halfX&&z>=-20&&z<20,
    {originX,originZ:0,baseY:()=>-8,density:()=>1});
  const world=(entry:ReturnType<typeof tile>,originX:number)=>entry.voxels.map(voxel=>({...voxel,x:voxel.x+originX}));
  const sort=(cells:ReturnType<typeof world>)=>cells.sort((a,b)=>a.y-b.y||a.x-b.x||a.z-b.z);
  expect(sort([...world(tile(0,20),0),...world(tile(40,20),40)])).toEqual(sort(world(tile(20,40),20)));
});
it('has a soft irregular, seed-stable shoal contour rather than rectangular region clipping',()=>{
  const edge=[];for(let angle=0;angle<Math.PI*2;angle+=.1)edge.push(reefCoverage(27,Math.cos(angle)*100,Math.sin(angle)*100,0,0,100));
  expect(new Set(edge.map(value=>Math.round(value*100))).size).toBeGreaterThan(10);
  expect(edge.some(value=>value>0&&value<1)).toBe(true);
  expect(reefCoverage(27,0,0,0,0,100)).toBe(1);expect(reefCoverage(27,300,300,0,0,100)).toBe(0);
});
