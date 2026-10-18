import type { VillagePlacement, RoadCell } from "./village";
import { terrainHeightAt } from "./village";
import { createTerrainMeshBuffers } from './terrain-mesh';
import { terrainGenerationProfile, type NaturalValleyTerrainProfile, type OceanIslandTerrainProfile } from './terrain-profile';
import { sampleMosaicTerrain } from './mosaic-terrain';
import { TerrainLineIndex } from './terrain-line-index';
import { blendNearTransition } from './terrain-transition';
import { createValleyBench, valleyBench, islandHill, isletHeight, islandSurface } from './terrain-landforms';

export const TERRAIN_GENERATOR_REVISION = 3;

export const TERRAIN_MATERIALS = ['grass','dirt','stone','water','sand','snow','ice','terracotta'] as const;
export type TerrainMaterial = typeof TERRAIN_MATERIALS[number];
export type TerrainEnvironmentStyle = "natural-valley" | "classic-island" | "ocean-island" | 'mosaic-coast';
export type TerrainGenerationVersion = 4;

export interface NaturalTreePlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
}

export interface MergedGeometryData {
  positions: number[];
  indicesByMaterial: Record<TerrainMaterial, number[]>;
  /** Vertical step faces, separated so the renderer can shade them darker than the sunlit tops. */
  sideIndices: { dirt: number[]; stone: number[] };
  cellCount: number;
  triangleCount: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  framingBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Physical near-cell coverage, independent of camera framing and LOD scale. */
  nearDetailBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  naturalTrees: readonly NaturalTreePlacement[];
  terrainGenerationVersion: TerrainGenerationVersion;
  lodCellCounts: { near: number; middle: number; far: number };
  /** V24 ocean-island: satellite islet discs (center + shore radius), exposed
   * for diagnostics and tests; absent for other environments. */
  oceanIslets?: ReadonlyArray<{ x: number; z: number; radius: number }>;
  /** V24 ocean-island: main island body radius and beach band width, so tests
   * can verify the open-water strait precisely. */
  oceanMain?: { radius: number; beach: number };
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

/** Only spatial inputs affect generated terrain; task progress and block textures do not. */
export function terrainGenerationInputKey(
  placements: readonly VillagePlacement[],
  roads: readonly RoadCell[],
  additionalPads: readonly TerrainPad[],
  minimumRadius: { x: number; z: number } | undefined,
  options: { environmentStyle?: TerrainEnvironmentStyle; worldSeed?: string; terrainGenerationVersion?: TerrainGenerationVersion; refinedFar?: boolean },
): string {
  return JSON.stringify([
    TERRAIN_GENERATOR_REVISION,
    placements.map(({ worldPosition, footprint }) => [
      worldPosition.x, worldPosition.y, worldPosition.z, footprint.width, footprint.depth,
    ]),
    roads.map(({ x, z }) => [x, z]),
    additionalPads.map(({ x, z, width, depth, groundLevel }) => [x, z, width, depth, groundLevel]),
    minimumRadius ? [minimumRadius.x, minimumRadius.z] : null,
    options.environmentStyle ?? "classic-island",
    options.worldSeed ?? "world-default",
    options.terrainGenerationVersion ?? 4,
    options.refinedFar ?? null,
  ]);
}

export function createSteppedTerrainData(
  placements: readonly VillagePlacement[],
  roads: readonly RoadCell[],
  additionalPads: readonly TerrainPad[] = [],
  minimumRadius?: { x: number; z: number },
  options: { environmentStyle?: TerrainEnvironmentStyle; worldSeed?: string; terrainGenerationVersion?: TerrainGenerationVersion; refinedFar?: boolean } = {},
): MergedGeometryData {
  const extent = villageExtent(placements, roads, additionalPads);
  const outerX = Math.max(Math.abs(extent.minX), Math.abs(extent.maxX)) + 9;
  const outerZ = Math.max(Math.abs(extent.minZ), Math.abs(extent.maxZ)) + 9;
  // Keep the island round while enclosing every accepted building footprint.
  const radius = Math.max(26, minimumRadius?.x ?? 0, minimumRadius?.z ?? 0, Math.hypot(outerX, outerZ));
  const worldSeed = options.worldSeed ?? "world-default";
  const seedHash = stableHash(worldSeed);
  const terrainGenerationVersion = options.terrainGenerationVersion ?? 4;
  if (terrainGenerationVersion !== 4) throw new RangeError('Terrain generation requires version 4; migrate saved records before generating.');
  const environmentStyle = options.environmentStyle ?? "classic-island";
  const sharedGroundHeightAt = (x: number, z: number): number => (
    settlementGroundHeightAt(x, z, environmentStyle, placements, additionalPads)
  );
  if (options.environmentStyle === "ocean-island") {
    const profile = terrainGenerationProfile('ocean-island', radius, terrainGenerationVersion);
    return createOceanIslandTerrainData(placements, roads, additionalPads, radius, seedHash, profile as OceanIslandTerrainProfile, sharedGroundHeightAt);
  }
  if (environmentStyle === 'natural-valley' || environmentStyle === 'mosaic-coast') {
    const base = terrainGenerationProfile('natural-valley', radius, 4, options.refinedFar) as NaturalValleyTerrainProfile;
    const align=(n:number)=>Math.ceil(n/16)*16;
    const middle=align(Math.max(base.nearExtent+32,base.middleExtent*.8));
    const profile = options.environmentStyle==='mosaic-coast'?{...base,middleExtent:middle,
      farExtent:align(Math.max(middle+80,base.farExtent*.8)),farFineExtent:align(Math.max(middle,base.farFineExtent*.8))}:base;
    return createRegionalTerrainData(placements, roads, additionalPads, radius, seedHash, profile as NaturalValleyTerrainProfile, sharedGroundHeightAt, environmentStyle === 'mosaic-coast');
  }
  const cells = new Map<string, number>();
  // The outer ring must still cover the farthest supported phone framing. Keep
  // it finite and deterministic so it remains cheap to merge and test.
  const radiusX = radius;
  const radiusZ = radius;
  // A 1x1 mesh is useful close up, but a large circular settlement otherwise
  // consumes an excessive number of independent terrain vertices on mobile.
  const classicProfile = terrainGenerationProfile('classic-island', radius, terrainGenerationVersion);
  const cellSize = classicProfile.kind === 'classic-island' ? classicProfile.cellSize : 1;
  const waterCells = new Set<string>();
  const naturalTrees: NaturalTreePlacement[] = [];
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (let x = -Math.ceil(radiusX); x <= Math.ceil(radiusX); x += cellSize) {
    for (let z = -Math.ceil(radiusZ); z <= Math.ceil(radiusZ); z += cellSize) {
      const normalized = (x / radiusX) ** 2 + (z / radiusZ) ** 2;
      const edgeNoise = ((hash2d(seedHash, 0x11, x, z) % 100) - 50) / 1_500;
      if (normalized + edgeNoise > 1) continue;
      const key = `${x}:${z}`;
      // The shared sampler already applies every pad and building footprint.
      const height = sharedGroundHeightAt(x, z);
      cells.set(key, height);
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
    }
  }

  const { positions, indicesByMaterial, sideIndices, addTop: addQuad, addSide: addSideQuad } = createTerrainMeshBuffers();

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
    const sideStride = 1;
    addExposedSide(x, z, top, -1, 0, cellSize, sideStride, cells, waterCells, addSideQuad);
    addExposedSide(x, z, top, 1, 0, cellSize, sideStride, cells, waterCells, addSideQuad);
    addExposedSide(x, z, top, 0, -1, cellSize, sideStride, cells, waterCells, addSideQuad);
    addExposedSide(x, z, top, 0, 1, cellSize, sideStride, cells, waterCells, addSideQuad);
  }
  closeTerrainCornerSlits(positions, indicesByMaterial, sideIndices);
  const indexCount = Object.values(indicesByMaterial).reduce((sum, indices) => sum + indices.length, 0)
    + sideIndices.dirt.length + sideIndices.stone.length;
  return {
    positions,
    indicesByMaterial,
    sideIndices,
    cellCount: cells.size,
    triangleCount: indexCount / 3,
    bounds: { minX: -radiusX, maxX: radiusX, minY: minHeight - 0.5, maxY: maxHeight + 0.5, minZ: -radiusZ, maxZ: radiusZ },
    framingBounds: { minX: -radiusX, maxX: radiusX, minZ: -radiusZ, maxZ: radiusZ },
    nearDetailBounds: { minX: -radiusX, maxX: radiusX, minZ: -radiusZ, maxZ: radiusZ },
    naturalTrees,
    terrainGenerationVersion,
    lodCellCounts: { near: cells.size, middle: 0, far: 0 },
    hydrology: {
      networkCount: 0,
      basinCount: 0,
      riverCellCount: 0,
      lakeCellCount: 0,
      riverSegmentCount: 0,
      outletCount: 0,
      maxUphillWaterStep: 0,
      protectedWaterCellCount: 0,
      waterSurfaceArea: 0,
      terrainSurfaceArea: cells.size * cellSize * cellSize,
    },
  };
}

interface SupportRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

interface SupportContext {
  bench?: ReturnType<typeof createValleyBench>;
  rects: readonly SupportRect[];
  rectBuckets: ReadonlyMap<string, readonly SupportRect[]> | null;
  roadBuckets: ReadonlyMap<string, readonly RoadCell[]>;
  roadGroundHeightAt: (x: number, z: number) => number;
}

interface HydrologyPoint {
  x: number;
  z: number;
  height: number;
}

interface DrainageCell extends HydrologyPoint {
  key: string;
  gx: number;
  gz: number;
  moisture: number;
  protectedInfluence: number;
  filledHeight: number;
  downstreamKey: string | null;
  accumulation: number;
}

interface DrainageLake {
  id: number;
  cells: ReadonlySet<string>;
  waterLevel: number;
  centerX: number;
  centerZ: number;
  area: number;
}

