import { describe, expect, it } from "vitest";
import {
  BUILTIN_BLUEPRINT_CATALOG,
  BUILTIN_BLUEPRINTS,
  BUILTIN_DAILY_REWARD_BLUEPRINTS,
  BUILTIN_LOCAL_BUILDING_BLUEPRINTS,
  CORE_BUILTIN_BLUEPRINT_CATALOG,
  CONSTRUCTION_STAGES,
  SMALL_WORKSHOP_BLUEPRINT,
  TIMBER_HOUSE_BLUEPRINT,
  UNKNOWN_BLUEPRINT_PLACEHOLDER,
  VILLAGE_CHAPEL_BLUEPRINT,
  composeBuiltinBlueprintCatalog,
  layoutWorlds,
  localBuiltinBlueprintDescription,
  resolveBuiltinBlueprint,
  type BlueprintV1,
  type WorldSnapshot,
} from "../src/index.js";

describe("built-in blueprint catalog", () => {
  it("keeps the original catalog intact when optional local assets are absent", () => {
    expect(composeBuiltinBlueprintCatalog(CORE_BUILTIN_BLUEPRINT_CATALOG, [])).toEqual(CORE_BUILTIN_BLUEPRINT_CATALOG);
    expect(CORE_BUILTIN_BLUEPRINT_CATALOG.map((entry) => entry.id)).toEqual([
      "builtin-small-workshop",
      "builtin-timber-house",
      "builtin-village-chapel",
    ]);
  });

  it("publishes distinct, tightly bounded catalog assets with stable local IDs", () => {
    expect(BUILTIN_BLUEPRINT_CATALOG).toHaveLength(CORE_BUILTIN_BLUEPRINT_CATALOG.length + BUILTIN_LOCAL_BUILDING_BLUEPRINTS.length);
    expect(BUILTIN_BLUEPRINTS.size).toBe(BUILTIN_BLUEPRINT_CATALOG.length);

    const ids = BUILTIN_BLUEPRINT_CATALOG.map((entry) => entry.id);
    const names = BUILTIN_BLUEPRINT_CATALOG.map((entry) => entry.displayName);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(BUILTIN_BLUEPRINT_CATALOG.slice(0, CORE_BUILTIN_BLUEPRINT_CATALOG.length)).toEqual(CORE_BUILTIN_BLUEPRINT_CATALOG);
    expect(new Set(CORE_BUILTIN_BLUEPRINT_CATALOG.map((entry) => entry.blueprint))).toEqual(new Set([
      SMALL_WORKSHOP_BLUEPRINT,
      TIMBER_HOUSE_BLUEPRINT,
      VILLAGE_CHAPEL_BLUEPRINT,
    ]));
    expect(BUILTIN_LOCAL_BUILDING_BLUEPRINTS.length === 0 || BUILTIN_LOCAL_BUILDING_BLUEPRINTS.length === 7).toBe(true);
    expect(BUILTIN_DAILY_REWARD_BLUEPRINTS.length === 0 || BUILTIN_DAILY_REWARD_BLUEPRINTS.length === 3).toBe(true);
    expect(BUILTIN_LOCAL_BUILDING_BLUEPRINTS.every((blueprint) => blueprint.id.startsWith("builtin-local-") && blueprint.title)).toBe(true);
    expect(BUILTIN_DAILY_REWARD_BLUEPRINTS.every((blueprint) => blueprint.id.startsWith("builtin-local-") && blueprint.title)).toBe(true);
    if (BUILTIN_LOCAL_BUILDING_BLUEPRINTS.length === 7) {
      expect(BUILTIN_LOCAL_BUILDING_BLUEPRINTS.map((blueprint) => [blueprint.id, blueprint.title])).toEqual([
        ["builtin-local-advanced-matchbox-plus", "Dieight的高级火柴盒plus"],
        ["builtin-local-advanced-matchbox-pro", "Dieight的高级火柴盒pro"],
        ["builtin-local-advanced-matchbox", "Dieight的高级火柴盒"],
        ["builtin-local-gkr-mansion", "karry_steven的豪宅"],
        ["builtin-local-gyp-mansion-first-floor", "GYPpro的豪宅（一层）"],
        ["builtin-local-gyp-simple-warehouse", "GYPpro的简易小仓库"],
        ["builtin-local-small-villa", "Dieight的小别墅"],
      ]);
    } else {
      expect(BUILTIN_BLUEPRINT_CATALOG).toHaveLength(CORE_BUILTIN_BLUEPRINT_CATALOG.length);
    }
    if (BUILTIN_DAILY_REWARD_BLUEPRINTS.length === 3) {
      expect(BUILTIN_DAILY_REWARD_BLUEPRINTS.map((blueprint) => [blueprint.id, blueprint.title])).toEqual([
        ["builtin-local-mysterious-enchanting-table", "Dieight的神秘附魔台"],
        ["builtin-local-small-water-tank", "Dieight的小水箱"],
        ["builtin-local-wqh-yellow-duck", "m0m0kA_QWQ的小黄鸭"],
      ]);
    } else {
      expect(BUILTIN_DAILY_REWARD_BLUEPRINTS).toEqual([]);
    }

    for (const entry of BUILTIN_BLUEPRINT_CATALOG) {
      const blueprint = entry.blueprint;
      expect(entry.id).toBe(blueprint.id);
      expect(BUILTIN_BLUEPRINTS.get(entry.id)).toBe(blueprint);
      expect(resolveBuiltinBlueprint(entry.id)).toBe(blueprint);
      expect(entry.description.trim()).not.toBe("");
      expect(["simple", "moderate", "detailed"]).toContain(entry.complexity);
      expect(entry.footprint).toEqual({
        width: blueprint.bounds.maxX - blueprint.bounds.minX + 1,
        depth: blueprint.bounds.maxZ - blueprint.bounds.minZ + 1,
      });
      expectTightBoundsAndUniqueCoordinates(blueprint);
    }
  });

  it("keeps daily rewards separate and within their smaller placement budget", () => {
    expect(BUILTIN_BLUEPRINT_CATALOG.some(({ id }) => BUILTIN_DAILY_REWARD_BLUEPRINTS.some((reward) => reward.id === id))).toBe(false);
    for (const blueprint of BUILTIN_DAILY_REWARD_BLUEPRINTS) {
      expect(blueprint.bounds.maxX - blueprint.bounds.minX + 1).toBeLessThanOrEqual(12);
      expect(blueprint.bounds.maxY - blueprint.bounds.minY + 1).toBeLessThanOrEqual(16);
      expect(blueprint.bounds.maxZ - blueprint.bounds.minZ + 1).toBeLessThanOrEqual(12);
      expect(blueprint.voxels.length).toBeLessThanOrEqual(2_000);
    }
  });

  it("credits all supplemental blueprints with a one-sentence visual description", () => {
    const sources = [
      ["builtin-local-advanced-matchbox", "Dieight的高级火柴盒", "Dieight的高级火柴盒"],
      ["builtin-local-advanced-matchbox-plus", "Dieight的高级火柴盒plus", "Dieight的高级火柴盒plus"],
      ["builtin-local-advanced-matchbox-pro", "Dieight的高级火柴盒pro", "Dieight的高级火柴盒pro"],
      ["builtin-local-gyp-simple-warehouse", "GYPpro的简易小仓库", "GYPpro的简易小仓库"],
      ["builtin-local-mysterious-enchanting-table", "Dieight的神秘附魔台", "Dieight的神秘附魔台"],
      ["builtin-local-small-villa", "Dieight的小别墅", "Dieight的小别墅"],
      ["builtin-local-small-water-tank", "Dieight的小水箱", "Dieight的小水箱"],
      ["builtin-local-gkr-mansion", "karry_steven的豪宅", "karry_steven的豪宅"],
      ["builtin-local-gyp-mansion-first-floor", "GYPpro的豪宅（一层）", "GYPpro的豪宅（一层）"],
      ["builtin-local-wqh-yellow-duck", "m0m0kA_QWQ的小黄鸭", "m0m0kA_QWQ的小黄鸭"],
    ] as const;
    for (const [id, title, credit] of sources) {
      const description = localBuiltinBlueprintDescription(id, title);
      expect(description).toMatch(new RegExp(`^${credit}：.+。$`));
      expect(description.match(/。/g)).toHaveLength(1);
      expect(description).not.toContain("本机打包");
      expect(BUILTIN_BLUEPRINT_CATALOG.find((entry) => entry.id === id)?.description ?? description).toBe(description);
    }
  });

  it("gives the checked-in buildings exterior torch light for the night scene", () => {
    for (const { blueprint } of CORE_BUILTIN_BLUEPRINT_CATALOG) {
      const lights = blueprint.voxels.filter((voxel) => voxel.emissiveLevel && voxel.emissiveLevel > 0);
      expect(lights.length).toBeGreaterThanOrEqual(2);
      expect(lights.every((voxel) => voxel.sourceBlockId === "minecraft:torch")).toBe(true);
    }
  });

  it("resolves unknown and blank IDs to a non-catalog placeholder", () => {
    expect(resolveBuiltinBlueprint("missing-blueprint")).toBe(UNKNOWN_BLUEPRINT_PLACEHOLDER);
    expect(resolveBuiltinBlueprint("")).toBe(UNKNOWN_BLUEPRINT_PLACEHOLDER);
    expect(BUILTIN_BLUEPRINTS.has(UNKNOWN_BLUEPRINT_PLACEHOLDER.id)).toBe(false);
    expect(BUILTIN_BLUEPRINT_CATALOG.some((entry) => entry.id === UNKNOWN_BLUEPRINT_PLACEHOLDER.id)).toBe(false);
    expectTightBoundsAndUniqueCoordinates(UNKNOWN_BLUEPRINT_PLACEHOLDER);
  });

  it("gives every built-in a distinct voxel shape", () => {
    const fingerprints = BUILTIN_BLUEPRINT_CATALOG.map(({ blueprint }) => shapeFingerprint(blueprint));
    expect(new Set(fingerprints).size).toBe(fingerprints.length);

    const profiles = BUILTIN_BLUEPRINT_CATALOG.map(({ blueprint }) => structuralProfile(blueprint));
    expect(new Set(profiles).size).toBe(profiles.length);
    for (const { blueprint } of BUILTIN_BLUEPRINT_CATALOG) {
      expectTightBoundsAndUniqueCoordinates(blueprint);
    }
    expect(new Set(SMALL_WORKSHOP_BLUEPRINT.voxels.map((voxel) => voxel.materialId)).has("wood")).toBe(true);
    expect(new Set(TIMBER_HOUSE_BLUEPRINT.voxels.map((voxel) => voxel.materialId)).has("wood")).toBe(true);
    expect(new Set(VILLAGE_CHAPEL_BLUEPRINT.voxels.map((voxel) => voxel.materialId)).has("plank")).toBe(true);
    expect(VILLAGE_CHAPEL_BLUEPRINT.bounds.maxY).toBeGreaterThan(SMALL_WORKSHOP_BLUEPRINT.bounds.maxY);
    expect(VILLAGE_CHAPEL_BLUEPRINT.bounds.maxY).toBeGreaterThan(TIMBER_HOUSE_BLUEPRINT.bounds.maxY);
  });
});

