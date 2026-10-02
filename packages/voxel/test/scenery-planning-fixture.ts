import { alignWorldsToEnvironment, layoutWorlds, terrainSurfaceRectangles } from '../src/renderer';
import { createSteppedTerrainData, type TerrainEnvironmentStyle, type TerrainGenerationVersion } from '../src/terrain';
import { roadCellsForVillage } from '../src/village';

export const SCENERY_PLANNING_CASES = [
  { style: 'natural-valley', count: 1, version: 4 },
  { style: 'classic-island', count: 1, version: 4 },
  { style: 'ocean-island', count: 1, version: 4 },
  { style: 'natural-valley', count: 7, version: 4 },
  { style: 'ocean-island', count: 12, version: 4 },
  { style: 'natural-valley', count: 1, version: 3 },
] as const;

export function sceneryPlanningFixture(style: TerrainEnvironmentStyle, count: number, version: TerrainGenerationVersion) {
  const worlds = alignWorldsToEnvironment(layoutWorlds(Array.from({ length: count }, (_, settlementIndex) => ({
    projectId: `scenery-snapshot-${settlementIndex}`, settlementIndex, blueprintId: 'builtin-small-workshop',
    buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false,
  }))), style);
  const roads = roadCellsForVillage(worlds);
  const pads = worlds.map(world => ({ x: world.worldPosition.x, z: world.worldPosition.z,
    width: world.footprint.width, depth: world.footprint.depth, groundLevel: world.worldPosition.y }));
  const terrain = createSteppedTerrainData(worlds, roads, pads, undefined, {
    environmentStyle: style, worldSeed: 'world-default', terrainGenerationVersion: version, refinedFar: false,
  });
  return { environmentStyle: style, worldSeed: 'world-default', surfaces: terrainSurfaceRectangles(terrain),
    trees: terrain.naturalTrees, roads, protectedRects: worlds.map(world => ({ x: world.worldPosition.x,
      z: world.worldPosition.z, width: world.footprint.width + 5, depth: world.footprint.depth + 5 })) };
}
