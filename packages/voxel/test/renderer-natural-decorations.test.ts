import { describe, expect, it } from "vitest";
import type { MergedGeometryData } from "../src/terrain";
import { naturalDecorationPlacementsForScene } from "../src/renderer";
import { NATURAL_SHELF_MUSHROOM_RENDER_SCALE } from "../src/natural-decorations";

function terrainWithTrees(trees: MergedGeometryData["naturalTrees"]): MergedGeometryData {
  return {
    positions: [-80, 0, -80, 80, 0, -80, 80, 0, 80, -80, 0, 80],
    indicesByMaterial: {
      grass: [0, 1, 2, 0, 2, 3],
      dirt: [], stone: [], water: [],
    },
    sideIndices: { dirt: [], stone: [] },
    cellCount: 1,
    triangleCount: 2,
    bounds: { minX: -80, maxX: 80, minY: 0, maxY: 0, minZ: -80, maxZ: 80 },
    framingBounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
    naturalTrees: trees,
    terrainGenerationVersion: 4,
    lodCellCounts: { near: 1, middle: 0, far: 0 },
    hydrology: {
      networkCount: 0, basinCount: 0, riverCellCount: 0, lakeCellCount: 0, riverSegmentCount: 0,
      outletCount: 0, maxUphillWaterStep: 0, protectedWaterCellCount: 0, waterSurfaceArea: 0, terrainSurfaceArea: 1,
    },
  };
}

describe("production natural-decoration candidate planner", () => {
  const trees = [
    { x: -24, y: 2, z: -20, scale: 1.1 },
    { x: 0, y: 4, z: 0, scale: 0.8 },
    { x: 24, y: 3, z: 22, scale: 1.2 },
    { x: 45, y: 6, z: -33, scale: 0.9 },
    { x: 55, y: 1, z: 44, scale: 1.3 },
  ];

  it("uses actual terrain-tree positions, scale and the same quality prefix used by production culling", () => {
    const low = naturalDecorationPlacementsForScene({
      worlds: [], roads: [], importedDecorations: [], environmentStyle: "natural-valley",
      terrain: terrainWithTrees(trees), worldSeed: "production-tree-test", qualityTier: "low",
    });
    const lowMushrooms = low.filter(entry => entry.kind === "shelf-mushroom");
    expect(lowMushrooms).toHaveLength(1);
    expect(lowMushrooms[0]!.supportTreeIndex).toBeLessThan(2);
    expect(lowMushrooms[0]!.y).toBe(trees[lowMushrooms[0]!.supportTreeIndex!]!.y + 1.65 * trees[lowMushrooms[0]!.supportTreeIndex!]!.scale);
    const mushroom = lowMushrooms[0]!;
    const support = mushroom.treeSupport!;
    const trunkFaceOffset = (mushroom.x - support.x) * support.normalX + (mushroom.z - support.z) * support.normalZ;
    const capHalfWidth = 0.58 * NATURAL_SHELF_MUSHROOM_RENDER_SCALE * mushroom.scale / 2;
    expect(trunkFaceOffset - capHalfWidth).toBeCloseTo(0.72 * support.scale / 2, 10);
    expect(low).toEqual(naturalDecorationPlacementsForScene({
      worlds: [], roads: [], importedDecorations: [], environmentStyle: "natural-valley",
      terrain: terrainWithTrees(trees), worldSeed: "production-tree-test", qualityTier: "low",
    }));
  });

  it("filters occupied and road-supported trees and permits an empty natural-tree set", () => {
    const result = naturalDecorationPlacementsForScene({
      worlds: [{ worldPosition: { x: -24, y: 0, z: -20 }, footprint: { width: 14, depth: 14 } } as never],
      roads: [{ x: 0, z: 0 } as never], importedDecorations: [], environmentStyle: "natural-valley",
      terrain: terrainWithTrees(trees), worldSeed: "filtered-tree-test", qualityTier: "high",
    });
    const mushrooms = result.filter(entry => entry.kind === "shelf-mushroom");
    expect(mushrooms).toHaveLength(1);
    expect(mushrooms[0]!.supportTreeIndex).toBeGreaterThan(1);
    const empty = naturalDecorationPlacementsForScene({
      worlds: [], roads: [], importedDecorations: [], environmentStyle: "natural-valley",
      terrain: terrainWithTrees([]), worldSeed: "empty-tree-test", qualityTier: "high",
    });
    expect(empty.some(entry => entry.kind === "shelf-mushroom")).toBe(false);
  });
});
