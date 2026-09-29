import type { ResourcePackManifest } from "@blockcolc/resource-pack";
import type { BlueprintVoxel } from "./blueprint";
import { createGeometryBatches, type GeometryVoxelBatch } from "./resource-geometry";
import type { ResourcePackAtlas } from "./resource-textures";

export interface NaturalFlowerPackPlan {
  batches: GeometryVoxelBatch[];
  packVoxels: BlueprintVoxel[];
  originalFallbackVoxels: BlueprintVoxel[];
}

/** Reuses the production geometry/atlas planner and atomically routes every unresolved flower voxel to the original fallback. */
export function planNaturalFlowerPackBatches(
  voxels: readonly BlueprintVoxel[],
  manifest: ResourcePackManifest | undefined,
  atlas: ResourcePackAtlas | undefined,
): NaturalFlowerPackPlan {
  if (!manifest || !atlas || voxels.length === 0) {
    return { batches: [], packVoxels: [], originalFallbackVoxels: [...voxels] };
  }
  const planned = createGeometryBatches(voxels, manifest, atlas);
  const packVoxels = [...new Set(planned.batches.flatMap(batch => batch.entries.map(entry => entry.voxel)))];
  const packSet = new Set(packVoxels);
  return {
    batches: planned.batches,
    packVoxels,
    originalFallbackVoxels: voxels.filter(voxel => !packSet.has(voxel)),
  };
}
