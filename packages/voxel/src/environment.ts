import type { BlueprintV1, BlueprintVoxel } from "./blueprint";

export type WeatherKind = "clear" | "cloudy" | "rain" | "mist" | "snow";

/**
 * Small, renderer-facing projection of an external current-weather response.
 * Intensities are normalized to 0..1; values outside the range are clamped.
 */
export interface ExternalWeatherVisualOverride {
  kind: WeatherKind;
  /** Cloud cover mapped by the caller from the provider's cloud percentage. */
  cloudIntensity?: number;
  /** Precipitation strength; used for either rain or snow particles. */
  precipitationIntensity?: number;
}

export interface WeatherState {
  localDate: string;
  kind: WeatherKind;
  seed: number;
  cloudCount: number;
  cloudIntensity: number;
  rainDropCount: number;
  snowFlakeCount: number;
  precipitationIntensity: number;
}

/** Weather probability may vary by environment; this visual response does not. */
export interface WeatherVisual {
  tint: number | null;
  cloudBlend: number;
  starVisibilityScale: number;
  sunlightScale: number;
}

const WEATHER_VISUALS: Readonly<Record<WeatherKind, WeatherVisual>> = Object.freeze({
  clear: Object.freeze({ tint: null, cloudBlend: 0, starVisibilityScale: 1, sunlightScale: 1 }),
  cloudy: Object.freeze({ tint: 0x9eada8, cloudBlend: 0.28, starVisibilityScale: 0.28, sunlightScale: 0.82 }),
  rain: Object.freeze({ tint: 0x9eada8, cloudBlend: 0.42, starVisibilityScale: 0.05, sunlightScale: 0.64 }),
  mist: Object.freeze({ tint: 0xaeb8b1, cloudBlend: 0.28, starVisibilityScale: 0.12, sunlightScale: 0.76 }),
  snow: Object.freeze({ tint: 0xb2c0c8, cloudBlend: 0.36, starVisibilityScale: 0.08, sunlightScale: 0.72 }),
});

export interface FogRange {
  near: number;
  far: number;
}

export type DecorationKind = "tree" | "road" | "lamp" | "bench";

/**
 * Decorations that belong to the derived environment presentation. These are
 * deliberately separate from `DecorationKind`: the latter is the persisted
 * daily-goal/reward projection and must never be re-ordered or counted as an
 * earned reward.
 */
export type AmbientDecorationKind = "flower" | "grass-tuft" | "rock" | "reed" | "coral" | "shipwreck";

export type EnvironmentStyle = "natural-valley" | "classic-island" | "ocean-island";

export interface AmbientDecorationPlacement {
  id: string;
  kind: AmbientDecorationKind;
  /** Blueprint-local coordinates before the placement's blueprint offset. */
  x: number;
  z: number;
  variant: number;
  scale: number;
  castsShadow: boolean;
}

export interface AmbientDecorationBudget {
  maxInstances: number;
  maxDrawCalls: number;
  maxShadowCasters: number;
}

export const AMBIENT_DECORATION_BUDGETS: Readonly<Record<EnvironmentStyle, AmbientDecorationBudget>> = Object.freeze({
  "natural-valley": Object.freeze({ maxInstances: 24, maxDrawCalls: 4, maxShadowCasters: 2 }),
  "classic-island": Object.freeze({ maxInstances: 20, maxDrawCalls: 3, maxShadowCasters: 2 }),
  "ocean-island": Object.freeze({ maxInstances: 18, maxDrawCalls: 4, maxShadowCasters: 2 }),
});

export interface CloudBudgetInput {
  previewMode: boolean;
  weatherCloudCount: number;
  weatherDensity: number;
  weatherKind: WeatherKind;
  contentWidth: number;
  contentDepth: number;
  visibleWidth: number;
  visibleDepth: number;
}

