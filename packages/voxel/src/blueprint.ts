/// <reference types="vite/client" />

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

interface StagedVoxel {
  x: number;
  y: number;
  z: number;
  materialId: MaterialId;
  stage: ConstructionStageId;
  sourceBlockId?: string;
  emissiveKind?: string;
  emissiveLevel?: number;
}

class BlueprintBuilder {
  readonly #voxels = new Map<string, StagedVoxel>();

  add(x: number, y: number, z: number, materialId: MaterialId, stage: ConstructionStageId): void {
    const key = coordinateKey(x, y, z);
    if (this.#voxels.has(key)) throw new BlueprintValidationError(`Duplicate generated voxel coordinate ${key}`);
    this.#voxels.set(key, { x, y, z, materialId, stage });
  }

  addLight(x: number, y: number, z: number, stage: ConstructionStageId = "details"): void {
    const key = coordinateKey(x, y, z);
    if (this.#voxels.has(key)) throw new BlueprintValidationError(`Duplicate generated voxel coordinate ${key}`);
    this.#voxels.set(key, {
      x, y, z, materialId: "accent", stage,
      sourceBlockId: "minecraft:torch", emissiveKind: "torch", emissiveLevel: 14,
    });
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
  const first = voxels[0];
  if (!first) throw new BlueprintValidationError("Cannot calculate bounds for an empty blueprint");
  const bounds: BlueprintBounds = {
    minX: first.x, maxX: first.x,
    minY: first.y, maxY: first.y,
    minZ: first.z, maxZ: first.z,
  };
  for (let index = 1; index < voxels.length; index += 1) {
    const voxel = voxels[index]!;
    bounds.minX = Math.min(bounds.minX, voxel.x);
    bounds.maxX = Math.max(bounds.maxX, voxel.x);
    bounds.minY = Math.min(bounds.minY, voxel.y);
    bounds.maxY = Math.max(bounds.maxY, voxel.y);
    bounds.minZ = Math.min(bounds.minZ, voxel.z);
    bounds.maxZ = Math.max(bounds.maxZ, voxel.z);
  }
  return bounds;
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
  for (let x = -2; x <= 2; x += 1) builder.add(x, 3, -4, "glass", "details");
  builder.add(-5, 3, 0, "glass", "details"); builder.add(5, 3, 0, "glass", "details");
  builder.addLight(-3, 3, 5); builder.addLight(3, 3, 5);
  builder.addLight(-3, 3, 3); builder.addLight(3, 3, 3);
  for (let x = -3; x <= -1; x += 1) builder.add(x, 2, -2, "wood", "details");
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
  for (const x of [-3, 3]) builder.add(x, 3, -3, "glass", "details");
  for (const x of [-3, 3]) builder.add(x, 7, -4, "glass", "details");
  for (const x of [-5, 5]) builder.add(x, 3, 0, "glass", "details");
  builder.add(-6, 7, 0, "glass", "details"); builder.add(6, 7, 0, "glass", "details");
  for (let y = 9; y <= 13; y += 1) builder.add(4, y, 0, "stone", "details");
  builder.addLight(-3, 3, 4); builder.addLight(3, 3, 4);
  builder.addLight(-3, 3, 2); builder.addLight(3, 3, 2);
  builder.add(-3, 2, -1, "accent", "details"); builder.add(-2, 2, -1, "plank", "details");
  builder.add(3, 6, -2, "accent", "details");
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
  for (const z of [-5, -1, 3]) {
    builder.add(-4, 4, z, "glass", "details"); builder.add(-4, 5, z, "glass", "details");
    builder.add(4, 4, z, "glass", "details"); builder.add(4, 5, z, "glass", "details");
  }
  builder.add(-2, 9, 10, "glass", "details"); builder.add(2, 9, 10, "glass", "details");
  builder.addLight(-2, 5, 11); builder.addLight(2, 5, 11);
  builder.addLight(-2, 2, 8); builder.addLight(2, 2, 8);
  builder.addLight(-3, 2, 0); builder.addLight(3, 2, 0);
  for (const z of [-6, -4, -2, 0]) {
    builder.add(-2, 2, z, "plank", "details");
    builder.add(2, 2, z, "plank", "details");
  }
  builder.add(-1, 2, -7, "stone", "details");
  builder.add(0, 2, -7, "accent", "details");
  builder.add(1, 2, -7, "stone", "details");
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
    const navePassage = x === 0 && y <= 4;
    if (!navePassage) builder.add(x, y, 3, "stone", "walls");
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

export const CORE_BUILTIN_BLUEPRINT_CATALOG: readonly BlueprintCatalogEntry[] = [
  catalogEntry(SMALL_WORKSHOP_BLUEPRINT, "林边工坊", "石基、木墙与陡坡屋顶组成的紧凑工坊。", "simple"),
  catalogEntry(TIMBER_HOUSE_BLUEPRINT, "河岸木屋", "带挑出上层、烟囱和双层木构的宽体住宅。", "moderate"),
  catalogEntry(VILLAGE_CHAPEL_BLUEPRINT, "村庄礼拜堂", "拥有石砌礼拜空间、钟塔与高耸屋脊的聚落地标。", "detailed"),
] as const;

const localBuildingAssets = import.meta.glob<unknown>("./local-blueprints/buildings/*.json", {
  eager: true,
  import: "default",
});
const localDailyRewardAssets = import.meta.glob<unknown>("./local-blueprints/daily-rewards/*.json", {
  eager: true,
  import: "default",
});

export const BUILTIN_LOCAL_BUILDING_BLUEPRINTS: readonly BlueprintV1[] = Object.freeze(
  readLocalBlueprintAssets(localBuildingAssets),
);
const dailyRewardBlueprints: readonly BlueprintV1[] = Object.freeze(
  readLocalBlueprintAssets(localDailyRewardAssets),
);
export const BUILTIN_DAILY_REWARD_BLUEPRINTS: readonly BlueprintV1[] = dailyRewardBlueprints;

validateLocalAssetCounts(BUILTIN_LOCAL_BUILDING_BLUEPRINTS, dailyRewardBlueprints);
validateDailyRewardAssetLimits(dailyRewardBlueprints);

const LOCAL_BUILTIN_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  "builtin-local-advanced-matchbox": "Dieight的高级火柴盒：方正的火柴盒小屋，以简洁立面呈现紧凑轮廓。",
  "builtin-local-advanced-matchbox-plus": "Dieight的高级火柴盒plus：在方盒外形上增加层次的进阶小屋。",
  "builtin-local-advanced-matchbox-pro": "Dieight的高级火柴盒pro：轮廓更丰富、立面更完整的火柴盒住宅。",
  "builtin-local-gyp-simple-warehouse": "GYPpro的简易小仓库：以方正体量和简洁屋顶构成的小型仓库。",
  "builtin-local-mysterious-enchanting-table": "Dieight的神秘附魔台：以附魔台为中心的神秘魔法角落。",
  "builtin-local-small-villa": "Dieight的小别墅：有舒展屋顶与开阔立面的独栋小别墅。",
  "builtin-local-small-water-tank": "Dieight的小水箱：小巧的储水装饰，以方正箱体呈现水面。",
  "builtin-local-gkr-mansion": "karry_steven的豪宅：体量宽阔、层次分明的宅邸。",
  "builtin-local-gyp-mansion-first-floor": "GYPpro的豪宅（一层）：以宽大的首层平面展开的宅邸雏形。",
  "builtin-local-wqh-yellow-duck": "m0m0kA_QWQ的小黄鸭：小黄鸭造型装饰，有圆润身体和醒目的喙。",
});

