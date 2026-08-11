import { describe, expect, it } from "vitest";
import { MATERIAL_RESPONSES, materialResponseForMaterialId, materialResponseForVoxel } from "../src/material-response";

describe("V4 restrained material response", () => {
  it("classifies Minecraft source blocks before semantic fallback materials", () => {
    expect(materialResponseForVoxel({ materialId: "accent", sourceBlockId: "minecraft:iron_block" })).toBe("metal");
    expect(materialResponseForVoxel({ materialId: "accent", sourceBlockId: "minecraft:oak_planks" })).toBe("wood");
    expect(materialResponseForVoxel({ materialId: "accent", sourceBlockId: "minecraft:stone_bricks" })).toBe("stone");
    expect(materialResponseForVoxel({ materialId: "accent", sourceBlockId: "minecraft:tinted_glass" })).toBe("glass");
  });

  it("keeps native material families consistent and deliberately restrained", () => {
    expect(materialResponseForMaterialId("roof")).toBe("wood");
    expect(MATERIAL_RESPONSES.stone.roughness).toBeGreaterThan(MATERIAL_RESPONSES.wood.roughness);
    expect(MATERIAL_RESPONSES.metal.metalness).toBeGreaterThan(0);
    expect(MATERIAL_RESPONSES.metal.metalness).toBeLessThan(0.5);
    expect(MATERIAL_RESPONSES.glass.roughness).toBeLessThan(MATERIAL_RESPONSES.wood.roughness);
  });
});
