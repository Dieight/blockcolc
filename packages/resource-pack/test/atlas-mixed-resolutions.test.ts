import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildJava16xTextureAtlas,
  estimatePngRgbaDecodeMemory,
  layerResourcePackManifests,
  parseJava16xResourcePack,
  TextureAtlasError,
} from "../src";

describe("native-resolution Java atlas pages", () => {
  it("keeps 16/32/64/128/256px static and animated textures native and page-local", () => {
    const files: Record<string, Uint8Array> = {
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "mixed resolution" } }),
      "assets/minecraft/textures/block/static16.png": rgbaPng(16, 16, () => [16, 1, 2, 255]),
      "assets/minecraft/textures/block/static32.png": rgbaPng(32, 32, () => [32, 1, 2, 255]),
      "assets/minecraft/textures/block/static64.png": rgbaPng(64, 64, () => [64, 1, 2, 255]),
      "assets/minecraft/textures/block/static128.png": rgbaPng(128, 128, () => [128, 1, 2, 255]),
      "assets/minecraft/textures/block/static256.png": rgbaPng(256, 256, () => [255, 1, 2, 255]),
      "assets/minecraft/textures/block/animated128.png": rgbaPng(128, 256, (_x, y) => y < 128
        ? [11, 0, 0, 255] : [12, 0, 0, 255]),
      "assets/minecraft/textures/block/animated128.png.mcmeta": json({ animation: { width: 128, height: 128, frames: [1, 0] } }),
      "assets/minecraft/textures/block/animated256.png": rgbaPng(256, 512, (_x, y) => y < 256
        ? [21, 0, 0, 255] : [22, 0, 0, 255]),
      "assets/minecraft/textures/block/animated256.png.mcmeta": json({ animation: { width: 256, height: 256, frames: [1, 0] } }),
    };
    const manifest = parseJava16xResourcePack(zipSync(files));
    expect(manifest.summary.rejectedTextureCount).toBe(0);

    const atlas = buildJava16xTextureAtlas(manifest, { maxPages: 5 });
    expect(atlas.textureSize).toBe(256);
    expect(atlas.pages.map((page) => page.textureSize)).toEqual([16, 32, 64, 128, 256]);
    for (const size of [16, 32, 64, 128, 256]) {
      const entry = atlas.entries.find((candidate) => candidate.width === size && !candidate.animation)!;
      expect(entry.height).toBe(size);
      expect(atlas.pages[entry.page]!.textureSize).toBe(size);
      expect(pixelAt(atlas.pages[entry.page]!, entry.uv)).toEqual([Math.min(size, 255), 1, 2, 255]);
    }
    for (const [name, first, second] of [["animated128", 12, 11], ["animated256", 22, 21]] as const) {
      const entry = atlas.entries.find((candidate) => candidate.resourceId.endsWith(name))!;
      expect(entry.width).toBe(name === "animated128" ? 128 : 256);
      expect(entry.animation!.frames.map((frame) => frame.page)).toEqual([entry.page, entry.page]);
      expect(entry.animation!.frames.map((frame) => pixelAt(atlas.pages[frame.page]!, frame.uv)[0])).toEqual([first, second]);
    }

    const estimate = atlas.memoryEstimate!;
    expect(estimate.normalizationBytes).toBe(0);
    expect(estimate.pageRgbaBytes).toBe(atlas.pages.reduce((sum, page) => sum + page.rgba.byteLength, 0));
    expect(estimate.estimatedGpuBytes).toBe(estimate.pageRgbaBytes + estimate.mipmapRgbaBytes + estimate.animationLookupRgbaBytes);
    expect(estimate.estimatedPeakBytes).toBe(
      estimate.reservedAtlasBytes + estimate.additionalWorkingSetBytes + estimate.sourcePngBytes
        + estimate.decoderWorkingSetBytes + estimate.pageRgbaBytes + estimate.mipmapRgbaBytes
        + estimate.animationLookupRgbaBytes + estimate.estimatedGpuBytes,
    );
    expect(estimate.estimatedPeakBytes).toBeLessThanOrEqual(estimate.limitBytes);
  });

  it("bounds a 26.3 base with 1300 low-resolution textures plus one 256px overlay", () => {
    const baseFiles: Record<string, Uint8Array> = {
      "version.json": json({ id: "26.3", pack_version: { resource_major: 97, resource_minor: 1 } }),
      "assets/minecraft/blockstates/stone.json": json({ variants: { "": { model: "block/stone" } } }),
    };
    for (let index = 0; index < 1300; index += 1) {
      const name = `base/tile_${String(index).padStart(4, "0")}`;
      baseFiles[`assets/minecraft/textures/block/${name}.png`] = rgbaPng(16, 16, () => [index % 256, 40, 80, 255]);
    }
    const base = parseJava16xResourcePack(zipSync(baseFiles, { level: 6 }));
    const overlay = parseJava16xResourcePack(zipSync({
      "pack.mcmeta": json({ pack: { pack_format: 97, description: "256px overlay" } }),
      "assets/minecraft/textures/block/high_detail.png": rgbaPng(256, 256, () => [240, 120, 60, 255]),
    }, { level: 6 }));
    const merged = layerResourcePackManifests(base, overlay);

    const atlas = buildJava16xTextureAtlas(merged);
    expect(merged.textures).toHaveLength(1301);
    expect(atlas.pages.map((page) => page.textureSize)).toEqual([16, 256]);
    expect(atlas.pages[0]).toMatchObject({ width: 1024, height: 1024 });
    expect(atlas.pages[1]).toMatchObject({ width: 512, height: 512 });
    expect(atlas.pages.reduce((sum, page) => sum + page.rgba.byteLength, 0)).toBe(5_242_880);
    const estimate = atlas.memoryEstimate!;
    expect(estimate.sourceRgbaBytes).toBe(1300 * 16 * 16 * 4 + 256 * 256 * 4);
    expect(estimate.normalizationBytes).toBe(0);
    expect(estimate.mipmapRgbaBytes).toBe(1_638_400);
    expect(estimate.sourcePngBytes).toBe(merged.textures.reduce((sum, texture) => sum + texture.png.byteLength, 0));
    expect(estimate.decoderWorkingSetBytes).toBe(
      Math.max(...merged.textures.map((texture) => estimatePngRgbaDecodeMemory(texture.png)!.workingSetBytes)),
    );
    expect(estimate.estimatedPeakBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
    expect(estimate.estimatedPeakBytes).toBe(
      estimate.sourcePngBytes + estimate.decoderWorkingSetBytes + estimate.pageRgbaBytes
        + estimate.mipmapRgbaBytes + estimate.estimatedGpuBytes,
    );
  });

  it("rejects an oversized PNG from its header before attempting pixel inflation", () => {
    const texture = {
      resourceId: "minecraft:block/oversized",
      namespace: "minecraft",
      texturePath: "oversized",
      archivePath: "assets/minecraft/textures/block/oversized.png",
      width: 4096,
      height: 4096,
      png: pngHeaderOnly(4096, 4096),
    };
    try {
      buildJava16xTextureAtlas({ textures: [texture] });
      throw new Error("expected atlas budget rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(TextureAtlasError);
      expect(error).toMatchObject({ code: "ATLAS_TOO_LARGE" });
      expect((error as Error).message).toContain("16777216 pixels");
      expect((error as Error).message).toContain("per-texture decode limit is 1048576 pixels");
    }
  });
});

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function rgbaPng(width: number, height: number, pixel: (x: number, y: number) => readonly number[]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rowBytes = width * 4;
  const scanlines = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (rowBytes + 1);
    for (let x = 0; x < width; x += 1) scanlines.set(pixel(x, y), row + 1 + x * 4);
  }
  return joinBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibSync(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  );
}

function pngHeaderOnly(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return joinBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array([0])),
    pngChunk("IEND", new Uint8Array()),
  );
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(joinBytes(typeBytes, data)), false);
  return chunk;
}

function joinBytes(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pixelAt(page: { width: number; rgba: Uint8Array }, uv: { u0: number; v0: number }): number[] {
  const x = Math.round(uv.u0 * page.width);
  const y = Math.round(uv.v0 * page.width);
  return [...page.rgba.subarray((y * page.width + x) * 4, (y * page.width + x + 1) * 4)];
}
