import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ORIGINAL_MATERIAL_PATTERNS,
  ORIGINAL_MATERIAL_TEXTURE_SIZE,
  createOriginalMaterialPixels,
  createOriginalMaterialTexture,
  createPlanarQuadUvs,
  originalPatternForBlockId,
} from "../src/original-materials";

describe("original procedural materials", () => {
  it("creates deterministic, opaque 16x16 tiles with visible surface variation", () => {
    for (const pattern of ORIGINAL_MATERIAL_PATTERNS) {
      const first = createOriginalMaterialPixels(pattern);
      const second = createOriginalMaterialPixels(pattern);
      expect(first).toEqual(second);
      expect(first).toHaveLength(ORIGINAL_MATERIAL_TEXTURE_SIZE ** 2 * 4);
      expect([...first.filter((_, index) => index % 4 === 3)]).toEqual(
        new Array(ORIGINAL_MATERIAL_TEXTURE_SIZE ** 2).fill(255),
      );
      expect(new Set([...first.filter((_, index) => index % 4 === 0)]).size).toBeGreaterThan(1);
    }
  });

  it("uses material grammar rather than Minecraft pixels", () => {
    const planks = createOriginalMaterialPixels("planks");
    const glass = createOriginalMaterialPixels("glass");
    const at = (pixels: Uint8Array, x: number, y: number) => pixels[(y * 16 + x) * 4]!;

    expect(at(planks, 3, 4)).toBeLessThan(at(planks, 3, 5));
    expect(at(glass, 0, 8)).toBeLessThan(at(glass, 8, 8));
    expect(createOriginalMaterialPixels("stone")).not.toEqual(createOriginalMaterialPixels("cobble"));
  });

  it("classifies common block families into shared original patterns", () => {
    expect(originalPatternForBlockId("minecraft:oak_log", "wood")).toBe("bark");
    expect(originalPatternForBlockId("minecraft:oak_planks", "plank")).toBe("planks");
    expect(originalPatternForBlockId("minecraft:stone_bricks", "stone")).toBe("brick");
    expect(originalPatternForBlockId("minecraft:white_wool", "accent")).toBe("fabric");
    expect(originalPatternForBlockId("minecraft:white_concrete", "accent")).toBe("smooth");
    expect(originalPatternForBlockId("minecraft:red_stained_glass", "glass")).toBe("glass");
    expect(originalPatternForBlockId("minecraft:oxidized_copper", "roof")).toBe("metal");
    expect(originalPatternForBlockId("minecraft:diamond_ore", "stone")).toBe("ore");
    expect(originalPatternForBlockId("minecraft:water", "accent")).toBe("water");
    expect(originalPatternForBlockId("oak_log", "wood")).toBe("bark");
    expect(originalPatternForBlockId("red_stained_glass", "glass")).toBe("glass");
  });

  it("configures reusable nearest-filtered sRGB textures", () => {
    const texture = createOriginalMaterialTexture("brick");
    expect(texture.image.width).toBe(16);
    expect(texture.image.height).toBe(16);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.minFilter).toBe(THREE.NearestMipmapLinearFilter);
    expect(texture.anisotropy).toBe(2);
    expect(texture.generateMipmaps).toBe(true);
    texture.dispose();
  });

  it("projects independent terrain quads onto repeatable world-space UVs", () => {
    const top = createPlanarQuadUvs([
      0, 2, 0,
      0, 2, 4,
      4, 2, 4,
      4, 2, 0,
    ]);
    const side = createPlanarQuadUvs([
      0, 0, 0,
      0, 4, 0,
      0, 4, 4,
      0, 0, 4,
    ]);
    expect([...top]).toEqual([0, 0, 0, 1, 1, 1, 1, 0]);
    expect([...side]).toEqual([0, 0, 0, 1, 1, 1, 1, 0]);
    expect(() => createPlanarQuadUvs([0, 0, 0])).toThrow(/four-vertex quads/);
  });
});