interface RiverSegment {
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

interface Hydrology {
  seedHash: number;
  step: number;
  extent: number;
  cells: ReadonlyMap<string, DrainageCell>;
  lakes: readonly DrainageLake[];
  lakeByCell: ReadonlyMap<string, DrainageLake>;
  segments: readonly RiverSegment[];
  segmentBuckets: ReadonlyMap<string, readonly number[]>;
  networkCount: number;
  outletCount: number;
  maxUphillWaterStep: number;
}

interface TerrainSample {
  height: number;
  material: TerrainMaterial;
  supportInfluence: number;
  moisture: number;
  waterKind: "none" | "river" | "lake";
  /** V23: 0..1 broad mountain potential (ridge/chain/peak strength). Only the
   * far LOD ring uses it to raise coherent big mountains; absent elsewhere. */
  mountainSignal?: number;
}

function createRegionalTerrainData(
  placements: readonly VillagePlacement[],
  roads: readonly RoadCell[],
  additionalPads: readonly TerrainPad[],
  coreRadius: number,
  seedHash: number,
  profile: NaturalValleyTerrainProfile,
  roadGroundHeightAt: (x: number, z: number) => number = terrainHeightAt,
  mosaic = false,
): MergedGeometryData {
  const { nearExtent, middleExtent, farExtent, farFineExtent, refinedFar, farCellSize } = profile;
  // Every ring boundary must land exactly on the next ring's cell lattice or
  // the rings overlap (far cells intruding into the middle square leave
  // interior steps whose sides nobody builds — the reported boundary rows of
  // white faces at whatever extent a large settlement pushes the rings to).
  // Near cells are odd-centered (edges on multiples of 2, so nearExtent
  // aligns to 8), middle cells are 2 mod 4 (edges on multiples of 4), and far
  // cells are 8 mod 16 (edges on multiples of 16) — the middle extent must
  // therefore be a multiple of 16 and the near extent a multiple of 4/8.
  // The camera can see well beyond the settlement framing box on tall mobile
  // viewports. Keep the far envelope outside that frustum so the square LOD
  // boundary never becomes the visual horizon.
  // The visible far band continues the middle ring's 4-unit lattice. Making
  // distant cells finer than the middle ring multiplied geometry without
  // improving the zoomed-out composition. Beyond this band, v4 uses 8-unit
  // cells for ordinary-sized worlds. Wide imported worlds keep a bounded
  // 16-unit skirt.
  const support = createSupportContext(placements, roads, additionalPads, roadGroundHeightAt);
  const hydrologyExtent = Math.min(farExtent, 560);
  const hydrology = !mosaic
    ? createHydrology(hydrologyExtent, seedHash, support)
    : null;
  if (!mosaic) support.bench = createValleyBench(support.rects, roads, support.roadGroundHeightAt);
  const { positions, indicesByMaterial, sideIndices, addTop: addQuad, addSide: addSideQuad } = createTerrainMeshBuffers();
  const naturalTrees: NaturalTreePlacement[] = [];
  const lodCellCounts = { near: 0, middle: 0, far: 0 };
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let riverCellCount = 0;
  let lakeCellCount = 0;
  let protectedWaterCellCount = 0;
  let waterSurfaceArea = 0;
  let terrainSurfaceArea = 0;
  const sampleCache = new Map<string, TerrainSample>();
  const landSampleCache = new Map<string, TerrainSample>();
  const cellSampleCache = new Map<string, TerrainSample>();

  // Relief belongs to the world position, not the resolution of its mesh.
  // The old coarse-only lift began at a circular distance while the LOD bands
  // are squares: corner cells jumped up by 20 blocks at the coarse boundary.
  const withDistantRelief = (sample: TerrainSample, x: number, z: number): TerrainSample => {
    if (mosaic || sample.waterKind !== 'none' || (sample.mountainSignal ?? 0) <= .02) return sample;
    const distance = Math.max(Math.abs(x), Math.abs(z));
    const envelope = smoothstep(middleExtent, farExtent * .8, distance);
    const lift = envelope * smoothstep(.05, .5, sample.mountainSignal ?? 0) * 22;
    return lift > .001 ? { ...sample, height: Math.round(Math.min(48, sample.height + lift)) } : sample;
  };

  const sampleMosaic = (x:number,z:number):TerrainSample => {
    const generated=sampleMosaicTerrain(x,z,seedHash,coreRadius);
    const supported=sampleSupport(x,z,support),blend=supported.influence;
    // Keep only the actual foundation/road constraints. Mixing the old valley
    // height field back into the whole central radius carved a tall-sided bowl.
    const height=Math.round(generated.height*(1-blend)+supported.height*blend);
    const material=blend>.18?'grass':generated.material;
    return{height,material,supportInfluence:blend,moisture:generated.biome==='badlands'?.02:.6,
      waterKind:material==='water'?'lake':'none'};
  };

  const sampleAt = (x: number, z: number): TerrainSample => {
    const key = `${x}:${z}`;
    const cached = sampleCache.get(key);
    if (cached) return cached;
    const raw = mosaic ? sampleMosaic(x,z) : sampleNaturalTerrain(x, z, seedHash, support, hydrology!);
    const sample = withDistantRelief(raw, x, z);
    sampleCache.set(key, sample);
    return sample;
  };

  const sampleLandAt = (x: number, z: number): TerrainSample => {
    const key = `${x}:${z}`;
    const cached = landSampleCache.get(key);
    if (cached) return cached;
    const sample = mosaic ? sampleMosaic(x,z) : withDistantRelief(sampleNaturalTerrain(x, z, seedHash, support, hydrology!, false), x, z);
    landSampleCache.set(key, sample);
    return sample;
  };

  const sampleCoarseAt = (x: number, z: number, size: number): TerrainSample => {
    const key = `${x}:${z}:${size}`;
    const cached = cellSampleCache.get(key);
    if (cached) return cached;
    // Far LOD cells sample the broad terrain so mountains and
    // water read as coherent big blocks instead of aliased pillars.
    const broad0 = mosaic ? sampleMosaic(x,z) : sampleNaturalTerrain(x, z, seedHash, support, hydrology!, true, true);
    let broad = withDistantRelief(broad0, x, z);
    if (mosaic && broad.waterKind === 'none' && broad.supportInfluence < .18) {
      // Area-sample the same relief field at far resolution. Adjacent rings
      // converge to this datum in the existing boundary band.
      let sum = broad.height * 4, weight = 4;
      for (const dx of [-size*.3, 0, size*.3]) for (const dz of [-size*.3, 0, size*.3]) {
        if (dx === 0 && dz === 0) continue;
        const neighbour = sampleMosaic(x+dx,z+dz);
        if (neighbour.waterKind !== 'none' || neighbour.supportInfluence >= .18) continue;
        if (broad.material === 'sand' && neighbour.material !== 'sand') continue;
        sum += neighbour.height; weight++;
      }
      broad = { ...broad, height: Math.round(sum / weight) };
    }
    if (broad.waterKind === "none") {
      cellSampleCache.set(key, broad);
      return broad;
    }
    let matchingWaterSamples = 0;
    const offset = size * 0.3;
    for (const dx of [-offset, 0, offset]) {
      for (const dz of [-offset, 0, offset]) {
        if (sampleAt(x + dx, z + dz).waterKind === broad.waterKind) matchingWaterSamples += 1;
      }
    }
    const requiredCoverage = broad.waterKind === "lake" ? 5 : 2;
    const sample = matchingWaterSamples >= requiredCoverage ? broad : sampleLandAt(x, z);
    cellSampleCache.set(key, sample);
    return sample;
  };

  const sampleCellAt = (x: number, z: number, size: number): TerrainSample => {
    if (size >= 8) return sampleCoarseAt(x, z, size);
    const raw = sampleAt(x, z);
    const sample = size === 2 ? blendNearTransition(raw, x, z, nearExtent, sampleAt) : raw;
    const boundary = refinedFar ? farFineExtent : middleExtent;
    const weightX = smoothstep(boundary - 32, boundary - size / 2, Math.abs(x));
    const weightZ = smoothstep(boundary - 32, boundary - size / 2, Math.abs(z));
    if ((weightX === 0 && weightZ === 0) || sample.waterKind !== 'none' || sample.supportInfluence >= .18) return sample;
    const key = `${x}:${z}:${size}`;
    const cached = cellSampleCache.get(key);
    if (cached) return cached;
    const snap = (coordinate: number) => Math.floor(coordinate / farCellSize) * farCellSize + farCellSize / 2;
    let heightSum = 0, weights = 0, blend = 0;
    const targets: Array<{ weight: number; height: number }> = [];
    // A short transition band joins each fine border cell to the actual coarse
    // neighbour's datum. At a corner use both edges; never fill a river or move
    // a task foundation just to hide a mesh boundary.
    for (const [weight, cx, cz] of [
      [weightX, Math.sign(x) * (boundary + farCellSize / 2), snap(z)],
      [weightZ, snap(x), Math.sign(z) * (boundary + farCellSize / 2)],
    ] as const) {
      if (weight === 0) continue;
      const neighbour = sampleCoarseAt(cx, cz, farCellSize);
      if (neighbour.waterKind !== 'none') continue;
      targets.push({ weight, height: neighbour.height });
    }
    for (const target of targets) {
      // A cell directly on one border must match that border, even when it is
      // also inside the other edge's transition band. Averaging the two raw
      // weights made a new short wall beside each corner. Only the one corner
      // cell shared by both borders needs to bridge the two different heights.
      const otherWeight = targets.length === 2 ? targets.find(other => other !== target)!.weight : 0;
      const weight = target.weight === 1 && otherWeight === 1 ? 1 : target.weight * (1 - otherWeight);
      heightSum += target.height * weight; weights += weight; blend = Math.max(blend, target.weight);
    }
    const blendedHeight = weights === 0 ? sample.height : Math.round(sample.height * (1 - blend) + heightSum / weights * blend);
    const result = weights === 0 ? sample : { ...sample, height: mosaic && sample.material === 'sand' ? Math.max(1, Math.min(3, blendedHeight)) : blendedHeight };
    cellSampleCache.set(key, result);
    return result;
  };

  const addCell = (x: number, z: number, size: number, lod: keyof typeof lodCellCounts): void => {
    const sample = sampleCellAt(x, z, size);
    const half = size / 2;
    const top = sample.height - (sample.material === "water" ? 0.34 : 0.5);
    addQuad([
      x - half, top, z - half, x - half, top, z + half,
      x + half, top, z + half, x + half, top, z - half,
    ], sample.material);
    // Neighbors must be sampled at THEIR ring's cell size AND at their ring's
    // lattice centers: sampling a ring boundary neighbor at this cell's size or
    // at an off-lattice position hides real steps and leaves a sky-visible slit
    // along the whole boundary line between the two rings.
    addRegionalCellSide(x, z, size, sample, -1, 0, sampleCellAt, nearExtent, middleExtent, farFineExtent, refinedFar, farCellSize, addSideQuad, mosaic);
    addRegionalCellSide(x, z, size, sample, 1, 0, sampleCellAt, nearExtent, middleExtent, farFineExtent, refinedFar, farCellSize, addSideQuad, mosaic);
    addRegionalCellSide(x, z, size, sample, 0, -1, sampleCellAt, nearExtent, middleExtent, farFineExtent, refinedFar, farCellSize, addSideQuad, mosaic);
    addRegionalCellSide(x, z, size, sample, 0, 1, sampleCellAt, nearExtent, middleExtent, farFineExtent, refinedFar, farCellSize, addSideQuad, mosaic);
    lodCellCounts[lod] += 1;
    terrainSurfaceArea += size * size;
    minHeight = Math.min(minHeight, sample.height);
    maxHeight = Math.max(maxHeight, sample.height);
    if (sample.waterKind === "river") riverCellCount += 1;
    if (sample.waterKind === "lake") lakeCellCount += 1;
    if (sample.waterKind !== "none") waterSurfaceArea += size * size;
    if (sample.waterKind !== "none" && sample.supportInfluence >= 0.28) protectedWaterCellCount += 1;
    if (lod !== "far" && size <= 4 && sample.material === "grass" && sample.supportInfluence < 0.18 && sample.moisture > 0.06) {
      const treeHash = hash2d(seedHash, 0x771, Math.round(x), Math.round(z));
      const density = size === 2 ? 27 : 58;
      if (treeHash % 1000 < density && sample.height < 19) {
        naturalTrees.push({ x, y: sample.height - 0.45, z, scale: 0.82 + (treeHash % 41) / 100 });
      }
    }
  };

  addLodSquare(nearExtent, 0, 2, (x, z) => addCell(x, z, 2, "near"));
  addLodSquare(middleExtent, nearExtent, 4, (x, z) => addCell(x, z, 4, "middle"));
  if (refinedFar) addLodSquare(farFineExtent, middleExtent, 4, (x, z) => addCell(x, z, 4, "far"));
  addLodSquare(farExtent, refinedFar ? farFineExtent : middleExtent, farCellSize, (x, z) => addCell(x, z, farCellSize, "far"));

  closeTerrainCornerSlits(positions, indicesByMaterial, sideIndices);

  const indexCount = Object.values(indicesByMaterial).reduce((sum, indices) => sum + indices.length, 0)
    + sideIndices.dirt.length + sideIndices.stone.length;
  return {
    positions,
    indicesByMaterial,
    sideIndices,
    cellCount: lodCellCounts.near + lodCellCounts.middle + lodCellCounts.far,
    triangleCount: indexCount / 3,
    bounds: { minX: -farExtent, maxX: farExtent, minY: minHeight - 0.5, maxY: maxHeight + 0.5, minZ: -farExtent, maxZ: farExtent },
    framingBounds: { minX: -coreRadius, maxX: coreRadius, minZ: -coreRadius, maxZ: coreRadius },
    nearDetailBounds: { minX: -nearExtent, maxX: nearExtent, minZ: -nearExtent, maxZ: nearExtent },
    naturalTrees,
    terrainGenerationVersion: 4,
    lodCellCounts,
    hydrology: {
      networkCount: hydrology?.networkCount ?? 0,
      basinCount: hydrology?.lakes.length ?? 0,
      riverCellCount,
      lakeCellCount,
      riverSegmentCount: hydrology?.segments.length ?? 0,
      outletCount: hydrology?.outletCount ?? 0,
      maxUphillWaterStep: hydrology?.maxUphillWaterStep ?? 0,
      protectedWaterCellCount,
      waterSurfaceArea,
      terrainSurfaceArea,
    },
  };
}

/**
 * V24 ocean-island environment: one seeded main island with an inhabited
 * terrace, offset ridge, bays, rocky headlands and pocket beaches; a set of
 * satellite islets with a guaranteed open-water strait; and open ocean
 * everywhere else. Buildings and roads reuse the shared support blending
 * kernel locally, but the visible landform remains island-specific. Satellite
 * islets get fine 2-unit patches snapped to the background lattice, and all
 * side faces are derived from the cells actually emitted across mixed LODs.
 */
interface OceanIslet {
  x: number;
  z: number;
  radius: number;
  peakHeight: number;
}

interface OceanRenderCell {
  x: number;
  z: number;
  size: number;
  top: number;
}

function createOceanIslandTerrainData(
  placements: readonly VillagePlacement[],
  roads: readonly RoadCell[],
  additionalPads: readonly TerrainPad[],
  coreRadius: number,
  seedHash: number,
  profile: OceanIslandTerrainProfile,
  roadGroundHeightAt: (x: number, z: number) => number = (x, z) => settlementGroundHeightAt(x, z, "ocean-island"),
): MergedGeometryData {
  const support = createSupportContext(
    placements,
    roads,
    additionalPads,
    roadGroundHeightAt,
  );
  const constructionReach = coreRadius * 0.92;
  const { mainRadius, beach, nearExtent, middleExtent, farExtent, farCellSize, strait } = profile;
  // Keep the whole possible main shoreline out of the 32-unit far-water LOD.
  // A coarse shore cell reads as a square/rectangle attached to the island;
  // 4-unit coast cells retain the intended block character without exposing
  // the background lattice as a geometric feature.
  // The ocean needs a much larger envelope than the valleys: the flat sea
  // makes the terrain edge visible as a hard line when the camera zooms out,
  // so the boundary sits far past any reachable view. The far ring uses
  // 32-unit cells there (flat water, sub-pixel at that distance) so the cost
  // stays tiny.
  // Main island: an inhabited terrace plus beach bays, rocky headlands, an
  // offset hill chain, an inner lagoon and offshore reefs. The body extends
  // well past every building while actual footprints/roads alone own support
  // blending; there is no global circular or square construction platform.
  const hillAzimuth = (hash2d(seedHash, 0x911, 0, 0) / 0xffffffff) * Math.PI * 2;
  const hillDistance = Math.max(constructionReach * 1.4, mainRadius * 0.42 + (hash2d(seedHash, 0x912, 0, 0) % 21));
  const hillHeight = 22 + (hash2d(seedHash, 0x913, 0, 0) % 13);
  const hillRadius = 16 + (hash2d(seedHash, 0x914, 0, 0) % 10);
  const hill = { x: Math.cos(hillAzimuth) * hillDistance, z: Math.sin(hillAzimuth) * hillDistance };
  // The inhabited interior is an island terrace, not a copy of the natural
  // valley biome. Its low ridge is offset from the settlement and rotates with
  // the seed, so different worlds read as weathered coastal uplands while the
  // construction area remains a usable bench rather than a crater.
  const interiorAxis = hillAzimuth + 0.28 + (hash2d(seedHash, 0x91a, 0, 0) % 48) / 100;
  const interiorRidgeOffset = mainRadius * (0.27 + (hash2d(seedHash, 0x91b, 0, 0) % 12) / 100);
  const interiorRidgeWidth = mainRadius * (0.13 + (hash2d(seedHash, 0x91c, 0, 0) % 8) / 100);
  const interiorRidgeStrength = 0.8 + (hash2d(seedHash, 0x91d, 0, 0) % 75) / 100;
  // Secondary peaks along the hill chain give the island a ridged silhouette.
  const secondaryPeaks = [0.42, 0.96, 1.5].map((offset) => ({
    x: hill.x * Math.cos(offset) - hill.z * Math.sin(offset),
    z: hill.x * Math.sin(offset) + hill.z * Math.cos(offset),
    height: 8 + (hash2d(seedHash, 0x915, Math.round(offset * 10), 0) % 7),
    radius: 9 + (hash2d(seedHash, 0x916, Math.round(offset * 10), 0) % 6),
  }));
  // The shoreline combines broad angular headlands with low-amplitude spatial
  // noise. Keeping each band bounded prevents a single harmonic from growing
  // into a giant rectangular-looking shelf on the block grid.
  const shorePhaseA = (hash2d(seedHash, 0x941, 0, 0) / 0xffffffff) * Math.PI * 2;
  const shorePhaseB = (hash2d(seedHash, 0x942, 0, 0) / 0xffffffff) * Math.PI * 2;
  const shorePhaseC = (hash2d(seedHash, 0x943, 0, 0) / 0xffffffff) * Math.PI * 2;
  const shoreWarp = (angle: number): number => {
    const waves = Math.sin(angle * 2 + shorePhaseA) * 0.5
      + Math.sin(angle * 3 + shorePhaseB) * 0.32
      + Math.sin(angle * 5 + shorePhaseC) * 0.2;
    const fractal = valueNoise(Math.cos(angle) * 1.9, Math.sin(angle) * 1.9, seedHash, 0x944) * 0.3;
    return Math.max(0.78, Math.min(1.22, 1 + waves * 0.16 + fractal * 0.12));
  };
  const mainShoreWarp = (angle: number, x: number, z: number): number => {
    const angular = Math.sin(angle * 2 + shorePhaseA) * 0.5
      + Math.sin(angle * 3 + shorePhaseB) * 0.3
      + Math.sin(angle * 5 + shorePhaseC) * 0.15;
    const broad = fractalNoise(x * 0.011, z * 0.011, seedHash, 0x948);
    const detail = valueNoise(x * 0.032, z * 0.032, seedHash, 0x949);
    return Math.max(0.8, Math.min(1.2, 1 + angular * 0.13 + broad * 0.07 + detail * 0.035));
  };
  // Several rocky headland arcs in scattered, asymmetric angles; the rest of
  // the shore is sandy only where the coast recedes (bays) — protruding
  // stretches stay rocky, so the rim never reads as a half-sand half-stone
  // ring.
  const headlandCount = 2 + (hash2d(seedHash, 0x945, 0, 0) % 3);
  const headlands: Array<{ center: number; width: number }> = [];
  for (let index = 0; index < headlandCount; index += 1) {
    headlands.push({
      center: (hash2d(seedHash, 0x946 + index, 0, 0) / 0xffffffff) * Math.PI * 2,
      width: 0.5 + (hash2d(seedHash, 0x947 + index, 0, 0) % 62) / 100,
    });
  }
  const rockyShoreStrength = (angle: number): number =>
    headlands.reduce((strength, head) => {
      let delta = Math.abs(angle - head.center);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      return Math.max(strength, 1 - smoothstep(head.width * 0.55, head.width, delta));
    }, 0);
  // An inner lagoon: a small pond beyond the settlement framing range, ringed
  // by the island terrace.
  const lagoonAzimuth = hillAzimuth + Math.PI + (((hash2d(seedHash, 0x917, 0, 0) % 628) / 100) - 3.1) * 0.8;
  const lagoonDistance = Math.max(coreRadius + 20, constructionReach * 1.35, mainRadius * 0.52 + (hash2d(seedHash, 0x918, 0, 0) % 14));
  const lagoon = {
    x: Math.cos(lagoonAzimuth) * lagoonDistance,
    z: Math.sin(lagoonAzimuth) * lagoonDistance,
    radius: 4 + (hash2d(seedHash, 0x919, 0, 0) % 4),
  };
  // Offshore reefs: a few rock knobs poking out of the shallow water.
  const reefCount = 6 + (hash2d(seedHash, 0x95a, 0, 0) % 5);
  const reefs: Array<{ x: number; z: number; radius: number }> = [];
  for (let index = 0; index < reefCount; index += 1) {
    const ring = mainRadius + beach + 10 + (hash2d(seedHash, 0x95b + index, 0, 0) % 26);
    const angle = (hash2d(seedHash, 0x95c + index, 0, 0) / 0xffffffff) * Math.PI * 2;
    reefs.push({
      x: Math.cos(angle) * ring,
      z: Math.sin(angle) * ring,
      radius: 1.5 + (hash2d(seedHash, 0x95d + index, 0, 0) % 20) / 10,
    });
  }
  // Satellite islets: 4..7 with scattered angles (no uniform ring — Minecraft-
// style organic placement), at least `strait` units of open water between the
// main beach and any islet shore (user requirement).
  const isletCount = 4 + (hash2d(seedHash, 0x921, 0, 0) % 4);
  const isletAngles: number[] = [];
  for (let index = 0; index < isletCount; index += 1) {
    isletAngles.push((hash2d(seedHash, 0x960 + index, 0, 0) / 0xffffffff) * Math.PI * 2);
  }
  isletAngles.sort((a, b) => a - b);
  for (let index = 0; index < isletAngles.length; index += 1) {
    const next = (index + 1) % isletAngles.length;
    let gap = (isletAngles[next]! - isletAngles[index]! + Math.PI * 2) % (Math.PI * 2);
    if (gap < 0.45) {
      isletAngles[next] = (isletAngles[index]! + 0.45) % (Math.PI * 2);
      if (next === 0) isletAngles[0]! += Math.PI * 2;
    }
  }
  const islets: OceanIslet[] = [];
  for (let index = 0; index < isletCount; index += 1) {
    const angle = isletAngles[index]!;
    const radius = 13 + (hash2d(seedHash, 0x932 + index, 0, 0) % 15);
    // The mandated open-water strait is measured from shoreline to shoreline:
    // the islet center sits at least strait + its own radius past the beach.
    const distance = mainRadius + beach + strait + radius + (hash2d(seedHash, 0x931 + index, 0, 0) % 85);
    const peakHeight = 5 + (hash2d(seedHash, 0x933 + index, 0, 0) % 7);
    islets.push({ x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, radius, peakHeight });
  }
  const ocean = (): TerrainSample => ({ height: 0, material: "water", supportInfluence: 0, moisture: 1, waterKind: "lake" });
  // Each islet owns an axis-aligned fine patch whose EDGES, rather than its
  // fractional centre, are snapped to the 32-unit background lattice. The old
  // circular centre test skipped whole background cells while the replacement
  // 2-unit square started at the unsnapped islet centre. Those two coordinate
  // systems left positive-width uncovered bands (and larger holes whenever
  // the circular skip radius exceeded the fine-square reach).
  const isletPatches = islets.map(islet => {
    const requiredReach = islet.radius + 12;
    return {
      minX: Math.floor((islet.x - requiredReach) / 32) * 32,
      maxX: Math.ceil((islet.x + requiredReach) / 32) * 32,
      minZ: Math.floor((islet.z - requiredReach) / 32) * 32,
      maxZ: Math.ceil((islet.z + requiredReach) / 32) * 32,
    };
  });
  const inIsletPatch = (x: number, z: number): boolean =>
    isletPatches.some(patch => x > patch.minX && x < patch.maxX && z > patch.minZ && z < patch.maxZ);
  const sampleOceanAt = (x: number, z: number): TerrainSample => {
    const supported = sampleSupport(x, z, support);
    // Satellite islets (warped shores like the main island).
    for (const islet of islets) {
      const dx = x - islet.x;
      const dz = z - islet.z;
      const d = Math.hypot(dx, dz);
      const shore = islet.radius * shoreWarp(Math.atan2(dz, dx)) + 1.5;
      if (d <= shore) {
        const ridge = 0.5 + 0.5 * Math.sin(fractalNoise(x * 0.07, z * 0.07, seedHash, 0x941) * Math.PI);
        const height = isletHeight(d, shore, islet.peakHeight, ridge);
        // Same bay/headland rule as the main island: beaches only in receding
        // bays, protruding stretches stay rocky.
        const isletShoreK = shoreWarp(Math.atan2(dz, dx));
        const sandy = isletShoreK < 1.06 && d > islet.radius - 2;
        return {
          height,
          material: height > 6 ? "stone" : sandy ? "sand" : "grass",
          supportInfluence: 0,
          moisture: 0.14,
          waterKind: "none",
        };
      }
    }
    // Reefs poke out of the open water.
    for (const reef of reefs) {
      if (Math.hypot(x - reef.x, z - reef.z) <= reef.radius) {
        return { height: 1, material: "stone", supportInfluence: 0, moisture: 0, waterKind: "none" };
      }
    }
    // Inner lagoon pond on the main island (checked before the island body so
    // the pond does not get swallowed by the land sample; actual support areas
    // always win).
    if (supported.influence < 0.08 && Math.hypot(x - lagoon.x, z - lagoon.z) <= lagoon.radius) {
      return ocean();
    }
    // Main island, shoreline warped into bays and headlands.
    const angle = Math.atan2(z, x);
    const shoreK = mainShoreWarp(angle, x, z);
    const d = Math.hypot(x, z);
    const landRadius = mainRadius * shoreK;
    const coastWidth = beach * Math.max(0.72, Math.min(1.18, 1.02 + (1 - shoreK) * 0.6));
    const outerRadius = landRadius + coastWidth;
    if (d <= outerRadius) {
      const alongInterior = x * Math.cos(interiorAxis) + z * Math.sin(interiorAxis);
      const acrossInterior = -x * Math.sin(interiorAxis) + z * Math.cos(interiorAxis);
      const offsetRidge = Math.exp(-Math.pow((acrossInterior - interiorRidgeOffset) / interiorRidgeWidth, 2))
        * interiorRidgeStrength;
      const coastalTilt = (alongInterior / Math.max(1, mainRadius)) * 0.55;
      const weatheredTerrace = valueNoise(x * 0.038, z * 0.038, seedHash, 0x950) * 0.55;
      const interiorRise = smoothstep(0, Math.max(12, beach * 0.9), landRadius - d);
      const beachRise = smoothstep(0, coastWidth, outerRadius - d);
      let height = d <= landRadius
        ? Math.max(1, Math.round(1.25 + interiorRise * 2.65 + (offsetRidge + coastalTilt + weatheredTerrace) * interiorRise))
        : Math.max(0, Math.round(beachRise * 1.6));
      // Hill chain: the main peak plus the secondary peaks along the ridge. The
      // support field locally fades them away around real buildings and roads,
      // rather than carving one circular construction depression.
      const peakContrib = (peak: { x: number; z: number; height: number; radius: number }): number => {
        return islandHill(Math.hypot(x - peak.x, z - peak.z), peak.radius, peak.height,
          fractalNoise(x * .045, z * .045, seedHash, 0x952), supported.influence);
      };
      height += Math.round(peakContrib({ ...hill, height: hillHeight, radius: hillRadius }));
      for (const secondary of secondaryPeaks) height += Math.round(peakContrib(secondary));
      // Reuse the natural-valley support *mechanism*, not its visual terrain:
      // only actual placements and roads receive a short, smooth height match.
      // The surrounding seeded island terrace remains intact.
      if (supported.influence > 0.001) {
        const blend = smoothstep(0.72, 0.995, supported.influence);
        height = Math.round(height + (supported.height - height) * blend);
      }
      // Beaches belong to receding bays only; headlands and protruding stretches
      // stay rocky — never inside a protected building or road transition.
      const rim = landRadius;
      const protectedGround = supported.influence >= 0.08;
      const headlandExposure = Math.max(
        smoothstep(1.025, 1.11, shoreK),
        rockyShoreStrength(angle),
      );
      const shoreTexture = valueNoise(x * 0.075, z * 0.075, seedHash, 0x94e) * 0.22;
      const rocky = !protectedGround && (height >= 16
        || (d > rim - (2.5 + headlandExposure * 4.5)
          && headlandExposure + shoreTexture > 0.48));
      const sandy = !protectedGround && !rocky && d > rim - 5;
      return {
        height,
        material: islandSurface({height, distance:d, landRadius, coastWidth, shoreWarp:shoreK,
          exposure:headlandExposure, supportInfluence:supported.influence, x, z, seed:seedHash,
          original:rocky ? "stone" : sandy ? "dirt" : "grass"}),
        supportInfluence: supported.influence,
        moisture: 0.12,
        waterKind: "none",
      };
    }
    return ocean();
  };

  const { positions, indicesByMaterial, sideIndices, addTop: addQuad, addSide: addSideQuad } = createTerrainMeshBuffers();
  const naturalTrees: NaturalTreePlacement[] = [];
  const renderCells: OceanRenderCell[] = [];
  const lodCellCounts = { near: 0, middle: 0, far: 0 };
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let riverCellCount = 0;
  let lakeCellCount = 0;
  let protectedWaterCellCount = 0;
  let waterSurfaceArea = 0;
  let terrainSurfaceArea = 0;
  const sampleCache = new Map<string, TerrainSample>();
  const sampleCellAt = (x: number, z: number, size: number): TerrainSample => {
    const key = `${x}:${z}`;
    const cached = sampleCache.get(key);
    if (cached) return cached;
    const raw = sampleOceanAt(x, z);
    // Outer islets own independent fine patches, not this transition band.
    const sample = size === 2 && Math.abs(x) < nearExtent && Math.abs(z) < nearExtent
      ? blendNearTransition(raw, x, z, nearExtent, sampleOceanAt) : raw;
    sampleCache.set(key, sample);
    return sample;
  };
  const addCell = (x: number, z: number, size: number, lod: keyof typeof lodCellCounts): void => {
    const sample = sampleCellAt(x, z, size);
    const half = size / 2;
    const top = sample.height - (sample.material === "water" ? 0.34 : 0.5);
    addQuad([
      x - half, top, z - half, x - half, top, z + half,
      x + half, top, z + half, x + half, top, z - half,
    ], sample.material);
    renderCells.push({ x, z, size, top });
    lodCellCounts[lod] += 1;
    terrainSurfaceArea += size * size;
    minHeight = Math.min(minHeight, sample.height);
    maxHeight = Math.max(maxHeight, sample.height);
    if (sample.waterKind === "river") riverCellCount += 1;
    if (sample.waterKind === "lake") lakeCellCount += 1;
    if (sample.waterKind !== "none") waterSurfaceArea += size * size;
    if (sample.waterKind !== "none" && sample.supportInfluence >= 0.28) protectedWaterCellCount += 1;
    if (lod !== "far" && size <= 4 && sample.material === "grass" && sample.supportInfluence < 0.18 && sample.moisture > 0.06) {
      const treeHash = hash2d(seedHash, 0x771, Math.round(x), Math.round(z));
      const density = size === 2 ? 27 : 58;
      if (treeHash % 1000 < density && sample.height < 19) {
        naturalTrees.push({ x, y: sample.height - 0.45, z, scale: 0.82 + (treeHash % 41) / 100 });
      }
    }
  };

  // Background rings skip exact rectangular patches. All patch boundaries
  // are shared multiples of 32, so the 2-, 4- and 32-unit grids meet on the
  // same edges. Overlapping islet patches emit each fine cell only once.
  addLodSquare(nearExtent, 0, 2, (x, z) => { if (!inIsletPatch(x, z)) addCell(x, z, 2, "near"); });
  addLodSquare(middleExtent, nearExtent, 4, (x, z) => { if (!inIsletPatch(x, z)) addCell(x, z, 4, "middle"); });
  addLodSquare(farExtent, middleExtent, farCellSize, (x, z) => { if (!inIsletPatch(x, z)) addCell(x, z, farCellSize, "far"); });
  const emittedFineCells = new Set<string>();
  for (const patch of isletPatches) {
    for (let x = patch.minX + 1; x < patch.maxX; x += 2) {
      for (let z = patch.minZ + 1; z < patch.maxZ; z += 2) {
        const key = `${x}:${z}`;
        if (emittedFineCells.has(key)) continue;
        emittedFineCells.add(key);
        addCell(x, z, 2, "middle");
      }
    }
  }

  // Islet patches deliberately replace 4/32-unit ocean cells with 2-unit
  // cells. Side faces must therefore follow the cells that were actually
  // emitted; inferring a neighbour size from distance produces the long,
  // straight x/z-aligned holes seen at patch and LOD boundaries.
  addOceanCellSides(renderCells, addSideQuad);

  closeTerrainCornerSlits(positions, indicesByMaterial, sideIndices);

  const indexCount = Object.values(indicesByMaterial).reduce((sum, indices) => sum + indices.length, 0)
    + sideIndices.dirt.length + sideIndices.stone.length;
  return {
    positions,
    indicesByMaterial,
    sideIndices,
    cellCount: lodCellCounts.near + lodCellCounts.middle + lodCellCounts.far,
    triangleCount: indexCount / 3,
    bounds: { minX: -farExtent, maxX: farExtent, minY: minHeight - 0.5, maxY: maxHeight + 0.5, minZ: -farExtent, maxZ: farExtent },
    framingBounds: { minX: -coreRadius, maxX: coreRadius, minZ: -coreRadius, maxZ: coreRadius },
    nearDetailBounds: { minX: -nearExtent, maxX: nearExtent, minZ: -nearExtent, maxZ: nearExtent },
    naturalTrees,
    terrainGenerationVersion: 4,
    lodCellCounts,
    oceanIslets: islets,
    oceanMain: { radius: mainRadius, beach },
    hydrology: {
      networkCount: 0,
      basinCount: 0,
      riverCellCount,
      lakeCellCount,
      riverSegmentCount: 0,
      outletCount: 0,
      maxUphillWaterStep: 0,
      protectedWaterCellCount,
      waterSurfaceArea,
      terrainSurfaceArea,
    },
  };
}

function addOceanCellSides(
  cells: readonly OceanRenderCell[],
  addQuad: (vertices: readonly number[], material: "dirt" | "stone") => void,
): void {
  interface Edge {
    start: number;
    end: number;
    top: number;
  }
  const leftByX = new Map<number, Edge[]>();
  const rightByX = new Map<number, Edge[]>();
  const nearByZ = new Map<number, Edge[]>();
  const farByZ = new Map<number, Edge[]>();
  const register = (map: Map<number, Edge[]>, line: number, edge: Edge): void => {
    const edges = map.get(line) ?? [];
    edges.push(edge);
    map.set(line, edges);
  };

  for (const cell of cells) {
    const half = cell.size / 2;
    register(leftByX, cell.x - half, { start: cell.z - half, end: cell.z + half, top: cell.top });
    register(rightByX, cell.x + half, { start: cell.z - half, end: cell.z + half, top: cell.top });
    register(nearByZ, cell.z - half, { start: cell.x - half, end: cell.x + half, top: cell.top });
    register(farByZ, cell.z + half, { start: cell.x - half, end: cell.x + half, top: cell.top });
  }
  const indexLines = (lines: ReadonlyMap<number, Edge[]>) => new Map(
    [...lines].map(([coordinate, edges]) => [coordinate, new TerrainLineIndex(edges)] as const),
  );
  const left = indexLines(leftByX), right = indexLines(rightByX);
  const near = indexLines(nearByZ), far = indexLines(farByZ);

  const emit = (
    cell: OceanRenderCell,
    axis: "x" | "z",
    direction: -1 | 1,
    neighbors: TerrainLineIndex<Edge> | undefined,
  ): void => {
    if (!neighbors) return;
    const half = cell.size / 2;
    const edgeStart = axis === "x" ? cell.z - half : cell.x - half;
    const edgeEnd = axis === "x" ? cell.z + half : cell.x + half;
    const line = axis === "x" ? cell.x + direction * half : cell.z + direction * half;
    const material: "dirt" | "stone" = cell.top > 12 ? "stone" : "dirt";
    for (const neighbor of neighbors.overlapping(edgeStart, edgeEnd)) {
      const segmentStart = Math.max(edgeStart, neighbor.start);
      const segmentEnd = Math.min(edgeEnd, neighbor.end);
      if (segmentEnd - segmentStart < 0.001 || neighbor.top >= cell.top - 0.01) continue;
      const bottom = neighbor.top;
      if (axis === "x" && direction < 0) addQuad([
        line, bottom, segmentEnd, line, cell.top, segmentEnd,
        line, cell.top, segmentStart, line, bottom, segmentStart,
      ], material);
      else if (axis === "x") addQuad([
        line, bottom, segmentStart, line, cell.top, segmentStart,
        line, cell.top, segmentEnd, line, bottom, segmentEnd,
      ], material);
      else if (direction < 0) addQuad([
        segmentStart, bottom, line, segmentStart, cell.top, line,
        segmentEnd, cell.top, line, segmentEnd, bottom, line,
      ], material);
      else addQuad([
        segmentEnd, bottom, line, segmentEnd, cell.top, line,
        segmentStart, cell.top, line, segmentStart, bottom, line,
      ], material);
    }
  };

  for (const cell of cells) {
    const half = cell.size / 2;
    emit(cell, "x", -1, right.get(cell.x - half));
    emit(cell, "x", 1, left.get(cell.x + half));
    emit(cell, "z", -1, far.get(cell.z - half));
    emit(cell, "z", 1, near.get(cell.z + half));
  }
}

function addLodSquare(extent: number, innerExtent: number, cellSize: number, add: (x: number, z: number) => void, centerX = 0, centerZ = 0): void {
  const start = -extent + cellSize / 2;
  for (let x = start; x < extent; x += cellSize) {
    for (let z = start; z < extent; z += cellSize) {
      if (innerExtent > 0 && Math.abs(x) < innerExtent && Math.abs(z) < innerExtent) continue;
      add(x + centerX, z + centerZ);
    }
  }
}

/**
 * Closes the sky-visible slits left at cell corners. Step side faces are built
 * per edge, so when cells of different heights meet at a corner (diagonal
 * steps, or the near/middle/far ring boundaries where the cell grids do not
 * align), the vertical column at the corner can stay uncovered between two
 * surface levels: bright sky bleeds through by day, stars by night. A scan
 * over the built quads finds every uncovered band and seals it with a
 * hairline double-sided sliver, which is sub-pixel at phone scale.
 */
function closeTerrainCornerSlits(
  positions: number[],
  indicesByMaterial: Record<TerrainMaterial, number[]>,
  sideIndices: { dirt: number[]; stone: number[] },
): void {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const key = (x: number, z: number) => `${x}|${z}`;
  type Span = { bottom: number; top: number };
  const cornerHeights = new Map<string, number[]>();
  const collectTops = (indices: readonly number[]) => {
    for (let offset = 0; offset < indices.length; offset += 6) {
      const unique = [...new Set([indices[offset]!, indices[offset + 1]!, indices[offset + 2]!, indices[offset + 3]!, indices[offset + 5]!])];
      for (const index of unique) {
        const x = round(positions[index * 3]!);
        const y = round(positions[index * 3 + 1]!);
        const z = round(positions[index * 3 + 2]!);
        const k = key(x, z);
        const list = cornerHeights.get(k) ?? [];
        if (!list.includes(y)) list.push(y);
        cornerHeights.set(k, list);
      }
    }
  };
  for (const indices of Object.values(indicesByMaterial)) collectTops(indices);
  const cornerSpans = new Map<string, Span[]>();
  const register = (x: number, z: number, bottom: number, top: number) => {
    const k = key(x, z);
    const spans = cornerSpans.get(k) ?? [];
    spans.push({ bottom, top });
    cornerSpans.set(k, spans);
  };
  // Index the corner positions by plan line so half-integer grids (legacy
  // cell size 1) and integer grids (V2 rings) both resolve exactly.
  const cornersByX = new Map<number, number[]>();
  const cornersByZ = new Map<number, number[]>();
  for (const k of cornerHeights.keys()) {
    const [x, z] = k.split("|").map(Number) as [number, number];
    const byX = cornersByX.get(x) ?? [];
    byX.push(z);
    cornersByX.set(x, byX);
    const byZ = cornersByZ.get(z) ?? [];
    byZ.push(x);
    cornersByZ.set(z, byZ);
  }
  for (const line of [...cornersByX.values(), ...cornersByZ.values()]) line.sort((a, b) => a - b);
  const firstAtLeast = (line: readonly number[], value: number): number => {
    let low = 0, high = line.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (line[middle]! < value) low = middle + 1; else high = middle;
    }
    return low;
  };
  const collectSides = (indices: readonly number[]) => {
    for (let offset = 0; offset < indices.length; offset += 6) {
      const unique = [...new Set([indices[offset]!, indices[offset + 1]!, indices[offset + 2]!, indices[offset + 3]!, indices[offset + 5]!])];
      const corners = unique.map((index) => ({
        x: round(positions[index * 3]!),
        y: round(positions[index * 3 + 1]!),
        z: round(positions[index * 3 + 2]!),
      }));
      const ends: Array<{ x: number; z: number }> = [];
      for (let corner = 0; corner < 4; corner += 1) {
        const a = corners[corner]!;
        const b = corners[(corner + 1) % 4]!;
        if (a.x === b.x && a.z === b.z) ends.push(a);
      }
      if (ends.length !== 2) continue;
      const ys = corners.map((corner) => corner.y);
      const bottom = Math.min(...ys);
      const top = Math.max(...ys);
      const [p0, p1] = ends as [{ x: number; z: number }, { x: number; z: number }];
      const minX = Math.min(p0.x, p1.x);
      const maxX = Math.max(p0.x, p1.x);
      const minZ = Math.min(p0.z, p1.z);
      const maxZ = Math.max(p0.z, p1.z);
      if (minX === maxX) {
        const line = cornersByX.get(minX) ?? [];
        for (let i = firstAtLeast(line, minZ - 0.011); i < line.length && line[i]! <= maxZ + 0.011; i++) {
          register(minX, line[i]!, bottom, top);
        }
      } else if (minZ === maxZ) {
        const line = cornersByZ.get(minZ) ?? [];
        for (let i = firstAtLeast(line, minX - 0.011); i < line.length && line[i]! <= maxX + 0.011; i++) {
          register(line[i]!, minZ, bottom, top);
        }
      } else {
        register(round(p0.x), round(p0.z), bottom, top);
        register(round(p1.x), round(p1.z), bottom, top);
      }
    }
  };
  collectSides(sideIndices.dirt);
  collectSides(sideIndices.stone);
  const sliverWidth = 0.05;
  for (const [k, heights] of cornerHeights) {
    if (heights.length < 2) continue;
    const low = Math.min(...heights);
    const high = Math.max(...heights);
    const spans = cornerSpans.get(k) ?? [];
    let cursor = low;
    let closed = false;
    for (let pass = 0; pass < spans.length + 1; pass += 1) {
      const next = Math.max(cursor, ...spans.filter((span) => span.bottom <= cursor + 0.011).map((span) => span.top));
      if (next >= high - 0.011) { closed = true; break; }
      if (next <= cursor) break;
      cursor = next;
    }
    if (closed) continue;
    const [cx, cz] = k.split("|").map(Number) as [number, number];
    const material: "dirt" | "stone" = (cursor + high) / 2 >= 12 ? "stone" : "dirt";
    const start = positions.length / 3;
    positions.push(
      cx, cursor, cz,
      cx, high, cz,
      cx + sliverWidth, high, cz,
      cx + sliverWidth, cursor, cz,
    );
    // Double-sided hairline: both windings so the corner reads sealed from
    // either side.
    sideIndices[material].push(
      start, start + 1, start + 2, start, start + 2, start + 3,
      start, start + 3, start + 2, start, start + 2, start + 1,
    );
  }
}

