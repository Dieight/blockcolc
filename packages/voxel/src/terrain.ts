import type { VillagePlacement, RoadCell } from "./village";
import { terrainHeightAt } from "./village";

export type TerrainMaterial = "grass" | "dirt" | "stone" | "water";
export type TerrainEnvironmentStyle = "natural-valley" | "classic-island";
export type TerrainGenerationVersion = 1 | 2 | 3 | 4;

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
  terrainGenerationVersion: TerrainGenerationVersion;
  lodCellCounts: { near: number; middle: number; far: number };
  hydrology: {
    networkCount: number;
    basinCount: number;
    riverCellCount: number;
    lakeCellCount: number;
    riverSegmentCount: number;
    outletCount: number;
    maxUphillWaterStep: number;
    protectedWaterCellCount: number;
    waterSurfaceArea: number;
    terrainSurfaceArea: number;
  };
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
  options: { environmentStyle?: TerrainEnvironmentStyle; worldSeed?: string; terrainGenerationVersion?: TerrainGenerationVersion } = {},
): MergedGeometryData {
  const extent = villageExtent(placements, roads, additionalPads);
  const outerX = Math.max(Math.abs(extent.minX), Math.abs(extent.maxX)) + 9;
  const outerZ = Math.max(Math.abs(extent.minZ), Math.abs(extent.maxZ)) + 9;
  // Keep the island round while enclosing every accepted building footprint.
  const radius = Math.max(26, minimumRadius?.x ?? 0, minimumRadius?.z ?? 0, Math.hypot(outerX, outerZ));
  const natural = options.environmentStyle === "natural-valley";
  const worldSeed = options.worldSeed ?? "world-default";
  const seedHash = stableHash(worldSeed);
  const terrainGenerationVersion = options.terrainGenerationVersion ?? 4;
  if (natural && (terrainGenerationVersion === 2 || terrainGenerationVersion === 3 || terrainGenerationVersion === 4)) {
    return createNaturalTerrainDataV2(placements, roads, additionalPads, radius, seedHash, terrainGenerationVersion);
  }
  const cells = new Map<string, number>();
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
    terrainGenerationVersion,
    lodCellCounts: { near: cells.size, middle: 0, far: 0 },
    hydrology: {
      networkCount: natural && indicesByMaterial.water.length > 0 ? 1 : 0,
      basinCount: natural && indicesByMaterial.water.length > 0 ? 2 : 0,
      riverCellCount: natural ? waterCells.size : 0,
      lakeCellCount: natural ? waterCells.size : 0,
      riverSegmentCount: 0,
      outletCount: natural && indicesByMaterial.water.length > 0 ? 1 : 0,
      maxUphillWaterStep: 0,
      protectedWaterCellCount: 0,
      waterSurfaceArea: waterCells.size * cellSize * cellSize,
      terrainSurfaceArea: cells.size * cellSize * cellSize,
    },
  };
}

interface V2SupportRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

interface V2SupportContext {
  rects: readonly V2SupportRect[];
  roadBuckets: ReadonlyMap<string, readonly RoadCell[]>;
}

interface V2HydrologyPoint {
  x: number;
  z: number;
  height: number;
}

interface V2HydrologyLake extends V2HydrologyPoint {
  radiusX: number;
  radiusZ: number;
  angle: number;
  waterLevel: number;
}

interface V2HydrologyRiver {
  points: readonly V2HydrologyPoint[];
  width: number;
}

interface V2Hydrology {
  lakes: readonly V2HydrologyLake[];
  rivers: readonly V2HydrologyRiver[];
}

interface V3HydrologyCell extends V2HydrologyPoint {
  key: string;
  gx: number;
  gz: number;
  moisture: number;
  protectedInfluence: number;
  filledHeight: number;
  downstreamKey: string | null;
  accumulation: number;
}

interface V3HydrologyLake {
  id: number;
  cells: ReadonlySet<string>;
  waterLevel: number;
  centerX: number;
  centerZ: number;
  area: number;
}

interface V3RiverSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  waterLevel1: number;
  waterLevel2: number;
  width1: number;
  width2: number;
  chainId: number;
}

interface V3Hydrology {
  generationVersion: 3 | 4;
  seedHash: number;
  step: number;
  extent: number;
  cells: ReadonlyMap<string, V3HydrologyCell>;
  lakes: readonly V3HydrologyLake[];
  lakeByCell: ReadonlyMap<string, V3HydrologyLake>;
  segments: readonly V3RiverSegment[];
  segmentBuckets: ReadonlyMap<string, readonly number[]>;
  networkCount: number;
  outletCount: number;
  maxUphillWaterStep: number;
}

interface V2TerrainSample {
  height: number;
  material: TerrainMaterial;
  supportInfluence: number;
  moisture: number;
  waterKind: "none" | "river" | "lake";
}