export interface CloudBudget {
  cloudCount: number;
  maxInstances: number;
  blockScale: number;
  spanX: number;
  spanZ: number;
  previewMode: boolean;
}

export interface DecorationPlacement {
  id: string;
  date: string;
  kind: DecorationKind;
  x: number;
  z: number;
  variant: number;
}

export interface ConditionVisual {
  intactVoxels: BlueprintVoxel[];
  missingVoxels: BlueprintVoxel[];
  vines: VinePlacement[];
  weathering: number;
}

export interface VinePlacement {
  x: number;
  y: number;
  z: number;
  axis: "x" | "z";
}

const ISO_LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDateForDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function weatherForLocalDate(localDate: string, ocean = false): WeatherState {
  assertLocalDate(localDate);
  const seed = hash32(`weather:${localDate}`);
  const roll = seed % 100;
  // V24: ocean environments lean toward sea fog — the sea horizon reads soft
  // and layered instead of a hard blue line.
  const kind: WeatherKind = ocean
    ? (roll < 34 ? "clear" : roll < 60 ? "cloudy" : roll < 72 ? "rain" : "mist")
    : (roll < 50 ? "clear" : roll < 75 ? "cloudy" : roll < 90 ? "rain" : "mist");
  return {
    localDate,
    kind,
    seed,
    cloudCount: kind === "clear" ? 2 : kind === "cloudy" ? 9 : kind === "rain" ? 12 : 6,
    cloudIntensity: (kind === "clear" ? 2 : kind === "cloudy" ? 9 : kind === "rain" ? 12 : 6) / 12,
    rainDropCount: kind === "rain" ? 72 : 0,
    snowFlakeCount: 0,
    precipitationIntensity: kind === "rain" ? 1 : 0,
  };
}

/** Builds the visual state shared by valleys and islands from a provider value. */
export function weatherForExternalOverride(localDate: string, override: ExternalWeatherVisualOverride): WeatherState {
  assertLocalDate(localDate);
  const defaultCloudIntensity: Record<WeatherKind, number> = {
    clear: 2 / 12,
    cloudy: 9 / 12,
    rain: 1,
    mist: 6 / 12,
    snow: 9 / 12,
  };
  const defaultPrecipitationIntensity = override.kind === "rain" ? 1 : override.kind === "snow" ? 0.55 : 0;
  const cloudIntensity = normalizedIntensity(override.cloudIntensity, defaultCloudIntensity[override.kind]);
  const precipitationIntensity = normalizedIntensity(override.precipitationIntensity, defaultPrecipitationIntensity);
  const cloudCount = Math.round(cloudIntensity * 12);
  const rainDropCount = override.kind === "rain" ? Math.round(72 * precipitationIntensity) : 0;
  const snowFlakeCount = override.kind === "snow" ? Math.round(96 * precipitationIntensity) : 0;
  return {
    localDate,
    kind: override.kind,
    seed: hash32(`weather:external:${localDate}:${override.kind}:${cloudIntensity}:${precipitationIntensity}`),
    cloudCount,
    cloudIntensity,
    rainDropCount,
    snowFlakeCount,
    precipitationIntensity,
  };
}

/** Weather tint/cloud/star response is common across the environment layouts. */
export function sunlightScaleForWeather(weather: Pick<WeatherState, "kind" | "cloudIntensity">): number {
  const fullCloudScale = WEATHER_VISUALS[weather.kind].sunlightScale;
  const cloudIntensity = normalizedIntensity(weather.cloudIntensity, 1);
  return 1 - (1 - fullCloudScale) * cloudIntensity;
}

export function weatherVisualForKind(kind: WeatherKind): WeatherVisual {
  return WEATHER_VISUALS[kind];
}

/**
 * Keeps cloud density in the coordinate system that owns the scene. Main-world
 * weather may cover the full visibility envelope, while a blueprint preview is
 * a small independent scene. The old renderer multiplied preview density by
 * the 128x128 preview terrain / 18x18 building area, producing a main-world
 * cloud pile over a small model. This bounded budget is deterministic and keeps
 * cloud scale proportional to the previewed building without changing the main
 * settlement envelope.
 */
