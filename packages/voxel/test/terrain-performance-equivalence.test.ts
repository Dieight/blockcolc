import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { alignWorldsToEnvironment, layoutWorlds } from '../src/renderer';
import { createSteppedTerrainData, settlementSupportHeightForPlacement, type TerrainEnvironmentStyle } from '../src/terrain';
import { roadCellsForVillage } from '../src/village';
import { compactTerrainRenderMesh } from '../src/terrain-render-mesh';

// Freeze the adopted v2.9.0 terrain, including the valley and island changes.
// Earlier fingerprints remain in the release and performance evidence.
const expected: Record<TerrainEnvironmentStyle, string> = {
  'classic-island': '666db51840cdcf6801f940269631f197cfb565fff9d28674b46cf03fc05aec3c',
  'natural-valley': '008791b75af39c6a70bc062a33314b93cfe6e474bd60f1db6c722b9dcdb574d2',
  'ocean-island': '939ccc6b9ccd6ba87ac2cb762dbf5bf3f2b69b2dc77b6f843ae6fecfc41daba7',
  'mosaic-coast': '9d4d1efcf359b410eb355e7b0fdf66f2f1b5e243a0db4c04a835cb843a89a618',
};
// Same adopted input; compaction must keep this render result deterministic.
const expectedMesh: Record<TerrainEnvironmentStyle,string> = {
  'classic-island':'4b15504628e8facf9373462147bee8d5d32ab2ad72e6e8a756501c0cad3bb184',
  'natural-valley':'b6536ab328ee73e0e0e41b5bf2cb38cfd9679ec01fe1870b0179691db0bd9a71',
  'ocean-island':'db1ca8bde89fd4b19d35205e5d91f1cde80fb5adaf50170b8b8eaffd7a71cd49',
  'mosaic-coast':'7f88f122d69816421735f71e9e379b7908bb262e6a9545cedd9266edaeb7ef10',
};

it.each(Object.keys(expected) as TerrainEnvironmentStyle[])('preserves the complete current %s terrain', style => {
  const worlds = alignWorldsToEnvironment(layoutWorlds([{
    projectId: 'terrain-audit-0', settlementIndex: 0, blueprintId: 'builtin-small-workshop',
    buildingCompletionBasisPoints: 5000, buildingConditionBasisPoints: 10000, isMonument: false,
  }]), style).map(w => ({ ...w, worldPosition: { ...w.worldPosition, y: settlementSupportHeightForPlacement(w, style) } }));
  const roads = roadCellsForVillage(worlds);
  const pads = worlds.map(w => ({ x: w.worldPosition.x, z: w.worldPosition.z,
    width: w.footprint.width, depth: w.footprint.depth, groundLevel: w.worldPosition.y }));
  const input = JSON.stringify([worlds, roads, pads]);
  const terrain = createSteppedTerrainData(worlds, roads, pads, undefined, {
    environmentStyle: style, worldSeed: 'world-default', terrainGenerationVersion: 4, refinedFar: true,
  });
  expect.soft(createHash('sha256').update(JSON.stringify(terrain)).digest('hex')).toBe(expected[style]);
  expect(createHash('sha256').update(JSON.stringify(compactTerrainRenderMesh(terrain))).digest('hex')).toBe(expectedMesh[style]);
  expect(JSON.stringify([worlds, roads, pads])).toBe(input);
}, 30_000);