function createNaturalTerrainDataV2(
  placements: readonly VillagePlacement[],
  roads: readonly RoadCell[],
  additionalPads: readonly TerrainPad[],
  coreRadius: number,
  seedHash: number,
  terrainGenerationVersion: 2 | 3 | 4,
): MergedGeometryData {
  const nearExtent = alignTo(Math.max(80, coreRadius + 28), 8);
  const middleExtent = alignTo(Math.max(160, nearExtent + 64), 8);
  // The camera can see well beyond the settlement framing box on tall mobile
  // viewports. Keep the far envelope outside that frustum so the square LOD
  // boundary never becomes the visual horizon.
  const farExtent = alignTo(Math.max(720, middleExtent + 80, coreRadius * 4.5), 16);
  const support = createV2SupportContext(placements, roads, additionalPads);
  const hydrologyExtent = Math.min(farExtent, 560);
  const hydrologyV2 = terrainGenerationVersion === 2 ? createV2Hydrology(hydrologyExtent, seedHash, support) : null;
  const hydrologyV3 = terrainGenerationVersion === 3 || terrainGenerationVersion === 4
    ? createV3Hydrology(hydrologyExtent, seedHash, support, terrainGenerationVersion)
    : null;
  const positions: number[] = [];
  const indicesByMaterial: Record<TerrainMaterial, number[]> = { grass: [], dirt: [], stone: [], water: [] };
  const naturalTrees: NaturalTreePlacement[] = [];
  const lodCellCounts = { near: 0, middle: 0, far: 0 };
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let riverCellCount = 0;
  let lakeCellCount = 0;
  let protectedWaterCellCount = 0;
  let waterSurfaceArea = 0;
  let terrainSurfaceArea = 0;
  const sampleCache = new Map<string, V2TerrainSample>();
  const landSampleCache = new Map<string, V2TerrainSample>();
  const cellSampleCache = new Map<string, V2TerrainSample>();

  const sampleAt = (x: number, z: number): V2TerrainSample => {
    const key = `${x}:${z}`;
    const cached = sampleCache.get(key);
    if (cached) return cached;
    const sample = hydrologyV3
      ? sampleNaturalTerrainV3(x, z, seedHash, support, hydrologyV3)
      : sampleNaturalTerrainV2(x, z, seedHash, support, hydrologyV2!);
    sampleCache.set(key, sample);
    return sample;
  };

  const sampleLandAt = (x: number, z: number): V2TerrainSample => {
    const key = `${x}:${z}`;
    const cached = landSampleCache.get(key);
    if (cached) return cached;
    const sample = sampleNaturalTerrainV3(x, z, seedHash, support, hydrologyV3!, false);
    landSampleCache.set(key, sample);
    return sample;
  };

  const sampleCellAt = (x: number, z: number, size: number): V2TerrainSample => {
    if (terrainGenerationVersion !== 4 || size < 8) return sampleAt(x, z);
    const key = `${x}:${z}:${size}`;
    const cached = cellSampleCache.get(key);
    if (cached) return cached;
    const center = sampleAt(x, z);
    if (center.waterKind === "none") {
      cellSampleCache.set(key, center);
      return center;
    }
    let matchingWaterSamples = 0;
    const offset = size * 0.3;
    for (const dx of [-offset, 0, offset]) {
      for (const dz of [-offset, 0, offset]) {
        if (sampleAt(x + dx, z + dz).waterKind === center.waterKind) matchingWaterSamples += 1;
      }
    }
    const requiredCoverage = center.waterKind === "lake" ? 5 : 2;
    const sample = matchingWaterSamples >= requiredCoverage ? center : sampleLandAt(x, z);
    cellSampleCache.set(key, sample);
    return sample;
  };

  const addQuad = (vertices: readonly number[], material: TerrainMaterial): void => {
    const start = positions.length / 3;
    positions.push(...vertices);
    indicesByMaterial[material].push(start, start + 1, start + 2, start, start + 2, start + 3);
  };

  const addCell = (x: number, z: number, size: number, lod: keyof typeof lodCellCounts): void => {
    const sample = sampleCellAt(x, z, size);
    const half = size / 2;
    const top = sample.height - (sample.material === "water" ? 0.34 : 0.5);
    addQuad([
      x - half, top, z - half, x - half, top, z + half,
      x + half, top, z + half, x + half, top, z - half,
    ], sample.material);
    // Neighbors must be sampled at THEIR ring's cell size: sampling a ring
    // boundary neighbor with this cell's size hides real steps and leaves a
    // sky-visible slit between the two rings.
    const neighborAt = (neighborX: number, neighborZ: number) => {
      const insideNear = Math.abs(neighborX) <= nearExtent && Math.abs(neighborZ) <= nearExtent;
      const insideMiddle = Math.abs(neighborX) <= middleExtent && Math.abs(neighborZ) <= middleExtent;
      const neighborSize = insideNear ? 2 : insideMiddle ? 4 : 16;
      return sampleCellAt(neighborX, neighborZ, neighborSize);
    };
    addV2CellSide(x, z, size, sample, -1, 0, neighborAt, addQuad);
    addV2CellSide(x, z, size, sample, 1, 0, neighborAt, addQuad);
    addV2CellSide(x, z, size, sample, 0, -1, neighborAt, addQuad);
    addV2CellSide(x, z, size, sample, 0, 1, neighborAt, addQuad);
    lodCellCounts[lod] += 1;
    terrainSurfaceArea += size * size;
    minHeight = Math.min(minHeight, sample.height);
    maxHeight = Math.max(maxHeight, sample.height);
    if (sample.waterKind === "river") riverCellCount += 1;
    if (sample.waterKind === "lake") lakeCellCount += 1;
    if (sample.waterKind !== "none") waterSurfaceArea += size * size;
    if (sample.waterKind !== "none" && sample.supportInfluence >= 0.28) protectedWaterCellCount += 1;
    if (size <= 4 && sample.material === "grass" && sample.supportInfluence < 0.18 && sample.moisture > 0.06) {
      const treeHash = hash2d(seedHash, 0x771, Math.round(x), Math.round(z));
      const density = size === 2 ? 27 : 58;
      if (treeHash % 1000 < density && sample.height < 19) {
        naturalTrees.push({ x, y: sample.height - 0.45, z, scale: 0.82 + (treeHash % 41) / 100 });
      }
    }
  };

  addV2LodSquare(nearExtent, 0, 2, (x, z) => addCell(x, z, 2, "near"));
  addV2LodSquare(middleExtent, nearExtent, 4, (x, z) => addCell(x, z, 4, "middle"));
  addV2LodSquare(farExtent, middleExtent, 16, (x, z) => addCell(x, z, 16, "far"));

  const indexCount = Object.values(indicesByMaterial).reduce((sum, indices) => sum + indices.length, 0);
  return {
    positions,
    indicesByMaterial,
    cellCount: lodCellCounts.near + lodCellCounts.middle + lodCellCounts.far,
    triangleCount: indexCount / 3,
    bounds: { minX: -farExtent, maxX: farExtent, minY: minHeight - 0.5, maxY: maxHeight + 0.5, minZ: -farExtent, maxZ: farExtent },
    framingBounds: { minX: -coreRadius, maxX: coreRadius, minZ: -coreRadius, maxZ: coreRadius },
    naturalTrees,
    terrainGenerationVersion,
    lodCellCounts,
    hydrology: {
      networkCount: hydrologyV3?.networkCount ?? hydrologyV2!.rivers.length,
      basinCount: hydrologyV3?.lakes.length ?? hydrologyV2!.lakes.length,
      riverCellCount,
      lakeCellCount,
      riverSegmentCount: hydrologyV3?.segments.length ?? hydrologyV2!.rivers.reduce((sum, river) => sum + Math.max(0, river.points.length - 1), 0),
      outletCount: hydrologyV3?.outletCount ?? hydrologyV2!.rivers.length,
      maxUphillWaterStep: hydrologyV3?.maxUphillWaterStep ?? 0,
      protectedWaterCellCount,
      waterSurfaceArea,
      terrainSurfaceArea,
    },
  };
}

function addV2LodSquare(extent: number, innerExtent: number, cellSize: number, add: (x: number, z: number) => void): void {
  const start = -extent + cellSize / 2;
  for (let x = start; x < extent; x += cellSize) {
    for (let z = start; z < extent; z += cellSize) {
      if (innerExtent > 0 && Math.abs(x) < innerExtent && Math.abs(z) < innerExtent) continue;
      add(x, z);
    }
  }
}

