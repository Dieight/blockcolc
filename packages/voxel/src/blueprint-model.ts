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

export const MOVING_PISTON_FACINGS = ["down", "up", "north", "south", "west", "east"] as const;
export type MovingPistonFacing = (typeof MOVING_PISTON_FACINGS)[number];

export interface MovingPistonPose {
  facing: MovingPistonFacing;
  /** Last saved movement progress, clamped to the vanilla 0..1 interval. */
  progress: number;
  extending: boolean;
  source: boolean;
}

export interface MovingPistonMovedState {
  /** Vanilla block ID stored in the moving_piston block entity's blockState. */
  blockId: string;
  /** Canonical state properties; omitted when the moved block has no properties. */
  properties?: Record<string, string>;
}

export const SIGN_DYE_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;
export type SignDyeColor = (typeof SIGN_DYE_COLORS)[number];

export interface BlueprintSignFace {
  /** Plain visible text only; style, click and hover data are intentionally absent. */
  lines: string[];
  dyeColor: SignDyeColor;
  glowing: boolean;
}

export interface BlueprintSignData {
  front: BlueprintSignFace;
  back: BlueprintSignFace;
}

export type CampfireSlotIndex = 0 | 1 | 2 | 3;

export interface BlueprintCampfireSlot {
  slot: CampfireSlotIndex;
  itemId: string;
  count: number;
}

export interface BlueprintCampfireData {
  slots: BlueprintCampfireSlot[];
}

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
  /** Whitelisted moved block state from a minecraft:piston block entity. */
  movingPistonMovedState?: MovingPistonMovedState;
  /** Whitelisted saved piston pose fields; omitted for older or incomplete NBT. */
  movingPistonPose?: MovingPistonPose;
  /** Static front/back display data; never contains raw sign components or actions. */
  sign?: BlueprintSignData;
  /** Bounded item identifiers and counts for campfires; component payloads are not stored. */
  campfire?: BlueprintCampfireData;
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
    const movingPistonMovedState = rawVoxel.movingPistonMovedState === undefined
      ? undefined
      : normalizeMovingPistonMovedState(rawVoxel.movingPistonMovedState);
    const movingPistonPose = rawVoxel.movingPistonPose === undefined
      ? undefined
      : normalizeMovingPistonPose(rawVoxel.movingPistonPose);
    const sign = rawVoxel.sign === undefined ? undefined : normalizeSignData(rawVoxel.sign);
    const campfire = rawVoxel.campfire === undefined ? undefined : normalizeCampfireData(rawVoxel.campfire);
    if ((movingPistonMovedState !== undefined || movingPistonPose !== undefined)
      && rawVoxel.sourceBlockId !== "minecraft:moving_piston") {
      throw new BlueprintValidationError("BlueprintV1 piston block-entity fields require minecraft:moving_piston");
    }
    if (sign !== undefined && !isSignBlockId(rawVoxel.sourceBlockId)) {
      throw new BlueprintValidationError("BlueprintV1 sign data requires a vanilla sign sourceBlockId");
    }
    if (campfire !== undefined && rawVoxel.sourceBlockId !== "minecraft:campfire" && rawVoxel.sourceBlockId !== "minecraft:soul_campfire") {
      throw new BlueprintValidationError("BlueprintV1 campfire data requires a campfire sourceBlockId");
    }
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
    if (movingPistonMovedState !== undefined) voxel.movingPistonMovedState = movingPistonMovedState;
    if (movingPistonPose !== undefined) voxel.movingPistonPose = movingPistonPose;
    if (sign !== undefined) voxel.sign = sign;
    if (campfire !== undefined) voxel.campfire = campfire;
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
const VANILLA_BLOCK_ID_PATTERN = /^minecraft:[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*$/;
const BLOCK_STATE_VALUE_PATTERN = /^[a-z0-9_./-]+$/;
const ITEM_ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const SIGN_LINE_CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_SIGN_LINE_LENGTH = 256;

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

function normalizeMovingPistonMovedState(raw: unknown): MovingPistonMovedState {
  if (!isPlainRecord(raw) || Reflect.ownKeys(raw).some((key) => key !== "blockId" && key !== "properties")) {
    throw new BlueprintValidationError("Invalid BlueprintV1 movingPistonMovedState");
  }
  const blockId = raw.blockId;
  if (typeof blockId !== "string" || blockId.length > 256 || !VANILLA_BLOCK_ID_PATTERN.test(blockId)
    || blockId === "minecraft:air" || blockId === "minecraft:cave_air" || blockId === "minecraft:void_air"
    || blockId === "minecraft:moving_piston") {
    throw new BlueprintValidationError("Invalid BlueprintV1 movingPistonMovedState blockId");
  }
  const properties = raw.properties === undefined ? undefined : normalizeSourceBlockState(raw.properties);
  if (properties !== undefined && Object.values(properties).some((value) => !BLOCK_STATE_VALUE_PATTERN.test(value))) {
    throw new BlueprintValidationError("Invalid BlueprintV1 movingPistonMovedState property value");
  }
  return properties === undefined ? { blockId } : { blockId, properties };
}

function normalizeMovingPistonPose(raw: unknown): MovingPistonPose {
  const keys = ["facing", "progress", "extending", "source"] as const;
  if (!isPlainRecord(raw) || Reflect.ownKeys(raw).length !== keys.length
    || Reflect.ownKeys(raw).some((key) => typeof key !== "string" || !keys.includes(key as typeof keys[number]))) {
    throw new BlueprintValidationError("Invalid BlueprintV1 movingPistonPose");
  }
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(raw, key));
  if (descriptors.some((descriptor) => descriptor === undefined || !descriptor.enumerable
    || descriptor.get !== undefined || descriptor.set !== undefined)) {
    throw new BlueprintValidationError("Invalid BlueprintV1 movingPistonPose fields");
  }
  const [facing, progress, extending, source] = descriptors.map((descriptor) => descriptor!.value);
  if (typeof facing !== "string" || !(MOVING_PISTON_FACINGS as readonly string[]).includes(facing)) {
    throw new BlueprintValidationError("Invalid BlueprintV1 movingPistonPose facing");
  }
  if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new BlueprintValidationError("Invalid BlueprintV1 movingPistonPose progress");
  }
  if (typeof extending !== "boolean" || typeof source !== "boolean") {
    throw new BlueprintValidationError("Invalid BlueprintV1 movingPistonPose flags");
  }
  return { facing: facing as MovingPistonFacing, progress, extending, source };
}

