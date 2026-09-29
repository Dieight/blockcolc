import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { BlueprintVoxel } from "../src/blueprint";
import {
  MAX_ORIGINAL_STATIC_SHAPE_BATCHES,
  createOriginalStaticShapeGeometry,
  groupOriginalStaticShapeEntries,
  isOriginalStaticShapeBlockId,
  originalStaticShapeForVoxel,
  planOriginalStaticShapeBatches,
} from "../src/original-static-shapes";
import { fallbackVisualStyleForOriginalComponent, fallbackVisualStyleForVoxel } from "../src/fallback-visual";
import { sourceCandleEmissionForVoxel, sourceLanternEmissionForVoxel } from "../src/lighting";
import { clusterEmissivePoints, emissiveColorForPoint } from "../src/lighting";

interface Mc263SmallComponentInventory {
  schema: string;
  target: string;
  propertyDomainsEncoding: string;
  source: {
    blocksReportSha256: string;
    clientJarSha1: string;
    clientJarSha256: string;
  };
  counts: { blockCount: number; stateCount: number; fenceGate: number; button: number; pressurePlate: number };
  blocks: Array<{
    id: string;
    propertyOrder: string[];
    properties: Record<string, string[]>;
    domainProduct: number;
    stateCount: number;
    stateMapsUnique: number;
    defaultStateCount: number;
    states: number[][];
  }>;
}

const mc263SmallComponentInventory = JSON.parse(readFileSync(
  new URL("./fixtures/mc263-original-small-components.json", import.meta.url),
  "utf8",
)) as Mc263SmallComponentInventory;

