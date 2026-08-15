import * as THREE from "three";

export const ORIGINAL_MATERIAL_TEXTURE_SIZE = 16;

export const ORIGINAL_MATERIAL_PATTERNS = [
  "smooth",
  "stone",
  "cobble",
  "brick",
  "planks",
  "bark",
  "shingles",
  "fabric",
  "ceramic",
  "sand",
  "soil",
  "grass",
  "foliage",
  "glass",
  "metal",
  "ore",
  "sculk",
  "water",
  "lava",
  "path",
  "emissive",
] as const;

export type OriginalMaterialPattern = typeof ORIGINAL_MATERIAL_PATTERNS[number];

const patternSet = new Set<string>(ORIGINAL_MATERIAL_PATTERNS);

export function isOriginalMaterialPattern(value: string): value is OriginalMaterialPattern {
  return patternSet.has(value);
}

export function originalPatternForMaterialId(materialId: string): OriginalMaterialPattern {
  if (materialId === "stone" || materialId === "terrainStone") return "stone";
  if (materialId === "wood") return "bark";
  if (materialId === "plank") return "planks";
  if (materialId === "roof") return "shingles";
  if (materialId === "glass") return "glass";
  if (materialId === "grass") return "grass";
  if (materialId === "dirt") return "soil";
  if (materialId === "terrainWater") return "water";
  if (materialId === "terrainLava") return "lava";
  if (materialId === "leaves" || materialId === "vine") return "foliage";
  if (materialId === "path") return "path";
  if (materialId === "lamp") return "emissive";
  return "smooth";
}

/**
 * Vanilla block ids standing in for Blockcolc built-in building materials, so an
 * imported resource pack can retexture built-in blueprints the same way it
 * retextures imported Litematic voxels. Voxels that resolve no pack texture keep
 * their procedural original material, so packs never break the default look.
 */
export function builtinMaterialBlockId(materialId: string): string | undefined {
  if (materialId === "stone") return "minecraft:stone";
  if (materialId === "wood") return "minecraft:oak_log";
  if (materialId === "plank") return "minecraft:oak_planks";
  if (materialId === "roof") return "minecraft:bricks";
  if (materialId === "glass") return "minecraft:glass";
  if (materialId === "accent") return "minecraft:birch_planks";
  return undefined;
}

export function originalPatternForBlockId(sourceBlockId: string | undefined, materialId: string): OriginalMaterialPattern {
  const path = sourceBlockId?.toLowerCase().split(":").pop() ?? "";
  if (path === "water" || path === "bubble_column") return "water";
  if (path === "lava") return "lava";
  if (/(?:glass|ice)(?:$|_)/.test(path)) return "glass";
  if (/(?:^|_)(?:log|wood|stem|hyphae)(?:$|_)|bamboo_block/.test(path)) return "bark";
  if (/(?:planks|shelf|bookshelf|door|trapdoor|fence|gate|sign|button|pressure_plate)/.test(path)) return "planks";
  if (/(?:wool|carpet|bed|banner)/.test(path)) return "fabric";
  if (path.includes("concrete_powder") || /(?:^|_)(?:sand|gravel)(?:$|_)/.test(path)) return "sand";
  if (path.includes("concrete")) return "smooth";
  if (/(?:terracotta|clay)/.test(path)) return path.includes("glazed") ? "brick" : "ceramic";
  if (/(?:^|_)(?:ore|raw_iron|raw_gold|raw_copper)(?:$|_)/.test(path) || /(?:sulfur|cinnabar)/.test(path)) return "ore";
  if (/(?:cobblestone|cobbled|rubble)/.test(path)) return "cobble";
  if (/(?:brick|tiles?)/.test(path)) return "brick";
  if (/(?:copper|iron|gold|netherite|anvil|chain|hopper|cauldron|bell|rail|lightning_rod)/.test(path)) return "metal";
  if (path.includes("sculk")) return "sculk";
  if (/(?:torch|lantern|glowstone|shroomlight|froglight|sea_lantern|redstone_lamp|magma|fire|candle)/.test(path)) return "emissive";
  if (/(?:leaves|vine|moss|azalea|grass|fern|sapling|roots|lichen)/.test(path)) return "foliage";
  if (/(?:dirt|mud|podzol|mycelium|soul_soil)/.test(path)) return "soil";
  if (/(?:stone|deepslate|tuff|blackstone|basalt|netherrack|quartz|sandstone|prismarine|purpur|obsidian)/.test(path)) return "stone";
  return originalPatternForMaterialId(materialId);
}

