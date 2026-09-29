import type { BlueprintV1, BlueprintVoxel } from "./blueprint";

export type WeatherKind = "clear" | "cloudy" | "rain" | "mist" | "snow";

/**
 * Small, renderer-facing projection of an external current-weather response.
 * Intensities are normalized to 0..1; values outside the range are clamped.
 */
export interface ExternalWeatherVisualOverride {
  kind: WeatherKind;
  /** An explicit provider/debug thunder signal, never inferred from rain alone. */
  thunderstorm?: boolean;
  /** Cloud cover mapped by the caller from the provider's cloud percentage. */
  cloudIntensity?: number;
  /** Precipitation strength; used for either rain or snow particles. */
  precipitationIntensity?: number;
  /** Perceptual strength projected once at the voxel boundary. */
  visualPrecipitationIntensity?: number;
}

/** Null/omitted debug weather means keep the real upstream weather selection. */
export function effectiveWeatherOverride(
  debugWeather: ExternalWeatherVisualOverride | null | undefined,
  externalWeather: ExternalWeatherVisualOverride | null,
): ExternalWeatherVisualOverride | null {
  return debugWeather ?? externalWeather;
}

export interface WeatherState {
  localDate: string;
  kind: WeatherKind;
  thunderstorm: boolean;
  seed: number;
  cloudCount: number;
  cloudIntensity: number;
  rainDropCount: number;
  snowFlakeCount: number;
  precipitationIntensity: number;
  /** Renderer-facing intensity; this never replaces the provider measurement. */
  visualPrecipitationIntensity: number;
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
const THUNDER_VISUAL: WeatherVisual = Object.freeze({
  tint: 0x465365, cloudBlend: 0.78, starVisibilityScale: 0, sunlightScale: 0.26,
});

export interface FogRange {
  near: number;
  far: number;
}

export type DecorationKind = "tree" | "road" | "lamp" | "bench";

export type EnvironmentStyle = "natural-valley" | "classic-island" | "ocean-island";

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
  // A rain day can be a thunderstorm without altering the environment-specific
  // probability of rain itself. The independent hash avoids clustering storms
  // around the boundaries of the kind-selection roll.
  const thunderstorm = kind === "rain" && hash32(`thunder:${localDate}`) % 5 === 0;
  const cloudCount = thunderstorm ? 14 : kind === "clear" ? 2 : kind === "cloudy" ? 9 : kind === "rain" ? 12 : 6;
  return {
    localDate,
    kind,
    thunderstorm,
    seed,
    cloudCount,
    cloudIntensity: Math.min(1, cloudCount / 12),
    rainDropCount: kind === "rain" ? 72 : 0,
    snowFlakeCount: 0,
    precipitationIntensity: kind === "rain" ? 1 : 0,
    visualPrecipitationIntensity: kind === "rain" ? 1 : 0,
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
  const visualPrecipitationIntensity = override.visualPrecipitationIntensity === undefined
    ? perceptualPrecipitationIntensity(override.kind, precipitationIntensity)
    : normalizedIntensity(override.visualPrecipitationIntensity, 0);
  const cloudCount = Math.round(cloudIntensity * 12);
  const rainDropCount = override.kind === "rain" ? Math.max(8, Math.round(72 * visualPrecipitationIntensity)) : 0;
  const snowFlakeCount = override.kind === "snow" ? Math.max(10, Math.round(96 * visualPrecipitationIntensity)) : 0;
  return {
    localDate,
    kind: override.kind,
    thunderstorm: override.kind === "rain" && override.thunderstorm === true,
    seed: hash32(`weather:external:${localDate}:${override.kind}:${cloudIntensity}:${precipitationIntensity}`),
    cloudCount,
    cloudIntensity,
    rainDropCount,
    snowFlakeCount,
    precipitationIntensity,
    visualPrecipitationIntensity,
  };
}

/** Maps measured precipitation to perception once, where the renderer owns it. */
export function perceptualPrecipitationIntensity(kind: WeatherKind, factualIntensity: number): number {
  if (kind !== "rain" && kind !== "snow") return 0;
  const factual = normalizedIntensity(factualIntensity, 0);
  if (factual === 0) return kind === "rain" ? 0.16 : 0.14;
  return clamp(0.1 + 0.9 * Math.sqrt(factual), kind === "rain" ? 0.16 : 0.14, 1);
}

/** Preserve a small precipitation budget after quality and view-area scaling. */
export function precipitationParticleCount(
  baseCount: number,
  weatherDensity: number,
  areaMultiplier: number,
  maximumCount: number,
  minimumVisibleCount: number,
): number {
  const base = Math.max(0, Math.round(Number.isFinite(baseCount) ? baseCount : 0));
  const density = Math.max(0, Number.isFinite(weatherDensity) ? weatherDensity : 0);
  const area = Math.max(0, Number.isFinite(areaMultiplier) ? areaMultiplier : 0);
  const cap = Math.max(0, Math.round(Number.isFinite(maximumCount) ? maximumCount : 0));
  if (base === 0 || density === 0 || area === 0 || cap === 0) return 0;
  const minimum = Math.min(cap, Math.max(1, Number.isFinite(minimumVisibleCount) ? Math.round(minimumVisibleCount) : 1));
  return Math.min(cap, Math.max(minimum, Math.round(base * density * area)));
}

/** Weather tint/cloud/star response is common across the environment layouts. */
export function sunlightScaleForWeather(weather: Pick<WeatherState, "kind" | "cloudIntensity"> & Partial<Pick<WeatherState, "thunderstorm">>): number {
  const fullCloudScale = weatherVisualForWeather(weather).sunlightScale;
  const cloudIntensity = normalizedIntensity(weather.cloudIntensity, 1);
  // Dense middle cloud cover should look recognizably overcast rather than
  // linearly interpolating almost all the way back to clear-day brightness.
  return 1 - (1 - fullCloudScale) * Math.pow(cloudIntensity, 0.68);
}

export function ambientScaleForWeather(weather: Pick<WeatherState, "kind" | "cloudIntensity"> & Partial<Pick<WeatherState, "thunderstorm">>, nightFactor = 0): number {
  const minimum: Record<WeatherKind, number> = { clear: 1, cloudy: 0.87, rain: 0.77, mist: 0.81, snow: 0.87 };
  const fullCover = weather.thunderstorm === true && weather.kind === "rain" ? 0.58 : minimum[weather.kind];
  const daytimeDimming = (1 - fullCover) * Math.pow(normalizedIntensity(weather.cloudIntensity, 1), 0.68);
  return 1 - daytimeDimming * (1 - 0.45 * normalizedIntensity(nightFactor, 0));
}

export function weatherVisualForWeather(weather: Pick<WeatherState, "kind"> & Partial<Pick<WeatherState, "thunderstorm">>): WeatherVisual {
  return weather.kind === "rain" && weather.thunderstorm === true ? THUNDER_VISUAL : WEATHER_VISUALS[weather.kind];
}

/** World units per second; cloud drift is continuous advection, not a short sine oscillation. */
export function cloudAdvectionSpeed(weather: Pick<WeatherState, "kind" | "cloudIntensity"> & Partial<Pick<WeatherState, "thunderstorm">>): number {
  const base: Record<WeatherKind, number> = { clear: 0.08, cloudy: 0.22, rain: 0.38, mist: 0.04, snow: 0.15 };
  const storm = weather.kind === "rain" && weather.thunderstorm === true;
  return (storm ? 0.72 : base[weather.kind]) * (0.72 + 0.28 * Math.sqrt(normalizedIntensity(weather.cloudIntensity, 0)));
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
  // Linear area amplification made cloudy and mist both hit the same 85-cloud
  // cap on expanded terrain, erasing their visual distinction. Fog owns mist;
  // clouds own overcast. Keep coverage growth sublinear and weather-specific.
  const kindDensity: Record<WeatherKind, number> = {
    clear: 0.6, cloudy: 1, rain: 1.12, mist: 0.45, snow: 0.82,
  };
  return {
    cloudCount: weatherCloudCount === 0 ? 0 : Math.min(compact ? 40 : 85,
      Math.max(1, Math.round(weatherCloudCount * density * Math.sqrt(spreadRatio) * kindDensity[input.weatherKind]))),
    maxInstances: 900,
    blockScale: 1,
    spanX: compact ? Math.max(32, visibleWidth * 1.05) : Math.max(32, visibleWidth + 24),
    spanZ: compact ? Math.max(28, visibleDepth * 1.05) : Math.max(28, visibleDepth + 24),
    previewMode: false,
  };
}


export function fogRangeForView(kind: WeatherKind, cameraDistance: number, contentRadius: number, _ocean = false): FogRange {
  const distance = Math.max(1, Number.isFinite(cameraDistance) ? cameraDistance : 1);
  const radius = Math.max(6, Number.isFinite(contentRadius) ? contentRadius : 6);
  if (kind === "mist") {
    return { near: Math.max(18, distance - radius * 0.22), far: distance + radius * 2.0 };
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
