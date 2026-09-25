import { Gunzip } from "fflate";
import {
  MOVING_PISTON_FACINGS,
  SIGN_DYE_COLORS,
  validateBlueprint,
  type BlueprintBounds,
  type BlueprintV1,
  type BlueprintVoxel,
  type MaterialId,
} from "@tomato-clock/voxel";
import {
  JAVA_NBT_TAG_TYPE,
  parseJavaNbtWithPistonNumericTagTypes,
  type PistonEntityNumericField,
} from "./nbt.js";

export interface LitematicLimits {
  maxCompressedBytes: number;
  maxUncompressedBytes: number;
  maxRegions: number;
  maxHorizontalAxisLength: number;
  maxVerticalAxisLength: number;
  maxRegionVolume: number;
  maxTotalVolume: number;
  maxPaletteEntries: number;
  maxOutputVoxels: number;
}

export const DEFAULT_LITEMATIC_LIMITS: Readonly<LitematicLimits> = Object.freeze({
  maxCompressedBytes: 64 * 1024 * 1024,
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxRegions: 64,
  maxHorizontalAxisLength: 96,
  maxVerticalAxisLength: 256,
  maxRegionVolume: 16_777_216,
  maxTotalVolume: 16_777_216,
  maxPaletteEntries: 4096,
  maxOutputVoxels: 300_000,
});

export type LitematicErrorCode =
  | "INPUT_TOO_LARGE"
  | "NOT_GZIP"
  | "INVALID_GZIP"
  | "NBT_TOO_LARGE"
  | "INVALID_NBT"
  | "INVALID_LITEMATIC"
  | "UNSUPPORTED_BLOCK_ENTITY_DATA"
  | "LIMIT_EXCEEDED";