export function createOriginalMaterialTexture(pattern: OriginalMaterialPattern): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    createOriginalMaterialPixels(pattern),
    ORIGINAL_MATERIAL_TEXTURE_SIZE,
    ORIGINAL_MATERIAL_TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = `blockcolc-original-${pattern}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.anisotropy = 2;
  texture.generateMipmaps = true;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export function createOriginalMaterialPixels(pattern: OriginalMaterialPattern): Uint8Array {
  const size = ORIGINAL_MATERIAL_TEXTURE_SIZE;
  const pixels = new Uint8Array(size * size * 4);
  const seed = ORIGINAL_MATERIAL_PATTERNS.indexOf(pattern) + 1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = originalMaterialTone(pattern, x, y, seed);
      const offset = (y * size + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export function createPlanarQuadUvs(positions: readonly number[], unitsPerTile = 4): Float32Array {
  if (positions.length % 12 !== 0) throw new Error("Planar UV generation requires independent four-vertex quads.");
  if (!Number.isFinite(unitsPerTile) || unitsPerTile <= 0) throw new Error("Planar UV scale must be positive.");
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let offset = 0; offset < positions.length; offset += 12) {
    const xs = [positions[offset]!, positions[offset + 3]!, positions[offset + 6]!, positions[offset + 9]!];
    const ys = [positions[offset + 1]!, positions[offset + 4]!, positions[offset + 7]!, positions[offset + 10]!];
    const zs = [positions[offset + 2]!, positions[offset + 5]!, positions[offset + 8]!, positions[offset + 11]!];
    const ranges = [range(xs), range(ys), range(zs)];
    const flatAxis = ranges.indexOf(Math.min(...ranges));
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const uvOffset = (offset / 3 + vertex) * 2;
      if (flatAxis === 1) {
        uvs[uvOffset] = xs[vertex]! / unitsPerTile;
        uvs[uvOffset + 1] = zs[vertex]! / unitsPerTile;
      } else if (flatAxis === 0) {
        uvs[uvOffset] = zs[vertex]! / unitsPerTile;
        uvs[uvOffset + 1] = ys[vertex]! / unitsPerTile;
      } else {
        uvs[uvOffset] = xs[vertex]! / unitsPerTile;
        uvs[uvOffset + 1] = ys[vertex]! / unitsPerTile;
      }
    }
  }
  return uvs;
}

function originalMaterialTone(pattern: OriginalMaterialPattern, x: number, y: number, seed: number): number {
  const fine = noise(x, y, seed);
  const coarse = noise(Math.floor(x / 3), Math.floor(y / 3), seed + 41);
  if (pattern === "smooth") return clampByte(247 + fine * 0.035);
  if (pattern === "stone") return clampByte(229 + fine * 0.1 + coarse * 0.07);
  if (pattern === "cobble") {
    const row = Math.floor(y / 4);
    const seam = y % 4 === 0 || (x + (row % 2) * 2 + (hash(row, seed, 7) & 1)) % 5 === 0;
    return clampByte(seam ? 164 + fine * 0.06 : 225 + fine * 0.12 + coarse * 0.06);
  }
  if (pattern === "brick") {
    const row = Math.floor(y / 4);
    const mortar = y % 4 === 0 || (x + (row % 2) * 4) % 8 === 0;
    return clampByte(mortar ? 176 + fine * 0.04 : 232 + fine * 0.09);
  }
  if (pattern === "planks") {
    const row = Math.floor(y / 4);
    const seam = y % 4 === 0 || (x + (row % 2) * 7) % 15 === 0;
    const grain = (y + Math.floor(fine / 42)) % 3 === 0 ? -8 : 5;
    return clampByte(seam ? 166 + fine * 0.04 : 232 + fine * 0.055 + grain);
  }
  if (pattern === "bark") {
    const crack = (x + Math.floor(coarse / 38)) % 5 === 0;
    const knot = (x - 5) ** 2 + (y - 9) ** 2 < 5 || (x - 13) ** 2 + (y - 3) ** 2 < 3;
    return clampByte(knot ? 170 + fine * 0.05 : crack ? 182 + fine * 0.06 : 229 + fine * 0.08 + coarse * 0.04);
  }
  if (pattern === "shingles") {
    const row = Math.floor(y / 5);
    const seam = y % 5 === 0 || (x + (row % 2) * 4) % 8 === 0;
    return clampByte(seam ? 162 + fine * 0.05 : 229 + fine * 0.08 + (y % 5) * 2);
  }
  if (pattern === "fabric") {
    const fibre = ((x + y) & 1) === 0 ? 9 : -5;
    const thread = x % 4 === 0 || y % 4 === 0 ? -8 : 0;
    return clampByte(238 + fibre + thread + fine * 0.035);
  }
  if (pattern === "ceramic") return clampByte(240 + fine * 0.055 + coarse * 0.025);
  if (pattern === "sand") {
    const grain = hash(x, y, seed) % 13 === 0 ? -30 : hash(x, y, seed + 9) % 17 === 0 ? 16 : 0;
    return clampByte(232 + fine * 0.075 + grain);
  }
  if (pattern === "soil") {
    const pebble = hash(x, y, seed) % 19 === 0 ? -35 : 0;
    return clampByte(216 + fine * 0.12 + coarse * 0.06 + pebble);
  }
  if (pattern === "grass") {
    const blade = (x * 3 + y * 5 + seed) % 17 === 0 ? 22 : 0;
    return clampByte(221 + fine * 0.11 + coarse * 0.045 + blade);
  }
  if (pattern === "foliage") {
    const cluster = hash(Math.floor(x / 2), Math.floor(y / 2), seed) % 5;
    return clampByte(205 + cluster * 10 + fine * 0.075);
  }
  if (pattern === "glass") {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const innerEdge = x === 1 || y === 1 || x === 14 || y === 14;
    const reflection = x - y === 4 || x - y === 5;
    return edge ? 190 : innerEdge ? 224 : reflection ? 255 : clampByte(246 + fine * 0.025);
  }
  if (pattern === "metal") {
    const seam = x === 0 || y === 0 || x === 8 || y === 8;
    const rivet = (x % 8 === 2 || x % 8 === 6) && (y % 8 === 2 || y % 8 === 6);
    return clampByte(rivet ? 255 : seam ? 184 + fine * 0.04 : 232 + fine * 0.07 + (x - y) * 0.35);
  }
  if (pattern === "ore") {
    const vein = hash(x, y, seed) % 11 < 2 || hash(x - 1, y + 1, seed) % 17 === 0;
    return clampByte(vein ? 255 : 214 + fine * 0.1 + coarse * 0.05);
  }
  if (pattern === "sculk") {
    const vein = (x * 5 + y * 3 + Math.floor(coarse / 24)) % 13 < 2;
    return clampByte(vein ? 248 : 182 + fine * 0.12 + coarse * 0.04);
  }
  if (pattern === "water") {
    const wave = Math.sin((x + y * 0.45) * Math.PI / 4) * 13;
    return clampByte(231 + wave + fine * 0.035);
  }
  if (pattern === "lava") {
    const vein = Math.abs(Math.sin((x * 0.65 + y * 0.9 + coarse * 0.018))) < 0.28;
    return clampByte(vein ? 255 : 203 + fine * 0.13 + coarse * 0.08);
  }
  if (pattern === "path") {
    const stone = hash(Math.floor(x / 2), Math.floor(y / 2), seed) % 4;
    const edge = x % 4 === 0 || y % 4 === 0;
    return clampByte(214 + stone * 8 + fine * 0.07 - (edge ? 12 : 0));
  }
  const cross = x === 7 || x === 8 || y === 7 || y === 8;
  return clampByte(cross ? 255 : 228 + fine * 0.08);
}

function noise(x: number, y: number, seed: number): number {
  return (hash(x, y, seed) & 0xff) - 127.5;
}

function hash(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ (seed * 0x45d9f3b), 0x27d4eb2d) ^ Math.imul(y + seed, 0x165667b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  return (value ^ (value >>> 13)) >>> 0;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function range(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}
