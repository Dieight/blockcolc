import * as THREE from "three";
import type { BlueprintVoxel } from "./blueprint";
import { effectiveEmissionIdentity } from "./lighting";

/** A cuboid in one voxel's local coordinates; every coordinate is in [-0.5, 0.5]. */
export interface OriginalStaticShapeBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export type OriginalStaticShapeFamily =
  | "carpet"
  | "pale-moss-carpet"
  | "lever"
  | "lantern"
  | "candle"
  | "bed"
  | "sign"
  | "wall-sign"
  | "hanging-sign"
  | "wall-hanging-sign"
  | "stairs"
  | "slab"
  | "fence"
  | "wall"
  | "pane"
  | "iron-bars"
  | "door"
  | "trapdoor"
  | "ladder"
  | "fence-gate"
  | "button"
  | "pressure-plate"
  | "weighted-pressure-plate";

export type OriginalStaticShapeFallbackReason =
  | "missing-source"
  | "unknown-namespace"
  | "unsupported-block"
  | "invalid-state"
  | "budget-exceeded";

export interface OriginalStaticShapeApproximation {
  readonly kind: "original-approximation";
  readonly sourceBlockId: string;
  readonly family: OriginalStaticShapeFamily;
  /** Stable geometry identity; source material/tint intentionally stays outside this key. */
  readonly topologyKey: string;
  readonly boxes: readonly OriginalStaticShapeBox[];
  /** Component meshes share canonical geometry while per-voxel transforms carry state orientation. */
  readonly components?: readonly OriginalStaticShapeComponent[];
  readonly bounds: OriginalStaticShapeBox;
  /** Exact union volume for these non-overlapping cuboids, in voxel units cubed. */
  readonly volume: number;
}

export interface OriginalStaticShapeComponent {
  readonly key: string;
  readonly topologyKey: string;
  readonly boxes: readonly OriginalStaticShapeBox[];
  /** Column-major THREE.Matrix4 elements in local voxel coordinates. */
  readonly transform: readonly number[];
  readonly bounds: OriginalStaticShapeBox;
}

export interface OriginalStaticShapeCubeFallback {
  readonly kind: "cube-fallback";
  readonly sourceBlockId?: string;
  readonly reason: OriginalStaticShapeFallbackReason;
  readonly topologyKey: "cube:fallback";
  readonly boxes: readonly [OriginalStaticShapeBox];
  readonly bounds: OriginalStaticShapeBox;
  readonly volume: 1;
}

export type OriginalStaticShapePlan = OriginalStaticShapeApproximation | OriginalStaticShapeCubeFallback;

export interface OriginalStaticShapeEntry {
  readonly voxel: BlueprintVoxel;
  readonly shape: OriginalStaticShapePlan;
}

export interface OriginalStaticShapeBatch {
  readonly topologyKey: string;
  readonly componentKey: string;
  readonly component: OriginalStaticShapeComponent;
  readonly shape: OriginalStaticShapeApproximation;
  readonly entries: readonly OriginalStaticShapeEntry[];
}

export interface OriginalStaticShapeBatchPlan {
  readonly batches: readonly OriginalStaticShapeBatch[];
  readonly fallbackEntries: readonly OriginalStaticShapeEntry[];
  readonly budget: {
    readonly limit: number;
    readonly actual: number;
    readonly overflow: number;
  };
}

export interface OriginalStaticShapeMaterialGroup {
  readonly topologyKey: string;
  readonly componentKey: string;
  readonly component: OriginalStaticShapeComponent;
  readonly materialKey: string;
  readonly emissiveKind: string;
  readonly emissiveLevel: number;
  readonly entries: readonly OriginalStaticShapeEntry[];
}

export interface OriginalStaticShapeMaterialGroupPlan {
  readonly groups: readonly OriginalStaticShapeMaterialGroup[];
  readonly fallbackEntries: readonly OriginalStaticShapeEntry[];
  readonly limit: number;
  readonly overflow: number;
}

export interface OriginalStaticShapeEmission {
  readonly kind?: string;
  readonly level?: number;
}

/** The geometry-only renderer seam is deliberately bounded and deterministic. */
export const MAX_ORIGINAL_STATIC_SHAPE_BATCHES = 64;

const fullCell = box([0, 0, 0], [16, 16, 16]);
const FULL_CELL: GridBox = Object.freeze({ min: Object.freeze(fullCell.min), max: Object.freeze(fullCell.max) });
const SIGN_WOODS = `acacia bamboo birch cherry crimson dark_oak jungle mangrove oak pale_oak poplar spruce warped`.split(" ");