function normalizeSignData(raw: unknown): BlueprintSignData {
  const value = strictBlueprintRecord(raw, ["front", "back"], "sign");
  return { front: normalizeSignFace(value.front), back: normalizeSignFace(value.back) };
}

function normalizeSignFace(raw: unknown): BlueprintSignFace {
  const value = strictBlueprintRecord(raw, ["lines", "dyeColor", "glowing"], "sign face");
  if (!Array.isArray(value.lines) || value.lines.length > 4) {
    throw new BlueprintValidationError("Invalid BlueprintV1 sign face lines");
  }
  const lines = value.lines.map((line) => {
    if (typeof line !== "string" || line.length > MAX_SIGN_LINE_LENGTH || SIGN_LINE_CONTROL.test(line)) {
      throw new BlueprintValidationError("Invalid BlueprintV1 sign line");
    }
    return line;
  });
  if (typeof value.dyeColor !== "string" || !(SIGN_DYE_COLORS as readonly string[]).includes(value.dyeColor)) {
    throw new BlueprintValidationError("Invalid BlueprintV1 sign dyeColor");
  }
  if (typeof value.glowing !== "boolean") throw new BlueprintValidationError("Invalid BlueprintV1 sign glowing flag");
  return { lines, dyeColor: value.dyeColor as SignDyeColor, glowing: value.glowing };
}

function normalizeCampfireData(raw: unknown): BlueprintCampfireData {
  const value = strictBlueprintRecord(raw, ["slots"], "campfire");
  if (!Array.isArray(value.slots) || value.slots.length > 4) {
    throw new BlueprintValidationError("Invalid BlueprintV1 campfire slots");
  }
  const slots = value.slots.map((rawSlot): BlueprintCampfireSlot => {
    const slot = strictBlueprintRecord(rawSlot, ["slot", "itemId", "count"], "campfire slot");
    if (!integer(slot.slot) || slot.slot < 0 || slot.slot > 3) {
      throw new BlueprintValidationError("Invalid BlueprintV1 campfire slot index");
    }
    if (typeof slot.itemId !== "string" || slot.itemId.length > 256 || !ITEM_ID_PATTERN.test(slot.itemId)) {
      throw new BlueprintValidationError("Invalid BlueprintV1 campfire itemId");
    }
    if (!integer(slot.count) || slot.count < 1 || slot.count > 64) {
      throw new BlueprintValidationError("Invalid BlueprintV1 campfire item count");
    }
    return { slot: slot.slot as CampfireSlotIndex, itemId: slot.itemId, count: slot.count };
  });
  if (new Set(slots.map((slot) => slot.slot)).size !== slots.length) {
    throw new BlueprintValidationError("BlueprintV1 campfire slots must be unique");
  }
  slots.sort((left, right) => left.slot - right.slot);
  return { slots };
}

function strictBlueprintRecord(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(raw)) throw new BlueprintValidationError(`Invalid BlueprintV1 ${label}`);
  const ownKeys = Reflect.ownKeys(raw);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new BlueprintValidationError(`Invalid BlueprintV1 ${label} fields`);
  }
  const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new BlueprintValidationError(`Invalid BlueprintV1 ${label} field`);
    }
    value[key] = descriptor.value;
  }
  return value;
}

function isSignBlockId(raw: unknown): raw is string {
  return typeof raw === "string" && /^minecraft:[a-z0-9_]*sign$/.test(raw);
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

function coordinateKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}
