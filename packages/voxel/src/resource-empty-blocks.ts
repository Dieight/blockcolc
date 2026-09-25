import type { BlueprintVoxel } from "./blueprint";

const INVISIBLE_BLOCK_IDS = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:barrier",
  "minecraft:light",
  "minecraft:moving_piston",
  "minecraft:structure_void",
]);

/**
 * Java's empty models are not solid cubes. This is only consulted after a
 * resource pack fails to supply an actual model, so a user override still wins.
 */
export function isVisuallyEmptyVanillaBlock(
  voxel: Pick<BlueprintVoxel, "sourceBlockId" | "sourceBlockState">,
): boolean {
  const id = voxel.sourceBlockId;
  if (!id?.startsWith("minecraft:")) return false;
  if (INVISIBLE_BLOCK_IDS.has(id)) return true;
  const state = voxel.sourceBlockState;
  if (id === "minecraft:pitcher_crop") {
    return state?.half === "upper" && ["0", "1", "2"].includes(state.age ?? "");
  }
  if (!id.endsWith("_wall")) return false;
  return state?.up === "false"
    && ["north", "south", "west", "east"].every((face) => state[face] === "none");
}