function addV2CellSide(
  x: number,
  z: number,
  cellSize: number,
  sample: V2TerrainSample,
  dx: number,
  dz: number,
  sampleAt: (x: number, z: number) => V2TerrainSample,
  addQuad: (vertices: readonly number[], material: TerrainMaterial) => void,
): void {
  const neighbor = sampleAt(x + dx * cellSize, z + dz * cellSize);
  // Water surfaces sit 0.16 above land tops; side faces must start at the actual
  // surface height so the shoreline never leaves a sky-visible slit.
  const top = sample.height - (sample.material === "water" ? 0.34 : 0.5);
  const bottom = neighbor.height - 0.5;
  if (bottom >= top - 0.01) return;
  const half = cellSize / 2;
  const material: TerrainMaterial = top > 12 ? "stone" : "dirt";
  if (dx < 0) addQuad([x - half, bottom, z + half, x - half, top, z + half, x - half, top, z - half, x - half, bottom, z - half], material);
  else if (dx > 0) addQuad([x + half, bottom, z - half, x + half, top, z - half, x + half, top, z + half, x + half, bottom, z + half], material);
  else if (dz < 0) addQuad([x - half, bottom, z - half, x - half, top, z - half, x + half, top, z - half, x + half, bottom, z - half], material);
  else addQuad([x + half, bottom, z + half, x + half, top, z + half, x - half, top, z + half, x - half, bottom, z + half], material);
}

function sampleNaturalTerrainV2(
  x: number,
  z: number,
  seedHash: number,
  support: V2SupportContext,
  hydrology: V2Hydrology,
): V2TerrainSample {
  const macro = sampleV2MacroTerrain(x, z, seedHash);
  const supported = sampleV2Support(x, z, support);
  const maximumSupportedHeight = supported.height + Math.pow(1 - supported.influence, 0.78) * 26;
  let height = supported.influence >= 0.995
    ? supported.height
    : Math.round(Math.min(macro.height, maximumSupportedHeight));
  let material: TerrainMaterial = macro.rocky && supported.influence < 0.2 ? "stone" : "grass";
  let waterKind: V2TerrainSample["waterKind"] = "none";
  if (supported.influence < 0.28) {
    const water = sampleV2Hydrology(x, z, height, seedHash, hydrology);
    if (water.kind !== "none") {
      height = water.height;
      material = water.material;
      waterKind = water.kind;
    }
  }
  return { height, material, supportInfluence: supported.influence, moisture: macro.moisture, waterKind };
}

function sampleNaturalTerrainV3(
  x: number,
  z: number,
  seedHash: number,
  support: V2SupportContext,
  hydrology: V3Hydrology,
  includeWater = true,
): V2TerrainSample {
  const macro = sampleV2MacroTerrain(x, z, seedHash, hydrology.generationVersion);
  const supported = sampleV2Support(x, z, support);
  const maximumSupportedHeight = supported.height + Math.pow(1 - supported.influence, 0.78)
    * (hydrology.generationVersion === 4 ? 48 : 26);
  let height = supported.influence >= 0.995
    ? supported.height
    : Math.round(Math.min(macro.height, maximumSupportedHeight));
  let material: TerrainMaterial = macro.rocky && supported.influence < 0.2 ? "stone" : "grass";
  let waterKind: V2TerrainSample["waterKind"] = "none";
  if (includeWater && supported.influence < 0.28) {
    const water = sampleV3Hydrology(x, z, height, hydrology);
    if (water.kind !== "none") {
      height = water.height;
      material = water.material;
      waterKind = water.kind;
    }
  }
  return { height, material, supportInfluence: supported.influence, moisture: macro.moisture, waterKind };
}

function sampleV2MacroTerrain(x: number, z: number, seedHash: number, generationVersion: 2 | 3 | 4 = 3): { height: number; moisture: number; rocky: boolean } {
  const warpX = fractalNoise(x * 0.0048, z * 0.0048, seedHash, 0x121) * 38;
  const warpZ = fractalNoise(x * 0.0048, z * 0.0048, seedHash, 0x131) * 38;
  const px = x + warpX;
  const pz = z + warpZ;
  const continentalness = fractalNoise(px * 0.0046, pz * 0.0046, seedHash, 0x141);
  const erosion = fractalNoise(px * 0.0095, pz * 0.0095, seedHash, 0x151);
  const ridgeNoise = fractalNoise(px * 0.0085, pz * 0.0085, seedHash, 0x161);
  const ridge = Math.pow(1 - Math.abs(ridgeNoise), 2.15);
  const hills = fractalNoise(px * 0.016, pz * 0.016, seedHash, 0x171);
  const detail = fractalNoise(px * 0.044, pz * 0.044, seedHash, 0x181);
  const moisture = fractalNoise(px * 0.011, pz * 0.011, seedHash, 0x191);
  const base = splineRemap(continentalness, [
    [-1, 0], [-0.58, 0.5], [-0.18, 2.2], [0.24, 4.2], [0.58, 6.8], [1, 8.5],
  ]);
  const mountainMask = smoothstep(-0.2, 0.46, continentalness - erosion * 0.28);
  const mountain = ridge * mountainMask * (generationVersion === 4
    ? 18 + Math.max(0, -erosion) * 15
    : 13 + Math.max(0, -erosion) * 10);
  const chainNoise = fractalNoise(px * 0.0042 + pz * 0.0016, pz * 0.012 - px * 0.0011, seedHash, 0x1a1);
  const chainRidge = Math.pow(1 - Math.abs(chainNoise), 2.35);
  const chainMask = smoothstep(0.04, 0.56, continentalness - erosion * 0.22);
  const mountainChain = generationVersion === 4 ? chainRidge * chainMask * (8 + ridge * 11) : 0;
  const peakSignal = smoothstep(0.48, 0.82, Math.max(ridge, chainRidge));
  const highPeaks = generationVersion === 4
    ? Math.pow(peakSignal, 1.35) * chainMask * (18 + mountainMask * 9 + Math.max(0, -erosion) * 7)
    : 0;
  const rolling = smoothstep(-0.7, 0.22, continentalness) * (hills + 1) * 1.55;
  const valley = smoothstep(0.12, 0.76, erosion) * (2.4 + ridge * 1.5);
  const rawHeight = base + mountain + mountainChain + highPeaks + rolling - valley + detail * 0.35;
  const shapedHeight = generationVersion === 4 && rawHeight > 34
    ? 34 + Math.tanh((rawHeight - 34) / 14) * 13
    : rawHeight;
  const maximumHeight = generationVersion === 4 ? 48 : 25;
  const height = Math.max(0, Math.min(maximumHeight, Math.round(shapedHeight)));
  const rockyHeight = generationVersion === 4 ? 22 : 17;
  return { height, moisture, rocky: height >= rockyHeight && (ridge > 0.48 || chainRidge > 0.58 || moisture < -0.2) };
}

