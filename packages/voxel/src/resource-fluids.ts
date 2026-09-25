import type { TextureAlphaMode } from "@tomato-clock/resource-pack";
import type { BlueprintVoxel } from "./blueprint";
import { staticFluidHeight, staticFluidKind, type StaticFluidKind } from "./fallback-visual";
import {
  NO_FACE_TINT,
  WATER_FACE_TINT,
  packFaceTintKinds,
  packFaceUvTransform,
  type FaceTileIndices,
  type FaceTintKinds,
  type FaceUvWords,
  type ResourceFluidSurface,
  type ResourcePackAtlas,
  type TexturedVoxelPlan,
} from "./resource-textures";

export interface ResourceFluidBatch {
  kind: StaticFluidKind;
  /** Unsloped Java height at the cell, used only for stable batch grouping. */
  height: number;
  page: number;
  faceMask: number;
  alphaMode: TextureAlphaMode;
  /** Water layer placed behind the imported block model and exposed by depth testing. */
  waterlogged?: boolean;
  entries: TexturedVoxelPlan[];
}

export interface ResourceFluidFallbackBatch {
  kind: StaticFluidKind;
  height: number;
  faceMask: number;
  entries: TexturedVoxelPlan[];
}

export interface ResourceFluidPlan {
  batches: ResourceFluidBatch[];
  fallbackVoxels: BlueprintVoxel[];
  fallbackEntries: TexturedVoxelPlan[];
  fallbackBatches: ResourceFluidFallbackBatch[];
  /** Number of cells emitted with imported atlas tiles; procedural entries are in fallbackEntries. */
  texturedVoxelCount: number;
}

export interface ResourceWaterloggedFluidPlan extends ResourceFluidPlan {
  /** Waterlogged blocks intentionally skipped after the per-blueprint draw budget. */
  omittedVoxelCount: number;
}

/** Keep per-instance buffers bounded; larger models are emitted in extra batches. */
export const MAX_WATERLOGGED_FLUID_BATCH_ENTRIES = 4096;
const MAX_FLUID_BATCH_ENTRIES = MAX_WATERLOGGED_FLUID_BATCH_ENTRIES;
const JAVA_SOURCE_HEIGHT = 8 / 9;

const SIDES: readonly [number, number, number][] = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
];

const CARDINALS: readonly [number, number, number][] = [
  [0, 0, -1], // north
  [1, 0, 0], // east
  [0, 0, 1], // south
  [-1, 0, 0], // west
];

const cellKey = (x: number, y: number, z: number): string => `${x}:${y}:${z}`;

interface FluidCell {
  kind: StaticFluidKind;
  /** FlowingFluid#getOwnHeight; a source and waterlogged source are both 8/9. */
  ownHeight: number;
}

interface FluidContext {
  blocks: ReadonlyMap<string, BlueprintVoxel>;
  fluids: ReadonlyMap<string, FluidCell>;
}

/**
 * The water/lava block models in Java are particle-only placeholders. Their
 * still/flow textures are normal atlas tiles, including .mcmeta animations.
 * Static blueprint neighbors supply a deterministic approximation of Java's
 * surface slopes and flow direction; no world simulation is attempted.
 */
