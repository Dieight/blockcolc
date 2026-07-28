import type { BlueprintV1, BlueprintVoxel } from "./blueprint";

export type WeatherKind = "clear" | "cloudy" | "rain" | "mist";

export interface WeatherState {
  localDate: string;
  kind: WeatherKind;
  seed: number;
  cloudCount: number;
  rainDropCount: number;
}

export interface FogRange {
  near: number;
  far: number;
}

export type DecorationKind = "tree" | "road" | "lamp" | "bench";

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

export function weatherForLocalDate(localDate: string): WeatherState {
  assertLocalDate(localDate);
  const seed = hash32(`weather:${localDate}`);
  const roll = seed % 100;
  const kind: WeatherKind = roll < 50 ? "clear" : roll < 75 ? "cloudy" : roll < 90 ? "rain" : "mist";
  return {
    localDate,
    kind,
    seed,
    cloudCount: kind === "clear" ? 2 : kind === "cloudy" ? 9 : kind === "rain" ? 12 : 6,
    rainDropCount: kind === "rain" ? 72 : 0,
  };
}

export function fogRangeForView(kind: WeatherKind, cameraDistance: number, contentRadius: number): FogRange {
  const distance = Math.max(1, Number.isFinite(cameraDistance) ? cameraDistance : 1);
  const radius = Math.max(6, Number.isFinite(contentRadius) ? contentRadius : 6);
  if (kind === "mist") {
    return { near: Math.max(18, distance - radius * 0.15), far: distance + radius * 3.2 };
  }
  if (kind === "rain") {
    return { near: Math.max(22, distance + radius * 0.05), far: distance + radius * 4.1 };
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