function splineRemap(value: number, points: readonly (readonly [number, number])[]): number {
  if (value <= points[0]![0]) return points[0]![1];
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]!;
    const right = points[index]!;
    if (value > right[0]) continue;
    const alpha = smoothstep(left[0], right[0], value);
    return left[1] + (right[1] - left[1]) * alpha;
  }
  return points[points.length - 1]![1];
}

function createV2SupportContext(
  placements: readonly VillagePlacement[],
  roads: readonly RoadCell[],
  additionalPads: readonly TerrainPad[],
): V2SupportContext {
  const rects: V2SupportRect[] = placements.map((placement) => ({
    minX: placement.worldPosition.x - placement.footprint.width / 2 - 2,
    maxX: placement.worldPosition.x + placement.footprint.width / 2 + 2,
    minZ: placement.worldPosition.z - placement.footprint.depth / 2 - 2,
    maxZ: placement.worldPosition.z + placement.footprint.depth / 2 + 2,
    height: placement.worldPosition.y,
  }));
  rects.push(...additionalPads.map((pad) => ({
    minX: pad.x - pad.width / 2 - 2,
    maxX: pad.x + pad.width / 2 + 2,
    minZ: pad.z - pad.depth / 2 - 2,
    maxZ: pad.z + pad.depth / 2 + 2,
    height: pad.groundLevel,
  })));
  const roadBuckets = new Map<string, RoadCell[]>();
  for (const road of roads) {
    const key = bucketKey(road.x, road.z);
    const bucket = roadBuckets.get(key) ?? [];
    bucket.push(road);
    roadBuckets.set(key, bucket);
  }
  return { rects, roadBuckets };
}

function sampleV2Support(x: number, z: number, context: V2SupportContext): { influence: number; height: number } {
  let influence = 0;
  let height = terrainHeightAt(x, z);
  for (const rect of context.rects) {
    const distance = distanceToRect(x, z, rect);
    if (distance >= 38) continue;
    const candidate = 1 - smoothstep(3, 38, distance);
    if (candidate >= influence) {
      influence = candidate;
      height = rect.height;
    }
  }
  const bucketX = Math.floor(x / 24);
  const bucketZ = Math.floor(z / 24);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const roads = context.roadBuckets.get(`${bucketX + dx}:${bucketZ + dz}`) ?? [];
      for (const road of roads) {
        const distance = Math.hypot(x - road.x, z - road.z);
        if (distance >= 18) continue;
        const candidate = 1 - smoothstep(2, 18, distance);
        if (candidate >= influence) {
          influence = candidate;
          height = terrainHeightAt(road.x, road.z);
        }
      }
    }
  }
  return { influence, height };
}

function distanceToRect(x: number, z: number, rect: V2SupportRect): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

function bucketKey(x: number, z: number): string {
  return `${Math.floor(x / 24)}:${Math.floor(z / 24)}`;
}

function createV2Hydrology(farExtent: number, seedHash: number, support: V2SupportContext): V2Hydrology {
  const step = 8;
  const nodes = new Map<string, V2HydrologyPoint>();
  for (let x = -farExtent + step; x <= farExtent - step; x += step) {
    for (let z = -farExtent + step; z <= farExtent - step; z += step) {
      const macro = sampleV2MacroTerrain(x, z, seedHash);
      nodes.set(`${x}:${z}`, { x, z, height: macro.height });
    }
  }
  const candidates = [...nodes.values()].filter((node) => {
    if (sampleV2Support(node.x, node.z, support).influence > 0.12) return false;
    const neighbors = v2HydrologyNeighbors(node, step, nodes);
    return neighbors.every((neighbor) => neighbor.height >= node.height);
  }).sort((left, right) => left.height - right.height
    || (hash2d(seedHash, 0x211, left.x, left.z) - hash2d(seedHash, 0x211, right.x, right.z)));
  const basinNodes = chooseSeparatedV2(candidates.length > 0 ? candidates : [...nodes.values()].sort((a, b) => a.height - b.height), 2, 72);
  const lakes: V2HydrologyLake[] = basinNodes.map((node, index) => ({
    ...node,
    radiusX: 14 + hash2d(seedHash, 0x221 + index, node.x, node.z) % 12,
    radiusZ: 10 + hash2d(seedHash, 0x231 + index, node.x, node.z) % 10,
    angle: (hash2d(seedHash, 0x241 + index, node.x, node.z) % 628) / 100,
    waterLevel: Math.max(0, Math.min(7, node.height + 1)),
  }));
  const highNodes = [...nodes.values()].filter((node) => node.height >= 9 && sampleV2Support(node.x, node.z, support).influence < 0.08)
    .sort((left, right) => right.height - left.height
      || (hash2d(seedHash, 0x231, left.x, left.z) - hash2d(seedHash, 0x231, right.x, right.z)));
  const sources = chooseSeparatedV2(highNodes, 2, 96);
  const rivers: V2HydrologyRiver[] = [];
  sources.forEach((source, index) => {
    const target = nearestV2Point(source, lakes.length > 0 ? lakes : [...nodes.values()].slice(0, 1));
    if (!target) return;
    const points = traceV2River(source, target, step, nodes, support, seedHash, index);
    if (points.length >= 3) rivers.push({ points, width: index === 0 ? 3 : 2.2 });
  });
  const primaryLake = lakes[0];
  if (primaryLake) {
    const boundary = [...nodes.values()].filter((node) => Math.abs(node.x) >= farExtent - step * 2 || Math.abs(node.z) >= farExtent - step * 2)
      .sort((left, right) => left.height - right.height
        || Math.hypot(left.x - primaryLake.x, left.z - primaryLake.z) - Math.hypot(right.x - primaryLake.x, right.z - primaryLake.z))[0];
    if (boundary) {
      const outlet = traceV2River(primaryLake, boundary, step, nodes, support, seedHash, 0x2f1);
      if (outlet.length >= 3) rivers.push({ points: outlet, width: 2.6 });
    }
  }
  return { lakes, rivers };
}

