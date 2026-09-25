import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseJava16xResourcePack } from "../src/index";

describe("Java resource-pack overlays", () => {
  it("maps applicable overlay folders onto assets and applies entries in list priority order", () => {
    const result = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({
        pack: { min_format: [97, 1], max_format: 97, description: "overlay fixture" },
        overlays: { entries: [
          { directory: "legacy_263", formats: [97, 98] },
          { directory: "minor_range", min_format: [97, 1], max_format: 97 },
          { directory: "future", min_format: [98, 0], max_format: [98, 10] },
          { directory: "last_wins", formats: { min_inclusive: 97, max_inclusive: 98 }, min_format: [97, 1], max_format: [97, 1] },
        ] },
      }),
      "assets/minecraft/textures/block/stone.png": png(16, 16, 10),
      "assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "block/base" } } }),
      "overlays/legacy_263/assets/minecraft/textures/block/stone.png": png(32, 32, 20),
      "overlays/legacy_263/assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "block/legacy" } } }),
      "overlays/minor_range/assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "block/minor_range" } } }),
      "overlays/future/assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "block/future" } } }),
      "overlays/last_wins/assets/minecraft/textures/block/stone.png": png(32, 32, 30),
      "overlays/last_wins/assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "block/last_wins" } } }),
      "overlays/last_wins/pack.mcmeta": strToU8("not metadata"),
      "overlays/last_wins/pack.png": strToU8("not a pack icon"),
      "overlays/unlisted/assets/minecraft/textures/block/stone.png": png(16, 16, 40),
    }, { level: 6 }));

    expect(result.textures).toHaveLength(1);
    expect(result.textures[0]).toMatchObject({
      resourceId: "minecraft:block/stone",
      archivePath: "assets/minecraft/textures/block/stone.png",
      width: 32,
      height: 32,
    });
    expect(result.textures[0]?.png).toEqual(png(32, 32, 30));
    expect(result.blockStates[0]?.archivePath).toBe("assets/minecraft/blockstates/stone.json");
    expect(result.blockStates[0]?.variants[0]?.choices[0]?.model).toBe("minecraft:block/last_wins");
  });

  it("supports a 26.3 client JAR by extracting only the version file and assets tree", () => {
    const jar = zipSync({
      "version.json": json({ id: "26.3", pack_version: { resource_major: 97, resource_minor: 1 } }),
      "assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "block/stone" } } }),
      "assets/minecraft/textures/block/stone.png": png(32, 32, 50),
      "com/mojang/unrelated.class": new Uint8Array(5 * 1024 * 1024),
      "pack.png": strToU8("ignored by the parser"),
    }, { level: 6 });

    const result = parseJava16xResourcePack(jar);
    expect(result.pack).toEqual({
      packFormat: 97,
      minFormat: [97, 1],
      maxFormat: [97, 1],
      description: { text: "Minecraft Java Edition 26.3 client assets" },
    });
    expect(result.summary.archiveFileCount).toBe(5);
    expect(result.textures).toHaveLength(1);
    expect(result.textures[0]?.resourceId).toBe("minecraft:block/stone");
    expect(result.blockStates[0]?.resourceId).toBe("minecraft:stone");
  });

  it("accepts 64px static textures and 64px animation frames", () => {
    const result = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { min_format: [97, 1], max_format: [97, 1], description: "64px fixture" } }),
      "assets/minecraft/textures/block/straw_bed.png": png(64, 64, 70),
      "assets/minecraft/textures/block/water_flow.png": png(64, 128, 71),
      "assets/minecraft/textures/block/water_flow.png.mcmeta": json({ animation: { frametime: 2 } }),
    }, { level: 6 }));

    expect(result.textures.map((texture) => texture.resourceId)).toEqual([
      "minecraft:block/straw_bed",
      "minecraft:block/water_flow",
    ]);
    expect(result.textures[0]).toMatchObject({ width: 64, height: 64 });
    expect(result.textures[1]?.animation).toMatchObject({
      frameWidth: 64,
      frameHeight: 64,
      sourceFrameCount: 2,
      frametime: 2,
    });
  });

  it("does not treat arbitrary missing-metadata ZIPs as client JARs", () => {
    for (const version of [
      { id: "26.2", pack_version: { resource_major: 97, resource_minor: 1 } },
      { id: "26.3", pack_version: { resource_major: 97, resource_minor: 0 } },
    ]) {
      expect(() => parseJava16xResourcePack(zipSync({
        "version.json": json(version),
        "assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "block/stone" } } }),
        "assets/minecraft/textures/block/stone.png": png(16, 16, 60),
      }))).toThrowError(expect.objectContaining({ code: "MISSING_PACK_MCMETA" }));
    }
  });

  it("keeps a per-asset expansion limit on client JAR imports", () => {
    const jar = zipSync({
      "version.json": json({ id: "26.3", pack_version: { resource_major: 97, resource_minor: 1 } }),
      "assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "block/stone" } } }),
      "assets/minecraft/textures/block/oversized.png": new Uint8Array(4 * 1024 * 1024 + 1),
    }, { level: 6 });
    expect(() => parseJava16xResourcePack(jar)).toThrowError(
      expect.objectContaining({ code: "FILE_TOO_LARGE", path: "assets/minecraft/textures/block/oversized.png" }),
    );
  });

  it("rejects malformed overlay ranges and unsafe directory selectors", () => {
    for (const entry of [
      { directory: "../escape", formats: 97 },
      { directory: "half_range", min_format: [97, 1] },
      { directory: "inverted", min_format: [97, 2], max_format: [97, 1] },
      { directory: "no_range" },
    ]) {
      expect(() => parseJava16xResourcePack(zipSync({
        "pack.mcmeta": json({ pack: { pack_format: 97, description: "invalid overlay" }, overlays: { entries: [entry] } }),
      }))).toThrowError(expect.objectContaining({ code: "INVALID_PACK_MCMETA" }));
    }
    expect(() => parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({
        pack: { pack_format: 97, description: "duplicate overlay" },
        overlays: { entries: [
          { directory: "duplicate", formats: 97 },
          { directory: "duplicate", formats: 97 },
        ] },
      }),
    }))).toThrowError(expect.objectContaining({ code: "INVALID_PACK_MCMETA" }));
  });
});

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function png(width: number, height: number, marker: number): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header.set([8, 6, 0, 0, 0], 8);
  const rowBytes = width * 4;
  const pixels = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (rowBytes + 1);
    for (let x = 0; x < width; x += 1) pixels.set([marker, marker, marker, 255], row + 1 + x * 4);
  }
  return concat(signature, chunk("IHDR", header), chunk("IDAT", zlibSync(pixels)), chunk("IEND", new Uint8Array()));
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

function concat(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((total, array) => total + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
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
