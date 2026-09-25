import { describe, expect, it } from 'vitest';
import type { BlueprintV1 } from '@tomato-clock/voxel';
import { shouldPersistBlueprintSnapshot, toImportedBlueprint } from './blueprint-adapter';

describe('blueprint persistence at project creation', () => {
  it('keeps supplemental packaged blueprints and user imports in the project, but not permanent core catalog entries', () => {
    expect(shouldPersistBlueprintSnapshot('builtin-small-workshop')).toBe(false);
    expect(shouldPersistBlueprintSnapshot('builtin-local-wqh-duck')).toBe(true);
    expect(shouldPersistBlueprintSnapshot('imported-house')).toBe(true);
  });

  it('stores a self-contained staged snapshot instead of relying on a future asset bundle', () => {
    const blueprint: BlueprintV1 = {
      schemaVersion: 1, id: 'builtin-local-house', title: '本地建筑',
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: 'plank', buildOrder: 4000, sourceBlockId: 'minecraft:oak_planks' }],
    };
    const stored = toImportedBlueprint(blueprint);
    expect(stored.voxels[0]).toMatchObject({ stage: 'walls', sourceBlockId: 'minecraft:oak_planks' });
    expect(blueprint.voxels[0]).not.toHaveProperty('stage');
  });
});
