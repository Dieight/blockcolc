export const MATERIAL_IDS = ["stone", "wood", "plank", "roof", "glass", "accent"] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];

export const CONSTRUCTION_STAGES = [
  { id: "foundation", startBasisPoints: 0, endBasisPoints: 1800 },
  { id: "frame", startBasisPoints: 1800, endBasisPoints: 3800 },
  { id: "walls", startBasisPoints: 3800, endBasisPoints: 6500 },
  { id: "roof", startBasisPoints: 6500, endBasisPoints: 8800 },
  { id: "details", startBasisPoints: 8800, endBasisPoints: 10000 },
] as const;

export type ConstructionStageId = (typeof CONSTRUCTION_STAGES)[number]["id"];

export interface BlueprintVoxel {
  x: number;
  y: number;
  z: number;
  materialId: MaterialId;
  /** Construction prefix position in integer basis points, 0..10000. */
  buildOrder: number;
  /** Optional source semantics retained by compatible importers. */
  sourceBlockId?: string;
  /** Canonical source block-state properties, independent of any resource pack. */
  sourceBlockState?: Record<string, string>;
  emissiveKind?: string;
  emissiveLevel?: number;
}

export interface BlueprintBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface BlueprintV1 {
  schemaVersion: 1;
  id: string;
  title: string;
  bounds: BlueprintBounds;
  voxels: BlueprintVoxel[];
}

export type BlueprintComplexity = "simple" | "moderate" | "detailed";

export interface BlueprintCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  footprint: { width: number; depth: number };
  complexity: BlueprintComplexity;
  blueprint: BlueprintV1;
}

export class BlueprintValidationError extends Error {
  override readonly name = "BlueprintValidationError";
}

export function validateBlueprint(raw: unknown): BlueprintV1 {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || typeof raw.id !== "string" || raw.id.trim() === ""
    || typeof raw.title !== "string" || raw.title.trim() === "" || !isRecord(raw.bounds) || !Array.isArray(raw.voxels)
    || raw.voxels.length === 0) {
    throw new BlueprintValidationError("Invalid BlueprintV1 envelope");
  }
  const bounds = parseBounds(raw.bounds);
  const voxels: BlueprintVoxel[] = [];
  const coordinates = new Set<string>();
  for (const rawVoxel of raw.voxels) {
    if (!isRecord(rawVoxel) || !integer(rawVoxel.x) || !integer(rawVoxel.y) || !integer(rawVoxel.z)
      || typeof rawVoxel.materialId !== "string" || !MATERIAL_IDS.includes(rawVoxel.materialId as MaterialId)
      || !integer(rawVoxel.buildOrder) || rawVoxel.buildOrder < 0 || rawVoxel.buildOrder > 10000
      || rawVoxel.x < bounds.minX || rawVoxel.x > bounds.maxX || rawVoxel.y < bounds.minY || rawVoxel.y > bounds.maxY
      || rawVoxel.z < bounds.minZ || rawVoxel.z > bounds.maxZ) {
      throw new BlueprintValidationError("Invalid BlueprintV1 voxel");
    }
    if (rawVoxel.sourceBlockId !== undefined && (typeof rawVoxel.sourceBlockId !== "string" || rawVoxel.sourceBlockId.trim() === "")) {
      throw new BlueprintValidationError("Invalid BlueprintV1 sourceBlockId");
    }
    const sourceBlockState = rawVoxel.sourceBlockState === undefined
      ? undefined
      : normalizeSourceBlockState(rawVoxel.sourceBlockState);
    if (rawVoxel.emissiveKind !== undefined && (typeof rawVoxel.emissiveKind !== "string" || rawVoxel.emissiveKind.trim() === "")) {
      throw new BlueprintValidationError("Invalid BlueprintV1 emissiveKind");
    }
    if (rawVoxel.emissiveLevel !== undefined && (!integer(rawVoxel.emissiveLevel) || rawVoxel.emissiveLevel < 0 || rawVoxel.emissiveLevel > 15)) {
      throw new BlueprintValidationError("Invalid BlueprintV1 emissiveLevel");
    }
    const voxel: BlueprintVoxel = {
      x: rawVoxel.x,
      y: rawVoxel.y,
      z: rawVoxel.z,
      materialId: rawVoxel.materialId as MaterialId,
      buildOrder: rawVoxel.buildOrder,
    };
    if (rawVoxel.sourceBlockId !== undefined) voxel.sourceBlockId = rawVoxel.sourceBlockId;
    if (sourceBlockState !== undefined) voxel.sourceBlockState = sourceBlockState;
    if (rawVoxel.emissiveKind !== undefined) voxel.emissiveKind = rawVoxel.emissiveKind;
    if (rawVoxel.emissiveLevel !== undefined) voxel.emissiveLevel = rawVoxel.emissiveLevel;
    const key = coordinateKey(voxel.x, voxel.y, voxel.z);
    if (coordinates.has(key)) throw new BlueprintValidationError(`Duplicate voxel coordinate ${key}`);
    coordinates.add(key);
    voxels.push(voxel);
  }
  return structuredClone({ schemaVersion: 1 as const, id: raw.id, title: raw.title, bounds, voxels });
}