export function cloudBudgetForView(input: CloudBudgetInput): CloudBudget {
  const contentWidth = finitePositive(input.contentWidth, 18);
  const contentDepth = finitePositive(input.contentDepth, 18);
  const visibleWidth = finitePositive(input.visibleWidth, contentWidth);
  const visibleDepth = finitePositive(input.visibleDepth, contentDepth);
  const density = Math.max(0, Number.isFinite(input.weatherDensity) ? input.weatherDensity : 1);
  const weatherCloudCount = Math.max(0, Math.round(Number.isFinite(input.weatherCloudCount) ? input.weatherCloudCount : 0));
  if (input.previewMode) {
    const contentSpan = Math.max(contentWidth, contentDepth);
    // A compact imported blueprint used to inherit a 0.9 minimum block scale
    // and two full multi-block clusters. On a 10-12 block model that becomes a
    // ceiling of enormous white cubes. Previews use at most one small cluster
    // for ordinary buildings; larger blueprints can earn a second/third cloud.
    const cloudCount = weatherCloudCount === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(contentSpan / 18)));
    const blockScale = clamp(contentSpan / 60, 0.2, 0.65);
    return {
      cloudCount,
      maxInstances: Math.min(80, Math.max(12, cloudCount * 8)),
      blockScale,
      spanX: Math.max(12, contentWidth * 1.15),
      spanZ: Math.max(10, contentDepth * 1.15),
      previewMode: true,
    };
  }
  const compact = visibleWidth < contentWidth * 2.2 && visibleDepth < contentDepth * 2.2;
  const contentArea = Math.max(1, contentWidth * contentDepth);
  const spreadRatio = Math.min(24, Math.max(1, (visibleWidth * visibleDepth) / contentArea));
  return {
    cloudCount: weatherCloudCount === 0 ? 0 : Math.min(compact ? 40 : 85, Math.max(1, Math.round(weatherCloudCount * density * spreadRatio))),
    maxInstances: 900,
    blockScale: 1,
    spanX: compact ? Math.max(32, visibleWidth * 1.05) : Math.max(32, visibleWidth + 24),
    spanZ: compact ? Math.max(28, visibleDepth * 1.05) : Math.max(28, visibleDepth + 24),
    previewMode: false,
  };
}

/**
 * Generates only derived, environment-owned ambient props. The placement is
 * intentionally local to a building so settlement identities and persisted
 * reward positions never move when the environment is regenerated.
 */
export function ambientDecorationsForWorld(input: {
  projectId: string;
  blueprint: BlueprintV1;
  environmentStyle: EnvironmentStyle;
  worldSeed?: string;
}): AmbientDecorationPlacement[] {
  const { minX, maxX, minZ, maxZ } = input.blueprint.bounds;
  const width = Math.max(1, maxX - minX + 1);
  const depth = Math.max(1, maxZ - minZ + 1);
  const budget = AMBIENT_DECORATION_BUDGETS[input.environmentStyle];
  // Four instances were too sparse for a framed island scene: even when all
  // candidates survived road/building avoidance they were tiny in the default
  // camera, and the old slot walk selected only the first two perimeter edges.
  // Keep at least two candidates per side so every settlement has a visible
  // foreground prop regardless of which way its entrance faces.
  const count = Math.min(budget.maxInstances, Math.max(8, Math.ceil(Math.max(width, depth) / 2.8)));
  const seedPrefix = `ambient:${input.worldSeed ?? "world-default"}:${input.environmentStyle}:${input.projectId}`;
  const slots = ambientSlots(minX, maxX, minZ, maxZ, count);
  const result: AmbientDecorationPlacement[] = [];
  let shipwreckAdded = false;
  let shadowCasters = 0;
  for (let index = 0; index < slots.length && result.length < count; index += 1) {
    const slot = slots[index]!;
    const seed = hash32(`${seedPrefix}:${index}`);
    const kind = ambientKindFor(seed, input.environmentStyle, shipwreckAdded);
    if (kind === "shipwreck") shipwreckAdded = true;
    const castsShadow = (kind === "rock" || kind === "shipwreck")
      && shadowCasters < budget.maxShadowCasters;
    if (castsShadow) shadowCasters += 1;
    result.push({
      id: `${seedPrefix}:${index}`,
      kind,
      x: slot.x,
      z: slot.z,
      variant: (seed >>> 16) % 4,
      scale: 0.72 + ((seed >>> 24) % 40) / 100,
      castsShadow,
    });
  }
  return result;
}