export function localBuiltinBlueprintDescription(id: string, title: string): string {
  const known = LOCAL_BUILTIN_DESCRIPTIONS[id];
  if (known !== undefined) return known;
  const prefix = /^([A-Z]{2,6})的/.exec(title)?.[1] ?? "Dieight";
  return `${prefix}：以“${title}”为主题的补充建筑。`;
}

export const BUILTIN_BLUEPRINT_CATALOG: readonly BlueprintCatalogEntry[] = composeBuiltinBlueprintCatalog(
  CORE_BUILTIN_BLUEPRINT_CATALOG,
  BUILTIN_LOCAL_BUILDING_BLUEPRINTS,
);

/** Keeps the checked-in catalog usable when this machine has no private local assets. */
export function composeBuiltinBlueprintCatalog(
  baseCatalog: readonly BlueprintCatalogEntry[],
  localBlueprints: readonly BlueprintV1[],
): readonly BlueprintCatalogEntry[] {
  const ids = new Set(baseCatalog.map((entry) => entry.id));
  const supplemental = localBlueprints.map((rawBlueprint) => {
    const blueprint = validateBlueprint(rawBlueprint);
    if (!blueprint.id.startsWith("builtin-local-")) {
      throw new BlueprintValidationError(`Local built-in ID must start with builtin-local-: ${blueprint.id}`);
    }
    if (ids.has(blueprint.id)) throw new BlueprintValidationError(`Duplicate built-in blueprint ID ${blueprint.id}`);
    ids.add(blueprint.id);
    const complexity: BlueprintComplexity = blueprint.voxels.length < 1_000
      ? "simple"
      : blueprint.voxels.length < 5_000 ? "moderate" : "detailed";
    return catalogEntry(blueprint, blueprint.title, localBuiltinBlueprintDescription(blueprint.id, blueprint.title), complexity);
  });
  return Object.freeze([...baseCatalog, ...supplemental]);
}

