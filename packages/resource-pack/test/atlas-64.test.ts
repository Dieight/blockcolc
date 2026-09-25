import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildJava16xTextureAtlas, parseJava16xResourcePack } from "../src";

describe("64px Java texture atlas", () => {
  it("keeps native-resolution neighbours on pages sized for their own tiles", () => {
    const manifest = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "64px atlas" } }),
      "assets/minecraft/textures/block/a_16.png": rgbaPng(16, 16, (x) => x === 0 ? [10, 20, 30, 255] : [40, 50, 60, 255]),
      "assets/minecraft/textures/block/b_64.png": rgbaPng(64, 64, (x) => x === 1 ? [70, 80, 90, 255] : [100, 110, 120, 255]),
    }));

    expect(manifest.summary.rejectedTextureCount).toBe(0);
    const atlas = buildJava16xTextureAtlas(manifest);
    expect(atlas.textureSize).toBe(64);
    expect(atlas.entries.map((entry) => entry.width)).toEqual([16, 64]);
    const [small, large] = atlas.entries;
    expect(pixelAt(atlas.pages[small!.page]!, small!.uv, 0)).toEqual([10, 20, 30, 255]);
    expect(atlas.pages[small!.page]!.textureSize).toBe(16);
    expect(pixelAt(atlas.pages[small!.page]!, small!.uv, 1)).toEqual([40, 50, 60, 255]);
    expect(atlas.pages[large!.page]!.textureSize).toBe(64);
    expect(pixelAt(atlas.pages[large!.page]!, large!.uv, 1)).toEqual([70, 80, 90, 255]);
  });

  it("keeps 64px animation frames in order and on one page", () => {
    const manifest = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "64px animation" } }),
      "assets/minecraft/textures/block/animated.png": rgbaPng(64, 128, (_x, y) => y < 64
        ? [10, 20, 30, 255] : [90, 100, 110, 128]),
      "assets/minecraft/textures/block/animated.png.mcmeta": json({ animation: { width: 64, height: 64, frames: [1, 0] } }),
    }));

    expect(manifest.summary.rejectedTextureCount).toBe(0);
    const atlas = buildJava16xTextureAtlas(manifest);
    expect(atlas.textureSize).toBe(64);
    const frames = atlas.entries[0]!.animation!.frames;
    expect(frames).toHaveLength(2);
    expect(new Set(frames.map((frame) => frame.page)).size).toBe(1);
    expect(pixelAt(atlas.pages[frames[0]!.page]!, frames[0]!.uv)).toEqual([90, 100, 110, 128]);
    expect(pixelAt(atlas.pages[frames[1]!.page]!, frames[1]!.uv)).toEqual([10, 20, 30, 255]);
  });
});

describe("malformed animation sidecars", () => {
  it("retains a square texture as static while reporting its invalid frame list", () => {
    const manifest = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "static fallback" } }),
      "assets/minecraft/textures/block/portal_eye.png": rgbaPng(16, 16, () => [40, 80, 120, 255]),
      "assets/minecraft/textures/block/portal_eye.png.mcmeta": json({ animation: { frames: [50] } }),
    }));
    expect(manifest.textures).toHaveLength(1);
    expect(manifest.textures[0]!.animation).toBeUndefined();
    expect(manifest.summary.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_TEXTURE_ANIMATION" }),
    ]));
    const atlas = buildJava16xTextureAtlas(manifest);
    expect(pixelAt(atlas.pages[0]!, atlas.entries[0]!.uv)).toEqual([40, 80, 120, 255]);
  });
});

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function rgbaPng(width: number, height: number, pixel: (x: number, y: number) => readonly number[]): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const stride = width * 4 + 1;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    rows[y * stride] = 0;
    for (let x = 0; x < width; x += 1) rows.set(pixel(x, y), y * stride + 1 + x * 4);
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

function pixelAt(page: { width: number; height: number; rgba: Uint8Array }, uv: { u0: number; v0: number }, offsetX = 0): number[] {
  const x = Math.round(uv.u0 * page.width) + offsetX;
  const y = Math.round(uv.v0 * page.height);
  return [...page.rgba.subarray((y * page.width + x) * 4, (y * page.width + x + 1) * 4)];
}
