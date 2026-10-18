import {expect,it} from 'vitest';
import {createSteppedTerrainData} from '../src/terrain';
import {TerrainSurfaceTable} from '../src/terrain-surface-table';

it('keeps valley dry banks grass/rock while retaining the river network',()=>{
  const terrain=createSteppedTerrainData([],[],[],undefined,{environmentStyle:'natural-valley',worldSeed:'world-default',terrainGenerationVersion:4,refinedFar:true});
  const surfaces=[...new TerrainSurfaceTable(terrain)];
  expect(surfaces.some(s=>s.water)).toBe(true);
  expect(terrain.hydrology.riverCellCount).toBeGreaterThan(0);
  expect(terrain.indicesByMaterial.dirt).toHaveLength(0);
  expect(surfaces.some(s=>!s.water&&s.material==='grass')).toBe(true);
  expect(surfaces.some(s=>!s.water&&s.material==='stone')).toBe(true);
},30_000);
