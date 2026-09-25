import { describe, expect, it } from "vitest";
import {
  BlueprintValidationError,
  SMALL_WORKSHOP_BLUEPRINT,
  TIMBER_HOUSE_BLUEPRINT,
  VILLAGE_CHAPEL_BLUEPRINT,
  validateBlueprint,
  type BlueprintV1,
} from "../src/index.js";

const INITIAL_BLUEPRINTS = [SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT, VILLAGE_CHAPEL_BLUEPRINT] as const;

function voxelMap(blueprint: BlueprintV1): Map<string, BlueprintV1["voxels"][number]> {
  return new Map(blueprint.voxels.map((voxel) => [`${voxel.x}:${voxel.y}:${voxel.z}`, voxel]));
}

function coordinate(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

describe("BlueprintV1", () => {
  it("ships a deterministic staged small workshop", () => {
    expect(SMALL_WORKSHOP_BLUEPRINT.id).toBe("builtin-small-workshop");
    expect(SMALL_WORKSHOP_BLUEPRINT.voxels.length).toBeGreaterThan(250);
    expect(SMALL_WORKSHOP_BLUEPRINT.voxels[0]!.buildOrder).toBe(0);
    expect(SMALL_WORKSHOP_BLUEPRINT.voxels.at(-1)?.buildOrder).toBe(10000);
    expect(new Set(SMALL_WORKSHOP_BLUEPRINT.voxels.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`)).size).toBe(SMALL_WORKSHOP_BLUEPRINT.voxels.length);
  });

  it("keeps the initial three built-ins structurally complete and deterministic", () => {
    expect(INITIAL_BLUEPRINTS.map((blueprint) => blueprint.id)).toEqual([
      "builtin-small-workshop",
      "builtin-timber-house",
      "builtin-village-chapel",
    ]);
    for (const blueprint of INITIAL_BLUEPRINTS) {
      const keys = blueprint.voxels.map(({ x, y, z }) => coordinate(x, y, z));
      expect(new Set(keys).size).toBe(keys.length);
      expect(blueprint.voxels[0]!.buildOrder).toBe(0);
      expect(blueprint.voxels.at(-1)?.buildOrder).toBe(10000);
      expect(blueprint.voxels.length).toBeGreaterThan(250);
    }
  });

  it("fills every window opening in the initial built-ins with transparent glass", () => {
    const windows: Array<{ blueprint: BlueprintV1; cells: Array<[number, number, number]> }> = [
      {
        blueprint: SMALL_WORKSHOP_BLUEPRINT,
        cells: [
          ...Array.from({ length: 5 }, (_, index): [number, number, number] => [index - 2, 3, -4]),
          [-5, 3, 0], [5, 3, 0],
        ],
      },
      {
        blueprint: TIMBER_HOUSE_BLUEPRINT,
        cells: [
          [-3, 3, -3], [3, 3, -3], [-5, 3, 0], [5, 3, 0],
          [-3, 7, -4], [3, 7, -4], [-6, 7, 0], [6, 7, 0],
        ],
      },
      {
        blueprint: VILLAGE_CHAPEL_BLUEPRINT,
        cells: [
          ...[-5, -1, 3].flatMap((z): Array<[number, number, number]> => [
            [-4, 4, z], [-4, 5, z], [4, 4, z], [4, 5, z],
          ]),
          [-2, 9, 10], [2, 9, 10],
        ],
      },
    ];

    for (const { blueprint, cells } of windows) {
      const voxels = voxelMap(blueprint);
      for (const [x, y, z] of cells) {
        expect(voxels.get(coordinate(x, y, z))).toMatchObject({ materialId: "glass", buildOrder: expect.any(Number) });
        expect(voxels.get(coordinate(x, y, z))!.buildOrder).toBeGreaterThanOrEqual(8800);
      }
    }
  });

  it("leaves clear entry routes and adds compact interiors after the roof stage", () => {
    const clearRoute = (blueprint: BlueprintV1, cells: Array<[number, number, number]>) => {
      const voxels = voxelMap(blueprint);
      for (const [x, y, z] of cells) expect(voxels.has(coordinate(x, y, z))).toBe(false);
    };
    const route = (x: number, y: number, zValues: number[]): Array<[number, number, number]> =>
      zValues.map((z) => [x, y, z]);

    clearRoute(SMALL_WORKSHOP_BLUEPRINT, [
      ...route(0, 2, [-3, -2, -1, 0, 1, 2, 3, 4]),
      ...route(0, 3, [-3, -2, -1, 0, 1, 2, 3, 4]),
    ]);
    clearRoute(TIMBER_HOUSE_BLUEPRINT, [
      ...route(0, 2, [-2, -1, 0, 1, 2, 3]),
      ...route(0, 3, [-2, -1, 0, 1, 2, 3]),
    ]);
    clearRoute(VILLAGE_CHAPEL_BLUEPRINT, [
      ...route(0, 2, [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      ...route(0, 3, [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    ]);

    const interiorDetails: Array<{ blueprint: BlueprintV1; cells: Array<[number, number, number]> }> = [
      {
        blueprint: SMALL_WORKSHOP_BLUEPRINT,
        cells: [[-3, 2, -2], [-2, 2, -2], [-1, 2, -2], [-3, 3, 3], [3, 3, 3]],
      },
      {
        blueprint: TIMBER_HOUSE_BLUEPRINT,
        cells: [[-3, 2, -1], [-2, 2, -1], [3, 6, -2], [-3, 3, 2], [3, 3, 2]],
      },
      {
        blueprint: VILLAGE_CHAPEL_BLUEPRINT,
        cells: [
          [-2, 2, -6], [2, 2, -6], [-2, 2, -4], [2, 2, -4],
          [-2, 2, -2], [2, 2, -2], [-2, 2, 0], [2, 2, 0],
          [-2, 2, 8], [2, 2, 8], [-3, 2, 0], [3, 2, 0],
          [-1, 2, -7], [0, 2, -7], [1, 2, -7],
        ],
      },
    ];
    const interiorTorches: Array<{ blueprint: BlueprintV1; cells: Array<[number, number, number]> }> = [
      { blueprint: SMALL_WORKSHOP_BLUEPRINT, cells: [[-3, 3, 3], [3, 3, 3]] },
      { blueprint: TIMBER_HOUSE_BLUEPRINT, cells: [[-3, 3, 2], [3, 3, 2]] },
      {
        blueprint: VILLAGE_CHAPEL_BLUEPRINT,
        cells: [[-2, 2, 8], [2, 2, 8], [-3, 2, 0], [3, 2, 0]],
      },
    ];

    for (const { blueprint, cells } of interiorDetails) {
      const voxels = voxelMap(blueprint);
      for (const [x, y, z] of cells) {
        const detail = voxels.get(coordinate(x, y, z));
        expect(detail).toBeDefined();
        expect(detail!.buildOrder).toBeGreaterThanOrEqual(8800);
      }
      const highestRoofOrder = Math.max(...blueprint.voxels
        .filter((voxel) => voxel.materialId === "roof")
        .map((voxel) => voxel.buildOrder));
      expect(Math.min(...cells.map(([x, y, z]) => voxels.get(coordinate(x, y, z))!.buildOrder)))
        .toBeGreaterThanOrEqual(highestRoofOrder);
    }

    for (const { blueprint, cells } of interiorTorches) {
      const voxels = voxelMap(blueprint);
      for (const [x, y, z] of cells) {
        expect(voxels.get(coordinate(x, y, z))).toMatchObject({
          sourceBlockId: "minecraft:torch",
          emissiveKind: "torch",
          emissiveLevel: 14,
        });
      }
    }
  });

  it("rejects duplicate coordinates and out-of-range construction order", () => {
    const base = structuredClone(SMALL_WORKSHOP_BLUEPRINT);
    base.voxels[1] = { ...base.voxels[1]!, x: base.voxels[0]!.x, y: base.voxels[0]!.y, z: base.voxels[0]!.z };
    expect(() => validateBlueprint(base)).toThrow(BlueprintValidationError);
    const invalidOrder = structuredClone(SMALL_WORKSHOP_BLUEPRINT);
    invalidOrder.voxels[0]!.buildOrder = 10001;
    expect(() => validateBlueprint(invalidOrder)).toThrow(BlueprintValidationError);
  });

  it("preserves optional imported light semantics", () => {
    const blueprint = validateBlueprint({
      schemaVersion: 1,
      id: "semantic-light",
      title: "Semantic light",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: "accent", buildOrder: 10000, sourceBlockId: "minecraft:lantern", emissiveKind: "lantern", emissiveLevel: 15 }],
    });
    expect(blueprint.voxels[0]).toMatchObject({ sourceBlockId: "minecraft:lantern", emissiveKind: "lantern", emissiveLevel: 15 });
    expect(() => validateBlueprint({ ...blueprint, voxels: [{ ...blueprint.voxels[0], emissiveLevel: 16 }] })).toThrow(BlueprintValidationError);
  });

  it("preserves source block state in a stable canonical key order", () => {
    const blueprint = validateBlueprint({
      schemaVersion: 1,
      id: "stateful-stairs",
      title: "Stateful stairs",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [{
        x: 0, y: 0, z: 0, materialId: "roof", buildOrder: 10000,
        sourceBlockId: "minecraft:oak_stairs",
        sourceBlockState: { waterlogged: "false", shape: "straight", facing: "north", half: "bottom" },
      }],
    });
    expect(blueprint.voxels[0]?.sourceBlockState).toEqual({
      facing: "north", half: "bottom", shape: "straight", waterlogged: "false",
    });
    expect(Object.keys(blueprint.voxels[0]!.sourceBlockState!)).toEqual(["facing", "half", "shape", "waterlogged"]);
  });

  it("preserves only the canonical moved block identity and properties for moving pistons", () => {
    const blueprint = validateBlueprint({
      schemaVersion: 1,
      id: "moving-piston",
      title: "Moving piston",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [{
        x: 0, y: 0, z: 0, materialId: "stone", buildOrder: 10000,
        sourceBlockId: "minecraft:moving_piston",
        movingPistonMovedState: { blockId: "minecraft:oak_log", properties: { axis: "x" } },
        movingPistonPose: { facing: "west", progress: 0.375, extending: true, source: false },
      }],
    });
    expect(blueprint.voxels[0]?.movingPistonMovedState).toEqual({
      blockId: "minecraft:oak_log", properties: { axis: "x" },
    });
    expect(blueprint.voxels[0]?.movingPistonPose).toEqual({
      facing: "west", progress: 0.375, extending: true, source: false,
    });
    expect(validateBlueprint(structuredClone(blueprint))).toEqual(blueprint);
  });

  it("rejects custom, malformed, or unrelated moving-piston state payloads", () => {
    const voxel = {
      x: 0, y: 0, z: 0, materialId: "stone", buildOrder: 10000,
      sourceBlockId: "minecraft:moving_piston",
      movingPistonMovedState: { blockId: "minecraft:oak_log", properties: { axis: "x" } },
      movingPistonPose: { facing: "east", progress: 0.5, extending: false, source: false },
    };
    const base = {
      schemaVersion: 1,
      id: "moving-piston-invalid",
      title: "Invalid moved state",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [voxel],
    };
    const invalidCases = [
      { ...voxel, sourceBlockId: "minecraft:stone" },
      { ...voxel, movingPistonMovedState: { blockId: "example:private_block" } },
      { ...voxel, movingPistonMovedState: { blockId: "minecraft:invalid?block" } },
      { ...voxel, movingPistonMovedState: { blockId: "minecraft:oak_log", properties: Object.fromEntries([["__proto__", "x"]]) } },
      { ...voxel, movingPistonMovedState: { blockId: "minecraft:oak_log", properties: { axis: "x value" } } },
      { ...voxel, movingPistonMovedState: { blockId: "minecraft:oak_log", extra: "unlisted NBT" } },
      { ...voxel, movingPistonPose: { facing: "northeast", progress: 0.5, extending: false, source: false } },
      { ...voxel, movingPistonPose: { facing: "east", progress: Number.NaN, extending: false, source: false } },
      { ...voxel, movingPistonPose: { facing: "east", progress: 1.01, extending: false, source: false } },
      { ...voxel, movingPistonPose: { facing: "east", progress: 0.5, extending: "false", source: false } },
      { ...voxel, movingPistonPose: { facing: "east", progress: 0.5, extending: false, source: false, raw: {} } },
    ];
    for (const invalidVoxel of invalidCases) {
      expect(() => validateBlueprint({ ...base, voxels: [invalidVoxel] })).toThrow(BlueprintValidationError);
    }
    const accessorPose = { facing: "east", progress: 0.5, extending: false, source: false };
    Object.defineProperty(accessorPose, "facing", {
      enumerable: true,
      get: () => { throw new Error("pose getter must not run"); },
    });
    expect(() => validateBlueprint({ ...base, voxels: [{ ...voxel, movingPistonPose: accessorPose }] })).toThrow(BlueprintValidationError);
  });

  it("keeps old blueprints compatible and omits an empty source block state", () => {
    const legacy = structuredClone(SMALL_WORKSHOP_BLUEPRINT);
    expect(validateBlueprint(legacy)).toEqual(legacy);
    const withEmptyState = validateBlueprint({
      schemaVersion: 1,
      id: "empty-state",
      title: "Empty state",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: "stone", buildOrder: 10000, sourceBlockId: "minecraft:stone", sourceBlockState: {} }],
    });
    expect(withEmptyState.voxels[0]).not.toHaveProperty("sourceBlockState");
  });

  it("rejects malformed or malicious source block state records", () => {
    const base = {
      schemaVersion: 1,
      id: "unsafe-state",
      title: "Unsafe state",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: "stone", buildOrder: 10000, sourceBlockId: "minecraft:stone" }],
    };
    for (const sourceBlockState of [null, [], { facing: 1 }, Object.create({ inherited: "value" })]) {
      expect(() => validateBlueprint({ ...base, voxels: [{ ...base.voxels[0], sourceBlockState }] })).toThrow(BlueprintValidationError);
    }
    const poisoned = JSON.parse('{"__proto__":"polluted"}') as Record<string, string>;
    expect(() => validateBlueprint({ ...base, voxels: [{ ...base.voxels[0], sourceBlockState: poisoned }] })).toThrow(BlueprintValidationError);
    for (const sourceBlockState of [
      { Uppercase: "value" },
      { facing: "" },
      { ["k".repeat(65)]: "value" },
      { valid_key: "v".repeat(129) },
      Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`key_${index}`, "value"])),
    ]) {
      expect(() => validateBlueprint({ ...base, voxels: [{ ...base.voxels[0], sourceBlockState }] })).toThrow(BlueprintValidationError);
    }
  });
});