export function planResourceFluidBatches(
  voxels: readonly BlueprintVoxel[],
  atlas?: ResourcePackAtlas,
  neighboringVoxels: readonly BlueprintVoxel[] = voxels,
): ResourceFluidPlan {
  const context = createFluidContext(neighboringVoxels);
  const groups = new Map<string, ResourceFluidBatch>();
  const fallbackVoxels: BlueprintVoxel[] = [];
  const fallbackEntries: TexturedVoxelPlan[] = [];
  const fallbackGroups = new Map<string, ResourceFluidFallbackBatch>();
  let texturedVoxelCount = 0;
  const defaultUv = packFaceUvTransform();

  for (const voxel of voxels) {
    const kind = staticFluidKind(voxel);
    if (!kind) continue;
    const surface = calculateResourceFluidSurface(voxel, kind, context);
    const height = visibleCellHeight(voxel, kind, context);
    const faceMask = visibleFluidFaceMask(voxel, kind, context);
    if (faceMask === 0) continue;
    const still = atlas?.tiles.get(`minecraft:block/${kind}_still`);
    const flow = atlas?.tiles.get(`minecraft:block/${kind}_flow`);
    const topTile = surface.flowing ? (flow ?? still) : (still ?? flow);
    const sideTile = flow ?? still;
    const atlasUsable = atlas !== undefined
      && atlas.pages.length > 0
      && topTile !== undefined
      && sideTile !== undefined
      && atlas.pages[topTile.page] !== undefined
      && atlas.pages[sideTile.page] !== undefined;

    if (!atlasUsable) {
      const entry = makeFluidEntry(voxel, kind, surface, faceMask, defaultUv);
      fallbackVoxels.push(voxel);
      fallbackEntries.push(entry);
      appendFallbackEntry(fallbackGroups, entry, kind, height);
      continue;
    }

    const pageFaces = new Map<number, { mask: number; tiles: number[]; alphaMode: TextureAlphaMode }>();
    for (let face = 0; face < SIDES.length; face += 1) {
      if ((faceMask & (1 << face)) === 0) continue;
      const tile = face < 2 ? topTile! : sideTile!;
      const page = pageFaces.get(tile.page) ?? {
        mask: 0,
        tiles: Array(6).fill(tile.pageTextureIndex) as number[],
        alphaMode: kind === "water" ? "translucent" as const : tile.alphaMode,
      };
      page.mask |= 1 << face;
      page.tiles[face] = tile.pageTextureIndex;
      if (kind === "lava" && tile.alphaMode === "translucent") page.alphaMode = "translucent";
      pageFaces.set(tile.page, page);
    }

    for (const [page, faces] of pageFaces) {
      const entry = makeFluidEntry(voxel, kind, surface, faces.mask, defaultUv, page, faces.tiles, faces.alphaMode);
      const key = `${kind}|${height}|${page}|${faces.mask}|${faces.alphaMode}`;
      const batch = groups.get(key) ?? {
        kind, height, page, faceMask: faces.mask, alphaMode: faces.alphaMode, entries: [],
      };
      batch.entries.push(entry);
      groups.set(key, batch);
    }
    texturedVoxelCount += 1;
  }

  const batches = [...groups.values()].sort(compareFluidBatches)
    .flatMap((batch) => splitFluidEntries(batch.entries, MAX_FLUID_BATCH_ENTRIES)
      .map((entries) => ({ ...batch, entries })));
  return {
    batches,
    fallbackVoxels,
    fallbackEntries,
    fallbackBatches: splitFallbackBatches(fallbackGroups),
    texturedVoxelCount,
  };
}

/**
 * Waterlogged blocks retain their ordinary imported model. An inset translucent
 * water cube is drawn behind that model, so stairs, slabs, fences, and foliage
 * expose water only where their own depth/alpha mask leaves a gap. The fluid
 * surface uses the same bounded Java-style neighbor approximation as free water.
 */
