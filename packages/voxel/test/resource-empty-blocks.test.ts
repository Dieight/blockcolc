import { describe, expect, it } from "vitest";
import { isVisuallyEmptyVanillaBlock } from "../src/resource-empty-blocks";

describe("intentional Java empty model routing", () => {
  it("keeps normally invisible technical blocks out of the fallback cube path", () => {
    for (const id of ["air", "cave_air", "void_air", "barrier", "light", "moving_piston", "structure_void"]) {
      expect(isVisuallyEmptyVanillaBlock({ sourceBlockId: `minecraft:${id}` })).toBe(true);
    }
    expect(isVisuallyEmptyVanillaBlock({ sourceBlockId: "mod:barrier" })).toBe(false);
  });

  it("hides the 26.3 upper pitcher crop placeholder before its visible growth stage", () => {
    for (const age of ["0", "1", "2"]) {
      expect(isVisuallyEmptyVanillaBlock({ sourceBlockId: "minecraft:pitcher_crop", sourceBlockState: { half: "upper", age } })).toBe(true);
    }
    expect(isVisuallyEmptyVanillaBlock({ sourceBlockId: "minecraft:pitcher_crop", sourceBlockState: { half: "upper", age: "3" } })).toBe(false);
    expect(isVisuallyEmptyVanillaBlock({ sourceBlockId: "minecraft:pitcher_crop", sourceBlockState: { half: "lower", age: "0" } })).toBe(false);
  });

  it("hides exactly the no-post/no-side state used by vanilla wall multipart definitions", () => {
    const empty = { up: "false", north: "none", south: "none", west: "none", east: "none", waterlogged: "true" };
    expect(isVisuallyEmptyVanillaBlock({ sourceBlockId: "minecraft:cinnabar_wall", sourceBlockState: empty })).toBe(true);
    expect(isVisuallyEmptyVanillaBlock({ sourceBlockId: "minecraft:stone_brick_wall", sourceBlockState: { ...empty, up: "true" } })).toBe(false);
    expect(isVisuallyEmptyVanillaBlock({ sourceBlockId: "minecraft:stone_brick_wall", sourceBlockState: { ...empty, east: "low" } })).toBe(false);
    expect(isVisuallyEmptyVanillaBlock({ sourceBlockId: "minecraft:white_wall_banner", sourceBlockState: empty })).toBe(false);
  });
});
