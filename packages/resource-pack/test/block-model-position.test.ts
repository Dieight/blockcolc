import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  parseJava16xResourcePack,
  resolveBlockGeometry,
  resolveBlockTextures,
  type BlockTextureManifest,
  type ResourcePackManifest,
} from "../src";

const faces = Object.fromEntries(
  ["down", "up", "north", "south", "west", "east"].map((face) => [face, { texture: "#all" }]),
);

describe("position-seeded block model choices", () => {
  it("preserves JSON choice order and weights through manifest round-trip, then matches 26.3 position picks", () => {
    const parsed = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { pack_format: 34, description: "Position choices" } }),
      "assets/minecraft/blockstates/weighted.json": json({ variants: { "": [
        { model: "minecraft:block/zeta", weight: 3 },
        { model: "minecraft:block/alpha" },
      ] } }),
      "assets/minecraft/blockstates/single.json": json({ variants: { "": { model: "minecraft:block/zeta" } } }),
      "assets/minecraft/models/block/zeta.json": cubeModel("minecraft:block/zeta"),
      "assets/minecraft/models/block/alpha.json": cubeModel("minecraft:block/alpha"),
    }));

    const roundTripped = JSON.parse(JSON.stringify(parsed)) as ResourcePackManifest;
    const choices = roundTripped.blockStates.find((state) => state.resourceId === "minecraft:weighted")!.variants[0]!.choices;
    expect(choices.map(({ model: modelId, weight }) => [modelId, weight])).toEqual([
      ["minecraft:block/zeta", 3],
      ["minecraft:block/alpha", 1],
    ]);

    const manifest = withSyntheticTextures(roundTripped);
    const knownJava26xPicks = [
      { position: { x: 0, y: 0, z: 0 }, modelId: "minecraft:block/zeta" }, // Mth seed 0, nextInt(4) = 2
      { position: { x: 1, y: 2, z: 3 }, modelId: "minecraft:block/alpha" }, // Mth seed -33674130277896, nextInt(4) = 3
      { position: { x: -1, y: 0, z: 1 }, modelId: "minecraft:block/alpha" }, // Mth seed 60458568495641, nextInt(4) = 3
      { position: { x: 255, y: 64, z: -128 }, modelId: "minecraft:block/zeta" }, // Mth seed -82121623491184, nextInt(4) = 1
    ] as const;
    for (const { position, modelId } of knownJava26xPicks) {
      const first = resolveBlockTextures(manifest, "minecraft:weighted", {}, position);
      const repeated = resolveBlockTextures(manifest, "minecraft:weighted", {}, position);
      expect(first).toMatchObject({ status: "resolved", modelId });
      expect(repeated).toEqual(first);
    }

    const singleWithoutPosition = resolveBlockTextures(manifest, "minecraft:single");
    const singleWithPosition = resolveBlockTextures(manifest, "minecraft:single", {}, { x: 1, y: 2, z: 3 });
    expect(singleWithPosition).toEqual(singleWithoutPosition);

    const legacyDefault = resolveBlockTextures(manifest, "minecraft:weighted");
    expect(resolveBlockTextures(manifest, "minecraft:weighted", {}, { x: 0.5, y: 0, z: 0 })).toEqual(legacyDefault);
  });

  it("uses one nextLong seed reset for every matching multipart part", () => {
    const parsed = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { pack_format: 34, description: "Multipart position choices" } }),
      "assets/minecraft/blockstates/multipart.json": json({ multipart: [
        { apply: [
          { model: "minecraft:block/zeta_part" },
          { model: "minecraft:block/alpha_part" },
        ] },
        { apply: [
          { model: "minecraft:block/zeta_part" },
          { model: "minecraft:block/alpha_part" },
        ] },
      ] }),
      "assets/minecraft/models/block/zeta_part.json": model("minecraft:block/zeta", [0, 0, 0], [4, 16, 4]),
      "assets/minecraft/models/block/alpha_part.json": model("minecraft:block/alpha", [12, 0, 12], [16, 16, 16]),
    }));
    const manifest = withSyntheticTextures(JSON.parse(JSON.stringify(parsed)) as ResourcePackManifest);

    const firstPosition = resolveBlockGeometry(manifest, "minecraft:multipart", {}, { x: 0, y: 0, z: 0 });
    const secondPosition = resolveBlockGeometry(manifest, "minecraft:multipart", {}, { x: 1, y: 2, z: 3 });
    expect(firstPosition.status).toBe("resolved_geometry");
    expect(secondPosition.status).toBe("resolved_geometry");
    if (firstPosition.status !== "resolved_geometry" || secondPosition.status !== "resolved_geometry") return;

    expect(firstPosition.elements).toHaveLength(2);
    expect(firstPosition.elements[0]?.from).toEqual([0, 0, 0]);
    expect(firstPosition.elements[1]?.from).toEqual([0, 0, 0]);
    expect(secondPosition.elements[0]?.from).toEqual([12, 0, 12]);
    expect(secondPosition.elements[1]?.from).toEqual([12, 0, 12]);
  });
});

function withSyntheticTextures(manifest: ResourcePackManifest): BlockTextureManifest {
  return {
    blockStates: manifest.blockStates,
    models: manifest.models,
    textures: [
      "minecraft:block/zeta", "minecraft:block/alpha",
      "minecraft:block/zeta_part", "minecraft:block/alpha_part",
    ].map((resourceId) => ({ resourceId })),
  };
}

function cubeModel(texture: string) {
  return json({ parent: "minecraft:block/cube_all", textures: { all: texture } });
}

function model(texture: string, from: readonly number[], to: readonly number[]) {
  return json({
    textures: { all: texture },
    elements: [{ from, to, faces }],
  });
}

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}
