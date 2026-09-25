import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LitematicParseError, parseLitematic, readPackedIndex } from "../src/index.js";
import { parseJavaNbt } from "../src/nbt.js";
import { testNbt as nbt, writeJavaNbt, type TestNbtTag } from "./nbt-fixture.js";

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

  it("extracts only a moving piston entity's moved block ID and state", async () => {
    const input = makeLitematic({ regions: { piston: makeRegion({
      position: { x: 10, y: 4, z: 8 }, size: { x: 3, y: 1, z: 1 },
      palette: [
        { name: "minecraft:moving_piston", properties: { facing: "east", type: "normal" } },
        "minecraft:stone",
      ],
      values: [0, 1, 0],
      tileEntities: [
        pistonTileEntity(0, 0, 0, nbt.compound({
          Name: nbt.string("minecraft:oak_log"),
          Properties: nbt.compound({ axis: nbt.string("x") }),
          Command: nbt.string("must never be retained"),
        })),
        pistonTileEntity(1, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") })),
        nbt.compound({
          x: nbt.int(2), y: nbt.int(0), z: nbt.int(0), id: nbt.string("minecraft:piston"),
          movedState: nbt.compound({
            id: nbt.string("minecraft:oak_log"),
            properties: nbt.compound({ axis: nbt.string("z") }),
          }),
        }),
      ],
    }) } });

    const result = await parseLitematic(input);
    const movingPistons = result.blueprint.voxels.filter((voxel) => voxel.sourceBlockId === "minecraft:moving_piston");
    const movingPiston = movingPistons.find((voxel) => voxel.x === 0);
    expect(movingPiston?.movingPistonMovedState).toEqual({ blockId: "minecraft:oak_log", properties: { axis: "x" } });
    expect(movingPistons.find((voxel) => voxel.x === 2)?.movingPistonMovedState).toEqual({
      blockId: "minecraft:oak_log", properties: { axis: "z" },
    });
    expect(result.preview.compatibility).toMatchObject({
      ignoredTileEntities: 1,
      preservedMovingPistonMovedStates: 2,
    });
    expect(JSON.stringify(result.blueprint)).not.toContain("must never be retained");
    expect(movingPiston).not.toHaveProperty("Command");
  });

  it("maps piston block entities through nonzero region positions and negative signed sizes", async () => {
    const input = makeLitematic({ regions: { negativePiston: makeRegion({
      position: { x: 10, y: 4, z: 8 }, size: { x: -2, y: -1, z: -1 },
      palette: [{ name: "minecraft:moving_piston", properties: { facing: "west", type: "normal" } }],
      values: [0, 0],
      tileEntities: [
        pistonTileEntity(0, 0, 0, nbt.compound({ Name: nbt.string("minecraft:oak_log") })),
        pistonTileEntity(1, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") })),
        pistonTileEntity(2, 0, 0, nbt.compound({ Name: nbt.string("minecraft:diamond_block") })),
      ],
    }) } });

    const result = await parseLitematic(input);
    const movingPistons = result.blueprint.voxels.filter((voxel) => voxel.sourceBlockId === "minecraft:moving_piston");
    expect(movingPistons.find((voxel) => voxel.x === 1)?.movingPistonMovedState).toEqual({ blockId: "minecraft:oak_log" });
    expect(movingPistons.find((voxel) => voxel.x === 0)?.movingPistonMovedState).toEqual({ blockId: "minecraft:stone" });
    expect(movingPistons.every((voxel) => voxel.movingPistonMovedState?.blockId !== "minecraft:diamond_block")).toBe(true);
    expect(result.preview.compatibility).toMatchObject({
      ignoredTileEntities: 1,
      preservedMovingPistonMovedStates: 2,
    });
  });

  it("preserves only a valid 26.3 piston movement pose alongside moved state", async () => {
    const validPoses = [
      { facing: 0, progress: 0, extending: 0, source: 0 },
      { facing: 1, progress: 0.2, extending: 1, source: 0 },
      { facing: 2, progress: 0.375, extending: 0, source: 1 },
      { facing: 3, progress: 0.5, extending: 1, source: 1 },
      { facing: 4, progress: 0.8, extending: 0, source: 0 },
      { facing: 5, progress: 1, extending: 1, source: 0 },
    ] as const;
    const validEntities = validPoses.map((pose, x) => pistonTileEntity(
      x, 0, 0,
      nbt.compound({ Name: nbt.string("minecraft:oak_log"), Properties: nbt.compound({ axis: nbt.string("x") }) }),
      {
        facing: nbt.int(pose.facing), progress: nbt.float(pose.progress),
        extending: nbt.byte(pose.extending), source: nbt.byte(pose.source),
      },
      x === 0 ? { privateField: nbt.string("must not be retained") } : undefined,
    ));
    const invalidEntities = [
      pistonTileEntity(6, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.int(6), progress: nbt.float(0.5), extending: nbt.byte(0), source: nbt.byte(0),
      }),
      pistonTileEntity(7, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.int(2), progress: nbt.float(Number.NaN), extending: nbt.byte(0), source: nbt.byte(0),
      }),
      pistonTileEntity(8, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.int(2), progress: nbt.float(1.01), extending: nbt.byte(0), source: nbt.byte(0),
      }),
      pistonTileEntity(9, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.int(2), progress: nbt.float(0.5), extending: nbt.byte(2), source: nbt.byte(0),
      }),
      pistonTileEntity(10, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.string("north"), progress: nbt.float(0.5), extending: nbt.byte(0), source: nbt.byte(0),
      }),
      pistonTileEntity(11, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.int(2), progress: nbt.float(0.5), extending: nbt.byte(0),
      }),
      pistonTileEntity(12, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.float(2), progress: nbt.float(0.5), extending: nbt.byte(0), source: nbt.byte(0),
      }),
      pistonTileEntity(13, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.int(2), progress: nbt.int(0), extending: nbt.byte(0), source: nbt.byte(0),
      }),
      pistonTileEntity(14, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.int(2), progress: nbt.float(0.5), extending: nbt.int(1), source: nbt.byte(0),
      }),
      pistonTileEntity(15, 0, 0, nbt.compound({ Name: nbt.string("minecraft:stone") }), {
        facing: nbt.int(2), progress: nbt.float(0.5), extending: nbt.byte(0), source: nbt.int(0),
      }),
    ];
    const input = makeLitematic({ regions: { poses: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 16, y: 1, z: 1 },
      palette: [{ name: "minecraft:moving_piston", properties: { facing: "north", type: "normal" } }],
      values: Array(16).fill(0),
      tileEntities: [...validEntities, ...invalidEntities],
    }) } });

    const result = await parseLitematic(input);
    const voxels = result.blueprint.voxels;
    const expectedFacings = ["down", "up", "north", "south", "west", "east"];
    for (let x = 0; x < validPoses.length; x += 1) {
      const pose = validPoses[x]!;
      expect(voxels.find((voxel) => voxel.x === x)?.movingPistonPose).toEqual({
        facing: expectedFacings[x], progress: Math.fround(pose.progress),
        extending: pose.extending === 1, source: pose.source === 1,
      });
    }
    for (let x = validPoses.length; x < 16; x += 1) {
      expect(voxels.find((voxel) => voxel.x === x)).not.toHaveProperty("movingPistonPose");
    }
    expect(voxels.every((voxel) => voxel.movingPistonMovedState !== undefined)).toBe(true);
    expect(result.preview.compatibility).toMatchObject({
      ignoredTileEntities: 0,
      preservedMovingPistonMovedStates: 16,
      preservedMovingPistonPoses: 6,
    });
    expect(JSON.stringify(result.blueprint)).not.toContain("privateField");
  });

  it("ignores absent, malformed, out-of-bounds, and non-piston moved-state payloads", async () => {
    const input = makeLitematic({ regions: { invalidEntities: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 1, z: 1 },
      palette: [{ name: "minecraft:moving_piston", properties: { facing: "north", type: "sticky" } }],
      values: Array(5).fill(0),
      tileEntities: [
        nbt.compound({ x: nbt.int(0), y: nbt.int(0), z: nbt.int(0), id: nbt.string("minecraft:piston") }),
        pistonTileEntity(1, 0, 0, nbt.compound({ Name: nbt.string("example:oak_log") })),
        pistonTileEntity(2, 0, 0, nbt.compound({
          Name: nbt.string("minecraft:oak_log"),
          Properties: nbt.compound(Object.fromEntries([["__proto__", nbt.string("unsafe")]])),
        })),
        pistonTileEntity(3, 0, 0, nbt.compound({
          Name: nbt.string("minecraft:oak_log"),
          Properties: nbt.compound({ axis: nbt.string("not a block-state value") }),
        })),
        nbt.compound({
          x: nbt.int(4), y: nbt.int(0), z: nbt.int(0), id: nbt.string("minecraft:chest"),
          blockState: nbt.compound({ Name: nbt.string("minecraft:oak_log") }),
        }),
        pistonTileEntity(25, 0, 0, nbt.compound({ Name: nbt.string("minecraft:oak_log") })),
        nbt.compound({
          x: nbt.int(4), y: nbt.int(0), z: nbt.int(0), id: nbt.string("minecraft:piston"),
          blockState: nbt.compound({ Name: nbt.string("minecraft:oak_log") }),
          movedState: nbt.compound({ Name: nbt.string("minecraft:stone") }),
        }),
        pistonTileEntity(0, 0, 0, nbt.compound({
          Name: nbt.string("minecraft:oak_log"),
          Properties: nbt.compound(Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`p${index}`, nbt.string("x")]))),
        })),
        pistonTileEntity(0, 0, 0, nbt.compound({
          Name: nbt.string("minecraft:oak_log"),
          Properties: nbt.compound(Object.fromEntries([["k".repeat(65), nbt.string("x")]])),
        })),
        pistonTileEntity(0, 0, 0, nbt.compound({
          Name: nbt.string("minecraft:oak_log"),
          Properties: nbt.compound({ axis: nbt.string("x".repeat(129)) }),
        })),
        pistonTileEntity(0, 0, 0, nbt.compound({ Name: nbt.string(`minecraft:${"a".repeat(247)}`) })),
      ],
    }) } });

    const result = await parseLitematic(input);
    expect(result.blueprint.voxels.every((voxel) => !("movingPistonMovedState" in voxel))).toBe(true);
    expect(result.preview.compatibility).toMatchObject({
      ignoredTileEntities: 11,
      preservedMovingPistonMovedStates: 0,
    });
  });

  it("normalizes sign faces and campfire slots while dropping raw component actions and unrelated NBT", async () => {
    const input = makeLitematic({ regions: { blockEntities: makeRegion({
      position: { x: 4, y: 0, z: 0 }, size: { x: -2, y: 1, z: 1 },
      palette: ["minecraft:oak_wall_sign", "minecraft:soul_campfire"], values: [0, 1],
      tileEntities: [
        blockTileEntity("minecraft:sign", 0, 0, 0, {
          front_text: nbt.compound({
            messages: nbt.list(8, [
              nbt.string(JSON.stringify({ text: "Front", extra: [{ text: " side", clickEvent: { action: "run_command", value: "/discard" }, hoverEvent: { action: "show_text", value: "discard" } }] })),
              nbt.string(JSON.stringify({ text: "Second" })),
            ]),
            color: nbt.string("red"), has_glowing_text: nbt.byte(1),
          }),
          back_text: nbt.compound({
            messages: nbt.list(8, [nbt.string(JSON.stringify({ text: "Back" }))]),
            color: nbt.string("light_blue"), has_glowing_text: nbt.byte(0),
          }),
          waxed: nbt.byte(1), unrelated: nbt.string("discard"),
        }),
        blockTileEntity("minecraft:campfire", 1, 0, 0, {
          Items: nbt.list(10, [
            nbt.compound({ Slot: nbt.byte(3), id: nbt.string("minecraft:stick"), Count: nbt.byte(2), components: nbt.compound({}) }),
            nbt.compound({ Slot: nbt.byte(0), id: nbt.string("minecraft:bread"), count: nbt.byte(1) }),
          ]),
          cookingTimes: nbt.int(900), unrelated: nbt.string("discard"),
        }),
      ],
    }) } });

    const result = await parseLitematic(input);
    const sign = result.blueprint.voxels.find((voxel) => voxel.sourceBlockId === "minecraft:oak_wall_sign");
    const campfire = result.blueprint.voxels.find((voxel) => voxel.sourceBlockId === "minecraft:soul_campfire");
    expect(sign?.sign).toEqual({
      front: { lines: ["Front side", "Second"], dyeColor: "red", glowing: true },
      back: { lines: ["Back"], dyeColor: "light_blue", glowing: false },
    });
    expect(campfire?.campfire).toEqual({ slots: [
      { slot: 0, itemId: "minecraft:bread", count: 1 },
      { slot: 3, itemId: "minecraft:stick", count: 2 },
    ] });
    expect(result.preview.compatibility).toMatchObject({
      ignoredTileEntities: 0,
      preservedSignBlockEntities: 1,
      preservedCampfireBlockEntities: 1,
    });
    const normalized = JSON.stringify(result.blueprint);
    expect(normalized).not.toContain("clickEvent");
    expect(normalized).not.toContain("hoverEvent");
    expect(normalized).not.toContain("waxed");
    expect(normalized).not.toContain("cookingTimes");
    expect(normalized).not.toContain("unrelated");
  });

  it("accepts empty sign lines from older Litematic exporters", async () => {
    const input = makeLitematic({ regions: { sign: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 },
      palette: ["minecraft:oak_sign"], values: [0],
      tileEntities: [blockTileEntity("minecraft:sign", 0, 0, 0, {
        front_text: nbt.compound({ messages: nbt.list(8, [nbt.string(""), nbt.string(JSON.stringify({ text: "visible" }))]) }),
        back_text: nbt.compound({ messages: nbt.list(8, [nbt.string("")]) }),
      })],
    }) } });

    const result = await parseLitematic(input);
    expect(result.blueprint.voxels[0]?.sign).toEqual({
      front: { lines: ["", "visible"], dyeColor: "black", glowing: false },
      back: { lines: [""], dyeColor: "black", glowing: false },
    });
  });

  it("reports unsupported campfire item components and rejects malformed bounded block-entity data", async () => {
    const withCampfire = (items: TestNbtTag[]) => makeLitematic({ regions: { campfire: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 },
      palette: ["minecraft:campfire"], values: [0],
      tileEntities: [blockTileEntity("minecraft:campfire", 0, 0, 0, { Items: nbt.list(10, items) })],
    }) } });
    const componentPayload = withCampfire([nbt.compound({
      Slot: nbt.byte(0), id: nbt.string("minecraft:stick"), count: nbt.byte(1),
      components: nbt.compound({ "minecraft:custom_model_data": nbt.int(7) }),
    })]);
    await expect(parseLitematic(componentPayload)).rejects.toMatchObject({
      code: "UNSUPPORTED_BLOCK_ENTITY_DATA",
      message: expect.stringMatching(/item components.*unsupported/i),
    });

    await expect(parseLitematic(withCampfire([
      nbt.compound({ Slot: nbt.byte(0), id: nbt.string("minecraft:stick"), count: nbt.byte(1) }),
      nbt.compound({ Slot: nbt.byte(0), id: nbt.string("minecraft:bread"), count: nbt.byte(1) }),
    ]))).rejects.toMatchObject({ code: "INVALID_LITEMATIC" });
    await expect(parseLitematic(withCampfire([
      nbt.compound({ Slot: nbt.byte(4), id: nbt.string("minecraft:stick"), count: nbt.byte(1) }),
    ]))).rejects.toMatchObject({ code: "INVALID_LITEMATIC" });

    const translated = makeLitematic({ regions: { sign: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 },
      palette: ["minecraft:oak_sign"], values: [0],
      tileEntities: [blockTileEntity("minecraft:sign", 0, 0, 0, {
        front_text: nbt.compound({ messages: nbt.list(8, [nbt.string(JSON.stringify({ translate: "unsupported.key" }))]) }),
      })],
    }) } });
    await expect(parseLitematic(translated)).rejects.toMatchObject({
      code: "UNSUPPORTED_BLOCK_ENTITY_DATA",
      message: expect.stringMatching(/dynamic sign text.*unsupported/i),
    });
  });

  it("processes a bounded batch of moved states without carrying block-entity payloads", async () => {
    const side = 16;
    const height = 2;
    const count = side * side * height;
    const input = makeLitematic({ regions: { batch: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: side, y: height, z: side },
      palette: [{ name: "minecraft:moving_piston", properties: { facing: "north", type: "normal" } }],
      values: Array(count).fill(0),
      tileEntities: Array.from({ length: count }, (_, index) => pistonTileEntity(
        index % side,
        Math.floor(index / (side * side)),
        Math.floor(index / side) % side,
        nbt.compound({
          Name: nbt.string("minecraft:oak_log"),
          Properties: nbt.compound({ axis: nbt.string("y") }),
          PrivateUnrelatedData: nbt.string("x".repeat(512)),
        }),
        {
          facing: nbt.int(2), progress: nbt.float(0.5), extending: nbt.byte(1), source: nbt.byte(0),
        },
      )),
    }) } });

    const result = await parseLitematic(input);
    expect(result.blueprint.voxels).toHaveLength(count);
    expect(result.preview.compatibility.preservedMovingPistonMovedStates).toBe(count);
    expect(result.preview.compatibility.preservedMovingPistonPoses).toBe(count);
    expect(result.preview.compatibility.ignoredTileEntities).toBe(0);
    expect(JSON.stringify(result.blueprint)).not.toContain("PrivateUnrelatedData");
    expect(JSON.stringify(result.blueprint).length).toBeLessThan(count * 384);
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

  it("enforces separate 96-block horizontal and 256-block vertical bounds", async () => {
    const tooWide = makeLitematic({ regions: { wide: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 97, y: 1, z: 1 },
      palette: ["minecraft:air", "minecraft:stone"], values: Array(97).fill(1),
    }) } });
    const tooTall = makeLitematic({ regions: { tall: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 257, z: 1 },
      palette: ["minecraft:air", "minecraft:stone"], values: Array(257).fill(1),
    }) } });
    const maxAllowed = makeLitematic({ regions: { max: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 96, y: 256, z: 96 },
      // Only a thin ground floor is non-air so the 300k output-voxel cap is not
      // the thing being exercised; the region dimensions carry the size checks.
      palette: ["minecraft:air", "minecraft:stone"],
      values: Array.from({ length: 96 * 256 * 96 }, (_, index) => Math.floor(index / (96 * 96)) % 256 === 0 ? 1 : 0),
    }) } });
    await expect(parseLitematic(tooWide)).rejects.toEqual(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    await expect(parseLitematic(tooTall)).rejects.toEqual(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    await expect(parseLitematic(maxAllowed)).resolves.toBeTruthy();
  }, 15_000);

  it("imports a dense 60 x 60 x 60 volume without argument-spread or output truncation", async () => {
    const side = 60;
    const input = makeLitematic({ regions: { dense: makeRegion({
      position: { x: 0, y: 0, z: 0 },
      size: { x: side, y: side, z: side },
      palette: ["minecraft:air", "minecraft:stone"],
      values: Array(side * side * side).fill(1),
    }) } });
    const result = await parseLitematic(input);
    expect(result.preview.dimensions).toEqual({ width: side, height: side, depth: side });
    expect(result.preview.nonAirBlockCount).toBe(side * side * side);
    expect(result.blueprint.voxels).toHaveLength(216_000);
    expect(result.blueprint.bounds).toEqual({ minX: 0, maxX: 59, minY: 0, maxY: 59, minZ: 0, maxZ: 59 });
    expect(result.blueprint.voxels[0]?.buildOrder).toBe(0);
    expect(result.blueprint.voxels.at(-1)?.buildOrder).toBe(10_000);
  }, 30_000);

  it("rejects a packed array whose length cannot represent the region", async () => {
    const input = makeLitematic({ regions: { broken: makeRegion({ position: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 1, z: 1 }, palette: ["minecraft:air", "minecraft:stone"], values: [1, 1, 1], omitLastLong: true }) } });
    await expect(parseLitematic(input)).rejects.toBeInstanceOf(LitematicParseError);
  });

  it("reports an explicit output-voxel limit instead of truncating a dense import", async () => {
    const input = makeLitematic({ regions: { capped: makeRegion({
      position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 },
      palette: ["minecraft:air", "minecraft:stone"], values: Array(8).fill(1),
    }) } });
    await expect(parseLitematic(input, { limits: { maxOutputVoxels: 7 } })).rejects.toEqual(
      expect.objectContaining({ code: "LIMIT_EXCEEDED", message: expect.stringContaining("Output block count exceeds 7") }),
    );
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

function makeRegion(input: { position: Point; size: Point; palette: PaletteInput[]; values: number[]; omitLastLong?: boolean; tileEntities?: TestNbtTag[] }) {
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
    TileEntities: nbt.list(10, input.tileEntities ?? []),
    PendingBlockTicks: nbt.list(10, []),
    PendingFluidTicks: nbt.list(10, []),
  };
}

function pistonTileEntity(
  x: number,
  y: number,
  z: number,
  blockState: TestNbtTag,
  pose?: Partial<Record<"facing" | "progress" | "extending" | "source", TestNbtTag>>,
  extraTags?: Readonly<Record<string, TestNbtTag>>,
): TestNbtTag {
  return nbt.compound({
    x: nbt.int(x), y: nbt.int(y), z: nbt.int(z), id: nbt.string("minecraft:piston"), blockState,
    ...pose,
    ...extraTags,
  });
}

function blockTileEntity(id: string, x: number, y: number, z: number, fields: Readonly<Record<string, TestNbtTag>>): TestNbtTag {
  return nbt.compound({ x: nbt.int(x), y: nbt.int(y), z: nbt.int(z), id: nbt.string(id), ...fields });
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
