import { Gunzip } from "fflate";
import {
  validateBlueprint,
  type BlueprintBounds,
  type BlueprintV1,
  type BlueprintVoxel,
  type MaterialId,
} from "@tomato-clock/voxel";
import { parseJavaNbt } from "./nbt.js";

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
}

interface ParsedRegion {
  preview: LitematicRegionPreview;
  palette: PaletteEntry[];
  packedStates: unknown[];
  entities: number;
  tileEntities: number;
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

  let simplified: unknown;
  try {
    simplified = parseJavaNbt(uncompressed);
  } catch (cause) {
    throw new LitematicParseError("INVALID_NBT", "Could not parse Java big-endian NBT", { cause });
  }
  const root = record(simplified, "root");
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
  let ignoredTileEntities = 0;
  let ignoredPendingTicks = 0;

  for (const region of parsedRegions) {
    paletteEntries += region.palette.length;
    ignoredEntities += region.entities;
    ignoredTileEntities += region.tileEntities;
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
  }

  if (blocks.size === 0) invalid("Litematic contains no non-air blocks");
  const decoded = [...blocks.values()];
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
        ignoredTileEntities,
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
    tileEntities: optionalArrayLength(region.TileEntities, `Regions.${name}.TileEntities`),
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
  const minY = Math.min(...voxels.map((voxel) => voxel.y));
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
  return {
    minX: Math.min(...voxels.map((voxel) => voxel.x)), maxX: Math.max(...voxels.map((voxel) => voxel.x)),
    minY: Math.min(...voxels.map((voxel) => voxel.y)), maxY: Math.max(...voxels.map((voxel) => voxel.y)),
    minZ: Math.min(...voxels.map((voxel) => voxel.z)), maxZ: Math.max(...voxels.map((voxel) => voxel.z)),
  };
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

function integerValue(raw: unknown, path: string): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) invalid(`${path} must be an integer`);
  return raw;
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