function createV3Hydrology(farExtent: number, seedHash: number, support: V2SupportContext, generationVersion: 3 | 4): V3Hydrology {
  const step = 8;
  const extent = alignTo(farExtent, step);
  const minimum = -extent + step;
  const maximum = extent - step;
  const cells = new Map<string, V3HydrologyCell>();
  let gx = 0;
  for (let x = minimum; x <= maximum; x += step, gx += 1) {
    let gz = 0;
    for (let z = minimum; z <= maximum; z += step, gz += 1) {
      const macro = sampleV2MacroTerrain(x, z, seedHash, generationVersion);
      const protectedInfluence = sampleV2Support(x, z, support).influence;
      const key = v3GridKey(gx, gz);
      cells.set(key, {
        key, gx, gz, x, z, height: macro.height,
        moisture: v3PlateMoisture(x, z, seedHash, macro.moisture),
        protectedInfluence,
        filledHeight: Number.POSITIVE_INFINITY,
        downstreamKey: null,
        accumulation: 0,
      });
    }
  }

  const queue = new V3MinQueue();
  const queued = new Set<string>();
  for (const cell of cells.values()) {
    if (cell.x !== minimum && cell.x !== maximum && cell.z !== minimum && cell.z !== maximum) continue;
    cell.filledHeight = v3DrainElevation(cell);
    queue.push({ key: cell.key, height: cell.filledHeight, tie: hash2d(seedHash, 0x401, cell.gx, cell.gz) });
    queued.add(cell.key);
  }
  while (queue.size > 0) {
    const item = queue.pop()!;
    const current = cells.get(item.key)!;
    for (const neighbor of v3HydrologyNeighbors(current, cells)) {
      if (queued.has(neighbor.key)) continue;
      queued.add(neighbor.key);
      neighbor.filledHeight = Math.max(v3DrainElevation(neighbor), current.filledHeight + 0.001);
      neighbor.downstreamKey = current.key;
      queue.push({ key: neighbor.key, height: neighbor.filledHeight, tie: hash2d(seedHash, 0x401, neighbor.gx, neighbor.gz) });
    }
  }

  for (const cell of cells.values()) {
    if (cell.protectedInfluence >= 0.12) {
      cell.accumulation = 0;
      continue;
    }
    const wetness = Math.max(0, Math.min(1, (cell.moisture + 1) / 2));
    cell.accumulation = 0.35 + wetness * 1.65;
  }
  const drainageOrder = [...cells.values()].sort((left, right) => right.filledHeight - left.filledHeight
    || hash2d(seedHash, 0x411, left.gx, left.gz) - hash2d(seedHash, 0x411, right.gx, right.gz));
  for (const cell of drainageOrder) {
    if (!cell.downstreamKey || cell.accumulation <= 0) continue;
    const downstream = cells.get(cell.downstreamKey)!;
    downstream.accumulation += cell.accumulation;
  }

  const lakeComponents = v3LakeComponents(cells, seedHash, generationVersion);
  const lakes: V3HydrologyLake[] = [];
  const lakeByCell = new Map<string, V3HydrologyLake>();
  for (const component of lakeComponents) {
    if (lakes.length >= (generationVersion === 4 ? 2 : 3)) break;
    if (lakes.some((lake) => Math.hypot(lake.centerX - component.centerX, lake.centerZ - component.centerZ) < 72)) continue;
    const lake: V3HydrologyLake = { ...component, id: lakes.length };
    lakes.push(lake);
    for (const key of lake.cells) lakeByCell.set(key, lake);
  }

  const minimumAccumulation = generationVersion === 4 ? 32 : 24;
  const channelCells = new Set([...cells.values()].filter((cell) => (
    cell.accumulation >= minimumAccumulation
    && cell.protectedInfluence < 0.08
    && !lakeByCell.has(cell.key)
    && (cell.moisture > -0.58 || cell.accumulation >= minimumAccumulation * 4)
  )).map((cell) => cell.key));
  const outletMemo = new Map<string, string>();
  const grouped = new Map<string, V3HydrologyCell[]>();
  for (const key of channelCells) {
    const cell = cells.get(key)!;
    const downstream = cell.downstreamKey ? cells.get(cell.downstreamKey) : undefined;
    if (!downstream || downstream.protectedInfluence >= 0.18) continue;
    const outlet = v3OutletKey(cell, cells, lakeByCell, outletMemo);
    const group = grouped.get(outlet) ?? [];
    group.push(cell);
    grouped.set(outlet, group);
  }
  const selectedNetworks = [...grouped.entries()]
    .filter(([, members]) => members.length >= (generationVersion === 4 ? 4 : 3))
    .sort((left, right) => Math.max(...right[1].map((cell) => cell.accumulation)) - Math.max(...left[1].map((cell) => cell.accumulation))
      || left[0].localeCompare(right[0]))
    .slice(0, generationVersion === 4 ? 4 : 5);
  const segments: V3RiverSegment[] = [];
  selectedNetworks.forEach(([, members], chainId) => {
    const memberKeys = new Set(members.map((cell) => cell.key));
    for (const cell of members) {
      const downstream = cell.downstreamKey ? cells.get(cell.downstreamKey) : undefined;
      if (!downstream || downstream.protectedInfluence >= 0.18) continue;
      if (!memberKeys.has(downstream.key) && !lakeByCell.has(downstream.key) && downstream.accumulation < minimumAccumulation) continue;
      segments.push(v3RiverSegment(cell, downstream, chainId, minimumAccumulation, seedHash, lakeByCell));
    }
  });
  if (segments.length === 0) {
    const fallback = [...cells.values()].filter((cell) => cell.protectedInfluence < 0.08 && !lakeByCell.has(cell.key))
      .sort((left, right) => right.accumulation - left.accumulation)[0];
    let current = fallback;
    const seen = new Set<string>();
    while (current?.downstreamKey && segments.length < 96 && !seen.has(current.key)) {
      seen.add(current.key);
      const downstream = cells.get(current.downstreamKey)!;
      if (downstream.protectedInfluence >= 0.18) break;
      segments.push(v3RiverSegment(current, downstream, 0, minimumAccumulation, seedHash, lakeByCell));
      if (lakeByCell.has(downstream.key)) break;
      current = downstream;
    }
  }
  const segmentBuckets = v3SegmentBuckets(segments);
  const networkCount = new Set(segments.map((segment) => segment.chainId)).size;
  return {
    generationVersion, seedHash, step, extent, cells, lakes, lakeByCell, segments, segmentBuckets, networkCount,
    outletCount: networkCount,
    maxUphillWaterStep: segments.reduce((maximum, segment) => Math.max(maximum, segment.waterLevel2 - segment.waterLevel1), 0),
  };
}

function v3DrainElevation(cell: V3HydrologyCell): number {
  return cell.height + cell.protectedInfluence * 48;
}