export class LitematicParseError extends Error {
  override readonly name = "LitematicParseError";
  readonly code: LitematicErrorCode;
  constructor(code: LitematicErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export interface LitematicRegionPreview {
  name: string;
  position: { x: number; y: number; z: number };
  signedSize: { x: number; y: number; z: number };
  dimensions: { width: number; height: number; depth: number };
  paletteEntries: number;
  volume: number;
}

export interface LitematicCompatibility {
  mappedPaletteEntries: number;
  placeholderPaletteEntries: number;
  placeholderBlockNames: string[];
  placeholderVoxelCount: number;
  preservedBlockStateProperties: string[];
  ignoredEntities: number;
  ignoredTileEntities: number;
  preservedMovingPistonMovedStates: number;
  preservedMovingPistonPoses: number;
  preservedSignBlockEntities: number;
  preservedCampfireBlockEntities: number;
  ignoredPendingTicks: number;
}

export interface LitematicPreview {
  name: string;
  author: string;
  description: string;
  litematicVersion: number;
  litematicSubVersion: number | null;
  minecraftDataVersion: number;
  dimensions: { width: number; height: number; depth: number };
  regionCount: number;
  paletteEntries: number;
  nonAirBlockCount: number;
  metadataTotalBlocks: number | null;
  regions: LitematicRegionPreview[];
  compatibility: LitematicCompatibility;
}

export interface LitematicImportResult {
  blueprint: BlueprintV1;
  preview: LitematicPreview;
}

type RecordValue = Record<string, unknown>;
type Position = { x: number; y: number; z: number };
type PaletteEntry = { name: string; properties: Record<string, string> };

interface DecodedVoxel extends Position {
  state: PaletteEntry;
  materialId: MaterialId;
  placeholder: boolean;
  movingPistonMovedState?: NonNullable<BlueprintVoxel["movingPistonMovedState"]>;
  movingPistonPose?: NonNullable<BlueprintVoxel["movingPistonPose"]>;
  sign?: NonNullable<BlueprintVoxel["sign"]>;
  campfire?: NonNullable<BlueprintVoxel["campfire"]>;
}

interface ParsedRegion {
  preview: LitematicRegionPreview;
  palette: PaletteEntry[];
  packedStates: unknown[];
  entities: number;
  tileEntities: unknown[];
  pendingTicks: number;
}

export async function parseLitematic(
  input: Uint8Array,
  options: { limits?: Partial<LitematicLimits>; blueprintId?: string } = {},
): Promise<LitematicImportResult> {
  const limits = resolveLimits(options.limits);
  if (input.byteLength > limits.maxCompressedBytes) {
    throw new LitematicParseError("INPUT_TOO_LARGE", `Compressed file exceeds ${limits.maxCompressedBytes} bytes`);
  }
  if (input.byteLength < 2 || input[0] !== 0x1f || input[1] !== 0x8b) {
    throw new LitematicParseError("NOT_GZIP", "Litematic input must be gzip-compressed NBT");
  }

  let uncompressed: Uint8Array;
  try {
    uncompressed = gunzipWithLimit(input, limits.maxUncompressedBytes);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown gzip error";
    const tooLarge = /larger than|too large|maxOutputLength/i.test(message);
    throw new LitematicParseError(tooLarge ? "NBT_TOO_LARGE" : "INVALID_GZIP", message, { cause });
  }

  let nbtDocument: ReturnType<typeof parseJavaNbtWithPistonNumericTagTypes>;
  try {
    nbtDocument = parseJavaNbtWithPistonNumericTagTypes(uncompressed);
  } catch (cause) {
    throw new LitematicParseError("INVALID_NBT", "Could not parse Java big-endian NBT", { cause });
  }
  const root = record(nbtDocument.root, "root");
  const metadata = optionalRecord(root.Metadata, "Metadata") ?? {};
  const regionsRecord = record(root.Regions, "Regions");
  const regionNames = Object.keys(regionsRecord).sort(compareText);
  if (regionNames.length === 0) invalid("Litematic contains no regions");
  enforce(regionNames.length <= limits.maxRegions, `Region count exceeds ${limits.maxRegions}`);

  const parsedRegions: ParsedRegion[] = [];
  let totalVolume = 0;
  for (const regionName of regionNames) {
    const parsed = parseRegion(regionName, regionsRecord[regionName], limits);
    totalVolume = safeAdd(totalVolume, parsed.preview.volume, "Total region volume overflow");
    enforce(totalVolume <= limits.maxTotalVolume, `Total region volume exceeds ${limits.maxTotalVolume}`);
    parsedRegions.push(parsed);
  }
  const dimensions = declaredDimensions(parsedRegions);
  enforce(dimensions.width <= limits.maxHorizontalAxisLength && dimensions.depth <= limits.maxHorizontalAxisLength,
    `Combined horizontal footprint exceeds ${limits.maxHorizontalAxisLength}`);
  enforce(dimensions.height <= limits.maxVerticalAxisLength,
    `Combined height exceeds ${limits.maxVerticalAxisLength}`);

  const blocks = new Map<string, DecodedVoxel>();
  const placeholderNames = new Set<string>();
  const simplifiedPropertyNames = new Set<string>();
  let mappedPaletteEntries = 0;
  let placeholderPaletteEntries = 0;
  let paletteEntries = 0;
  let ignoredEntities = 0;
  let tileEntityCount = 0;
  let ignoredPendingTicks = 0;

  for (const region of parsedRegions) {
    paletteEntries += region.palette.length;
    ignoredEntities += region.entities;
    tileEntityCount += region.tileEntities.length;
    ignoredPendingTicks += region.pendingTicks;
    const paletteMappings = region.palette.map((entry) => mapBlock(entry));
    paletteMappings.forEach((mapping, index) => {
      if (isAir(region.palette[index]!.name)) return;
      Object.keys(region.palette[index]!.properties).forEach((property) => simplifiedPropertyNames.add(property));
      if (mapping.placeholder) {
        placeholderPaletteEntries += 1;
        placeholderNames.add(region.palette[index]!.name);
      } else {
        mappedPaletteEntries += 1;
      }
    });

    const { signedSize, position, dimensions, volume } = region.preview;
    const bitsPerEntry = Math.max(2, Math.ceil(Math.log2(region.palette.length)));
    const expectedLongs = Math.ceil((volume * bitsPerEntry) / 64);
    if (region.packedStates.length !== expectedLongs) {
      invalid(`Region ${region.preview.name} has ${region.packedStates.length} BlockStates longs; expected ${expectedLongs}`);
    }
    for (let index = 0; index < volume; index += 1) {
      const paletteIndex = readPackedIndex(region.packedStates, index, bitsPerEntry);
      const state = region.palette[paletteIndex];
      if (!state) invalid(`Region ${region.preview.name} references missing palette index ${paletteIndex}`);
      const localX = index % dimensions.width;
      const localZ = Math.floor(index / dimensions.width) % dimensions.depth;
      const localY = Math.floor(index / (dimensions.width * dimensions.depth));
      const world = {
        x: position.x + (signedSize.x < 0 ? -localX : localX),
        y: position.y + (signedSize.y < 0 ? -localY : localY),
        z: position.z + (signedSize.z < 0 ? -localZ : localZ),
      };
      const key = coordinateKey(world);
      if (isAir(state.name)) {
        blocks.delete(key);
        continue;
      }
      const mapping = paletteMappings[paletteIndex]!;
      blocks.set(key, { ...world, state, ...mapping });
      enforce(blocks.size <= limits.maxOutputVoxels, `Output block count exceeds ${limits.maxOutputVoxels}`);
    }
    attachMovingPistonMovedStates(region, blocks, nbtDocument.getNumericTagType);
    attachSignAndCampfireData(region, blocks);
  }

  if (blocks.size === 0) invalid("Litematic contains no non-air blocks");
  const decoded = [...blocks.values()];
  const preservedMovingPistonMovedStates = decoded.filter((voxel) => voxel.movingPistonMovedState !== undefined).length;
  const preservedMovingPistonPoses = decoded.filter((voxel) => voxel.movingPistonPose !== undefined).length;
  const preservedSignBlockEntities = decoded.filter((voxel) => voxel.sign !== undefined).length;
  const preservedCampfireBlockEntities = decoded.filter((voxel) => voxel.campfire !== undefined).length;
  const placeholderVoxelCount = decoded.filter((voxel) => voxel.placeholder).length;
  const worldBounds = boundsFor(decoded);
  const normalized = decoded.map((voxel) => ({
    ...voxel,
    x: voxel.x - worldBounds.minX,
    y: voxel.y - worldBounds.minY,
    z: voxel.z - worldBounds.minZ,
  }));
  const voxels = assignBuildOrder(normalized);
  const title = stringValue(metadata.Name, "Untitled Litematic");
  const contentHash = stableContentHash(uncompressed);
  const blueprint = validateBlueprint({
    schemaVersion: 1,
    id: options.blueprintId?.trim() || `litematic-${contentHash}`,
    title,
    bounds: boundsFor(voxels),
    voxels,
  });

  return {
    blueprint,
    preview: {
      name: title,
      author: stringValue(metadata.Author, ""),
      description: stringValue(metadata.Description, ""),
      litematicVersion: integerValue(root.Version, "Version"),
      litematicSubVersion: optionalIntegerValue(root.SubVersion, "SubVersion"),
      minecraftDataVersion: integerValue(root.MinecraftDataVersion, "MinecraftDataVersion"),
      dimensions,
      regionCount: parsedRegions.length,
      paletteEntries,
      nonAirBlockCount: blueprint.voxels.length,
      metadataTotalBlocks: optionalIntegerValue(metadata.TotalBlocks, "Metadata.TotalBlocks"),
      regions: parsedRegions.map((region) => region.preview),
      compatibility: {
        mappedPaletteEntries,
        placeholderPaletteEntries,
        placeholderBlockNames: [...placeholderNames].sort(compareText),
        placeholderVoxelCount,
        preservedBlockStateProperties: [...simplifiedPropertyNames].sort(compareText),
        ignoredEntities,
        ignoredTileEntities: tileEntityCount - preservedMovingPistonMovedStates - preservedSignBlockEntities - preservedCampfireBlockEntities,
        preservedMovingPistonMovedStates,
        preservedMovingPistonPoses,
        preservedSignBlockEntities,
        preservedCampfireBlockEntities,
        ignoredPendingTicks,
      },
    },
  };
}

function parseRegion(name: string, raw: unknown, limits: LitematicLimits): ParsedRegion {
  const region = record(raw, `Regions.${name}`);
  const position = positionValue(region.Position, `Regions.${name}.Position`);
  const signedSize = positionValue(region.Size, `Regions.${name}.Size`);
  if (signedSize.x === 0 || signedSize.y === 0 || signedSize.z === 0) invalid(`Region ${name} has a zero-sized axis`);
  const dimensions = { width: Math.abs(signedSize.x), height: Math.abs(signedSize.y), depth: Math.abs(signedSize.z) };
  enforce(dimensions.width <= limits.maxHorizontalAxisLength && dimensions.depth <= limits.maxHorizontalAxisLength,
    `Region ${name} horizontal footprint exceeds ${limits.maxHorizontalAxisLength}`);
  enforce(dimensions.height <= limits.maxVerticalAxisLength,
    `Region ${name} height exceeds ${limits.maxVerticalAxisLength}`);
  const volume = safeMultiply(dimensions.width, dimensions.height, dimensions.depth, `Region ${name} volume overflow`);
  enforce(volume <= limits.maxRegionVolume, `Region ${name} volume exceeds ${limits.maxRegionVolume}`);
  const rawPalette = arrayValue(region.BlockStatePalette, `Regions.${name}.BlockStatePalette`);
  enforce(rawPalette.length > 0, `Region ${name} palette is empty`);
  enforce(rawPalette.length <= limits.maxPaletteEntries, `Region ${name} palette exceeds ${limits.maxPaletteEntries}`);
  const palette = rawPalette.map((entry, index) => parsePaletteEntry(entry, `Regions.${name}.BlockStatePalette[${index}]`));
  const packedStates = arrayValue(region.BlockStates, `Regions.${name}.BlockStates`);
  return {
    preview: { name, position, signedSize, dimensions, paletteEntries: palette.length, volume },
    palette,
    packedStates,
    entities: optionalArrayLength(region.Entities, `Regions.${name}.Entities`),
    tileEntities: optionalArrayValue(region.TileEntities, `Regions.${name}.TileEntities`),
    pendingTicks: optionalArrayLength(region.PendingBlockTicks, `Regions.${name}.PendingBlockTicks`)
      + optionalArrayLength(region.PendingFluidTicks, `Regions.${name}.PendingFluidTicks`),
  };
}

function parsePaletteEntry(raw: unknown, path: string): PaletteEntry {
  const entry = record(raw, path);
  const name = stringValue(entry.Name, "");
  if (!/^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.test(name)) invalid(`${path}.Name is invalid`);
  const propertiesRecord = optionalRecord(entry.Properties, `${path}.Properties`) ?? {};
  const entries = Object.entries(propertiesRecord);
  if (entries.length > 32) invalid(`${path}.Properties has too many entries`);
  const properties: Record<string, string> = {};
  for (const [key, value] of entries.sort(([left], [right]) => compareText(left, right))) {
    if (!/^[a-z0-9_.-]+$/.test(key) || key.length > 64
      || key === "__proto__" || key === "prototype" || key === "constructor") {
      invalid(`${path}.Properties.${key} is not a safe block-state key`);
    }
    if (typeof value !== "string" || value.length === 0 || value.length > 128) {
      invalid(`${path}.Properties.${key} must be a string of 1 through 128 characters`);
    }
    properties[key] = value;
  }
  return { name, properties };
}

export function readPackedIndex(longs: readonly unknown[], index: number, bitsPerEntry: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(bitsPerEntry) || bitsPerEntry < 1 || bitsPerEntry > 32) {
    invalid("Invalid packed BlockStates index or bit width");
  }
  const startBit = index * bitsPerEntry;
  const startLong = Math.floor(startBit / 64);
  const bitOffset = startBit % 64;
  const first = unsignedLong(longs[startLong]);
  const mask = (1n << BigInt(bitsPerEntry)) - 1n;
  if (bitOffset + bitsPerEntry <= 64) return Number((first >> BigInt(bitOffset)) & mask);
  const lowBits = 64 - bitOffset;
  const second = unsignedLong(longs[startLong + 1]);
  return Number(((first >> BigInt(bitOffset)) | (second << BigInt(lowBits))) & mask);
}

function unsignedLong(raw: unknown): bigint {
  if (typeof raw === "bigint") return BigInt.asUintN(64, raw);
  if (Array.isArray(raw) && raw.length === 2 && raw.every((part) => typeof part === "number" && Number.isInteger(part))) {
    const high = BigInt(raw[0] as number);
    const low = BigInt(raw[1] as number) & 0xffff_ffffn;
    return BigInt.asUintN(64, (high << 32n) | low);
  }
  invalid("BlockStates contains an invalid 64-bit value");
}

function mapBlock(entry: PaletteEntry): { materialId: MaterialId; placeholder: boolean } {
  const [namespace, path = ""] = entry.name.split(":", 2);
  if (namespace !== "minecraft") return { materialId: "accent", placeholder: true };
  if (/(?:^|_)(?:glass|glass_pane|ice|stained_glass)(?:$|_)/.test(path)) return { materialId: "glass", placeholder: false };
  if (/(?:log|wood|stem|hyphae|bamboo_block|fence|fence_gate)$/.test(path)) return { materialId: "wood", placeholder: false };
  if (/(?:stairs|slab|tile|terracotta|concrete|wool|copper|purpur|prismarine)$/.test(path)) return { materialId: "roof", placeholder: false };
  if (/(?:planks|shelf|bookshelf|barrel|chest|crafting_table|lectern|door|trapdoor|sign|button|pressure_plate)$/.test(path)
    || /^(?:oak|spruce|birch|jungle|acacia|dark_oak|pale_oak|mangrove|cherry|bamboo|crimson|warped)_/.test(path)) {
    return { materialId: "plank", placeholder: false };
  }
  if (/(?:stone|cobble|brick|deepslate|andesite|diorite|granite|calcite|tuff|basalt|blackstone|quartz|sandstone|obsidian|ore|bedrock|dirt|grass_block|sand|gravel|mud|clay|netherrack|end_stone|observer|piston|resin|sulfur|cinnabar)/.test(path)) {
    return { materialId: "stone", placeholder: false };
  }
  if (/(?:torch|lantern|light|glowstone|campfire|end_rod|flower|plant|leaves|vine|moss|grass|fern|bush|sapling|banner|carpet|bed|rail|ladder|hopper|anvil|cauldron|chain|candle|pot|skull|head|bell|lever|iron_bars|water|lava|bubble_column)/.test(path)) {
    return { materialId: "accent", placeholder: false };
  }
  return { materialId: "accent", placeholder: true };
}

function isAir(name: string): boolean {
  return name === "minecraft:air" || name === "minecraft:cave_air" || name === "minecraft:void_air";
}

function assignBuildOrder(voxels: readonly DecodedVoxel[]): BlueprintVoxel[] {
  const first = voxels[0];
  if (!first) invalid("Litematic contains no non-air blocks");
  let minY = first.y;
  for (let index = 1; index < voxels.length; index += 1) minY = Math.min(minY, voxels[index]!.y);
  const byCoordinate = new Map(voxels.map((voxel) => [coordinateKey(voxel.x, voxel.y, voxel.z), voxel]));
  const queued = new Set<string>();
  const built = new Set<string>();
  const frontier = new ConstructionHeap(compareConstructionCandidates);
  const disconnected = voxels
    .filter((voxel) => !byCoordinate.has(coordinateKey(voxel.x, voxel.y - 1, voxel.z)))
    .sort(compareConstructionCandidates);
  let disconnectedIndex = 0;
  const ordered: DecodedVoxel[] = [];
  const enqueue = (voxel: DecodedVoxel | undefined, force = false): void => {
    if (!voxel) return;
    const key = coordinateKey(voxel.x, voxel.y, voxel.z);
    if (queued.has(key) || built.has(key)) return;
    if (!force && voxel.y !== minY) {
      const below = coordinateKey(voxel.x, voxel.y - 1, voxel.z);
      if (byCoordinate.has(below) && !built.has(below)) return;
      if (!neighborsOf(voxel).some((neighbor) => built.has(neighbor))) return;
    }
    queued.add(key);
    frontier.push(voxel);
  };
  voxels.filter((voxel) => voxel.y === minY).sort(compareConstructionCandidates).forEach((voxel) => enqueue(voxel));
  while (ordered.length < voxels.length) {
    let next = frontier.pop();
    if (!next) {
      // An intentionally detached component (for example a hanging detail) is
      // deferred until all ground-connected structure is complete.
      while (disconnectedIndex < disconnected.length
        && built.has(coordinateKey(disconnected[disconnectedIndex]!.x, disconnected[disconnectedIndex]!.y, disconnected[disconnectedIndex]!.z))) {
        disconnectedIndex += 1;
      }
      next = disconnected[disconnectedIndex];
      enqueue(next, true);
      next = frontier.pop();
    }
    if (!next) break;
    const key = coordinateKey(next.x, next.y, next.z);
    built.add(key);
    ordered.push(next);
    for (const neighbor of neighborsOf(next)) enqueue(byCoordinate.get(neighbor));
  }
  const divisor = Math.max(1, ordered.length - 1);
  return ordered.map((voxel, index) => {
    const emissive = emissiveSemantics(voxel.state);
    return {
      x: voxel.x,
      y: voxel.y,
      z: voxel.z,
      materialId: voxel.materialId,
      buildOrder: ordered.length === 1 ? 10000 : Math.round((index / divisor) * 10000),
      sourceBlockId: voxel.state.name,
      ...(Object.keys(voxel.state.properties).length > 0 ? { sourceBlockState: voxel.state.properties } : {}),
      ...(voxel.movingPistonMovedState === undefined ? {} : { movingPistonMovedState: voxel.movingPistonMovedState }),
      ...(voxel.movingPistonPose === undefined ? {} : { movingPistonPose: voxel.movingPistonPose }),
      ...(voxel.sign === undefined ? {} : { sign: voxel.sign }),
      ...(voxel.campfire === undefined ? {} : { campfire: voxel.campfire }),
      ...emissive,
    };
  });
}

class ConstructionHeap {
  private readonly values: DecodedVoxel[] = [];
  constructor(private readonly compare: (left: DecodedVoxel, right: DecodedVoxel) => number) {}
  get size(): number { return this.values.length; }
  push(value: DecodedVoxel): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.values[parent]!, value) <= 0) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = value;
  }
  pop(): DecodedVoxel | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (last && this.values.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= this.values.length) break;
        const right = left + 1;
        const child = right < this.values.length && this.compare(this.values[right]!, this.values[left]!) < 0 ? right : left;
        if (this.compare(this.values[child]!, last) >= 0) break;
        this.values[index] = this.values[child]!;
        index = child;
      }
      this.values[index] = last;
    }
    return first;
  }
}