export function fogRangeForView(kind: WeatherKind, cameraDistance: number, contentRadius: number, _ocean = false): FogRange {
  const distance = Math.max(1, Number.isFinite(cameraDistance) ? cameraDistance : 1);
  const radius = Math.max(6, Number.isFinite(contentRadius) ? contentRadius : 6);
  if (kind === "mist") {
    return { near: Math.max(18, distance - radius * 0.15), far: distance + radius * 3.2 };
  }
  if (kind === "rain") {
    return { near: Math.max(22, distance + radius * 0.05), far: distance + radius * 4.1 };
  }
  if (kind === "snow") {
    return { near: Math.max(22, distance + radius * 0.1), far: distance + radius * 4.8 };
  }
  return { near: Math.max(32, distance + radius * 0.45), far: distance + radius * 6 };
}

export function decorationsForProject(
  projectId: string,
  dates: readonly string[],
  blueprint: BlueprintV1,
): DecorationPlacement[] {
  const uniqueDates = [...new Set(dates)].sort();
  uniqueDates.forEach(assertLocalDate);
  const slots = decorationSlots(blueprint, uniqueDates.length);
  return uniqueDates.map((date, index) => {
    const seed = hash32(`decoration:${projectId}:${date}`);
    const slot = slots[index]!;
    const kinds: readonly DecorationKind[] = ["tree", "road", "lamp", "bench"];
    return {
      id: `${projectId}:${date}`,
      date,
      kind: kinds[(seed >>> 8) % kinds.length]!,
      x: slot.x,
      z: slot.z,
      variant: (seed >>> 16) % 4,
    };
  });
}

