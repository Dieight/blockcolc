import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decodeResourcePackColormap, parseResourcePackColormaps } from "../src/colormap";
import { parseJava16xResourcePack } from "../src";

describe("Java grass and foliage colormaps", () => {
  it("strictly accepts the two 256x256 vanilla override locations", () => {
    const grass = rgbaPng(256, 256, [12, 34, 56, 255]);
    const foliage = rgbaPng(256, 256, [78, 90, 123, 255]);
    const files = {
      "assets/minecraft/textures/colormap/grass.png": grass,
      "assets/minecraft/textures/colormap/foliage.png": foliage,
    };
    const result = parseResourcePackColormaps(files, Object.keys(files));

    expect(result.issues).toEqual([]);
    expect(result.colormaps.map((entry) => entry.kind)).toEqual(["grass", "foliage"]);
    expect([...decodeResourcePackColormap(result.colormaps[0]!).slice(0, 4)]).toEqual([12, 34, 56, 255]);
  });

  it("recognizes but rejects wrong dimensions and corrupt pixels", () => {
    const path = "assets/minecraft/textures/colormap/grass.png";
    const wrong = parseResourcePackColormaps({ [path]: rgbaPng(255, 256, [1, 2, 3, 255]) }, [path]);
    const corrupt = rgbaPng(256, 256, [1, 2, 3, 255]);
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 0xff;
    const broken = parseResourcePackColormaps({ [path]: corrupt }, [path]);

    expect(wrong.colormaps).toEqual([]);
    expect(wrong.recognizedPaths).toEqual([path]);
    expect(wrong.issues[0]).toMatchObject({ code: "INVALID_COLORMAP" });
    expect(broken.issues[0]).toMatchObject({ code: "INVALID_COLORMAP" });
  });

  it("attaches valid colormaps to the schema-v1 manifest without counting them as ignored block textures", () => {
    const archive = zipSync({
      "pack.mcmeta": strToU8(JSON.stringify({ pack: { pack_format: 15, description: "colormap" } })),
      "assets/minecraft/textures/colormap/grass.png": rgbaPng(256, 256, [20, 40, 60, 255]),
      "assets/minecraft/textures/colormap/foliage.png": rgbaPng(256, 256, [70, 90, 110, 255]),
    });
    const manifest = parseJava16xResourcePack(archive);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.colormaps?.map((entry) => entry.kind)).toEqual(["grass", "foliage"]);
    expect(manifest.summary.ignoredFileCount).toBe(0);
    expect(manifest.summary.candidateTextureCount).toBe(0);
  });
});

function rgbaPng(width: number, height: number, color: readonly [number, number, number, number]): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) rows.set(color, row + 1 + x * 4);
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
  const output = new Uint8Array(arrays.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of arrays) { output.set(value, offset); offset += value.length; }
  return output;
}