// Exact 26.3 vanilla blockstate IDs confirmed from local assets/minecraft/blockstates
// entry names. Do not replace this with suffix matching: mod/unknown IDs must stay cube.
const VANILLA_SHAPE_PATHS: Readonly<Record<OriginalStaticShapeFamily, ReadonlySet<string>>> = {
  carpet: new Set(`black_carpet blue_carpet brown_carpet cyan_carpet gray_carpet green_carpet light_blue_carpet light_gray_carpet lime_carpet magenta_carpet moss_carpet orange_carpet pink_carpet purple_carpet red_carpet white_carpet yellow_carpet`.split(" ")),
  "pale-moss-carpet": new Set(["pale_moss_carpet"]),
  lever: new Set(["lever"]),
  lantern: new Set(["lantern", "soul_lantern"]),
  candle: new Set(`candle black_candle blue_candle brown_candle cyan_candle gray_candle green_candle light_blue_candle light_gray_candle lime_candle magenta_candle orange_candle pink_candle purple_candle red_candle white_candle yellow_candle`.split(" ")),
  bed: new Set(`black_bed blue_bed brown_bed cyan_bed gray_bed green_bed light_blue_bed light_gray_bed lime_bed magenta_bed orange_bed pink_bed purple_bed red_bed straw_bed white_bed yellow_bed`.split(" ")),
  sign: new Set(SIGN_WOODS.map((wood) => `${wood}_sign`)),
  "wall-sign": new Set(SIGN_WOODS.map((wood) => `${wood}_wall_sign`)),
  "hanging-sign": new Set(SIGN_WOODS.map((wood) => `${wood}_hanging_sign`)),
  "wall-hanging-sign": new Set(SIGN_WOODS.map((wood) => `${wood}_wall_hanging_sign`)),
  stairs: new Set(`acacia_stairs andesite_stairs bamboo_mosaic_stairs bamboo_stairs birch_stairs black_concrete_stairs black_wool_stairs blackstone_stairs blue_concrete_stairs blue_wool_stairs brick_stairs brown_concrete_stairs brown_wool_stairs cherry_stairs cinnabar_brick_stairs cinnabar_stairs cobbled_deepslate_stairs cobblestone_stairs crimson_stairs cut_copper_stairs cyan_concrete_stairs cyan_wool_stairs dark_oak_stairs dark_prismarine_stairs deepslate_brick_stairs deepslate_tile_stairs diorite_stairs end_stone_brick_stairs exposed_cut_copper_stairs granite_stairs gray_concrete_stairs gray_wool_stairs green_concrete_stairs green_wool_stairs jungle_stairs light_blue_concrete_stairs light_blue_wool_stairs light_gray_concrete_stairs light_gray_wool_stairs lime_concrete_stairs lime_wool_stairs magenta_concrete_stairs magenta_wool_stairs mangrove_stairs mossy_cobblestone_stairs mossy_stone_brick_stairs mud_brick_stairs nether_brick_stairs oak_stairs orange_concrete_stairs orange_wool_stairs oxidized_cut_copper_stairs pale_oak_stairs pink_concrete_stairs pink_wool_stairs polished_andesite_stairs polished_blackstone_brick_stairs polished_blackstone_stairs polished_cinnabar_stairs polished_deepslate_stairs polished_diorite_stairs polished_granite_stairs polished_sulfur_stairs polished_tuff_stairs poplar_stairs prismarine_brick_stairs prismarine_stairs purple_concrete_stairs purple_wool_stairs purpur_stairs quartz_stairs red_concrete_stairs red_nether_brick_stairs red_sandstone_stairs red_wool_stairs resin_brick_stairs sandstone_stairs smooth_quartz_stairs smooth_red_sandstone_stairs smooth_sandstone_stairs spruce_stairs stone_brick_stairs stone_stairs sulfur_brick_stairs sulfur_stairs tuff_brick_stairs tuff_stairs warped_stairs waxed_cut_copper_stairs waxed_exposed_cut_copper_stairs waxed_oxidized_cut_copper_stairs waxed_weathered_cut_copper_stairs weathered_cut_copper_stairs white_concrete_stairs white_wool_stairs yellow_concrete_stairs yellow_wool_stairs`.split(" ")),
  slab: new Set(`acacia_slab andesite_slab bamboo_mosaic_slab bamboo_slab birch_slab black_concrete_slab black_wool_slab blackstone_slab blue_concrete_slab blue_wool_slab brick_slab brown_concrete_slab brown_wool_slab cherry_slab cinnabar_brick_slab cinnabar_slab cobbled_deepslate_slab cobblestone_slab crimson_slab cut_copper_slab cut_red_sandstone_slab cut_sandstone_slab cyan_concrete_slab cyan_wool_slab dark_oak_slab dark_prismarine_slab deepslate_brick_slab deepslate_tile_slab diorite_slab end_stone_brick_slab exposed_cut_copper_slab granite_slab gray_concrete_slab gray_wool_slab green_concrete_slab green_wool_slab jungle_slab light_blue_concrete_slab light_blue_wool_slab light_gray_concrete_slab light_gray_wool_slab lime_concrete_slab lime_wool_slab magenta_concrete_slab magenta_wool_slab mangrove_slab mossy_cobblestone_slab mossy_stone_brick_slab mud_brick_slab nether_brick_slab oak_slab orange_concrete_slab orange_wool_slab oxidized_cut_copper_slab pale_oak_slab petrified_oak_slab pink_concrete_slab pink_wool_slab polished_andesite_slab polished_blackstone_brick_slab polished_blackstone_slab polished_cinnabar_slab polished_deepslate_slab polished_diorite_slab polished_granite_slab polished_sulfur_slab polished_tuff_slab poplar_slab prismarine_brick_slab prismarine_slab purple_concrete_slab purple_wool_slab purpur_slab quartz_slab red_concrete_slab red_nether_brick_slab red_sandstone_slab red_wool_slab resin_brick_slab sandstone_slab smooth_quartz_slab smooth_red_sandstone_slab smooth_sandstone_slab smooth_stone_slab spruce_slab stone_brick_slab stone_slab sulfur_brick_slab sulfur_slab tuff_brick_slab tuff_slab warped_slab waxed_cut_copper_slab waxed_exposed_cut_copper_slab waxed_oxidized_cut_copper_slab waxed_weathered_cut_copper_slab weathered_cut_copper_slab white_concrete_slab white_wool_slab yellow_concrete_slab yellow_wool_slab`.split(" ")),
  fence: new Set(`acacia_fence bamboo_fence birch_fence cherry_fence crimson_fence dark_oak_fence jungle_fence mangrove_fence nether_brick_fence oak_fence pale_oak_fence poplar_fence spruce_fence warped_fence`.split(" ")),
  wall: new Set(`andesite_wall blackstone_wall brick_wall cinnabar_brick_wall cinnabar_wall cobbled_deepslate_wall cobblestone_wall deepslate_brick_wall deepslate_tile_wall diorite_wall end_stone_brick_wall granite_wall mossy_cobblestone_wall mossy_stone_brick_wall mud_brick_wall nether_brick_wall polished_blackstone_brick_wall polished_blackstone_wall polished_cinnabar_wall polished_deepslate_wall polished_sulfur_wall polished_tuff_wall prismarine_wall red_nether_brick_wall red_sandstone_wall resin_brick_wall sandstone_wall stone_brick_wall sulfur_brick_wall sulfur_wall tuff_brick_wall tuff_wall`.split(" ")),
  pane: new Set(`black_stained_glass_pane blue_stained_glass_pane brown_stained_glass_pane cyan_stained_glass_pane glass_pane gray_stained_glass_pane green_stained_glass_pane light_blue_stained_glass_pane light_gray_stained_glass_pane lime_stained_glass_pane magenta_stained_glass_pane orange_stained_glass_pane pink_stained_glass_pane purple_stained_glass_pane red_stained_glass_pane white_stained_glass_pane yellow_stained_glass_pane`.split(" ")),
  "iron-bars": new Set(["iron_bars"]),
  door: new Set(`acacia_door bamboo_door birch_door cherry_door copper_door crimson_door dark_oak_door exposed_copper_door iron_door jungle_door mangrove_door oak_door oxidized_copper_door pale_oak_door poplar_door spruce_door warped_door waxed_copper_door waxed_exposed_copper_door waxed_oxidized_copper_door waxed_weathered_copper_door weathered_copper_door`.split(" ")),
  trapdoor: new Set(`acacia_trapdoor bamboo_trapdoor birch_trapdoor cherry_trapdoor copper_trapdoor crimson_trapdoor dark_oak_trapdoor exposed_copper_trapdoor iron_trapdoor jungle_trapdoor mangrove_trapdoor oak_trapdoor oxidized_copper_trapdoor pale_oak_trapdoor poplar_trapdoor spruce_trapdoor warped_trapdoor waxed_copper_trapdoor waxed_exposed_copper_trapdoor waxed_oxidized_copper_trapdoor waxed_weathered_copper_trapdoor weathered_copper_trapdoor`.split(" ")),
  ladder: new Set(["ladder"]),
  "fence-gate": new Set(`acacia_fence_gate bamboo_fence_gate birch_fence_gate cherry_fence_gate crimson_fence_gate dark_oak_fence_gate jungle_fence_gate mangrove_fence_gate oak_fence_gate pale_oak_fence_gate poplar_fence_gate spruce_fence_gate warped_fence_gate`.split(" ")),
  button: new Set(`acacia_button bamboo_button birch_button cherry_button crimson_button dark_oak_button jungle_button mangrove_button oak_button pale_oak_button polished_blackstone_button poplar_button spruce_button stone_button warped_button`.split(" ")),
  "pressure-plate": new Set(`acacia_pressure_plate bamboo_pressure_plate birch_pressure_plate cherry_pressure_plate crimson_pressure_plate dark_oak_pressure_plate jungle_pressure_plate mangrove_pressure_plate oak_pressure_plate pale_oak_pressure_plate polished_blackstone_pressure_plate poplar_pressure_plate spruce_pressure_plate stone_pressure_plate warped_pressure_plate`.split(" ")),
  "weighted-pressure-plate": new Set(["heavy_weighted_pressure_plate", "light_weighted_pressure_plate"]),
};

/**
 * Build an original, deliberately approximate static silhouette for a known
 * vanilla block state. Unknown IDs and incomplete/invalid states stay an
 * explicit cube fallback; this helper never guesses from a block name alone.
 */
