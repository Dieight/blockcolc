import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { alignWorldsToEnvironment, layoutWorlds } from '../src/renderer';
import { createSteppedTerrainData, settlementSupportHeightForPlacement, type TerrainEnvironmentStyle } from '../src/terrain';
import { roadCellsForVillage } from '../src/village';
import { compactTerrainRenderMesh } from '../src/terrain-render-mesh';

// v2.8.0 adopted appearance revision. Old performance-equivalence fingerprints
// remain in the 32-input audit and the pre-adoption baseline matrix. These
// Values freeze the current adopted inputs, not a claim of old/new equality.
// v2.9 changes only the valley: wider bench, far ridges, fewer rivers/cascades.
// Its previous v2.8 hashes stay in the release and initial feedback evidence.
const expected: Record<TerrainEnvironmentStyle, string> = {
  'classic-island': '666db51840cdcf6801f940269631f197cfb565fff9d28674b46cf03fc05aec3c',
  'natural-valley': '008791b75af39c6a70bc062a33314b93cfe6e474bd60f1db6c722b9dcdb574d2',
  'ocean-island': 'b920d6bbb257c6fa93de154f9b5c73a9dba6ae2de33863e1b0fcf96c778b2ae0',
  'mosaic-coast': '9d4d1efcf359b410eb355e7b0fdf66f2f1b5e243a0db4c04a835cb843a89a618',
};
// Same adopted input; compaction must keep this render result deterministic.
const expectedMesh: Record<TerrainEnvironmentStyle,string> = {
  'classic-island':'4b15504628e8facf9373462147bee8d5d32ab2ad72e6e8a756501c0cad3bb184',
  'natural-valley':'b6536ab328ee73e0e0e41b5bf2cb38cfd9679ec01fe1870b0179691db0bd9a71',
  'ocean-island':'cf9462dfa9769e29db9da6246ff535cef8d206c95eec222880f1f729012e7c84',
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
  expect(createHash('sha256').update(JSON.stringify(terrain)).digest('hex')).toBe(expected[style]);
  expect(createHash('sha256').update(JSON.stringify(compactTerrainRenderMesh(terrain))).digest('hex')).toBe(expectedMesh[style]);
  expect(JSON.stringify([worlds, roads, pads])).toBe(input);
}, 30_000);