describe("original static shape approximations", () => {
  it("covers the four exact Java 26.3 sign families with shared rotated components", () => {
    const woods = `acacia bamboo birch cherry crimson dark_oak jungle mangrove oak pale_oak poplar spruce warped`.split(" ");
    let states = 0;
    for (const wood of woods) {
      for (const waterlogged of ["true", "false"]) {
        for (let rotation = 0; rotation < 16; rotation += 1) {
          const standing = shape(`minecraft:${wood}_sign`, { rotation: String(rotation), waterlogged });
          expect(standing.components?.map((part) => part.topologyKey)).toEqual(["sign:board", "sign:support:fixed"]);
          states += 1;
          for (const attached of ["true", "false"]) {
            const hanging = shape(`minecraft:${wood}_hanging_sign`, { attached, rotation: String(rotation), waterlogged });
            expect(hanging.components?.map((part) => part.topologyKey)).toEqual(["hanging-sign:board", `hanging-sign:support:${attached}`]);
            states += 1;
          }
        }
        for (const facing of ["north", "east", "south", "west"]) {
          for (const suffix of ["wall_sign", "wall_hanging_sign"]) {
            const wall = shape(`minecraft:${wood}_${suffix}`, { facing, waterlogged });
            expect(wall.components?.[0]?.topologyKey).toBe(suffix === "wall_sign" ? "wall-sign:board" : "wall-hanging-sign:board");
            states += 1;
          }
        }
      }
    }
    expect(states).toBe(1456);
    const north = shape("minecraft:oak_sign", { rotation: "0", waterlogged: "false" });
    const east = shape("minecraft:oak_sign", { rotation: "4", waterlogged: "false" });
    expect(north.components?.[0]?.topologyKey).toBe(east.components?.[0]?.topologyKey);
    expect(north.components?.[0]?.transform).not.toEqual(east.components?.[0]?.transform);
    expect(north.bounds.max[1]).toBeGreaterThan(0.5);
    for (const invalid of [
      voxel("minecraft:oak_sign", { rotation: "16", waterlogged: "false" }),
      voxel("minecraft:oak_hanging_sign", { attached: "maybe", rotation: "0", waterlogged: "false" }),
      voxel("minecraft:oak_wall_sign", { facing: "up", waterlogged: "false" }),
      voxel("mod:oak_sign", { rotation: "0", waterlogged: "false" }),
    ]) expect(originalStaticShapeForVoxel(invalid).kind).toBe("cube-fallback");
  });

  it("keeps stair geometry bounded and changes its real footprint for shape and half", () => {
    const straight = shape("minecraft:oak_stairs", { facing: "north", half: "bottom", shape: "straight" });
    const inner = shape("minecraft:oak_stairs", { facing: "north", half: "bottom", shape: "inner_left" });
    const outer = shape("minecraft:oak_stairs", { facing: "north", half: "bottom", shape: "outer_right" });
    const upsideDown = shape("minecraft:oak_stairs", { facing: "north", half: "top", shape: "straight" });

    expect([straight.volume, inner.volume, outer.volume]).toEqual([0.75, 0.875, 0.625]);
    expect(inner.boxes).toHaveLength(4);
    expect(outer.boxes).toHaveLength(2);
    expect(new Set([straight.topologyKey, inner.topologyKey, outer.topologyKey]).size).toBe(3);
    expect(bounds(straight).min).toEqual([-0.5, -0.5, -0.5]);
    expect(bounds(straight).max).toEqual([0.5, 0.5, 0.5]);
    expect(straight.boxes.some((entry) => entry.min[1] === -0.5 && entry.max[1] === 0)).toBe(true);
    expect(upsideDown.boxes.some((entry) => entry.min[1] === 0 && entry.max[1] === 0.5)).toBe(true);
    expect(upsideDown.topologyKey).not.toBe(straight.topologyKey);
    expect(straight.boxes[1]!.min[2]).toBe(-0.5);
    expect(straight.boxes[1]!.max[2]).toBe(0);
    expect(allInsideCell([straight, inner, outer, upsideDown])).toBe(true);
  });

  it("maps every stair facing and inner/outer turn to deterministic, distinct topology", () => {
    const facings = ["north", "east", "south", "west"] as const;
    const oriented = facings.map((facing) => shape("minecraft:stone_stairs", { facing, half: "bottom", shape: "straight" }));
    const keys = oriented.map((entry) => entry.topologyKey);
    expect(new Set(keys).size).toBe(4);
    expect(oriented[1]!.boxes[1]!.min[0]).toBe(0);
    expect(oriented[1]!.boxes[1]!.max[0]).toBe(0.5);
    expect(oriented[2]!.boxes[1]!.min[2]).toBe(0);
    expect(oriented[2]!.boxes[1]!.max[2]).toBe(0.5);
    expect(oriented[3]!.boxes[1]!.min[0]).toBe(-0.5);
    expect(oriented[3]!.boxes[1]!.max[0]).toBe(0);
    for (const facing of facings) {
      const innerLeft = shape("minecraft:oak_stairs", { facing, half: "bottom", shape: "inner_left" });
      const innerRight = shape("minecraft:oak_stairs", { facing, half: "bottom", shape: "inner_right" });
      const outerLeft = shape("minecraft:oak_stairs", { facing, half: "bottom", shape: "outer_left" });
      const outerRight = shape("minecraft:oak_stairs", { facing, half: "bottom", shape: "outer_right" });
      expect(new Set([innerLeft.topologyKey, innerRight.topologyKey]).size).toBe(2);
      expect(new Set([outerLeft.topologyKey, outerRight.topologyKey]).size).toBe(2);
      expect(innerLeft.volume).toBe(0.875);
      expect(outerRight.volume).toBe(0.625);
    }
  });

  it("distinguishes bottom, top and double slabs by actual height and volume", () => {
    const bottom = shape("minecraft:oak_slab", { type: "bottom" });
    const top = shape("minecraft:oak_slab", { type: "top" });
    const double = shape("minecraft:oak_slab", { type: "double" });
    expect([bottom.volume, top.volume, double.volume]).toEqual([0.5, 0.5, 1]);
    expect(bounds(bottom).min[1]).toBe(-0.5);
    expect(bounds(bottom).max[1]).toBe(0);
    expect(bounds(top).min[1]).toBe(0);
    expect(bounds(top).max[1]).toBe(0.5);
    expect(double.boxes).toHaveLength(1);
    expect(new Set([bottom.topologyKey, top.topologyKey, double.topologyKey]).size).toBe(3);
  });

  it("builds connected fences, low/tall walls and thin panes/bars from their state", () => {
    const disconnected = shape("minecraft:oak_fence", { north: "false", east: "false", south: "false", west: "false" });
    const fenceNorth = shape("minecraft:oak_fence", { north: "true", east: "false", south: "false", west: "false" });
    const fenceEast = shape("minecraft:oak_fence", { north: "false", east: "true", south: "false", west: "false" });
    const fenceSouth = shape("minecraft:oak_fence", { north: "false", east: "false", south: "true", west: "false" });
    const fenceWest = shape("minecraft:oak_fence", { north: "false", east: "false", south: "false", west: "true" });
    expect(fenceNorth.volume).toBeGreaterThan(disconnected.volume);
    expect(new Set([fenceNorth, fenceEast, fenceSouth, fenceWest].map((entry) => entry.topologyKey)).size).toBe(4);
    expect(bounds(fenceNorth).min[2]).toBe(-0.5);
    expect(bounds(fenceEast).max[0]).toBe(0.5);
    expect(bounds(fenceSouth).max[2]).toBe(0.5);
    expect(bounds(fenceWest).min[0]).toBe(-0.5);

    const walls = ["north", "east", "south", "west"] as const;
    const wallKeys: string[] = [];
    for (const side of walls) {
      const state = { up: "true", north: "none", east: "none", south: "none", west: "none", [side]: "low" };
      const low = shape("minecraft:cobblestone_wall", state);
      const tall = shape("minecraft:cobblestone_wall", { ...state, [side]: "tall" });
      expect(tall.volume).toBeGreaterThan(low.volume);
      expect(tall.topologyKey).not.toBe(low.topologyKey);
      expect(allInsideCell([low, tall])).toBe(true);
      wallKeys.push(low.topologyKey);
    }
    expect(new Set(wallKeys).size).toBe(4);
    const wallWithPost = shape("minecraft:cobblestone_wall", { up: "true", north: "low", east: "none", south: "none", west: "none" });
    const wallWithoutPost = shape("minecraft:cobblestone_wall", { up: "false", north: "low", east: "none", south: "none", west: "none" });
    expect(wallWithPost.volume).toBeGreaterThan(wallWithoutPost.volume);
    const mixedWall = shape("minecraft:cobblestone_wall", { up: "false", north: "low", east: "none", south: "tall", west: "none" });
    expect(disjointVolume(mixedWall)).toBeCloseTo(mixedWall.volume, 5);
    expect(isGridConnected(mixedWall)).toBe(true);
    const pane = shape("minecraft:glass_pane", { north: "true", east: "false", south: "false", west: "false" });
    const bars = shape("minecraft:iron_bars", { north: "true", east: "false", south: "false", west: "false" });
    expect(pane.bounds.min[2]).toBe(-0.5);
    expect(pane.boxes.every((entry) => (entry.max[0] - entry.min[0]) <= 0.125)).toBe(true);
    expect(bars.bounds.min[2]).toBe(-0.5);
    expect(bars.family).toBe("iron-bars");
  });

  it("changes door/trapdoor geometry for orientation, hinge, open and vertical half", () => {
    const closedNorth = shape("minecraft:oak_door", { facing: "north", open: "false", hinge: "left", half: "lower" });
    const closedRightHinge = shape("minecraft:oak_door", { facing: "north", open: "false", hinge: "right", half: "lower" });
    const closedEast = shape("minecraft:oak_door", { facing: "east", open: "false", hinge: "left", half: "lower" });
    const openLeft = shape("minecraft:oak_door", { facing: "north", open: "true", hinge: "left", half: "lower" });
    const openRight = shape("minecraft:oak_door", { facing: "north", open: "true", hinge: "right", half: "lower" });
    const upper = shape("minecraft:oak_door", { facing: "north", open: "false", hinge: "left", half: "upper" });
    expect(bounds(closedNorth).max[1] - bounds(closedNorth).min[1]).toBe(1);
    expect(closedNorth.topologyKey).toBe(closedRightHinge.topologyKey);
    expect(closedNorth.topologyKey).not.toBe(closedEast.topologyKey);
    expect(openLeft.topologyKey).not.toBe(openRight.topologyKey);
    expect(bounds(openLeft).max[0] - bounds(openLeft).min[0]).toBe(0.125);
    expect(bounds(openLeft).min[0]).not.toBe(bounds(openRight).min[0]);
    expect(bounds(upper).min[1]).toBe(-0.5);
    expect(bounds(upper).max[1]).toBe(0.5);
    const lowerGlobalMinY = bounds(closedNorth).min[1];
    const lowerGlobalMaxY = bounds(closedNorth).max[1];
    const upperGlobalMinY = bounds(upper).min[1] + 1;
    const upperGlobalMaxY = bounds(upper).max[1] + 1;
    expect([lowerGlobalMinY, lowerGlobalMaxY, upperGlobalMinY, upperGlobalMaxY]).toEqual([-0.5, 0.5, 0.5, 1.5]);
    expect(lowerGlobalMaxY).toBe(upperGlobalMinY);
    expect([upperGlobalMinY, upperGlobalMaxY]).toEqual([0.5, 1.5]);

    const trapBottom = shape("minecraft:oak_trapdoor", { facing: "north", open: "false", half: "bottom" });
    const trapBottomEast = shape("minecraft:oak_trapdoor", { facing: "east", open: "false", half: "bottom" });
    const trapTop = shape("minecraft:oak_trapdoor", { facing: "north", open: "false", half: "top" });
    const trapOpen = shape("minecraft:oak_trapdoor", { facing: "north", open: "true", half: "bottom" });
    const trapOpenEast = shape("minecraft:oak_trapdoor", { facing: "east", open: "true", half: "bottom" });
    expect(bounds(trapBottom).max[1]).toBe(-0.375);
    expect(bounds(trapTop).min[1]).toBe(0.375);
    expect(trapBottom.topologyKey).toBe(trapBottomEast.topologyKey);
    expect(bounds(trapOpen).min[1]).toBe(-0.5);
    expect(bounds(trapOpen).max[1]).toBe(0.5);
    expect(trapOpen.topologyKey).not.toBe(trapOpenEast.topologyKey);
    expect(bounds(shape("minecraft:ladder", { facing: "north" })).max[1]).toBe(0.5);
  });

  it("rejects unknown namespaces and absent or invalid required state to an explicit cube", () => {
    const fixtures: Array<[BlueprintVoxel, string]> = [
      [voxel("mod:oak_stairs", { facing: "north", half: "bottom", shape: "straight" }), "unknown-namespace"],
      [voxel("minecraft:oak_stairs", { facing: "north", half: "bottom" }), "invalid-state"],
      [voxel("minecraft:oak_stairs", { facing: "northwest", half: "bottom", shape: "straight" }), "invalid-state"],
      [voxel("minecraft:oak_slab", { type: "sideways" }), "invalid-state"],
      [voxel("minecraft:oak_fence", { north: "true", east: "false", south: "false" }), "invalid-state"],
      [voxel("minecraft:not_a_real_stairs", { facing: "north", half: "bottom", shape: "straight" }), "unsupported-block"],
      [voxel("minecraft:stone", {}), "unsupported-block"],
    ];
    for (const [fixture, reason] of fixtures) {
      const result = originalStaticShapeForVoxel(fixture);
      expect(result.kind).toBe("cube-fallback");
      if (result.kind === "cube-fallback") {
        expect(result.reason).toBe(reason);
        expect(result.volume).toBe(1);
        expect(result.bounds.min).toEqual([-0.5, -0.5, -0.5]);
        expect(result.bounds.max).toEqual([0.5, 0.5, 0.5]);
      }
    }
    expect(originalStaticShapeForVoxel({}).kind).toBe("cube-fallback");
    expect(isOriginalStaticShapeBlockId("minecraft:oak_stairs")).toBe(true);
    expect(isOriginalStaticShapeBlockId("minecraft:not_a_real_stairs")).toBe(false);
    expect(isOriginalStaticShapeBlockId("mod:oak_stairs")).toBe(false);
  });

  it("normalizes key order and ignores coordinate/material when grouping topology", () => {
    const first = voxel("minecraft:oak_fence", { north: "true", east: "false", south: "false", west: "false" }, 0);
    const second = voxel("minecraft:spruce_fence", { west: "false", south: "false", east: "false", north: "true" }, 10);
    const firstShape = originalStaticShapeForVoxel(first);
    const secondShape = originalStaticShapeForVoxel(second);
    expect(firstShape.kind).toBe("original-approximation");
    expect(secondShape.kind).toBe("original-approximation");
    if (firstShape.kind === "original-approximation" && secondShape.kind === "original-approximation") {
      expect(firstShape.topologyKey).toBe(secondShape.topologyKey);
      expect(firstShape.boxes).toEqual(secondShape.boxes);
    }
  });

  it("groups delimiter-bearing topology by structured material and emissive fields", () => {
    const wood = { ...voxel("minecraft:oak_stairs", { facing: "north", half: "bottom", shape: "inner_left" }), materialId: "wood" as const };
    const glass = { ...voxel("minecraft:oak_stairs", { facing: "north", half: "bottom", shape: "inner_left" }, 1), materialId: "glass" as const };
    const emissive = {
      ...voxel("minecraft:oak_stairs", { facing: "north", half: "bottom", shape: "inner_left" }, 2),
      materialId: "wood" as const,
      emissiveKind: "lamp",
      emissiveLevel: 12,
    };
    const planned = planOriginalStaticShapeBatches([wood, glass, emissive]);
    const grouped = groupOriginalStaticShapeEntries(planned, (entry) => fallbackVisualStyleForVoxel(entry).key);
    expect(grouped.groups).toHaveLength(3);
    expect(grouped.groups.every((group) => group.topologyKey.includes("|"))).toBe(true);
    const woodGroup = grouped.groups.find((group) => group.entries.some((entry) => entry.voxel === wood && entry.voxel.emissiveKind === undefined));
    const glassGroup = grouped.groups.find((group) => group.entries.some((entry) => entry.voxel === glass));
    const emissiveGroup = grouped.groups.find((group) => group.entries.some((entry) => entry.voxel === emissive));
    expect(woodGroup?.materialKey).toBe(fallbackVisualStyleForVoxel(wood).key);
    expect(woodGroup?.emissiveKind).toBe("");
    expect(woodGroup?.emissiveLevel).toBe(0);
    expect(glassGroup?.materialKey).toBe(fallbackVisualStyleForVoxel(glass).key);
    expect(glassGroup?.emissiveKind).toBe("");
    expect(emissiveGroup?.materialKey).toBe(fallbackVisualStyleForVoxel(emissive).key);
    expect(emissiveGroup?.emissiveKind).toBe("lamp");
    expect(emissiveGroup?.emissiveLevel).toBe(12);
    expect(grouped.fallbackEntries).toHaveLength(0);
  });

  it("keeps kind-only emission separate from explicit zero in both group orders", () => {
    const kindOnly = { ...voxel("minecraft:oak_slab", { type: "bottom" }), emissiveKind: "torch" };
    const explicitZero = { ...voxel("minecraft:oak_slab", { type: "bottom" }, 1), emissiveKind: "torch", emissiveLevel: 0 };
    const explicitPositive = { ...voxel("minecraft:oak_slab", { type: "bottom" }, 2), emissiveKind: "torch", emissiveLevel: 7 };
    const unlit = voxel("minecraft:oak_slab", { type: "bottom" }, 3);
    for (const entries of [[kindOnly, explicitZero, explicitPositive, unlit], [unlit, explicitPositive, explicitZero, kindOnly]]) {
      const grouped = groupOriginalStaticShapeEntries(planOriginalStaticShapeBatches(entries), () => "stone");
      expect(grouped.groups).toHaveLength(4);
      expect(grouped.groups.find(group => group.entries.some(entry => entry.voxel === kindOnly))).toMatchObject({ emissiveKind: "torch", emissiveLevel: 15 });
      expect(grouped.groups.find(group => group.entries.some(entry => entry.voxel === explicitZero))).toMatchObject({ emissiveKind: "torch", emissiveLevel: 0 });
      expect(grouped.groups.find(group => group.entries.some(entry => entry.voxel === explicitPositive))).toMatchObject({ emissiveKind: "torch", emissiveLevel: 7 });
      expect(grouped.groups.find(group => group.entries.some(entry => entry.voxel === unlit))).toMatchObject({ emissiveKind: "", emissiveLevel: 0 });
      expect(grouped.groups.every(group => group.entries.length === 1)).toBe(true);
    }
  });

  it("counts emission splits inside the hard 64 material-group budget atomically", () => {
    const fillers = Array.from({ length: 63 }, (_, index) => voxel("minecraft:oak_slab", { type: "bottom" }, index + 2));
    const kindOnly = { ...voxel("minecraft:oak_slab", { type: "bottom" }), emissiveKind: "torch" };
    const explicitZero = { ...voxel("minecraft:oak_slab", { type: "bottom" }, 1), emissiveKind: "torch", emissiveLevel: 0 };
    const entries = [kindOnly, explicitZero, ...fillers];
    const grouped = groupOriginalStaticShapeEntries(planOriginalStaticShapeBatches(entries), entry => `mat-${entry.x}`, 1_000);
    const accepted = grouped.groups.flatMap(group => group.entries.map(entry => entry.voxel));
    const fallback = grouped.fallbackEntries.map(entry => entry.voxel);
    expect(grouped.limit).toBe(64);
    expect(grouped.groups).toHaveLength(64);
    expect(grouped.overflow).toBe(1);
    expect(fallback).toHaveLength(1);
    expect(accepted.length + fallback.length).toBe(entries.length);
    expect(new Set([...accepted, ...fallback]).size).toBe(entries.length);
    expect(accepted.some(voxel => voxel === kindOnly) !== fallback.includes(kindOnly)).toBe(true);
    expect(accepted.some(voxel => voxel === explicitZero) !== fallback.includes(explicitZero)).toBe(true);
  });

  it("keeps actual material-group meshes under the same hard 64 batch budget", () => {
    const sameShape = Array.from({ length: 80 }, (_, index) => (
      voxel("minecraft:oak_stairs", { facing: "north", half: "bottom", shape: "straight" }, index)
    ));
    const plan = planOriginalStaticShapeBatches(sameShape);
    const grouped = groupOriginalStaticShapeEntries(plan, (entry) => `material-${entry.x}`, 1_000);
    expect(grouped.limit).toBe(MAX_ORIGINAL_STATIC_SHAPE_BATCHES);
    expect(grouped.groups).toHaveLength(MAX_ORIGINAL_STATIC_SHAPE_BATCHES);
    expect(grouped.overflow).toBe(16);
    expect(grouped.fallbackEntries).toHaveLength(16);
    expect(grouped.fallbackEntries.every((entry) => entry.shape.kind === "cube-fallback")).toBe(true);
  });

  it("enforces a deterministic batch-topology budget with explicit cube fallback", () => {
    const states: BlueprintVoxel[] = [
      voxel("minecraft:oak_slab", { type: "bottom" }),
      voxel("minecraft:oak_slab", { type: "top" }),
      voxel("minecraft:oak_slab", { type: "double" }),
      voxel("minecraft:oak_slab", { type: "bottom" }, 3),
    ];
    const result = planOriginalStaticShapeBatches(states, 2);
    expect(MAX_ORIGINAL_STATIC_SHAPE_BATCHES).toBeGreaterThan(0);
    expect(result.batches.length).toBeLessThanOrEqual(2);
    expect(result.budget.actual).toBe(2);
    expect(result.budget.overflow).toBe(1);
    expect(result.fallbackEntries).toHaveLength(1);
    expect(result.fallbackEntries[0]!.shape.kind).toBe("cube-fallback");
    if (result.fallbackEntries[0]!.shape.kind === "cube-fallback") {
      expect(result.fallbackEntries[0]!.shape.reason).toBe("budget-exceeded");
    }
    expect(planOriginalStaticShapeBatches(states, 2).batches.map((batch) => batch.topologyKey))
      .toEqual(result.batches.map((batch) => batch.topologyKey));
    expect(planOriginalStaticShapeBatches(states).batches.length).toBeLessThanOrEqual(MAX_ORIGINAL_STATIC_SHAPE_BATCHES);
  });

  it("hard clamps malformed and oversized limits and over 64 distinct real wall topologies", () => {
    const inputs: BlueprintVoxel[] = [];
    for (let code = 0; code < 81; code += 1) {
      let digits = code;
      const sides = ["north", "east", "south", "west"] as const;
      const state: Record<string, string> = { up: code % 2 === 0 ? "false" : "true" };
      for (const side of sides) {
        const digit = digits % 3;
        digits = Math.floor(digits / 3);
        state[side] = ["none", "low", "tall"][digit]!;
      }
      inputs.push(voxel("minecraft:cobblestone_wall", state));
    }
    for (const limit of [1000, Number.POSITIVE_INFINITY]) {
      const result = planOriginalStaticShapeBatches(inputs, limit);
      expect(result.budget.limit).toBe(MAX_ORIGINAL_STATIC_SHAPE_BATCHES);
      expect(result.batches.length).toBeLessThanOrEqual(MAX_ORIGINAL_STATIC_SHAPE_BATCHES);
      expect(result.batches.length).toBe(MAX_ORIGINAL_STATIC_SHAPE_BATCHES);
      expect(result.budget.overflow).toBeGreaterThan(0);
    }
    for (const limit of [-5, Number.NEGATIVE_INFINITY, Number.NaN]) {
      const result = planOriginalStaticShapeBatches(inputs, limit);
      expect(result.budget.limit).toBe(0);
      expect(result.batches).toHaveLength(0);
      expect(result.fallbackEntries).toHaveLength(inputs.length);
      expect(result.fallbackEntries.every((entry) => entry.shape.kind === "cube-fallback")).toBe(true);
    }
  });

  it("builds UV-bearing shared box geometry with the promised bounds and disposable lifetime", () => {
    const geometry = createOriginalStaticShapeGeometry(shape("minecraft:oak_slab", { type: "top" }));
    let disposeCount = 0;
    geometry.addEventListener("dispose", () => { disposeCount += 1; });
    geometry.computeBoundingBox();
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(geometry.getAttribute("uv").count).toBe(geometry.getAttribute("position").count);
    expect(geometry.boundingBox!.min.toArray()).toEqual([-0.5, 0, -0.5]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([0.5, 0.5, 0.5]);
    geometry.dispose();
    expect(disposeCount).toBe(1);
    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
  });

  it("emits only the exterior union surface for connected compound shapes", () => {
    const wall = shape("minecraft:cobblestone_wall", { up: "false", north: "low", east: "none", south: "tall", west: "none" });
    const geometry = createOriginalStaticShapeGeometry(wall);
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const uvs = geometry.getAttribute("uv");
    expect(positions.count).toBeGreaterThan(0);
    const uvByPositionAndNormal = new Map<string, string>();
    for (let index = 0; index < positions.count; index += 3) {
      const x = (positions.getX(index) + positions.getX(index + 1) + positions.getX(index + 2)) / 3;
      const y = (positions.getY(index) + positions.getY(index + 1) + positions.getY(index + 2)) / 3;
      const z = (positions.getZ(index) + positions.getZ(index + 1) + positions.getZ(index + 2)) / 3;
      const sample = [x + normals.getX(index) * 1e-4, y + normals.getY(index) * 1e-4, z + normals.getZ(index) * 1e-4];
      const pointsIntoSolid = wall.boxes.some((entry) => sample.every((value, axis) => (
        value > entry.min[axis]! && value < entry.max[axis]!
      )));
      expect(pointsIntoSolid).toBe(false);
      for (let vertex = index; vertex < index + 3; vertex += 1) {
        const surfaceKey = [
          positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex),
          normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex),
        ].join(":");
        const uvKey = `${uvs.getX(vertex)}:${uvs.getY(vertex)}`;
        const previousUv = uvByPositionAndNormal.get(surfaceKey);
        if (previousUv !== undefined) expect(uvKey).toBe(previousUv);
        else uvByPositionAndNormal.set(surfaceKey, uvKey);
      }
    }
    geometry.dispose();
  });

  it("accepts every exact Java 26.3 state row for the four new shape families", () => {
    const inventory = mc263SmallComponentInventory;
    expect(inventory.schema).toBe("blockcolc.mc263-original-static-shape-states.v1");
    expect(inventory.target).toBe("Minecraft Java 26.3");
    expect(inventory.source.blocksReportSha256).toBe("7a0de8aaf7b04d00c40b8ffdc4cfe75184cff2e821d336a020573201867105a4");
    expect(inventory.source.clientJarSha1).toBe("e877b6a07acd633fb3bb475002175cec036e7b87");
    expect(inventory.source.clientJarSha256).toBe("4508d006323f24fa02876310c192d739af56516eb259000ac50f0909a68c9a2d");
    expect(inventory.counts).toEqual({ blockCount: 45, stateCount: 838, fenceGate: 13, button: 15, pressurePlate: 17 });
    expect(new Set(inventory.blocks.map((block) => block.id)).size).toBe(45);
    expect(inventory.blocks.filter((block) => block.id.endsWith("_fence_gate"))).toHaveLength(13);
    expect(inventory.blocks.filter((block) => block.id.endsWith("_button"))).toHaveLength(15);
    expect(inventory.blocks.filter((block) => block.id.endsWith("_pressure_plate"))).toHaveLength(17);

    const globalStateIds = new Set<number>();
    const acceptedTopology = new Map<string, ReturnType<typeof shape>>();
    let exactStateCount = 0;
    for (const block of inventory.blocks) {
      expect(isOriginalStaticShapeBlockId(block.id)).toBe(true);
      expect(block.propertyOrder).toEqual(Object.keys(block.properties).sort());
      expect(block.domainProduct).toBe(block.stateCount);
      expect(block.states).toHaveLength(block.stateCount);
      expect(block.stateMapsUnique).toBe(1);
      expect(block.defaultStateCount).toBe(1);
      const domainProduct = block.propertyOrder.reduce((product, key) => product * block.properties[key]!.length, 1);
      expect(domainProduct).toBe(block.stateCount);

      const signatures = new Set<string>();
      let defaults = 0;
      for (const row of block.states) {
        expect(row).toHaveLength(block.propertyOrder.length + 2);
        const [stateId, ...tail] = row;
        expect(Number.isSafeInteger(stateId)).toBe(true);
        expect(globalStateIds.has(stateId!)).toBe(false);
        globalStateIds.add(stateId!);
        const defaultFlag = tail.pop();
        expect(defaultFlag === 0 || defaultFlag === 1).toBe(true);
        defaults += defaultFlag === 1 ? 1 : 0;
        const state = Object.fromEntries(block.propertyOrder.map((key, index) => {
          const valueIndex = tail[index]!;
          expect(Number.isInteger(valueIndex)).toBe(true);
          expect(valueIndex).toBeGreaterThanOrEqual(0);
          expect(valueIndex).toBeLessThan(block.properties[key]!.length);
          return [key, block.properties[key]![valueIndex]!];
        }));
        const signature = JSON.stringify(state);
        expect(signatures.has(signature)).toBe(false);
        signatures.add(signature);

        const result = originalStaticShapeForVoxel(voxel(block.id, state));
        expect(result.kind, `${block.id} registry state ${JSON.stringify(state)}`).toBe("original-approximation");
        if (result.kind === "original-approximation") {
          expect(allInsideCell([result])).toBe(true);
          expect(Number(disjointVolume(result).toFixed(6))).toBe(result.volume);
          expect(result.volume).toBeGreaterThan(0);
          for (const box of result.boxes) {
            for (let axis = 0; axis < 3; axis += 1) expect(box.max[axis]!).toBeGreaterThan(box.min[axis]!);
          }
          acceptedTopology.set(result.topologyKey, result);
        }
        exactStateCount += 1;
      }
      expect(defaults).toBe(1);
    }
    expect(globalStateIds.size).toBe(838);
    expect(exactStateCount).toBe(838);

    for (const approximation of acceptedTopology.values()) {
      const geometry = createOriginalStaticShapeGeometry(approximation);
      const positions = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal");
      const uvs = geometry.getAttribute("uv");
      expect(positions.count).toBeGreaterThan(0);
      expect(positions.count % 3).toBe(0);
      expect(normals.count).toBe(positions.count);
      expect(uvs.count).toBe(positions.count);
      for (let index = 0; index < positions.count; index += 3) {
        const ax = positions.getX(index + 1)! - positions.getX(index)!;
        const ay = positions.getY(index + 1)! - positions.getY(index)!;
        const az = positions.getZ(index + 1)! - positions.getZ(index)!;
        const bx = positions.getX(index + 2)! - positions.getX(index)!;
        const by = positions.getY(index + 2)! - positions.getY(index)!;
        const bz = positions.getZ(index + 2)! - positions.getZ(index)!;
        const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
        expect(cross).toBeGreaterThan(1e-8);
        expect(Math.hypot(normals.getX(index)!, normals.getY(index)!, normals.getZ(index)!)).toBeCloseTo(1, 5);
      }
      for (let index = 0; index < uvs.count; index += 3) {
        const area = (uvs.getX(index + 1)! - uvs.getX(index)!) * (uvs.getY(index + 2)! - uvs.getY(index)!)
          - (uvs.getY(index + 1)! - uvs.getY(index)!) * (uvs.getX(index + 2)! - uvs.getX(index)!);
        expect(Math.abs(area)).toBeGreaterThan(1e-10);
      }
      geometry.dispose();
    }
  });

  it("keeps gates open, mounts buttons to each support plane, and varies active heights", () => {
    const closedGate = shape("minecraft:oak_fence_gate", { facing: "north", in_wall: "false", open: "false", powered: "false" });
    const openGate = shape("minecraft:oak_fence_gate", { facing: "north", in_wall: "false", open: "true", powered: "false" });
    const center = [-0.09375, 0, 0] as const;
    const containsCenter = (candidate: ReturnType<typeof shape>) => candidate.boxes.some((entry) => center.every((value, axis) => value >= entry.min[axis]! && value <= entry.max[axis]!));
    expect(containsCenter(closedGate)).toBe(true);
    expect(containsCenter(openGate)).toBe(false);
    expect(shape("minecraft:oak_fence_gate", { facing: "north", in_wall: "true", open: "false", powered: "true" }).bounds.max[1])
      .toBeLessThan(closedGate.bounds.max[1]);
    expect(shape("minecraft:oak_fence_gate", { facing: "north", in_wall: "false", open: "false", powered: "true" }).topologyKey)
      .toBe(closedGate.topologyKey);
    const openGates = (["north", "east", "south", "west"] as const).map((facing) => (
      shape("minecraft:oak_fence_gate", { facing, in_wall: "false", open: "true", powered: "false" })
    ));
    expect(new Set(openGates.map((entry) => entry.topologyKey)).size).toBe(4);
    expect(openGates[0]!.bounds.min[2]).toBe(-0.5);
    expect(openGates[1]!.bounds.max[0]).toBe(0.5);
    expect(openGates[2]!.bounds.max[2]).toBe(0.5);
    expect(openGates[3]!.bounds.min[0]).toBe(-0.5);

    const wallButtons = ( ["north", "east", "south", "west"] as const).map((facing) => (
      shape("minecraft:oak_button", { face: "wall", facing, powered: "false" })
    ));
    expect(new Set(wallButtons.map((entry) => entry.topologyKey)).size).toBe(4);
    // The canonical wall facing points away from its support: north is attached
    // to the south (+Z) neighbor, so the protrusion touches this cell's +Z face.
    expect(wallButtons[0]!.bounds.max[2]).toBe(0.5);
    expect(wallButtons[1]!.bounds.min[0]).toBe(-0.5);
    expect(wallButtons[2]!.bounds.min[2]).toBe(-0.5);
    expect(wallButtons[3]!.bounds.max[0]).toBe(0.5);
    const pressedWallButton = shape("minecraft:oak_button", { face: "wall", facing: "north", powered: "true" });
    expect(wallButtons[0]!.bounds.max[2] - wallButtons[0]!.bounds.min[2])
      .toBeGreaterThan(pressedWallButton.bounds.max[2] - pressedWallButton.bounds.min[2]);

    const floorButton = shape("minecraft:stone_button", { face: "floor", facing: "east", powered: "false" });
    const pressedFloorButton = shape("minecraft:stone_button", { face: "floor", facing: "east", powered: "true" });
    const ceilingButton = shape("minecraft:stone_button", { face: "ceiling", facing: "south", powered: "false" });
    expect(floorButton.bounds.min[1]).toBe(-0.5);
    expect(ceilingButton.bounds.max[1]).toBe(0.5);
    expect(floorButton.bounds.max[1]).toBeGreaterThan(pressedFloorButton.bounds.max[1]);
    expect(floorButton.topologyKey).not.toBe(pressedFloorButton.topologyKey);

    for (const face of ["floor", "ceiling"] as const) {
      const oriented = (["north", "east", "south", "west"] as const).map((facing) => (
        shape("minecraft:stone_button", { face, facing, powered: "false" })
      ));
      expect(new Set(oriented.map(({ topologyKey }) => topologyKey)).size).toBe(4);
      const horizontalExtents = oriented.map(({ bounds }) => [
        bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2],
      ]);
      expect(horizontalExtents).toEqual([
        [6 / 16, 8 / 16], [8 / 16, 6 / 16], [6 / 16, 8 / 16], [8 / 16, 6 / 16],
      ]);
      const centers = oriented.map(({ bounds }) => [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ]);
      expect(centers[0]![1]).toBeLessThan(0);
      expect(centers[1]![0]).toBeGreaterThan(0);
      expect(centers[2]![1]).toBeGreaterThan(0);
      expect(centers[3]![0]).toBeLessThan(0);
    }
    const ceilingPressed = shape("minecraft:stone_button", { face: "ceiling", facing: "south", powered: "true" });
    expect(ceilingButton.bounds.min[1]).toBeLessThan(ceilingPressed.bounds.min[1]);

    const unpoweredPlate = shape("minecraft:stone_pressure_plate", { powered: "false" });
    const poweredPlate = shape("minecraft:stone_pressure_plate", { powered: "true" });
    const weightedZero = shape("minecraft:light_weighted_pressure_plate", { power: "0" });
    const weightedOne = shape("minecraft:light_weighted_pressure_plate", { power: "1" });
    const weightedMax = shape("minecraft:heavy_weighted_pressure_plate", { power: "15" });
    expect(unpoweredPlate.bounds.max[1]).toBeGreaterThan(poweredPlate.bounds.max[1]);
    expect(weightedZero.topologyKey).not.toBe(weightedOne.topologyKey);
    expect(weightedOne.topologyKey).toBe(weightedMax.topologyKey);
    expect(weightedOne.bounds.max[1]).toBe(weightedZero.bounds.max[1] - 1 / 16);
    expect(new Set(Array.from({ length: 15 }, (_, index) => (
      shape("minecraft:light_weighted_pressure_plate", { power: String(index + 1) }).topologyKey
    ))).size).toBe(1);
  });

  it("rejects malformed new-family state maps rather than accepting normalized guesses", () => {
    const invalid: Array<[string, Record<string, string>]> = [
      ["minecraft:oak_fence_gate", { facing: "north", open: "false", powered: "false" }],
      ["minecraft:oak_fence_gate", { facing: "north", in_wall: "false", open: "false", powered: "false", waterlogged: "false" }],
      ["minecraft:oak_fence_gate", { facing: "northwest", in_wall: "false", open: "false", powered: "false" }],
      ["minecraft:oak_fence_gate", { facing: "north", in_wall: "maybe", open: "false", powered: "false" }],
      ["minecraft:oak_button", { face: "wall", facing: "north", powered: "false", waterlogged: "false" }],
      ["minecraft:oak_button", { face: "wall", facing: "north", powered: "yes" }],
      ["minecraft:oak_button", { face: "Wall", facing: "north", powered: "false" }],
      ["minecraft:oak_pressure_plate", {}],
      ["minecraft:oak_pressure_plate", { powered: "false", extra: "true" }],
      ["minecraft:oak_pressure_plate", { powered: "TRUE" }],
      ["minecraft:heavy_weighted_pressure_plate", { power: "16" }],
      ["minecraft:heavy_weighted_pressure_plate", { power: "01" }],
    ];
    for (const [id, state] of invalid) {
      const result = originalStaticShapeForVoxel(voxel(id, state));
      expect(result.kind).toBe("cube-fallback");
      if (result.kind === "cube-fallback") expect(result.reason).toBe("invalid-state");
    }
    expect(originalStaticShapeForVoxel(voxel("mod:oak_button", { face: "wall", facing: "north", powered: "false" })).kind)
      .toBe("cube-fallback");
    expect(isOriginalStaticShapeBlockId("minecraft:oak_button")).toBe(true);
    expect(isOriginalStaticShapeBlockId("minecraft:not_a_button")).toBe(false);
    expect(isOriginalStaticShapeBlockId("mod:oak_button")).toBe(false);
  });

  it("does not let malformed runtime state categories alias a legal planner cache entry", () => {
    const legal = voxel("minecraft:red_carpet", {});
    const malformed = [null, [], false, 0, { snowy: false }] as unknown[];
    const malformedVoxel = (sourceBlockState: unknown): BlueprintVoxel => ({ ...legal,
      sourceBlockState: sourceBlockState as BlueprintVoxel["sourceBlockState"] });
    for (const badState of malformed) {
      for (const entries of [[legal, malformedVoxel(badState)], [malformedVoxel(badState), legal]]) {
        const plan = planOriginalStaticShapeBatches(entries as BlueprintVoxel[]);
        const byVoxel = new Map([...plan.batches.flatMap((batch) => batch.entries), ...plan.fallbackEntries]
          .map((entry) => [entry.voxel, entry.shape] as const));
        expect(byVoxel.get(entries[0]!)?.kind).toBe(entries[0] === legal ? "original-approximation" : "cube-fallback");
        expect(byVoxel.get(entries[1]!)?.kind).toBe(entries[1] === legal ? "original-approximation" : "cube-fallback");
      }
    }
  });

  it("covers all carpet, lever and lantern registry states with reusable part geometry", () => {
    const carpetIds = [
      "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
      "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
    ].map((dye) => `minecraft:${dye}_carpet`).concat("minecraft:moss_carpet");
    const carpets = carpetIds.map((id) => originalStaticShapeForVoxel(voxel(id, {})));
    expect(carpets.every((entry) => entry.kind === "original-approximation" && entry.family === "carpet")).toBe(true);
    const importedNoProperties = originalStaticShapeForVoxel({
      sourceBlockId: "minecraft:red_carpet",
    });
    expect(importedNoProperties.kind).toBe("original-approximation");
    if (importedNoProperties.kind === "original-approximation") {
      expect(importedNoProperties.bounds.min[1]).toBeCloseTo(-0.498046875, 8);
      expect(importedNoProperties.bounds.max[1]).toBeCloseTo(-0.435546875, 8);
      expect(importedNoProperties.bounds.min[0]).toBeGreaterThan(-0.5);
      expect(importedNoProperties.volume).toBeLessThan(0.07);
    }
    const invalidCarpetStates = [null, [], { snowy: "false" }, { SNOWY: "false" }] as unknown[];
    for (const sourceBlockState of invalidCarpetStates) {
      const result = originalStaticShapeForVoxel({
        ...voxel("minecraft:blue_carpet", {}), sourceBlockState: sourceBlockState as Record<string, string>,
      });
      expect(result.kind).toBe("cube-fallback");
    }
    expect(originalStaticShapeForVoxel(voxel("mod:red_carpet", {})).kind).toBe("cube-fallback");
    expect(originalStaticShapeForVoxel(voxel("minecraft:pale_moss_carpet", {})).kind).toBe("cube-fallback");

    const levers = (["floor", "wall", "ceiling"] as const).flatMap((face) => (
      (["north", "east", "south", "west"] as const).flatMap((facing) => (["false", "true"] as const).map((powered) => (
        shape("minecraft:lever", { face, facing, powered })
      )))
    ));
    expect(levers).toHaveLength(24);
    expect(levers.every((entry) => entry.components?.map(({ key }) => key).join(",") === "lever-base,lever-handle")).toBe(true);
    expect(new Set(levers.map((entry) => entry.components![0]!.topologyKey))).toEqual(new Set(["lever:stone-base"]));
    expect(new Set(levers.map((entry) => entry.components![1]!.topologyKey))).toEqual(new Set(["lever:handle"]));
    const floorNorthOff = shape("minecraft:lever", { face: "floor", facing: "north", powered: "false" });
    const floorNorthOn = shape("minecraft:lever", { face: "floor", facing: "north", powered: "true" });
    expect(floorNorthOff.components![1]!.transform).not.toEqual(floorNorthOn.components![1]!.transform);
    expect(floorNorthOff.components![0]!.bounds.min[1]).toBe(-0.5);
    const wallBase = (facing: "north" | "east" | "south" | "west") => shape("minecraft:lever",
      { face: "wall", facing, powered: "false" }).components![0]!.bounds;
    expect(wallBase("north").max[2]).toBe(0.5); // support at z + 1
    expect(wallBase("east").min[0]).toBe(-0.5); // support at x - 1
    expect(wallBase("south").min[2]).toBe(-0.5); // support at z - 1
    expect(wallBase("west").max[0]).toBe(0.5); // support at x + 1
    const ceilingN = shape("minecraft:lever", { face: "ceiling", facing: "north", powered: "false" }).components![1]!.bounds;
    const ceilingE = shape("minecraft:lever", { face: "ceiling", facing: "east", powered: "false" }).components![1]!.bounds;
    const ceilingS = shape("minecraft:lever", { face: "ceiling", facing: "south", powered: "false" }).components![1]!.bounds;
    const ceilingW = shape("minecraft:lever", { face: "ceiling", facing: "west", powered: "false" }).components![1]!.bounds;
    expect(ceilingN.min[2]).toBeLessThan(0);
    expect(ceilingE.max[0]).toBeGreaterThan(0);
    expect(ceilingS.max[2]).toBeGreaterThan(0);
    expect(ceilingW.min[0]).toBeLessThan(0);

    const lanterns = (["minecraft:lantern", "minecraft:soul_lantern"] as const).flatMap((id) => (
      (["false", "true"] as const).flatMap((hanging) => (["false", "true"] as const).map((waterlogged) => (
        shape(id, { hanging, waterlogged })
      )))
    ));
    expect(lanterns).toHaveLength(8);
    expect(lanterns.every((entry) => entry.components?.length === 2)).toBe(true);
    const standing = shape("minecraft:lantern", { hanging: "false", waterlogged: "false" });
    const hanging = shape("minecraft:lantern", { hanging: "true", waterlogged: "true" });
    const soul = shape("minecraft:soul_lantern", { hanging: "true", waterlogged: "false" });
    expect(standing.components![0]!.topologyKey).toBe("lantern:frame:standing");
    expect(hanging.components![0]!.topologyKey).toBe("lantern:frame:hanging");
    expect(standing.components![1]!.topologyKey).toBe("lantern:core:warm");
    expect(soul.components![1]!.topologyKey).toBe("lantern:core:soul");
    expect(hanging.bounds.max[1]).toBeGreaterThan(standing.bounds.max[1]);
    expect(standing.components![1]!.boxes).toHaveLength(1);
    for (const [id, shade] of [["minecraft:lantern", "warm"], ["minecraft:soul_lantern", "soul"]] as const) {
      const standingVoxel = voxel(id, { hanging: "false", waterlogged: "false" });
      const hangingVoxel = voxel(id, { hanging: "true", waterlogged: "false" });
      for (const ordered of [[standingVoxel, hangingVoxel], [hangingVoxel, standingVoxel]]) {
        const plan = planOriginalStaticShapeBatches(ordered);
        const coreBatch = plan.batches.find((batch) => batch.componentKey === `lantern-core-${shade}`)!;
        expect(coreBatch.entries).toHaveLength(2);
        const actualYBounds = coreBatch.entries.map((entry) => {
          const part = entry.shape.kind === "original-approximation"
            ? entry.shape.components!.find((candidate) => candidate.key === coreBatch.componentKey)! : undefined;
          const matrix = new THREE.Matrix4().fromArray([...(part?.transform ?? [])]);
          const points = coreBatch.component.boxes.flatMap((box) => [box.min[1], box.max[1]].map((y) => (
            new THREE.Vector3(0, y, 0).applyMatrix4(matrix).y + entry.voxel.y
          )));
          return [Math.min(...points), Math.max(...points)];
        });
        for (const [index, entry] of coreBatch.entries.entries()) {
          const expected: readonly [number, number] = entry.voxel === hangingVoxel ? [-0.25, 0.125] : [-0.4375, -0.0625];
          expect(actualYBounds[index]![0]!).toBeCloseTo(expected[0], 8);
          expect(actualYBounds[index]![1]!).toBeCloseTo(expected[1], 8);
        }
      }
    }
  });

  it("validates strict full new-family states and preserves the two hard budgets atomically", () => {
    const invalid = [
      ["minecraft:lever", { face: "wall", facing: "north", powered: "false", waterlogged: "false" }],
      ["minecraft:lever", { face: "wall", facing: "north", powered: "TRUE" }],
      ["minecraft:lever", { face: "up", facing: "north", powered: "false" }],
      ["minecraft:lever", { face: "wall", facing: "north" }],
      ["minecraft:lantern", { hanging: "false" }],
      ["minecraft:lantern", { hanging: "false", waterlogged: "false", facing: "north" }],
      ["minecraft:soul_lantern", { hanging: "true", waterlogged: "yes" }],
    ] as const;
    for (const [id, state] of invalid) {
      expect(originalStaticShapeForVoxel(voxel(id, { ...state })).kind).toBe("cube-fallback");
    }
    expect(originalStaticShapeForVoxel(voxel("mod:lever", { face: "wall", facing: "north", powered: "false" })).kind)
      .toBe("cube-fallback");
    expect(originalStaticShapeForVoxel(voxel("mod:soul_lantern", { hanging: "true", waterlogged: "false" })).kind)
      .toBe("cube-fallback");

    const all = [
      ...["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]
        .map((dye) => voxel(`minecraft:${dye}_carpet`, {})),
      voxel("minecraft:moss_carpet", {}),
      ...(["floor", "wall", "ceiling"] as const).flatMap((face) => (["north", "east", "south", "west"] as const).flatMap((facing) => (["false", "true"] as const).map((powered) => (
        voxel("minecraft:lever", { face, facing, powered })
      )))),
      ...(["minecraft:lantern", "minecraft:soul_lantern"] as const).flatMap((id) => (["false", "true"] as const).flatMap((hanging) => (["false", "true"] as const).map((waterlogged) => (
        voxel(id, { hanging, waterlogged })
      )))),
    ];
    expect(all).toHaveLength(49);
    const topology = planOriginalStaticShapeBatches(all);
    const styles = groupOriginalStaticShapeEntries(
      topology,
      (entry, componentKey = "") => fallbackVisualStyleForOriginalComponent(entry, componentKey).key,
      64,
      (entry, componentKey) => componentKey === "lantern-frame" ? { kind: "", level: 0 }
        : componentKey.startsWith("lantern-core-") ? sourceLanternEmissionForVoxel(entry) : undefined,
    );
    expect(topology.budget).toEqual({ limit: MAX_ORIGINAL_STATIC_SHAPE_BATCHES, actual: 7, overflow: 0 });
    expect(styles.groups.length).toBeLessThanOrEqual(64);
    expect(styles.groups.length).toBe(23);
    expect(new Set(topology.batches.flatMap((batch) => batch.entries.map(({ voxel: entry }) => entry))).size
      + new Set(topology.fallbackEntries.map(({ voxel: entry }) => entry)).size).toBe(49);
    expect(new Set(styles.groups.flatMap((group) => group.entries.map(({ voxel: entry }) => entry))).size
      + new Set(styles.fallbackEntries.map(({ voxel: entry }) => entry)).size).toBe(49);
    expect(styles.groups.filter((group) => group.componentKey === "lantern-frame")
      .every((group) => group.emissiveKind === "" && group.emissiveLevel === 0)).toBe(true);

    const topologyLimited = planOriginalStaticShapeBatches([
      voxel("minecraft:lever", { face: "wall", facing: "north", powered: "false" }),
    ], 1);
    expect(topologyLimited.budget).toEqual({ limit: 1, actual: 1, overflow: 1 });
    expect(topologyLimited.batches).toHaveLength(0);
    expect(topologyLimited.fallbackEntries).toHaveLength(1);
    const materialLimited = groupOriginalStaticShapeEntries(topology, (entry) => fallbackVisualStyleForVoxel(entry).key, 1);
    expect(materialLimited.groups.length).toBeLessThanOrEqual(1);
    expect(materialLimited.fallbackEntries.length).toBeGreaterThan(0);
    const emittedKeysByVoxel = new Map<BlueprintVoxel, Set<string>>();
    for (const group of materialLimited.groups) for (const entry of group.entries) {
      const keys = emittedKeysByVoxel.get(entry.voxel) ?? new Set<string>();
      keys.add(group.componentKey);
      emittedKeysByVoxel.set(entry.voxel, keys);
    }
    for (const [entry, keys] of emittedKeysByVoxel) {
      const shape = originalStaticShapeForVoxel(entry);
      const expectedParts = shape.kind === "original-approximation"
        ? shape.components?.map(({ key }) => key) ?? [] : [];
      expect([...keys].sort()).toEqual([...expectedParts].sort());
    }
  });

  it("covers the 17 exact Java 26.3 candle IDs and all 272 states with shared body and wick geometry", () => {
    const candleIds = ["candle", ...["black", "blue", "brown", "cyan", "gray", "green", "light_blue", "light_gray",
      "lime", "magenta", "orange", "pink", "purple", "red", "white", "yellow"].map((dye) => `${dye}_candle`)];
    const all = candleIds.flatMap((id) => (["1", "2", "3", "4"] as const).flatMap((candles) => (
      (["false", "true"] as const).flatMap((lit) => (["false", "true"] as const).map((waterlogged) => (
        voxel(`minecraft:${id}`, { candles, lit, waterlogged })
      )))
    )));
    expect(all).toHaveLength(272);
    const shapes = all.map((entry) => originalStaticShapeForVoxel(entry));
    expect(shapes.every((entry) => entry.kind === "original-approximation" && entry.family === "candle")).toBe(true);
    const single = shape("minecraft:candle", { candles: "1", lit: "false", waterlogged: "false" });
    const four = shape("minecraft:red_candle", { candles: "4", lit: "true", waterlogged: "true" });
    expect(single.components?.map(({ key }) => key)).toEqual(["candle-wax", "candle-wick"]);
    expect(single.components?.[0]?.boxes).toHaveLength(1);
    expect(four.components?.[0]?.boxes).toHaveLength(4);
    expect(four.components?.[1]?.boxes).toHaveLength(4);
    expect(four.volume).toBeGreaterThan(single.volume * 2);
    expect(four.volume).toBeLessThan(0.09);
    expect(allInsideCell([single, four])).toBe(true);
    expect(new Set(shapes.flatMap((entry) => entry.kind === "original-approximation"
      ? entry.components!.map((component) => component.topologyKey) : []))).toEqual(new Set([
      ...[1, 2, 3, 4].map((count) => `candle:wax:${count}`),
      ...[1, 2, 3, 4].map((count) => `candle:wick:${count}`),
    ]));
    expect(fallbackVisualStyleForOriginalComponent(voxel("minecraft:red_candle", { candles: "1", lit: "true", waterlogged: "false" }), "candle-wax").color)
      .not.toBe(fallbackVisualStyleForOriginalComponent(voxel("minecraft:blue_candle", { candles: "1", lit: "true", waterlogged: "false" }), "candle-wax").color);
    const lit = voxel("minecraft:red_candle", { candles: "4", lit: "true", waterlogged: "false" });
    expect(sourceCandleEmissionForVoxel(lit)).toMatchObject({ kind: "candle", level: 12 });
    expect(sourceCandleEmissionForVoxel({ ...lit, emissiveLevel: 0 })).toBeUndefined();
    expect(sourceCandleEmissionForVoxel({ ...lit, sourceBlockState: { ...lit.sourceBlockState!, lit: "false" } })).toBeUndefined();
    expect(sourceCandleEmissionForVoxel(voxel("mod:red_candle", { candles: "4", lit: "true", waterlogged: "false" }))).toBeUndefined();

    for (const state of [undefined, { candles: "5", lit: "true", waterlogged: "false" },
      { candles: "1", lit: "TRUE", waterlogged: "false" }, { candles: "1", lit: "true" },
      { candles: "1", lit: "true", waterlogged: "false", extra: "x" }]) {
      expect(originalStaticShapeForVoxel({ sourceBlockId: "minecraft:red_candle", sourceBlockState: state as Record<string, string> | undefined }).kind).toBe("cube-fallback");
    }
    expect(originalStaticShapeForVoxel(voxel("mod:red_candle", { candles: "1", lit: "true", waterlogged: "false" })).kind).toBe("cube-fallback");

    const topology = planOriginalStaticShapeBatches(all);
    expect(topology.budget).toEqual({ limit: MAX_ORIGINAL_STATIC_SHAPE_BATCHES, actual: 8, overflow: 0 });
    const materials = groupOriginalStaticShapeEntries(topology,
      (entry, componentKey = "") => fallbackVisualStyleForOriginalComponent(entry, componentKey).key, 64,
      (entry, componentKey) => componentKey === "candle-wax" ? { kind: "", level: 0 }
        : componentKey === "candle-wick" ? sourceCandleEmissionForVoxel(entry) : undefined);
    expect(materials.groups.length).toBeLessThanOrEqual(64);
    expect(materials.fallbackEntries.length).toBeGreaterThan(0);
    const admitted = new Set(materials.groups.flatMap((group) => group.entries.map(({ voxel: entry }) => entry)));
    const fallback = new Set(materials.fallbackEntries.map(({ voxel: entry }) => entry));
    expect(admitted.size + fallback.size).toBe(272);
    for (const entry of admitted) {
      const keys = materials.groups.filter((group) => group.entries.some(({ voxel: member }) => member === entry))
        .map((group) => group.componentKey).sort();
      expect(keys).toEqual(["candle-wax", "candle-wick"]);
    }
  });

  it("covers the 16 dyed beds and straw bed across all 272 exact head/foot states", () => {
    const ids = [...["black", "blue", "brown", "cyan", "gray", "green", "light_blue", "light_gray",
      "lime", "magenta", "orange", "pink", "purple", "red", "white", "yellow"].map((dye) => `minecraft:${dye}_bed`),
      "minecraft:straw_bed"];
    const all = ids.flatMap((id) => (["north", "east", "south", "west"] as const).flatMap((facing) => (
      (["false", "true"] as const).flatMap((occupied) => (["head", "foot"] as const).map((part) => (
        voxel(id, { facing, occupied, part })
      )))
    )));
    expect(all).toHaveLength(272);
    const shapes = all.map((entry) => originalStaticShapeForVoxel(entry));
    expect(shapes.every((entry) => entry.kind === "original-approximation" && entry.family === "bed")).toBe(true);
    const head = shape("minecraft:red_bed", { facing: "north", occupied: "false", part: "head" });
    const foot = shape("minecraft:red_bed", { facing: "north", occupied: "false", part: "foot" });
    const occupied = shape("minecraft:red_bed", { facing: "north", occupied: "true", part: "head" });
    expect(head.components?.map(({ key }) => key)).toEqual(["bed-cover", "bed-legs", "bed-pillow"]);
    expect(foot.components?.map(({ key }) => key)).toEqual(["bed-cover", "bed-legs"]);
    expect(head.components?.[1]?.bounds.max[2]).toBeLessThan(0);
    expect(foot.components?.[1]?.bounds.min[2]).toBeGreaterThan(0);
    expect(occupied.components).toEqual(head.components);
    expect(head.bounds.max[1]).toBeLessThan(0.2);
    const eastHead = shape("minecraft:red_bed", { facing: "east", occupied: "false", part: "head" });
    expect(eastHead.components?.[1]?.bounds.min[0]).toBeGreaterThan(0);
    const strawHead = shape("minecraft:straw_bed", { facing: "south", occupied: "false", part: "head" });
    const strawFoot = shape("minecraft:straw_bed", { facing: "south", occupied: "false", part: "foot" });
    expect(strawHead.components?.map(({ key }) => key)).toEqual(["bed-straw-base", "bed-straw-pillow"]);
    expect(strawFoot.components?.map(({ key }) => key)).toEqual(["bed-straw-base"]);
    expect(strawHead.bounds.max[1]).toBeCloseTo(-0.1875, 8);
    expect(strawFoot.bounds.max[1]).toBeCloseTo(-0.25, 8);
    // Matrix4 quarter-turns may land one floating-point epsilon past ±0.5.
    expect([head, foot, eastHead, strawHead, strawFoot].every((plan) => plan.boxes.every((entry) =>
      [...entry.min, ...entry.max].every((value) => value >= -0.5 - 1e-8 && value <= 0.5 + 1e-8)))).toBe(true);
    expect(fallbackVisualStyleForOriginalComponent(voxel("minecraft:red_bed", { facing: "north", occupied: "false", part: "head" }), "bed-cover").color)
      .not.toBe(fallbackVisualStyleForOriginalComponent(voxel("minecraft:blue_bed", { facing: "north", occupied: "false", part: "head" }), "bed-cover").color);

    for (const state of [undefined, { facing: "north", occupied: "false" },
      { facing: "north", occupied: "yes", part: "head" },
      { facing: "north", occupied: "false", part: "center" },
      { facing: "north", occupied: "false", part: "head", extra: "x" }]) {
      expect(originalStaticShapeForVoxel({ sourceBlockId: "minecraft:red_bed", sourceBlockState: state as Record<string, string> | undefined }).kind)
        .toBe("cube-fallback");
    }
    expect(originalStaticShapeForVoxel(voxel("mod:red_bed", { facing: "north", occupied: "false", part: "head" })).kind).toBe("cube-fallback");
    const topology = planOriginalStaticShapeBatches(all);
    expect(topology.budget).toEqual({ limit: MAX_ORIGINAL_STATIC_SHAPE_BATCHES, actual: 7, overflow: 0 });
    const materials = groupOriginalStaticShapeEntries(topology,
      (entry, componentKey = "") => fallbackVisualStyleForOriginalComponent(entry, componentKey).key, 64);
    expect(materials.groups.length).toBeLessThanOrEqual(64);
    expect(materials.fallbackEntries).toHaveLength(0);
    expect(new Set(materials.groups.flatMap((group) => group.entries.map(({ voxel: entry }) => entry))).size).toBe(272);
    const limited = planOriginalStaticShapeBatches([all[0]!], 1);
    expect(limited.fallbackEntries).toHaveLength(1);
    expect(limited.batches).toHaveLength(0);
  });

  it("covers all 162 pale moss carpet states with the 26.3 isolated-side rule", () => {
    const sides = ["none", "low", "tall"] as const;
    const all = (["false", "true"] as const).flatMap((bottom) => sides.flatMap((north) => (
      sides.flatMap((east) => sides.flatMap((south) => sides.map((west) => (
        voxel("minecraft:pale_moss_carpet", { bottom, north, east, south, west })
      ))))
    )));
    expect(all).toHaveLength(162);
    const plans = all.map((entry) => originalStaticShapeForVoxel(entry));
    expect(plans.every((entry) => entry.kind === "original-approximation" && entry.family === "pale-moss-carpet")).toBe(true);
    const isolated = shape("minecraft:pale_moss_carpet", {
      bottom: "false", north: "none", east: "none", south: "none", west: "none",
    });
    expect(isolated.components?.map((component) => component.key)).toEqual([
      "pale-moss-base", "pale-moss-north-tall", "pale-moss-east-tall", "pale-moss-south-tall", "pale-moss-west-tall",
    ]);
    const sideOnly = shape("minecraft:pale_moss_carpet", {
      bottom: "false", north: "low", east: "tall", south: "none", west: "none",
    });
    expect(sideOnly.components?.map((component) => component.key)).toEqual(["pale-moss-north-low", "pale-moss-east-tall"]);
    expect(sideOnly.components?.[0]?.bounds.max[1]).toBeCloseTo(10 / 16 - 0.5, 8);
    expect(sideOnly.components?.[1]?.bounds.max[1]).toBeCloseTo(0.5, 8);
    expect(sideOnly.boxes.every((entry) => [...entry.min, ...entry.max].every((value) =>
      value >= -0.5 - 1e-8 && value <= 0.5 + 1e-8))).toBe(true);
    expect(fallbackVisualStyleForOriginalComponent(all[0]!, "pale-moss-base").color)
      .not.toBe(fallbackVisualStyleForOriginalComponent(all[0]!, "pale-moss-north-tall").color);

    for (const invalid of [undefined,
      { bottom: "true", north: "none", east: "none", south: "none" },
      { bottom: "true", north: "wide", east: "none", south: "none", west: "none" },
      { bottom: "true", north: "none", east: "none", south: "none", west: "none", extra: "x" },
    ]) {
      expect(originalStaticShapeForVoxel({ sourceBlockId: "minecraft:pale_moss_carpet",
        sourceBlockState: invalid as Record<string, string> | undefined }).kind).toBe("cube-fallback");
    }
    expect(originalStaticShapeForVoxel(voxel("mod:pale_moss_carpet", all[0]!.sourceBlockState!)).kind).toBe("cube-fallback");
    const topology = planOriginalStaticShapeBatches(all);
    expect(topology.budget).toEqual({ limit: MAX_ORIGINAL_STATIC_SHAPE_BATCHES, actual: 9, overflow: 0 });
    expect(topology.fallbackEntries).toHaveLength(0);
    const materials = groupOriginalStaticShapeEntries(topology,
      (entry, componentKey = "") => fallbackVisualStyleForOriginalComponent(entry, componentKey).key, 64);
    expect(materials.fallbackEntries).toHaveLength(0);
    expect(new Set(materials.groups.flatMap((group) => group.entries.map(({ voxel: entry }) => entry))).size).toBe(162);
  });

  it("keeps explicit zero lantern emission dark in both material grouping and private source projection", () => {
    const source = voxel("minecraft:lantern", { hanging: "false", waterlogged: "false" });
    const cases = [
      { ...source },
      { ...source, emissiveLevel: 0 },
      { ...source, emissiveKind: "legacy-redstone", emissiveLevel: 7 },
    ];
    const plan = groupOriginalStaticShapeEntries(planOriginalStaticShapeBatches(cases),
      (entry, componentKey = "") => fallbackVisualStyleForOriginalComponent(entry, componentKey).key,
      64,
      (entry, componentKey) => componentKey === "lantern-frame" ? { kind: "", level: 0 }
        : componentKey.startsWith("lantern-core-") && entry.emissiveLevel === 0 ? { kind: "", level: 0 }
          : componentKey.startsWith("lantern-core-") ? sourceLanternEmissionForVoxel(entry) : undefined);
    const coreGroups = plan.groups.filter((group) => group.componentKey === "lantern-core-warm");
    expect(coreGroups.map(({ emissiveKind, emissiveLevel, entries }) => ({ emissiveKind, emissiveLevel,
      count: entries.length })).sort((a, b) => a.emissiveLevel - b.emissiveLevel)).toEqual([
      { emissiveKind: "", emissiveLevel: 0, count: 1 },
      { emissiveKind: "legacy-redstone", emissiveLevel: 7, count: 1 },
      { emissiveKind: "lantern", emissiveLevel: 15, count: 1 },
    ]);
    expect(sourceLanternEmissionForVoxel(cases[1]!)).toBeUndefined();
  });

  it("resolves warm legacy and cool source colors over the complete clustered light-point domain", () => {
    const points = [
      { x: 0, y: 2, z: 0, intensity: 15 },
      { x: 49, y: 2, z: 0, intensity: 10 },
      { x: 50, y: 2, z: 0, intensity: 10 },
      { x: 51, y: 2, z: 0, intensity: 10 },
    ];
    const colors = new Map<string, number>([
      ["0:2:0", 0xffb45f],
      ["49:2:0", 0x65cfe3], ["50:2:0", 0x65cfe3], ["51:2:0", 0x65cfe3],
    ]);
    expect(emissiveColorForPoint(points[0]!, colors)).toBe(0xffb45f);
    const clustered = clusterEmissivePoints(points, 2);
    expect(clustered).toHaveLength(2);
    const sourceCluster = clustered.find(point => point.x > 40)!;
    expect(emissiveColorForPoint(sourceCluster, colors)).toBe(0x65cfe3);
  });

  it("records mixed old/new topology and group budget overflow without dropping voxels", () => {
    const fixtureVoxels = inventoryVoxels(mc263SmallComponentInventory);
    const wallStress = Array.from({ length: 81 }, (_, code) => {
      let digits = code;
      const state: Record<string, string> = { up: code % 2 === 0 ? "false" : "true" };
      for (const side of ["north", "east", "south", "west"] as const) {
        state[side] = ["none", "low", "tall"][digits % 3]!;
        digits = Math.floor(digits / 3);
      }
      return voxel("minecraft:cobblestone_wall", state, fixtureVoxels.length + code);
    });
    const mixed = [...fixtureVoxels, ...wallStress];
    const topologyPlan = planOriginalStaticShapeBatches(mixed);
    expect(topologyPlan.budget).toEqual({ limit: 64, actual: 64, overflow: 61 });
    expect(topologyPlan.batches.reduce((sum, batch) => sum + batch.entries.length, topologyPlan.fallbackEntries.length)).toBe(mixed.length);
    expect(topologyPlan.fallbackEntries).toHaveLength(91);
    expect(topologyPlan.fallbackEntries.every((entry) => entry.shape.kind === "cube-fallback" && entry.shape.reason === "budget-exceeded")).toBe(true);

    const representatives = new Map<string, BlueprintVoxel>();
    for (const entry of fixtureVoxels) {
      const result = originalStaticShapeForVoxel(entry);
      if (result.kind === "original-approximation" && !representatives.has(result.topologyKey)) {
        representatives.set(result.topologyKey, entry);
      }
    }
    expect(representatives.size).toBe(44);
    const groupedVoxels = [...representatives.values()].flatMap((entry) => ([
      entry,
      { ...entry, emissiveKind: "lamp", emissiveLevel: 12 },
    ]));
    const groupPlan = groupOriginalStaticShapeEntries(
      planOriginalStaticShapeBatches(groupedVoxels),
      (entry) => fallbackVisualStyleForVoxel(entry).key,
    );
    expect(groupPlan.limit).toBe(64);
    expect(groupPlan.groups).toHaveLength(64);
    expect(groupPlan.overflow).toBe(24);
    expect(groupPlan.fallbackEntries).toHaveLength(24);
    expect(groupPlan.groups.reduce((sum, group) => sum + group.entries.length, groupPlan.fallbackEntries.length)).toBe(groupedVoxels.length);
  });
});

