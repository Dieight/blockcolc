import type { BlueprintVoxel } from './blueprint';
import type { SceneryObject } from './scenery';

/** Keep each grove's instance bounds local so off-screen trees can be culled. */
export function chunkSceneryTrees(
  trees: readonly Pick<SceneryObject, 'x' | 'y' | 'z' | 'voxels'>[],
  side = 64,
  maxChunks = Infinity,
): ReadonlyMap<string, BlueprintVoxel[]> {
  if (!Number.isFinite(side) || side <= 0) throw new RangeError('Invalid grove chunk size');
  if (maxChunks !== Infinity && (!Number.isInteger(maxChunks) || maxChunks < 4)) throw new RangeError('Invalid grove chunk budget');
  let effectiveSide = side;
  const keyFor = (tree: Pick<SceneryObject, 'x' | 'z'>) => `${Math.floor(tree.x / effectiveSide)}:${Math.floor(tree.z / effectiveSide)}`;
  // Grow spatial buckets before expanding their voxel arrays. A finite grove
  // eventually fits the four origin quadrants; no trees or materials are cut.
  while (new Set(trees.map(keyFor)).size > maxChunks) {
    if (effectiveSide >= Number.MAX_VALUE / 2) throw new RangeError('Grove coordinates exceed chunk budget');
    effectiveSide *= 2;
  }
  const chunks = new Map<string, BlueprintVoxel[]>();
  for (const tree of trees) {
    const key = keyFor(tree);
    const voxels = chunks.get(key) ?? [];
    for (const voxel of tree.voxels) voxels.push({ ...voxel, x: voxel.x + tree.x, y: voxel.y + tree.y, z: voxel.z + tree.z });
    chunks.set(key, voxels);
  }
  return chunks;
}