export function planResourceWaterloggedFluidBatches(
  voxels: readonly BlueprintVoxel[],
  atlas?: ResourcePackAtlas,
  maximumBatchEntries = MAX_WATERLOGGED_FLUID_BATCH_ENTRIES,
): ResourceWaterloggedFluidPlan {
  const candidates = voxels.filter((voxel) => voxel.sourceBlockState?.waterlogged === "true");
  const safeBatchSize = Math.max(1, Math.min(MAX_WATERLOGGED_FLUID_BATCH_ENTRIES, Math.floor(maximumBatchEntries) || 1));
  const selectedSet = new Set(candidates);
  const context = createFluidContext(voxels, selectedSet);
  const groups = new Map<string, ResourceFluidBatch>();
  const fallbackVoxels: BlueprintVoxel[] = [];
  const fallbackEntries: TexturedVoxelPlan[] = [];
  const fallbackGroups = new Map<string, ResourceFluidFallbackBatch>();
  let texturedVoxelCount = 0;
  const defaultUv = packFaceUvTransform();
  const still = atlas?.tiles.get("minecraft:block/water_still");
  const flow = atlas?.tiles.get("minecraft:block/water_flow");
  const atlasUsable = !!atlas && atlas.pages.length > 0;

  for (const voxel of candidates) {
    const surface = calculateResourceFluidSurface(voxel, "water", context);
    const height = visibleCellHeight(voxel, "water", context);
    const faceMask = visibleFluidFaceMask(voxel, "water", context);
    if (faceMask === 0) continue;
    const topTile = surface.flowing ? (flow ?? still) : (still ?? flow);
    const sideTile = flow ?? still;
    const hasUsableAtlasTiles = atlasUsable
      && topTile !== undefined
      && sideTile !== undefined
      && atlas!.pages[topTile.page] !== undefined
      && atlas!.pages[sideTile.page] !== undefined;

    if (!hasUsableAtlasTiles) {
      const entry = makeFluidEntry(voxel, "water", surface, faceMask, defaultUv);
      fallbackVoxels.push(voxel);
      fallbackEntries.push(entry);
      appendFallbackEntry(fallbackGroups, entry, "water", height);
      continue;
    }

    const pageFaces = new Map<number, { mask: number; tiles: number[] }>();
    for (let face = 0; face < SIDES.length; face += 1) {
      if ((faceMask & (1 << face)) === 0) continue;
      const tile = face < 2 ? topTile! : sideTile!;
      const page = pageFaces.get(tile.page) ?? { mask: 0, tiles: Array(6).fill(tile.pageTextureIndex) as number[] };
      page.mask |= 1 << face;
      page.tiles[face] = tile.pageTextureIndex;
      pageFaces.set(tile.page, page);
    }
    for (const [page, faces] of pageFaces) {
      const entry = makeFluidEntry(voxel, "water", surface, faces.mask, defaultUv, page, faces.tiles, "translucent");
      const key = `waterlogged|${height}|${page}|${faces.mask}|translucent`;
      const batch = groups.get(key) ?? {
        kind: "water", height, page, faceMask: faces.mask, alphaMode: "translucent", waterlogged: true, entries: [],
      };
      batch.entries.push(entry);
      groups.set(key, batch);
    }
    texturedVoxelCount += 1;
  }

  return {
    batches: [...groups.values()].sort(compareFluidBatches)
      .flatMap((batch) => splitFluidEntries(batch.entries, safeBatchSize)
        .map((entries) => ({ ...batch, entries }))),
    fallbackVoxels,
    fallbackEntries,
    fallbackBatches: splitFallbackBatches(fallbackGroups, safeBatchSize),
    texturedVoxelCount,
    omittedVoxelCount: 0,
  };
}

function createFluidContext(
  voxels: readonly BlueprintVoxel[],
  selectedWaterlogged?: ReadonlySet<BlueprintVoxel>,
): FluidContext {
  const blocks = new Map<string, BlueprintVoxel>();
  const fluids = new Map<string, FluidCell>();
  const waterlogged = selectedWaterlogged ?? new Set(voxels.filter((voxel) => voxel.sourceBlockState?.waterlogged === "true"));
  for (const voxel of voxels) {
    const key = cellKey(voxel.x, voxel.y, voxel.z);
    blocks.set(key, voxel);
    const kind = staticFluidKind(voxel) ?? (waterlogged.has(voxel) ? "water" : undefined);
    if (kind) {
      fluids.set(key, {
        kind,
        ownHeight: waterlogged.has(voxel) ? JAVA_SOURCE_HEIGHT : staticFluidHeight(voxel),
      });
    }
  }
  return { blocks, fluids };
}

function visibleCellHeight(voxel: BlueprintVoxel, kind: StaticFluidKind, context: FluidContext): number {
  const own = context.fluids.get(cellKey(voxel.x, voxel.y, voxel.z));
  const above = context.fluids.get(cellKey(voxel.x, voxel.y + 1, voxel.z));
  return own?.kind === kind && above?.kind === kind ? 1 : own?.ownHeight ?? staticFluidHeight(voxel);
}

