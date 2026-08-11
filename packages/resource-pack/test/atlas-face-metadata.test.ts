import { describe, expect, it } from "vitest";
import type { BlockFace, ResolvedBlockTextures, TextureAtlasEntry } from "../src";
import { mapBlockTexturesToAtlas } from "../src";

describe("atlas face metadata mapping", () => {
  it("preserves crop and rotation while normalizing Java UV coordinates", () => {
    const resolution = resolved("minecraft:block/stone") as ResolvedBlockTextures & {
      faceMetadata: Record<BlockFace, {
        texture: string;
        uv: readonly [number, number, number, number];
        rotation: 0 | 90 | 180 | 270;
      }>;
    };
    resolution.faceMetadata = Object.fromEntries(FACES.map((face) => [face, {
      texture: "minecraft:block/stone",
      uv: face === "north" ? [2, 4, 14, 12] : [0, 0, 16, 16],
      rotation: face === "north" ? 270 : 0,
    }])) as unknown as typeof resolution.faceMetadata;

    const mapped = mapBlockTexturesToAtlas(resolution, { entries: [entry("minecraft:block/stone")] });

    expect(mapped).toMatchObject({
      status: "resolved",
      faces: {
        north: { cropUv: [0.125, 0.25, 0.875, 0.75], rotation: 270 },
        south: { cropUv: [0, 0, 1, 1], rotation: 0 },
      },
    });
  });

  it("uses full unrotated UVs when schema-v1 input has no face metadata", () => {
    const mapped = mapBlockTexturesToAtlas(resolved("minecraft:block/stone"), { entries: [entry("minecraft:block/stone")] });

    expect(mapped).toMatchObject({
      status: "resolved",
      faces: {
        down: { cropUv: [0, 0, 1, 1], rotation: 0 },
        east: { cropUv: [0, 0, 1, 1], rotation: 0 },
      },
    });
  });

  it("falls back without partial output for malformed or mismatched metadata", () => {
    const resolution = resolved("minecraft:block/stone") as ResolvedBlockTextures & { faceMetadata: Record<string, unknown> };
    (resolution as unknown as { faceMetadata: Record<string, unknown> }).faceMetadata = {
      north: { texture: "minecraft:block/other", uv: [-1, 0, 16, 16], rotation: 45 },
    };

    expect(mapBlockTexturesToAtlas(resolution, { entries: [entry("minecraft:block/stone")] })).toEqual({
      status: "fallback",
      reason: "INVALID_FACE_METADATA",
      resourceId: "minecraft:block/stone",
    });
  });
});

const FACES: readonly BlockFace[] = ["down", "up", "north", "south", "west", "east"];

function resolved(resourceId: string): ResolvedBlockTextures {
  return {
    status: "resolved",
    modelId: "minecraft:block/test",
    faces: Object.fromEntries(FACES.map((face) => [face, resourceId])) as Record<BlockFace, string>,
  };
}

function entry(resourceId: string): TextureAtlasEntry {
  return {
    resourceId,
    index: 3,
    page: 1,
    pageTextureIndex: 3,
    x: 4,
    y: 5,
    width: 16,
    height: 16,
    uv: { u0: 0.1, v0: 0.2, u1: 0.3, v1: 0.4 },
    alphaMode: "opaque",
  };
}
