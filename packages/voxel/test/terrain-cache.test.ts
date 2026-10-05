import { expect, it } from 'vitest';
import { alignWorldsToEnvironment, layoutWorlds } from '../src/renderer';
import { createSteppedTerrainData } from '../src/terrain';
import { roadCellsForVillage } from '../src/village';
import { terrainGeometryBytes, TERRAIN_CACHE_BYTES } from '../src/terrain-cache';

it('retains the current 24-building regional layout within a bounded geometry budget', () => {
  const worlds = alignWorldsToEnvironment(layoutWorlds(Array.from({ length: 24 }, (_, i) => ({
    projectId: `p-${i}`, settlementIndex: i, blueprintId: 'builtin-small-workshop',
    buildingCompletionBasisPoints: 5000, buildingConditionBasisPoints: 10000, isMonument: false,
  }))), 'mosaic-coast');
  const roads = roadCellsForVillage(worlds);
  const pads = worlds.map(w => ({ x:w.worldPosition.x, z:w.worldPosition.z, width:w.footprint.width, depth:w.footprint.depth, groundLevel:w.worldPosition.y }));
  const terrain = createSteppedTerrainData(worlds, roads, pads, undefined, {
    environmentStyle: 'mosaic-coast', worldSeed: 'mosaic-coast-regression', terrainGenerationVersion: 4, refinedFar: false,
  });
  const bytes = terrainGeometryBytes(terrain);
  expect(bytes, `24-building geometry: ${bytes} bytes`).toBeLessThanOrEqual(TERRAIN_CACHE_BYTES);
  expect(TERRAIN_CACHE_BYTES).toBeLessThanOrEqual(32 * 1024 * 1024);
}, 30_000);
