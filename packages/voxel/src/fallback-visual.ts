import type { BlueprintVoxel } from "./blueprint";
import { materialResponseForVoxel, type MaterialResponseKind } from "./material-response";
import {
  isOriginalMaterialPattern,
  originalPatternForBlockId,
  type OriginalMaterialPattern,
} from "./original-materials";

export interface FallbackVisualStyle {
  key: string;
  color: number;
  response: MaterialResponseKind;
  pattern: OriginalMaterialPattern;
  transparent: boolean;
  opacity: number;
}

const BASE_COLORS: Readonly<Record<string, number>> = {
  stone: 0x7f8b84,
  wood: 0x6f4e35,
  plank: 0xa9865d,
  roof: 0x6e3e32,
  glass: 0x8eb4b7,
  accent: 0xc3b18d,
};

const DYE_COLORS: Readonly<Record<string, number>> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da,
  yellow: 0xfed83d, lime: 0x80c71f, pink: 0xed8dac, gray: 0x474f52,
  light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
  brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};

const WOOD_COLORS: Readonly<Record<string, number>> = {
  pale_oak: 0xd6c6a5, dark_oak: 0x5d402b, mangrove: 0x8e3c50, cherry: 0xd98792,
  spruce: 0x76553c, birch: 0xd8c18b, jungle: 0xa97c55, acacia: 0xa85b36,
  bamboo: 0xc5a746, crimson: 0x6d2635, warped: 0x2d7d78, oak: 0xb68c55,
};

export function fallbackVisualStyleForVoxel(
  voxel: Pick<BlueprintVoxel, "materialId" | "sourceBlockId">,
): FallbackVisualStyle {
  const path = voxel.sourceBlockId?.toLowerCase().split(":").pop() ?? "";
  const dyed = Object.entries(DYE_COLORS).find(([name]) => path === name || path.startsWith(`${name}_`));
  const wood = Object.entries(WOOD_COLORS).find(([name]) => path === name || path.startsWith(`${name}_`));
  let color = BASE_COLORS[voxel.materialId] ?? 0xc3b18d;
  let response = materialResponseForVoxel(voxel);
  const pattern = originalPatternForBlockId(voxel.sourceBlockId, voxel.materialId);
  let transparent = voxel.materialId === "glass";
  let opacity = transparent ? 0.44 : 1;

  if (dyed && /(?:wool|carpet|concrete|terracotta|glazed_terracotta|glass|glass_pane|bed|banner|candle|shulker_box)/.test(path)) {
    color = dyed[1];
  } else if (wood && /(?:planks|log|wood|stem|hyphae|bamboo|shelf|bookshelf|door|trapdoor|fence|gate|sign|button|pressure_plate)/.test(path)) {
    color = wood[1];
    response = "wood";
  } else if (/(?:^|_)ore(?:_|$)/.test(path)) {
    color = oreColor(path);
  } else if (path.includes("copper")) {
    color = path.includes("oxidized") ? 0x51a68c
      : path.includes("weathered") ? 0x7c9b89
        : path.includes("exposed") ? 0xc27a4e
          : 0xb8673e;
    response = "metal";
  } else if (path.includes("resin")) {
    color = 0xd97845;
  } else if (path.includes("pale_moss")) {
    color = 0x72845d;
  } else if (path.includes("sculk")) {
    color = 0x165c63;
  } else if (path.includes("sulfur")) {
    color = 0xd6c653;
  } else if (path.includes("cinnabar")) {
    color = 0xa24b3d;
  } else if (path.includes("deepslate") || path.includes("blackstone") || path.includes("basalt")) {
    color = 0x4d5655;
  } else if (path.includes("tuff")) {
    color = 0x65756c;
  } else if (path.includes("granite")) {
    color = 0x9b6a5b;
  } else if (path.includes("diorite") || path.includes("calcite") || path.includes("quartz")) {
    color = 0xc9cbc3;
  } else if (path.includes("red_sandstone")) {
    color = 0xba7042;
  } else if (path.includes("sandstone") || path === "sand" || path.includes("end_stone")) {
    color = 0xcbb887;
  } else if (path.includes("andesite") || path.includes("stone") || path.includes("cobble")) {
    color = 0x7d8581;
  } else if (path.includes("nether_brick") || path.includes("netherrack")) {
    color = 0x74413f;
  } else if (path.includes("mud_brick") || path.includes("mud")) {
    color = 0x776453;
  } else if (path === "bricks" || path.includes("brick_block")) {
    color = 0x9d5c4c;
  } else if (path.includes("prismarine")) {
    color = 0x59988d;
  } else if (path.includes("purpur")) {
    color = 0x9d6d9d;
  } else if (path.includes("obsidian")) {
    color = 0x3d334c;
  } else if (path.includes("iron")) {
    color = 0xb7b9b2;
  } else if (path.includes("gold")) {
    color = 0xd6ad3f;
  } else if (path.includes("netherite")) {
    color = 0x4e474b;
  } else if (path === "cherry_leaves" || path === "flowering_azalea_leaves") {
    color = 0xe8a8c4;
  } else if (path.includes("spruce_leaves")) {
    color = 0x4d6e4e;
  } else if (path.includes("birch_leaves")) {
    color = 0x7d9449;
  } else if (path.includes("mangrove_leaves") || path.includes("jungle_leaves") || path.includes("dark_oak_leaves")) {
    color = 0x3f6b3f;
  } else if (/(?:grass|moss|leaves|vine|azalea|fern)/.test(path)) {
    color = 0x638453;
  } else if (/(?:dirt|podzol|mycelium|soul_soil)/.test(path)) {
    color = 0x79634e;
  } else if (/(?:sand|gravel)/.test(path)) {
    color = path.includes("red_") ? 0xb66c42 : 0xc7b88b;
  } else if (path.includes("snow")) {
    color = 0xe5ece8;
  }

  if (/(?:^|_)glass(?:_|$)|(?:^|_)ice(?:_|$)/.test(path)) {
    transparent = true;
    opacity = 0.44;
    response = "glass";
  }
  return {
    key: `fallback:${color.toString(16).padStart(6, "0")}:${response}:${pattern}:${transparent ? "t" : "o"}`,
    color,
    response,
    pattern,
    transparent,
    opacity,
  };
}

