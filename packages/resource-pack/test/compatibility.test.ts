import { describe, expect, it } from "vitest";
import {
  summarizeBlueprintCompatibility,
  type BlockTextureManifest,
  type CompatibilityBlueprint,
} from "../src/index";

describe("summarizeBlueprintCompatibility", () => {
  it("groups canonical block signatures and reports four-dimensional voxel counts", () => {
    const blueprint: CompatibilityBlueprint = {
      id: "compatibility-fixture",
      voxels: [
        { sourceBlockId: "minecraft:stone" },
        { sourceBlockId: "minecraft:stone", sourceBlockState: {} },
        { sourceBlockId: "minecraft:oak_log" },
        { sourceBlockId: "minecraft:oak_log", sourceBlockState: { axis: "x" } },
        {},
        { sourceBlockId: "example:unknown" },
        { sourceBlockId: "minecraft:complex" },
        { sourceBlockId: "minecraft:missing_texture" },
      ],
    };

    const summary = summarizeBlueprintCompatibility(blueprint, manifest());

    expect(summary).toMatchObject({
      blueprintId: "compatibility-fixture",
      totalVoxelCount: 8,
      uniqueBlockSignatureCount: 7,
      texturedVoxelCount: 3,
      fallbackVoxelCount: 5,
      dimensions: {
        id: { supported: 6, missing: 2, unsupported: 0, notEvaluated: 0 },
        state: { supported: 5, missing: 1, unsupported: 0, notEvaluated: 2 },
        model: { supported: 4, missing: 0, unsupported: 1, notEvaluated: 3 },
        texture: { supported: 3, missing: 1, unsupported: 0, notEvaluated: 4 },
      },
    });
    expect(summary.fallbackReasons).toEqual([
      { reason: "COMPLEX_GEOMETRY", voxelCount: 1, signatureCount: 1 },
      { reason: "MISSING_SOURCE_BLOCK_ID", voxelCount: 1, signatureCount: 1 },
      { reason: "MISSING_SOURCE_BLOCK_STATE", voxelCount: 1, signatureCount: 1 },
      { reason: "MISSING_TEXTURE", voxelCount: 1, signatureCount: 1 },
      { reason: "UNKNOWN_BLOCK_ID", voxelCount: 1, signatureCount: 1 },
    ]);
    expect(summary.blocks.find((block) => block.key === "minecraft:stone[]")?.voxelCount).toBe(2);
    expect(summary.blocks.find((block) => block.key === "minecraft:oak_log[axis=x]")).toMatchObject({
      render: "resource-pack",
      model: { status: "supported", modelId: "minecraft:block/oak_log" },
      texture: { status: "supported", faces: { north: "minecraft:block/oak_log_top" } },
    });
  });

  it("normalizes state order, resolves each unique signature once, and never aliases input state", () => {
    const firstState = { waterlogged: "false", facing: "north" };
    const secondState = { facing: "north", waterlogged: "false" };
    const baseManifest = manifest();
    const manifestValue: BlockTextureManifest = { ...baseManifest, blockStates: [...baseManifest.blockStates, {
      resourceId: "minecraft:oriented",
      archivePath: "assets/minecraft/blockstates/oriented.json",
      variants: [{
        key: "facing=north,waterlogged=false",
        conditions: { facing: "north", waterlogged: "false" },
        choices: [{ model: "minecraft:block/stone", x: 0, y: 0, uvlock: false, weight: 1 }],
      }],
    }] };
    const summary = summarizeBlueprintCompatibility({
      id: "canonical",
      voxels: [
        { sourceBlockId: "minecraft:oriented", sourceBlockState: firstState },
        { sourceBlockId: "minecraft:oriented", sourceBlockState: secondState },
      ],
    }, manifestValue);

    expect(summary.uniqueBlockSignatureCount).toBe(1);
    expect(summary.blocks[0]).toMatchObject({
      key: "minecraft:oriented[facing=north,waterlogged=false]",
      voxelCount: 2,
      render: "resource-pack",
    });
    firstState.facing = "south";
    expect(summary.blocks[0]?.sourceBlockState).toEqual({ facing: "north", waterlogged: "false" });
  });

  it("distinguishes a supplied but unsupported state from a missing source state", () => {
    const summary = summarizeBlueprintCompatibility({
      id: "wrong-state",
      voxels: [{ sourceBlockId: "minecraft:oak_log", sourceBlockState: { axis: "z" } }],
    }, manifest());

    expect(summary.blocks[0]).toMatchObject({
      state: { status: "unsupported", detail: "NO_MATCHING_VARIANT" },
      fallbackReason: "NO_MATCHING_VARIANT",
    });
    expect(summary.dimensions.state).toEqual({ supported: 0, missing: 0, unsupported: 1, notEvaluated: 0 });
  });

  it("reports only the frozen P1 axis-aligned geometry scope as renderable", () => {
    const face = { texture: "#all", uv: [0, 0, 16, 16] as const, rotation: 0 as const };
    const base = manifest();
    const geometryManifest: BlockTextureManifest = {
      ...base,
      blockStates: [...base.blockStates,
        { resourceId: "minecraft:stone_slab", archivePath: "slab-state.json", variants: [{ key: "type=bottom", conditions: { type: "bottom" }, choices: [{ model: "minecraft:block/stone_slab", x: 0, y: 0, uvlock: false, weight: 1 }] }] },
        { resourceId: "minecraft:stone_stairs", archivePath: "stairs-state.json", variants: [{ key: "shape=straight", conditions: { shape: "straight" }, choices: [{ model: "minecraft:block/stone_stairs", x: 0, y: 0, uvlock: false, weight: 1 }] }] },
      ],
      models: [...base.models,
        { resourceId: "minecraft:block/stone_slab", archivePath: "slab.json", textures: { all: "minecraft:block/stone" }, elements: [{ from: [0, 0, 0], to: [16, 8, 16], shade: true, faces: { up: face, north: face } }] },
        { resourceId: "minecraft:block/stone_stairs", archivePath: "stairs.json", textures: { all: "minecraft:block/stone" }, elements: [{ from: [0, 0, 0], to: [16, 8, 16], shade: true, faces: { up: face, north: face } }] },
      ],
    };
    const summary = summarizeBlueprintCompatibility({ id: "p1", voxels: [
      { sourceBlockId: "minecraft:stone_slab", sourceBlockState: { type: "bottom" } },
      { sourceBlockId: "minecraft:stone_stairs", sourceBlockState: { shape: "straight" } },
      { sourceBlockId: "minecraft:stone_stairs", sourceBlockState: { shape: "inner_left" } },
    ] }, geometryManifest);

    expect(summary.texturedVoxelCount).toBe(2);
    expect(summary.fallbackVoxelCount).toBe(1);
    expect(summary.blocks[0]?.texture.geometryFaceCount).toBe(2);
    expect(summary.blocks.find((block) => block.sourceBlockState.shape === "inner_left")).toMatchObject({
      render: "original-fallback",
      fallbackReason: "NO_MATCHING_VARIANT",
    });
  });
});

