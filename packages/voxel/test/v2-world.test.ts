import { describe, expect, it } from "vitest";
import {
  SMALL_WORKSHOP_BLUEPRINT,
  TIMBER_HOUSE_BLUEPRINT,
  VILLAGE_CHAPEL_BLUEPRINT,
  type BlueprintV1,
} from "../src/blueprint";
import { layoutWorlds, type WorldSnapshot } from "../src/renderer";
import { createRoadGeometryData, createSteppedTerrainData } from "../src/terrain";
import { layoutVillage, placeImportedDecorations, roadCellsForVillage, terrainHeightAt, villagePlazaFor } from "../src/village";
import { lowerQualityTier, QUALITY_PROFILES, selectQualityTier, selectQualityTierForLighting } from "../src/quality";

const snapshots: WorldSnapshot[] = [SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT, VILLAGE_CHAPEL_BLUEPRINT]
  .map((blueprint, settlementIndex) => ({
    projectId: `project-${settlementIndex}`,
    blueprintId: blueprint.id,
    buildingCompletionBasisPoints: 10_000,
    buildingConditionBasisPoints: 10_000,
    isMonument: false,
    settlementIndex,
  }));

describe("v2 compact village layout", () => {
  it("is deterministic across input order and keeps compact collision gaps", () => {
    const forward = layoutWorlds(snapshots);
    const reverse = layoutWorlds([...snapshots].reverse());
    const positions = new Map(forward.map((world) => [world.projectId, world.worldPosition]));
    expect(new Map(reverse.map((world) => [world.projectId, world.worldPosition]))).toEqual(positions);
    expect(Math.max(...forward.map((world) => Math.hypot(world.worldPosition.x, world.worldPosition.z)))).toBeLessThan(45);
    for (let leftIndex = 0; leftIndex < forward.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < forward.length; rightIndex += 1) {
        const left = forward[leftIndex]!; const right = forward[rightIndex]!;
        const separatedX = Math.abs(left.worldPosition.x - right.worldPosition.x) >= (left.footprint.width + right.footprint.width) / 2 + 3;
        const separatedZ = Math.abs(left.worldPosition.z - right.worldPosition.z) >= (left.footprint.depth + right.footprint.depth) / 2 + 3;
        expect(separatedX || separatedZ).toBe(true);
      }
    }
  });

  it("connects every entrance to the central plaza with a deterministic road", () => {
    const worlds = layoutWorlds(snapshots);
    const roads = roadCellsForVillage(worlds);
    const keys = new Set(roads.map((cell) => `${cell.x}:${cell.z}`));
    const plaza = villagePlazaFor(worlds);
    expect(keys.has(`${plaza.x}:${plaza.z}`)).toBe(true);
    expect(keys.has("0:0")).toBe(false);
    for (const world of worlds) {
      expect(keys.has(`${world.entrance.x}:${world.entrance.z}`)).toBe(true);
      expect(pathExists(keys, world.entrance, plaza)).toBe(true);
    }
  });

  it("centers imported positive-coordinate blueprints on their reserved plot", () => {
    const imported: BlueprintV1 = {
      schemaVersion: 1,
      id: "imported-positive",
      title: "Imported",
      bounds: { minX: 0, maxX: 47, minY: 0, maxY: 10, minZ: 0, maxZ: 31 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: "stone", buildOrder: 10000 }],
    };
    const [placement] = layoutVillage([{ settlementIndex: 0, blueprint: imported }]);
    expect(placement!.blueprintOffset).toEqual({ x: -23.5, z: -15.5 });
    expect(placement!.footprint).toEqual({ width: 48, depth: 32 });
  });

  it("keeps a wide imported footprint inside the circular island margin", () => {
    const wide: BlueprintV1 = {
      schemaVersion: 1,
      id: "imported-wide",
      title: "Wide imported",
      bounds: { minX: 0, maxX: 41, minY: 0, maxY: 20, minZ: 0, maxZ: 34 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: "stone", buildOrder: 10000 }],
    };
    const builtins = [SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT, VILLAGE_CHAPEL_BLUEPRINT];
    const placements = layoutWorlds([
      { ...snapshots[0]!, blueprintId: wide.id },
      ...snapshots.slice(1),
    ], id => id === wide.id ? wide : builtins.find(candidate => candidate.id === id)!);
    const terrain = createSteppedTerrainData(placements, roadCellsForVillage(placements));
    const radius = terrain.bounds.maxX;
    for (const placement of placements) {
      for (const [offsetX, offsetZ] of [
        [-placement.footprint.width / 2, -placement.footprint.depth / 2],
        [-placement.footprint.width / 2, placement.footprint.depth / 2],
        [placement.footprint.width / 2, -placement.footprint.depth / 2],
        [placement.footprint.width / 2, placement.footprint.depth / 2],
      ]) {
        expect(Math.hypot(placement.worldPosition.x + offsetX!, placement.worldPosition.z + offsetZ!)).toBeLessThan(radius - 1);
      }
    }
  });

  it("places imported reward blueprints on terrain without buildings or roads", () => {
    const hosts = layoutWorlds(snapshots);
    const roads = roadCellsForVillage(hosts);
    const rewardBlueprint: BlueprintV1 = {
      schemaVersion: 1,
      id: "reward-lamp",
      title: "Reward lamp",
      bounds: { minX: 0, maxX: 2, minY: 0, maxY: 3, minZ: 0, maxZ: 2 },
      voxels: [{ x: 1, y: 0, z: 1, materialId: "stone", buildOrder: 10000 }],
    };
    const input = [{
      rewardId: "reward-1",
      resourceId: "resource-1",
      date: "2026-07-26",
      projectId: hosts[0]!.projectId,
      blueprint: rewardBlueprint,
      localPosition: { x: 0, z: 0 },
      rotationQuarterTurns: 1 as const,
    }];
    const [placed] = placeImportedDecorations(input, hosts, roads);
    expect(placed).toBeDefined();
    expect(placed!.worldPosition.y).toBe(terrainHeightAt(placed!.worldPosition.x, placed!.worldPosition.z));
    expect(placed!.rotationY).toBe(hosts[0]!.rotationY + Math.PI / 2);
    expect(placed!.worldPosition).not.toMatchObject({ x: hosts[0]!.worldPosition.x, z: hosts[0]!.worldPosition.z });
    const roadKeys = new Set(roads.map((road) => `${road.x}:${road.z}`));
    expect(roadKeys.has(`${placed!.worldPosition.x}:${placed!.worldPosition.z}`)).toBe(false);
    expect(placeImportedDecorations(input, hosts, roads)).toEqual([placed]);
  });
});