export function parseFallbackVisualKey(key: string): FallbackVisualStyle | undefined {
  const match = /^fallback:([0-9a-f]{6}):(default|stone|wood|metal|glass):([^:]+):(t|o)$/.exec(key);
  if (!match || !isOriginalMaterialPattern(match[3]!)) return undefined;
  const transparent = match[4] === "t";
  return {
    key,
    color: Number.parseInt(match[1]!, 16),
    response: match[2] as MaterialResponseKind,
    pattern: match[3],
    transparent,
    opacity: transparent ? 0.44 : 1,
  };
}

function oreColor(path: string): number {
  if (path.includes("coal")) return 0x5f625f;
  if (path.includes("iron")) return 0xa8927d;
  if (path.includes("gold")) return 0xc5a344;
  if (path.includes("redstone")) return 0x9f4d46;
  if (path.includes("diamond")) return 0x5ca6a1;
  if (path.includes("emerald")) return 0x57966b;
  if (path.includes("lapis")) return 0x526f9f;
  if (path.includes("copper")) return 0xa86e55;
  if (path.includes("quartz")) return 0xbda99a;
  return 0x7f827c;
}

export type StaticFluidKind = "water" | "lava";

export function staticFluidKind(voxel: Pick<BlueprintVoxel, "sourceBlockId">): StaticFluidKind | undefined {
  const id = voxel.sourceBlockId?.toLowerCase();
  return id === "minecraft:water" || id === "minecraft:bubble_column" ? "water"
    : id === "minecraft:lava" ? "lava"
      : undefined;
}

export function staticFluidHeight(voxel: Pick<BlueprintVoxel, "sourceBlockState">): number {
  const rawLevel = Number(voxel.sourceBlockState?.level ?? "0");
  const level = Number.isInteger(rawLevel) && rawLevel >= 0 && rawLevel <= 15 ? rawLevel : 0;
  if (level >= 8) return 0.9;
  return Math.max(0.2, 0.94 - level * 0.09);
}