function compareConstructionCandidates(left: DecodedVoxel, right: DecodedVoxel): number {
  return constructionDetailRank(left) - constructionDetailRank(right)
    || left.y - right.y || left.x - right.x || left.z - right.z
    || compareText(stateKey(left.state), stateKey(right.state));
}

function constructionDetailRank(voxel: DecodedVoxel): number {
  const path = voxel.state.name.split(":", 2)[1] ?? "";
  return voxel.materialId === "glass" || voxel.materialId === "accent"
    || /(?:door|trapdoor|sign|button|pressure_plate|ladder|rail|carpet|bed|torch|lantern|plant|leaves|vine|flower|banner|candle|chain|skull|head|bell|lever)$/.test(path)
    ? 1 : 0;
}

function neighborsOf(voxel: Position): string[] {
  return [
    coordinateKey(voxel.x - 1, voxel.y, voxel.z), coordinateKey(voxel.x + 1, voxel.y, voxel.z),
    coordinateKey(voxel.x, voxel.y - 1, voxel.z), coordinateKey(voxel.x, voxel.y + 1, voxel.z),
    coordinateKey(voxel.x, voxel.y, voxel.z - 1), coordinateKey(voxel.x, voxel.y, voxel.z + 1),
  ];
}

function emissiveSemantics(state: PaletteEntry): Pick<BlueprintVoxel, "emissiveKind" | "emissiveLevel"> {
  const lit = state.properties.lit !== "false";
  const path = state.name.split(":", 2)[1] ?? "";
  switch (state.name) {
    case "minecraft:torch":
    case "minecraft:wall_torch":
      return { emissiveKind: "torch", emissiveLevel: 14 };
    case "minecraft:soul_torch":
    case "minecraft:soul_wall_torch":
      return { emissiveKind: "soul_torch", emissiveLevel: 10 };
    case "minecraft:lantern":
      return { emissiveKind: "lantern", emissiveLevel: 15 };
    case "minecraft:soul_lantern":
      return { emissiveKind: "soul_lantern", emissiveLevel: 10 };
    case "minecraft:campfire":
      return lit ? { emissiveKind: "campfire", emissiveLevel: 15 } : {};
    case "minecraft:soul_campfire":
      return lit ? { emissiveKind: "soul_campfire", emissiveLevel: 10 } : {};
    case "minecraft:glowstone":
      return { emissiveKind: "glowstone", emissiveLevel: 15 };
    case "minecraft:sea_lantern":
      return { emissiveKind: "sea_lantern", emissiveLevel: 15 };
    case "minecraft:shroomlight":
      return { emissiveKind: "shroomlight", emissiveLevel: 15 };
    case "minecraft:ochre_froglight":
    case "minecraft:verdant_froglight":
    case "minecraft:pearlescent_froglight":
      return { emissiveKind: "froglight", emissiveLevel: 15 };
    case "minecraft:end_rod":
      return { emissiveKind: "end_rod", emissiveLevel: 14 };
    case "minecraft:jack_o_lantern":
      return { emissiveKind: "jack_o_lantern", emissiveLevel: 15 };
    case "minecraft:redstone_torch":
    case "minecraft:redstone_wall_torch":
      return lit ? { emissiveKind: "redstone_torch", emissiveLevel: 7 } : {};
    case "minecraft:redstone_lamp":
      return lit ? { emissiveKind: "redstone_lamp", emissiveLevel: 15 } : {};
    case "minecraft:magma_block":
      return { emissiveKind: "magma", emissiveLevel: 3 };
    case "minecraft:crying_obsidian":
      return { emissiveKind: "crying_obsidian", emissiveLevel: 10 };
    case "minecraft:glow_lichen":
      return { emissiveKind: "glow_lichen", emissiveLevel: 7 };
    case "minecraft:fire":
      return { emissiveKind: "fire", emissiveLevel: 15 };
    case "minecraft:soul_fire":
      return { emissiveKind: "soul_fire", emissiveLevel: 10 };
    case "minecraft:light": {
      const level = Number(state.properties.level ?? "15");
      return Number.isInteger(level) && level >= 1 && level <= 15 ? { emissiveKind: "light", emissiveLevel: level } : {};
    }
    default:
      if (/(?:^|_)copper_torch$|(?:^|_)copper_wall_torch$/.test(path)) {
        return { emissiveKind: "copper_torch", emissiveLevel: 14 };
      }
      if (/(?:^|_)copper_lantern$/.test(path)) {
        return { emissiveKind: "copper_lantern", emissiveLevel: 15 };
      }
      if (/(?:^|_)copper_bulb$/.test(path) && lit) {
        const level = path.includes("oxidized") ? 4 : path.includes("weathered") ? 8 : path.includes("exposed") ? 12 : 15;
        return { emissiveKind: "copper_bulb", emissiveLevel: level };
      }
      if (state.name === "minecraft:sea_pickle" && state.properties.waterlogged !== "false") {
        const rawPickles = Number(state.properties.pickles ?? "1");
        const pickles = Number.isInteger(rawPickles) && rawPickles >= 1 && rawPickles <= 4 ? rawPickles : 1;
        return { emissiveKind: "sea_pickle", emissiveLevel: 3 + pickles * 3 };
      }
      if (state.name === "minecraft:respawn_anchor") {
        const rawCharges = Number(state.properties.charges ?? "0");
        if (Number.isInteger(rawCharges) && rawCharges >= 1 && rawCharges <= 4) {
          return { emissiveKind: "respawn_anchor", emissiveLevel: rawCharges * 4 - 1 };
        }
      }
      if (/(?:^|_)candle$/.test(path) && lit) {
        const rawCandles = Number(state.properties.candles ?? "1");
        const candles = Number.isInteger(rawCandles) && rawCandles >= 1 && rawCandles <= 4 ? rawCandles : 1;
        return { emissiveKind: "candle", emissiveLevel: candles * 3 };
      }
      return {};
  }
}

