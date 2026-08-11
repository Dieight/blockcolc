import { describe, expect, it } from "vitest";
import type { BlueprintVoxel } from "../src/blueprint";
import {
  blockOcclusionFor,
  combineTintAndOcclusionWord,
  createLocalOcclusionField,
  faceOcclusionLevelsFor,
  isFullOccluder,
  packFaceOcclusionLevels,
  unpackFaceOcclusionLevels,
} from "../src/local-occlusion";

describe("local voxel occlusion", () => {
  it("keeps isolated upper blocks bright but adds restrained ground contact", () => {
    const base = voxel(0, 0, 0);
    const upper = voxel(0, 1, 0);
    const field = createLocalOcclusionField([base, upper]);

    expect(faceOcclusionLevelsFor(base, field)).toEqual([2, 0, 1, 1, 1, 1]);
    expect(faceOcclusionLevelsFor(upper, field)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("darkens a face beside an outside corner without darkening a flat wall", () => {
    const target = voxel(0, 1, 0);
    const flatNeighbor = voxel(1, 1, 0);
    const outsideCorner = voxel(1, 1, 1);
    const groundReference = voxel(10, 0, 10);

    expect(faceOcclusionLevelsFor(target, createLocalOcclusionField([target, flatNeighbor, groundReference]))[3]).toBe(0);
    expect(faceOcclusionLevelsFor(target, createLocalOcclusionField([target, flatNeighbor, outsideCorner, groundReference]))[3]).toBe(1);
  });

  it("does not treat transparent or narrow blocks as full occluders", () => {
    expect(isFullOccluder(voxel(0, 0, 0, "minecraft:glass_pane", "glass"))).toBe(false);
    expect(isFullOccluder(voxel(0, 0, 0, "minecraft:oak_fence", "wood"))).toBe(false);
    expect(isFullOccluder(voxel(0, 0, 0, "minecraft:stone", "stone"))).toBe(true);
  });

  it("packs six two-bit levels above the existing tint word exactly", () => {
    const levels = [0, 1, 2, 3, 2, 1] as const;
    const packed = packFaceOcclusionLevels(levels);
    const combined = combineTintAndOcclusionWord(0b10_01_00_11_10_01, levels);

    expect(unpackFaceOcclusionLevels(packed)).toEqual(levels);
    expect(combined % 4096).toBe(0b10_01_00_11_10_01);
    expect(Math.floor(combined / 4096)).toBe(packed);
    expect(Math.fround(combined)).toBe(combined);
  });

  it("provides a bounded scalar for the fallback instance path", () => {
    const target = voxel(0, 0, 0);
    const field = createLocalOcclusionField([target, voxel(1, 0, 1), voxel(-1, 0, 1)]);
    expect(blockOcclusionFor(target, field)).toBeGreaterThan(0);
    expect(blockOcclusionFor(target, field)).toBeLessThanOrEqual(1);
  });
});

function voxel(
  x: number,
  y: number,
  z: number,
  sourceBlockId = "minecraft:stone",
  materialId: BlueprintVoxel["materialId"] = "stone",
): BlueprintVoxel {
  return { x, y, z, sourceBlockId, materialId, buildOrder: 10_000 };
}
