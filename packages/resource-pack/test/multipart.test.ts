import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  isP2BlockGeometry,
  isSupportedBlockGeometry,
  parseJava16xResourcePack,
  resolveBlockGeometry,
  summarizeBlueprintCompatibility,
} from "../src";

describe("bounded multipart geometry", () => {
  it("combines every matching fence branch with complete directional rotation", () => {
    const manifest = fencePack();
    const state = { north: "true", east: "true", south: "true", west: "true" };
    const resolved = resolveBlockGeometry(manifest, "minecraft:oak_fence", state);

    expect(resolved.status).toBe("resolved_geometry");
    if (resolved.status !== "resolved_geometry") return;
    expect(resolved.modelId).toBe("minecraft:oak_fence");
    expect(resolved.elements).toHaveLength(5);
    expect(resolved.elements.slice(1).map((element) => `${element.from.join(",")}:${element.to.join(",")}`).sort()).toEqual([
      "0,6,7:8,10,9",
      "7,6,0:9,10,8",
      "7,6,8:9,10,16",
      "8,6,7:16,10,9",
    ]);

    const summary = summarizeBlueprintCompatibility({ id: "fence", voxels: [{ sourceBlockId: "minecraft:oak_fence", sourceBlockState: state }] }, manifest);
    expect(summary.blocks[0]).toMatchObject({ render: "resource-pack", model: { status: "supported" }, texture: { status: "supported" } });
  });

  it("requires all referenced state properties even when an unconditional post exists", () => {
    const manifest = fencePack(true);
    expect(resolveBlockGeometry(manifest, "minecraft:oak_fence", {})).toEqual({
      status: "fallback", reason: "NO_MATCHING_VARIANT", resourceId: "minecraft:oak_fence",
    });
    expect(resolveBlockGeometry(manifest, "minecraft:oak_fence", {
      north: "true", east: "false", south: "false", west: "false", waterlogged: "false",
    })).toMatchObject({ status: "resolved_geometry", elements: expect.arrayContaining([expect.any(Object), expect.any(Object)]) });
  });

  it("normalizes OR and alternative values and combines all matching pane parts", () => {
    const manifest = pack({
      "assets/minecraft/blockstates/glass_pane.json": json({ multipart: [
        { apply: { model: "minecraft:block/post" } },
        { when: { OR: [{ north: "true" }, { east: "true" }] }, apply: { model: "minecraft:block/side" } },
        { when: { north: "low|tall" }, apply: { model: "minecraft:block/cap" } },
        { when: { AND: [{ north: "low|tall" }, { OR: [{ east: "true" }, { west: "true" }] }] }, apply: { model: "minecraft:block/cap" } },
      ] }),
      ...models(1),
    });
    const blockState = manifest.blockStates[0]!;
    expect(blockState.multipart?.[1]?.when.clauses).toEqual([{ east: ["true"] }, { north: ["true"] }]);
    expect(blockState.multipart?.[2]?.when.clauses).toEqual([{ north: ["low", "tall"] }]);
    expect(blockState.multipart?.[3]?.when.clauses).toEqual([
      { east: ["true"], north: ["low", "tall"] },
      { north: ["low", "tall"], west: ["true"] },
    ]);
    expect(resolveBlockGeometry(manifest, "minecraft:glass_pane", { north: "low", east: "true", west: "false" })).toMatchObject({
      status: "resolved_geometry", elements: expect.arrayContaining([expect.any(Object), expect.any(Object), expect.any(Object), expect.any(Object)]),
    });
  });

  it("supports one-axis zero-thickness iron-bar planes but rejects unsafe degeneracy and face directions", () => {
    const manifest = pack({
      "assets/minecraft/blockstates/iron_bars.json": json({ multipart: [{ apply: { model: "minecraft:block/planes" } }] }),
      "assets/minecraft/models/block/planes.json": json({ textures: { all: "minecraft:block/texture" }, elements: [
        { from: [8, 0, 7], to: [8, 16, 9], faces: { west: { texture: "#all" }, east: { texture: "#all" } } },
        { from: [7, 0, 8], to: [9, 16, 8], faces: { north: { texture: "#all" }, south: { texture: "#all" } } },
      ] }),
      "assets/minecraft/models/block/two_axes.json": json({ textures: { all: "minecraft:block/texture" }, elements: [
        { from: [8, 0, 8], to: [8, 16, 8], faces: { east: { texture: "#all" } } },
      ] }),
      "assets/minecraft/models/block/wrong_face.json": json({ textures: { all: "minecraft:block/texture" }, elements: [
        { from: [8, 0, 7], to: [8, 16, 9], faces: { north: { texture: "#all" } } },
      ] }),
      "assets/minecraft/textures/block/texture.png": png16(),
    });
    expect(resolveBlockGeometry(manifest, "minecraft:iron_bars")).toMatchObject({ status: "resolved_geometry", elements: [{ from: [8, 0, 7], to: [8, 16, 9] }, { from: [7, 0, 8], to: [9, 16, 8] }] });
    expect(manifest.models.some((model) => model.resourceId === "minecraft:block/two_axes")).toBe(false);
    expect(manifest.models.some((model) => model.resourceId === "minecraft:block/wrong_face")).toBe(false);
  });

  it("accepts bounded weighted and array apply choices across namespaces, but rejects oversized definitions", () => {
    const tooMany = Array.from({ length: 65 }, () => ({ apply: { model: "minecraft:block/post" } }));
    const tooManyApply = Array.from({ length: 9 }, () => ({ model: "minecraft:block/post" }));
    const tooManyOr = Array.from({ length: 17 }, (_, index) => ({ north: String(index) }));
    const manifest = pack({
      "assets/minecraft/blockstates/weighted_fence.json": json({ multipart: [{ apply: { model: "minecraft:block/post", weight: 2 } }] }),
      "assets/minecraft/blockstates/array_fence.json": json({ multipart: [{ apply: [{ model: "minecraft:block/post" }, { model: "minecraft:block/side" }] }] }),
      "assets/minecraft/blockstates/single_array_fence.json": json({ multipart: [{ apply: [{ model: "minecraft:block/post" }] }] }),
      "assets/custom/blockstates/custom_fence.json": json({ multipart: [{ apply: { model: "custom:block/post" } }] }),
      "assets/minecraft/blockstates/huge_wall.json": json({ multipart: tooMany }),
      "assets/minecraft/blockstates/huge_apply.json": json({ multipart: [{ apply: tooManyApply }] }),
      "assets/minecraft/blockstates/bad_pane.json": json({ multipart: [{ when: { OR: tooManyOr }, apply: { model: "minecraft:block/post" } }] }),
      ...models(1),
      "assets/custom/models/block/post.json": json({ textures: { all: "minecraft:block/texture" }, elements: [{ from: [6, 0, 6], to: [10, 16, 10], faces: { north: { texture: "#all" } } }] }),
    });
    expect(manifest.blockStates.map((state) => state.resourceId)).toEqual([
      "custom:custom_fence", "minecraft:array_fence", "minecraft:single_array_fence", "minecraft:weighted_fence",
    ]);
    expect(resolveBlockGeometry(manifest, "minecraft:array_fence")).toMatchObject({ status: "resolved_geometry" });
    expect(manifest.summary.issues.filter((issue) => issue.code === "INVALID_BLOCKSTATE_JSON")).toHaveLength(3);
  });

  it("falls back atomically for hostile persisted metadata, missing branches and resolved geometry limits", () => {
    const manifest = fencePack();
    const persisted = structuredClone(manifest);
    persisted.blockStates[0]!.multipart![0]!.apply[0]!.weight = 0;
    expect(resolveBlockGeometry(persisted, "minecraft:oak_fence", { north: "false", east: "false", south: "false", west: "false" })).toEqual({
      status: "fallback", reason: "INVALID_MULTIPART", resourceId: "minecraft:oak_fence",
    });

    const missing = pack({
      "assets/minecraft/blockstates/cobblestone_wall.json": json({ multipart: [{ apply: { model: "minecraft:block/missing" } }] }),
    });
    expect(resolveBlockGeometry(missing, "minecraft:cobblestone_wall")).toEqual({
      status: "fallback", reason: "MISSING_MODEL", resourceId: "minecraft:block/missing",
    });

    const parts = Array.from({ length: 64 }, () => ({ apply: { model: "minecraft:block/three" } }));
    const limited = pack({
      "assets/minecraft/blockstates/huge_wall.json": json({ multipart: parts }),
      ...models(3),
    });
    expect(resolveBlockGeometry(limited, "minecraft:huge_wall")).toEqual({
      status: "fallback", reason: "GEOMETRY_LIMIT_EXCEEDED", resourceId: "minecraft:huge_wall",
    });
  });
});

