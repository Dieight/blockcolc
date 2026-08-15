import { describe, expect, it } from "vitest";
import {
  fallbackVisualStyleForVoxel,
  parseFallbackVisualKey,
  staticFluidHeight,
  staticFluidKind,
} from "../src/fallback-visual";

describe("runtime fallback visuals", () => {
  it("derives dye, wood, copper and glass response without changing blueprint material IDs", () => {
    const redGlass = fallbackVisualStyleForVoxel({ materialId: "glass", sourceBlockId: "minecraft:red_stained_glass" });
    const oak = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:oak_shelf" });
    const warped = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:warped_shelf" });
    const copper = fallbackVisualStyleForVoxel({ materialId: "roof", sourceBlockId: "minecraft:waxed_oxidized_copper_bulb" });

    expect(redGlass).toMatchObject({ color: 0xb02e26, response: "glass", transparent: true });
    expect(redGlass.pattern).toBe("glass");
    expect(oak.pattern).toBe("planks");
    expect(oak.color).not.toBe(warped.color);
    expect(copper).toMatchObject({ color: 0x51a68c, response: "metal", transparent: false });
    expect(parseFallbackVisualKey(redGlass.key)).toEqual(redGlass);
  });

  it("uses distinct original palettes for common stone and ore families", () => {
    const sandstone = fallbackVisualStyleForVoxel({ materialId: "stone", sourceBlockId: "minecraft:sandstone" });
    const deepslate = fallbackVisualStyleForVoxel({ materialId: "stone", sourceBlockId: "minecraft:deepslate_tiles" });
    const diamondOre = fallbackVisualStyleForVoxel({ materialId: "stone", sourceBlockId: "minecraft:diamond_ore" });

    expect(sandstone).toMatchObject({ color: 0xcbb887, pattern: "stone" });
    expect(deepslate).toMatchObject({ color: 0x4d5655, pattern: "brick" });
    expect(diamondOre).toMatchObject({ color: 0x5ca6a1, pattern: "ore" });
    expect(new Set([sandstone.key, deepslate.key, diamondOre.key]).size).toBe(3);
  });

  it("keeps leaf families distinct instead of one green foliage color", () => {
    const cherry = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:cherry_leaves" });
    const azalea = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:flowering_azalea_leaves" });
    const oak = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:oak_leaves" });
    const spruce = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:spruce_leaves" });

    expect(cherry).toMatchObject({ color: 0xe8a8c4, pattern: "foliage" });
    expect(azalea.color).toBe(0xe8a8c4);
    expect(oak).toMatchObject({ color: 0x638453, pattern: "foliage" });
    expect(spruce.color).toBe(0x4d6e4e);
    expect(new Set([cherry.key, oak.key, spruce.key]).size).toBe(3);
  });

  it("classifies static fluids and keeps falling levels lower than source blocks", () => {
    expect(staticFluidKind({ sourceBlockId: "minecraft:water" })).toBe("water");
    expect(staticFluidKind({ sourceBlockId: "minecraft:bubble_column" })).toBe("water");
    expect(staticFluidKind({ sourceBlockId: "minecraft:lava" })).toBe("lava");
    expect(staticFluidKind({ sourceBlockId: "minecraft:stone" })).toBeUndefined();
    expect(staticFluidHeight({ sourceBlockState: { level: "0" } })).toBe(0.94);
    expect(staticFluidHeight({ sourceBlockState: { level: "7" } })).toBeLessThan(0.4);
    expect(staticFluidHeight({ sourceBlockState: { level: "8" } })).toBe(0.9);
  });
});
