import {describe,it,expect} from 'vitest';
import {valleyWaterfallFaces,createValleyWaterfallMesh} from '../src/terrain-waterfalls';
import {createSteppedTerrainData} from '../src/terrain';
import {terrainSurfaceTable,type ScenerySurface} from '../src/terrain-surface-table';
const cell=(minX:number,maxX:number,minZ:number,maxZ:number,supportY:number,water=true):ScenerySurface=>({minX,maxX,minZ,maxZ,supportY,water,material:water?'water':'stone'});
describe('valley cascades',()=>{
  it('connects actual shared water edges down to their lower pool in either direction',()=>{
    for(const top of [10,0]){
      const [face]=valleyWaterfallFaces([cell(0,2,0,2,top),cell(2,4,0,2,10-top)]);
      expect(face).toEqual({axis:'x',line:2,start:0,end:2,top:9.5,bottom:-.5,direction:top===10?1:-1});
      const mesh=createValleyWaterfallMesh([face!],{value:0})!;
      expect(mesh.geometry.getAttribute('position').count).toBe(4);expect(mesh.receiveShadow).toBe(true);expect(mesh.castShadow).toBe(false);
      mesh.geometry.dispose();(mesh.material as {dispose():void}).dispose();
    }
  });
  it('does not bridge gaps, dry cliffs, large LOD water tiles or flat river reaches',()=>{
    const a=cell(0,2,0,2,10);
    for(const b of [cell(3,5,0,2,0),cell(2,4,0,2,0,false),cell(2,10,0,8,0),cell(2,4,0,2,9)])expect(valleyWaterfallFaces([a,b])).toHaveLength(0);
  });
  it('keeps the river drainage downhill and produces at least one real steep drop for the review seed',()=>{
    const terrain=createSteppedTerrainData([],[],[],undefined,{environmentStyle:'natural-valley',worldSeed:'world-default'});
    expect(terrain.hydrology.maxUphillWaterStep).toBe(0);expect(terrain.hydrology.networkCount).toBeLessThanOrEqual(2);expect(terrain.hydrology.basinCount).toBeLessThanOrEqual(1);
    const faces=valleyWaterfallFaces(terrainSurfaceTable(terrain));
    expect(faces.length).toBeGreaterThan(0);expect(Math.max(...faces.map(f=>f.top-f.bottom))).toBeGreaterThanOrEqual(4);
  },30000);
});