function v3GridKey(gx: number, gz: number): string {
  return `${gx}:${gz}`;
}

function v3HydrologyNeighbors(cell: V3HydrologyCell, cells: ReadonlyMap<string, V3HydrologyCell>): V3HydrologyCell[] {
  const result: V3HydrologyCell[] = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (dx === 0 && dz === 0) continue;
      const neighbor = cells.get(v3GridKey(cell.gx + dx, cell.gz + dz));
      if (neighbor) result.push(neighbor);
    }
  }
  return result;
}

function v3PlateMoisture(x: number, z: number, seedHash: number, baseMoisture: number): number {
  const scale = 192;
  const baseX = Math.floor(x / scale);
  const baseZ = Math.floor(z / scale);
  let nearestDistance = Number.POSITIVE_INFINITY;
  let plateMoisture = 0;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const px = baseX + dx;
      const pz = baseZ + dz;
      const jitterX = ((hash2d(seedHash, 0x421, px, pz) / 0xffffffff) - 0.5) * scale * 0.58;
      const jitterZ = ((hash2d(seedHash, 0x422, px, pz) / 0xffffffff) - 0.5) * scale * 0.58;
      const centerX = (px + 0.5) * scale + jitterX;
      const centerZ = (pz + 0.5) * scale + jitterZ;
      const distance = Math.hypot(x - centerX, z - centerZ);
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      plateMoisture = (hash2d(seedHash, 0x423, px, pz) / 0xffffffff) * 2 - 1;
    }
  }
  return Math.max(-1, Math.min(1, baseMoisture * 0.74 + plateMoisture * 0.26));
}

function v3LakeComponents(cells: ReadonlyMap<string, V3HydrologyCell>, seedHash: number, generationVersion: 3 | 4): Array<Omit<V3HydrologyLake, "id">> {
  const minimumDepth = generationVersion === 4 ? 1.25 : 0.9;
  const minimumMoisture = generationVersion === 4 ? -0.32 : -0.48;
  const minimumComponentSize = generationVersion === 4 ? 4 : 3;
  const candidates = new Set([...cells.values()].filter((cell) => (
    cell.filledHeight - v3DrainElevation(cell) >= minimumDepth
    && cell.protectedInfluence < 0.08
    && cell.moisture > minimumMoisture
  )).map((cell) => cell.key));
  const components: Array<{ members: V3HydrologyCell[]; score: number }> = [];
  while (candidates.size > 0) {
    const firstKey = candidates.values().next().value as string;
    candidates.delete(firstKey);
    const queue = [cells.get(firstKey)!];
    const members: V3HydrologyCell[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      members.push(current);
      for (const neighbor of v3HydrologyNeighbors(current, cells)) {
        if (!candidates.delete(neighbor.key)) continue;
        queue.push(neighbor);
      }
    }
    if (members.length < minimumComponentSize) continue;
    const wetness = members.reduce((sum, cell) => sum + cell.moisture, 0) / members.length;
    components.push({ members, score: Math.min(180, members.length) * (1.2 + wetness * 0.35) });
  }
  if (components.length === 0) {
    const fallback = [...cells.values()].filter((cell) => cell.protectedInfluence < 0.06 && cell.moisture > -0.35)
      .sort((left, right) => left.height - right.height
        || hash2d(seedHash, 0x431, left.gx, left.gz) - hash2d(seedHash, 0x431, right.gx, right.gz))[0];
    if (fallback) components.push({ members: [fallback, ...v3HydrologyNeighbors(fallback, cells).filter((cell) => cell.height <= fallback.height + 1).slice(0, 7)], score: 1 });
  }
  return components.sort((left, right) => right.score - left.score).flatMap(({ members }) => {
    const centerX = members.reduce((sum, cell) => sum + cell.x, 0) / members.length;
    const centerZ = members.reduce((sum, cell) => sum + cell.z, 0) / members.length;
    const ordered = [...members].sort((left, right) => Math.hypot(left.x - centerX, left.z - centerZ) - Math.hypot(right.x - centerX, right.z - centerZ));
    const limited = ordered.slice(0, generationVersion === 4 ? 128 : 160);
    const spill = Math.max(1, Math.min(10, Math.floor(limited.reduce((sum, cell) => sum + cell.filledHeight, 0) / limited.length)));
    const submerged = limited.filter((cell) => cell.height < spill);
    const selected = submerged.length >= minimumComponentSize ? submerged : limited.slice(0, Math.min(8, limited.length));
    if (selected.length < minimumComponentSize) return [];
    return [{
      cells: new Set(selected.map((cell) => cell.key)),
      waterLevel: Math.max(spill, Math.min(...selected.map((cell) => cell.height)) + 1),
      centerX, centerZ,
      area: selected.length * 64,
    }];
  });
}

function v3OutletKey(
  start: V3HydrologyCell,
  cells: ReadonlyMap<string, V3HydrologyCell>,
  lakeByCell: ReadonlyMap<string, V3HydrologyLake>,
  memo: Map<string, string>,
): string {
  const cached = memo.get(start.key);
  if (cached) return cached;
  const path: string[] = [];
  const seen = new Set<string>();
  let current: V3HydrologyCell | undefined = start;
  let outlet = `edge:${start.key}`;
  while (current && !seen.has(current.key)) {
    const known = memo.get(current.key);
    if (known) { outlet = known; break; }
    path.push(current.key);
    seen.add(current.key);
    const lake = lakeByCell.get(current.key);
    if (lake) { outlet = `lake:${lake.id}`; break; }
    if (!current.downstreamKey) { outlet = `edge:${current.key}`; break; }
    current = cells.get(current.downstreamKey);
  }
  for (const key of path) memo.set(key, outlet);
  return outlet;
}

function v3RiverSegment(
  cell: V3HydrologyCell,
  downstream: V3HydrologyCell,
  chainId: number,
  minimumAccumulation: number,
  seedHash: number,
  lakeByCell: ReadonlyMap<string, V3HydrologyLake>,
): V3RiverSegment {
  const start = v3JitteredPoint(cell, seedHash);
  const end = v3JitteredPoint(downstream, seedHash);
  const downstreamLake = lakeByCell.get(downstream.key);
  const rawStart = Math.max(0, Math.min(cell.height - 1, Math.floor(cell.filledHeight) - 1));
  const rawEnd = downstreamLake?.waterLevel ?? Math.max(0, Math.min(downstream.height - 1, Math.floor(downstream.filledHeight) - 1));
  const waterLevel2 = Math.min(rawStart, rawEnd);
  const waterLevel1 = Math.max(waterLevel2, rawStart);
  return {
    x1: start.x, z1: start.z, x2: end.x, z2: end.z,
    waterLevel1, waterLevel2,
    width1: v3RiverWidth(cell.accumulation, minimumAccumulation),
    width2: v3RiverWidth(downstream.accumulation, minimumAccumulation),
    chainId,
  };
}