describe("coherent construction prefixes", () => {
  it("defines contiguous stages covering the complete basis-point range", () => {
    expect(CONSTRUCTION_STAGES[0]?.startBasisPoints).toBe(0);
    expect(CONSTRUCTION_STAGES.at(-1)?.endBasisPoints).toBe(10_000);
    expect(new Set(CONSTRUCTION_STAGES.map((stage) => stage.id)).size).toBe(CONSTRUCTION_STAGES.length);
    for (let index = 0; index < CONSTRUCTION_STAGES.length; index += 1) {
      const stage = CONSTRUCTION_STAGES[index]!;
      expect(stage.startBasisPoints).toBeLessThan(stage.endBasisPoints);
      if (index > 0) expect(stage.startBasisPoints).toBe(CONSTRUCTION_STAGES[index - 1]!.endBasisPoints);
    }
  });

  it.each(BUILTIN_BLUEPRINT_CATALOG.map((entry) => [entry.id, entry.blueprint] as const))(
    "%s grows only by appending voxels through every construction stage",
    (_id, blueprint) => {
      const orders = blueprint.voxels.map((voxel) => voxel.buildOrder);
      expect(orders).toEqual([...orders].sort((left, right) => left - right));
      expect(orders[0]).toBe(0);
      expect(orders.at(-1)).toBe(10_000);

      let previousCount = 0;
      for (const stage of CONSTRUCTION_STAGES) {
        expect(blueprint.voxels.some((voxel) =>
          voxel.buildOrder >= stage.startBasisPoints && voxel.buildOrder <= stage.endBasisPoints,
        )).toBe(true);
        const visible = blueprint.voxels.filter((voxel) => voxel.buildOrder <= stage.endBasisPoints);
        expect(visible.length).toBeGreaterThan(previousCount);
        expect(visible).toEqual(blueprint.voxels.slice(0, visible.length));
        previousCount = visible.length;
      }
      expect(previousCount).toBe(blueprint.voxels.length);
    },
  );
});

