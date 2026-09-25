import { describe, expect, it } from "vitest";
import type { BlueprintVoxel } from "../src/blueprint";
import { conditionVisualForVoxels } from "../src/environment";
import { createLocalOcclusionField } from "../src/local-occlusion";
import { isP1GeometryBlock } from "../src/resource-geometry";
import { planMovingPistonRenderVoxels } from "../src/resource-special-piston";

function movingPiston(
  x: number,
  movedState?: BlueprintVoxel["movingPistonMovedState"],
): BlueprintVoxel {
  return {
    x, y: 4, z: -2, materialId: "stone", buildOrder: 4_200,
    sourceBlockId: "minecraft:moving_piston",
    sourceBlockState: { facing: "east", type: "sticky" },
    ...(movedState === undefined ? {} : { movingPistonMovedState: movedState }),
  };
}

describe("static moving-piston display planning", () => {
  it("makes render-only voxels for a moved cube, slab, and stateful stair", () => {
    const movedLog = movingPiston(0, { blockId: "minecraft:oak_log", properties: { axis: "x" } });
    movedLog.movingPistonPose = { facing: "east", progress: 0.375, extending: true, source: false };
    const sourceVoxels = [
      movedLog,
      movingPiston(1, { blockId: "minecraft:stone_slab", properties: { type: "top", waterlogged: "false" } }),
      movingPiston(2, {
        blockId: "minecraft:oak_stairs",
        properties: { facing: "west", half: "top", shape: "straight", waterlogged: "false" },
      }),
    ];
    const snapshots = structuredClone(sourceVoxels);

    const plan = planMovingPistonRenderVoxels(sourceVoxels);

    expect(plan.resolved).toHaveLength(3);
    expect(plan.unresolved).toEqual([]);
    expect(plan.displayVoxels).toHaveLength(3);
    expect(plan.displayVoxels.map((voxel) => voxel.sourceBlockId)).toEqual([
      "minecraft:oak_log", "minecraft:stone_slab", "minecraft:oak_stairs",
    ]);
    expect(plan.displayVoxels.map((voxel) => voxel.sourceBlockState)).toEqual([
      { axis: "x" },
      { type: "top", waterlogged: "false" },
      { facing: "west", half: "top", shape: "straight", waterlogged: "false" },
    ]);
    expect(isP1GeometryBlock(plan.displayVoxels[1]!.sourceBlockId!, plan.displayVoxels[1]!.sourceBlockState)).toBe(true);
    expect(isP1GeometryBlock(plan.displayVoxels[2]!.sourceBlockId!, plan.displayVoxels[2]!.sourceBlockState)).toBe(true);
    expect(plan.displayVoxels.map(({ x, y, z, materialId, buildOrder }) => ({ x, y, z, materialId, buildOrder })))
      .toEqual([
        { x: -0.625, y: 4, z: -2, materialId: "stone", buildOrder: 4_200 },
        ...sourceVoxels.slice(1).map(({ x, y, z, materialId, buildOrder }) => ({ x, y, z, materialId, buildOrder })),
      ]);
    expect(plan.resolved[2]!.sourceVoxel).toBe(sourceVoxels[2]);
    expect(plan.resolved[2]!.displayVoxel).toBe(plan.displayVoxels[2]);
    expect(plan.displayVoxels[2]).not.toHaveProperty("movingPistonMovedState");
    expect(plan.displayVoxels[0]).not.toHaveProperty("movingPistonPose");
    expect(plan.displayVoxels[2]!.sourceBlockState).not.toBe(sourceVoxels[2]!.movingPistonMovedState!.properties);
    expect(sourceVoxels).toEqual(snapshots);
    expect(sourceVoxels.every((voxel) => voxel.sourceBlockId === "minecraft:moving_piston")).toBe(true);
    expect(sourceVoxels[0]!.movingPistonPose).toEqual({ facing: "east", progress: 0.375, extending: true, source: false });
  });

  it("applies extending and retracting offsets along all six facing directions", () => {
    const facings = [
      { facing: "down", step: [0, -1, 0] as const },
      { facing: "up", step: [0, 1, 0] as const },
      { facing: "north", step: [0, 0, -1] as const },
      { facing: "south", step: [0, 0, 1] as const },
      { facing: "west", step: [-1, 0, 0] as const },
      { facing: "east", step: [1, 0, 0] as const },
    ] as const;
    const origin = { x: 10, y: 20, z: 30 };

    for (const { facing, step } of facings) {
      for (const extending of [true, false]) {
        const source = movingPiston(origin.x, { blockId: "minecraft:oak_log", properties: { axis: "x" } });
        source.y = origin.y;
        source.z = origin.z;
        source.buildOrder = 7_321;
        source.movingPistonPose = { facing, progress: 0.375, extending, source: false };
        const sourceSnapshot = structuredClone(source);
        const distance = extending ? 0.375 - 1 : 1 - 0.375;

        const plan = planMovingPistonRenderVoxels([source]);
        const display = plan.displayVoxels[0]!;

        expect(plan.resolved).toHaveLength(1);
        expect(plan.unresolved).toEqual([]);
        expect(plan.displayVoxels).toHaveLength(1);
        expect([display.x, display.y, display.z]).toEqual([
          origin.x + step[0] * distance,
          origin.y + step[1] * distance,
          origin.z + step[2] * distance,
        ]);
        expect(display.buildOrder).toBe(source.buildOrder);
        expect(source).toEqual(sourceSnapshot);
      }
    }
  });

  it("keeps endpoint progress within one facing step", () => {
    const endpoints = [
      { progress: 0, extending: true, distance: -1 },
      { progress: 1, extending: true, distance: 0 },
      { progress: 0, extending: false, distance: 1 },
      { progress: 1, extending: false, distance: 0 },
    ] as const;

    for (const endpoint of endpoints) {
      const source = movingPiston(5, { blockId: "minecraft:stone" });
      source.movingPistonPose = {
        facing: "south", progress: endpoint.progress, extending: endpoint.extending, source: false,
      };

      const display = planMovingPistonRenderVoxels([source]).displayVoxels[0]!;

      expect([display.x, display.y, display.z]).toEqual([5, 4, -2 + endpoint.distance]);
      expect(source.z).toBe(-2);
    }
  });

  it("sets a moved piston-head short state at the verified half-progress boundary", () => {
    const atBoundary = movingPiston(0, {
      blockId: "minecraft:piston_head",
      properties: { facing: "north", type: "sticky", short: "false" },
    });
    atBoundary.movingPistonPose = { facing: "east", progress: 0.5, extending: true, source: false };
    const pastBoundary = movingPiston(1, {
      blockId: "minecraft:piston_head",
      properties: { facing: "down", type: "default", short: "true" },
    });
    pastBoundary.movingPistonPose = { facing: "west", progress: 0.5001, extending: false, source: false };
    const sources = [atBoundary, pastBoundary];
    const snapshots = structuredClone(sources);

    const plan = planMovingPistonRenderVoxels(sources);

    expect(plan.resolved).toHaveLength(2);
    expect(plan.displayVoxels).toHaveLength(2);
    expect(plan.displayVoxels.map((voxel) => voxel.sourceBlockId)).toEqual([
      "minecraft:piston_head", "minecraft:piston_head",
    ]);
    expect(plan.displayVoxels.map((voxel) => voxel.sourceBlockState)).toEqual([
      { facing: "north", type: "sticky", short: "true" },
      { facing: "down", type: "default", short: "false" },
    ]);
    expect(sources).toEqual(snapshots);
  });

  it("renders a source retracting piston base as a moving head plus a static extended base", () => {
    for (const { blockId, headType } of [
      { blockId: "minecraft:piston", headType: "default" },
      { blockId: "minecraft:sticky_piston", headType: "sticky" },
    ]) {
      for (const { progress, short } of [
        { progress: 0.25, short: "false" },
        { progress: 0.75, short: "true" },
      ]) {
        const source = movingPiston(3, { blockId, properties: { facing: "west", extended: "false" } });
        source.movingPistonPose = { facing: "east", progress, extending: false, source: true };
        const snapshot = structuredClone(source);

        const plan = planMovingPistonRenderVoxels([source]);
        const main = plan.resolved[0]!.displayVoxel;
        const staticBase = plan.displayVoxels[1]!;

        expect(plan.resolved).toHaveLength(1);
        expect(plan.displayVoxels).toHaveLength(2);
        expect(plan.unresolved).toEqual([]);
        expect(plan.displayVoxels[0]).toBe(main);
        expect(main.sourceBlockId).toBe("minecraft:piston_head");
        expect(main.sourceBlockState).toEqual({ facing: "west", type: headType, short });
        expect([main.x, main.y, main.z]).toEqual([3 + 1 - progress, 4, -2]);
        expect(main.buildOrder).toBe(source.buildOrder);
        expect(staticBase).not.toBe(source);
        expect(staticBase.sourceBlockId).toBe(blockId);
        expect(staticBase.sourceBlockState).toEqual({ facing: "west", extended: "true" });
        expect([staticBase.x, staticBase.y, staticBase.z]).toEqual([3, 4, -2]);
        expect(staticBase.buildOrder).toBe(source.buildOrder);
        expect(staticBase).not.toHaveProperty("movingPistonMovedState");
        expect(staticBase).not.toHaveProperty("movingPistonPose");
        expect(source).toEqual(snapshot);
      }
    }
  });

  it("keeps unlisted piston states on the ordinary moved-block path", () => {
    const invalidHead = movingPiston(0, {
      blockId: "minecraft:piston_head",
      properties: { facing: "sideways", type: "sticky", short: "false" },
    });
    invalidHead.movingPistonPose = { facing: "east", progress: 0.25, extending: true, source: false };
    const invalidBase = movingPiston(1, {
      blockId: "minecraft:piston",
      properties: { facing: "west", extended: "false", unexpected: "value" },
    });
    invalidBase.movingPistonPose = { facing: "east", progress: 0.25, extending: false, source: true };
    const unflaggedSource = movingPiston(2, {
      blockId: "minecraft:sticky_piston", properties: { facing: "west", extended: "false" },
    });
    unflaggedSource.movingPistonPose = { facing: "east", progress: 0.25, extending: false, source: false };
    const sources = [invalidHead, invalidBase, unflaggedSource];

    const plan = planMovingPistonRenderVoxels(sources);

    expect(plan.resolved).toHaveLength(3);
    expect(plan.displayVoxels).toHaveLength(3);
    expect(plan.displayVoxels.map((voxel) => voxel.sourceBlockId)).toEqual([
      "minecraft:piston_head", "minecraft:piston", "minecraft:sticky_piston",
    ]);
    expect(plan.displayVoxels[0]!.sourceBlockState).toEqual({ facing: "sideways", type: "sticky", short: "false" });
    expect(plan.displayVoxels[1]!.sourceBlockState).toEqual({ facing: "west", extended: "false", unexpected: "value" });
  });

  it("keeps missing or malformed poses centered while rendering valid moved states", () => {
    const missingPose = movingPiston(0, { blockId: "minecraft:oak_log" });
    const invalidProgress = movingPiston(1, { blockId: "minecraft:oak_log" });
    const invalidFacing = movingPiston(2, { blockId: "minecraft:oak_log" });
    const invalidFlags = movingPiston(3, { blockId: "minecraft:oak_log" });
    Object.assign(invalidProgress, { movingPistonPose: { facing: "east", progress: Number.NaN, extending: true, source: false } });
    Object.assign(invalidFacing, { movingPistonPose: { facing: "eastward", progress: 0.5, extending: true, source: false } });
    Object.assign(invalidFlags, { movingPistonPose: { facing: "east", progress: 0.5, extending: 1, source: false } });
    const missingSourceBase = movingPiston(4, {
      blockId: "minecraft:sticky_piston", properties: { facing: "west", extended: "false" },
    });
    const invalidPoseBase = movingPiston(5, {
      blockId: "minecraft:piston", properties: { facing: "west", extended: "false" },
    });
    Object.assign(invalidPoseBase, { movingPistonPose: { facing: "east", progress: 2, extending: false, source: true } });
    const sources = [missingPose, invalidProgress, invalidFacing, invalidFlags, missingSourceBase, invalidPoseBase];
    const snapshots = structuredClone(sources);

    const plan = planMovingPistonRenderVoxels(sources);

    expect(plan.resolved).toHaveLength(sources.length);
    expect(plan.unresolved).toEqual([]);
    expect(plan.displayVoxels).toHaveLength(sources.length);
    expect(plan.displayVoxels.map(({ x, y, z }) => ({ x, y, z }))).toEqual(
      sources.map(({ x, y, z }) => ({ x, y, z })),
    );
    expect(plan.displayVoxels.every((voxel) => !("movingPistonPose" in voxel))).toBe(true);
    expect(sources).toEqual(snapshots);
  });

  it("leaves missing, malformed, air, and nested moving-piston states unresolved", () => {
    const noState = movingPiston(0);
    const malformed = movingPiston(1, { blockId: "minecraft:oak_log", properties: { axis: "not a state value" } });
    const air = movingPiston(2, { blockId: "minecraft:air" });
    const nested = movingPiston(3, { blockId: "minecraft:moving_piston" });
    const unrelated = {
      x: 4, y: 4, z: -2, materialId: "wood", buildOrder: 4_200, sourceBlockId: "minecraft:oak_planks",
    } satisfies BlueprintVoxel;

    const plan = planMovingPistonRenderVoxels([noState, malformed, air, nested, unrelated]);

    expect(plan.unresolved).toEqual([
      { sourceVoxel: noState, reason: "missing_moved_state" },
      { sourceVoxel: malformed, reason: "invalid_moved_state" },
      { sourceVoxel: air, reason: "air_moved_state" },
      { sourceVoxel: nested, reason: "nested_moving_piston" },
    ]);
    expect(plan.displayVoxels).toEqual([unrelated]);
    expect(plan.resolved).toEqual([]);
  });

  it("rejects unsafe or non-plain state payloads without mutating source voxels", () => {
    const unsafeProperties = Object.create(null) as Record<string, string>;
    Object.defineProperty(unsafeProperties, "constructor", { value: "x", enumerable: true });
    const invalidInputs = [
      movingPiston(0, { blockId: "minecraft:oak_log", properties: unsafeProperties }),
      movingPiston(1, { blockId: "minecraft:oak_log", properties: Object.assign(Object.create({ axis: "x" }), {}) }),
      movingPiston(2, { blockId: "example:oak_log" }),
    ];
    const snapshots = structuredClone(invalidInputs);

    const plan = planMovingPistonRenderVoxels(invalidInputs);

    expect(plan.unresolved.map(({ reason }) => reason)).toEqual([
      "invalid_moved_state", "invalid_moved_state", "invalid_moved_state",
    ]);
    expect(plan.displayVoxels).toEqual([]);
    expect(invalidInputs).toEqual(snapshots);
  });

  it("does not write through frozen validated blueprint data", () => {
    const source = movingPiston(8, { blockId: "minecraft:oak_log", properties: { axis: "z" } });
    Object.freeze(source.movingPistonMovedState!.properties);
    Object.freeze(source.movingPistonMovedState);
    Object.freeze(source.sourceBlockState);
    Object.freeze(source);

    const plan = planMovingPistonRenderVoxels([source]);

    expect(plan.resolved).toHaveLength(1);
    expect(plan.resolved[0]!.sourceVoxel).toBe(source);
    expect(plan.displayVoxels[0]).not.toBe(source);
    expect(source.sourceBlockId).toBe("minecraft:moving_piston");
    expect(source.sourceBlockState).toEqual({ facing: "east", type: "sticky" });
  });

  it("keeps build-prefix order and visual counts while using moved shapes for occlusion", () => {
    const support: BlueprintVoxel = {
      x: 0, y: 0, z: 0, materialId: "stone", buildOrder: 0, sourceBlockId: "minecraft:stone",
    };
    const piston = movingPiston(0, { blockId: "minecraft:oak_stairs", properties: { facing: "south", shape: "straight" } });
    piston.y = 1;
    piston.buildOrder = 4_200;
    const sourceVoxels = [support, piston];

    const plan = planMovingPistonRenderVoxels(sourceVoxels);
    const visuals = conditionVisualForVoxels("piston-project", plan.displayVoxels, 10_000);
    const occlusion = createLocalOcclusionField(visuals.intactVoxels);
    const newRevealVoxels = visuals.intactVoxels.filter((voxel) => voxel.buildOrder > 3_800);

    expect(plan.displayVoxels).toHaveLength(sourceVoxels.length);
    expect(sourceVoxels).toHaveLength(2);
    expect(visuals.intactVoxels.map((voxel) => voxel.buildOrder)).toEqual([0, 4_200]);
    expect(visuals.intactVoxels[1]!.sourceBlockId).toBe("minecraft:oak_stairs");
    expect(newRevealVoxels).toEqual([plan.displayVoxels[1]]);
    expect(occlusion.occupied).toEqual(new Set(["0:0:0", "0:1:-2"]));

    const unresolved = movingPiston(1);
    unresolved.y = 1;
    const unresolvedSourceVoxels = [support, unresolved];
    const unresolvedPlan = planMovingPistonRenderVoxels(unresolvedSourceVoxels);
    const unresolvedOcclusion = createLocalOcclusionField(unresolvedPlan.displayVoxels);
    expect(unresolvedPlan.displayVoxels).toEqual([support]);
    expect(unresolvedOcclusion.occupied).toEqual(new Set(["0:0:0"]));
    expect(unresolvedSourceVoxels).toHaveLength(2);
  });
});