function v3RiverWidth(accumulation: number, minimumAccumulation: number): number {
  return Math.max(1.45, Math.min(6.4, 1.35 + Math.log2(1 + accumulation / minimumAccumulation) * 0.82));
}

function v3JitteredPoint(cell: V3HydrologyCell, seedHash: number): { x: number; z: number } {
  const amplitude = 1.55;
  return {
    x: cell.x + ((hash2d(seedHash, 0x441, cell.gx, cell.gz) / 0xffffffff) * 2 - 1) * amplitude,
    z: cell.z + ((hash2d(seedHash, 0x442, cell.gx, cell.gz) / 0xffffffff) * 2 - 1) * amplitude,
  };
}

function v3SegmentBuckets(segments: readonly V3RiverSegment[]): ReadonlyMap<string, readonly number[]> {
  const bucketSize = 32;
  const buckets = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    const padding = Math.max(segment.width1, segment.width2) + 5;
    const minX = Math.floor((Math.min(segment.x1, segment.x2) - padding) / bucketSize);
    const maxX = Math.floor((Math.max(segment.x1, segment.x2) + padding) / bucketSize);
    const minZ = Math.floor((Math.min(segment.z1, segment.z2) - padding) / bucketSize);
    const maxZ = Math.floor((Math.max(segment.z1, segment.z2) + padding) / bucketSize);
    for (let bx = minX; bx <= maxX; bx += 1) {
      for (let bz = minZ; bz <= maxZ; bz += 1) {
        const key = `${bx}:${bz}`;
        const bucket = buckets.get(key) ?? [];
        bucket.push(index);
        buckets.set(key, bucket);
      }
    }
  });
  return buckets;
}

interface V3QueueItem { key: string; height: number; tie: number }

class V3MinQueue {
  private readonly items: V3QueueItem[] = [];
  get size(): number { return this.items.length; }
  push(item: V3QueueItem): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (v3QueueBefore(this.items[parent]!, item)) break;
      this.items[index] = this.items[parent]!;
      index = parent;
    }
    this.items[index] = item;
  }
  pop(): V3QueueItem | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last || this.items.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      const next = right < this.items.length && v3QueueBefore(this.items[right]!, this.items[left]!) ? right : left;
      if (v3QueueBefore(last, this.items[next]!)) break;
      this.items[index] = this.items[next]!;
      index = next;
    }
    this.items[index] = last;
    return first;
  }
}

function v3QueueBefore(left: V3QueueItem, right: V3QueueItem): boolean {
  return left.height < right.height || (left.height === right.height && left.tie <= right.tie);
}

function v2HydrologyNeighbors(point: V2HydrologyPoint, step: number, nodes: ReadonlyMap<string, V2HydrologyPoint>): V2HydrologyPoint[] {
  const result: V2HydrologyPoint[] = [];
  for (let dx = -step; dx <= step; dx += step) {
    for (let dz = -step; dz <= step; dz += step) {
      if (dx === 0 && dz === 0) continue;
      const neighbor = nodes.get(`${point.x + dx}:${point.z + dz}`);
      if (neighbor) result.push(neighbor);
    }
  }
  return result;
}

function chooseSeparatedV2(points: readonly V2HydrologyPoint[], count: number, minimumDistance: number): V2HydrologyPoint[] {
  const selected: V2HydrologyPoint[] = [];
  for (const point of points) {
    if (selected.every((other) => Math.hypot(point.x - other.x, point.z - other.z) >= minimumDistance)) selected.push(point);
    if (selected.length >= count) break;
  }
  return selected;
}

function nearestV2Point(source: V2HydrologyPoint, targets: readonly V2HydrologyPoint[]): V2HydrologyPoint | undefined {
  return [...targets].sort((left, right) => Math.hypot(source.x - left.x, source.z - left.z) - Math.hypot(source.x - right.x, source.z - right.z))[0];
}

function traceV2River(
  source: V2HydrologyPoint,
  target: V2HydrologyPoint,
  step: number,
  nodes: ReadonlyMap<string, V2HydrologyPoint>,
  support: V2SupportContext,
  seedHash: number,
  channel: number,
): V2HydrologyPoint[] {
  const path: V2HydrologyPoint[] = [source];
  const visited = new Set<string>([`${source.x}:${source.z}`]);
  let current = source;
  let previous: V2HydrologyPoint | null = null;
  const maximumIterations = Math.max(24, Math.ceil(Math.hypot(source.x - target.x, source.z - target.z) / step) * 3);
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    const currentTargetDistance = Math.hypot(current.x - target.x, current.z - target.z);
    if (currentTargetDistance <= step * 1.5) {
      path.push(target);
      break;
    }
    const next = v2HydrologyNeighbors(current, step, nodes)
      .filter((candidate) => !visited.has(`${candidate.x}:${candidate.z}`))
      .map((candidate) => {
        const uphill = Math.max(0, candidate.height - current.height);
        const targetDistance = Math.hypot(candidate.x - target.x, candidate.z - target.z);
        const supportPenalty = sampleV2Support(candidate.x, candidate.z, support).influence * 62;
        const turnPenalty = previous === null ? 0 : v2TurnPenalty(previous, current, candidate) * 2.4;
        const jitter = (hash2d(seedHash, channel, candidate.x, candidate.z) % 1000) / 1000;
        const backtrackPenalty = Math.max(0, targetDistance - currentTargetDistance) * 12;
        const downhillReward = Math.max(0, current.height - candidate.height) * 0.8;
        return {
          candidate,
          score: targetDistance * 0.82 + uphill * 16 + supportPenalty + turnPenalty
            + backtrackPenalty + jitter * 1.6 - downhillReward,
        };
      })
      .sort((left, right) => left.score - right.score)[0]?.candidate;
    if (!next) break;
    previous = current;
    current = next;
    visited.add(`${current.x}:${current.z}`);
    path.push(current);
  }
  return simplifyV2River(path, step * 0.58);
}