describe("P2 scope", () => {
  it("only opens vanilla walls, normal fences, panes and iron bars", () => {
    expect(isP2BlockGeometry("minecraft:cobblestone_wall")).toBe(true);
    expect(isP2BlockGeometry("minecraft:oak_fence")).toBe(true);
    expect(isP2BlockGeometry("minecraft:glass_pane")).toBe(true);
    expect(isP2BlockGeometry("minecraft:iron_bars")).toBe(true);
    expect(isP2BlockGeometry("minecraft:oak_fence_gate")).toBe(false);
    expect(isP2BlockGeometry("custom:oak_fence")).toBe(false);
    expect(isSupportedBlockGeometry("minecraft:oak_fence")).toBe(true);
    expect(isSupportedBlockGeometry("minecraft:stone_slab")).toBe(true);
  });
});

function fencePack(includeWaterlogged = false) {
  const condition = (direction: string) => ({
    [direction]: "true",
    ...(includeWaterlogged && direction === "north" ? { waterlogged: "false" } : {}),
  });
  return pack({
    "assets/minecraft/blockstates/oak_fence.json": json({ multipart: [
      { apply: { model: "minecraft:block/post" } },
      { when: condition("north"), apply: { model: "minecraft:block/side" } },
      { when: condition("east"), apply: { model: "minecraft:block/side", y: 90 } },
      { when: condition("south"), apply: { model: "minecraft:block/side", y: 180 } },
      { when: condition("west"), apply: { model: "minecraft:block/side", y: 270 } },
    ] }),
    ...models(1),
  });
}

