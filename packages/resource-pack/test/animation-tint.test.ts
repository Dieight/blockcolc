import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildJava16xTextureAtlas,
  decodePngRgba,
  mapBlockTexturesToAtlas,
  parseJava16xResourcePack,
  resolveBlockTextures,
} from "../src";

describe("safe texture animation metadata", () => {
  it("normalizes a bounded vertical strip and maps every source frame to an atlas tile", () => {
    const manifest = parseJava16xResourcePack(zip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/water.png": rgbaStrip(2, (_x, y) => y < 16 ? [10, 20, 30, 255] : [90, 100, 110, 128]),
      "assets/minecraft/textures/block/water.png.mcmeta": json({
        animation: { frametime: 2, interpolate: true, frames: [1, { index: 0, time: 3 }] },
      }),
    }));

    expect(manifest.textures[0]).toMatchObject({
      width: 16,
      height: 32,
      animation: {
        sourceFrameCount: 2,
        frametime: 2,
        interpolate: true,
        frames: [{ index: 1, time: 2 }, { index: 0, time: 3 }],
      },
    });
    expect(manifest.summary.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ANIMATION_INTERPOLATION_DEGRADED" }),
    ]));

    const atlas = buildJava16xTextureAtlas(manifest);
    const entry = atlas.entries[0]!;
    expect(entry.alphaMode).toBe("translucent");
    expect(entry.animation).toMatchObject({ interpolate: true, totalTicks: 5 });
    expect(entry.animation?.frames.map((frame) => ({ textureIndex: frame.textureIndex, time: frame.time }))).toEqual([
      { textureIndex: 1, time: 2 },
      { textureIndex: 0, time: 3 },
    ]);
    expect(entry.index).toBe(1);
    expect(entry.uv).toEqual(entry.animation?.frames[0]?.uv);
    const page = atlas.pages[0]!;
    expect(page.columns).toBeGreaterThanOrEqual(2);
    const frameOne = entry.animation!.frames[0]!;
    const frameZero = entry.animation!.frames[1]!;
    expect(pixelAt(page, frameOne.uv)).toEqual([90, 100, 110, 128]);
    expect(pixelAt(page, frameZero.uv)).toEqual([10, 20, 30, 255]);
  });

  it("rejects strips without animation metadata and unsafe frame references", () => {
    const missing = parseJava16xResourcePack(zip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/missing.png": rgbaStrip(2, () => [1, 2, 3, 255]),
    }));
    expect(missing.textures).toEqual([]);
    expect(missing.summary.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_TEXTURE_ANIMATION" }),
    ]));

    const outOfRange = parseJava16xResourcePack(zip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/bad.png": rgbaStrip(2, () => [1, 2, 3, 255]),
      "assets/minecraft/textures/block/bad.png.mcmeta": json({ animation: { frames: [2] } }),
    }));
    expect(outOfRange.textures).toEqual([]);
    expect(outOfRange.summary.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_TEXTURE_ANIMATION", path: "assets/minecraft/textures/block/bad.png.mcmeta" }),
    ]));
  });

  it("keeps every frame of one animation on a single bounded atlas page", () => {
    const files: Record<string, Uint8Array> = { "pack.mcmeta": packMetadata };
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      files[`assets/minecraft/textures/block/${name}.png`] = rgbaStrip(1, () => [10, 20, 30, 255]);
    }
    files["assets/minecraft/textures/block/z_animated.png"] = rgbaStrip(2, (_x, y) => y < 16
      ? [40, 50, 60, 255]
      : [70, 80, 90, 255]);
    files["assets/minecraft/textures/block/z_animated.png.mcmeta"] = json({ animation: { frames: [0, 1] } });
    const atlas = buildJava16xTextureAtlas(parseJava16xResourcePack(zip(files)), { maxPageSize: 64 });
    const animated = atlas.entries.find((entry) => entry.resourceId.endsWith("z_animated"))!;

    expect(atlas.pages).toHaveLength(2);
    expect(animated.page).toBe(1);
    expect(animated.pageTextureIndex).toBe(0);
    expect(new Set(animated.animation!.frames.map((frame) => frame.page))).toEqual(new Set([1]));
    expect(animated.animation!.frames.map((frame) => frame.pageTextureIndex)).toEqual([0, 1]);
  });

  it("accepts 32px Java animation frames and downsamples them with premultiplied-alpha box filtering", () => {
    const manifest = parseJava16xResourcePack(zip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/flow.png": rgbaPng(32, 64, (x, y) => {
        if (y >= 32) return [90, 100, 110, 128];
        return x % 2 === 0 ? [200, 20, 10, 255] : [0, 0, 255, 0];
      }),
      "assets/minecraft/textures/block/flow.png.mcmeta": json({ animation: {} }),
    }));

    expect(manifest.textures[0]?.animation).toMatchObject({
      frameWidth: 32,
      frameHeight: 32,
      sourceColumns: 1,
      sourceRows: 2,
      sourceFrameCount: 2,
    });
    const atlas = buildJava16xTextureAtlas(manifest);
    const entry = atlas.entries[0]!;
    expect(entry.alphaMode).toBe("translucent");
    expect(pixelAt(atlas.pages[0]!, entry.animation!.frames[0]!.uv)).toEqual([200, 20, 10, 128]);
    expect(pixelAt(atlas.pages[0]!, entry.animation!.frames[1]!.uv)).toEqual([90, 100, 110, 128]);
  });

  it("uses row-major Java frame indexes for horizontal and two-dimensional grids", () => {
    const files: Record<string, Uint8Array> = { "pack.mcmeta": packMetadata };
    for (let index = 0; index < 6; index += 1) files[`assets/minecraft/textures/block/a${index}.png`] = rgbaStrip(1, () => [1, 2, 3, 255]);
    files["assets/minecraft/textures/block/horizontal.png"] = rgbaPng(64, 32, (x) => x < 32 ? [11, 0, 0, 255] : [22, 0, 0, 255]);
    files["assets/minecraft/textures/block/horizontal.png.mcmeta"] = json({ animation: {} });
    files["assets/minecraft/textures/block/z_grid.png"] = rgbaPng(64, 64, (x, y) => [1 + Math.floor(x / 32) + Math.floor(y / 32) * 2, 0, 0, 255]);
    files["assets/minecraft/textures/block/z_grid.png.mcmeta"] = json({ animation: { width: 32, height: 32, frames: [3, 0, 2, 1] } });

    const atlas = buildJava16xTextureAtlas(parseJava16xResourcePack(zip(files)), { maxPageSize: 64 });
    const horizontal = atlas.entries.find((entry) => entry.resourceId.endsWith("horizontal"))!;
    const grid = atlas.entries.find((entry) => entry.resourceId.endsWith("z_grid"))!;
    expect(horizontal.animation!.frames.map((frame) => pixelAt(atlas.pages[frame.page]!, frame.uv)[0])).toEqual([11, 22]);
    expect(grid.page).toBe(1);
    expect(new Set(grid.animation!.frames.map((frame) => frame.page))).toEqual(new Set([1]));
    expect(grid.animation!.frames.map((frame) => pixelAt(atlas.pages[frame.page]!, frame.uv)[0])).toEqual([4, 1, 3, 2]);
  });

  it("rejects unsafe frame geometry and exposes a bounded reusable RGBA decoder", () => {
    const invalid = parseJava16xResourcePack(zip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/textures/block/invalid.png": rgbaPng(64, 64, () => [1, 2, 3, 255]),
      "assets/minecraft/textures/block/invalid.png.mcmeta": json({ animation: { width: 32, height: 16 } }),
    }));
    expect(invalid.textures).toEqual([]);
    expect(invalid.summary.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVALID_TEXTURE_ANIMATION" })]));

    const colormap = rgbaPng(256, 256, (x, y) => [x, y, 7, 255]);
    const decoded = decodePngRgba(colormap, {
      expectedWidth: 256,
      expectedHeight: 256,
      maxWidth: 256,
      maxHeight: 256,
      maxPixels: 65_536,
      maxDecodedBytes: 262_144,
    });
    expect(decoded.rgba.slice(0, 4)).toEqual(new Uint8Array([0, 0, 7, 255]));
    expect(() => decodePngRgba(colormap, { maxPixels: 65_535 })).toThrow("configured bounds");
  });
});

