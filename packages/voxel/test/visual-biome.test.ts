import { describe, expect, it } from "vitest";
import {
  createVisualBiomePalette,
  sampleMinecraftColormap,
  type DecodedVisualBiomeColormap,
} from "../src/visual-biome";

describe("deterministic visual biome colormap", () => {
  it("uses the stable temperate-village sample without stored biome state", () => {
    const grass = colormap("grass");
    const foliage = colormap("foliage");
    const dryFoliage = colormap("dry_foliage");
    paint(grass, 50, 173, [12, 34, 56, 255]);
    paint(foliage, 50, 173, [78, 90, 123, 255]);
    paint(dryFoliage, 50, 173, [100, 110, 120, 255]);

    expect(createVisualBiomePalette([grass, foliage, dryFoliage])).toEqual({
      grass: 0x0c2238,
      foliage: 0x4e5a7b,
      dryFoliage: 0x646e78,
      water: 0x3f76e4,
      spruceLeaves: 0x619961,
      birchLeaves: 0x80a755,
      lilyPad: 0x208030,
      temperature: 0.8,
      downfall: 0.4,
      source: "resource-pack",
    });
  });

  it("matches the Java 26.3 no-colormap fallback at the fixed climate", () => {
    expect(createVisualBiomePalette([])).toEqual({
      grass: 0x91bd59,
      foliage: 0x77ab2f,
      dryFoliage: 0xa37546,
      water: 0x3f76e4,
      spruceLeaves: 0x619961,
      birchLeaves: 0x80a755,
      lilyPad: 0x208030,
      temperature: 0.8,
      downfall: 0.4,
      source: "original",
    });
  });

  it("falls back independently and rejects malformed decoded pixels", () => {
    const foliage = colormap("foliage");
    paint(foliage, 50, 173, [100, 120, 140, 255]);
    expect(createVisualBiomePalette([foliage])).toMatchObject({
      grass: 0x91bd59,
      foliage: 0x64788c,
      dryFoliage: 0xa37546,
      lilyPad: 0x208030,
      source: "resource-pack",
    });
    expect(() => sampleMinecraftColormap({ ...foliage, rgba: new Uint8Array(4) }, 0.8, 0.4)).toThrow(/256x256/);
  });
});

function colormap(kind: "grass" | "foliage" | "dry_foliage"): DecodedVisualBiomeColormap {
  return { kind, width: 256, height: 256, rgba: new Uint8Array(256 * 256 * 4) };
}

function paint(colormap: DecodedVisualBiomeColormap, x: number, y: number, rgba: readonly number[]): void {
  colormap.rgba.set(rgba, (y * 256 + x) * 4);
}
