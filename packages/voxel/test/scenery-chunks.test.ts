import { describe, expect, it } from 'vitest';
import { chunkSceneryTrees } from '../src/scenery-chunks';
import type { BlueprintVoxel } from '../src/blueprint';

describe('local grove bounds', () => {
  const voxel: BlueprintVoxel = { x: 1, y: 2, z: -3, materialId: 'wood', sourceBlockId: 'minecraft:oak_log', buildOrder: 0 };
  const trees = [
    { x: 3, y: 7, z: 9, voxels: [voxel] },
    { x: 65, y: 4, z: 9, voxels: [voxel] },
    { x: -2, y: 2, z: -65, voxels: [voxel] },
  ];
  it('preserves every block, material and exact world coordinate without editing source trees', () => {
    expect([...chunkSceneryTrees(trees).values()].flat()).toEqual(trees.map(tree => ({
      ...voxel, x: voxel.x + tree.x, y: voxel.y + tree.y, z: voxel.z + tree.z,
    })));
    expect(trees[0]!.voxels[0]).toEqual(voxel);
  });
  it('separates distant bounds and handles negative coordinates deterministically', () => {
    expect([...chunkSceneryTrees(trees).keys()]).toEqual(['0:0', '1:0', '-1:-2']);
    expect([...chunkSceneryTrees(trees)]).toEqual([...chunkSceneryTrees(trees)]);
    expect([...chunkSceneryTrees(trees, 128).values()].map(cells => cells.length)).toEqual([2, 1]);
  });
  it('rejects unusable chunk sizes and accepts an empty grove', () => {
    for (const size of [0, -1, NaN, Infinity]) expect(() => chunkSceneryTrees(trees, size)).toThrow(RangeError);
    expect(chunkSceneryTrees([]).size).toBe(0);
  });
  it('bounds imported-material grove batches without dropping blocks or merging their materials', () => {
    const spread = Array.from({ length: 30 }, (_, index) => ({
      x: (index % 6 - 3) * 97, y: index, z: (Math.floor(index / 6) - 2) * 113,
      voxels: [{ ...voxel, sourceBlockId: index % 2 ? 'minecraft:birch_log' : 'minecraft:oak_log' }],
    }));
    const chunks = chunkSceneryTrees(spread, 64, 4);
    expect(chunks.size).toBeLessThanOrEqual(4);
    const key = (cell: BlueprintVoxel) => `${cell.x}:${cell.y}:${cell.z}:${cell.sourceBlockId}`;
    expect([...chunks.values()].flat().map(key).sort()).toEqual(spread.map(tree => key({
      ...tree.voxels[0]!, x: tree.x + voxel.x, y: tree.y + voxel.y, z: tree.z + voxel.z,
    })).sort());
    for (const budget of [0, 3, 4.5, NaN]) expect(() => chunkSceneryTrees(spread, 64, budget)).toThrow(RangeError);
  });
});
