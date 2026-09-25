import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  decodeResourcePackSpecialTexture,
  parseJava16xResourcePack,
  RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS,
} from "../src";

describe("resource-pack special textures", () => {
  it("admits named renderer subtrees as decoded, PNG-only manifest assets outside the block atlas", () => {
    const files: Record<string, Uint8Array> = {
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "26.3 special assets" } }),
      "assets/minecraft/textures/entity/chest/normal.png": png(64, 64, [200, 20, 10, 255]),
      "assets/minecraft/textures/entity/shulker/shulker_blue.png": png(64, 64, [10, 20, 200, 255]),
      "assets/minecraft/textures/entity/conduit/wind.png": png(64, 704, [15, 25, 35, 255]),
      "assets/minecraft/textures/entity/skeleton/wither_skeleton.png": png(64, 32, [30, 40, 50, 255]),
      "assets/minecraft/textures/entity/banner/stripe_center.png": png(64, 64, [40, 50, 60, 255]),
      "assets/minecraft/textures/entity/decorated_pot/decorated_pot_side.png": png(16, 16, [50, 60, 70, 255]),
      "assets/minecraft/textures/entity/copper_golem/copper_golem_oxidized.png": png(64, 64, [60, 70, 80, 255]),
      "assets/minecraft/textures/entity/end_portal/end_portal.png": png(256, 256, [70, 80, 90, 255]),
      "assets/minecraft/textures/entity/player/wide/steve.png": png(64, 64, [80, 90, 100, 255]),
      "assets/minecraft/textures/entity/wolf/wolf.png": png(64, 32, [90, 100, 110, 255]),
      "assets/minecraft/textures/block/stone.png": png(16, 16, [100, 110, 120, 255]),
    };

    const manifest = parseJava16xResourcePack(zipSync(files));

    expect(manifest.textures.map(({ resourceId }) => resourceId)).toEqual(["minecraft:block/stone"]);
    expect(manifest.specialTextures?.map(({ resourceId }) => resourceId)).toEqual([
      "minecraft:entity/banner/stripe_center",
      "minecraft:entity/chest/normal",
      "minecraft:entity/conduit/wind",
      "minecraft:entity/copper_golem/copper_golem_oxidized",
      "minecraft:entity/decorated_pot/decorated_pot_side",
      "minecraft:entity/end_portal/end_portal",
      "minecraft:entity/player/wide/steve",
      "minecraft:entity/shulker/shulker_blue",
      "minecraft:entity/skeleton/wither_skeleton",
    ]);
    expect(manifest.specialTextures?.find(({ resourceId }) => resourceId === "minecraft:entity/chest/normal"))
      .toMatchObject({
        namespace: "minecraft",
        texturePath: "chest/normal",
        archivePath: "assets/minecraft/textures/entity/chest/normal.png",
        width: 64,
        height: 64,
      });
    expect(manifest.specialTextures?.find(({ resourceId }) => resourceId === "minecraft:entity/conduit/wind"))
      .toMatchObject({ width: 64, height: 704, texturePath: "conduit/wind" });
    const chest = manifest.specialTextures?.find(({ texturePath }) => texturePath === "chest/normal");
    expect(chest).toBeDefined();
    expect(decodeResourcePackSpecialTexture(chest!)).toEqual(new Uint8Array(64 * 64 * 4).map((_, index) => {
      const channel = index % 4;
      return channel === 0 ? 200 : channel === 1 ? 20 : channel === 2 ? 10 : 255;
    }));
    expect(manifest.summary.ignoredFileCount).toBe(1);
  });

  it("rejects corrupt and over-dimension PNGs while retaining other supported assets", () => {
    const manifest = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "invalid special assets" } }),
      "assets/minecraft/textures/entity/chest/normal.png": png(64, 64),
      "assets/minecraft/textures/entity/shulker/broken.png": strToU8("not PNG"),
      "assets/minecraft/textures/entity/end_portal/too_large.png": png(1025, 1),
    }));

    expect(manifest.specialTextures?.map(({ resourceId }) => resourceId)).toEqual(["minecraft:entity/chest/normal"]);
    expect(manifest.summary.issues).toEqual([
      expect.objectContaining({ path: "assets/minecraft/textures/entity/end_portal/too_large.png", code: "INVALID_SPECIAL_TEXTURE_PNG" }),
      expect.objectContaining({ path: "assets/minecraft/textures/entity/shulker/broken.png", code: "INVALID_SPECIAL_TEXTURE_PNG" }),
    ]);
  });

  it("caps special-texture count and ignores unrelated entity texture trees", () => {
    const files: Record<string, Uint8Array> = {
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "bounded special assets" } }),
      "assets/minecraft/textures/entity/wolf/wolf.png": png(16, 16),
    };
    for (let index = 0; index <= RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxTextureCount; index += 1) {
      files[`assets/test/textures/entity/chest/texture_${String(index).padStart(3, "0")}.png`] = png(1, 1);
    }

    const manifest = parseJava16xResourcePack(zipSync(files));

    expect(manifest.specialTextures).toHaveLength(RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxTextureCount);
    expect(manifest.summary.issues).toEqual([
      expect.objectContaining({ code: "SPECIAL_TEXTURE_LIMIT_EXCEEDED" }),
    ]);
    expect(manifest.summary.ignoredFileCount).toBe(1);
  });
});

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function png(width: number, height: number, pixel: readonly [number, number, number, number] = [1, 2, 3, 255]): Uint8Array {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width, false);
  new DataView(header.buffer).setUint32(4, height, false);
  header.set([8, 6, 0, 0, 0], 8);
  const scanlines = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) scanlines.set(pixel, row + 1 + x * 4);
  }
  return joinBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(scanlines)),
    chunk("IEND", new Uint8Array()),
  );
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  const output = new Uint8Array(12 + data.length);
  new DataView(output.buffer).setUint32(0, data.length, false);
  output.set(typeBytes, 4);
  output.set(data, 8);
  new DataView(output.buffer).setUint32(8 + data.length, crc32(joinBytes(typeBytes, data)), false);
  return output;
}

function joinBytes(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
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