function stateKey(state: PaletteEntry): string {
  return `${state.name}[${Object.entries(state.properties).sort(([a], [b]) => compareText(a, b)).map(([key, value]) => `${key}=${value}`).join(",")}]`;
}

function boundsFor(voxels: ReadonlyArray<Position>): BlueprintBounds {
  const first = voxels[0];
  if (!first) invalid("Litematic contains no non-air blocks");
  const bounds: BlueprintBounds = {
    minX: first.x, maxX: first.x,
    minY: first.y, maxY: first.y,
    minZ: first.z, maxZ: first.z,
  };
  for (let index = 1; index < voxels.length; index += 1) {
    const voxel = voxels[index]!;
    bounds.minX = Math.min(bounds.minX, voxel.x); bounds.maxX = Math.max(bounds.maxX, voxel.x);
    bounds.minY = Math.min(bounds.minY, voxel.y); bounds.maxY = Math.max(bounds.maxY, voxel.y);
    bounds.minZ = Math.min(bounds.minZ, voxel.z); bounds.maxZ = Math.max(bounds.maxZ, voxel.z);
  }
  return bounds;
}

/**
 * Extract only the moved vanilla block state and bounded saved pose from
 * piston block entities that align with a moving_piston voxel. Position and
 * unrelated NBT are discarded.
 */
