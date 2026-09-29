import { describe, expect, it } from "vitest";
import { MATERIAL_RESPONSES, materialResponseForMaterialId, materialResponseForVoxel } from "../src/material-response";

describe("V4 restrained material response", () => {
  it("classifies Minecraft source blocks before semantic fallback materials", () => {
    expect(materialResponseForVoxel({ materialId: "accent", sourceBlockId: "minecraft:iron_block" })).toBe("metal");
    expect(materialResponseForVoxel({ materialId: "accent", sourceBlockId: "minecraft:oak_planks" })).toBe("wood");
    expect(materialResponseForVoxel({ materialId: "accent", sourceBlockId: "minecraft:stone_bricks" })).toBe("stone");
    expect(materialResponseForVoxel({ materialId: "accent", sourceBlockId: "minecraft:tinted_glass" })).toBe("glass");
  });

  it("keeps exact vanilla lantern frames metallic and leaves modded IDs on semantic material", () => {
    expect(materialResponseForVoxel({ materialId: "wood", sourceBlockId: "minecraft:lantern" })).toBe("metal");
    expect(materialResponseForVoxel({ materialId: "wood", sourceBlockId: "minecraft:soul_lantern" })).toBe("metal");
    expect(materialResponseForVoxel({ materialId: "wood", sourceBlockId: "mod:lantern" })).toBe("wood");
  });

  it("resolves only exact vanilla stone and weighted button/plate responses", () => {
    for (const id of ["minecraft:stone_button", "minecraft:stone_pressure_plate", "minecraft:polished_blackstone_button", "minecraft:polished_blackstone_pressure_plate"]) {
      expect(materialResponseForVoxel({ materialId: "plank", sourceBlockId: id })).toBe("stone");
    }
    expect(materialResponseForVoxel({ materialId: "plank", sourceBlockId: "minecraft:light_weighted_pressure_plate" })).toBe("metal");
    expect(materialResponseForVoxel({ materialId: "plank", sourceBlockId: "minecraft:heavy_weighted_pressure_plate" })).toBe("metal");
    for (const id of ["example:stone_button", "example:polished_blackstone_pressure_plate", "example:light_weighted_pressure_plate", "example:heavy_weighted_pressure_plate"]) {
      expect(materialResponseForVoxel({ materialId: "plank", sourceBlockId: id })).toBe("wood");
    }
  });

  it("keeps native material families consistent and deliberately restrained", () => {
    expect(materialResponseForMaterialId("roof")).toBe("wood");
    expect(MATERIAL_RESPONSES.stone.roughness).toBeGreaterThan(MATERIAL_RESPONSES.wood.roughness);
    expect(MATERIAL_RESPONSES.metal.metalness).toBeGreaterThan(0);
    expect(MATERIAL_RESPONSES.metal.metalness).toBeLessThan(0.5);
    expect(MATERIAL_RESPONSES.glass.roughness).toBeLessThan(MATERIAL_RESPONSES.wood.roughness);
  });
});
