import type { BlockFace, ResourcePackManifest } from "@tomato-clock/resource-pack";
import { strToU8, zlibSync } from "fflate";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { BlueprintVoxel } from "../src/blueprint";
import { builtinMaterialBlockId } from "../src/original-materials";
import {
  BLOCK_FACE_SLOTS,
  buildResourcePackAtlas,
  cropAtlasTilePixels,
  createAtlasMaterial,
  createTextureBatches,
  createTexturedBoxGeometry,
  faceSlotForNormal,
  faceTintKind,
  ATTACHED_STEM_FACE_TINT,
  ATTACHED_STEM_TINT_RGB,
  FOLIAGE_FACE_TINT,
  GROWING_STEM_FACE_TINT,
  GRASS_FACE_TINT,
  DRY_FOLIAGE_FACE_TINT,
  SPRUCE_LEAVES_FACE_TINT,
  BIRCH_LEAVES_FACE_TINT,
  LILY_PAD_FACE_TINT,
  REDSTONE_WIRE_FACE_TINT,
  resolveBlockStateTint,
  WATER_FACE_TINT,
  packFaceUvTransform,
  packFaceTintKinds,
  patchFluidSurfaceVertexShader,
  patchAtlasUvVertexShader,
  planTexturedVoxel,
  planTexturedVoxelPages,
  resolvePackTileRect,
  unpackFaceTintKinds,
  unpackFaceUvTransform,
} from "../src/resource-textures";