function attachMovingPistonMovedStates(
  region: ParsedRegion,
  blocks: Map<string, DecodedVoxel>,
  getNumericTagType: (entity: RecordValue, field: PistonEntityNumericField) => number | undefined,
): void {
  const { position, signedSize, dimensions } = region.preview;
  for (const raw of region.tileEntities) {
    if (!isRecord(raw) || raw.id !== "minecraft:piston") continue;
    const x = raw.x; const y = raw.y; const z = raw.z;
    if (!integerValueOrNull(x) || !integerValueOrNull(y) || !integerValueOrNull(z)
      || x < 0 || x >= dimensions.width || y < 0 || y >= dimensions.height || z < 0 || z >= dimensions.depth) continue;
    const blockId = position.x + (signedSize.x < 0 ? -x : x);
    const blockY = position.y + (signedSize.y < 0 ? -y : y);
    const blockZ = position.z + (signedSize.z < 0 ? -z : z);
    const voxel = blocks.get(coordinateKey(blockId, blockY, blockZ));
    if (voxel?.state.name !== "minecraft:moving_piston") continue;
    const movedState = parsePistonMovedState(raw);
    if (movedState === null) continue;
    voxel.movingPistonMovedState = movedState;
    const pose = parsePistonPose(raw, getNumericTagType);
    if (pose !== null) voxel.movingPistonPose = pose;
  }
}