export function originalStaticShapeForVoxel(
  voxel: Pick<BlueprintVoxel, "sourceBlockId" | "sourceBlockState">,
): OriginalStaticShapePlan {
  const rawId = voxel.sourceBlockId?.trim().toLowerCase();
  if (!rawId) return cubeFallback(undefined, "missing-source");
  const sourceBlockId = rawId.includes(":") ? rawId : `minecraft:${rawId}`;
  if (!sourceBlockId.startsWith("minecraft:")) return cubeFallback(sourceBlockId, "unknown-namespace");
  const path = sourceBlockId.slice("minecraft:".length);
  const family = familyForPath(path);
  if (!family) return cubeFallback(sourceBlockId, "unsupported-block");
  if ((family === "carpet" && voxel.sourceBlockState !== undefined && !hasCanonicalRawStateKeysAndValues(voxel.sourceBlockState))
    || (family !== "carpet" && isRegistryExactFamily(family) && !hasCanonicalRawStateKeysAndValues(voxel.sourceBlockState))) {
    return cubeFallback(sourceBlockId, "invalid-state");
  }
  const state = family === "carpet" && voxel.sourceBlockState === undefined ? Object.freeze({}) : canonicalState(voxel.sourceBlockState);
  if (!state || !validStateFor(family, state)) return cubeFallback(sourceBlockId, "invalid-state");

  const components = componentShapes(family, path, state);
  const boxes = components
    ? components.flatMap((entry) => transformBoxes(entry.boxes, entry.transform))
    : boxesFor(family, state);
  const normalizedState = normalizedGeometryState(family, state);
  const topologyKey = components ? `${family}:components` : `${family}:${normalizedState}`;
  const frozenBoxes = Object.freeze(boxes.map((entry) => Object.freeze({
    min: Object.freeze(entry.min),
    max: Object.freeze(entry.max),
  })));
  return Object.freeze({
    kind: "original-approximation",
    sourceBlockId,
    family,
    topologyKey,
    boxes: frozenBoxes,
    ...(components ? { components: Object.freeze(components) } : {}),
    bounds: boundsOf(frozenBoxes),
    volume: Number(frozenBoxes.reduce((sum, entry) => sum + boxVolume(entry), 0).toFixed(6)),
  });
}

/** Fast ID-only filter for the scene renderer; state validation remains in the planner. */
export function isOriginalStaticShapeBlockId(sourceBlockId: string | undefined): boolean {
  const rawId = sourceBlockId?.trim().toLowerCase();
  if (!rawId) return false;
  const id = rawId.includes(":") ? rawId : `minecraft:${rawId}`;
  return id.startsWith("minecraft:") && familyForPath(id.slice("minecraft:".length)) !== null;
}

/** Create shared local geometry from the helper's box list; material remains renderer-owned. */
export function createOriginalStaticShapeGeometry(shape: OriginalStaticShapeApproximation): THREE.BufferGeometry {
  return createGeometryFromBoxes(shape.boxes);
}

export function createOriginalStaticShapeComponentGeometry(component: OriginalStaticShapeComponent): THREE.BufferGeometry {
  return createGeometryFromBoxes(component.boxes);
}

