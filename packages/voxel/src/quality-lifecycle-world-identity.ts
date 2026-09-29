import type { WorldSnapshot } from "./renderer";

/** Small, non-secret identity for the exact world projection consumed by a renderer. */
export function qualityLifecycleWorldIdentity(
  worlds: readonly WorldSnapshot[],
  worldSeed: string | undefined,
  environmentStyle: string,
  terrainGenerationVersion: number | undefined,
): number {
  const identity = JSON.stringify({
    worldSeed: worldSeed ?? "",
    environmentStyle,
    terrainGenerationVersion: terrainGenerationVersion ?? 0,
    worlds: worlds.map((world) => ({
      projectId: world.projectId,
      blueprintId: world.blueprintId,
      buildingCompletionBasisPoints: world.buildingCompletionBasisPoints,
      buildingConditionBasisPoints: world.buildingConditionBasisPoints,
      isMonument: world.isMonument,
      isActive: world.isActive === true,
      settlementIndex: world.settlementIndex,
      decorationDates: world.decorationDates ?? [],
      importedDecorations: (world.importedDecorations ?? []).map((decoration) => ({
        rewardId: decoration.rewardId,
        resourceId: decoration.resourceId,
        date: decoration.date,
        localPosition: decoration.localPosition,
        rotationQuarterTurns: decoration.rotationQuarterTurns,
        voxelCount: decoration.blueprint.voxels.length,
        bounds: decoration.blueprint.bounds,
      })),
    })),
  });
  const hash32 = (seed: number) => {
    let hash = seed;
    for (let index = 0; index < identity.length; index += 1) {
      hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
    }
    return hash >>> 0;
  };
  // Combine independent 32-bit FNV streams into a safe-integer 53-bit value.
  return (hash32(0x9e3779b9) & 0x1fffff) * 0x1_0000_0000 + hash32(0x811c9dc5);
}
