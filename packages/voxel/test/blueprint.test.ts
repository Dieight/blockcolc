import { describe, expect, it } from "vitest";
import { BlueprintValidationError, SMALL_WORKSHOP_BLUEPRINT, validateBlueprint } from "../src/index.js";

describe("BlueprintV1", () => {
  it("ships a deterministic staged small workshop", () => {
    expect(SMALL_WORKSHOP_BLUEPRINT.id).toBe("builtin-small-workshop");
    expect(SMALL_WORKSHOP_BLUEPRINT.voxels.length).toBeGreaterThan(250);
    expect(SMALL_WORKSHOP_BLUEPRINT.voxels[0]!.buildOrder).toBe(0);
    expect(SMALL_WORKSHOP_BLUEPRINT.voxels.at(-1)?.buildOrder).toBe(10000);
    expect(new Set(SMALL_WORKSHOP_BLUEPRINT.voxels.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`)).size).toBe(SMALL_WORKSHOP_BLUEPRINT.voxels.length);
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
