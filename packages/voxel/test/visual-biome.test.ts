import { describe, expect, it } from "vitest";
import {
  createVisualBiomePalette,
  ORIGINAL_VISUAL_BIOME_COLORS,
  sampleMinecraftColormap,
  type DecodedVisualBiomeColormap,
} from "../src/visual-biome";

describe("deterministic visual biome colormap", () => {
  it("uses the stable temperate-village sample without stored biome state", () => {
    const grass = colormap("grass");
    const foliage = colormap("foliage");
    paint(grass, 50, 173, [12, 34, 56, 255]);
    paint(foliage, 50, 173, [78, 90, 123, 255]);

    expect(createVisualBiomePalette([grass, foliage])).toEqual({
      grass: 0x0c2238,
      foliage: 0x4e5a7b,
      water: ORIGINAL_VISUAL_BIOME_COLORS.water,
      temperature: 0.8,
      downfall: 0.4,
      source: "resource-pack",
    });
  });

  it("falls back independently and rejects malformed decoded pixels", () => {
    const foliage = colormap("foliage");
    paint(foliage, 50, 173, [100, 120, 140, 255]);
    expect(createVisualBiomePalette([foliage])).toMatchObject({
      grass: ORIGINAL_VISUAL_BIOME_COLORS.grass,
      foliage: 0x64788c,
      source: "resource-pack",
    });
    expect(() => sampleMinecraftColormap({ ...foliage, rgba: new Uint8Array(4) }, 0.8, 0.4)).toThrow(/256x256/);
  });
});

function colormap(kind: "grass" | "foliage"): DecodedVisualBiomeColormap {
  return { kind, width: 256, height: 256, rgba: new Uint8Array(256 * 256 * 4) };
}

function paint(colormap: DecodedVisualBiomeColormap, x: number, y: number, rgba: readonly number[]): void {
  colormap.rgba.set(rgba, (y * 256 + x) * 4);
}