function voxel(
  sourceBlockId: string,
  sourceBlockState: Record<string, string>,
  x = 0,
): BlueprintVoxel {
  return { x, y: 0, z: 0, materialId: "stone", buildOrder: 0, sourceBlockId, sourceBlockState };
}

function inventoryVoxels(inventory: Mc263SmallComponentInventory): BlueprintVoxel[] {
  return inventory.blocks.flatMap((block) => block.states.map((row, index) => {
    const values = row.slice(1, -1);
    const state = Object.fromEntries(block.propertyOrder.map((key, propertyIndex) => (
      [key, block.properties[key]![values[propertyIndex]!]!]
    )));
    return voxel(block.id, state, index);
  }));
}

function shape(sourceBlockId: string, sourceBlockState: Record<string, string>) {
  const result = originalStaticShapeForVoxel(voxel(sourceBlockId, sourceBlockState));
  expect(result.kind).toBe("original-approximation");
  if (result.kind !== "original-approximation") throw new Error(`expected shape, got ${result.reason}`);
  return result;
}

function bounds(result: ReturnType<typeof shape>) {
  return result.bounds;
}

function allInsideCell(plans: readonly ReturnType<typeof shape>[]): boolean {
  return plans.every((plan) => plan.boxes.every((entry) => [...entry.min, ...entry.max].every((value) => value >= -0.5 && value <= 0.5)));
}