function addRegionalCellSide(
  x: number,
  z: number,
  cellSize: number,
  sample: TerrainSample,
  dx: number,
  dz: number,
  sampleCellAt: (x: number, z: number, size: number) => TerrainSample,
  nearExtent: number,
  middleExtent: number,
  farFineExtent: number,
  refinedFar: boolean,
  farCellSize = 16,
  addQuad: (vertices: readonly number[], material: "dirt" | "stone") => void,
  transparentSea = false,
): void {
  // Water surfaces sit 0.16 above land tops; side faces must start at the actual
  // surface height so the shoreline never leaves a sky-visible slit.
  const top = sample.height - (sample.material === "water" ? 0.34 : 0.5);
  const half = cellSize / 2;
  const acrossX = x + dx * cellSize;
  const acrossZ = z + dz * cellSize;
  const insideNear = Math.abs(acrossX) <= nearExtent && Math.abs(acrossZ) <= nearExtent;
  const insideMiddle = Math.abs(acrossX) <= middleExtent && Math.abs(acrossZ) <= middleExtent;
  const insideFine = refinedFar && Math.abs(acrossX) <= farFineExtent && Math.abs(acrossZ) <= farFineExtent;
  const neighborSize = insideNear ? 2 : insideMiddle || insideFine ? 4 : farCellSize;
  // Ring lattices: near cells sit on odd coordinates, middle cells at 2 mod 4,
  // the fine far tier continues the middle lattice, and outer cells use 8 or 16
  // — the lattice offset is always half the neighbor size. Snap the neighbor
  // sample to a real cell center of
  // ITS ring instead of the off-lattice adjacent position, and split this
  // cell's edge at the neighbor lattice so every segment's bottom rests on
  // the actual neighbor top. This closes the boundary-line slits that used to
  // run along x/z = ±80 (and ±160) between the rings.
  const latticeOffset = neighborSize / 2;
  const snap = (value: number) => latticeOffset + neighborSize * Math.round((value - latticeOffset) / neighborSize);
  // The neighbor cell across the edge is the lattice cell whose edge contains
  // this cell's boundary line: the boundary coordinate shifted half a neighbor
  // cell toward the neighbor side, snapped onto the neighbor lattice.
  const boundaryX = x + dx * half;
  const boundaryZ = z + dz * half;
  const snappedAcrossX = dx !== 0 ? snap(boundaryX + dx * neighborSize / 2) : x;
  const snappedAcrossZ = dz !== 0 ? snap(boundaryZ + dz * neighborSize / 2) : z;
  const edgeStart = dx !== 0 ? z - half : x - half;
  const edgeEnd = dx !== 0 ? z + half : x + half;
  const material: TerrainMaterial = top > 12 ? "stone" : "dirt";
  for (let center = snap(edgeStart); center - neighborSize / 2 < edgeEnd + 0.001; center += neighborSize) {
    const segStart = Math.max(edgeStart, center - neighborSize / 2);
    const segEnd = Math.min(edgeEnd, center + neighborSize / 2);
    if (segEnd - segStart < 0.001) continue;
    const neighborX = dx !== 0 ? snappedAcrossX : center;
    const neighborZ = dz !== 0 ? snappedAcrossZ : center;
    const neighbor = sampleCellAt(neighborX, neighborZ, neighborSize);
    // The raised water surface is also the neighbouring top. Using the dry
    // offset for two water cells made 0.16-high dirt fences through clear sea.
    // Legacy opaque environments retain their generated geometry identities.
    const bottom = neighbor.height - (transparentSea && neighbor.material === 'water' ? 0.34 : 0.5);
    if (bottom >= top - 0.01) continue;
    if (dx < 0) addQuad([x - half, bottom, segEnd, x - half, top, segEnd, x - half, top, segStart, x - half, bottom, segStart], material);
    else if (dx > 0) addQuad([x + half, bottom, segStart, x + half, top, segStart, x + half, top, segEnd, x + half, bottom, segEnd], material);
    else if (dz < 0) addQuad([segStart, bottom, z - half, segStart, top, z - half, segEnd, top, z - half, segEnd, bottom, z - half], material);
    else addQuad([segEnd, bottom, z + half, segEnd, top, z + half, segStart, top, z + half, segStart, bottom, z + half], material);
  }
}

