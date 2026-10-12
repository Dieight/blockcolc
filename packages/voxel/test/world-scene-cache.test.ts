import { describe,expect,it } from 'vitest';
import { createSteppedTerrainData,terrainGenerationInputKey } from '../src/terrain';
import { compactTerrainRenderMesh } from '../src/terrain-render-mesh';
import { sceneryGeometryLayers,sceneryHouseBlocks } from '../src/scenery';
import { restoreWorldSceneCache,packWorldSceneCache,sceneryGenerationInputKey,worldSceneCacheBytes,WORLD_SCENE_CACHE_MAX_BYTES,WORLD_SCENE_CACHE_REVISION,type WorldSceneCache } from '../src/world-scene-cache';

function fixture():WorldSceneCache {
  const options={environmentStyle:'classic-island' as const,worldSeed:'persisted-270',terrainGenerationVersion:4 as const};
  const key=terrainGenerationInputKey([],[],[],undefined,options),data=createSteppedTerrainData([],[],[],undefined,options);
  const house=sceneryHouseBlocks();
  return {revision:WORLD_SCENE_CACHE_REVISION,terrain:{key,data,renderMesh:compactTerrainRenderMesh(data)},scenery:{key:sceneryGenerationInputKey(key,[]),
    plan:{village:{x:40,z:0,width:7,depth:9},objects:[{id:'house',role:'house',x:40,y:1,z:0,width:7,depth:9,...house}]}}};
}
describe('disposable CPU scene cache',()=>{
  it('packs numeric buffers and a palette without changing coordinates or LOD identities',()=>{
    const source=fixture(),packed=packWorldSceneCache(source) as any;
    expect(packed.terrain.data.positions).toBeInstanceOf(Float64Array);
    expect(packed.terrain.data.indicesByMaterial.grass).toBeInstanceOf(Uint32Array);
    const restored=restoreWorldSceneCache(structuredClone(packed));
    expect(restored).toEqual(source);
    const object=restored!.scenery!.plan.objects[0]!;
    expect(object.distantVoxels.every(voxel=>object.voxels.includes(voxel))).toBe(true);
  });
  it.each(['coordinates','palette-index','block-index','indices','budget'])('rejects malformed packed %s',failure=>{
    const packed=packWorldSceneCache(fixture()) as any;
    if(failure==='coordinates')packed.coordinates=new Float64Array(1);
    if(failure==='palette-index')packed.styles[0]=0xffffffff;
    if(failure==='block-index')packed.scenery.plan.objects[0].voxels[0]=0xffffffff;
    if(failure==='indices')packed.terrain.data.indicesByMaterial.grass=new Int32Array(3);
    if(failure==='budget')packed.terrain.data.positions=new Float64Array(9_000_000);
    expect(restoreWorldSceneCache(packed)).toBeNull();
  });
  it('restores exact numeric geometry and shared near/far voxels',()=>{
    const source=fixture(),copy=structuredClone(source),restored=restoreWorldSceneCache(copy);
    expect(restored).toEqual(source);expect(restored).toBe(copy);
    expect(worldSceneCacheBytes(source)).toBeLessThan(WORLD_SCENE_CACHE_MAX_BYTES);
    const object=restored!.scenery!.plan.objects[0]!;
    expect(sceneryGeometryLayers(object)).not.toBeNull();
    expect(object.distantVoxels.every(voxel=>object.voxels.includes(voxel))).toBe(true);
  });
  it.each(['revision','position','index','bounds','tree','hydrology','scenery-key','voxel','mesh','oversize'])('rejects %s corruption before rendering',failure=>{
    const copy=fixture();
    if(failure==='revision')(copy as any).revision=0;
    if(failure==='position')copy.terrain.data.positions[0]=NaN;
    if(failure==='index')copy.terrain.data.indicesByMaterial.grass[0]=1e9;
    if(failure==='bounds')(copy.terrain.data as any).nearDetailBounds=null;
    if(failure==='tree')(copy.terrain.data as any).naturalTrees=[{x:0,y:null,z:0,scale:1}];
    if(failure==='hydrology')(copy.terrain.data.hydrology as any).terrainSurfaceArea=undefined;
    if(failure==='scenery-key')copy.scenery!.key='wrong';
    if(failure==='voxel')(copy.scenery!.plan.objects[0]!.voxels[0] as any).x=Infinity;
    if(failure==='mesh')copy.terrain.renderMesh!.triangleCount++;
    if(failure==='oversize')(copy.scenery!.plan as any).objects=Array(4097).fill(copy.scenery!.plan.objects[0]);
    expect(restoreWorldSceneCache(copy)).toBeNull();
  });
  it('footprints and ground inputs invalidate; titles, progress, texture and reward IDs do not',()=>{
    const reward={worldPosition:{x:40,y:3,z:9},footprint:{width:7,depth:8}};
    const base=sceneryGenerationInputKey('terrain',[reward]);
    expect(sceneryGenerationInputKey('terrain',[{...reward,worldPosition:{...reward.worldPosition,y:10}}])).toBe(base);
    expect(sceneryGenerationInputKey('terrain',[{...reward,footprint:{width:20,depth:8}}])).not.toBe(base);
    expect(sceneryGenerationInputKey('new-terrain',[reward])).not.toBe(base);
    const options={worldSeed:'a'};
    const key=terrainGenerationInputKey([],[],[],undefined,options);
    expect(terrainGenerationInputKey([],[],[{x:1,z:1,width:4,depth:4,groundLevel:1}],undefined,options)).not.toBe(key);
    expect(terrainGenerationInputKey([],[],[],undefined,{worldSeed:'b'})).not.toBe(key);
    expect(terrainGenerationInputKey([],[],[],undefined,{...options,refinedFar:true})).not.toBe(key);
  });
});