function models(elementCount: number): Record<string, Uint8Array> {
  const element = (from: number[], to: number[]) => ({ from, to, faces: { north: { texture: "#all" } } });
  const repeated = Array.from({ length: elementCount }, (_, index) => element([7, index, 0], [9, index + 1, 8]));
  return {
    "assets/minecraft/models/block/post.json": json({ textures: { all: "minecraft:block/texture" }, elements: [element([6, 0, 6], [10, 16, 10])] }),
    "assets/minecraft/models/block/side.json": json({ textures: { all: "minecraft:block/texture" }, elements: [element([7, 6, 0], [9, 10, 8])] }),
    "assets/minecraft/models/block/cap.json": json({ textures: { all: "minecraft:block/texture" }, elements: [element([7, 0, 7], [9, 16, 9])] }),
    "assets/minecraft/models/block/three.json": json({ textures: { all: "minecraft:block/texture" }, elements: repeated }),
    "assets/minecraft/textures/block/texture.png": png16(),
  };
}

function pack(files: Record<string, Uint8Array>) {
  return parseJava16xResourcePack(zipSync({ "pack.mcmeta": json({ pack: { pack_format: 34, description: "multipart" } }), ...files }));
}

function json(value: unknown): Uint8Array { return strToU8(JSON.stringify(value)); }

function png16(): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 16, false); view.setUint32(4, 16, false); ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(signature, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array([0])), chunk("IEND", new Uint8Array()));
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type); const output = new Uint8Array(12 + data.length); const view = new DataView(output.buffer);
  view.setUint32(0, data.length, false); output.set(typeBytes, 4); output.set(data, 8); view.setUint32(8 + data.length, crc32(concat(typeBytes, data)), false); return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0)); let offset = 0;
  for (const array of arrays) { output.set(array, offset); offset += array.length; } return output;
}