export function conditionVisualForVoxels(
  projectId: string,
  voxels: readonly BlueprintVoxel[],
  conditionBasisPoints: number,
): ConditionVisual {
  const condition = clampBasisPoints(conditionBasisPoints);
  const damage = 10_000 - condition;
  const missingThreshold = Math.floor(damage * 0.18);
  const intactVoxels: BlueprintVoxel[] = [];
  const missingVoxels: BlueprintVoxel[] = [];

  for (const voxel of voxels) {
    const canBreak = voxel.buildOrder > 1800 && voxel.y > 0;
    const roll = hash32(`damage:${projectId}:${voxel.x}:${voxel.y}:${voxel.z}`) % 10_000;
    if (canBreak && roll < missingThreshold) missingVoxels.push(voxel);
    else intactVoxels.push(voxel);
  }

  const vineCount = damage === 0 ? 0 : Math.min(12, Math.max(1, Math.ceil(damage / 850)));
  const vineCandidates = intactVoxels
    .filter((voxel) => voxel.y > 1 && voxel.buildOrder > 1800)
    .map((voxel) => ({ voxel, rank: hash32(`vine:${projectId}:${voxel.x}:${voxel.y}:${voxel.z}`) }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, vineCount);
  const vines = vineCandidates.map(({ voxel, rank }) => {
    const axis = (rank & 1) === 0 ? "x" as const : "z" as const;
    const side = (rank & 2) === 0 ? -0.51 : 0.51;
    return {
      x: voxel.x + (axis === "x" ? side : 0),
      y: voxel.y,
      z: voxel.z + (axis === "z" ? side : 0),
      axis,
    };
  });

  return { intactVoxels, missingVoxels, vines, weathering: damage / 10_000 };
}

function decorationSlots(blueprint: BlueprintV1, minimumCount: number): Array<{ x: number; z: number }> {
  const { minX, maxX, minZ, maxZ } = blueprint.bounds;
  const slots: Array<{ x: number; z: number }> = [];
  let offset = 2;
  do {
    for (let x = minX - offset; x <= maxX + offset; x += 2) {
      slots.push({ x, z: minZ - offset }, { x, z: maxZ + offset });
    }
    for (let z = minZ - offset + 2; z <= maxZ + offset - 2; z += 2) {
      slots.push({ x: minX - offset, z }, { x: maxX + offset, z });
    }
    offset += 3;
  } while (slots.length < minimumCount);
  if (slots.length === 0) {
    slots.push({ x: maxX + 2, z: maxZ + 2 });
  }
  return slots;
}

function ambientSlots(minX: number, maxX: number, minZ: number, maxZ: number, count: number): Array<{ x: number; z: number }> {
  const offset = 3;
  const range = (minimum: number, maximum: number): number[] => {
    const values: number[] = [];
    for (let value = minimum; value <= maximum; value += 2) values.push(value);
    return values;
  };
  const centered = (values: number[], target: number): number[] => values.sort((left, right) =>
    Math.abs(left - target) - Math.abs(right - target) || right - left,
  );
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const zPositions = centered(range(minZ - offset + 2, maxZ + offset - 2), centerZ);
  const xPositions = centered(range(minX - offset + 2, maxX + offset - 2), centerX);
  // Interleave the four edges, starting on a likely camera-facing side. The old
  // nested loop consumed its entire budget on the north/south edges near one
  // corner, where buildings and their entrance roads commonly hid every prop.
  const edges = [zPositions, xPositions, zPositions, xPositions];
  const slots: Array<{ x: number; z: number }> = [];
  for (let index = 0; slots.length < count && edges.some((edge) => index < edge.length); index += 1) {
    if (index < edges[0]!.length) slots.push({ x: maxX + offset, z: edges[0]![index]! });
    if (slots.length >= count) break;
    if (index < edges[1]!.length) slots.push({ x: edges[1]![index]!, z: maxZ + offset });
    if (slots.length >= count) break;
    if (index < edges[2]!.length) slots.push({ x: minX - offset, z: edges[2]![index]! });
    if (slots.length >= count) break;
    if (index < edges[3]!.length) slots.push({ x: edges[3]![index]!, z: minZ - offset });
  }
  return slots;
}

function ambientKindFor(seed: number, environmentStyle: EnvironmentStyle, shipwreckAdded: boolean): AmbientDecorationKind {
  const roll = seed % 100;
  if (environmentStyle === "ocean-island") {
    if (!shipwreckAdded && roll < 7) return "shipwreck";
    if (roll < 30) return "coral";
    if (roll < 48) return "reed";
    if (roll < 70) return "rock";
    return roll % 2 === 0 ? "grass-tuft" : "flower";
  }
  if (environmentStyle === "natural-valley") {
    if (roll < 14) return "rock";
    if (roll < 52) return "grass-tuft";
    return "flower";
  }
  if (roll < 18) return "rock";
  return roll % 2 === 0 ? "grass-tuft" : "flower";
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedIntensity(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? clamp(value as number, 0, 1) : fallback;
}

function assertLocalDate(value: string): void {
  const match = ISO_LOCAL_DATE.exec(value);
  if (!match) throw new RangeError(`Invalid local date ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw new RangeError(`Invalid local date ${value}`);
  }
}

function clampBasisPoints(value: number): number {
  if (!Number.isFinite(value)) return 10_000;
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
