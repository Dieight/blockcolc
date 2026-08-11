import {
  SMALL_WORKSHOP_BLUEPRINT,
  TIMBER_HOUSE_BLUEPRINT,
  VILLAGE_CHAPEL_BLUEPRINT,
} from "../src/blueprint";
import { layoutWorlds, type WorldSnapshot } from "../src/renderer";
import { createSteppedTerrainData } from "../src/terrain";
import { roadCellsForVillage } from "../src/village";
import type { MergedGeometryData, TerrainMaterial } from "../src/terrain";

const seeds = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ["stable-world", "another-stable-world", "mountain-pass", "river-basin", "quiet-valley", "world-default"];

const snapshots: WorldSnapshot[] = [SMALL_WORKSHOP_BLUEPRINT, TIMBER_HOUSE_BLUEPRINT, VILLAGE_CHAPEL_BLUEPRINT]
  .map((blueprint, settlementIndex) => ({
    projectId: `metric-${settlementIndex}`,
    blueprintId: blueprint.id,
    buildingCompletionBasisPoints: 10_000,
    buildingConditionBasisPoints: 10_000,
    isMonument: false,
    settlementIndex,
  }));
const placements = layoutWorlds(snapshots);
const roads = roadCellsForVillage(placements);

for (const seed of seeds) {
  const versions = [3, 4].map((terrainGenerationVersion) => {
    const startedAt = performance.now();
    const terrain = createSteppedTerrainData(placements, roads, [], undefined, {
      environmentStyle: "natural-valley",
      worldSeed: seed,
      terrainGenerationVersion: terrainGenerationVersion as 3 | 4,
    });
    const surfaces = analyzeSurfaces(terrain);
    return {
      version: terrainGenerationVersion,
      waterRatio: Number((terrain.hydrology.waterSurfaceArea / terrain.hydrology.terrainSurfaceArea).toFixed(5)),
      maximumHeight: terrain.bounds.maxY - 0.5,
      elevationP50: surfaces.elevationP50,
      elevationP90: surfaces.elevationP90,
      elevationP99: surfaces.elevationP99,
      ridgeLargestShare: surfaces.ridgeLargestShare,
      waterComponents: surfaces.waterComponents,
      smallWaterComponents: surfaces.smallWaterComponents,
      networks: terrain.hydrology.networkCount,
      basins: terrain.hydrology.basinCount,
      riverSegments: terrain.hydrology.riverSegmentCount,
      cells: terrain.cellCount,
      triangles: terrain.triangleCount,
      generationMs: Number((performance.now() - startedAt).toFixed(1)),
    };
  });
  console.log(JSON.stringify({ seed, versions }));
}

interface SurfaceCell {
  material: TerrainMaterial;
  x: number;
  z: number;
  size: number;
  height: number;
  area: number;
}

function analyzeSurfaces(terrain: MergedGeometryData): {
  elevationP50: number;
  elevationP90: number;
  elevationP99: number;
  ridgeLargestShare: number;
  waterComponents: number;
  smallWaterComponents: number;
} {
  const materialByVertex = new Map<number, TerrainMaterial>();
  for (const [material, indices] of Object.entries(terrain.indicesByMaterial) as Array<[TerrainMaterial, number[]]>) {
    for (const index of indices) materialByVertex.set(index, material);
  }
  const cells: SurfaceCell[] = [];
  for (let offset = 0; offset < terrain.positions.length; offset += 12) {
    const xs = [terrain.positions[offset]!, terrain.positions[offset + 3]!, terrain.positions[offset + 6]!, terrain.positions[offset + 9]!];
    const ys = [terrain.positions[offset + 1]!, terrain.positions[offset + 4]!, terrain.positions[offset + 7]!, terrain.positions[offset + 10]!];
    const zs = [terrain.positions[offset + 2]!, terrain.positions[offset + 5]!, terrain.positions[offset + 8]!, terrain.positions[offset + 11]!];
    if (Math.max(...ys) - Math.min(...ys) > 0.001) continue;
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...zs) - Math.min(...zs);
    if (width <= 0.001 || depth <= 0.001) continue;
    const material = materialByVertex.get(offset / 3);
    if (!material) continue;
    cells.push({
      material,
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
      size: Math.max(width, depth),
      height: ys[0]! + (material === "water" ? 0.34 : 0.5),
      area: width * depth,
    });
  }
  const land = cells.filter((cell) => cell.material !== "water");
  const elevationP50 = weightedPercentile(land, 0.5);
  const elevationP90 = weightedPercentile(land, 0.9);
  const elevationP99 = weightedPercentile(land, 0.99);
  const ridgeCells = expandToGrid(land.filter((cell) => cell.height >= elevationP90));
  const waterCells = expandToGrid(cells.filter((cell) => cell.material === "water"));
  const ridgeComponents = componentSizes(ridgeCells);
  const waterComponents = componentSizes(waterCells);
  return {
    elevationP50,
    elevationP90,
    elevationP99,
    ridgeLargestShare: ridgeCells.size === 0 ? 0 : Number(((ridgeComponents[0] ?? 0) / ridgeCells.size).toFixed(3)),
    waterComponents: waterComponents.length,
    smallWaterComponents: waterComponents.filter((size) => size <= 16).length,
  };
}

function weightedPercentile(cells: readonly SurfaceCell[], percentile: number): number {
  const ordered = [...cells].sort((left, right) => left.height - right.height);
  const target = ordered.reduce((sum, cell) => sum + cell.area, 0) * percentile;
  let accumulated = 0;
  for (const cell of ordered) {
    accumulated += cell.area;
    if (accumulated >= target) return Number(cell.height.toFixed(2));
  }
  return Number((ordered.at(-1)?.height ?? 0).toFixed(2));
}

function expandToGrid(cells: readonly SurfaceCell[], step = 4): Set<string> {
  const result = new Set<string>();
  for (const cell of cells) {
    const count = Math.max(1, Math.round(cell.size / step));
    const startX = Math.round((cell.x - cell.size / 2) / step);
    const startZ = Math.round((cell.z - cell.size / 2) / step);
    for (let dx = 0; dx < count; dx += 1) {
      for (let dz = 0; dz < count; dz += 1) result.add(`${startX + dx}:${startZ + dz}`);
    }
  }
  return result;
}

function componentSizes(cells: ReadonlySet<string>): number[] {
  const remaining = new Set(cells);
  const sizes: number[] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    const queue = [first];
    remaining.delete(first);
    let size = 0;
    while (queue.length > 0) {
      const current = queue.pop()!;
      size += 1;
      const [x, z] = current.split(":").map(Number) as [number, number];
      for (const neighbor of [`${x - 1}:${z}`, `${x + 1}:${z}`, `${x}:${z - 1}`, `${x}:${z + 1}`]) {
        if (!remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((left, right) => right - left);
}
