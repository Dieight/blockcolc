import type { BlockFace, ResourcePackManifest } from "@tomato-clock/resource-pack";
import { strToU8, zlibSync } from "fflate";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { BlueprintVoxel } from "../src/blueprint";
import {
  BLOCK_FACE_SLOTS,
  buildResourcePackAtlas,
  createAtlasMaterial,
  createTextureBatches,
  createTexturedBoxGeometry,
  faceSlotForNormal,
  faceTintKind,
  FOLIAGE_FACE_TINT,
  GRASS_FACE_TINT,
  WATER_FACE_TINT,
  packFaceUvTransform,
  packFaceTintKinds,
  planTexturedVoxel,
  planTexturedVoxelPages,
  unpackFaceTintKinds,
  unpackFaceUvTransform,
} from "../src/resource-textures";

describe("resource-pack voxel texture planning", () => {
  it("keeps the down/up/north/south/west/east face-slot order", () => {
    const faces = Object.fromEntries(BLOCK_FACE_SLOTS.map((face) => [face, `minecraft:block/${face}`])) as Record<BlockFace, string>;
    const manifest = manifestFor([{ blockId: "minecraft:test", modelId: "minecraft:block/test", faces }]);
    const atlas = buildResourcePackAtlas(manifest);
    const voxel = sourceVoxel("minecraft:test");
    const plan = planTexturedVoxel(voxel, manifest, atlas);

    expect(plan?.faceTiles).toEqual(BLOCK_FACE_SLOTS.map((face) => atlas.tiles.get(`minecraft:block/${face}`)?.index));
    expect(faceSlotForNormal(0, -1, 0)).toBe(0);
    expect(faceSlotForNormal(0, 1, 0)).toBe(1);
    expect(faceSlotForNormal(0, 0, -1)).toBe(2);
    expect(faceSlotForNormal(0, 0, 1)).toBe(3);
    expect(faceSlotForNormal(-1, 0, 0)).toBe(4);
    expect(faceSlotForNormal(1, 0, 0)).toBe(5);

    const geometry = createTexturedBoxGeometry([plan!]);
    expect([...geometry.getAttribute("instanceFaceTilesA").array]).toEqual(plan!.faceTiles.slice(0, 3));
    expect([...geometry.getAttribute("instanceFaceTilesB").array]).toEqual(plan!.faceTiles.slice(3, 6));
    expect([...geometry.getAttribute("instanceFaceUvWordA0").array]).toEqual(plan!.faceUvWordsA.slice(0, 3));
    expect([...geometry.getAttribute("instanceFaceUvWordA1").array]).toEqual(plan!.faceUvWordsA.slice(3, 6));
    expect([...geometry.getAttribute("instanceFaceUvWordB0").array]).toEqual(plan!.faceUvWordsB.slice(0, 3));
    expect([...geometry.getAttribute("instanceFaceUvWordB1").array]).toEqual(plan!.faceUvWordsB.slice(3, 6));
    expect(new Set(geometry.getAttribute("faceSlot").array)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    for (let face = 0; face < BLOCK_FACE_SLOTS.length; face += 1) {
      expect(unpackFaceUvTransform(plan!.faceUvWordsA[face]!, plan!.faceUvWordsB[face]!)).toEqual({
        cropUv: [0, 0, 1, 1],
        rotation: 0,
      });
    }
    expect(plan?.faceTintWord).toBe(0);
    expect([...geometry.getAttribute("instanceFaceTintKinds").array]).toEqual([0]);
    // Eleven geometry attributes plus four instanceMatrix slots stay within the
    // WebGL2 minimum MAX_VERTEX_ATTRIBS guarantee of 16.
    expect(Object.keys(geometry.attributes)).toHaveLength(12);
    expect(Object.keys(geometry.attributes).length + 4).toBeLessThanOrEqual(16);
    expect(atlas.pages[0]!.texture.minFilter).toBe(THREE.NearestMipmapLinearFilter);
    expect(atlas.pages[0]!.texture.mipmaps).toHaveLength(atlas.source.safeMipLevels + 1);
    expect(atlas.pages[0]!.texture.mipmaps?.map((mipmap) => [mipmap.width, mipmap.height])).toEqual([
      [atlas.pages[0]!.width, atlas.pages[0]!.height],
      [atlas.pages[0]!.width / 2, atlas.pages[0]!.height / 2],
      [atlas.pages[0]!.width / 4, atlas.pages[0]!.height / 4],
    ]);
    expect(atlas.pages[0]!.texture.anisotropy).toBe(2);
    geometry.dispose();
    atlas.dispose();
  });

  it("keeps distinct atlas tiles isolated through the safe mip levels", () => {
    const manifest = manifestFor([
      { blockId: "minecraft:red", modelId: "minecraft:block/red", faces: allFaces("minecraft:block/red") },
      { blockId: "minecraft:blue", modelId: "minecraft:block/blue", faces: allFaces("minecraft:block/blue") },
    ]);
    manifest.textures[0]!.png = rgbaPng([230, 20, 20, 255]);
    manifest.textures[1]!.png = rgbaPng([20, 30, 230, 255]);
    const atlas = buildResourcePackAtlas(manifest, 64);
    const mip = atlas.pages[0]!.texture.mipmaps![2]! as { data: Uint8Array; width: number; height: number };
    const colors = atlas.source.entries.map((entry) => {
      const x = Math.floor((entry.x + 8) / 4);
      const y = Math.floor((entry.y + 8) / 4);
      const offset = (y * mip.width + x) * 4;
      return [...mip.data.subarray(offset, offset + 4)];
    });
    expect(colors).toEqual([[230, 20, 20, 255], [20, 30, 230, 255]]);
    atlas.dispose();
  });

  it("packs supported leaf tint per face without adding a material batch", () => {
    const faces = allFaces("minecraft:block/oak_leaves");
    const manifest = manifestFor([{
      blockId: "minecraft:oak_leaves",
      modelId: "minecraft:block/oak_leaves",
      faces,
      faceMetadata: {
        north: { texture: faces.north, uv: [0, 0, 16, 16], rotation: 0, tintIndex: 0 },
      },
    }]);
    const atlas = buildResourcePackAtlas(manifest);
    const result = createTextureBatches([
      sourceVoxel("minecraft:oak_leaves", 0),
      sourceVoxel("minecraft:oak_leaves", 1),
    ], manifest, atlas);
    const tintKinds = unpackFaceTintKinds(result.batches[0]!.entries[0]!.faceTintWord);

    expect(faceTintKind("minecraft:oak_leaves", 0)).toBe(FOLIAGE_FACE_TINT);
    expect(tintKinds[2]).toBe(FOLIAGE_FACE_TINT);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.entries).toHaveLength(2);
    expect(packFaceTintKinds(tintKinds)).toBe(result.batches[0]!.entries[0]!.faceTintWord);
    atlas.dispose();
  });

  it("packs supported grass and water tint kinds", () => {
    const faces = allFaces("minecraft:block/grass_block_top");
    const manifest = manifestFor([{
      blockId: "minecraft:grass_block",
      modelId: "minecraft:block/grass_block",
      faces,
      faceMetadata: {
        up: { texture: faces.up, uv: [0, 0, 16, 16], rotation: 0, tintIndex: 0 },
      },
    }]);
    const atlas = buildResourcePackAtlas(manifest);
    const voxel = sourceVoxel("minecraft:grass_block");
    const result = createTextureBatches([voxel], manifest, atlas);

    expect(faceTintKind("minecraft:grass_block", 0)).toBe(GRASS_FACE_TINT);
    expect(unpackFaceTintKinds(result.batches[0]!.entries[0]!.faceTintWord)[1]).toBe(GRASS_FACE_TINT);
    expect(result.fallbackVoxels).toEqual([]);
    expect(faceTintKind("minecraft:water", 0)).toBe(WATER_FACE_TINT);
    atlas.dispose();
  });

  it("builds a compact animated-tile lookup while leaving the color atlas static", () => {
    const manifest = manifestFor([{
      blockId: "minecraft:animated",
      modelId: "minecraft:block/animated",
      faces: allFaces("minecraft:block/animated"),
    }]);
    const texture = manifest.textures[0]!;
    texture.height = 32;
    texture.png = rgbaStripPng([[40, 90, 140, 255], [160, 70, 30, 255]]);
    texture.animation = {
      frameWidth: 16,
      frameHeight: 16,
      sourceFrameCount: 2,
      sourceColumns: 1,
      sourceRows: 2,
      frametime: 2,
      interpolate: true,
      frames: [{ index: 0, time: 2 }, { index: 1, time: 3 }],
    };
    const atlas = buildResourcePackAtlas(manifest);
    const page = atlas.pages[0]!;
    const lookup = page.animationLookup!;
    const material = createAtlasMaterial(page, "opaque");
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main() {\n#include <uv_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n}",
    };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

    expect(lookup.sequences).toHaveLength(1);
    expect(lookup.sequences[0]).toMatchObject({ totalTicks: 5, interpolate: true });
    expect(lookup.pixels.byteLength).toBeLessThan(page.texture.image.data.byteLength);
    expect(page.columns).toBe(atlas.source.pages[0]!.columns);
    expect(material.customProgramCacheKey()).toBe("blockcolc-atlas-v4-opaque-animated");
    expect(shader.vertexShader).toContain("uniform sampler2D blockcolcAnimationLookup;");
    expect(shader.vertexShader).toContain("uniform sampler2D blockcolcAnimationBlendLookup;");
    expect(shader.vertexShader).toContain("texture2D(blockcolcAnimationLookup");
    expect(shader.fragmentShader).toContain("mix(sampledDiffuseColor, blockcolcNextDiffuseColor");
    expect(shader.uniforms).toMatchObject({
      blockcolcAnimationLookup: { value: lookup.texture },
      blockcolcAnimationBlendLookup: { value: lookup.blendTexture },
    });
    const lookupDispose = vi.spyOn(lookup.texture, "dispose");
    const blendDispose = vi.spyOn(lookup.blendTexture, "dispose");
    material.dispose();
    atlas.dispose();
    atlas.dispose();
    expect(lookupDispose).toHaveBeenCalledTimes(1);
    expect(blendDispose).toHaveBeenCalledTimes(1);
  });

  it("preserves fractional and reversed face crops with every quarter-turn rotation", () => {
    const crops = [
      [0.1234, 0.2345, 0.8765, 0.7654],
      [0.9, 0.8, 0.1, 0.2],
    ] as const;
    const rotations = [0, 90, 180, 270] as const;
    const maximumNormalizedError = 0.5 / 2047 + Number.EPSILON;

    for (const crop of crops) {
      for (const rotation of rotations) {
        const [wordA, wordB] = packFaceUvTransform(crop, rotation);
        const decoded = unpackFaceUvTransform(wordA, wordB);

        expect(new Float32Array([wordA])[0]).toBe(wordA);
        expect(new Float32Array([wordB])[0]).toBe(wordB);
        expect(decoded.rotation).toBe(rotation);
        decoded.cropUv.forEach((coordinate, index) => {
          const error = Math.abs(coordinate - crop[index]!);
          expect(error).toBeLessThanOrEqual(maximumNormalizedError);
          expect(error * 16).toBeLessThan(1 / 128);
        });
      }
    }
  });

  it("carries Java model face crop and rotation metadata into the instance plan", () => {
    const faces = allFaces("minecraft:block/known");
    const manifest = manifestFor([{
      blockId: "minecraft:known",
      modelId: "minecraft:block/known",
      faces,
      faceMetadata: {
        north: { texture: faces.north, uv: [2, 4, 14, 12], rotation: 90 },
      },
    }]);
    const atlas = buildResourcePackAtlas(manifest);
    const plan = planTexturedVoxel(sourceVoxel("minecraft:known"), manifest, atlas)!;
    const north = unpackFaceUvTransform(plan.faceUvWordsA[2], plan.faceUvWordsB[2]);

    expect(north.rotation).toBe(90);
    expect(north.cropUv[0]).toBeCloseTo(2 / 16, 3);
    expect(north.cropUv[1]).toBeCloseTo(4 / 16, 3);
    expect(north.cropUv[2]).toBeCloseTo(14 / 16, 3);
    expect(north.cropUv[3]).toBeCloseTo(12 / 16, 3);
    atlas.dispose();
  });

  it("patches visible atlas UVs with the shared crop and rotation decoder", () => {
    const manifest = manifestFor([{
      blockId: "minecraft:known",
      modelId: "minecraft:block/known",
      faces: allFaces("minecraft:block/known"),
    }]);
    const atlas = buildResourcePackAtlas(manifest);
    const page = atlas.pages[0]!;
    const material = createAtlasMaterial(page, "opaque");
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main() {\n#include <uv_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n}",
    };

    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

    expect(material.customProgramCacheKey()).toBe("blockcolc-atlas-v4-opaque-static");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordA0;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordA1;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordB0;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordB1;");
    expect(shader.vertexShader).toContain("attribute float instanceFaceTintKinds;");
    expect(shader.vertexShader).toContain("uniform vec3 blockcolcFoliageTint;");
    expect(shader.vertexShader).toContain("uniform vec3 blockcolcGrassTint;");
    expect(shader.vertexShader).toContain("blockcolcTintKind > 1.5 ? blockcolcGrassTint");
    expect(shader.vertexShader).toContain("blockcolcTintDivisor");
    expect(shader.fragmentShader).toContain("diffuseColor.rgb *= vBlockcolcTint;");
    expect(shader.vertexShader).toContain("/ 2047.0");
    expect(shader.vertexShader).toContain("/ 4194304.0");
    expect(shader.vertexShader).toContain("blockcolcRotation > 2.5");
    expect(shader.vertexShader).toContain("blockcolcRotation > 1.5");
    expect(shader.vertexShader).toContain("blockcolcRotation > 0.5");
    expect(shader.vertexShader).toContain("blockcolcCropDelta");
    expect(shader.vertexShader).toContain("blockcolcCropDirection");
    expect(shader.vertexShader).toContain("blockcolcCropSpan");
    expect(shader.uniforms).toMatchObject({
      blockcolcAtlasColumns: { value: page.columns },
      blockcolcAtlasCellSize: { value: page.cellSize },
      blockcolcAtlasPadding: { value: page.padding },
      blockcolcFoliageTint: { value: new THREE.Color(0x619a52) },
      blockcolcGrassTint: { value: new THREE.Color(0x78a95a) },
    });

    material.dispose();
    atlas.dispose();
  });

  it("batches different texture IDs by alpha and emissive mode rather than texture ID", () => {
    const manifest = manifestFor([
      { blockId: "minecraft:first", modelId: "minecraft:block/first", faces: allFaces("minecraft:block/first") },
      { blockId: "minecraft:second", modelId: "minecraft:block/second", faces: allFaces("minecraft:block/second") },
    ]);
    const atlas = buildResourcePackAtlas(manifest);
    const result = createTextureBatches([
      sourceVoxel("minecraft:first", 0),
      sourceVoxel("minecraft:second", 1),
    ], manifest, atlas);

    expect(result.fallbackVoxels).toEqual([]);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.alphaMode).toBe("opaque");
    expect(result.batches[0]?.entries).toHaveLength(2);
    atlas.dispose();
  });

  it("keeps missing source semantics and unresolved blocks on the original fallback path", () => {
    const manifest = manifestFor([
      { blockId: "minecraft:known", modelId: "minecraft:block/known", faces: allFaces("minecraft:block/known") },
    ]);
    const atlas = buildResourcePackAtlas(manifest);
    const original: BlueprintVoxel = { x: 0, y: 0, z: 0, materialId: "wood", buildOrder: 10000 };
    const missing = sourceVoxel("minecraft:missing", 1);
    const result = createTextureBatches([original, missing], manifest, atlas);

    expect(result.batches).toEqual([]);
    expect(result.fallbackVoxels).toEqual([original, missing]);
    atlas.dispose();
  });

  it("owns and idempotently disposes its GPU DataTexture", () => {
    const manifest = manifestFor([
      { blockId: "minecraft:known", modelId: "minecraft:block/known", faces: allFaces("minecraft:block/known") },
    ]);
    const atlas = buildResourcePackAtlas(manifest);
    const dispose = vi.spyOn(atlas.pages[0]!.texture, "dispose");

    atlas.dispose();
    atlas.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("splits one six-face cube across atlas pages without partial fallback", () => {
    const faces = {
      down: "minecraft:block/i", up: "minecraft:block/j",
      north: "minecraft:block/i", south: "minecraft:block/j",
      west: "minecraft:block/i", east: "minecraft:block/j",
    } satisfies Record<BlockFace, string>;
    const manifest = manifestFor([{ blockId: "minecraft:cross_page", modelId: "minecraft:block/cross_page", faces }]);
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      manifest.textures.push({
        resourceId: `minecraft:block/${name}`, namespace: "minecraft", texturePath: name,
        archivePath: `assets/minecraft/textures/block/${name}.png`, width: 16, height: 16,
        png: rgbaPng([20, 40, 60, 255]),
      });
    }
    const animated = manifest.textures.find((texture) => texture.resourceId === "minecraft:block/j")!;
    animated.height = 32;
    animated.png = rgbaStripPng([[100, 30, 20, 255], [20, 100, 30, 255]]);
    animated.animation = {
      frameWidth: 16, frameHeight: 16, sourceFrameCount: 2, sourceColumns: 1, sourceRows: 2, frametime: 1, interpolate: false,
      frames: [{ index: 0, time: 1 }, { index: 1, time: 1 }],
    };
    const atlas = buildResourcePackAtlas(manifest, 64);
    const voxel = sourceVoxel("minecraft:cross_page");
    const plans = planTexturedVoxelPages(voxel, manifest, atlas)!;
    const result = createTextureBatches([voxel], manifest, atlas);

    expect(atlas.pages).toHaveLength(2);
    expect(atlas.pages[1]!.animationLookup?.sequences).toEqual([
      expect.objectContaining({ textureIndex: 0, frames: [{ textureIndex: 0, time: 1 }, { textureIndex: 1, time: 1 }] }),
    ]);
    expect(plans.map((plan) => ({ page: plan.page, mask: plan.faceMask }))).toEqual([
      { page: 0, mask: 0b01_0101 },
      { page: 1, mask: 0b10_1010 },
    ]);
    expect(result.fallbackVoxels).toEqual([]);
    expect(result.batches).toHaveLength(2);
    expect(planTexturedVoxelPages(voxel, manifest, { ...atlas, pages: [atlas.pages[0]!] })).toBeUndefined();
    for (const batch of result.batches) {
      const geometry = createTexturedBoxGeometry(batch.entries);
      expect(geometry.getIndex()?.count).toBe(18);
      geometry.dispose();
    }
    const pageDisposals = atlas.pages.map((page) => vi.spyOn(page.texture, "dispose"));
    atlas.dispose();
    atlas.dispose();
    expect(pageDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });
});

interface BlockFixture {
  blockId: string;
  modelId: string;
  faces: Record<BlockFace, string>;
  faceMetadata?: Partial<Record<BlockFace, {
    texture: string;
    uv: readonly [number, number, number, number];
    rotation: 0 | 90 | 180 | 270;
    tintIndex?: number;
  }>>;
}

function manifestFor(blocks: readonly BlockFixture[]): ResourcePackManifest {
  const textureIds = [...new Set(blocks.flatMap((block) => Object.values(block.faces)))].sort();
  return {
    schemaVersion: 1,
    pack: { packFormat: 34, description: "Voxel test" },
    textures: textureIds.map((resourceId, index) => {
      const [namespace, path] = resourceId.split(":") as [string, string];
      const texturePath = path.replace(/^block\//, "");
      return {
        resourceId,
        namespace,
        texturePath,
        archivePath: `assets/${namespace}/textures/block/${texturePath}.png`,
        width: 16,
        height: 16,
        png: rgbaPng([20 + index, 80, 120, 255]),
      };
    }),
    blockStates: blocks.map((block) => ({
      resourceId: block.blockId,
      archivePath: `assets/minecraft/blockstates/${block.blockId.split(":")[1]}.json`,
      variants: [{ key: "", conditions: {}, choices: [{ model: block.modelId, x: 0, y: 0, uvlock: false, weight: 1 }] }],
    })),
    models: blocks.map((block) => ({
      resourceId: block.modelId,
      archivePath: `assets/minecraft/models/block/${block.modelId.split("/").at(-1)}.json`,
      textures: {},
      faces: block.faces,
      ...(block.faceMetadata ? { faceMetadata: block.faceMetadata } : {}),
    })),
    summary: {
      archiveFileCount: textureIds.length + blocks.length * 2 + 1,
      candidateTextureCount: textureIds.length,
      acceptedTextureCount: textureIds.length,
      rejectedTextureCount: 0,
      ignoredFileCount: 0,
      namespaces: ["minecraft"],
      issues: [],
    },
  };
}

function sourceVoxel(sourceBlockId: string, x = 0): BlueprintVoxel {
  return { x, y: 0, z: 0, materialId: "stone", buildOrder: 10000, sourceBlockId };
}

function allFaces(texture: string): Record<BlockFace, string> {
  return { down: texture, up: texture, north: texture, south: texture, west: texture, east: texture };
}

function rgbaPng(color: readonly [number, number, number, number]): Uint8Array {
  return rgbaStripPng([color]);
}

function rgbaStripPng(colors: readonly (readonly [number, number, number, number])[]): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 16, false);
  const height = colors.length * 16;
  view.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = new Uint8Array(height * 65);
  for (let y = 0; y < height; y += 1) {
    rows[y * 65] = 0;
    const color = colors[Math.floor(y / 16)]!;
    for (let x = 0; x < 16; x += 1) rows.set(color, y * 65 + 1 + x * 4);
  }
  return concat(signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlibSync(rows)), pngChunk("IEND", new Uint8Array()));
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length, false);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(concat(typeBytes, data)), false);
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}