describe("resource-pack voxel texture planning", () => {
  it("crops a terrain atlas tile without neighboring page pixels", () => {
    const source = new Uint8Array(4 * 2 * 4);
    for (let index = 0; index < source.length; index += 4) {
      source[index] = (index % 16) < 8 ? 12 : 220;
      source[index + 3] = 255;
    }
    const cropped = cropAtlasTilePixels(source, 4, 2, { u0: 0, v0: 0, u1: 0.5, v1: 1 });
    expect(cropped).toMatchObject({ width: 2, height: 2 });
    expect([...cropped.pixels.filter((_, index) => index % 4 === 0)]).toEqual([12, 12, 12, 12]);
  });

  it("patches non-atlas fluid geometry with bounded corner and flowing-top data", () => {
    const source = "#include <common>\nvoid main() {\n#include <begin_vertex>\n#include <uv_vertex>\n}";
    const patched = patchFluidSurfaceVertexShader(source);
    expect(patched.match(/attribute float instanceFaceOcclusion;/g)).toHaveLength(1);
    expect(patched.match(/attribute float instanceMaterialResponse;/g)).toHaveLength(1);
    expect(patched).toContain("blockcolcCornerSouthWest");
    expect(patched).toContain("blockcolcUvFluidAngle");
    expect(patched).toContain("vMapUv = blockcolcFlowUv");

    const atlasPatched = patchFluidSurfaceVertexShader(patchAtlasUvVertexShader(source), true);
    expect(atlasPatched).not.toContain("blockcolcFaceUvWordA1");
    expect(atlasPatched).not.toContain("blockcolcFaceUvWordB1");
    expect(atlasPatched).toContain("blockcolcFaceSlot < 4.5 ? instanceFaceUvWordA1.y : instanceFaceUvWordA1.z");
    expect(atlasPatched).toContain("blockcolcFaceSlot < 4.5 ? instanceFaceUvWordB1.y : instanceFaceUvWordB1.z");
    expect(atlasPatched).toContain("blockcolcLocalUv = position.z < 0.0");
    expect(atlasPatched).toContain("vBlockcolcFluidAngle = blockcolcUvFluidAngle");
    expect(atlasPatched).toContain("vBlockcolcMaterialResponse = blockcolcUvFluidActive > 0.5 ? 4.0");
  });

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
    expect(geometry.getAttribute("faceSlot")).toBeUndefined();
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
    expect(geometry.getAttribute("instanceFaceOcclusion")).toBeDefined();
    expect(Object.keys(geometry.attributes).length + 4).toBeLessThanOrEqual(16);
    expect(atlas.pages[0]!.texture.minFilter).toBe(THREE.NearestMipmapLinearFilter);
    expect(atlas.pages[0]!.texture.flipY).toBe(false);
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

  it("retextures built-in materials through their vanilla stand-in block ids", () => {
    expect(builtinMaterialBlockId("stone")).toBe("minecraft:stone");
    expect(builtinMaterialBlockId("wood")).toBe("minecraft:oak_log");
    expect(builtinMaterialBlockId("plank")).toBe("minecraft:oak_planks");
    expect(builtinMaterialBlockId("roof")).toBe("minecraft:bricks");
    expect(builtinMaterialBlockId("glass")).toBe("minecraft:glass");
    expect(builtinMaterialBlockId("accent")).toBe("minecraft:birch_planks");
    expect(builtinMaterialBlockId("terrainWater")).toBeUndefined();

    const manifest = manifestFor([
      { blockId: "minecraft:oak_planks", modelId: "minecraft:block/oak_planks", faces: allFaces("minecraft:block/oak_planks") },
    ]);
    const atlas = buildResourcePackAtlas(manifest);
    const builtinPlank: BlueprintVoxel = { x: 0, y: 0, z: 0, materialId: "plank", buildOrder: 10000 };
    const plan = planTexturedVoxel(builtinPlank, manifest, atlas);
    expect(plan).toBeDefined();
    expect(plan?.faceTiles[0]).toBe(atlas.tiles.get("minecraft:block/oak_planks")?.index);

    // A built-in material whose stand-in block the pack does not provide keeps the procedural fallback.
    const missing: BlueprintVoxel = { x: 0, y: 0, z: 0, materialId: "accent", buildOrder: 10000 };
    expect(planTexturedVoxel(missing, manifest, atlas)).toBeUndefined();

    // Packs without any atlas pages still fall back for every voxel.
    const emptyManifest = manifestFor([]);
    const emptyAtlas = buildResourcePackAtlas(emptyManifest);
    expect(planTexturedVoxel(builtinPlank, emptyManifest, emptyAtlas)).toBeUndefined();
    atlas.dispose();
    emptyAtlas.dispose();
  });

  it("uses the origin model choice for one shared terrain tile", () => {
    const manifest = manifestFor([
      { blockId: "minecraft:terrain_test", modelId: "minecraft:block/terrain_first", faces: allFaces("minecraft:block/terrain_first") },
      { blockId: "minecraft:other", modelId: "minecraft:block/terrain_second", faces: allFaces("minecraft:block/terrain_second") },
    ]);
    manifest.blockStates[0]!.variants[0]!.choices.push({
      model: "minecraft:block/terrain_second", x: 0, y: 0, uvlock: false, weight: 1,
    });
    const atlas = buildResourcePackAtlas(manifest);
    const voxelPlan = planTexturedVoxel(sourceVoxel("minecraft:terrain_test"), manifest, atlas);
    const tile = atlas.source.entries.find((entry) => entry.resourceId === "minecraft:block/terrain_second")!;

    expect(voxelPlan?.faceTiles[1]).toBe(tile.index);
    expect(resolvePackTileRect(manifest, atlas, "minecraft:terrain_test", "up")).toEqual({
      page: tile.page, u0: tile.uv.u0, v0: tile.uv.v0, u1: tile.uv.u1, v1: tile.uv.v1,
    });
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

  it("maps 26.3 vanilla foliage tint sources, including dry foliage and fixed leaf colors", () => {
    expect(faceTintKind("minecraft:leaf_litter", 0)).toBe(DRY_FOLIAGE_FACE_TINT);
    expect(faceTintKind("minecraft:pink_petals", 1)).toBe(GRASS_FACE_TINT);
    expect(faceTintKind("minecraft:wildflowers", 1)).toBe(GRASS_FACE_TINT);
    expect(faceTintKind("minecraft:spruce_leaves", 0)).toBe(SPRUCE_LEAVES_FACE_TINT);
    expect(faceTintKind("minecraft:birch_leaves", 0)).toBe(BIRCH_LEAVES_FACE_TINT);
    expect(faceTintKind("minecraft:lily_pad", 0)).toBe(LILY_PAD_FACE_TINT);
    expect(faceTintKind("minecraft:cherry_leaves", 0)).toBe(0);
    expect(faceTintKind("minecraft:redstone_wire", 0)).toBe(REDSTONE_WIRE_FACE_TINT);
    expect(faceTintKind("minecraft:pumpkin_stem", 0)).toBe(GROWING_STEM_FACE_TINT);
    expect(faceTintKind("minecraft:attached_melon_stem", 0)).toBe(ATTACHED_STEM_FACE_TINT);
    expect(faceTintKind("example:oak_leaves", 0)).toBeUndefined();

    const packed = packFaceTintKinds([
      FOLIAGE_FACE_TINT, GRASS_FACE_TINT, WATER_FACE_TINT,
      DRY_FOLIAGE_FACE_TINT, SPRUCE_LEAVES_FACE_TINT, LILY_PAD_FACE_TINT,
    ]);
    expect(new Float32Array([packed])[0]).toBe(packed);
    expect(unpackFaceTintKinds(packed)).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it("matches the pinned Java 26.3 state-dependent tint colors without fallback", () => {
    const redstoneColors = [
      0x4c0000, 0x700000, 0x7a0000, 0x840000, 0x8e0000, 0x990000, 0xa30000, 0xad0000,
      0xb70000, 0xc10000, 0xcc0000, 0xd60000, 0xe00000, 0xea0600, 0xf41b00, 0xff3200,
    ];
    const stemColors = [0x00ff00, 0x20f704, 0x40ef08, 0x60e70c, 0x80df10, 0xa0d714, 0xc0cf18, 0xe0c71c];
    expect(Array.from({ length: 16 }, (_, power) => resolveBlockStateTint("minecraft:redstone_wire", { power: String(power) })))
      .toEqual(redstoneColors.map((rgb) => ({ status: "resolved", rgb })));
    for (const blockId of ["minecraft:melon_stem", "minecraft:pumpkin_stem"]) {
      expect(Array.from({ length: 8 }, (_, age) => resolveBlockStateTint(blockId, { age: String(age) })))
        .toEqual(stemColors.map((rgb) => ({ status: "resolved", rgb })));
    }
    expect(resolveBlockStateTint("minecraft:attached_melon_stem")).toEqual({ status: "resolved", rgb: 0xe0c71c });
    expect(resolveBlockStateTint("minecraft:attached_pumpkin_stem")).toEqual({ status: "resolved", rgb: ATTACHED_STEM_TINT_RGB });
    expect(resolveBlockStateTint("minecraft:redstone_wire")).toEqual({ status: "resolved", rgb: redstoneColors[0] });
    expect(resolveBlockStateTint("minecraft:melon_stem")).toEqual({ status: "resolved", rgb: stemColors[0] });
    expect(resolveBlockStateTint("minecraft:redstone_wire", { power: "16" })).toEqual({ status: "invalid" });
    expect(resolveBlockStateTint("minecraft:melon_stem", { age: "-1" })).toEqual({ status: "invalid" });

    const blockIds = [
      "minecraft:redstone_wire", "minecraft:attached_melon_stem", "minecraft:attached_pumpkin_stem",
      "minecraft:melon_stem", "minecraft:pumpkin_stem",
    ];
    const manifest = manifestFor(blockIds.map((blockId) => {
      const texture = `minecraft:block/${blockId.slice("minecraft:".length)}`;
      return {
        blockId,
        modelId: `minecraft:block/${blockId.slice("minecraft:".length)}`,
        faces: allFaces(texture),
        faceMetadata: { north: { texture, uv: [0, 0, 16, 16] as const, rotation: 0 as const, tintIndex: 0 } },
      };
    }));
    const atlas = buildResourcePackAtlas(manifest);
    const redstoneStates: Record<string, string>[] = [];
    for (let power = 0; power < 16; power += 1) {
      for (const north of ["none", "side", "up"]) {
        for (const east of ["none", "side", "up"]) {
          for (const south of ["none", "side", "up"]) {
            for (const west of ["none", "side", "up"]) {
              redstoneStates.push({ north, east, south, west, power: String(power) });
            }
          }
        }
      }
    }
    const attachedStates = ["north", "east", "south", "west"];
    const voxelStates = [
      ...redstoneStates.map((state, index) => sourceVoxel("minecraft:redstone_wire", index, state)),
      ...stemColors.map((_, age) => sourceVoxel("minecraft:melon_stem", 1296 + age, { age: String(age) })),
      ...stemColors.map((_, age) => sourceVoxel("minecraft:pumpkin_stem", 1304 + age, { age: String(age) })),
      ...attachedStates.map((facing, index) => sourceVoxel("minecraft:attached_melon_stem", 1312 + index, { facing, attached: "true" })),
      ...attachedStates.map((facing, index) => sourceVoxel("minecraft:attached_pumpkin_stem", 1316 + index, { facing, attached: "true" })),
    ];
    const result = createTextureBatches(voxelStates, manifest, atlas);
    const redstoneBatchColors = new Map(result.batches
      .filter((batch) => batch.entries[0]?.voxel.sourceBlockId === "minecraft:redstone_wire")
      .map((batch) => [batch.entries[0]!.voxel.sourceBlockState?.power, batch.stateTintRgb]));
    const redstoneBatches = result.batches.filter((batch) => batch.entries[0]?.voxel.sourceBlockId === "minecraft:redstone_wire");
    const stemBatchColors = new Map(result.batches
      .filter((batch) => batch.entries[0]?.voxel.sourceBlockId === "minecraft:melon_stem")
      .map((batch) => [batch.entries[0]!.voxel.sourceBlockState?.age, batch.stateTintRgb]));

    expect(result.fallbackVoxels).toEqual([]);
    expect(redstoneStates).toHaveLength(1296);
    expect(voxelStates).toHaveLength(1320);
    expect(redstoneBatchColors).toEqual(new Map(redstoneColors.map((rgb, power) => [String(power), rgb])));
    expect(redstoneBatches).toHaveLength(16);
    expect(redstoneBatches.every((batch) => batch.entries.length === 81)).toBe(true);
    expect(stemBatchColors).toEqual(new Map(stemColors.map((rgb, age) => [String(age), rgb])));
    const redstonePlan = result.batches.flatMap((batch) => batch.entries)
      .find((entry) => entry.voxel.sourceBlockId === "minecraft:redstone_wire")!;
    const stemPlan = result.batches.flatMap((batch) => batch.entries)
      .find((entry) => entry.voxel.sourceBlockId === "minecraft:melon_stem")!;
    const attachedPlan = result.batches.flatMap((batch) => batch.entries)
      .find((entry) => entry.voxel.sourceBlockId === "minecraft:attached_melon_stem")!;
    expect(unpackFaceTintKinds(redstonePlan.faceTintWord)[2]).toBe(REDSTONE_WIRE_FACE_TINT);
    expect(unpackFaceTintKinds(stemPlan.faceTintWord)[2]).toBe(GROWING_STEM_FACE_TINT);
    expect(unpackFaceTintKinds(attachedPlan.faceTintWord)[2]).toBe(ATTACHED_STEM_FACE_TINT);
    expect(result.batches.find((batch) => batch.entries.some((entry) => entry.voxel.sourceBlockId === "minecraft:attached_melon_stem"))?.stateTintRgb)
      .toBe(ATTACHED_STEM_TINT_RGB);
    expect(result.batches.filter((batch) => batch.entries.some((entry) => entry.voxel.sourceBlockId === "minecraft:attached_melon_stem" || entry.voxel.sourceBlockId === "minecraft:attached_pumpkin_stem")))
      .toHaveLength(1);
    expect(
      result.batches.flatMap((batch) => batch.entries)
        .filter((entry) => entry.voxel.sourceBlockId?.includes("attached_")),
    ).toHaveLength(8);
    atlas.dispose();
  });

  it("does not split vanilla state batches when a custom model has no tint-index faces", () => {
    const manifest = manifestFor([{
      blockId: "minecraft:redstone_wire",
      modelId: "minecraft:block/redstone_wire",
      faces: allFaces("minecraft:block/redstone_wire"),
    }]);
    const atlas = buildResourcePackAtlas(manifest);
    const result = createTextureBatches([
      sourceVoxel("minecraft:redstone_wire", 0, { power: "0" }),
      sourceVoxel("minecraft:redstone_wire", 1, { power: "15" }),
    ], manifest, atlas);

    expect(result.fallbackVoxels).toEqual([]);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.stateTintRgb).toBeUndefined();
    expect(result.batches[0]?.entries).toHaveLength(2);
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
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n#include <uv_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n}",
    };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

    expect(lookup.sequences).toHaveLength(1);
    expect(lookup.sequences[0]).toMatchObject({ totalTicks: 5, interpolate: true });
    expect(lookup.pixels.byteLength).toBeLessThan(page.texture.image.data.byteLength);
    expect(page.columns).toBe(atlas.source.pages[0]!.columns);
    expect(material.customProgramCacheKey()).toBe("blockcolc-atlas-v6-fluid-opaque-animated");
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
    manifest.colormaps = [{
      kind: "dry_foliage",
      resourceId: "minecraft:colormap/dry_foliage",
      archivePath: "assets/minecraft/textures/colormap/dry_foliage.png",
      width: 256,
      height: 256,
      png: solidRgbaPng(256, 256, [20, 30, 40, 255]),
    }];
    const atlas = buildResourcePackAtlas(manifest);
    const page = atlas.pages[0]!;
    const material = createAtlasMaterial(page, "opaque", undefined, 0xea0600);
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n#include <uv_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n}",
    };

    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

    expect(material.customProgramCacheKey()).toBe("blockcolc-atlas-v6-fluid-opaque-static");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordA0;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordA1;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordB0;");
    expect(shader.vertexShader).toContain("attribute vec3 instanceFaceUvWordB1;");
    expect(shader.vertexShader).toContain("attribute float instanceFaceTintKinds;");
    expect(shader.vertexShader).toContain("uniform vec3 blockcolcFoliageTint;");
    expect(shader.vertexShader).toContain("uniform vec3 blockcolcDryFoliageTint;");
    expect(shader.vertexShader).toContain("uniform vec3 blockcolcStateTint;");
    expect(shader.vertexShader).toContain("blockcolcTintKind < 10.5 ? blockcolcStateTint");
    expect(shader.vertexShader).toContain("blockcolcTintKind < 2.5 ? blockcolcGrassTint");
    expect(shader.vertexShader).toContain("mod(floor(instanceFaceTintKinds / blockcolcTintDivisor), 16.0)");
    expect(shader.vertexShader).toContain("float blockcolcFaceSlot = abs(normal.x)");
    expect(shader.vertexShader.match(/attribute float instanceFaceOcclusion;/g)).toHaveLength(1);
    expect(shader.vertexShader.match(/attribute float instanceMaterialResponse;/g)).toHaveLength(1);
    expect(shader.vertexShader).toContain("blockcolcPositionFluidMeta = instanceFaceOcclusion - 1000000.0");
    expect(shader.vertexShader).toContain("blockcolcCornerNorthWest");
    expect(shader.vertexShader).toContain("blockcolcUvFluidAngle");
    expect(shader.vertexShader).toContain("vBlockcolcFluidFlowing");
    expect(shader.vertexShader).toContain("blockcolcFaceSlot > 0.5 && blockcolcFaceSlot < 1.5");
    expect(shader.vertexShader).toContain("blockcolcFaceFluidMeta > 0.5 ? 0.0");
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
    });
    const materialUniforms = shader.uniforms as Record<string, THREE.IUniform>;
    expect((materialUniforms.blockcolcFoliageTint?.value as THREE.Color).equals(new THREE.Color(0x77ab2f))).toBe(true);
    expect((materialUniforms.blockcolcGrassTint?.value as THREE.Color).equals(new THREE.Color(0x91bd59))).toBe(true);
    expect((materialUniforms.blockcolcDryFoliageTint?.value as THREE.Color).equals(new THREE.Color(0x141e28))).toBe(true);
    expect((materialUniforms.blockcolcStateTint?.value as THREE.Color).equals(new THREE.Color(0xea0600))).toBe(true);

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

function sourceVoxel(sourceBlockId: string, x = 0, sourceBlockState?: Record<string, string>): BlueprintVoxel {
  return {
    x, y: 0, z: 0, materialId: "stone", buildOrder: 10000, sourceBlockId,
    ...(sourceBlockState ? { sourceBlockState } : {}),
  };
}

function allFaces(texture: string): Record<BlockFace, string> {
  return { down: texture, up: texture, north: texture, south: texture, west: texture, east: texture };
}

function rgbaPng(color: readonly [number, number, number, number]): Uint8Array {
  return rgbaStripPng([color]);
}

function solidRgbaPng(width: number, height: number, color: readonly [number, number, number, number]): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const stride = width * 4 + 1;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rows.set(color, y * stride + 1 + x * 4);
  }
  return concat(signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlibSync(rows)), pngChunk("IEND", new Uint8Array()));
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
