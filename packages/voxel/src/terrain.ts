import type { VillagePlacement, RoadCell } from "./village";
import { terrainHeightAt } from "./village";

export type TerrainMaterial = "grass" | "dirt" | "stone";

export interface MergedGeometryData {
  positions: number[];
  indicesByMaterial: Record<TerrainMaterial, number[]>;
  cellCount: number;
  triangleCount: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface RoadGeometryData {
  positions: number[];
  indices: number[];
  cellCount: number;
  triangleCount: number;
}

export interface TerrainPad {
  x: number;
  z: number;
  width: number;
  depth: number;
  groundLevel: number;
}

export function createSteppedTerrainData(
  placements: readonly VillagePlacement[],
  roads: readonly RoadCell[],
  additionalPads: readonly TerrainPad[] = [],
): MergedGeometryData {
  const extent = villageExtent(placements, roads, additionalPads);
  const cells = new Map<string, number>();
  const radiusX = Math.max(26, Math.max(Math.abs(extent.minX), Math.abs(extent.maxX)) + 9);
  const radiusZ = Math.max(24, Math.max(Math.abs(extent.minZ), Math.abs(extent.maxZ)) + 9);
  for (let x = -Math.ceil(radiusX); x <= Math.ceil(radiusX); x += 1) {
    for (let z = -Math.ceil(radiusZ); z <= Math.ceil(radiusZ); z += 1) {
      const normalized = (x / radiusX) ** 2 + (z / radiusZ) ** 2;
      const edgeNoise = ((stableHash(`edge:${x}:${z}`) % 100) - 50) / 1_500;
      if (normalized + edgeNoise > 1) continue;
      cells.set(`${x}:${z}`, heightForCell(x, z, placements, additionalPads));
    }
  }

  const positions: number[] = [];
  const indicesByMaterial: Record<TerrainMaterial, number[]> = { grass: [], dirt: [], stone: [] };
  const addQuad = (vertices: readonly number[], material: TerrainMaterial): void => {
    const start = positions.length / 3;
    positions.push(...vertices);
    indicesByMaterial[material].push(start, start + 1, start + 2, start, start + 2, start + 3);
  };

  for (const [key, height] of cells) {
    const [xText, zText] = key.split(":");
    const x = Number(xText);
    const z = Number(zText);
    const top = height - 0.5;
    addQuad([
      x - 0.5, top, z - 0.5, x - 0.5, top, z + 0.5,
      x + 0.5, top, z + 0.5, x + 0.5, top, z - 0.5,
    ], "grass");
    addExposedSide(x, z, height, -1, 0, cells, addQuad);
    addExposedSide(x, z, height, 1, 0, cells, addQuad);
    addExposedSide(x, z, height, 0, -1, cells, addQuad);
    addExposedSide(x, z, height, 0, 1, cells, addQuad);
  }
  const indexCount = Object.values(indicesByMaterial).reduce((sum, indices) => sum + indices.length, 0);
  return {
    positions,
    indicesByMaterial,
    cellCount: cells.size,
    triangleCount: indexCount / 3,
    bounds: { minX: -radiusX, maxX: radiusX, minZ: -radiusZ, maxZ: radiusZ },
  };
}

export function createRoadGeometryData(
  roads: readonly RoadCell[],
  placements: readonly VillagePlacement[],
  additionalPads: readonly TerrainPad[] = [],
): RoadGeometryData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const road of roads) {
    const y = heightForCell(road.x, road.z, placements, additionalPads) - 0.455;
    const start = positions.length / 3;
    positions.push(
      road.x - 0.49, y, road.z - 0.49,
      road.x - 0.49, y, road.z + 0.49,
      road.x + 0.49, y, road.z + 0.49,
      road.x + 0.49, y, road.z - 0.49,
    );
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return { positions, indices, cellCount: roads.length, triangleCount: indices.length / 3 };
}

function heightForCell(x: number, z: number, placements: readonly VillagePlacement[], additionalPads: readonly TerrainPad[]): number {
  for (const placement of placements) {
    if (Math.abs(x - placement.worldPosition.x) <= placement.footprint.width / 2 + 1
      && Math.abs(z - placement.worldPosition.z) <= placement.footprint.depth / 2 + 1) {
      return placement.worldPosition.y;
    }
  }
  for (const pad of additionalPads) {
    if (Math.abs(x - pad.x) <= pad.width / 2 + 1 && Math.abs(z - pad.z) <= pad.depth / 2 + 1) return pad.groundLevel;
  }
  return terrainHeightAt(x, z);
}

function addExposedSide(
  x: number,
  z: number,
  height: number,
  dx: number,
  dz: number,
  cells: ReadonlyMap<string, number>,
  addQuad: (vertices: readonly number[], material: TerrainMaterial) => void,
): void {
  const neighbor = cells.get(`${x + dx}:${z + dz}`) ?? -2;
  if (neighbor >= height) return;
  for (let layer = neighbor; layer < height; layer += 1) {
    const bottom = layer - 0.5;
    const top = layer + 0.5;
    const material: TerrainMaterial = layer >= 0 ? "dirt" : "stone";
    if (dx < 0) addQuad([x - 0.5, bottom, z + 0.5, x - 0.5, top, z + 0.5, x - 0.5, top, z - 0.5, x - 0.5, bottom, z - 0.5], material);
    else if (dx > 0) addQuad([x + 0.5, bottom, z - 0.5, x + 0.5, top, z - 0.5, x + 0.5, top, z + 0.5, x + 0.5, bottom, z + 0.5], material);
    else if (dz < 0) addQuad([x - 0.5, bottom, z - 0.5, x - 0.5, top, z - 0.5, x + 0.5, top, z - 0.5, x + 0.5, bottom, z - 0.5], material);
    else addQuad([x + 0.5, bottom, z + 0.5, x + 0.5, top, z + 0.5, x - 0.5, top, z + 0.5, x - 0.5, bottom, z + 0.5], material);
  }
}

function villageExtent(placements: readonly VillagePlacement[], roads: readonly RoadCell[], additionalPads: readonly TerrainPad[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const xs = [0, ...roads.map((road) => road.x)];
  const zs = [0, ...roads.map((road) => road.z)];
  for (const placement of placements) {
    xs.push(placement.worldPosition.x - placement.footprint.width / 2, placement.worldPosition.x + placement.footprint.width / 2);
    zs.push(placement.worldPosition.z - placement.footprint.depth / 2, placement.worldPosition.z + placement.footprint.depth / 2);
  }
  for (const pad of additionalPads) {
    xs.push(pad.x - pad.width / 2, pad.x + pad.width / 2);
    zs.push(pad.z - pad.depth / 2, pad.z + pad.depth / 2);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
