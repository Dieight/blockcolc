import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LitematicParseError, parseLitematic, readPackedIndex } from "../src/index.js";
import { parseJavaNbt } from "../src/nbt.js";
import { testNbt as nbt, writeJavaNbt } from "./nbt-fixture.js";

const samples = [
  { file: "a94f3c5d-b4ad-42e1-ba26-f474b204b0ea.litematic", dataVersion: 3953, dimensions: { width: 18, height: 35, depth: 20 }, blocks: 1846 },
  { file: "bd29cade-7000-42b7-adc1-0631ce512c30.litematic", dataVersion: 3465, dimensions: { width: 40, height: 21, depth: 20 }, blocks: 4301 },
] as const;
const sampleUrl = (file: string) => new URL(`../../../litematic/${file}`, import.meta.url);
const describeSampleCompatibility = samples.every((sample) => existsSync(sampleUrl(sample.file))) ? describe : describe.skip;

describeSampleCompatibility("Litematic sample compatibility", () => {

  for (const sample of samples) {
    it(`imports ${sample.file}`, async () => {
      const input = readFileSync(sampleUrl(sample.file));
      const result = await parseLitematic(input);
      expect(result.preview.minecraftDataVersion).toBe(sample.dataVersion);
      expect(result.preview.dimensions).toEqual(sample.dimensions);
      expect(result.preview.nonAirBlockCount).toBe(sample.blocks);
      expect(result.preview.metadataTotalBlocks).toBe(sample.blocks);
      expect(result.preview.regionCount).toBe(1);
      expect(result.preview.compatibility.ignoredTileEntities).toBeGreaterThan(0);
      expect(result.blueprint.voxels).toHaveLength(sample.blocks);
      expect(result.blueprint.voxels[0]?.buildOrder).toBe(0);
      expect(result.blueprint.voxels.at(-1)?.buildOrder).toBe(10000);
      expect(new Set(result.blueprint.voxels.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`)).size).toBe(sample.blocks);
      const byCoordinate = new Map(result.blueprint.voxels.map((voxel) => [`${voxel.x}:${voxel.y}:${voxel.z}`, voxel]));
      const upperBeforeSupport = result.blueprint.voxels.filter((voxel) => {
        const below = byCoordinate.get(`${voxel.x}:${voxel.y - 1}:${voxel.z}`);
        return below !== undefined && below.buildOrder > voxel.buildOrder;
      });
      expect(upperBeforeSupport).toEqual([]);
    });
  }
});

describe("Litematic decoding boundaries", () => {
  it("reads palette values that straddle signed 64-bit longs", () => {
    const values = Array.from({ length: 22 }, (_, index) => index % 8);
    const packed = pack(values, 3);
    expect(values.map((_, index) => readPackedIndex(packed, index, 3))).toEqual(values);
  });

  it("honors negative region sizes, merges regions, ignores air and uses an explicit placeholder", async () => {
    const input = makeLitematic({
      regions: {
        negative: makeRegion({ position: { x: 10, y: 4, z: 8 }, size: { x: -2, y: -2, z: 2 }, palette: ["minecraft:air", "minecraft:stone", "example:unknown_block"], values: [1, 0, 2, 0, 1, 0, 0, 1] }),
        positive: makeRegion({ position: { x: 20, y: 4, z: 8 }, size: { x: 1, y: 1, z: 1 }, palette: ["minecraft:air", "minecraft:glass"], values: [1] }),
      },
    });
    const result = await parseLitematic(input);
    expect(result.preview.regionCount).toBe(2);
    expect(result.preview.nonAirBlockCount).toBe(5);
    expect(result.preview.dimensions).toEqual({ width: 12, height: 2, depth: 2 });
    expect(result.preview.compatibility.placeholderBlockNames).toEqual(["example:unknown_block"]);
    expect(result.preview.compatibility.placeholderVoxelCount).toBe(1);
    expect(result.blueprint.bounds).toEqual({ minX: 0, maxX: 11, minY: 0, maxY: 1, minZ: 0, maxZ: 1 });
    await expect(parseLitematic(input, { limits: { maxHorizontalAxisLength: 10 } })).rejects.toEqual(
      expect.objectContaining({ code: "LIMIT_EXCEEDED" }),
    );
  });

  it("preserves source block IDs and Minecraft light emission semantics", async () => {
    const lights: Array<{ state: PaletteInput; kind: string; level: number }> = [
      { state: "minecraft:torch", kind: "torch", level: 14 },
      { state: "minecraft:soul_wall_torch", kind: "soul_torch", level: 10 },
      { state: "minecraft:lantern", kind: "lantern", level: 15 },
      { state: "minecraft:soul_lantern", kind: "soul_lantern", level: 10 },
      { state: { name: "minecraft:red_candle", properties: { lit: "true", candles: "4" } }, kind: "candle", level: 12 },
      { state: { name: "minecraft:campfire", properties: { lit: "true" } }, kind: "campfire", level: 15 },
      { state: { name: "minecraft:soul_campfire", properties: { lit: "true" } }, kind: "soul_campfire", level: 10 },
      { state: "minecraft:glowstone", kind: "glowstone", level: 15 },
      { state: "minecraft:sea_lantern", kind: "sea_lantern", level: 15 },
      { state: "minecraft:shroomlight", kind: "shroomlight", level: 15 },
      { state: "minecraft:ochre_froglight", kind: "froglight", level: 15 },
      { state: "minecraft:verdant_froglight", kind: "froglight", level: 15 },
      { state: "minecraft:pearlescent_froglight", kind: "froglight", level: 15 },
      { state: "minecraft:end_rod", kind: "end_rod", level: 14 },
      { state: "minecraft:jack_o_lantern", kind: "jack_o_lantern", level: 15 },
      { state: { name: "minecraft:redstone_torch", properties: { lit: "true" } }, kind: "redstone_torch", level: 7 },
      { state: { name: "minecraft:light", properties: { level: "6" } }, kind: "light", level: 6 },
    ];
    const input = makeLitematic({ regions: { lights: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: lights.length + 1, y: 1, z: 1 },
      palette: ["minecraft:stone", ...lights.map(({ state }) => state)],
      values: Array.from({ length: lights.length + 1 }, (_, index) => index),
    }) } });
    const result = await parseLitematic(input);
    expect(result.preview.compatibility.placeholderPaletteEntries).toBe(0);
    const bySource = new Map(result.blueprint.voxels.map((voxel) => [voxel.sourceBlockId, voxel]));
    expect(bySource.get("minecraft:stone")).not.toHaveProperty("emissiveKind");
    for (const { state, kind, level } of lights) {
      const name = typeof state === "string" ? state : state.name;
      expect(bySource.get(name), name).toMatchObject({ emissiveKind: kind, emissiveLevel: level });
    }
  });

  it("orders newly imported structure through connected supports before upper frame blocks", async () => {
    const input = makeLitematic({ regions: { supported: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 3, z: 1 },
      palette: ["minecraft:stone", "minecraft:oak_log"],
      values: [0, 0, 1],
    }) } });
    const voxels = (await parseLitematic(input)).blueprint.voxels;
    const lowerWall = voxels.find((voxel) => voxel.y === 1)!;
    const upperFrame = voxels.find((voxel) => voxel.y === 2)!;
    expect(lowerWall.sourceBlockId).toBe("minecraft:stone");
    expect(upperFrame.sourceBlockId).toBe("minecraft:oak_log");
    expect(lowerWall.buildOrder).toBeLessThan(upperFrame.buildOrder);
  });

  it("keeps every connected construction step adjacent to the already built prefix", async () => {
    const input = makeLitematic({ regions: { connected: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 4, z: 1 },
      palette: ["minecraft:stone", "minecraft:oak_log", "minecraft:glass", "minecraft:lantern"],
      values: [0, 0, 0, 0, 1, 0, 1, 2, 1, 1, 3, 1],
    }) } });
    const ordered = [...(await parseLitematic(input)).blueprint.voxels]
      .sort((left, right) => left.buildOrder - right.buildOrder);
    const built = new Set<string>();
    for (const [index, voxel] of ordered.entries()) {
      const adjacent = [
        `${voxel.x - 1}:${voxel.y}:${voxel.z}`, `${voxel.x + 1}:${voxel.y}:${voxel.z}`,
        `${voxel.x}:${voxel.y - 1}:${voxel.z}`, `${voxel.x}:${voxel.y + 1}:${voxel.z}`,
        `${voxel.x}:${voxel.y}:${voxel.z - 1}`, `${voxel.x}:${voxel.y}:${voxel.z + 1}`,
      ].some((key) => built.has(key));
      if (index >= 3) expect(adjacent, `${voxel.x}:${voxel.y}:${voxel.z}`).toBe(true);
      built.add(`${voxel.x}:${voxel.y}:${voxel.z}`);
    }
    const lastStone = ordered.reduce((last, voxel, index) => voxel.sourceBlockId === "minecraft:stone" ? index : last, -1);
    expect(ordered.findIndex((voxel) => voxel.sourceBlockId === "minecraft:lantern")).toBeGreaterThan(lastStone);
  });

  it("preserves complete block-state properties with stable key ordering and omits empty state", async () => {
    const input = makeLitematic({ regions: { states: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 1, z: 1 },
      palette: [
        { name: "minecraft:oak_stairs", properties: { waterlogged: "false", shape: "inner_left", facing: "west", half: "top" } },
        "minecraft:stone",
      ],
      values: [0, 1],
    }) } });
    const result = await parseLitematic(input);
    const stairs = result.blueprint.voxels.find((voxel) => voxel.sourceBlockId === "minecraft:oak_stairs");
    const stone = result.blueprint.voxels.find((voxel) => voxel.sourceBlockId === "minecraft:stone");
    expect(stairs?.sourceBlockState).toEqual({ facing: "west", half: "top", shape: "inner_left", waterlogged: "false" });
    expect(Object.keys(stairs!.sourceBlockState!)).toEqual(["facing", "half", "shape", "waterlogged"]);
    expect(stone).not.toHaveProperty("sourceBlockState");
  });

  it("rejects unsafe block-state property names and empty values", async () => {
    const propertyCases: Array<Record<string, string>> = [{ Uppercase: "north" }, { facing: "" }];
    for (const properties of propertyCases) {
      const input = makeLitematic({ regions: { invalid: makeRegion({
        position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 },
        palette: [{ name: "minecraft:oak_stairs", properties }], values: [0],
      }) } });
      await expect(parseLitematic(input)).rejects.toBeInstanceOf(LitematicParseError);
    }
  });

  it("does not mark extinguished light sources or ordinary decorations as emissive", async () => {
    const input = makeLitematic({ regions: { unlit: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 1, z: 1 },
      palette: [
        { name: "minecraft:candle", properties: { lit: "false" } },
        { name: "minecraft:campfire", properties: { lit: "false" } },
        { name: "minecraft:redstone_wall_torch", properties: { lit: "false" } },
        "minecraft:flower_pot",
      ],
      values: [0, 1, 2, 3],
    }) } });
    for (const voxel of (await parseLitematic(input)).blueprint.voxels) {
      expect(voxel).not.toHaveProperty("emissiveKind");
      expect(voxel).not.toHaveProperty("emissiveLevel");
    }
  });

  it("rejects non-gzip input and enforces region volume limits", async () => {
    await expect(parseLitematic(new Uint8Array([10, 0, 0]))).rejects.toEqual(expect.objectContaining({ code: "NOT_GZIP" }));
    const input = makeLitematic({ regions: { huge: makeRegion({ position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, palette: ["minecraft:air"], values: Array(8).fill(0) }) } });
    await expect(parseLitematic(input, { limits: { maxRegionVolume: 7 } })).rejects.toEqual(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });

  it("stops gzip expansion at the configured decompressed byte limit", async () => {
    const compressed = gzipSync(Buffer.alloc(2048));
    await expect(parseLitematic(compressed, { limits: { maxUncompressedBytes: 1024 } })).rejects.toEqual(
      expect.objectContaining({ code: "NBT_TOO_LARGE" }),
    );
  });

  it("enforces separate 48-block horizontal and 128-block vertical bounds", async () => {
    const tooWide = makeLitematic({ regions: { wide: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 49, y: 1, z: 1 },
      palette: ["minecraft:air", "minecraft:stone"], values: Array(49).fill(1),
    }) } });
    const tooTall = makeLitematic({ regions: { tall: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 129, z: 1 },
      palette: ["minecraft:air", "minecraft:stone"], values: Array(129).fill(1),
    }) } });
    await expect(parseLitematic(tooWide)).rejects.toEqual(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    await expect(parseLitematic(tooTall)).rejects.toEqual(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });

  it("rejects a packed array whose length cannot represent the region", async () => {
    const input = makeLitematic({ regions: { broken: makeRegion({ position: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 1, z: 1 }, palette: ["minecraft:air", "minecraft:stone"], values: [1, 1, 1], omitLastLong: true }) } });
    await expect(parseLitematic(input)).rejects.toBeInstanceOf(LitematicParseError);
  });

  it("rejects malformed NBT collection lengths and excessive nesting before Litematic traversal", () => {
    const negativeList = Uint8Array.from([10, 0, 0, 9, 0, 1, 120, 3, 0xff, 0xff, 0xff, 0xff, 0]);
    expect(() => parseJavaNbt(negativeList)).toThrow(/length cannot be negative/);

    let nested = nbt.compound({ value: nbt.int(1) });
    for (let depth = 0; depth < 8; depth += 1) nested = nbt.compound({ nested });
    expect(() => parseJavaNbt(writeJavaNbt(nested), { maxDepth: 4 })).toThrow(/depth exceeds 4/);
  });

  it("rejects duplicate compound names and trailing bytes", () => {
    const duplicate = Uint8Array.from([
      10, 0, 0,
      3, 0, 1, 120, 0, 0, 0, 1,
      3, 0, 1, 120, 0, 0, 0, 2,
      0,
    ]);
    expect(() => parseJavaNbt(duplicate)).toThrow(/Duplicate compound tag/);
    const valid = writeJavaNbt(nbt.compound({ value: nbt.int(1) }));
    const trailing = new Uint8Array(valid.byteLength + 1);
    trailing.set(valid);
    expect(() => parseJavaNbt(trailing)).toThrow(/Trailing bytes/);
  });
});

type Point = { x: number; y: number; z: number };
type PaletteInput = string | { name: string; properties?: Record<string, string> };
type RegionInput = ReturnType<typeof makeRegion>;

function makeRegion(input: { position: Point; size: Point; palette: PaletteInput[]; values: number[]; omitLastLong?: boolean }) {
  const bits = Math.max(2, Math.ceil(Math.log2(input.palette.length)));
  const packed = pack(input.values, bits);
  if (input.omitLastLong) packed.pop();
  return {
    Size: compoundPoint(input.size),
    Position: compoundPoint(input.position),
    BlockStatePalette: nbt.list(10, input.palette.map((entry) => {
      const state = typeof entry === "string" ? { name: entry } : entry;
      return nbt.compound({
        Name: nbt.string(state.name),
        ...(state.properties ? { Properties: nbt.compound(Object.fromEntries(
          Object.entries(state.properties).map(([key, value]) => [key, nbt.string(value)]),
        )) } : {}),
      });
    })),
    BlockStates: nbt.longArray(packed),
    Entities: nbt.list(10, []),
    TileEntities: nbt.list(10, []),
    PendingBlockTicks: nbt.list(10, []),
    PendingFluidTicks: nbt.list(10, []),
  };
}

function makeLitematic(input: { regions: Record<string, RegionInput> }): Buffer {
  const root = nbt.compound({
    Version: nbt.int(7),
    SubVersion: nbt.int(1),
    MinecraftDataVersion: nbt.int(3953),
    Metadata: nbt.compound({ Name: nbt.string("Synthetic"), Author: nbt.string("Test"), Description: nbt.string("") }),
    Regions: nbt.compound(Object.fromEntries(Object.entries(input.regions).map(([name, region]) => [name, nbt.compound(region)]))),
  });
  return gzipSync(writeJavaNbt(root));
}

function compoundPoint(point: Point) {
  return nbt.compound({ x: nbt.int(point.x), y: nbt.int(point.y), z: nbt.int(point.z) });
}

function pack(values: number[], bits: number): bigint[] {
  const longs = Array<bigint>(Math.ceil((values.length * bits) / 64)).fill(0n);
  const mask = (1n << BigInt(bits)) - 1n;
  values.forEach((value, index) => {
    const start = index * bits;
    const longIndex = Math.floor(start / 64);
    const offset = start % 64;
    longs[longIndex] = BigInt.asUintN(64, longs[longIndex]! | ((BigInt(value) & mask) << BigInt(offset)));
    if (offset + bits > 64) {
      longs[longIndex + 1] = BigInt.asUintN(64, longs[longIndex + 1]! | ((BigInt(value) & mask) >> BigInt(64 - offset)));
    }
  });
  return longs.map((value) => BigInt.asIntN(64, value));
}