function sampleNaturalTerrain(
  x: number,
  z: number,
  seedHash: number,
  support: SupportContext,
  hydrology: Hydrology,
  includeWater = true,
  coarse = false,
): TerrainSample {
  const macro = sampleMacroTerrain(x, z, seedHash, coarse);
  const supported = sampleSupport(x, z, support);
  const maximumSupportedHeight = supported.height + Math.pow(1 - supported.influence, 0.78)
    * ((48));
  let height = supported.influence >= 0.995
    ? supported.height
    : Math.round(Math.min(macro.height, maximumSupportedHeight));
  let material: TerrainMaterial = macro.rocky && supported.influence < 0.2 ? "stone" : "grass";
  let waterKind: TerrainSample["waterKind"] = "none";
  const water = includeWater && supported.influence < .28 ? sampleHydrology(x, z, height, hydrology) : null;
  if (water && water.kind !== 'none') {
    height = water.height; material = water.material; waterKind = water.kind;
  }
  const sample = { height, material, supportInfluence: supported.influence, moisture: macro.moisture, waterKind, mountainSignal: macro.mountainSignal };
  const shaped = support.bench ? valleyBench(sample, x, z, seedHash, support.bench) : sample;
  // Keep the dry-bank grade, but retain the surrounding grass/rock surface.
  // Painting every bank dirt made the river network dominate the landscape.
  return water?.material === 'dirt' ? { ...shaped, height: water.height } : shaped;
}

