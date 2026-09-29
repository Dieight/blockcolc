import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ResourcePackManifest } from "@blockcolc/resource-pack";
import type { BlueprintVoxel } from "../src/blueprint";
import { planNaturalFlowerPackBatches } from "../src/natural-flower-pack";
import type { ResourcePackAtlas } from "../src/resource-textures";

function flowerPack(options: { blockState?: boolean; missingTexture?: boolean; partialModel?: boolean } = {}): {
  manifest: ResourcePackManifest;
  atlas: ResourcePackAtlas;
} {
  const textureId = "minecraft:block/flower_petals";
  const manifest: ResourcePackManifest = {
    schemaVersion: 1,
    pack: { packFormat: 15, description: "natural flower planner test" },
    textures: options.missingTexture ? [] : [{
      resourceId: textureId, namespace: "minecraft", texturePath: "flower_petals",
      archivePath: "assets/minecraft/textures/block/flower_petals.png", width: 16, height: 16, png: new Uint8Array(),
    }],
    blockStates: options.blockState === false ? [] : [{
      resourceId: "minecraft:poppy", archivePath: "assets/minecraft/blockstates/poppy.json",
      variants: [{ key: "", conditions: {}, choices: [{ model: "minecraft:block/poppy", x: 0, y: 0, uvlock: false, weight: 1 }] }],
    }],
    models: [{
      resourceId: "minecraft:block/poppy", archivePath: "assets/minecraft/models/block/poppy.json",
      textures: { texture: textureId, missing: "minecraft:block/not_in_atlas" },
      elements: [
        {
          from: [0, 0, 7], to: [16, 16, 9], shade: false,
          rotation: { axis: "y", angle: 45, origin: [8, 8, 8], rescale: false },
          faces: { north: { texture: "#texture", uv: [0, 0, 16, 16], rotation: 0 } },
        },
        ...(options.partialModel ? [{
          from: [0, 0, 7] as const, to: [16, 16, 9] as const, shade: false,
          faces: { south: { texture: "#missing", uv: [0, 0, 16, 16] as const, rotation: 0 as const } },
        }] : []),
      ],
    }],
    summary: { archiveFileCount: 3, candidateTextureCount: 1, acceptedTextureCount: 1, rejectedTextureCount: 0, ignoredFileCount: 0, namespaces: ["minecraft"], issues: [] },
  };
  const texture = new THREE.DataTexture(new Uint8Array(16 * 16 * 4), 16, 16, THREE.RGBAFormat, THREE.UnsignedByteType);
  const tile = {
    resourceId: textureId, index: 0, page: 0, pageTextureIndex: 0, alphaMode: "cutout" as const,
  };
  const atlas: ResourcePackAtlas = {
    pages: options.missingTexture ? [] : [{ texture, width: 16, height: 16, columns: 1, cellSize: 16, padding: 0 }],
    tiles: new Map(options.missingTexture ? [] : [[textureId, tile]]),
    source: {
      schemaVersion: 1, textureSize: 16, gutter: 0, safeMipLevels: 0,
      pages: options.missingTexture ? [] : [{ index: 0, width: 16, height: 16, columns: 1, rows: 1, rgba: new Uint8Array(16 * 16 * 4) }],
      entries: options.missingTexture ? [] : [{
        resourceId: textureId, index: 0, page: 0, pageTextureIndex: 0, x: 0, y: 0, width: 16, height: 16,
        uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, alphaMode: "cutout",
      }],
    },
    dispose: () => texture.dispose(),
  };
  return { manifest, atlas };
}

const flower = (x: number): BlueprintVoxel => ({
  x, y: 2, z: -4, materialId: "accent", buildOrder: 0, sourceBlockId: "minecraft:poppy",
});

describe("natural flower production pack planning", () => {
  it("keeps complete resolved flower models in bounded shared geometry batches", () => {
    const { manifest, atlas } = flowerPack();
    const placements = Array.from({ length: 30 }, (_, index) => flower(index * 3));
    const plan = planNaturalFlowerPackBatches(placements, manifest, atlas);
    expect(plan.packVoxels).toHaveLength(30);
    expect(plan.originalFallbackVoxels).toHaveLength(0);
    expect(plan.batches.length).toBeLessThanOrEqual(1);
    expect(plan.batches.reduce((total, batch) => total + batch.entries.length, 0)).toBe(30);
    atlas.dispose();
  });

  it.each([
    ["missing model", { blockState: false }],
    ["missing flower texture", { missingTexture: true }],
    ["partially resolved flower model", { partialModel: true }],
  ] as const)("routes a %s to one whole-flower original fallback", (_label, options) => {
    const { manifest, atlas } = flowerPack(options);
    const placement = flower(0);
    const plan = planNaturalFlowerPackBatches([placement], manifest, atlas);
    expect(plan.packVoxels).toHaveLength(0);
    expect(plan.batches).toHaveLength(0);
    expect(plan.originalFallbackVoxels).toEqual([placement]);
    atlas.dispose();
  });

  it("uses original whole-flower fallback without an active user pack", () => {
    const placements = [flower(1), flower(2)];
    const plan = planNaturalFlowerPackBatches(placements, undefined, undefined);
    expect(plan.packVoxels).toHaveLength(0);
    expect(plan.originalFallbackVoxels).toEqual(placements);
    expect(plan.batches).toHaveLength(0);
  });
});