function fluidHeightAt(
  x: number,
  y: number,
  z: number,
  target: StaticFluidKind,
  context: FluidContext,
): number {
  const key = cellKey(x, y, z);
  const cell = context.fluids.get(key);
  if (cell?.kind === target) {
    return context.fluids.get(cellKey(x, y + 1, z))?.kind === target ? 1 : cell.ownHeight;
  }
  const voxel = context.blocks.get(key);
  if (!voxel || staticFluidKind(voxel) !== undefined || voxel.sourceBlockState?.waterlogged === "true") return 0;
  return isPartialFluidBlock(voxel.sourceBlockId) ? 0 : -1;
}

function calculateResourceFluidSurface(
  voxel: BlueprintVoxel,
  kind: StaticFluidKind,
  context: FluidContext,
): ResourceFluidSurface {
  const { x, y, z } = voxel;
  const current = fluidHeightAt(x, y, z, kind, context);
  const north = fluidHeightAt(x, y, z - 1, kind, context);
  const east = fluidHeightAt(x + 1, y, z, kind, context);
  const south = fluidHeightAt(x, y, z + 1, kind, context);
  const west = fluidHeightAt(x - 1, y, z, kind, context);
  const corners: ResourceFluidSurface["cornerHeights"] = [
    calculateAverageFluidHeight(north, west, fluidHeightAt(x - 1, y, z - 1, kind, context), current),
    calculateAverageFluidHeight(north, east, fluidHeightAt(x + 1, y, z - 1, kind, context), current),
    calculateAverageFluidHeight(south, east, fluidHeightAt(x + 1, y, z + 1, kind, context), current),
    calculateAverageFluidHeight(south, west, fluidHeightAt(x - 1, y, z + 1, kind, context), current),
  ];
  const flow = calculateFluidFlow(voxel, kind, context);
  return {
    cornerHeights: corners,
    flowAngleRadians: flow.angle,
    isWater: kind === "water",
    flowing: flow.flowing,
  };
}

/** Mirrors the Java 26.3 weighted four-cell corner calculation. */
export function calculateAverageFluidHeight(
  firstCardinal: number,
  secondCardinal: number,
  diagonal: number,
  current: number,
): number {
  if (firstCardinal >= 1 || secondCardinal >= 1 || diagonal >= 1) return 1;
  let sum = 0;
  let weight = 0;
  for (const height of [diagonal, current, secondCardinal, firstCardinal]) {
    if (height < 0) continue;
    const sampleWeight = height >= 0.8 ? 10 : 1;
    sum += height * sampleWeight;
    weight += sampleWeight;
  }
  return weight === 0 ? 0 : sum / weight;
}

function calculateFluidFlow(
  voxel: BlueprintVoxel,
  kind: StaticFluidKind,
  context: FluidContext,
): { flowing: boolean; angle: number } {
  const current = context.fluids.get(cellKey(voxel.x, voxel.y, voxel.z));
  const currentHeight = current?.kind === kind ? current.ownHeight : JAVA_SOURCE_HEIGHT;
  let flowX = 0;
  let flowZ = 0;
  for (const [dx, dy, dz] of CARDINALS) {
    const x = voxel.x + dx;
    const z = voxel.z + dz;
    const neighbor = context.fluids.get(cellKey(x, voxel.y + dy, z));
    let delta = 0;
    if (neighbor?.kind === kind && neighbor.ownHeight > 0) {
      delta = currentHeight - neighbor.ownHeight;
    } else if (!neighbor) {
      const neighborBlock = context.blocks.get(cellKey(x, voxel.y + dy, z));
      if (neighborBlock && !isPartialFluidBlock(neighborBlock.sourceBlockId)) continue;
      const lower = context.fluids.get(cellKey(x, voxel.y + dy - 1, z));
      if (lower?.kind !== kind || lower.ownHeight <= 0) continue;
      delta = currentHeight - lower.ownHeight - JAVA_SOURCE_HEIGHT;
    } else {
      continue;
    }
    flowX += delta * dx;
    flowZ += delta * dz;
  }
  const flowing = flowX * flowX + flowZ * flowZ > 1e-10;
  return { flowing, angle: flowing ? Math.atan2(flowZ, flowX) - Math.PI / 2 : 0 };
}