function createGeometryFromBoxes(boxes: readonly OriginalStaticShapeBox[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const cuts = [0, 1, 2].map((axis) => [...new Set(boxes.flatMap((entry) => [entry.min[axis]!, entry.max[axis]!]))].sort((a, b) => a - b));
  for (let boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
    const entry = boxes[boxIndex]!;
    for (let axis = 0; axis < 3; axis += 1) {
      const planeAxes = ([0, 1, 2] as const).filter((candidate) => candidate !== axis);
      for (const sign of [-1, 1] as const) {
        const plane = sign < 0 ? entry.min[axis]! : entry.max[axis]!;
        const firstAxis = planeAxes[0]!;
        const secondAxis = planeAxes[1]!;
        const firstCuts = [entry.min[firstAxis]!, ...cuts[firstAxis]!.filter((value) => value > entry.min[firstAxis]! && value < entry.max[firstAxis]!), entry.max[firstAxis]!];
        const secondCuts = [entry.min[secondAxis]!, ...cuts[secondAxis]!.filter((value) => value > entry.min[secondAxis]! && value < entry.max[secondAxis]!), entry.max[secondAxis]!];
        for (let first = 0; first + 1 < firstCuts.length; first += 1) {
          for (let second = 0; second + 1 < secondCuts.length; second += 1) {
            const firstMin = firstCuts[first]!;
            const firstMax = firstCuts[first + 1]!;
            const secondMin = secondCuts[second]!;
            const secondMax = secondCuts[second + 1]!;
            const firstMid = (firstMin + firstMax) / 2;
            const secondMid = (secondMin + secondMax) / 2;
            const coveredFromOutside = boxes.some((other, otherIndex) => {
              if (otherIndex === boxIndex) return false;
              const spansAcrossFace = sign < 0
                ? other.min[axis]! < plane && other.max[axis]! >= plane
                : other.min[axis]! <= plane && other.max[axis]! > plane;
              return spansAcrossFace
                && firstMid >= other.min[firstAxis]! && firstMid < other.max[firstAxis]!
                && secondMid >= other.min[secondAxis]! && secondMid < other.max[secondAxis]!;
            });
            if (coveredFromOutside) continue;
            const points = quadPoints(axis, plane, firstAxis, firstMin, firstMax, secondAxis, secondMin, secondMax, sign);
            const normal = [0, 0, 0];
            normal[axis] = sign;
            positions.push(...points[0]!, ...points[1]!, ...points[2]!, ...points[0]!, ...points[2]!, ...points[3]!);
            for (let vertex = 0; vertex < 6; vertex += 1) normals.push(...normal);
            const faceUvs = points.map((point) => [point[firstAxis]! + 0.5, point[secondAxis]! + 0.5] as const);
            uvs.push(...faceUvs[0]!, ...faceUvs[1]!, ...faceUvs[2]!, ...faceUvs[0]!, ...faceUvs[2]!, ...faceUvs[3]!);
          }
        }
      }
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  result.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

function quadPoints(
  axis: number,
  plane: number,
  firstAxis: number,
  firstMin: number,
  firstMax: number,
  secondAxis: number,
  secondMin: number,
  secondMax: number,
  sign: -1 | 1,
): Array<readonly [number, number, number]> {
  const point = (first: number, second: number): [number, number, number] => {
    const coordinates = [0, 0, 0];
    coordinates[axis] = plane;
    coordinates[firstAxis] = first;
    coordinates[secondAxis] = second;
    return coordinates as [number, number, number];
  };
  const corners = [point(firstMin, secondMin), point(firstMax, secondMin), point(firstMax, secondMax), point(firstMin, secondMax)];
  const edgeA = corners[1]!.map((value, index) => value - corners[0]![index]!);
  const edgeB = corners[2]!.map((value, index) => value - corners[0]![index]!);
  const cross = [
    edgeA[1]! * edgeB[2]! - edgeA[2]! * edgeB[1]!,
    edgeA[2]! * edgeB[0]! - edgeA[0]! * edgeB[2]!,
    edgeA[0]! * edgeB[1]! - edgeA[1]! * edgeB[0]!,
  ];
  if (Math.sign(cross[axis]!) !== sign) return [corners[0]!, corners[3]!, corners[2]!, corners[1]!];
  return corners;
}

/**
 * Group existing voxel entries by geometry only. More than `limit` distinct
 * topologies are safely returned as cube fallbacks instead of making an
 * unbounded number of renderer batches.
 */
export function planOriginalStaticShapeBatches(
  voxels: readonly BlueprintVoxel[],
  limit = MAX_ORIGINAL_STATIC_SHAPE_BATCHES,
): OriginalStaticShapeBatchPlan {
  const boundedLimit = boundedStaticShapeLimit(limit);
  const cache = new Map<string, OriginalStaticShapePlan>();
  const planned = voxels.map((voxel) => {
    const cacheKey = originalShapeCacheKey(voxel);
    let shape = cacheKey === undefined ? undefined : cache.get(cacheKey);
    if (!shape) {
      shape = originalStaticShapeForVoxel(voxel);
      if (cacheKey !== undefined) cache.set(cacheKey, shape);
    }
    return { voxel, shape };
  });
  const componentsForEntry = (entry: OriginalStaticShapeEntry): readonly OriginalStaticShapeComponent[] => (
    entry.shape.kind === "original-approximation" ? renderComponents(entry.shape) : []
  );
  const topologyKeys = [...new Set(planned.flatMap(({ voxel, shape }) => {
    if (shape.kind !== "original-approximation") return [];
    return componentsForEntry({ voxel, shape }).map((entry) => componentIdentity(entry));
  }))].sort(compareText);
  const admitted = new Set(topologyKeys.slice(0, boundedLimit));
  const groups = new Map<string, { component: OriginalStaticShapeComponent; entries: OriginalStaticShapeEntry[] }>();
  const fallbackEntries: OriginalStaticShapeEntry[] = [];
  for (const entry of planned) {
    const components = componentsForEntry(entry);
    if (entry.shape.kind === "cube-fallback" || components.some((component) => !admitted.has(componentIdentity(component)))) {
      fallbackEntries.push(entry.shape.kind === "cube-fallback" ? entry : {
        voxel: entry.voxel,
        shape: cubeFallback(entry.shape.sourceBlockId, "budget-exceeded"),
      });
      continue;
    }
    for (const component of components) {
      const identity = componentIdentity(component);
      const group = groups.get(identity) ?? { component, entries: [] };
      group.entries.push(entry);
      groups.set(identity, group);
    }
  }
  const batches = [...groups.entries()].sort(([left], [right]) => compareText(left, right)).map(([, group]) => ({
    topologyKey: group.component.topologyKey,
    componentKey: group.component.key,
    component: group.component,
    shape: group.entries[0]!.shape as OriginalStaticShapeApproximation,
    entries: Object.freeze(group.entries),
  }));
  return Object.freeze({
    batches: Object.freeze(batches),
    fallbackEntries: Object.freeze(fallbackEntries),
    budget: Object.freeze({ limit: boundedLimit, actual: Math.min(topologyKeys.length, boundedLimit), overflow: Math.max(0, topologyKeys.length - boundedLimit) }),
  });
}

/** Only validated, string-valued states enter the planner cache. Malformed
 * runtime payloads deliberately bypass it so null/arrays/primitives cannot
 * alias an omitted state or poison a later legal voxel. */
function originalShapeCacheKey(voxel: BlueprintVoxel): string | undefined {
  const rawId: unknown = voxel.sourceBlockId;
  if (typeof rawId !== "string") return undefined;
  const source = rawId.trim().toLowerCase();
  const id = source.includes(":") ? source : `minecraft:${source}`;
  const path = id.startsWith("minecraft:") ? id.slice("minecraft:".length) : "";
  const family = familyForPath(path);
  const rawState: unknown = voxel.sourceBlockState;
  if (rawState === undefined && family === "carpet") return `${id}|carpet|omitted`;
  if (rawState === null || typeof rawState !== "object" || Array.isArray(rawState)) return undefined;
  const entries = Object.entries(rawState as Record<string, unknown>);
  if (entries.some(([key, value]) => typeof key !== "string" || typeof value !== "string")) return undefined;
  const state = entries.sort(([a], [b]) => compareText(a, b)).map(([key, value]) => [key, value] as const);
  const key = `${id}|${JSON.stringify(state)}`;
  // Cache only an entry that the exact-state helper itself admits.
  return originalStaticShapeForVoxel(voxel).kind === "original-approximation" ? key : undefined;
}

/**
 * Group the admitted silhouettes by structured render identity. JSON is used
 * only as an opaque map key; renderer metadata is kept in typed fields and is
 * never recovered by splitting a delimiter-bearing topology string.
 */
export function groupOriginalStaticShapeEntries(
  plan: OriginalStaticShapeBatchPlan,
  materialKeyFor: (voxel: BlueprintVoxel, componentKey?: string) => string,
  limit = MAX_ORIGINAL_STATIC_SHAPE_BATCHES,
  emissionFor?: (voxel: BlueprintVoxel, componentKey: string) => OriginalStaticShapeEmission | undefined,
): OriginalStaticShapeMaterialGroupPlan {
  const groupsByKey = new Map<string, {
    topologyKey: string;
    materialKey: string;
    componentKey: string;
    component: OriginalStaticShapeComponent;
    emissiveKind: string;
    emissiveLevel: number;
    entries: OriginalStaticShapeEntry[];
  }>();
  for (const batch of plan.batches) {
    for (const entry of batch.entries) {
      const materialKey = materialKeyFor(entry.voxel, batch.componentKey);
      const projectedEmission = emissionFor?.(entry.voxel, batch.componentKey);
      const { kind: emissiveKind, level: emissiveLevel } = effectiveEmissionIdentity(entry.voxel, projectedEmission);
      const key = JSON.stringify([batch.topologyKey, batch.componentKey, materialKey, emissiveKind, emissiveLevel]);
      const group = groupsByKey.get(key) ?? {
        topologyKey: batch.topologyKey,
        componentKey: batch.componentKey,
        component: batch.component,
        materialKey,
        emissiveKind,
        emissiveLevel,
        entries: [],
      };
      group.entries.push(entry);
      groupsByKey.set(key, group);
    }
  }
  const sorted = [...groupsByKey.values()].sort((left, right) => compareText(
    JSON.stringify([left.topologyKey, left.componentKey, left.materialKey, left.emissiveKind, left.emissiveLevel]),
    JSON.stringify([right.topologyKey, right.componentKey, right.materialKey, right.emissiveKind, right.emissiveLevel]),
  ));
  const boundedLimit = boundedStaticShapeLimit(limit);
  const admittedKeys = new Set(sorted.slice(0, boundedLimit).map((group) => JSON.stringify([
    group.topologyKey, group.componentKey, group.materialKey, group.emissiveKind, group.emissiveLevel,
  ])));
  const entryGroups = new Map<OriginalStaticShapeEntry, Set<string>>();
  for (const group of sorted) for (const entry of group.entries) {
    const keys = entryGroups.get(entry) ?? new Set<string>();
    keys.add(JSON.stringify([group.topologyKey, group.componentKey, group.materialKey, group.emissiveKind, group.emissiveLevel]));
    entryGroups.set(entry, keys);
  }
  const acceptedEntries = new Set([...entryGroups].filter(([, keys]) => [...keys].every((key) => admittedKeys.has(key))).map(([entry]) => entry));
  const admitted = sorted.filter((group) => group.entries.some((entry) => acceptedEntries.has(entry))).map((group) => Object.freeze({
    ...group,
    entries: Object.freeze(group.entries.filter((entry) => acceptedEntries.has(entry))),
  }));
  const fallbackEntries = [
    ...plan.fallbackEntries,
    ...[...entryGroups.keys()].filter((entry) => !acceptedEntries.has(entry)).map((entry) => ({
      voxel: entry.voxel,
      shape: cubeFallback(entry.shape.sourceBlockId, "budget-exceeded"),
    })),
  ];
  return Object.freeze({
    groups: Object.freeze(admitted),
    fallbackEntries: Object.freeze(fallbackEntries),
    limit: boundedLimit,
    overflow: Math.max(0, sorted.length - boundedLimit),
  });
}

function boundedStaticShapeLimit(limit: number): number {
  const requestedLimit = Number.isNaN(limit) ? 0 : Math.floor(limit);
  return Math.min(MAX_ORIGINAL_STATIC_SHAPE_BATCHES, Math.max(0, requestedLimit));
}

type State = Readonly<Record<string, string>>;
type GridBox = { min: readonly [number, number, number]; max: readonly [number, number, number] };
type Facing = "north" | "east" | "south" | "west";

function familyForPath(path: string): OriginalStaticShapeFamily | null {
  if (!/^[a-z0-9_]+$/.test(path)) return null;
  for (const family of Object.keys(VANILLA_SHAPE_PATHS) as OriginalStaticShapeFamily[]) {
    if (VANILLA_SHAPE_PATHS[family].has(path)) return family;
  }
  return null;
}

function canonicalState(input: Readonly<Record<string, string>> | undefined): State | null {
  if (input === undefined || input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input);
  if (entries.some(([key, value]) => typeof key !== "string" || typeof value !== "string")) return null;
  return Object.freeze(Object.fromEntries(entries.map(([key, value]) => [key.toLowerCase(), value.toLowerCase()]).sort(([a], [b]) => compareText(a!, b!))));
}

function validStateFor(family: OriginalStaticShapeFamily, state: State): boolean {
  const required: Record<OriginalStaticShapeFamily, readonly string[]> = {
    carpet: [],
    "pale-moss-carpet": ["bottom", "east", "north", "south", "west"],
    lever: ["face", "facing", "powered"],
    lantern: ["hanging", "waterlogged"],
    candle: ["candles", "lit", "waterlogged"],
    bed: ["facing", "occupied", "part"],
    sign: ["rotation", "waterlogged"],
    "wall-sign": ["facing", "waterlogged"],
    "hanging-sign": ["attached", "rotation", "waterlogged"],
    "wall-hanging-sign": ["facing", "waterlogged"],
    stairs: ["facing", "half", "shape"],
    slab: ["type"],
    fence: ["north", "east", "south", "west"],
    wall: ["up", "north", "east", "south", "west"],
    pane: ["north", "east", "south", "west"],
    "iron-bars": ["north", "east", "south", "west"],
    door: ["facing", "open", "hinge", "half"],
    trapdoor: ["facing", "open", "half"],
    ladder: ["facing"],
    "fence-gate": ["facing", "in_wall", "open", "powered"],
    button: ["face", "facing", "powered"],
    "pressure-plate": ["powered"],
    "weighted-pressure-plate": ["power"],
  };
  const optional: Record<OriginalStaticShapeFamily, Readonly<Record<string, readonly string[]>>> = {
    carpet: {},
    "pale-moss-carpet": {},
    lever: {},
    lantern: {},
    candle: {},
    bed: {},
    sign: {},
    "wall-sign": {},
    "hanging-sign": {},
    "wall-hanging-sign": {},
    stairs: { waterlogged: ["true", "false"] },
    slab: { waterlogged: ["true", "false"] },
    fence: { waterlogged: ["true", "false"] },
    wall: { waterlogged: ["true", "false"] },
    pane: { waterlogged: ["true", "false"] },
    "iron-bars": { waterlogged: ["true", "false"] },
    door: { powered: ["true", "false"] },
    trapdoor: { powered: ["true", "false"], waterlogged: ["true", "false"] },
    ladder: { waterlogged: ["true", "false"] },
    "fence-gate": {},
    button: {},
    "pressure-plate": {},
    "weighted-pressure-plate": {},
  };
  const allowed = new Set([...required[family], ...Object.keys(optional[family])]);
  if (Object.keys(state).some((key) => !allowed.has(key)) || required[family].some((key) => !(key in state))) return false;
  if (family === "carpet") return Object.keys(state).length === 0;
  if (family === "pale-moss-carpet" && (!isBool(state.bottom!)
    || ["north", "east", "south", "west"].some((side) => !["none", "low", "tall"].includes(state[side]!)))) return false;
  for (const [key, value] of Object.entries(state)) {
    if (key in optional[family] && !optional[family][key]!.includes(value)) return false;
  }
  const facing = state.facing;
  if (facing !== undefined && !isFacing(facing)) return false;
  if (family === "stairs" && !["bottom", "top"].includes(state.half!)) return false;
  if (family === "stairs" && !["straight", "inner_left", "inner_right", "outer_left", "outer_right"].includes(state.shape!)) return false;
  if (family === "slab" && !["bottom", "top", "double"].includes(state.type!)) return false;
  if (family === "wall") {
    if (!isBool(state.up!) || ["north", "east", "south", "west"].some((side) => !["none", "low", "tall"].includes(state[side]!))) return false;
  }
  if (["fence", "pane", "iron-bars"].includes(family)
    && ["north", "east", "south", "west"].some((side) => !isBool(state[side]!))) return false;
  if (family === "door" && (!isBool(state.open!) || !["left", "right"].includes(state.hinge!) || !["upper", "lower"].includes(state.half!))) return false;
  if (family === "trapdoor" && (!isBool(state.open!) || !["top", "bottom"].includes(state.half!))) return false;
  if (family === "fence-gate" && (!isFacing(state.facing!) || !isBool(state.in_wall!) || !isBool(state.open!) || !isBool(state.powered!))) return false;
  if (family === "button" && (!isFacing(state.facing!) || !["floor", "wall", "ceiling"].includes(state.face!) || !isBool(state.powered!))) return false;
  if (family === "lever" && (!isFacing(state.facing!) || !["floor", "wall", "ceiling"].includes(state.face!) || !isBool(state.powered!))) return false;
  if (family === "lantern" && (!isBool(state.hanging!) || !isBool(state.waterlogged!))) return false;
  if (family === "candle" && (!/^[1-4]$/.test(state.candles!) || !isBool(state.lit!) || !isBool(state.waterlogged!))) return false;
  if (family === "bed" && (!isFacing(state.facing!) || !isBool(state.occupied!) || !["head", "foot"].includes(state.part!))) return false;
  if (["sign", "wall-sign", "hanging-sign", "wall-hanging-sign"].includes(family) && !isBool(state.waterlogged!)) return false;
  if (["sign", "hanging-sign"].includes(family) && !/^(?:[0-9]|1[0-5])$/.test(state.rotation!)) return false;
  if (family === "hanging-sign" && !isBool(state.attached!)) return false;
  if (family === "pressure-plate" && !isBool(state.powered!)) return false;
  if (family === "weighted-pressure-plate" && !/^(?:0|[1-9]|1[0-5])$/.test(state.power!)) return false;
  return true;
}

function isRegistryExactFamily(family: OriginalStaticShapeFamily): boolean {
  return family === "fence-gate" || family === "button" || family === "pressure-plate" || family === "weighted-pressure-plate"
    || family === "lever" || family === "lantern" || family === "candle" || family === "bed" || family === "pale-moss-carpet"
    || family === "sign" || family === "wall-sign" || family === "hanging-sign" || family === "wall-hanging-sign";
}

function hasCanonicalRawStateKeysAndValues(input: Readonly<Record<string, string>> | undefined): boolean {
  if (input === undefined || input === null || typeof input !== "object" || Array.isArray(input)) return false;
  return Object.entries(input).every(([key, value]) => key === key.toLowerCase() && typeof value === "string" && value === value.toLowerCase());
}

function normalizedGeometryState(family: OriginalStaticShapeFamily, state: State): string {
  if (family === "carpet") return "thin-surface";
  if (family === "pale-moss-carpet") return "component-instance";
  if (family === "lever") return "component-instance";
  if (family === "lantern") return "component-instance";
  if (family === "candle") return `component-${state.candles}`;
  if (family === "bed") return `component-${state.part}`;
  if (family === "sign" || family === "wall-sign" || family === "wall-hanging-sign") return "component-instance";
  if (family === "hanging-sign") return `component-${state.attached}`;
  if (family === "stairs") return `${state.facing}|${state.half}|${state.shape}`;
  if (family === "slab") return state.type!;
  if (family === "door") return `${state.facing}|${state.open}|${state.open === "true" ? state.hinge : "closed"}|${state.half}`;
  if (family === "trapdoor") return state.open === "true"
    ? `${state.facing}|open|${state.half}`
    : `closed|${state.half}`;
  if (family === "ladder") return state.facing!;
  if (family === "fence-gate") return `${state.facing}|${state.open}|${state.in_wall}`;
  if (family === "button") return `${state.face}|${state.facing}|${state.powered}`;
  if (family === "pressure-plate") return state.powered!;
  if (family === "weighted-pressure-plate") return state.power === "0" ? "unpressed" : "pressed";
  if (family === "wall") return `up=${state.up}|${connections(state)}`;
  return connections(state);
}

function boxesFor(family: OriginalStaticShapeFamily, state: State): GridBox[] {
  switch (family) {
    case "carpet": return [box([0.25, 0.03125, 0.25], [15.75, 1.03125, 15.75])];
    case "pale-moss-carpet": return [];
    case "lever":
    case "lantern": return [];
    case "candle": return [];
    case "bed": return [];
    case "sign":
    case "wall-sign":
    case "hanging-sign":
    case "wall-hanging-sign": return [];
    case "stairs": return stairBoxes(state.facing as Facing, state.half!, state.shape!);
    case "slab": return state.type === "bottom" ? [box([0, 0, 0], [16, 8, 16])]
      : state.type === "top" ? [box([0, 8, 0], [16, 16, 16])] : [FULL_CELL];
    case "fence": return connectedCross(state, 4, 14, 4, 11);
    case "wall": return wallBoxes(state);
    case "pane": return connectedCross(state, 2, 16, 0, 16);
    case "iron-bars": return connectedCross(state, 4, 16, 0, 16);
    case "door": return doorBoxes(state);
    case "trapdoor": return trapdoorBoxes(state);
    case "ladder": return ladderBoxes(state.facing as Facing);
    case "fence-gate": return fenceGateBoxes(state.facing as Facing, state.open === "true", state.in_wall === "true");
    case "button": return buttonBoxes(state.face!, state.facing as Facing, state.powered === "true");
    case "pressure-plate": return pressurePlateBoxes(state.powered === "true");
    case "weighted-pressure-plate": return pressurePlateBoxes(state.power !== "0");
  }
}

function componentShapes(family: OriginalStaticShapeFamily, path: string, state: State): OriginalStaticShapeComponent[] | undefined {
  if (family === "carpet") return [makeComponent("carpet", "carpet:thin-surface", boxesFor(family, state))];
  if (family === "sign" || family === "wall-sign" || family === "hanging-sign" || family === "wall-hanging-sign") {
    // Measured against the Java 26.3 template_*_sign models. Thin chain and
    // sign-face planes get a small solid thickness to survive distant LOD.
    const standing = family === "sign";
    const hanging = family === "hanging-sign" || family === "wall-hanging-sign";
    const wallHanging = family === "wall-hanging-sign";
    const board = standing
      ? box([0, 9.333, 7.333], [16, 17.333, 8.667])
      : hanging ? box([1, 0, 7], [15, 10, 9]) : box([0, 4.333, 0.333], [16, 12.333, 1.667]);
    const support = standing
      ? [box([7.333, 0, 7.333], [8.667, 9.333, 8.667])]
      : wallHanging ? [
        box([0, 14, 6], [16, 16, 10]),
        box([1, 10, 7.5], [2, 14, 8.5]), box([14, 10, 7.5], [15, 14, 8.5]),
      ] : family === "hanging-sign" ? state.attached === "true"
        ? [box([2, 10, 7.6], [14, 16, 8.4])]
        : [
          box([2, 10, 7.5], [3, 16, 8.5]), box([13, 10, 7.5], [14, 16, 8.5]),
          box([2, 14.5, 7.5], [5, 15.5, 8.5]), box([11, 14.5, 7.5], [14, 15.5, 8.5]),
        ] : [];
    const yaw = family === "sign" || family === "hanging-sign"
      ? Number(state.rotation) * Math.PI / 8
      : state.facing === "south" ? 0 : state.facing === "north" ? Math.PI
        : state.facing === "east" ? -Math.PI / 2 : Math.PI / 2;
    const orientation = matrixElements(new THREE.Matrix4().makeRotationY(yaw));
    return [
      makeComponent(`${family}-board`, `${family}:board`, [board], orientation),
      ...(support.length > 0 ? [makeComponent(`${family}-support`, `${family}:support:${state.attached ?? "fixed"}`, support, orientation)] : []),
    ];
  }
  if (family === "pale-moss-carpet") {
    const sides = ["north", "east", "south", "west"] as const;
    const isolated = state.bottom === "false" && sides.every((side) => state[side] === "none");
    // Java 26.3's multipart model supplies a carpet top for bottom=true or
    // an isolated block, then low/tall side sprites. The sprites are planar;
    // four broad, staggered tufts per side remain readable from our camera.
    const components: OriginalStaticShapeComponent[] = [];
    if (state.bottom === "true" || isolated) {
      components.push(makeComponent("pale-moss-base", "pale-moss:base", [box([0.25, 0.03125, 0.25], [15.75, 1.03125, 15.75])]));
    }
    for (const [index, side] of sides.entries()) {
      const height = isolated ? "tall" : state[side];
      if (height === "none") continue;
      const heights = height === "low" ? [7, 9, 10, 8] : [14, 16, 15, 13];
      const tufts = heights.map((top, tuft) => box([0.5 + tuft * 4, 0, 0], [3.5 + tuft * 4, top, 0.25]));
      const yaw = [0, -Math.PI / 2, Math.PI, Math.PI / 2][index]!;
      components.push(makeComponent(`pale-moss-${side}-${height}`, `pale-moss:side:${height}`, tufts,
        matrixElements(new THREE.Matrix4().makeRotationY(yaw))));
    }
    return components;
  }
  if (family === "lever") {
    const face = state.face!;
    const facing = state.facing as Facing;
    const angle = state.powered === "true" ? Math.PI / 4 : -Math.PI / 4;
    const orientation = new THREE.Matrix4();
    const facingYaw = facing === "north" ? 0 : facing === "east" ? -Math.PI / 2 : facing === "south" ? Math.PI : Math.PI / 2;
    // Ceiling mounts flip the lever axis; compensate one half-turn so the
    // blockstate facing still names the visible handle's cardinal direction.
    const rotateFacing = new THREE.Matrix4().makeRotationY(facingYaw + (face === "ceiling" ? Math.PI : 0));
    const mount = new THREE.Matrix4().makeRotationX(face === "wall" ? -Math.PI / 2 : face === "ceiling" ? Math.PI : 0);
    orientation.multiplyMatrices(rotateFacing, mount);
    const rodTransform = orientation.clone()
      .multiply(new THREE.Matrix4().makeTranslation(0, -0.375, 0))
      .multiply(new THREE.Matrix4().makeRotationX(angle))
      .multiply(new THREE.Matrix4().makeTranslation(0, 0.18, 0));
    return [
      makeComponent("lever-base", "lever:stone-base", [box([5, 0, 5], [11, 2, 11])], matrixElements(orientation)),
      makeComponent("lever-handle", "lever:handle", [box([7, 5, 7], [9, 11, 9])], matrixElements(rodTransform)),
    ];
  }
  if (family === "lantern") {
    const hanging = state.hanging === "true";
    const lower = hanging ? 3 : 0;
    const upper = hanging ? 12 : 9;
    const frame = [
      box([4, lower, 4], [5, upper, 5]), box([11, lower, 4], [12, upper, 5]),
      box([4, lower, 11], [5, upper, 12]), box([11, lower, 11], [12, upper, 12]),
      box([4, lower, 4], [12, lower + 1, 12]), box([4, upper - 1, 4], [12, upper, 12]),
      ...(hanging ? [box([7, 12, 7], [9, 16, 9])] : [box([7, 9, 7], [9, 11, 9])]),
    ];
    const core = [box([5, 1, 5], [11, 7, 11])];
    const shade = path === "soul_lantern" ? "soul" : "warm";
    const coreTransform = hanging
      ? matrixElements(new THREE.Matrix4().makeTranslation(0, 3 / 16, 0))
      : undefined;
    return [
      makeComponent("lantern-frame", `lantern:frame:${hanging ? "hanging" : "standing"}`, frame),
      makeComponent(`lantern-core-${shade}`, `lantern:core:${shade}`, core, coreTransform),
    ];
  }
  if (family === "candle") {
    // Body positions/heights follow Java 26.3 template_{one,two,three,four}_candles.
    // The crossed, zero-thickness vanilla wick is represented by a small solid
    // tip so it remains legible from the app's distant overhead camera.
    const bodies = [
      [[7, 0, 7, 9, 6, 9]],
      [[5, 0, 7, 7, 5, 9], [9, 0, 6, 11, 6, 8]],
      [[7, 0, 9, 9, 3, 11], [5, 0, 7, 7, 5, 9], [8, 0, 6, 10, 6, 8]],
      [[6, 0, 8, 8, 3, 10], [9, 0, 8, 11, 5, 10], [5, 0, 5, 7, 5, 7], [8, 0, 5, 10, 6, 7]],
    ][Number(state.candles) - 1]!;
    const wax = bodies.map(([x0, y0, z0, x1, y1, z1]) => box([x0!, y0!, z0!], [x1!, y1!, z1!]));
    const wicks = bodies.map(([x0, , z0, x1, y1, z1]) => {
      const centerX = (x0! + x1!) / 2;
      const centerZ = (z0! + z1!) / 2;
      return box([centerX - 0.3, y1!, centerZ - 0.3], [centerX + 0.3, y1! + 0.9, centerZ + 0.3]);
    });
    return [
      makeComponent("candle-wax", `candle:wax:${state.candles}`, wax),
      makeComponent("candle-wick", `candle:wick:${state.candles}`, wicks),
    ];
  }
  if (family === "bed") {
    const facing = state.facing as Facing;
    const yaw = facing === "north" ? 0 : facing === "east" ? -Math.PI / 2 : facing === "south" ? Math.PI : Math.PI / 2;
    // Straw bed's official model faces south at zero blockstate rotation;
    // coloured beds face north. Keep those source-specific bases distinct.
    const orientation = matrixElements(new THREE.Matrix4().makeRotationY(yaw + (path === "straw_bed" ? Math.PI : 0)));
    const head = state.part === "head";
    if (path === "straw_bed") {
      const base = head ? [box([0, 0, 0], [16, 4, 8])] : [box([0, 0, 0], [16, 4, 16])];
      return [
        makeComponent("bed-straw-base", `bed:straw-base:${state.part}`, base, orientation),
        ...(head ? [makeComponent("bed-straw-pillow", "bed:straw-pillow", [box([0, 0, 8], [16, 5, 16])], orientation)] : []),
      ];
    }
    const legs = head
      ? [box([0, 0, 0], [3, 3, 3]), box([13, 0, 0], [16, 3, 3])]
      : [box([0, 0, 13], [3, 3, 16]), box([13, 0, 13], [16, 3, 16])];
    return [
      makeComponent("bed-cover", "bed:cover", [box([0, 3, 0], [16, 9, 16])], orientation),
      makeComponent("bed-legs", `bed:legs:${state.part}`, legs, orientation),
      ...(head ? [makeComponent("bed-pillow", "bed:pillow", [box([1, 9, 1], [15, 9.5, 6])], orientation)] : []),
    ];
  }
  return undefined;
}

function makeComponent(
  key: string,
  topologyKey: string,
  boxes: readonly OriginalStaticShapeBox[],
  transform: readonly number[] = matrixElements(new THREE.Matrix4()),
): OriginalStaticShapeComponent {
  const frozenBoxes = Object.freeze(boxes.map((entry) => Object.freeze({
    min: Object.freeze(entry.min), max: Object.freeze(entry.max),
  })));
  return Object.freeze({ key, topologyKey, boxes: frozenBoxes, transform: Object.freeze([...transform]), bounds: transformedBounds(frozenBoxes, transform) });
}

function renderComponents(shape: OriginalStaticShapeApproximation): readonly OriginalStaticShapeComponent[] {
  return shape.components ?? [makeComponent(shape.family, shape.topologyKey, shape.boxes)];
}

function componentIdentity(component: OriginalStaticShapeComponent): string {
  return JSON.stringify([component.key, component.topologyKey]);
}

function matrixElements(matrix: THREE.Matrix4): readonly number[] {
  return Object.freeze([...matrix.elements]);
}

function transformBoxes(boxes: readonly OriginalStaticShapeBox[], elements: readonly number[]): OriginalStaticShapeBox[] {
  const matrix = new THREE.Matrix4().fromArray([...elements]);
  return boxes.map((entry) => {
    const points: THREE.Vector3[] = [];
    for (const x of [entry.min[0], entry.max[0]]) for (const y of [entry.min[1], entry.max[1]]) for (const z of [entry.min[2], entry.max[2]]) {
      points.push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
    }
    return Object.freeze({
      min: Object.freeze([0, 1, 2].map((axis) => Math.min(...points.map((point) => point.getComponent(axis)))) as unknown as readonly [number, number, number]),
      max: Object.freeze([0, 1, 2].map((axis) => Math.max(...points.map((point) => point.getComponent(axis)))) as unknown as readonly [number, number, number]),
    });
  });
}

function transformedBounds(boxes: readonly OriginalStaticShapeBox[], elements: readonly number[]): OriginalStaticShapeBox {
  return boundsOf(transformBoxes(boxes, elements));
}

function stairBoxes(facing: Facing, half: string, shape: string): GridBox[] {
  const boxes: GridBox[] = [half === "bottom" ? box([0, 0, 0], [16, 8, 16]) : box([0, 8, 0], [16, 16, 16])];
  const highRow = facing === "north" ? 0 : facing === "south" ? 1 : facing === "west" ? 0 : 1;
  const rowAxis = facing === "north" || facing === "south" ? "z" : "x";
  const facingSign = facing === "north" || facing === "west" ? -1 : 1;
  const leftSign = facing === "north" || facing === "east" ? -1 : 1;
  let cells = shape.startsWith("inner") ? [[highRow, 0], [highRow, 1]] : shape.startsWith("outer") ? [] : [[highRow, 0], [highRow, 1]];
  if (shape.startsWith("inner")) {
    const isLeft = shape.endsWith("left");
    cells = [...cells, [1 - highRow, isLeft === (leftSign < 0) ? 0 : 1]];
  } else if (shape.startsWith("outer")) {
    const isLeft = shape.endsWith("left");
    cells = [[highRow, isLeft === (leftSign < 0) ? 0 : 1]];
  }
  for (const [row, column] of cells) {
    const along = row === highRow ? (facingSign < 0 ? 0 : 8) : (facingSign < 0 ? 8 : 0);
    const across = column === 0 ? 0 : 8;
    const x0 = rowAxis === "x" ? along : across;
    const z0 = rowAxis === "z" ? along : across;
    boxes.push(half === "bottom" ? box([x0, 8, z0], [x0 + 8, 16, z0 + 8]) : box([x0, 0, z0], [x0 + 8, 8, z0 + 8]));
  }
  return boxes;
}

function connectedCross(state: State, width: number, height: number, armMinY: number, armMaxY: number): GridBox[] {
  const inset = (16 - width) / 2;
  const boxes = [box([inset, 0, inset], [inset + width, height, inset + width])];
  for (const side of ["north", "east", "south", "west"] as const) {
    if (state[side] !== "true") continue;
    if (side === "north") boxes.push(box([inset, armMinY, 0], [inset + width, armMaxY, inset]));
    if (side === "south") boxes.push(box([inset, armMinY, inset + width], [inset + width, armMaxY, 16]));
    if (side === "west") boxes.push(box([0, armMinY, inset], [inset, armMaxY, inset + width]));
    if (side === "east") boxes.push(box([inset + width, armMinY, inset], [16, armMaxY, inset + width]));
  }
  return boxes;
}

function wallBoxes(state: State): GridBox[] {
  const sideNames = ["north", "east", "south", "west"] as const;
  const connected = sideNames.filter((side) => state[side] !== "none");
  const boxes: GridBox[] = [];
  const postHeight = state.up === "true" || connected.some((side) => state[side] === "tall")
    ? 16 : 12;
  // The post joins every arm even when the vanilla `up` property suppresses
  // the tall central nub; omitting it would make each side a disconnected bar.
  boxes.push(box([4, 0, 4], [12, postHeight, 12]));
  for (const side of connected) {
    const tall = state[side] === "tall";
    const bottom = 0;
    const top = tall ? 16 : 12;
    if (side === "north") boxes.push(box([5, bottom, 0], [11, top, 4]));
    if (side === "south") boxes.push(box([5, bottom, 12], [11, top, 16]));
    if (side === "west") boxes.push(box([0, bottom, 5], [4, top, 11]));
    if (side === "east") boxes.push(box([12, bottom, 5], [16, top, 11]));
  }
  return boxes;
}

function doorBoxes(state: State): GridBox[] {
  let panel: GridBox;
  // Each lower/upper half is a full block tall; two neighboring voxel layers
  // therefore meet continuously instead of leaving a one-block vertical gap.
  const y0 = 0;
  const y1 = 16;
  if (state.open === "false") panel = box([0, y0, 0], [16, y1, 2]);
  else panel = state.hinge === "left" ? box([0, y0, 0], [2, y1, 16]) : box([14, y0, 0], [16, y1, 16]);
  return [rotateBox(panel, state.facing as Facing)];
}

function trapdoorBoxes(state: State): GridBox[] {
  const y0 = state.half === "bottom" ? 0 : 14;
  const y1 = y0 + 2;
  if (state.open === "false") return [box([0, y0, 0], [16, y1, 16])];
  const panel = box([0, 0, 0], [16, 16, 2]);
  return [rotateBox(panel, state.facing as Facing)];
}

function ladderBoxes(facing: Facing): GridBox[] {
  return [rotateBox(box([2, 0, 0], [14, 16, 2]), facing)];
}

function fenceGateBoxes(facing: Facing, open: boolean, inWall: boolean): GridBox[] {
  const top = inWall ? 12 : 16;
  const railTop = top;
  const railBottom = top - 2;
  const boxes: GridBox[] = [];
  if (!open) {
    for (const [x0, x1] of [[0, 2], [6, 7], [9, 10], [14, 16]] as const) {
      boxes.push(box([x0, 0, 7], [x1, top, 9]));
    }
    for (const [x0, x1] of [[2, 6], [10, 14]] as const) {
      boxes.push(box([x0, 2, 7], [x1, 4, 9]));
      boxes.push(box([x0, railBottom, 7], [x1, railTop, 9]));
    }
  } else {
    for (const [x0, x1] of [[0, 2], [14, 16]] as const) {
      boxes.push(box([x0, 0, 0], [x1, top, 2]));
      boxes.push(box([x0, 0, 6], [x1, top, 8]));
      boxes.push(box([x0, 2, 2], [x1, 4, 6]));
      boxes.push(box([x0, railBottom, 2], [x1, railTop, 6]));
    }
  }
  return boxes.map((entry) => rotateBox(entry, facing));
}

function buttonBoxes(face: string, facing: Facing, powered: boolean): GridBox[] {
  const height = powered ? 2 : 3;
  if (face === "floor") return [rotateBox(box([5, 0, 3], [11, height, 11]), facing)];
  if (face === "ceiling") return [rotateBox(box([5, 16 - height, 3], [11, 16, 11]), facing)];
  return [rotateBox(box([5, 5, 16 - height], [11, 11, 16]), facing)];
}

function pressurePlateBoxes(powered: boolean): GridBox[] {
  return [box([1, 0, 1], [15, powered ? 1 : 2, 15])];
}

function rotateBox(source: GridBox, facing: Facing): GridBox {
  const turns = facing === "north" ? 0 : facing === "east" ? 1 : facing === "south" ? 2 : 3;
  const points: Array<readonly [number, number, number]> = [];
  for (const x of [source.min[0], source.max[0]]) for (const y of [source.min[1], source.max[1]]) for (const z of [source.min[2], source.max[2]]) {
    let nextX = x;
    let nextZ = z;
    for (let index = 0; index < turns; index += 1) [nextX, nextZ] = [-nextZ, nextX];
    points.push([nextX, y, nextZ]);
  }
  return {
    min: [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1])), Math.min(...points.map((point) => point[2]))],
    max: [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1])), Math.max(...points.map((point) => point[2]))],
  };
}

