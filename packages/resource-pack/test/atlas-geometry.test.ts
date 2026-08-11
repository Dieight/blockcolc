import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ResolvedBlockGeometry } from "../src";
import {
  buildJava16xTextureAtlas,
  isP1BlockGeometry,
  mapBlockGeometryToAtlas,
  parseJava16xResourcePack,
  resolveBlockGeometry,
} from "../src";

describe("axis-aligned geometry atlas mapping", () => {
  it("maps inherited P1 multi-element geometry without inventing omitted faces", () => {
    const manifest = pack({
      "assets/minecraft/blockstates/oak_stairs.json": json({ variants: { "shape=straight": { model: "minecraft:block/oak_stairs" } } }),
      "assets/minecraft/models/block/stairs_base.json": json({
        textures: { all: "minecraft:block/base" },
        elements: [
          { from: [0, 0, 0], to: [16, 8, 16], faces: { down: { texture: "#all" }, north: { texture: "#all" } } },
          { from: [0, 8, 8], to: [16, 16, 16], shade: false, faces: { up: { texture: "#all", cullface: "up" } } },
        ],
      }),
      "assets/minecraft/models/block/oak_stairs.json": json({ parent: "minecraft:block/stairs_base", textures: { all: "minecraft:block/oak" } }),
      "assets/minecraft/textures/block/base.png": rgbaStrip(1, () => [20, 20, 20, 255]),
      "assets/minecraft/textures/block/oak.png": rgbaStrip(1, () => [120, 80, 40, 255]),
    });
    const geometry = resolveBlockGeometry(manifest, "minecraft:oak_stairs", { shape: "straight" });
    const mapped = mapBlockGeometryToAtlas(geometry, buildJava16xTextureAtlas(manifest));

    expect(mapped).toMatchObject({
      status: "resolved_geometry",
      elements: [
        { from: [0, 0, 0], to: [16, 8, 16], shade: true, faces: { down: { alphaMode: "opaque" }, north: { alphaMode: "opaque" } } },
        { from: [0, 8, 8], to: [16, 16, 16], shade: false, faces: { up: { cullFace: "up" } } },
      ],
    });
    if (mapped.status === "resolved_geometry") {
      expect(Object.keys(mapped.elements[0]!.faces)).toEqual(["down", "north"]);
      expect(Object.keys(mapped.elements[1]!.faces)).toEqual(["up"]);
    }
  });

  it("preserves cutout alpha and animation sequence on a declared geometry face", () => {
    const manifest = pack({
      "assets/minecraft/blockstates/oak_trapdoor.json": json({ variants: { "": { model: "minecraft:block/oak_trapdoor" } } }),
      "assets/minecraft/models/block/oak_trapdoor.json": json({
        textures: { all: "minecraft:block/animated_cutout" },
        elements: [{ from: [0, 0, 0], to: [16, 3, 16], faces: { up: { texture: "#all", uv: [1, 2, 15, 14], rotation: 90, tintindex: 2 } } }],
      }),
      "assets/minecraft/textures/block/animated_cutout.png": rgbaStrip(2, (x, y) => [10 + y, 20, 30, x === 0 ? 0 : 255]),
      "assets/minecraft/textures/block/animated_cutout.png.mcmeta": json({ animation: { frametime: 2, frames: [1, { index: 0, time: 3 }] } }),
    });
    const mapped = mapBlockGeometryToAtlas(
      resolveBlockGeometry(manifest, "minecraft:oak_trapdoor"),
      buildJava16xTextureAtlas(manifest),
    );

    expect(mapped).toMatchObject({
      status: "resolved_geometry",
      elements: [{ faces: { up: {
        alphaMode: "cutout",
        cropUv: [0.0625, 0.125, 0.9375, 0.875],
        rotation: 90,
        tintIndex: 2,
        animation: { totalTicks: 5, frames: [{ textureIndex: 1, time: 2 }, { textureIndex: 0, time: 3 }] },
      } } }],
    });
  });

  it("falls back atomically for a missing atlas texture or malformed geometry face", () => {
    const geometry: ResolvedBlockGeometry = {
      status: "resolved_geometry",
      modelId: "minecraft:block/test",
      elements: [
        { from: [0, 0, 0], to: [16, 8, 16], shade: true, faces: { north: face("minecraft:block/present") } },
        { from: [0, 8, 0], to: [16, 16, 16], shade: true, faces: { south: face("minecraft:block/missing") } },
      ],
    };
    const atlas = { entries: [entry("minecraft:block/present")] };
    expect(mapBlockGeometryToAtlas(geometry, atlas)).toEqual({
      status: "fallback", reason: "MISSING_ATLAS_TEXTURE", resourceId: "minecraft:block/missing",
    });

    const malformed = structuredClone(geometry) as unknown as ResolvedBlockGeometry;
    (malformed.elements[0]!.faces.north as unknown as { rotation: number }).rotation = 45;
    expect(mapBlockGeometryToAtlas(malformed, { entries: [entry("minecraft:block/present"), entry("minecraft:block/missing")] })).toEqual({
      status: "fallback", reason: "INVALID_FACE_METADATA", resourceId: "minecraft:block/present",
    });
  });
});

describe("P1 geometry scope", () => {
  it("keeps slab, straight stairs, trapdoor and door classification deterministic", () => {
    expect(isP1BlockGeometry("minecraft:stone_slab")).toBe(true);
    expect(isP1BlockGeometry("minecraft:oak_stairs", { shape: "straight" })).toBe(true);
    expect(isP1BlockGeometry("minecraft:oak_stairs")).toBe(false);
    expect(isP1BlockGeometry("minecraft:oak_stairs", { shape: "inner_left" })).toBe(false);
    expect(isP1BlockGeometry("minecraft:oak_stairs", { shape: "outer_right" })).toBe(false);
    expect(isP1BlockGeometry("minecraft:oak_trapdoor")).toBe(true);
    expect(isP1BlockGeometry("minecraft:oak_door")).toBe(true);
    expect(isP1BlockGeometry("custom:oak_slab")).toBe(false);
  });
});

function face(texture: string) {
  return { texture, uv: [0, 0, 16, 16] as const, rotation: 0 as const };
}

function entry(resourceId: string) {
  return {
    resourceId, index: 0, page: 0, pageTextureIndex: 0, x: 2, y: 2, width: 16 as const, height: 16 as const,
    uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, alphaMode: "opaque" as const,
  };
}

function pack(files: Record<string, Uint8Array>) {
  return parseJava16xResourcePack(zipSync({
    "pack.mcmeta": json({ pack: { pack_format: 34, description: "atlas geometry test" } }),
    ...files,
  }));
}

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function rgbaStrip(frameCount: number, pixel: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const height = frameCount * 16;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 16, false);
  view.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = new Uint8Array(height * 65);
  for (let y = 0; y < height; y += 1) {
    rows[y * 65] = 0;
    for (let x = 0; x < 16; x += 1) rows.set(pixel(x, y), y * 65 + 1 + x * 4);
  }
  return concat(signature, chunk("IHDR", ihdr), chunk("IDAT", zlibSync(rows)), chunk("IEND", new Uint8Array()));
}

function chunk(type: string, data: Uint8Array): Uint8Array {
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
  for (const array of arrays) { output.set(array, offset); offset += array.length; }
  return output;
}