function manifest(): BlockTextureManifest {
  const fullFaces = (texture: string) => ({
    down: texture, up: texture, north: texture, south: texture, west: texture, east: texture,
  });
  return {
    textures: [
      { resourceId: "minecraft:block/stone" },
      { resourceId: "minecraft:block/oak_log" },
      { resourceId: "minecraft:block/oak_log_top" },
    ],
    blockStates: [
      {
        resourceId: "minecraft:stone", archivePath: "assets/minecraft/blockstates/stone.json",
        variants: [{ key: "", conditions: {}, choices: [{ model: "minecraft:block/stone", x: 0, y: 0, uvlock: false, weight: 1 }] }],
      },
      {
        resourceId: "minecraft:oak_log", archivePath: "assets/minecraft/blockstates/oak_log.json",
        variants: [{ key: "axis=x", conditions: { axis: "x" }, choices: [{ model: "minecraft:block/oak_log", x: 90, y: 0, uvlock: false, weight: 1 }] }],
      },
      {
        resourceId: "minecraft:complex", archivePath: "assets/minecraft/blockstates/complex.json",
        variants: [{ key: "", conditions: {}, choices: [{ model: "minecraft:block/complex", x: 0, y: 0, uvlock: false, weight: 1 }] }],
      },
      {
        resourceId: "minecraft:missing_texture", archivePath: "assets/minecraft/blockstates/missing_texture.json",
        variants: [{ key: "", conditions: {}, choices: [{ model: "minecraft:block/missing_texture", x: 0, y: 0, uvlock: false, weight: 1 }] }],
      },
    ],
    models: [
      { resourceId: "minecraft:block/stone", archivePath: "stone.json", textures: { all: "minecraft:block/stone" }, faces: fullFaces("#all") },
      { resourceId: "minecraft:block/oak_log", archivePath: "oak_log.json", textures: { side: "minecraft:block/oak_log", end: "minecraft:block/oak_log_top" }, faces: { down: "#end", up: "#end", north: "#side", south: "#side", west: "#side", east: "#side" } },
      { resourceId: "minecraft:block/complex", archivePath: "complex.json", textures: {}, unsupportedReason: "COMPLEX_GEOMETRY" },
      { resourceId: "minecraft:block/missing_texture", archivePath: "missing_texture.json", textures: { all: "minecraft:block/not_present" }, faces: fullFaces("#all") },
    ],
  };
}