function parsePistonPose(
  entity: RecordValue,
  getNumericTagType: (entity: RecordValue, field: PistonEntityNumericField) => number | undefined,
): NonNullable<BlueprintVoxel["movingPistonPose"]> | null {
  const facingId = entity.facing;
  const progress = entity.progress;
  const extending = nbtBooleanOrNull(entity.extending);
  const source = nbtBooleanOrNull(entity.source);
  if (getNumericTagType(entity, "facing") !== JAVA_NBT_TAG_TYPE.INT
    || getNumericTagType(entity, "progress") !== JAVA_NBT_TAG_TYPE.FLOAT
    || getNumericTagType(entity, "extending") !== JAVA_NBT_TAG_TYPE.BYTE
    || getNumericTagType(entity, "source") !== JAVA_NBT_TAG_TYPE.BYTE
    || typeof facingId !== "number" || !Number.isSafeInteger(facingId)
    || facingId < 0 || facingId >= MOVING_PISTON_FACINGS.length
    || typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 1
    || extending === null || source === null) return null;
  const facing = MOVING_PISTON_FACINGS[facingId];
  if (facing === undefined) return null;
  return { facing, progress, extending, source };
}

function nbtBooleanOrNull(value: unknown): boolean | null {
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}

function parsePistonMovedState(entity: RecordValue): NonNullable<BlueprintVoxel["movingPistonMovedState"]> | null {
  const hasBlockState = Object.prototype.hasOwnProperty.call(entity, "blockState");
  const hasMovedState = Object.prototype.hasOwnProperty.call(entity, "movedState");
  if (hasBlockState === hasMovedState) return null;
  const raw = entity[hasBlockState ? "blockState" : "movedState"];
  if (!isRecord(raw)) return null;

  const hasName = Object.prototype.hasOwnProperty.call(raw, "Name");
  const hasId = Object.prototype.hasOwnProperty.call(raw, "id");
  if (hasName === hasId) return null;
  const blockId = raw[hasName ? "Name" : "id"];
  if (typeof blockId !== "string" || blockId.length > 256 || !/^minecraft:[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*$/.test(blockId)
    || blockId === "minecraft:air" || blockId === "minecraft:cave_air" || blockId === "minecraft:void_air"
    || blockId === "minecraft:moving_piston") return null;

  const hasProperties = Object.prototype.hasOwnProperty.call(raw, "Properties");
  const hasLowercaseProperties = Object.prototype.hasOwnProperty.call(raw, "properties");
  if (hasProperties && hasLowercaseProperties) return null;
  const rawProperties = raw[hasProperties ? "Properties" : "properties"];
  if (rawProperties === undefined) return { blockId };
  if (!isRecord(rawProperties)) return null;
  const keys = Reflect.ownKeys(rawProperties);
  if (keys.length > 32) return null;
  const properties: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of keys) {
    if (typeof key !== "string" || key.length > 64 || !/^[a-z0-9_.-]+$/.test(key)
      || key === "__proto__" || key === "prototype" || key === "constructor") return null;
    const descriptor = Object.getOwnPropertyDescriptor(rawProperties, key);
    if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined
      || typeof descriptor.value !== "string" || descriptor.value.length === 0 || descriptor.value.length > 128
      || !/^[a-z0-9_./-]+$/.test(descriptor.value)) return null;
    properties[key] = descriptor.value;
  }
  const ordered = Object.fromEntries(Object.entries(properties).sort(([left], [right]) => compareText(left, right)));
  return Object.keys(ordered).length === 0 ? { blockId } : { blockId, properties: ordered };
}

function attachSignAndCampfireData(region: ParsedRegion, blocks: Map<string, DecodedVoxel>): void {
  const { position, signedSize, dimensions } = region.preview;
  for (const raw of region.tileEntities) {
    if (!isRecord(raw)) continue;
    const entityId = raw.id;
    const isSignEntity = entityId === "minecraft:sign" || entityId === "minecraft:hanging_sign";
    const isCampfireEntity = entityId === "minecraft:campfire";
    if (!isSignEntity && !isCampfireEntity) continue;

    const x = raw.x; const y = raw.y; const z = raw.z;
    if (!integerValueOrNull(x) || !integerValueOrNull(y) || !integerValueOrNull(z)
      || x < 0 || x >= dimensions.width || y < 0 || y >= dimensions.height || z < 0 || z >= dimensions.depth) continue;
    const world = {
      x: position.x + (signedSize.x < 0 ? -x : x),
      y: position.y + (signedSize.y < 0 ? -y : y),
      z: position.z + (signedSize.z < 0 ? -z : z),
    };
    const key = coordinateKey(world);
    const voxel = blocks.get(key);
    if (!voxel) continue;

    if (isSignEntity && isSignBlockId(voxel.state.name)) {
      if (voxel.sign !== undefined) invalid("Duplicate sign block entity for one voxel");
      voxel.sign = parseSignBlockEntity(raw);
    } else if (isCampfireEntity && isCampfireBlockId(voxel.state.name)) {
      if (voxel.campfire !== undefined) invalid("Duplicate campfire block entity for one voxel");
      voxel.campfire = parseCampfireBlockEntity(raw);
    }
  }
}

function isSignBlockId(blockId: string): boolean {
  return blockId.startsWith("minecraft:") && /sign$/.test(blockId);
}

function isCampfireBlockId(blockId: string): boolean {
  return blockId === "minecraft:campfire" || blockId === "minecraft:soul_campfire";
}