describe("safe face tint metadata", () => {
  it("preserves tintindex through model resolution and atlas mapping", () => {
    const face = { texture: "#all", tintindex: 1 };
    const manifest = parseJava16xResourcePack(zip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/tinted.json": json({ variants: { "": { model: "minecraft:block/tinted" } } }),
      "assets/minecraft/models/block/tinted.json": json({
        textures: { all: "minecraft:block/tinted" },
        elements: [{
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: { down: face, up: face, north: face, south: face, west: face, east: face },
        }],
      }),
      "assets/minecraft/textures/block/tinted.png": rgbaStrip(1, () => [200, 200, 200, 255]),
    }));
    const resolved = resolveBlockTextures(manifest, "minecraft:tinted");
    expect(resolved).toMatchObject({ status: "resolved", faceMetadata: { north: { tintIndex: 1 } } });

    const mapped = mapBlockTexturesToAtlas(resolved, buildJava16xTextureAtlas(manifest));
    expect(mapped).toMatchObject({ status: "resolved", faces: { north: { tintIndex: 1 } } });
  });

  it("rejects negative, fractional and excessively large tint indexes without accepting the model", () => {
    for (const tintindex of [-1, 0.5, 256]) {
      const manifest = parseJava16xResourcePack(zip({
        "pack.mcmeta": packMetadata,
        "assets/minecraft/models/block/bad_tint.json": json({
          elements: [{
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: { north: { texture: "#all", tintindex } },
          }],
          textures: { all: "minecraft:block/stone" },
        }),
        "assets/minecraft/textures/block/stone.png": rgbaStrip(1, () => [1, 2, 3, 255]),
      }));
      expect(manifest.summary.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_MODEL_JSON" }),
      ]));
      expect(manifest.models).toEqual([]);
    }
  });

  it("honors the 26.2 force_translucent texture descriptor on opaque pixels", () => {
    const face = { texture: "#all" };
    const manifest = parseJava16xResourcePack(zip({
      "pack.mcmeta": packMetadata,
      "assets/minecraft/blockstates/forced.json": json({ variants: { "": { model: "minecraft:block/forced" } } }),
      "assets/minecraft/models/block/forced.json": json({
        textures: { all: { sprite: "minecraft:block/opaque", force_translucent: true } },
        elements: [{
          from: [0, 0, 0], to: [16, 16, 16],
          faces: { down: face, up: face, north: face, south: face, west: face, east: face },
        }],
      }),
      "assets/minecraft/textures/block/opaque.png": rgbaStrip(1, () => [200, 200, 200, 255]),
    }));
    const resolved = resolveBlockTextures(manifest, "minecraft:forced");

    expect(manifest.models[0]).toMatchObject({
      textures: { all: "minecraft:block/opaque" }, forceTranslucentTextures: { all: true },
    });
    expect(resolved).toMatchObject({ status: "resolved", faceMetadata: { north: { forceTranslucent: true } } });
    expect(mapBlockTexturesToAtlas(resolved, buildJava16xTextureAtlas(manifest))).toMatchObject({
      status: "resolved", faces: { north: { alphaMode: "translucent" } },
    });
  });
});

const packMetadata = json({ pack: { pack_format: 34, description: "animation/tint test" } });

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

function zip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 6 });
}

function rgbaStrip(
  frameCount: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array {
  const height = frameCount * 16;
  return rgbaPng(16, height, pixel);
}

function rgbaPng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array {
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

function pixelAt(
  page: { width: number; height: number; rgba: Uint8Array },
  uv: { u0: number; v0: number },
): number[] {
  const x = Math.round(uv.u0 * page.width);
  const y = Math.round(uv.v0 * page.height);
  const offset = (y * page.width + x) * 4;
  return [...page.rgba.subarray(offset, offset + 4)];
}