describe("merged stepped terrain", () => {
  it("builds one exposed surface dataset with three material groups", () => {
    const placements = layoutWorlds(snapshots);
    const roads = roadCellsForVillage(placements);
    const terrain = createSteppedTerrainData(placements, roads);
    expect(terrain.cellCount).toBeGreaterThan(1_000);
    expect(terrain.triangleCount).toBeGreaterThan(terrain.cellCount * 2);
    expect(terrain.triangleCount).toBeLessThan(40_000);
    expect(terrain.indicesByMaterial.grass.length).toBe(terrain.cellCount * 6);
    expect(terrain.indicesByMaterial.dirt.length).toBeGreaterThan(0);
    expect(terrain.indicesByMaterial.stone.length).toBeGreaterThan(0);

    const roadGeometry = createRoadGeometryData(roads, placements);
    expect(roadGeometry.triangleCount).toBe(roads.length * 2);
    expect(roadGeometry.positions.length).toBe(roads.length * 12);
  });

  it("adds deterministic natural scenery outside the unchanged settlement frame", () => {
    const placements = layoutWorlds(snapshots);
    const roads = roadCellsForVillage(placements);
    const classic = createSteppedTerrainData(placements, roads, [], undefined, {
      environmentStyle: "classic-island",
      worldSeed: "stable-world",
    });
    const natural = createSteppedTerrainData(placements, roads, [], undefined, {
      environmentStyle: "natural-valley",
      worldSeed: "stable-world",
    });
    const repeated = createSteppedTerrainData(placements, roads, [], undefined, {
      environmentStyle: "natural-valley",
      worldSeed: "stable-world",
    });

    expect(natural.framingBounds).toMatchObject({
      minX: classic.bounds.minX,
      maxX: classic.bounds.maxX,
      minZ: classic.bounds.minZ,
      maxZ: classic.bounds.maxZ,
    });
    expect(natural.bounds.maxX).toBeGreaterThan(classic.bounds.maxX + 20);
    expect(natural.bounds.maxX).toBeGreaterThanOrEqual(720);
    expect(natural.bounds.maxY).toBeGreaterThanOrEqual(20);
    expect(natural.bounds.minY).toBe(-0.5);
    expect(natural.terrainGenerationVersion).toBe(3);
    expect(natural.lodCellCounts.near).toBeGreaterThan(0);
    expect(natural.lodCellCounts.middle).toBeGreaterThan(0);
    expect(natural.lodCellCounts.far).toBeGreaterThan(0);
    expect(natural.hydrology.networkCount).toBeGreaterThan(0);
    expect(natural.hydrology.basinCount).toBeGreaterThan(0);
    expect(natural.hydrology.riverCellCount).toBeGreaterThan(0);
    expect(natural.hydrology.lakeCellCount).toBeGreaterThan(0);
    expect(natural.hydrology.riverSegmentCount).toBeGreaterThan(0);
    expect(natural.hydrology.outletCount).toBeGreaterThan(0);
    expect(natural.hydrology.maxUphillWaterStep).toBe(0);
    expect(natural.hydrology.protectedWaterCellCount).toBe(0);
    expect(natural.indicesByMaterial.water.length).toBeGreaterThan(0);
    expect(natural.naturalTrees.length).toBeGreaterThan(0);
    expect(repeated.positions).toEqual(natural.positions);
    expect(repeated.indicesByMaterial).toEqual(natural.indicesByMaterial);
    expect(repeated.naturalTrees).toEqual(natural.naturalTrees);

    const otherSeed = createSteppedTerrainData(placements, roads, [], undefined, {
      environmentStyle: "natural-valley",
      worldSeed: "another-stable-world",
    });
    expect(otherSeed.positions).not.toEqual(natural.positions);
  });

  it("keeps the previous terrain generator addressable while defaulting new worlds to v3", () => {
    const placements = layoutWorlds(snapshots);
    const roads = roadCellsForVillage(placements);
    const previous = createSteppedTerrainData(placements, roads, [], undefined, {
      environmentStyle: "natural-valley",
      worldSeed: "stable-world",
      terrainGenerationVersion: 2,
    });
    const current = createSteppedTerrainData(placements, roads, [], undefined, {
      environmentStyle: "natural-valley",
      worldSeed: "stable-world",
      terrainGenerationVersion: 3,
    });
    expect(previous.terrainGenerationVersion).toBe(2);
    expect(current.terrainGenerationVersion).toBe(3);
    expect(current.positions).not.toEqual(previous.positions);
  });

  it.each([30, 60, 100])("keeps a %i-building natural world inside the merged-mesh budget", (count) => {
    const many = Array.from({ length: count }, (_, settlementIndex): WorldSnapshot => ({
      projectId: `stress-${settlementIndex}`,
      blueprintId: SMALL_WORKSHOP_BLUEPRINT.id,
      buildingCompletionBasisPoints: 10_000,
      buildingConditionBasisPoints: 10_000,
      isMonument: false,
      settlementIndex,
    }));
    const placements = layoutWorlds(many);
    const roads = roadCellsForVillage(placements);
    const terrain = createSteppedTerrainData(placements, roads, [], undefined, {
      environmentStyle: "natural-valley",
      worldSeed: "stress-world",
    });
    expect(terrain.bounds.maxX - terrain.framingBounds.maxX).toBeGreaterThanOrEqual(52);
    expect(terrain.cellCount).toBeLessThan(100_000);
    expect(terrain.triangleCount).toBeLessThan(500_000);
    expect(placements).toHaveLength(count);
  });
});

