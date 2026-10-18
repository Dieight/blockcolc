import { expect,it } from 'vitest';
import { createTerrainMeshBuffers } from '../src/terrain-mesh';
import { compactTerrainRenderMesh } from '../src/terrain-render-mesh';
import { buildChunkMeshes,joinChunkMeshes,meshCoverageHash,partitionTerrain,sameChunkGeometry,type Mesh } from '../tools/terrain-chunk-prototype';

function fixture():Mesh {
  const source=createTerrainMeshBuffers();
  for(let x=-9;x<10;x++)for(let z=-9;z<10;z++){
    if(x===-1&&z===1)continue;
    const y=x>4?3:0;
    source.addTop([x,y,z,x,y,z+1,x+1,y,z+1,x+1,y,z],z<0?'water':'grass');
  }
  source.addSide([-1,0,0,-1,2,0,-.95,2,0,-.95,0,0],'dirt');
  source.addSide([-.95,0,0,-.95,2,0,-1,2,0,-1,0,0],'dirt');
  return {positions:source.positions,indicesByMaterial:source.indicesByMaterial,sideIndices:source.sideIndices,
    triangleCount:(Object.values(source.indicesByMaterial).reduce((n,a)=>n+a.length,0)+source.sideIndices.dirt.length)/3};
}

it('preserves exact plane coverage, holes, material boundaries and both sliver windings across tiles',()=>{
  const data=fixture(),before=structuredClone(data),expected=meshCoverageHash(data);
  expect(meshCoverageHash(compactTerrainRenderMesh(data))).toBe(expected);
  for(const size of [1,4,8,16,64]){
    const result=buildChunkMeshes(data,size);
    expect(meshCoverageHash(joinChunkMeshes(result.chunks))).toBe(expected);
    expect(result.chunks.reduce((n,c)=>n+c.source.triangleCount,0)).toBe(data.triangleCount);
    expect(result.chunks.every(c=>c.source.positions===data.positions)).toBe(true);
  }
  expect(data).toEqual(before);
});

it('rejects equal-area holes, shifted surfaces, duplicate faces, material changes and flipped winding in the coverage oracle',()=>{
  const original=createTerrainMeshBuffers();original.addTop([0,0,0,0,0,2,2,0,2,2,0,0],'grass');
  const mesh:Mesh={...original,triangleCount:2},expected=meshCoverageHash(mesh);
  for(const change of ['shift','height','duplicate','winding','material'] as const){
    const copy:Mesh=structuredClone({positions:mesh.positions,indicesByMaterial:mesh.indicesByMaterial,sideIndices:mesh.sideIndices,triangleCount:2});
    if(change==='shift')for(let i=0;i<copy.positions.length;i+=3)copy.positions[i]=copy.positions[i]!+2;
    if(change==='height')for(let i=1;i<copy.positions.length;i+=3)copy.positions[i]=3;
    if(change==='duplicate')copy.indicesByMaterial.grass.push(...copy.indicesByMaterial.grass);
    if(change==='winding')copy.indicesByMaterial.grass=[0,3,2,0,2,1];
    if(change==='material'){copy.indicesByMaterial.water=copy.indicesByMaterial.grass;copy.indicesByMaterial.grass=[];}
    expect(meshCoverageHash(copy),change).not.toBe(expected);
  }
  const gap=createTerrainMeshBuffers();
  gap.addTop([0,0,0,0,0,1,1,0,1,1,0,0],'grass');
  gap.addTop([3,0,0,3,0,3,4,0,3,4,0,0],'grass');
  expect(meshCoverageHash({...gap,triangleCount:4})).not.toBe(expected); // Still area four.
});

it('verifies new chunk coordinates instead of assuming the same key has the same global terrain',()=>{
  const source=fixture(),before=buildChunkMeshes(source,4,compactTerrainRenderMesh,undefined,'global-profile');
  const unchanged=buildChunkMeshes(structuredClone(source),4,compactTerrainRenderMesh,before,'global-profile');
  expect(unchanged.hits).toBe(before.chunks.length);expect(unchanged.misses).toBe(0);
  expect(unchanged.chunks[0]!.mesh).toBe(before.chunks[0]!.mesh);
  const changed=structuredClone(source);changed.positions[1]=19;
  const partial=buildChunkMeshes(changed,4,compactTerrainRenderMesh,before,'global-profile');
  expect(partial.misses).toBeGreaterThan(0);expect(partial.hits).toBeGreaterThan(0);
  const differentProfile=buildChunkMeshes(source,4,compactTerrainRenderMesh,before,'new-global-profile');
  expect(differentProfile.hits).toBe(0);
  const first=partitionTerrain(source,4)[0]!.source;
  const relocated={...first,positions:[...first.positions]};relocated.positions[1]=20;
  expect(sameChunkGeometry(first,relocated)).toBe(true); // This global vertex belongs to a different chunk.
  const referenced=Object.values(first.indicesByMaterial).find(indices=>indices.length)![0]!;
  relocated.positions[referenced*3+1]=20;
  expect(sameChunkGeometry(first,relocated)).toBe(false);
});