function disjointVolume(plan: ReturnType<typeof shape>): number {
  let total = 0;
  for (let left = 0; left < plan.boxes.length; left += 1) {
    const a = plan.boxes[left]!;
    for (let right = left + 1; right < plan.boxes.length; right += 1) {
      const b = plan.boxes[right]!;
      const intersection = [0, 1, 2].map((axis) => Math.max(0, Math.min(a.max[axis]!, b.max[axis]!) - Math.max(a.min[axis]!, b.min[axis]!)));
      expect(intersection.some((extent) => extent === 0)).toBe(true);
    }
    total += (a.max[0] - a.min[0]) * (a.max[1] - a.min[1]) * (a.max[2] - a.min[2]);
  }
  return total;
}

function isGridConnected(plan: ReturnType<typeof shape>): boolean {
  const occupied = new Set<string>();
  for (let x = 0; x < 16; x += 1) for (let y = 0; y < 16; y += 1) for (let z = 0; z < 16; z += 1) {
    const point = [x / 16 - 0.5 + 1 / 32, y / 16 - 0.5 + 1 / 32, z / 16 - 0.5 + 1 / 32];
    if (plan.boxes.some((entry) => point.every((value, axis) => value >= entry.min[axis]! && value < entry.max[axis]!))) {
      occupied.add(`${x}:${y}:${z}`);
    }
  }
  const start = occupied.values().next().value as string | undefined;
  if (!start) return false;
  const visited = new Set([start]);
  const pending = [start];
  const offsets: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  while (pending.length > 0) {
    const [x, y, z] = pending.pop()!.split(":").map(Number);
    for (const [dx, dy, dz] of offsets) {
      const next = `${x! + dx}:${y! + dy}:${z! + dz}`;
      if (occupied.has(next) && !visited.has(next)) { visited.add(next); pending.push(next); }
    }
  }
  return visited.size === occupied.size;
}