/** Known non-full Java model families used by the fluid height/flow approximation. */
function isPartialFluidBlock(sourceBlockId: string | undefined): boolean {
  if (!sourceBlockId) return false;
  const path = sourceBlockId.toLowerCase().replace(/^minecraft:/, "");
  if (["air", "cave_air", "void_air", "iron_bars", "cobweb", "lily_pad", "kelp", "seagrass", "tall_seagrass", "sugar_cane", "vine", "ladder", "chain", "tripwire", "fire", "soul_fire", "torchflower_crop"].includes(path)) return true;
  return [
    "_stairs", "_slab", "_fence", "_fence_gate", "_wall", "_pane", "_door", "_trapdoor",
    "_button", "_pressure_plate", "_sign", "_hanging_sign", "_torch", "_rod", "_rail",
    "_bed", "_carpet", "_banner", "_skull", "_head", "_flower", "_sapling", "_coral",
    "_coral_fan", "_coral_wall_fan", "_tulip", "_mushroom", "_pot", "_bush", "_crop",
    "_stem", "_roots", "_plant", "_orchid", "_allium", "_daisy", "_poppy", "_dandelion",
    "_cornflower", "_rose", "_lily", "_peony", "_lilac", "_sunflower", "_pitcher_plant",
  ].some((suffix) => path.endsWith(suffix));
}

function visibleFluidFaceMask(voxel: BlueprintVoxel, kind: StaticFluidKind, context: FluidContext): number {
  let mask = 0;
  for (let face = 0; face < SIDES.length; face += 1) {
    const [dx, dy, dz] = SIDES[face]!;
    if (context.fluids.get(cellKey(voxel.x + dx, voxel.y + dy, voxel.z + dz))?.kind === kind) continue;
    mask |= 1 << face;
  }
  return mask;
}

function makeFluidEntry(
  voxel: BlueprintVoxel,
  kind: StaticFluidKind,
  surface: ResourceFluidSurface,
  faceMask: number,
  defaultUv: readonly [number, number],
  page = -1,
  tileIndices: readonly number[] = [0, 0, 0, 0, 0, 0],
  alphaMode: TextureAlphaMode = kind === "water" ? "translucent" : "opaque",
): TexturedVoxelPlan {
  const tint = kind === "water" ? WATER_FACE_TINT : NO_FACE_TINT;
  return {
    voxel,
    page,
    faceMask,
    faceTiles: tileIndices as unknown as FaceTileIndices,
    faceUvWordsA: Array(6).fill(defaultUv[0]) as unknown as FaceUvWords,
    faceUvWordsB: Array(6).fill(defaultUv[1]) as unknown as FaceUvWords,
    faceTintWord: packFaceTintKinds(Array(6).fill(tint) as unknown as FaceTintKinds),
    faceOcclusionWord: 0,
    fluidSurface: surface,
    alphaMode,
  };
}

function appendFallbackEntry(
  groups: Map<string, ResourceFluidFallbackBatch>,
  entry: TexturedVoxelPlan,
  kind: StaticFluidKind,
  height: number,
): void {
  const key = `${kind}|${height}|${entry.faceMask}`;
  const batch = groups.get(key) ?? { kind, height, faceMask: entry.faceMask, entries: [] };
  batch.entries.push(entry);
  groups.set(key, batch);
}

function splitFallbackBatches(
  groups: ReadonlyMap<string, ResourceFluidFallbackBatch>,
  maximumBatchEntries = MAX_FLUID_BATCH_ENTRIES,
): ResourceFluidFallbackBatch[] {
  return [...groups.values()].sort((left, right) => left.kind.localeCompare(right.kind)
    || left.height - right.height || left.faceMask - right.faceMask)
    .flatMap((batch) => splitFluidEntries(batch.entries, maximumBatchEntries)
      .map((entries) => ({ ...batch, entries })));
}

function splitFluidEntries<T>(entries: readonly T[], maximumBatchEntries: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < entries.length; offset += maximumBatchEntries) {
    chunks.push(entries.slice(offset, offset + maximumBatchEntries));
  }
  return chunks;
}

function compareFluidBatches(left: ResourceFluidBatch, right: ResourceFluidBatch): number {
  return left.kind.localeCompare(right.kind) || left.height - right.height || left.page - right.page || left.faceMask - right.faceMask;
}
