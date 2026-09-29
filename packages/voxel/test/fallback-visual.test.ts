import { describe, expect, it } from "vitest";
import {
  fallbackVisualStyleForOriginalComponent,
  fallbackVisualStyleForVoxel,
  parseFallbackVisualKey,
  staticFluidHeight,
  staticFluidKind,
} from "../src/fallback-visual";

describe("runtime fallback visuals", () => {
  it("keeps the new component families narrowly separated by color and surface role", () => {
    const carpet = fallbackVisualStyleForOriginalComponent({ materialId: "accent", sourceBlockId: "minecraft:red_carpet" }, "carpet");
    const moss = fallbackVisualStyleForOriginalComponent({ materialId: "accent", sourceBlockId: "minecraft:moss_carpet" }, "carpet");
    const leverBase = fallbackVisualStyleForOriginalComponent({ materialId: "plank", sourceBlockId: "minecraft:lever" }, "lever-base");
    const leverHandle = fallbackVisualStyleForOriginalComponent({ materialId: "plank", sourceBlockId: "minecraft:lever" }, "lever-handle");
    const frame = fallbackVisualStyleForOriginalComponent({ materialId: "stone", sourceBlockId: "minecraft:soul_lantern" }, "lantern-frame");
    const warmCore = fallbackVisualStyleForOriginalComponent({ materialId: "stone", sourceBlockId: "minecraft:lantern" }, "lantern-core-warm");
    const soulCore = fallbackVisualStyleForOriginalComponent({ materialId: "stone", sourceBlockId: "minecraft:soul_lantern" }, "lantern-core-soul");
    expect(carpet).toMatchObject({ color: 0xb02e26, pattern: "fabric", response: "default", transparent: false });
    expect(moss).toMatchObject({ pattern: "foliage", response: "default", transparent: false });
    expect(leverBase).toMatchObject({ pattern: "stone", response: "stone" });
    expect(leverHandle).toMatchObject({ pattern: "bark", response: "wood" });
    expect(frame).toMatchObject({ pattern: "metal", response: "metal" });
    expect(warmCore).toMatchObject({ color: 0xffc66a, pattern: "emissive", transparent: false });
    expect(soulCore).toMatchObject({ color: 0x65cfe3, pattern: "emissive", transparent: false });
    expect(new Set([carpet.key, moss.key, leverBase.key, leverHandle.key, frame.key, warmCore.key, soulCore.key]).size).toBe(7);
  });

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

  it("keeps six mineral/metal button and plate visuals distinct from wooden components", () => {
    for (const id of ["minecraft:stone_button", "minecraft:stone_pressure_plate"]) {
      expect(fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: id })).toMatchObject({
        color: 0x7d8581, pattern: "stone", response: "stone", transparent: false,
      });
    }
    for (const id of ["minecraft:polished_blackstone_button", "minecraft:polished_blackstone_pressure_plate"]) {
      expect(fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: id })).toMatchObject({
        color: 0x4d5655, pattern: "stone", response: "stone", transparent: false,
      });
    }
    expect(fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:light_weighted_pressure_plate" }))
      .toMatchObject({ color: 0xd6ad3f, pattern: "metal", response: "metal" });
    expect(fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:heavy_weighted_pressure_plate" }))
      .toMatchObject({ color: 0xb7b9b2, pattern: "metal", response: "metal" });

    for (const id of ["example:stone_button", "example:polished_blackstone_pressure_plate", "example:light_weighted_pressure_plate", "example:heavy_weighted_pressure_plate"]) {
      const style = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: id });
      expect(style).toMatchObject({ color: 0xa9865d, pattern: "planks", response: "wood" });
    }
  });

  it("uses the semantic fallback for modded exact component paths across material identities", () => {
    for (const id of ["stone_button", "stone_pressure_plate", "polished_blackstone_button", "polished_blackstone_pressure_plate", "light_weighted_pressure_plate", "heavy_weighted_pressure_plate"]) {
      for (const materialId of ["stone", "accent", "glass"] as const) {
        const modded = fallbackVisualStyleForVoxel({ materialId, sourceBlockId: `example:${id}` });
        const semantic = fallbackVisualStyleForVoxel({ materialId });
        expect(modded).toEqual(semantic);
      }
    }
  });

  it("retains thirteen separate wood button palettes and the shared original planks pattern", () => {
    const woodIds = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "bamboo", "crimson", "warped", "pale_oak", "poplar"];
    const styles = woodIds.map((wood) => fallbackVisualStyleForVoxel({
      materialId: "plank",
      sourceBlockId: `minecraft:${wood}_button`,
    }));
    expect(new Set(styles.map(({ color }) => color)).size).toBe(13);
    expect(styles.every(({ pattern, response }) => pattern === "planks" && response === "wood")).toBe(true);
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

  it("covers the Minecraft 26.3 poplar, shrub, mushroom, cushion and straw visual families", () => {
    const red = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:red_poplar_leaves" });
    const orange = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:orange_poplar_leaves" });
    const yellow = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:yellow_poplar_leaves" });
    const shrub = fallbackVisualStyleForVoxel({ materialId: "plank", sourceBlockId: "minecraft:red_shrub" });
    const shelfMushroom = fallbackVisualStyleForVoxel({ materialId: "accent", sourceBlockId: "minecraft:shelf_mushroom" });
    const strawBed = fallbackVisualStyleForVoxel({ materialId: "accent", sourceBlockId: "minecraft:straw_bed" });
    const cushion = fallbackVisualStyleForVoxel({ materialId: "accent", sourceBlockId: "minecraft:red_cushion" });

    expect(new Set([red.color, orange.color, yellow.color]).size).toBe(3);
    expect([red, orange, yellow].every((style) => style.pattern === "foliage")).toBe(true);
    expect(shrub).toMatchObject({ color: 0xb74d3e, pattern: "foliage" });
    expect(shelfMushroom).toMatchObject({ color: 0x9c634a, pattern: "mushroom" });
    expect(strawBed).toMatchObject({ color: 0xc4a64c, pattern: "straw" });
    expect(cushion).toMatchObject({ color: 0xb02e26, pattern: "fabric" });
  });

  it("classifies static fluids and keeps falling levels lower than source blocks", () => {
    expect(staticFluidKind({ sourceBlockId: "minecraft:water" })).toBe("water");
    expect(staticFluidKind({ sourceBlockId: "minecraft:bubble_column" })).toBe("water");
    expect(staticFluidKind({ sourceBlockId: "minecraft:lava" })).toBe("lava");
    expect(staticFluidKind({ sourceBlockId: "minecraft:stone" })).toBeUndefined();
    expect(staticFluidHeight({ sourceBlockState: { level: "0" } })).toBe(8 / 9);
    expect(staticFluidHeight({ sourceBlockState: { level: "7" } })).toBe(1 / 9);
    expect(staticFluidHeight({ sourceBlockState: { level: "8" } })).toBe(8 / 9);
  });
});