function simplifyV2River(points: readonly V2HydrologyPoint[], tolerance: number): V2HydrologyPoint[] {
  if (points.length <= 2) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let splitIndex = -1;
  let largestDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!;
    const distance = distanceToSegmentV2(point.x, point.z, first.x, first.z, last.x, last.z).distance;
    if (distance <= largestDistance) continue;
    largestDistance = distance;
    splitIndex = index;
  }
  if (largestDistance <= tolerance || splitIndex < 0) return [first, last];
  const left = simplifyV2River(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyV2River(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function v2TurnPenalty(previous: V2HydrologyPoint, current: V2HydrologyPoint, next: V2HydrologyPoint): number {
  const ax = current.x - previous.x;
  const az = current.z - previous.z;
  const bx = next.x - current.x;
  const bz = next.z - current.z;
  const length = Math.max(1, Math.hypot(ax, az) * Math.hypot(bx, bz));
  return 1 - (ax * bx + az * bz) / length;
}

function sampleV3Hydrology(
  x: number,
  z: number,
  baseHeight: number,
  hydrology: V3Hydrology,
): { kind: V2TerrainSample["waterKind"]; height: number; material: TerrainMaterial } {
  const minimum = -hydrology.extent + hydrology.step;
  const gx = Math.round((x - minimum) / hydrology.step);
  const gz = Math.round((z - minimum) / hydrology.step);
  let nearestLake: { distance: number; lake: V3HydrologyLake } | null = null;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const key = v3GridKey(gx + dx, gz + dz);
      const lake = hydrology.lakeByCell.get(key);
      const cell = hydrology.cells.get(key);
      if (!lake || !cell) continue;
      const distance = Math.hypot(x - cell.x, z - cell.z);
      if (!nearestLake || distance < nearestLake.distance) nearestLake = { distance, lake };
    }
  }
  if (nearestLake) {
    const shorelineNoise = hydrology.generationVersion === 4
      ? fractalNoise(x * 0.055, z * 0.055, hydrology.seedHash, 0x451)
      : 0;
    const waterRadius = hydrology.step * (hydrology.generationVersion === 4 ? 0.64 + shorelineNoise * 0.07 : 0.76);
    if (nearestLake.distance <= waterRadius) return { kind: "lake", height: nearestLake.lake.waterLevel, material: "water" };
    const bankRadius = hydrology.generationVersion === 4 ? waterRadius + 4.2 : hydrology.step * 1.24;
    if (nearestLake.distance <= bankRadius) {
      const bank = smoothstep(waterRadius, bankRadius, nearestLake.distance);
      return { kind: "none", height: Math.round((nearestLake.lake.waterLevel + 1) * (1 - bank) + baseHeight * bank), material: "dirt" };
    }
  }

  const bucket = hydrology.segmentBuckets.get(`${Math.floor(x / 32)}:${Math.floor(z / 32)}`) ?? [];
  let nearest: { distance: number; waterLevel: number; width: number } | null = null;
  for (const index of bucket) {
    const segment = hydrology.segments[index]!;
    const distance = distanceToSegmentV2(x, z, segment.x1, segment.z1, segment.x2, segment.z2);
    if (nearest && distance.distance >= nearest.distance) continue;
    nearest = {
      distance: distance.distance,
      waterLevel: segment.waterLevel1 + (segment.waterLevel2 - segment.waterLevel1) * distance.alpha,
      width: segment.width1 + (segment.width2 - segment.width1) * distance.alpha,
    };
  }
  if (!nearest) return { kind: "none", height: baseHeight, material: "grass" };
  const waterLevel = Math.max(0, Math.min(baseHeight, Math.round(nearest.waterLevel)));
  if (nearest.distance <= nearest.width) return { kind: "river", height: waterLevel, material: "water" };
  const bankWidth = 3.8 + Math.min(2.2, nearest.width * 0.35);
  if (nearest.distance <= nearest.width + bankWidth) {
    const bank = smoothstep(nearest.width, nearest.width + bankWidth, nearest.distance);
    return { kind: "none", height: Math.round((waterLevel + 1) * (1 - bank) + baseHeight * bank), material: "dirt" };
  }
  return { kind: "none", height: baseHeight, material: "grass" };
}

function sampleV2Hydrology(
  x: number,
  z: number,
  baseHeight: number,
  seedHash: number,
  hydrology: V2Hydrology,
): { kind: V2TerrainSample["waterKind"]; height: number; material: TerrainMaterial } {
  for (let index = 0; index < hydrology.lakes.length; index += 1) {
    const lake = hydrology.lakes[index]!;
    const dx = x - lake.x;
    const dz = z - lake.z;
    const cosine = Math.cos(lake.angle);
    const sine = Math.sin(lake.angle);
    const rotatedX = dx * cosine - dz * sine;
    const rotatedZ = dx * sine + dz * cosine;
    const distortion = 1 + fractalNoise(x * 0.027, z * 0.027, seedHash, 0x311 + index) * 0.3;
    const ratio = Math.hypot(rotatedX / lake.radiusX, rotatedZ / lake.radiusZ) / Math.max(0.7, distortion);
    if (ratio < 1) return { kind: "lake", height: lake.waterLevel, material: "water" };
    if (ratio < 1.28) {
      const bank = smoothstep(1, 1.28, ratio);
      return { kind: "none", height: Math.round((lake.waterLevel + 1) * (1 - bank) + baseHeight * bank), material: "dirt" };
    }
  }
  let nearest: { distance: number; waterLevel: number; width: number } | null = null;
  for (const river of hydrology.rivers) {
    for (let index = 1; index < river.points.length; index += 1) {
      const left = river.points[index - 1]!;
      const right = river.points[index]!;
      const distance = distanceToSegmentV2(x, z, left.x, left.z, right.x, right.z);
      if (nearest && distance.distance >= nearest.distance) continue;
      const waterLevel = Math.max(0, Math.min(baseHeight, Math.round(left.height + (right.height - left.height) * distance.alpha) - 1));
      nearest = { distance: distance.distance, waterLevel, width: river.width };
    }
  }
  if (!nearest) return { kind: "none", height: baseHeight, material: "grass" };
  if (nearest.distance <= nearest.width) return { kind: "river", height: nearest.waterLevel, material: "water" };
  if (nearest.distance <= nearest.width + 3.5) {
    const bank = smoothstep(nearest.width, nearest.width + 3.5, nearest.distance);
    return { kind: "none", height: Math.round((nearest.waterLevel + 1) * (1 - bank) + baseHeight * bank), material: "dirt" };
  }
  return { kind: "none", height: baseHeight, material: "grass" };
}

function distanceToSegmentV2(
  x: number,
  z: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): { distance: number; alpha: number } {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSquared = dx * dx + dz * dz;
  const alpha = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / lengthSquared));
  return { distance: Math.hypot(x - (x1 + dx * alpha), z - (z1 + dz * alpha)), alpha };
}

function alignTo(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
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