function connections(state: State): string {
  return (["north", "east", "south", "west"] as const).map((side) => `${side}=${state[side]}`).join(",");
}

function box(min: readonly [number, number, number], max: readonly [number, number, number]): GridBox {
  const normalizedMin = min.map((value) => value / 16 - 0.5) as unknown as readonly [number, number, number];
  const normalizedMax = max.map((value) => value / 16 - 0.5) as unknown as readonly [number, number, number];
  return { min: normalizedMin, max: normalizedMax };
}

function boundsOf(boxes: readonly OriginalStaticShapeBox[]): OriginalStaticShapeBox {
  if (boxes.length === 0) return FULL_CELL;
  return Object.freeze({
    min: Object.freeze([0, 1, 2].map((axis) => Math.min(...boxes.map((entry) => entry.min[axis]!))) as unknown as readonly [number, number, number]),
    max: Object.freeze([0, 1, 2].map((axis) => Math.max(...boxes.map((entry) => entry.max[axis]!))) as unknown as readonly [number, number, number]),
  });
}

function boxVolume(entry: OriginalStaticShapeBox): number {
  return (entry.max[0] - entry.min[0]) * (entry.max[1] - entry.min[1]) * (entry.max[2] - entry.min[2]);
}

function cubeFallback(sourceBlockId: string | undefined, reason: OriginalStaticShapeFallbackReason): OriginalStaticShapeCubeFallback {
  return Object.freeze({
    kind: "cube-fallback",
    ...(sourceBlockId === undefined ? {} : { sourceBlockId }),
    reason,
    topologyKey: "cube:fallback",
    boxes: Object.freeze([FULL_CELL] as const),
    bounds: FULL_CELL,
    volume: 1,
  });
}

function isFacing(value: string): value is Facing {
  return value === "north" || value === "east" || value === "south" || value === "west";
}

function isBool(value: string): boolean {
  return value === "true" || value === "false";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
