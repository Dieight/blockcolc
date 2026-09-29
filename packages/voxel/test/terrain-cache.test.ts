import { describe, expect, it } from 'vitest';
import { terrainGenerationInputKey, type TerrainEnvironmentStyle, type TerrainGenerationVersion, type TerrainPad } from '../src/terrain';
import type { VillagePlacement } from '../src/village';

const placement: VillagePlacement = {
  settlementIndex: 0,
  worldPosition: { x: 12, y: 4, z: -8 },
  rotationY: 0,
  footprint: { width: 9, depth: 11 },
  blueprintOffset: { x: 0, z: 0 },
  entrance: { x: 0, z: 5 },
};
const pad: TerrainPad = { x: 12, z: -8, width: 9, depth: 11, groundLevel: 4 };
type TerrainOptions = { environmentStyle: TerrainEnvironmentStyle; worldSeed: string; terrainGenerationVersion: TerrainGenerationVersion; refinedFar: boolean };
const key = (place = placement, roads = [{ x: 1, z: 2 }], pads = [pad],
  minimumRadius: { x: number; z: number } | undefined = undefined,
  options: TerrainOptions = { environmentStyle: 'natural-valley', worldSeed: 'seed', terrainGenerationVersion: 4, refinedFar: true }) =>
  terrainGenerationInputKey([place], roads, pads, minimumRadius, options);

describe('terrain generation reuse key', () => {
  it('ignores non-spatial building data', () => {
    expect(key({ ...placement, rotationY: 1, entrance: { x: 4, z: 3 }, settlementIndex: 8 })).toBe(key());
  });

  it('invalidates on each terrain-relevant spatial and generation input', () => {
    const base = key();
    expect(key({ ...placement, worldPosition: { ...placement.worldPosition, x: 13 } })).not.toBe(base);
    expect(key({ ...placement, worldPosition: { ...placement.worldPosition, y: 5 } })).not.toBe(base);
    expect(key({ ...placement, footprint: { ...placement.footprint, depth: 12 } })).not.toBe(base);
    expect(key(placement, [{ x: 2, z: 2 }])).not.toBe(base);
    expect(key(placement, [{ x: 1, z: 2 }], [{ ...pad, groundLevel: 5 }])).not.toBe(base);
    expect(key(placement, [{ x: 1, z: 2 }], [pad], { x: 64, z: 64 })).not.toBe(base);
    expect(key(placement, [{ x: 1, z: 2 }], [pad], undefined, { environmentStyle: 'natural-valley', worldSeed: 'other', terrainGenerationVersion: 4, refinedFar: true })).not.toBe(base);
    expect(key(placement, [{ x: 1, z: 2 }], [pad], undefined, { environmentStyle: 'classic-island', worldSeed: 'seed', terrainGenerationVersion: 4, refinedFar: true })).not.toBe(base);
    expect(key(placement, [{ x: 1, z: 2 }], [pad], undefined, { environmentStyle: 'natural-valley', worldSeed: 'seed', terrainGenerationVersion: 3, refinedFar: true })).not.toBe(base);
    expect(key(placement, [{ x: 1, z: 2 }], [pad], undefined, { environmentStyle: 'natural-valley', worldSeed: 'seed', terrainGenerationVersion: 4, refinedFar: false })).not.toBe(base);
  });
});