describe("settlement layout", () => {
  const worlds: WorldSnapshot[] = BUILTIN_BLUEPRINT_CATALOG.map((entry, settlementIndex) => ({
    projectId: `project-${settlementIndex}`,
    blueprintId: entry.id,
    buildingCompletionBasisPoints: 10_000,
    buildingConditionBasisPoints: 10_000,
    isMonument: settlementIndex !== 2,
    settlementIndex,
  }));

  it("is stable regardless of input order", () => {
    const forward = byProject(layoutWorlds(worlds));
    const reverse = byProject(layoutWorlds([...worlds].reverse()));
    expect(reverse).toEqual(forward);
  });

  it("places all building footprints without AABB overlap", () => {
    const positioned = layoutWorlds(worlds);
    expect(positioned).toHaveLength(BUILTIN_BLUEPRINT_CATALOG.length);
    expect(new Set(positioned.map((world) => world.projectId)).size).toBe(positioned.length);

    for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
        const left = worldAabb(positioned[leftIndex]!);
        const right = worldAabb(positioned[rightIndex]!);
        const separated = left.maxX < right.minX || right.maxX < left.minX
          || left.maxZ < right.minZ || right.maxZ < left.minZ;
        expect(separated, `${positioned[leftIndex]!.projectId} overlaps ${positioned[rightIndex]!.projectId}`).toBe(true);
        const largestAxisGap = Math.max(
          right.minX - left.maxX,
          left.minX - right.maxX,
          right.minZ - left.maxZ,
          left.minZ - right.maxZ,
        );
        expect(largestAxisGap, `${positioned[leftIndex]!.projectId} has no path gap from ${positioned[rightIndex]!.projectId}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("uses the placeholder when laying out a project with an unknown blueprint ID", () => {
    const [positioned] = layoutWorlds([{ ...worlds[0]!, blueprintId: "removed-blueprint" }]);
    expect(positioned?.blueprint).toStrictEqual(UNKNOWN_BLUEPRINT_PLACEHOLDER);
  });
});

function expectTightBoundsAndUniqueCoordinates(blueprint: BlueprintV1): void {
  expect(blueprint.voxels.length).toBeGreaterThan(0);
  const coordinates = blueprint.voxels.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`);
  expect(new Set(coordinates).size).toBe(coordinates.length);
  expect(Math.min(...blueprint.voxels.map((voxel) => voxel.x))).toBe(blueprint.bounds.minX);
  expect(Math.max(...blueprint.voxels.map((voxel) => voxel.x))).toBe(blueprint.bounds.maxX);
  expect(Math.min(...blueprint.voxels.map((voxel) => voxel.y))).toBe(blueprint.bounds.minY);
  expect(Math.max(...blueprint.voxels.map((voxel) => voxel.y))).toBe(blueprint.bounds.maxY);
  expect(Math.min(...blueprint.voxels.map((voxel) => voxel.z))).toBe(blueprint.bounds.minZ);
  expect(Math.max(...blueprint.voxels.map((voxel) => voxel.z))).toBe(blueprint.bounds.maxZ);
}

function shapeFingerprint(blueprint: BlueprintV1): string {
  return blueprint.voxels
    .map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}:${voxel.materialId}`)
    .sort()
    .join("|");
}

function structuralProfile(blueprint: BlueprintV1): string {
  const materialCounts = new Map<string, number>();
  for (const voxel of blueprint.voxels) {
    materialCounts.set(voxel.materialId, (materialCounts.get(voxel.materialId) ?? 0) + 1);
  }
  const dimensions = [
    blueprint.bounds.maxX - blueprint.bounds.minX + 1,
    blueprint.bounds.maxY - blueprint.bounds.minY + 1,
    blueprint.bounds.maxZ - blueprint.bounds.minZ + 1,
  ];
  return `${dimensions.join("x")}|${[...materialCounts].sort().map(([id, count]) => `${id}:${count}`).join(",")}`;
}

function byProject(worlds: ReturnType<typeof layoutWorlds>): Record<string, { x: number; z: number }> {
  return Object.fromEntries(worlds.map((world) => [world.projectId, world.worldPosition]));
}

function worldAabb(world: ReturnType<typeof layoutWorlds>[number]) {
  return {
    minX: world.worldPosition.x - world.footprint.width / 2,
    maxX: world.worldPosition.x + world.footprint.width / 2,
    minZ: world.worldPosition.z - world.footprint.depth / 2,
    maxZ: world.worldPosition.z + world.footprint.depth / 2,
  };
}
