import type { BlueprintVoxel, MaterialId } from "./blueprint";

export type MaterialResponseKind = "default" | "stone" | "wood" | "metal" | "glass";

export interface MaterialResponse {
  roughness: number;
  metalness: number;
}

export const MATERIAL_RESPONSES: Readonly<Record<MaterialResponseKind, MaterialResponse>> = {
  default: { roughness: 0.9, metalness: 0 },
  stone: { roughness: 0.96, metalness: 0 },
  wood: { roughness: 0.82, metalness: 0 },
  metal: { roughness: 0.5, metalness: 0.32 },
  glass: { roughness: 0.16, metalness: 0 },
};

const METAL_BLOCK = /(?:^|:)(?:.*_)?(?:iron|gold|copper|netherite)(?:_|$)|(?:^|:)(?:anvil|chain|hopper|cauldron|bell|lantern|rail|lightning_rod)(?:$|_)/;
const GLASS_BLOCK = /(?:^|:)(?:.*_)?(?:glass|ice)(?:$|_)/;
const WOOD_BLOCK = /(?:^|:)(?:.*_)?(?:log|wood|planks|stem|hyphae|bamboo|bookshelf|barrel|chest)(?:$|_)/;
const STONE_BLOCK = /(?:^|:)(?:.*_)?(?:stone|cobblestone|deepslate|tuff|brick|concrete|terracotta|quartz|sandstone|basalt|blackstone|netherrack|ore)(?:$|_)/;

export function materialResponseForVoxel(voxel: Pick<BlueprintVoxel, "materialId" | "sourceBlockId">): MaterialResponseKind {
  const source = voxel.sourceBlockId?.toLowerCase() ?? "";
  if (source && GLASS_BLOCK.test(source)) return "glass";
  if (source && METAL_BLOCK.test(source)) return "metal";
  if (source && WOOD_BLOCK.test(source)) return "wood";
  if (source && STONE_BLOCK.test(source)) return "stone";
  return materialResponseForMaterialId(voxel.materialId);
}

export function materialResponseForMaterialId(materialId: MaterialId | string): MaterialResponseKind {
  if (materialId === "glass") return "glass";
  if (materialId === "stone") return "stone";
  if (materialId === "wood" || materialId === "plank" || materialId === "roof") return "wood";
  return "default";
}

export function materialResponse(kind: MaterialResponseKind): MaterialResponse {
  return MATERIAL_RESPONSES[kind];
}

export function materialResponseCode(kind: MaterialResponseKind): number {
  return kind === "stone" ? 1 : kind === "wood" ? 2 : kind === "metal" ? 3 : kind === "glass" ? 4 : 0;
}