const UNSAFE_BLOCK_STATE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const BLOCK_STATE_KEY_PATTERN = /^[a-z0-9_.-]+$/;
const MAX_BLOCK_STATE_PROPERTIES = 32;
const MAX_BLOCK_STATE_KEY_LENGTH = 64;
const MAX_BLOCK_STATE_VALUE_LENGTH = 128;

function normalizeSourceBlockState(raw: unknown): Record<string, string> | undefined {
  if (!isPlainRecord(raw)) throw new BlueprintValidationError("Invalid BlueprintV1 sourceBlockState");
  if (Reflect.ownKeys(raw).length > MAX_BLOCK_STATE_PROPERTIES) {
    throw new BlueprintValidationError("BlueprintV1 sourceBlockState has too many properties");
  }
  const entries: Array<[string, string]> = [];
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== "string" || key.length > MAX_BLOCK_STATE_KEY_LENGTH || !BLOCK_STATE_KEY_PATTERN.test(key)
      || UNSAFE_BLOCK_STATE_KEYS.has(key)) {
      throw new BlueprintValidationError("Invalid BlueprintV1 sourceBlockState key");
    }
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined
      || typeof descriptor.value !== "string" || descriptor.value.length === 0
      || descriptor.value.length > MAX_BLOCK_STATE_VALUE_LENGTH) {
      throw new BlueprintValidationError("Invalid BlueprintV1 sourceBlockState value");
    }
    entries.push([key, descriptor.value]);
  }
  if (entries.length === 0) return undefined;
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return Object.fromEntries(entries);
}