function sampleMacroTerrain(
  x: number,
  z: number,
  seedHash: number,
  coarse = false,
): { height: number; moisture: number; rocky: boolean; mountainSignal: number } {
  const warpX = fractalNoise(x * 0.0048, z * 0.0048, seedHash, 0x121) * 38;
  const warpZ = fractalNoise(x * 0.0048, z * 0.0048, seedHash, 0x131) * 38;
  const px = x + warpX;
  const pz = z + warpZ;
  const continentalness = fractalNoise(px * 0.0046, pz * 0.0046, seedHash, 0x141);
  const erosion = fractalNoise(px * 0.0095, pz * 0.0095, seedHash, 0x151);
  const ridgeNoise = fractalNoise(px * 0.0085, pz * 0.0085, seedHash, 0x161);
  const ridge = Math.pow(1 - Math.abs(ridgeNoise), 2.15);
  // V23: the far LOD ring samples 16-unit cells — far coarser than the detail
  // field (wavelength 5.7-22.7) and the finest hill octave (15.6). Sampling
  // them at full resolution aliases into chaotic adjacent-cell steps that read
  // as scattered pillars, not coherent landmasses. The coarse pass keeps only
  // the two smooth hill octaves and drops the detail field entirely, so the far
  // ring traces broad mountain / valley / water masses of big blocks.
  const hills = coarse
    ? fractalNoise(px * 0.016, pz * 0.016, seedHash, 0x171) - valueNoise(px * 0.064, pz * 0.064, seedHash, 0x173) * 0.15
    : fractalNoise(px * 0.016, pz * 0.016, seedHash, 0x171);
  const detail = coarse ? 0 : fractalNoise(px * 0.044, pz * 0.044, seedHash, 0x181);
  const moisture = fractalNoise(px * 0.011, pz * 0.011, seedHash, 0x191);
  const base = splineRemap(continentalness, [
    [-1, 0], [-0.58, 0.5], [-0.18, 2.2], [0.24, 4.2], [0.58, 6.8], [1, 8.5],
  ]);
  const mountainMask = smoothstep(-0.2, 0.46, continentalness - erosion * 0.28);
  const mountain = ridge * mountainMask * ((18 + Math.max(0, -erosion) * 15));
  const chainNoise = fractalNoise(px * 0.0042 + pz * 0.0016, pz * 0.012 - px * 0.0011, seedHash, 0x1a1);
  const chainRidge = Math.pow(1 - Math.abs(chainNoise), 2.35);
  const chainMask = smoothstep(0.04, 0.56, continentalness - erosion * 0.22);
  const mountainChain = (chainRidge * chainMask * (8 + ridge * 11));
  const peakSignal = smoothstep(0.48, 0.82, Math.max(ridge, chainRidge));
  const highPeaks = (Math.pow(peakSignal, 1.35) * chainMask * (18 + mountainMask * 9 + Math.max(0, -erosion) * 7));
  const rolling = smoothstep(-0.7, 0.22, continentalness) * (hills + 1) * 1.55;
  const valley = smoothstep(0.12, 0.76, erosion) * (2.4 + ridge * 1.5);
  const rawHeight = base + mountain + mountainChain + highPeaks + rolling - valley + detail * 0.35;
  const shapedHeight = rawHeight > 34
    ? 34 + Math.tanh((rawHeight - 34) / 14) * 13
    : rawHeight;
  const maximumHeight = (48);
  const height = Math.max(0, Math.min(maximumHeight, Math.round(shapedHeight)));
  const rockyHeight = (22);
  // V23: the broad 0..1 mountain potential drives the far ring's big blocks.
  const mountainSignal = Math.min(1, Math.max(ridge * mountainMask, chainRidge * chainMask, peakSignal * 0.7));
  return { height, moisture, rocky: height >= rockyHeight && (ridge > 0.48 || chainRidge > 0.58 || moisture < -0.2), mountainSignal };
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

function createSupportContext(
  placements: readonly VillagePlacement[],
  roads: readonly RoadCell[],
  additionalPads: readonly TerrainPad[],
  roadGroundHeightAt: (x: number, z: number) => number = terrainHeightAt,
): SupportContext {
  const rects: SupportRect[] = placements.map((placement) => ({
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
  // Far cells cannot be affected by every task foundation. Insert in original
  // order: equal-influence ties intentionally prefer the later input rectangle.
  const rectBuckets = rects.length >= 8 ? new Map<string, SupportRect[]>() : null;
  if (rectBuckets) for (const rect of rects) {
    for (let x = Math.floor((rect.minX - 38) / 64); x <= Math.floor((rect.maxX + 38) / 64); x++) {
      for (let z = Math.floor((rect.minZ - 38) / 64); z <= Math.floor((rect.maxZ + 38) / 64); z++) {
        const key = `${x}:${z}`, bucket = rectBuckets.get(key) ?? [];
        bucket.push(rect); rectBuckets.set(key, bucket);
      }
    }
  }
  const roadBuckets = new Map<string, RoadCell[]>();
  for (const road of roads) {
    const key = bucketKey(road.x, road.z);
    const bucket = roadBuckets.get(key) ?? [];
    bucket.push(road);
    roadBuckets.set(key, bucket);
  }
  // This pure callback depends only on this generation's fixed foundations.
  // A road datum is sampled repeatedly by adjacent cells and hydrology probes.
  const roadHeights = new Map<string, number>();
  const cachedRoadHeightAt = (x: number, z: number): number => {
    const key = `${x}:${z}`;
    let height = roadHeights.get(key);
    if (height === undefined) { height = roadGroundHeightAt(x, z); roadHeights.set(key, height); }
    return height;
  };
  return { rects, rectBuckets, roadBuckets, roadGroundHeightAt: cachedRoadHeightAt };
}

function sampleSupport(x: number, z: number, context: SupportContext): { influence: number; height: number } {
  let influence = 0;
  let height = terrainHeightAt(x, z);
  const rects = context.rectBuckets
    ? context.rectBuckets.get(`${Math.floor(x / 64)}:${Math.floor(z / 64)}`) ?? []
    : context.rects;
  for (const rect of rects) {
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
          height = context.roadGroundHeightAt(road.x, road.z);
        }
      }
    }
  }
  return { influence, height };
}

function distanceToRect(x: number, z: number, rect: SupportRect): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

function bucketKey(x: number, z: number): string {
  return `${Math.floor(x / 24)}:${Math.floor(z / 24)}`;
}

function createHydrology(farExtent: number, seedHash: number, support: SupportContext): Hydrology {
  const step = 8;
  const extent = alignTo(farExtent, step);
  const minimum = -extent + step;
  const maximum = extent - step;
  const cells = new Map<string, DrainageCell>();
  let gx = 0;
  for (let x = minimum; x <= maximum; x += step, gx += 1) {
    let gz = 0;
    for (let z = minimum; z <= maximum; z += step, gz += 1) {
      const macro = sampleMacroTerrain(x, z, seedHash);
      const protectedInfluence = sampleSupport(x, z, support).influence;
      const key = hydrologyGridKey(gx, gz);
      cells.set(key, {
        key, gx, gz, x, z, height: macro.height,
        moisture: plateMoisture(x, z, seedHash, macro.moisture),
        protectedInfluence,
        filledHeight: Number.POSITIVE_INFINITY,
        downstreamKey: null,
        accumulation: 0,
      });
    }
  }

  const queue = new DrainageQueue();
  const queued = new Set<string>();
  for (const cell of cells.values()) {
    if (cell.x !== minimum && cell.x !== maximum && cell.z !== minimum && cell.z !== maximum) continue;
    cell.filledHeight = drainElevation(cell);
    queue.push({ key: cell.key, height: cell.filledHeight, tie: hash2d(seedHash, 0x401, cell.gx, cell.gz) });
    queued.add(cell.key);
  }
  while (queue.size > 0) {
    const item = queue.pop()!;
    const current = cells.get(item.key)!;
    for (const neighbor of hydrologyNeighbors(current, cells)) {
      if (queued.has(neighbor.key)) continue;
      queued.add(neighbor.key);
      neighbor.filledHeight = Math.max(drainElevation(neighbor), current.filledHeight + 0.001);
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

  const lakeComponents = collectLakeComponents(cells, seedHash);
  const lakes: DrainageLake[] = [];
  const lakeByCell = new Map<string, DrainageLake>();
  for (const component of lakeComponents) {
    if (lakes.length >= ((2))) break;
    if (lakes.some((lake) => Math.hypot(lake.centerX - component.centerX, lake.centerZ - component.centerZ) < 72)) continue;
    const lake: DrainageLake = { ...component, id: lakes.length };
    lakes.push(lake);
    for (const key of lake.cells) lakeByCell.set(key, lake);
  }

  const minimumAccumulation = (32);
  const channelCells = new Set([...cells.values()].filter((cell) => (
    cell.accumulation >= minimumAccumulation
    && cell.protectedInfluence < 0.08
    && !lakeByCell.has(cell.key)
    && (cell.moisture > -0.58 || cell.accumulation >= minimumAccumulation * 4)
  )).map((cell) => cell.key));
  const outletMemo = new Map<string, string>();
  const grouped = new Map<string, DrainageCell[]>();
  for (const key of channelCells) {
    const cell = cells.get(key)!;
    const downstream = cell.downstreamKey ? cells.get(cell.downstreamKey) : undefined;
    if (!downstream || downstream.protectedInfluence >= 0.18) continue;
    const outlet = outletKey(cell, cells, lakeByCell, outletMemo);
    const group = grouped.get(outlet) ?? [];
    group.push(cell);
    grouped.set(outlet, group);
  }
  const selectedNetworks = [...grouped.entries()]
    .filter(([, members]) => members.length >= ((4)))
    .sort((left, right) => Math.max(...right[1].map((cell) => cell.accumulation)) - Math.max(...left[1].map((cell) => cell.accumulation))
      || left[0].localeCompare(right[0]))
    .slice(0, (4));
  const segments: RiverSegment[] = [];
  selectedNetworks.forEach(([, members], chainId) => {
    const memberKeys = new Set(members.map((cell) => cell.key));
    for (const cell of members) {
      const downstream = cell.downstreamKey ? cells.get(cell.downstreamKey) : undefined;
      if (!downstream || downstream.protectedInfluence >= 0.18) continue;
      if (!memberKeys.has(downstream.key) && !lakeByCell.has(downstream.key) && downstream.accumulation < minimumAccumulation) continue;
      segments.push(riverSegment(cell, downstream, chainId, minimumAccumulation, seedHash, lakeByCell));
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
      segments.push(riverSegment(current, downstream, 0, minimumAccumulation, seedHash, lakeByCell));
      if (lakeByCell.has(downstream.key)) break;
      current = downstream;
    }
  }
  const segmentBuckets = buildRiverSegmentBuckets(segments);
  const networkCount = new Set(segments.map((segment) => segment.chainId)).size;
  return {
    seedHash, step, extent, cells, lakes, lakeByCell, segments, segmentBuckets, networkCount,
    outletCount: networkCount,
    maxUphillWaterStep: segments.reduce((maximum, segment) => Math.max(maximum, segment.waterLevel2 - segment.waterLevel1), 0),
  };
}

function drainElevation(cell: DrainageCell): number {
  return cell.height + cell.protectedInfluence * 48;
}

function hydrologyGridKey(gx: number, gz: number): string {
  return `${gx}:${gz}`;
}

function hydrologyNeighbors(cell: DrainageCell, cells: ReadonlyMap<string, DrainageCell>): DrainageCell[] {
  const result: DrainageCell[] = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (dx === 0 && dz === 0) continue;
      const neighbor = cells.get(hydrologyGridKey(cell.gx + dx, cell.gz + dz));
      if (neighbor) result.push(neighbor);
    }
  }
  return result;
}

function plateMoisture(x: number, z: number, seedHash: number, baseMoisture: number): number {
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

function collectLakeComponents(cells: ReadonlyMap<string, DrainageCell>, seedHash: number): Array<Omit<DrainageLake, "id">> {
  const minimumDepth = (1.25);
  const minimumMoisture = (-0.32);
  const minimumComponentSize = (4);
  const candidates = new Set([...cells.values()].filter((cell) => (
    cell.filledHeight - drainElevation(cell) >= minimumDepth
    && cell.protectedInfluence < 0.08
    && cell.moisture > minimumMoisture
  )).map((cell) => cell.key));
  const components: Array<{ members: DrainageCell[]; score: number }> = [];
  while (candidates.size > 0) {
    const firstKey = candidates.values().next().value as string;
    candidates.delete(firstKey);
    const queue = [cells.get(firstKey)!];
    const members: DrainageCell[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      members.push(current);
      for (const neighbor of hydrologyNeighbors(current, cells)) {
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
    if (fallback) components.push({ members: [fallback, ...hydrologyNeighbors(fallback, cells).filter((cell) => cell.height <= fallback.height + 1).slice(0, 7)], score: 1 });
  }
  return components.sort((left, right) => right.score - left.score).flatMap(({ members }) => {
    const centerX = members.reduce((sum, cell) => sum + cell.x, 0) / members.length;
    const centerZ = members.reduce((sum, cell) => sum + cell.z, 0) / members.length;
    const ordered = [...members].sort((left, right) => Math.hypot(left.x - centerX, left.z - centerZ) - Math.hypot(right.x - centerX, right.z - centerZ));
    const limited = ordered.slice(0, (128));
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

function outletKey(
  start: DrainageCell,
  cells: ReadonlyMap<string, DrainageCell>,
  lakeByCell: ReadonlyMap<string, DrainageLake>,
  memo: Map<string, string>,
): string {
  const cached = memo.get(start.key);
  if (cached) return cached;
  const path: string[] = [];
  const seen = new Set<string>();
  let current: DrainageCell | undefined = start;
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

function riverSegment(
  cell: DrainageCell,
  downstream: DrainageCell,
  chainId: number,
  minimumAccumulation: number,
  seedHash: number,
  lakeByCell: ReadonlyMap<string, DrainageLake>,
): RiverSegment {
  const start = jitteredRiverPoint(cell, seedHash);
  const end = jitteredRiverPoint(downstream, seedHash);
  const downstreamLake = lakeByCell.get(downstream.key);
  const rawStart = Math.max(0, Math.min(cell.height - 1, Math.floor(cell.filledHeight) - 1));
  const rawEnd = downstreamLake?.waterLevel ?? Math.max(0, Math.min(downstream.height - 1, Math.floor(downstream.filledHeight) - 1));
  const waterLevel2 = Math.min(rawStart, rawEnd);
  const waterLevel1 = Math.max(waterLevel2, rawStart);
  return {
    x1: start.x, z1: start.z, x2: end.x, z2: end.z,
    waterLevel1, waterLevel2,
    width1: riverWidth(cell.accumulation, minimumAccumulation),
    width2: riverWidth(downstream.accumulation, minimumAccumulation),
    chainId,
  };
}

function riverWidth(accumulation: number, minimumAccumulation: number): number {
  return Math.max(1.45, Math.min(6.4, 1.35 + Math.log2(1 + accumulation / minimumAccumulation) * 0.82));
}

function jitteredRiverPoint(cell: DrainageCell, seedHash: number): { x: number; z: number } {
  const amplitude = 1.55;
  return {
    x: cell.x + ((hash2d(seedHash, 0x441, cell.gx, cell.gz) / 0xffffffff) * 2 - 1) * amplitude,
    z: cell.z + ((hash2d(seedHash, 0x442, cell.gx, cell.gz) / 0xffffffff) * 2 - 1) * amplitude,
  };
}

function buildRiverSegmentBuckets(segments: readonly RiverSegment[]): ReadonlyMap<string, readonly number[]> {
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

interface DrainageQueueItem { key: string; height: number; tie: number }

class DrainageQueue {
  private readonly items: DrainageQueueItem[] = [];
  get size(): number { return this.items.length; }
  push(item: DrainageQueueItem): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (drainageQueueBefore(this.items[parent]!, item)) break;
      this.items[index] = this.items[parent]!;
      index = parent;
    }
    this.items[index] = item;
  }
  pop(): DrainageQueueItem | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last || this.items.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      const next = right < this.items.length && drainageQueueBefore(this.items[right]!, this.items[left]!) ? right : left;
      if (drainageQueueBefore(last, this.items[next]!)) break;
      this.items[index] = this.items[next]!;
      index = next;
    }
    this.items[index] = last;
    return first;
  }
}

function drainageQueueBefore(left: DrainageQueueItem, right: DrainageQueueItem): boolean {
  return left.height < right.height || (left.height === right.height && left.tie <= right.tie);
}

function sampleHydrology(
  x: number,
  z: number,
  baseHeight: number,
  hydrology: Hydrology,
): { kind: TerrainSample["waterKind"]; height: number; material: TerrainMaterial } {
  const minimum = -hydrology.extent + hydrology.step;
  const gx = Math.round((x - minimum) / hydrology.step);
  const gz = Math.round((z - minimum) / hydrology.step);
  let nearestLake: { distance: number; lake: DrainageLake } | null = null;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const key = hydrologyGridKey(gx + dx, gz + dz);
      const lake = hydrology.lakeByCell.get(key);
      const cell = hydrology.cells.get(key);
      if (!lake || !cell) continue;
      const distance = Math.hypot(x - cell.x, z - cell.z);
      if (!nearestLake || distance < nearestLake.distance) nearestLake = { distance, lake };
    }
  }
  if (nearestLake) {
    const shorelineNoise = (fractalNoise(x * 0.055, z * 0.055, hydrology.seedHash, 0x451));
    const waterRadius = hydrology.step * ((0.64 + shorelineNoise * 0.07));
    if (nearestLake.distance <= waterRadius) return { kind: "lake", height: nearestLake.lake.waterLevel, material: "water" };
    const bankRadius = (waterRadius + 4.2);
    if (nearestLake.distance <= bankRadius) {
      const bank = smoothstep(waterRadius, bankRadius, nearestLake.distance);
      return { kind: "none", height: Math.round((nearestLake.lake.waterLevel + 1) * (1 - bank) + baseHeight * bank), material: "dirt" };
    }
  }

  const bucket = hydrology.segmentBuckets.get(`${Math.floor(x / 32)}:${Math.floor(z / 32)}`) ?? [];
  let nearest: { distance: number; waterLevel: number; width: number } | null = null;
  for (const index of bucket) {
    const segment = hydrology.segments[index]!;
    const distance = distanceToSegment(x, z, segment.x1, segment.z1, segment.x2, segment.z2);
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

function distanceToSegment(
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
  groundHeightAt: (x: number, z: number) => number = terrainHeightAt,
): RoadGeometryData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const road of roads) {
    const y = heightForCell(road.x, road.z, placements, additionalPads, groundHeightAt) - 0.455;
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

function heightForCell(
  x: number,
  z: number,
  placements: readonly VillagePlacement[],
  additionalPads: readonly TerrainPad[],
  groundHeightAt: (x: number, z: number) => number = terrainHeightAt,
): number {
  let height = groundHeightAt(x, z);
  for (const pad of additionalPads) {
    if (Math.abs(x - pad.x) <= pad.width / 2 + 1 && Math.abs(z - pad.z) <= pad.depth / 2 + 1) {
      height = Math.max(height, pad.groundLevel);
    }
  }
  for (const placement of placements) {
    if (Math.abs(x - placement.worldPosition.x) <= placement.footprint.width / 2 + 1
      && Math.abs(z - placement.worldPosition.z) <= placement.footprint.depth / 2 + 1) {
      height = Math.max(height, placement.worldPosition.y);
    }
  }
  return height;
}

/**
 * Roads are part of the inhabited bench, so their support datum must use the
 * same environment alignment as buildings. Ocean buildings are lifted to the
 * four-block terrace; sampling the legacy valley height here used to carve the
 * road and its lamps back down by several layers.
 */
export function settlementGroundHeightAt(
  x: number,
  z: number,
  environmentStyle: TerrainEnvironmentStyle,
  placements: readonly VillagePlacement[] = [],
  additionalPads: readonly TerrainPad[] = [],
): number {
  const legacyHeight = terrainHeightAt(x, z);
  let height = environmentStyle === "ocean-island" ? Math.max(4, legacyHeight) : legacyHeight;
  for (const pad of additionalPads) {
    if (Math.abs(x - pad.x) <= pad.width / 2 + 1 && Math.abs(z - pad.z) <= pad.depth / 2 + 1) {
      height = Math.max(height, pad.groundLevel);
    }
  }
  for (const placement of placements) {
    if (Math.abs(x - placement.worldPosition.x) <= placement.footprint.width / 2 + 1
      && Math.abs(z - placement.worldPosition.z) <= placement.footprint.depth / 2 + 1) {
      height = Math.max(height, placement.worldPosition.y);
    }
  }
  return height;
}

/**
 * Computes a conservative support datum for a building footprint. Layout keeps
 * settlement identities and x/z slots stable; only the derived y support is
 * raised when another part of the footprint sits higher than its centre.
 */
export function settlementSupportHeightForPlacement(
  placement: VillagePlacement,
  environmentStyle: TerrainEnvironmentStyle,
): number {
  const minX = Math.floor(placement.worldPosition.x - placement.footprint.width / 2);
  const maxX = Math.ceil(placement.worldPosition.x + placement.footprint.width / 2);
  const minZ = Math.floor(placement.worldPosition.z - placement.footprint.depth / 2);
  const maxZ = Math.ceil(placement.worldPosition.z + placement.footprint.depth / 2);
  let support = environmentStyle === "ocean-island" ? 4 : placement.worldPosition.y;
  // Sample every terrain cell, not every other cell. A one-cell ridge at a
  // footprint corner is enough to pierce a building when only the centre is
  // used as its datum, and coarse sampling can miss exactly that ridge.
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      support = Math.max(support, settlementGroundHeightAt(x, z, environmentStyle));
    }
  }
  // Always inspect the exact corners, including odd-width/odd-depth footprints.
  for (const x of [minX, maxX]) {
    for (const z of [minZ, maxZ]) support = Math.max(support, settlementGroundHeightAt(x, z, environmentStyle));
  }
  return Math.max(placement.worldPosition.y, support);
}

export function supportGroundHeightAt(
  x: number,
  z: number,
  placements: readonly VillagePlacement[],
  additionalPads: readonly TerrainPad[],
  environmentStyle: TerrainEnvironmentStyle,
): number {
  return settlementGroundHeightAt(x, z, environmentStyle, placements, additionalPads);
}

function addExposedSide(
  x: number,
  z: number,
  surfaceTop: number,
  dx: number,
  dz: number,
  cellSize: number,
  sideStride: number,
  cells: ReadonlyMap<string, number>,
  waterCells: ReadonlySet<string>,
  addQuad: (vertices: readonly number[], material: "dirt" | "stone") => void,
): void {
  const neighborKey = `${x + dx * cellSize}:${z + dz * cellSize}`;
  const neighbor = cells.get(neighborKey) ?? -2;
  // Compare SURFACE levels: water sits 0.16 above the land top at equal heights,
  // so an equal-height water neighbor still needs a closing face.
  const neighborSurface = neighbor >= 0
    ? (waterCells.has(neighborKey) ? neighbor - 0.34 : neighbor - 0.5)
    : neighbor - 0.5;
  if (neighborSurface >= surfaceTop - 0.01) return;
  const half = cellSize / 2;
  // Lay side bands from the neighbor surface up to this cell's surface; this
  // also covers the thin band of an equal-height water-land pair.
  let bottom = neighborSurface;
  while (bottom < surfaceTop - 0.01) {
    const top = Math.min(surfaceTop, bottom + sideStride);
    const material: "dirt" | "stone" = bottom + 0.5 >= 0 ? "dirt" : "stone";
    if (dx < 0) addQuad([x - half, bottom, z + half, x - half, top, z + half, x - half, top, z - half, x - half, bottom, z - half], material);
    else if (dx > 0) addQuad([x + half, bottom, z - half, x + half, top, z - half, x + half, top, z + half, x + half, bottom, z + half], material);
    else if (dz < 0) addQuad([x - half, bottom, z - half, x - half, top, z - half, x + half, top, z - half, x + half, bottom, z - half], material);
    else addQuad([x + half, bottom, z + half, x + half, top, z + half, x - half, top, z + half, x - half, bottom, z + half], material);
    bottom = top;
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