function parseSignBlockEntity(entity: RecordValue): NonNullable<BlueprintVoxel["sign"]> {
  if (entity.front_text !== undefined || entity.back_text !== undefined) {
    return {
      front: parseSignFace(entity.front_text, "TileEntities.sign.front_text"),
      back: parseSignFace(entity.back_text, "TileEntities.sign.back_text"),
    };
  }
  if (["Text1", "Text2", "Text3", "Text4"].some((key) => entity[key] !== undefined)) {
    const lines = ["Text1", "Text2", "Text3", "Text4"]
      .filter((key) => entity[key] !== undefined)
      .map((key) => parseSignComponent(entity[key], `TileEntities.sign.${key}`));
    const dyeColor = parseSignDyeColor(entity.Color, "TileEntities.sign.Color", "black");
    const glowing = parseNbtBoolean(entity.GlowingText, "TileEntities.sign.GlowingText", false);
    return {
      front: { lines, dyeColor, glowing },
      back: emptySignFace(),
    };
  }
  return { front: emptySignFace(), back: emptySignFace() };
}

function parseSignFace(raw: unknown, path: string): NonNullable<BlueprintVoxel["sign"]>["front"] {
  if (raw === undefined) return emptySignFace();
  const face = record(raw, path);
  const rawMessages = face.messages;
  let lines: string[] = [];
  if (rawMessages !== undefined) {
    if (!Array.isArray(rawMessages) || rawMessages.length > 4) invalid(`${path}.messages must contain at most four lines`);
    lines = rawMessages.map((message, index) => parseSignComponent(message, `${path}.messages[${index}]`));
  }
  const dyeColor = parseSignDyeColor(face.color, `${path}.color`, "black");
  const glowing = parseNbtBoolean(face.has_glowing_text, `${path}.has_glowing_text`, false);
  return { lines, dyeColor, glowing };
}

function emptySignFace(): NonNullable<BlueprintVoxel["sign"]>["front"] {
  return { lines: [], dyeColor: "black", glowing: false };
}

function parseSignDyeColor(raw: unknown, path: string, fallback: string): NonNullable<BlueprintVoxel["sign"]>["front"]["dyeColor"] {
  const color = raw === undefined ? fallback : raw;
  if (typeof color !== "string" || !(SIGN_DYE_COLORS as readonly string[]).includes(color)) {
    invalid(`${path} must be one of the 16 vanilla dye colors`);
  }
  return color as NonNullable<BlueprintVoxel["sign"]>["front"]["dyeColor"];
}

function parseNbtBoolean(raw: unknown, path: string, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (raw === 0 || raw === false) return false;
  if (raw === 1 || raw === true) return true;
  invalid(`${path} must be a boolean byte`);
}

const MAX_SIGN_COMPONENT_BYTES = 8192;
const MAX_SIGN_COMPONENT_DEPTH = 8;
const MAX_SIGN_COMPONENT_NODES = 64;
const MAX_SIGN_LINE_LENGTH = 256;
const SIGN_LINE_CONTROL = /[\u0000-\u001f\u007f]/;
const DISCARDED_SIGN_COMPONENT_KEYS = new Set([
  "bold", "italic", "underlined", "strikethrough", "obfuscated", "font", "color", "shadow_color", "insertion",
  "clickEvent", "hoverEvent", "click_event", "hover_event",
]);
const DYNAMIC_SIGN_COMPONENT_KEYS = new Set(["translate", "with", "selector", "score", "nbt", "keybind", "separator"]);

function parseSignComponent(raw: unknown, path: string): string {
  if (typeof raw !== "string" || raw.length > MAX_SIGN_COMPONENT_BYTES) invalid(`${path} must be a bounded serialized text component`);
  // Older Litematic exporters can store an untouched sign line as an empty
  // NBT string, rather than as the JSON component `""`.
  if (raw === "") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid(`${path} must contain valid serialized text component JSON`);
  }
  const budget = { nodes: 0 };
  const text = flattenSignComponent(parsed, path, 0, budget);
  if (text.length > MAX_SIGN_LINE_LENGTH || SIGN_LINE_CONTROL.test(text)) {
    invalid(`${path} exceeds the plain display text limit`);
  }
  return text;
}

function flattenSignComponent(raw: unknown, path: string, depth: number, budget: { nodes: number }): string {
  budget.nodes += 1;
  if (depth > MAX_SIGN_COMPONENT_DEPTH || budget.nodes > MAX_SIGN_COMPONENT_NODES) {
    throw new LitematicParseError("LIMIT_EXCEEDED", "Sign text component structure exceeds its limit");
  }
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw.map((entry, index) => flattenSignComponent(entry, `${path}[${index}]`, depth + 1, budget)).join("");
  }
  if (!isRecord(raw)) invalid(`${path} is not a plain display component`);
  let text = "";
  if (Object.hasOwn(raw, "text")) {
    if (typeof raw.text !== "string") invalid(`${path}.text must be plain text`);
    text = raw.text;
  }
  const extra = raw.extra;
  if (extra !== undefined) {
    if (!Array.isArray(extra)) invalid(`${path}.extra must be a component list`);
    text += extra.map((entry, index) => flattenSignComponent(entry, `${path}.extra[${index}]`, depth + 1, budget)).join("");
  }
  for (const key of Object.keys(raw)) {
    if (key === "text" || key === "extra" || DISCARDED_SIGN_COMPONENT_KEYS.has(key)) continue;
    if (DYNAMIC_SIGN_COMPONENT_KEYS.has(key)) unsupportedBlockEntity("Dynamic sign text components are unsupported");
    unsupportedBlockEntity("Sign component contains unsupported display data");
  }
  return text;
}

