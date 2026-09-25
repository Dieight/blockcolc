import { describe, expect, it } from "vitest";
import { SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT } from "../src/blueprint";
import { alignWorldsToEnvironment, layoutWorlds, type WorldSnapshot } from "../src/renderer";
import {
  createRoadGeometryData,
  createSteppedTerrainData,
  settlementSupportHeightForPlacement,
  supportGroundHeightAt,
} from "../src/terrain";
import { roadCellsForVillage } from "../src/village";

const worlds: WorldSnapshot[] = [
  { projectId: "small", blueprintId: SMALL_WORKSHOP_BLUEPRINT.id, buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0 },
  { projectId: "large", blueprintId: TIMBER_HOUSE_BLUEPRINT.id, buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 1 },
];

describe("bounded world support follow-up", () => {
  it("keeps x/z identities stable while buildings and roads share one support datum", () => {
    const original = layoutWorlds(worlds);
    const identity = original.map((world) => ({ projectId: world.projectId, x: world.worldPosition.x, z: world.worldPosition.z, settlementIndex: world.settlementIndex }));

    for (const environmentStyle of ["natural-valley", "classic-island", "ocean-island"] as const) {
      const aligned = alignWorldsToEnvironment(original, environmentStyle).map((world) => {
        const support = settlementSupportHeightForPlacement(world, environmentStyle);
        return support > world.worldPosition.y
          ? { ...world, worldPosition: { ...world.worldPosition, y: support } }
          : world;
      });
      const pads = aligned.map((world) => ({
        x: world.worldPosition.x,
        z: world.worldPosition.z,
        width: world.footprint.width,
        depth: world.footprint.depth,
        groundLevel: Math.max(world.worldPosition.y, settlementSupportHeightForPlacement(world, environmentStyle)),
      }));
      const roads = roadCellsForVillage(aligned);
      const ground = (x: number, z: number) => supportGroundHeightAt(x, z, aligned, pads, environmentStyle);
      const roadGeometry = createRoadGeometryData(roads, aligned, pads, ground);
      const terrain = createSteppedTerrainData(aligned, roads, pads, undefined, {
        environmentStyle,
        worldSeed: `follow-up-${environmentStyle}`,
        terrainGenerationVersion: 4,
      });

      expect(aligned.map((world) => ({ projectId: world.projectId, x: world.worldPosition.x, z: world.worldPosition.z, settlementIndex: world.settlementIndex })))
        .toEqual(identity);
      for (const world of aligned) {
        const support = settlementSupportHeightForPlacement(world, environmentStyle);
        expect(world.worldPosition.y).toBeLessThanOrEqual(support);
        expect(ground(world.worldPosition.x, world.worldPosition.z)).toBeGreaterThanOrEqual(world.worldPosition.y);
        if (environmentStyle === "ocean-island") expect(world.worldPosition.y).toBeGreaterThanOrEqual(4);
      }
      for (let index = 0; index < roads.length; index += 1) {
        const road = roads[index]!;
        const y = roadGeometry.positions[index * 12 + 1]!;
        expect(y + 0.455).toBeCloseTo(ground(road.x, road.z), 6);
      }

      // Terrain tops under every footprint stay at or below the building base;
      // this catches the old centre-only placement rule that let slopes pierce
      // through a wide house footprint.
      for (const world of aligned) {
        const maxTop = terrain.positions.reduce((maximum, value, index) => {
          if (index % 3 !== 1) return maximum;
          const x = terrain.positions[index - 1]!;
          const z = terrain.positions[index + 1]!;
          if (Math.abs(x - world.worldPosition.x) <= Math.max(0, world.footprint.width / 2 - 1.01)
            && Math.abs(z - world.worldPosition.z) <= Math.max(0, world.footprint.depth / 2 - 1.01)) {
            return Math.max(maximum, value);
          }
          return maximum;
        }, Number.NEGATIVE_INFINITY);
        expect(maxTop).toBeLessThanOrEqual(world.worldPosition.y - 0.49);
      }
    }
  });

  it("retains the four-block ocean inhabited datum for roads and buildings", () => {
    const original = layoutWorlds([worlds[0]!]);
    const ocean = alignWorldsToEnvironment(original, "ocean-island");
    const roads = roadCellsForVillage(ocean);
    const pads = ocean.map((world) => ({
      x: world.worldPosition.x,
      z: world.worldPosition.z,
      width: world.footprint.width,
      depth: world.footprint.depth,
      groundLevel: world.worldPosition.y,
    }));
    const ground = (x: number, z: number) => supportGroundHeightAt(x, z, ocean, pads, "ocean-island");
    const roadGeometry = createRoadGeometryData(roads, ocean, pads, ground);
    expect(ocean[0]!.worldPosition.y).toBeGreaterThanOrEqual(4);
    expect(Math.min(...roads.map((_, index) => roadGeometry.positions[index * 12 + 1]! + 0.455))).toBeGreaterThanOrEqual(4);
  });
});
