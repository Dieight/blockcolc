import { expect, it } from 'vitest';
import { createMosaicSeabed } from '../src/mosaic-seabed';
import { mosaicSeabedHeight } from '../src/mosaic-terrain';
import { createSteppedTerrainData } from '../src/terrain';

it('matches water quads only and samples a continuous, non-flat underwater shelf',()=>{
  const sea={minX:70,maxX:110,minZ:-150,maxZ:-110,supportY:0,water:true};
  const data=createMosaicSeabed([sea,{...sea,minX:0,maxX:12,water:false}],1234,26);
  expect(data.indices.length).toBe(25*6);expect(data.positions.length/3).toBe(100);
  const heights=new Set(data.positions.filter((_v,i)=>i%3===1).map(y=>Math.round(y*10)));
  expect(heights.size).toBeGreaterThan(4);
  for(let i=0;i<data.positions.length;i+=3){const [x,y,z]=data.positions.slice(i,i+3);
    expect(x).toBeGreaterThanOrEqual(sea.minX);expect(x).toBeLessThanOrEqual(sea.maxX);
    expect(y).toBeCloseTo(mosaicSeabedHeight(x!,z!,1234,26));expect(y).toBeLessThan(-4);
    expect(Math.hypot(...data.normals.slice(i,i+3))).toBeCloseTo(1);
  }
  expect(createMosaicSeabed([sea],1234,26)).toEqual(data);
});

it('does not build shallow dirt fences between equal-height transparent water cells', () => {
  const terrain = createSteppedTerrainData([], [], [{ x: 0, z: 0, width: 20, depth: 20, groundLevel: 6 }], undefined,
    { environmentStyle: 'mosaic-coast', worldSeed: 'water-neighbour-regression', terrainGenerationVersion: 4 });
  expect(terrain.indicesByMaterial.water.length).toBeGreaterThan(0);
  const waterBounds: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  for (let offset = 0; offset < terrain.indicesByMaterial.water.length; offset += 6) {
    const points = terrain.indicesByMaterial.water.slice(offset, offset + 6).map(index =>
      ({ x: terrain.positions[index * 3]!, z: terrain.positions[index * 3 + 2]! }));
    waterBounds.push({ minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
      minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z)) });
  }
  const waterAt = (x: number, z: number) => waterBounds.some(b => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  const fences: number[][] = [];
  for (const indices of Object.values(terrain.sideIndices)) for (let offset = 0; offset < indices.length; offset += 6) {
    const heights = indices.slice(offset, offset + 6).map(index => terrain.positions[index * 3 + 1]!);
    const low = Math.min(...heights), high = Math.max(...heights);
    if (Math.abs(low + .5) < .001 && Math.abs(high + .34) < .001) {
      const points = indices.slice(offset, offset + 6).map(index =>
        ({ x: terrain.positions[index * 3]!, z: terrain.positions[index * 3 + 2]! }));
      const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
      const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
      const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
      // A genuine zero-height dry shore still needs its side. Only two wet
      // neighbours must meet without a fictitious strip of dirt between them.
      const dx = minX === maxX ? .05 : 0, dz = minZ === maxZ ? .05 : 0;
      if (waterAt(x - dx, z - dz) && waterAt(x + dx, z + dz)) {
        fences.push(indices.slice(offset, offset + 6).flatMap(index => terrain.positions.slice(index * 3, index * 3 + 3)));
      }
    }
  }
  expect(fences).toEqual([]);
});