function parseBounds(raw: Record<string, unknown>): BlueprintBounds {
  const minX = raw.minX; const maxX = raw.maxX; const minY = raw.minY;
  const maxY = raw.maxY; const minZ = raw.minZ; const maxZ = raw.maxZ;
  if (!integer(minX) || !integer(maxX) || !integer(minY) || !integer(maxY) || !integer(minZ) || !integer(maxZ)
    || minX > maxX || minY > maxY || minZ > maxZ) {
    throw new BlueprintValidationError("Invalid BlueprintV1 bounds");
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface StagedVoxel {
  x: number;
  y: number;
  z: number;
  materialId: MaterialId;
  stage: ConstructionStageId;
}

class BlueprintBuilder {
  readonly #voxels = new Map<string, StagedVoxel>();

  add(x: number, y: number, z: number, materialId: MaterialId, stage: ConstructionStageId): void {
    const key = coordinateKey(x, y, z);
    if (this.#voxels.has(key)) throw new BlueprintValidationError(`Duplicate generated voxel coordinate ${key}`);
    this.#voxels.set(key, { x, y, z, materialId, stage });
  }

  build(id: string, title: string): BlueprintV1 {
    const staged = [...this.#voxels.values()];
    const voxels: BlueprintVoxel[] = [];
    for (const stage of CONSTRUCTION_STAGES) {
      const members = staged
        .filter((voxel) => voxel.stage === stage.id)
        .sort((left, right) => left.y - right.y || left.x - right.x || left.z - right.z || left.materialId.localeCompare(right.materialId));
      if (members.length === 0) throw new BlueprintValidationError(`Generated blueprint ${id} has empty ${stage.id} stage`);
      const divisor = Math.max(1, members.length - 1);
      members.forEach(({ stage: _stage, ...voxel }, index) => {
        const progress = members.length === 1 ? stage.endBasisPoints : Math.round(
          stage.startBasisPoints + (index / divisor) * (stage.endBasisPoints - stage.startBasisPoints),
        );
        voxels.push({ ...voxel, buildOrder: progress });
      });
    }
    const bounds = boundsFor(voxels);
    return validateBlueprint({ schemaVersion: 1, id, title, bounds, voxels });
  }
}

function coordinateKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function boundsFor(voxels: ReadonlyArray<Pick<BlueprintVoxel, "x" | "y" | "z">>): BlueprintBounds {
  return {
    minX: Math.min(...voxels.map((voxel) => voxel.x)),
    maxX: Math.max(...voxels.map((voxel) => voxel.x)),
    minY: Math.min(...voxels.map((voxel) => voxel.y)),
    maxY: Math.max(...voxels.map((voxel) => voxel.y)),
    minZ: Math.min(...voxels.map((voxel) => voxel.z)),
    maxZ: Math.max(...voxels.map((voxel) => voxel.z)),
  };
}

function buildSmallWorkshop(): BlueprintV1 {
  const builder = new BlueprintBuilder();
  for (let x = -5; x <= 5; x += 1) for (let z = -4; z <= 4; z += 1) builder.add(x, 0, z, "stone", "foundation");
  for (let x = -4; x <= 4; x += 1) for (let z = -3; z <= 3; z += 1) builder.add(x, 1, z, "plank", "frame");
  for (let y = 2; y <= 5; y += 1) {
    for (let x = -5; x <= 5; x += 1) {
      if (!(zOpening(x, y, 4))) builder.add(x, y, 4, cornerMaterial(x, 5), "walls");
      if (!(-2 <= x && x <= 2 && y === 3)) builder.add(x, y, -4, cornerMaterial(x, 5), "walls");
    }
    for (let z = -3; z <= 3; z += 1) {
      if (!(y === 3 && z === 0)) builder.add(-5, y, z, cornerMaterial(z, 4), "walls");
      if (!(y === 3 && z === 0)) builder.add(5, y, z, cornerMaterial(z, 4), "walls");
    }
  }
  for (let z = -5; z <= 5; z += 1) {
    const y = 11 - Math.abs(z);
    for (let x = -5; x <= 5; x += 1) builder.add(x, y, z, "roof", "roof");
  }
  builder.add(0, 2, 4, "accent", "details"); builder.add(0, 3, 4, "accent", "details");
  for (let x = -2; x <= 2; x += 1) builder.add(x, 3, -4, "glass", "details");
  builder.add(-5, 3, 0, "glass", "details"); builder.add(5, 3, 0, "glass", "details");
  return builder.build("builtin-small-workshop", "Small Workshop");
}

function zOpening(x: number, y: number, z: number): boolean {
  return z === 4 && x === 0 && (y === 2 || y === 3);
}

function cornerMaterial(coordinate: number, extent: number): MaterialId {
  return Math.abs(coordinate) === extent ? "wood" : "plank";
}

function buildTimberHouse(): BlueprintV1 {
  const builder = new BlueprintBuilder();
  for (let x = -6; x <= 6; x += 1) for (let z = -4; z <= 4; z += 1) builder.add(x, 0, z, "stone", "foundation");
  for (let x = -5; x <= 5; x += 1) for (let z = -3; z <= 3; z += 1) builder.add(x, 1, z, "plank", "frame");
  for (let y = 2; y <= 4; y += 1) addHousePerimeter(builder, -5, 5, -3, 3, y, false);
  for (let x = -6; x <= 6; x += 1) for (let z = -4; z <= 4; z += 1) builder.add(x, 5, z, "plank", "frame");
  for (let y = 6; y <= 8; y += 1) addHousePerimeter(builder, -6, 6, -4, 4, y, true);
  for (let z = -5; z <= 5; z += 1) {
    const y = 14 - Math.abs(z);
    for (let x = -6; x <= 6; x += 1) builder.add(x, y, z, "roof", "roof");
  }
  for (let y = 2; y <= 3; y += 1) builder.add(0, y, 3, "accent", "details");
  for (const x of [-3, 3]) builder.add(x, 3, -3, "glass", "details");
  for (const x of [-3, 3]) builder.add(x, 7, -4, "glass", "details");
  builder.add(-6, 7, 0, "glass", "details"); builder.add(6, 7, 0, "glass", "details");
  for (let y = 9; y <= 13; y += 1) builder.add(4, y, 0, "stone", "details");
  return builder.build("builtin-timber-house", "Timber House");
}

function addHousePerimeter(
  builder: BlueprintBuilder,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y: number,
  upper: boolean,
): void {
  for (let x = minX; x <= maxX; x += 1) {
    const frontOpening = !upper && x === 0 && y <= 3;
    const rearWindow = (x === -3 || x === 3) && y === (upper ? 7 : 3);
    if (!frontOpening) builder.add(x, y, maxZ, Math.abs(x) === maxX ? "wood" : "plank", "walls");
    if (!rearWindow) builder.add(x, y, minZ, Math.abs(x) === maxX ? "wood" : "plank", "walls");
  }
  for (let z = minZ + 1; z < maxZ; z += 1) {
    const sideWindow = z === 0 && y === (upper ? 7 : 3);
    if (!sideWindow) builder.add(minX, y, z, "wood", "walls");
    if (!sideWindow) builder.add(maxX, y, z, "wood", "walls");
  }
}

function buildVillageChapel(): BlueprintV1 {
  const builder = new BlueprintBuilder();
  for (let x = -5; x <= 5; x += 1) for (let z = -8; z <= 10; z += 1) builder.add(x, 0, z, "stone", "foundation");
  for (let x = -4; x <= 4; x += 1) for (let z = -7; z <= 3; z += 1) builder.add(x, 1, z, "plank", "frame");
  for (let x = -2; x <= 2; x += 1) for (let z = 4; z <= 9; z += 1) builder.add(x, 1, z, "stone", "frame");
  for (const x of [-5, 5]) for (const z of [-6, -2, 2]) for (let y = 1; y <= 5; y += 1) builder.add(x, y, z, "stone", "frame");
  for (let y = 2; y <= 7; y += 1) addChapelNaveWalls(builder, y);
  for (let y = 2; y <= 13; y += 1) addTowerWalls(builder, y);
  for (let x = -5; x <= 5; x += 1) {
    const y = 12 - Math.abs(x);
    for (let z = -8; z <= 2; z += 1) builder.add(x, y, z, "roof", "roof");
  }
  for (let inset = 0; inset <= 3; inset += 1) {
    const y = 14 + inset;
    for (let x = -3 + inset; x <= 3 - inset; x += 1) {
      for (let z = 3 + inset; z <= 10 - inset; z += 1) builder.add(x, y, z, "roof", "roof");
    }
  }
  builder.add(0, 18, 6, "accent", "details");
  for (let y = 2; y <= 4; y += 1) builder.add(0, y, 10, "accent", "details");
  for (const z of [-5, -1, 3]) {
    builder.add(-4, 4, z, "glass", "details"); builder.add(-4, 5, z, "glass", "details");
    builder.add(4, 4, z, "glass", "details"); builder.add(4, 5, z, "glass", "details");
  }
  builder.add(-2, 9, 10, "glass", "details"); builder.add(2, 9, 10, "glass", "details");
  return builder.build("builtin-village-chapel", "Village Chapel");
}

function addChapelNaveWalls(builder: BlueprintBuilder, y: number): void {
  for (let z = -8; z <= 3; z += 1) {
    const window = (z === -5 || z === -1 || z === 3) && (y === 4 || y === 5);
    if (!window) builder.add(-4, y, z, "stone", "walls");
    if (!window) builder.add(4, y, z, "stone", "walls");
  }
  for (let x = -3; x <= 3; x += 1) {
    builder.add(x, y, -8, "stone", "walls");
  }
}

function addTowerWalls(builder: BlueprintBuilder, y: number): void {
  for (let x = -3; x <= 3; x += 1) {
    builder.add(x, y, 3, "stone", "walls");
    const entrance = x === 0 && y <= 4;
    const belfryWindow = (x === -2 || x === 2) && y === 9;
    if (!entrance && !belfryWindow) builder.add(x, y, 10, "stone", "walls");
  }
  for (let z = 4; z <= 9; z += 1) {
    builder.add(-3, y, z, "stone", "walls");
    builder.add(3, y, z, "stone", "walls");
  }
}

function buildUnknownPlaceholder(): BlueprintV1 {
  const builder = new BlueprintBuilder();
  for (let x = -2; x <= 2; x += 1) for (let z = -2; z <= 2; z += 1) builder.add(x, 0, z, "stone", "foundation");
  for (const x of [-2, 2]) for (const z of [-2, 2]) for (let y = 1; y <= 3; y += 1) builder.add(x, y, z, "wood", "frame");
  for (let y = 1; y <= 2; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      builder.add(x, y, -2, "plank", "walls");
      if (x !== 0) builder.add(x, y, 2, "plank", "walls");
    }
  }
  for (let x = -2; x <= 2; x += 1) for (let z = -2; z <= 2; z += 1) builder.add(x, 4, z, "roof", "roof");
  builder.add(0, 1, 2, "accent", "details"); builder.add(0, 2, 2, "glass", "details");
  return builder.build("builtin-unknown-placeholder", "Unknown Blueprint Placeholder");
}

export const SMALL_WORKSHOP_BLUEPRINT: BlueprintV1 = buildSmallWorkshop();
export const TIMBER_HOUSE_BLUEPRINT: BlueprintV1 = buildTimberHouse();
export const VILLAGE_CHAPEL_BLUEPRINT: BlueprintV1 = buildVillageChapel();
export const UNKNOWN_BLUEPRINT_PLACEHOLDER: BlueprintV1 = buildUnknownPlaceholder();

function catalogEntry(
  blueprint: BlueprintV1,
  displayName: string,
  description: string,
  complexity: BlueprintComplexity,
): BlueprintCatalogEntry {
  return {
    id: blueprint.id,
    displayName,
    description,
    footprint: {
      width: blueprint.bounds.maxX - blueprint.bounds.minX + 1,
      depth: blueprint.bounds.maxZ - blueprint.bounds.minZ + 1,
    },
    complexity,
    blueprint,
  };
}

export const BUILTIN_BLUEPRINT_CATALOG: readonly BlueprintCatalogEntry[] = [
  catalogEntry(SMALL_WORKSHOP_BLUEPRINT, "林边工坊", "石基、木墙与陡坡屋顶组成的紧凑工坊。", "simple"),
  catalogEntry(TIMBER_HOUSE_BLUEPRINT, "河岸木屋", "带挑出上层、烟囱和双层木构的宽体住宅。", "moderate"),
  catalogEntry(VILLAGE_CHAPEL_BLUEPRINT, "村庄礼拜堂", "拥有石砌礼拜空间、钟塔与高耸屋脊的聚落地标。", "detailed"),
] as const;

export const BUILTIN_BLUEPRINTS: ReadonlyMap<string, BlueprintV1> = new Map(
  BUILTIN_BLUEPRINT_CATALOG.map((entry) => [entry.id, entry.blueprint]),
);

export function resolveBuiltinBlueprint(id: string): BlueprintV1 {
  return BUILTIN_BLUEPRINTS.get(id) ?? UNKNOWN_BLUEPRINT_PLACEHOLDER;
}
