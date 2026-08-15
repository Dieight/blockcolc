import { parseJava16xResourcePack } from "@tomato-clock/resource-pack";
import { strToU8, zipSync, zlibSync } from "fflate";
import { expect, it } from "vitest";
import { builtinMaterialBlockId } from "../src/original-materials";
import { buildResourcePackAtlas, planTexturedVoxel } from "../src/resource-textures";
import type { BlueprintVoxel } from "../src/blueprint";

function concat(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) { output.set(array, offset); offset += array.length; }
  return output;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
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
function solidPng(color: readonly [number, number, number, number]): Uint8Array {
  const width = 16; const height = 16;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false); view.setUint32(4, height, false); ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) raw.set(color, row + 1 + x * 4);
  }
  return concat(signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", new Uint8Array(zlibSync(raw))), pngChunk("IEND", new Uint8Array()));
}

it("resolves every built-in stand-in block through the real 16x ZIP parser", () => {
  const files: Record<string, Uint8Array> = { "pack.mcmeta": strToU8(JSON.stringify({ pack: { pack_format: 34, description: "stand-in regression" } })) };
  const cubes: Record<string, readonly [number, number, number, number]> = {
    stone: [30, 30, 30, 255], oak_planks: [200, 120, 40, 255], bricks: [160, 40, 40, 255],
    glass: [80, 180, 255, 255], birch_planks: [220, 200, 150, 255], oak_log: [120, 80, 40, 255],
  };
  for (const [id, color] of Object.entries(cubes)) {
    files[`assets/minecraft/blockstates/${id}.json`] = strToU8(JSON.stringify({ variants: { "": { model: `minecraft:block/${id}` } } }));
    files[`assets/minecraft/models/block/${id}.json`] = strToU8(JSON.stringify({ parent: "block/cube_all", textures: { all: `block/${id}` } }));
    files[`assets/minecraft/textures/block/${id}.png`] = solidPng(color);
  }
  const manifest = parseJava16xResourcePack(zipSync(files, { level: 6 }));
  const atlas = buildResourcePackAtlas(manifest);
  for (const materialId of ["stone", "wood", "plank", "roof", "glass", "accent"] as const) {
    const voxel: BlueprintVoxel = { x: 0, y: 0, z: 0, materialId, buildOrder: 10000 };
    const plan = planTexturedVoxel(voxel, manifest, atlas);
    expect(plan, `${materialId} should resolve through ${builtinMaterialBlockId(materialId)}`).toBeDefined();
  }
  // A pack that provides none of the stand-ins keeps the procedural fallback.
  const empty = parseJava16xResourcePack(zipSync({ "pack.mcmeta": files["pack.mcmeta"]! }, { level: 6 }));
  const emptyAtlas = buildResourcePackAtlas(empty);
  const stone: BlueprintVoxel = { x: 0, y: 0, z: 0, materialId: "stone", buildOrder: 10000 };
  expect(planTexturedVoxel(stone, empty, emptyAtlas)).toBeUndefined();
  atlas.dispose();
  emptyAtlas.dispose();
});
