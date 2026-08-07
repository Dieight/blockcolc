import type { VillagePlacement, RoadCell } from "./village";
import { terrainHeightAt } from "./village";

export type TerrainMaterial = "grass" | "dirt" | "stone" | "water";
export type TerrainEnvironmentStyle = "natural-valley" | "classic-island";

export interface NaturalTreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
}

export interface MergedGeometryData {
  positions: number[];
  indicesByMaterial: Record<TerrainMaterial, number[]>;
  cellCount: number;
  triangleCount: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  framingBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  naturalTrees: readonly NaturalTreePlacement[];
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
  minimumRadius?: { x: number; z: number },
  options: { environmentStyle?: TerrainEnvironmentStyle; worldSeed?: string } = {},
): MergedGeometryData {
  const extent = villageExtent(placements, roads, additionalPads);
  const cells = new Map<string, number>();
  const outerX = Math.max(Math.abs(extent.minX), Math.abs(extent.maxX)) + 9;
  const outerZ = Math.max(Math.abs(extent.minZ), Math.abs(extent.maxZ)) + 9;
  // Keep the island round while enclosing every accepted building footprint.
  const radius = Math.max(26, minimumRadius?.x ?? 0, minimumRadius?.z ?? 0, Math.hypot(outerX, outerZ));
  const natural = options.environmentStyle === "natural-valley";
  const worldSeed = options.worldSeed ?? "world-default";
  const seedHash = stableHash(worldSeed);
  // The outer ring must still cover the farthest supported phone framing. Keep
  // it finite and deterministic so it remains cheap to merge and test.
  const outerMargin = natural ? Math.max(96, Math.min(130, Math.round(radius * 1.15))) : 0;
  const radiusX = radius + outerMargin;
  const radiusZ = radius + outerMargin;
  // A 1x1 mesh is useful close up, but a large circular settlement otherwise
  // consumes an excessive number of independent terrain vertices on mobile.
  const cellSize = radius > 70 ? 2 : 1;
  const waterCells = new Set<string>();
  const naturalTrees: NaturalTreePlacement[] = [];
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (let x = -Math.ceil(radiusX); x <= Math.ceil(radiusX); x += cellSize) {
    for (let z = -Math.ceil(radiusZ); z <= Math.ceil(radiusZ); z += cellSize) {
      const normalized = (x / radiusX) ** 2 + (z / radiusZ) ** 2;
      const edgeNoise = ((hash2d(seedHash, 0x11, x, z) % 100) - 50) / 1_500;
      if (normalized + edgeNoise > 1) continue;
      const coreNormalized = (x / radius) ** 2 + (z / radius) ** 2;
      const key = `${x}:${z}`;
      if (!natural || coreNormalized <= 1) {
        const height = heightForCell(x, z, placements, additionalPads);
        cells.set(key, height);
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
        continue;
      }
      const generated = naturalHeightForCell(x, z, radius, outerMargin, seedHash);
      cells.set(key, generated.height);
      minHeight = Math.min(minHeight, generated.height);
      maxHeight = Math.max(maxHeight, generated.height);
      if (generated.water) waterCells.add(key);
      if (!generated.water && generated.tree) {
        naturalTrees.push({ x, y: generated.height - 0.45, z, scale: generated.treeScale });
      }
    }
  }

  const positions: number[] = [];
  const indicesByMaterial: Record<TerrainMaterial, number[]> = { grass: [], dirt: [], stone: [], water: [] };
  const addQuad = (vertices: readonly number[], material: TerrainMaterial): void => {
    const start = positions.length / 3;
    positions.push(...vertices);
    indicesByMaterial[material].push(start, start + 1, start + 2, start, start + 2, start + 3);
  };

  for (const [key, height] of cells) {
    const [xText, zText] = key.split(":");
    const x = Number(xText);
    const z = Number(zText);
    const half = cellSize / 2;
    const top = waterCells.has(key) ? height - 0.34 : height - 0.5;
    addQuad([
      x - half, top, z - half, x - half, top, z + half,
      x + half, top, z + half, x + half, top, z - half,
    ], waterCells.has(key) ? "water" : "grass");
    const sideStride = natural ? 2 : 1;
    addExposedSide(x, z, height, -1, 0, cellSize, sideStride, cells, addQuad);
    addExposedSide(x, z, height, 1, 0, cellSize, sideStride, cells, addQuad);
    addExposedSide(x, z, height, 0, -1, cellSize, sideStride, cells, addQuad);
    addExposedSide(x, z, height, 0, 1, cellSize, sideStride, cells, addQuad);
  }
  const indexCount = Object.values(indicesByMaterial).reduce((sum, indices) => sum + indices.length, 0);
  return {
    positions,
    indicesByMaterial,
    cellCount: cells.size,
    triangleCount: indexCount / 3,
    bounds: { minX: -radiusX, maxX: radiusX, minY: minHeight - 0.5, maxY: maxHeight + 0.5, minZ: -radiusZ, maxZ: radiusZ },
    framingBounds: natural
      ? { minX: -radius, maxX: radius, minZ: -radius, maxZ: radius }
      : { minX: -radiusX, maxX: radiusX, minZ: -radiusZ, maxZ: radiusZ },
    naturalTrees,
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
  cellSize: number,
  sideStride: number,
  cells: ReadonlyMap<string, number>,
  addQuad: (vertices: readonly number[], material: TerrainMaterial) => void,
): void {
  const neighbor = cells.get(`${x + dx * cellSize}:${z + dz * cellSize}`) ?? -2;
  if (neighbor >= height) return;
  const half = cellSize / 2;
  for (let layer = neighbor; layer < height; layer += sideStride) {
    const bottom = layer - 0.5;
    const top = Math.min(height - 0.5, layer + sideStride - 0.5);
    const material: TerrainMaterial = layer >= 0 ? "dirt" : "stone";
    if (dx < 0) addQuad([x - half, bottom, z + half, x - half, top, z + half, x - half, top, z - half, x - half, bottom, z - half], material);
    else if (dx > 0) addQuad([x + half, bottom, z - half, x + half, top, z - half, x + half, top, z + half, x + half, bottom, z + half], material);
    else if (dz < 0) addQuad([x - half, bottom, z - half, x - half, top, z - half, x + half, top, z - half, x + half, bottom, z - half], material);
    else addQuad([x + half, bottom, z + half, x + half, top, z + half, x - half, top, z + half, x - half, bottom, z + half], material);
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

function naturalHeightForCell(
  x: number,
  z: number,
  coreRadius: number,
  outerMargin: number,
  seedHash: number,
): { height: number; water: boolean; tree: boolean; treeScale: number } {
  const phaseA = (hash2d(seedHash, 0x21, 0, 0) % 6283) / 1000;
  const phaseB = (hash2d(seedHash, 0x22, 0, 0) % 6283) / 1000;
  const distance = Math.hypot(x, z);
  const outerDistance = Math.max(0, distance - coreRadius);
  const transition = smoothstep(0, 60, outerDistance);
  const outerProgress = Math.max(0, Math.min(1, outerDistance / Math.max(1, outerMargin)));
  const boundaryBand = smoothstep(0.7, 1, outerProgress);
  const foothillEnvelope = smoothstep(0.08, 0.36, outerProgress);
  // Minecraft's modern terrain is shaped by several low-frequency fields
  // rather than one repeating wave. These deterministic fields give us the
  // same broad-continent / ridge / erosion vocabulary without importing game
  // code or assets.
  const continentalness = fractalNoise(x * 0.018, z * 0.018, seedHash, 0x31);
  const erosion = fractalNoise(x * 0.042, z * 0.042, seedHash, 0x41);
  const ridgeNoise = fractalNoise(x * 0.028, z * 0.028, seedHash, 0x51);
  const ridge = 1 - Math.abs(ridgeNoise);
  const fineVariation = fractalNoise(x * 0.085, z * 0.085, seedHash, 0x61);
  const mountainSignal = smoothstep(0.12, 0.62, continentalness - erosion * 0.38 + ridgeNoise * 0.22);
  const hillSignal = smoothstep(-0.5, 0.12, continentalness + ridgeNoise * 0.18);
  const valleyCarve = smoothstep(0.05, 0.72, erosion) * 0.85;
  // The high outer ring is a boundary screen, while the interior uses the
  // relief fields above so it contains lowlands and separated mountain runs.
  const outerRimHeight = boundaryBand * (3.2 + ridge * 1.45 + Math.max(0, continentalness) * 0.9);
  const mountainHeight = foothillEnvelope * mountainSignal * (2.4 + ridge * 3.4);
  const hillHeight = foothillEnvelope * hillSignal * (0.9 + ridge * 0.75);
  const rollingHeight = foothillEnvelope * (0.55 + ridge * 0.55);
  const rawTerrainHeight = 0.3
    + hillHeight
    + mountainHeight
    + rollingHeight
    - valleyCarve
    + outerRimHeight
    + fineVariation * 0.25;
  // Preserve the old floor at zero while making the old five-layer peak a
  // twenty-five-layer mountain. The transition keeps the settlement core
  // unchanged and avoids a vertical ring around its edge.
  const generatedHeight = Math.max(0, Math.min(25, Math.round(rawTerrainHeight * 5)));
  const coreHeight = terrainHeightAt(x, z);
  let height = Math.round(coreHeight * (1 - transition) + generatedHeight * transition);

  const lakeAngle = (hash2d(seedHash, 0x81, 0, 0) / 0xffffffff) * Math.PI * 2;
  const lakeDistance = coreRadius + outerMargin * (0.28 + (hash2d(seedHash, 0x82, 0, 0) % 30) / 100);
  const lakeX = Math.cos(lakeAngle) * lakeDistance;
  const lakeZ = Math.sin(lakeAngle) * lakeDistance;
  const lakeWidth = Math.max(10, outerMargin * (0.18 + (hash2d(seedHash, 0x83, 0, 0) % 12) / 100));
  const lakeDepth = Math.max(8, lakeWidth * (0.55 + (hash2d(seedHash, 0x84, 0, 0) % 25) / 100));
  const lakeShape = ((x - lakeX) / lakeWidth) ** 2 + ((z - lakeZ) / lakeDepth) ** 2;
  const secondLakeAngle = lakeAngle + 2.25;
  const secondLakeDistance = coreRadius + outerMargin * 0.58;
  const secondLakeX = Math.cos(secondLakeAngle) * secondLakeDistance;
  const secondLakeZ = Math.sin(secondLakeAngle) * secondLakeDistance;
  const secondLakeShape = ((x - secondLakeX) / Math.max(7, lakeWidth * 0.52)) ** 2
    + ((z - secondLakeZ) / Math.max(6, lakeDepth * 0.52)) ** 2;
  const riverAngle = (hash2d(seedHash, 0x85, 0, 0) / 0xffffffff) * Math.PI * 2;
  const along = x * Math.cos(riverAngle) + z * Math.sin(riverAngle);
  const across = -x * Math.sin(riverAngle) + z * Math.cos(riverAngle);
  const riverOffset = (hash2d(seedHash, 0x86, 0, 0) / 0xffffffff - 0.5) * outerMargin * 0.35;
  const riverCenter = riverOffset + Math.sin(along * 0.04 + phaseA) * 5 + fractalNoise(along * 0.018, across * 0.018, seedHash, 0x91) * 7;
  const river = Math.abs(across - riverCenter) < 1.55 + boundaryBand * 0.8;
  const water = transition > 0.35 && (lakeShape < 1 || secondLakeShape < 1 || river);
  if (water) height = 0;

  const forestSignal = fractalNoise(x * 0.055, z * 0.055, seedHash, 0xa1) + Math.sin(x * 0.025 + phaseB) * 0.18;
  const treeHash = hash2d(seedHash, 0x71, x, z);
  const tree = transition > 0.55 && forestSignal > 0.12 && treeHash % 1000 < 56;
  return { height, water, tree, treeScale: 0.82 + (treeHash % 37) / 100 };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function fractalNoise(x: number, z: number, seedHash: number, channel: number): number {
  return valueNoise(x, z, seedHash, channel) * 0.58
    + valueNoise(x * 2, z * 2, seedHash, channel + 1) * 0.27
    + valueNoise(x * 4, z * 4, seedHash, channel + 2) * 0.15;
}

function valueNoise(x: number, z: number, seedHash: number, channel: number): number {
  const x0 = Math.floor(x); const z0 = Math.floor(z);
  const tx = smoothstep(0, 1, x - x0); const tz = smoothstep(0, 1, z - z0);
  const n00 = signedHash(seedHash, channel, x0, z0);
  const n10 = signedHash(seedHash, channel, x0 + 1, z0);
  const n01 = signedHash(seedHash, channel, x0, z0 + 1);
  const n11 = signedHash(seedHash, channel, x0 + 1, z0 + 1);
  const top = n00 + (n10 - n00) * tx;
  const bottom = n01 + (n11 - n01) * tx;
  return top + (bottom - top) * tz;
}

function signedHash(seedHash: number, channel: number, x: number, z: number): number {
  return (hash2d(seedHash, channel, x, z) / 0x7fffffff) - 1;
}

function hash2d(seedHash: number, channel: number, x: number, z: number): number {
  let hash = seedHash ^ Math.imul(channel, 0x45d9f3b) ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return hash >>> 0;
}