function parseCampfireBlockEntity(entity: RecordValue): NonNullable<BlueprintVoxel["campfire"]> {
  const rawItems = entity.Items;
  if (rawItems === undefined) return { slots: [] };
  if (!Array.isArray(rawItems) || rawItems.length > 4) invalid("Campfire Items must contain at most four entries");
  const seenSlots = new Set<number>();
  const slots = rawItems.map((rawItem, index) => {
    const path = `TileEntities.campfire.Items[${index}]`;
    const item = record(rawItem, path);
    const itemId = item.id;
    if (typeof itemId !== "string" || itemId.length > 256 || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(itemId)) {
      invalid(`${path}.id must be a bounded namespaced item ID`);
    }
    const hasUpperCount = Object.hasOwn(item, "Count");
    const hasLowerCount = Object.hasOwn(item, "count");
    if (hasUpperCount === hasLowerCount) invalid(`${path} must contain exactly one count field`);
    const count = item[hasUpperCount ? "Count" : "count"];
    if (!integerValueOrNull(count) || count < 1 || count > 64) invalid(`${path}.count must be from 1 through 64`);
    const slot = item.Slot;
    if (!integerValueOrNull(slot) || slot < 0 || slot > 3) invalid(`${path}.Slot must be from 0 through 3`);
    if (seenSlots.has(slot)) invalid("Campfire item slots must be unique");
    seenSlots.add(slot);
    assertNoUnsupportedItemPayload(item, path);
    return { slot: slot as 0 | 1 | 2 | 3, itemId, count };
  });
  slots.sort((left, right) => left.slot - right.slot);
  return { slots };
}

function assertNoUnsupportedItemPayload(item: RecordValue, path: string): void {
  for (const componentKey of ["components", "tag"]) {
    if (!Object.hasOwn(item, componentKey)) continue;
    const components = record(item[componentKey], `${path}.${componentKey}`);
    if (Object.keys(components).length > 0) {
      unsupportedBlockEntity("Campfire item components can change item models and are unsupported");
    }
  }
  for (const key of Object.keys(item)) {
    if (!["id", "Count", "count", "Slot", "components", "tag"].includes(key)) {
      unsupportedBlockEntity("Campfire item contains unsupported model data");
    }
  }
}

function unsupportedBlockEntity(message: string): never {
  throw new LitematicParseError("UNSUPPORTED_BLOCK_ENTITY_DATA", message);
}

function dimensionsFor(bounds: BlueprintBounds): { width: number; height: number; depth: number } {
  return { width: bounds.maxX - bounds.minX + 1, height: bounds.maxY - bounds.minY + 1, depth: bounds.maxZ - bounds.minZ + 1 };
}

function declaredDimensions(regions: readonly ParsedRegion[]): { width: number; height: number; depth: number } {
  const extents = regions.map(({ preview }) => {
    const end = {
      x: preview.position.x + (preview.signedSize.x < 0 ? -(preview.dimensions.width - 1) : preview.dimensions.width - 1),
      y: preview.position.y + (preview.signedSize.y < 0 ? -(preview.dimensions.height - 1) : preview.dimensions.height - 1),
      z: preview.position.z + (preview.signedSize.z < 0 ? -(preview.dimensions.depth - 1) : preview.dimensions.depth - 1),
    };
    return {
      minX: Math.min(preview.position.x, end.x), maxX: Math.max(preview.position.x, end.x),
      minY: Math.min(preview.position.y, end.y), maxY: Math.max(preview.position.y, end.y),
      minZ: Math.min(preview.position.z, end.z), maxZ: Math.max(preview.position.z, end.z),
    };
  });
  return dimensionsFor({
    minX: Math.min(...extents.map((extent) => extent.minX)), maxX: Math.max(...extents.map((extent) => extent.maxX)),
    minY: Math.min(...extents.map((extent) => extent.minY)), maxY: Math.max(...extents.map((extent) => extent.maxY)),
    minZ: Math.min(...extents.map((extent) => extent.minZ)), maxZ: Math.max(...extents.map((extent) => extent.maxZ)),
  });
}

function positionValue(raw: unknown, path: string): Position {
  const value = record(raw, path);
  return { x: integerValue(value.x, `${path}.x`), y: integerValue(value.y, `${path}.y`), z: integerValue(value.z, `${path}.z`) };
}

function resolveLimits(overrides: Partial<LitematicLimits> | undefined): LitematicLimits {
  const limits = { ...DEFAULT_LITEMATIC_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new LitematicParseError("LIMIT_EXCEEDED", `${name} must be a positive safe integer`);
  }
  return limits;
}

function gunzipWithLimit(input: Uint8Array, maxOutputBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let streamError: Error | null = null;
  const gunzip = new Gunzip((chunk) => {
    total += chunk.byteLength;
    if (total > maxOutputBytes) {
      streamError = new Error(`Decompressed NBT is larger than ${maxOutputBytes} bytes`);
      return;
    }
    chunks.push(chunk);
  });
  gunzip.push(input, true);
  if (streamError) throw streamError;
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function stableContentHash(bytes: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
    second = ((second << 13) | (second >>> 19)) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function record(raw: unknown, path: string): RecordValue {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) invalid(`${path} must be a compound`);
  return raw as RecordValue;
}

function isRecord(raw: unknown): raw is RecordValue {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function optionalRecord(raw: unknown, path: string): RecordValue | null {
  return raw === undefined ? null : record(raw, path);
}

function arrayValue(raw: unknown, path: string): unknown[] {
  if (!Array.isArray(raw)) invalid(`${path} must be a list or array`);
  return raw;
}

function optionalArrayLength(raw: unknown, path: string): number {
  return raw === undefined ? 0 : arrayValue(raw, path).length;
}

function optionalArrayValue(raw: unknown, path: string): unknown[] {
  return raw === undefined ? [] : arrayValue(raw, path);
}

function integerValue(raw: unknown, path: string): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) invalid(`${path} must be an integer`);
  return raw;
}

function integerValueOrNull(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isSafeInteger(raw);
}

function optionalIntegerValue(raw: unknown, path: string): number | null {
  return raw === undefined ? null : integerValue(raw, path);
}

function stringValue(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw : fallback;
}

function coordinateKey(positionOrX: Position | number, y?: number, z?: number): string {
  return typeof positionOrX === "number"
    ? `${positionOrX}:${y}:${z}`
    : `${positionOrX.x}:${positionOrX.y}:${positionOrX.z}`;
}

function safeMultiply(a: number, b: number, c: number, message: string): number {
  const value = a * b * c;
  if (!Number.isSafeInteger(value)) invalid(message);
  return value;
}

function safeAdd(a: number, b: number, message: string): number {
  const value = a + b;
  if (!Number.isSafeInteger(value)) invalid(message);
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function enforce(condition: boolean, message: string): asserts condition {
  if (!condition) throw new LitematicParseError("LIMIT_EXCEEDED", message);
}

function invalid(message: string): never {
  throw new LitematicParseError("INVALID_LITEMATIC", message);
}