function readLocalBlueprintAssets(assets: Record<string, unknown>): BlueprintV1[] {
  return Object.entries(assets)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, raw]) => {
      const blueprint = validateBlueprint(raw);
      if (!blueprint.id.startsWith("builtin-local-")) {
        throw new BlueprintValidationError(`Local built-in ID must start with builtin-local-: ${blueprint.id}`);
      }
      const filename = path.slice(path.lastIndexOf("/") + 1);
      if (filename !== `${blueprint.id}.json`) {
        throw new BlueprintValidationError(`Local built-in asset filename must match its ID: ${path}`);
      }
      return blueprint;
    });
}

function validateDailyRewardAssetLimits(blueprints: readonly BlueprintV1[]): void {
  for (const blueprint of blueprints) {
    const width = blueprint.bounds.maxX - blueprint.bounds.minX + 1;
    const height = blueprint.bounds.maxY - blueprint.bounds.minY + 1;
    const depth = blueprint.bounds.maxZ - blueprint.bounds.minZ + 1;
    if (width > 12 || height > 16 || depth > 12 || blueprint.voxels.length > 2_000) {
      throw new BlueprintValidationError(`Local daily reward ${blueprint.id} exceeds 12 x 12 x 16 / 2000 voxels`);
    }
  }
}

function validateLocalAssetCounts(buildings: readonly BlueprintV1[], rewards: readonly BlueprintV1[]): void {
  if (buildings.length !== 0 && buildings.length !== 7) {
    throw new BlueprintValidationError(`Local building catalog must include all seven blueprints; found ${buildings.length}`);
  }
  if (rewards.length !== 0 && rewards.length !== 3) {
    throw new BlueprintValidationError(`Local daily reward catalog must include all three blueprints; found ${rewards.length}`);
  }
}

export const BUILTIN_BLUEPRINTS: ReadonlyMap<string, BlueprintV1> = new Map(
  BUILTIN_BLUEPRINT_CATALOG.map((entry) => [entry.id, entry.blueprint]),
);

export function resolveBuiltinBlueprint(id: string): BlueprintV1 {
  return BUILTIN_BLUEPRINTS.get(id) ?? UNKNOWN_BLUEPRINT_PLACEHOLDER;
}