describe("quality profiles", () => {
  it("selects conservative tiers from device and scene pressure", () => {
    expect(selectQualityTier({ devicePixelRatio: 1, hardwareConcurrency: 8, deviceMemoryGb: 8, maxTextureSize: 8192, voxelCount: 5_000 })).toBe("high");
    expect(selectQualityTier({ devicePixelRatio: 3, hardwareConcurrency: 4, deviceMemoryGb: 4, maxTextureSize: 8192, voxelCount: 30_000 })).toBe("balanced");
    expect(selectQualityTier({ devicePixelRatio: 2, hardwareConcurrency: 2, deviceMemoryGb: 2, maxTextureSize: 2048, voxelCount: 80_000 })).toBe("low");
    expect(lowerQualityTier("high")).toBe("balanced");
    expect(lowerQualityTier("balanced")).toBe("low");
    expect(QUALITY_PROFILES.high.maxLocalLights).toBeLessThanOrEqual(2);
    expect(QUALITY_PROFILES.low.maxGlowSprites).toBe(0);
    expect(QUALITY_PROFILES.balanced.maxGlowSprites).toBeLessThanOrEqual(1);
    expect(QUALITY_PROFILES.high.maxGlowSprites).toBeLessThanOrEqual(2);
    expect(QUALITY_PROFILES.low.shadowMapSize).toBe(512);
    expect(QUALITY_PROFILES.low.starCount).toBeLessThan(QUALITY_PROFILES.high.starCount);
    expect(QUALITY_PROFILES.low.cloudLobes).toBeLessThanOrEqual(QUALITY_PROFILES.high.cloudLobes);
    const capable = { devicePixelRatio: 1, hardwareConcurrency: 8, deviceMemoryGb: 8, maxTextureSize: 8192, voxelCount: 5_000 };
    expect(selectQualityTierForLighting(capable, "performance")).toBe("low");
    expect(selectQualityTierForLighting(capable, "balanced")).toBe("balanced");
    expect(selectQualityTierForLighting(capable, "cinematic")).toBe("high");
    const constrained = { ...capable, maxTextureSize: 2048 };
    expect(selectQualityTierForLighting(constrained, "cinematic")).toBe("low");
  });
});

function pathExists(cells: ReadonlySet<string>, start: { x: number; z: number }, goal: { x: number; z: number }): boolean {
  const queue = [start];
  const seen = new Set([`${start.x}:${start.z}`]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.x === goal.x && current.z === goal.z) return true;
    for (const next of [
      { x: current.x - 1, z: current.z }, { x: current.x + 1, z: current.z },
      { x: current.x, z: current.z - 1 }, { x: current.x, z: current.z + 1 },
    ]) {
      const key = `${next.x}:${next.z}`;
      if (!cells.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return false;
}
