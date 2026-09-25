import { unzipSync } from "fflate";
import {
  parseBlockAssets,
  type BlockModelIssueCode,
  type NormalizedBlockModel,
  type NormalizedBlockState,
} from "./block-models";
import { parseResourcePackColormaps, type ResourcePackColormap } from "./colormap";
import { DEFAULT_PNG_RGBA_LIMITS, inspectPngDimensions } from "./png";
import {
  parseResourcePackSpecialTextures,
  type ResourcePackSpecialTexture,
  type ResourcePackSpecialTextureIssueCode,
} from "./special-textures";

export * from "./block-models";
export * from "./atlas";
export * from "./compatibility";
export * from "./colormap";
export * from "./layering";
export * from "./png";
export * from "./special-textures";

export const DEFAULT_RESOURCE_PACK_LIMITS = Object.freeze({
  maxInputBytes: 32 * 1024 * 1024,
  maxFileCount: 16_384,
  maxSingleFileBytes: 4 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxPackMetadataBytes: 64 * 1024,
  maxTextureMetadataBytes: 64 * 1024,
});

/** Separate bounded envelope for importing only assets from the vanilla 26.3 client JAR. */
export const JAVA_263_CLIENT_JAR_LIMITS = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxFileCount: 50_000,
  maxAssetFileCount: 16_384,
  maxAssetFileBytes: 4 * 1024 * 1024,
  maxAssetUncompressedBytes: 64 * 1024 * 1024,
  maxVersionMetadataBytes: 64 * 1024,
});

export interface ResourcePackLimits {
  maxInputBytes: number;
  maxFileCount: number;
  maxSingleFileBytes: number;
  maxTotalUncompressedBytes: number;
  maxPackMetadataBytes: number;
  maxTextureMetadataBytes: number;
}

export type ResourcePackErrorCode =
  | "INPUT_TOO_LARGE"
  | "INVALID_ZIP"
  | "ZIP64_UNSUPPORTED"
  | "TOO_MANY_FILES"
  | "FILE_TOO_LARGE"
  | "TOTAL_UNCOMPRESSED_TOO_LARGE"
  | "UNSAFE_PATH"
  | "DUPLICATE_PATH"
  | "CASE_COLLISION"
  | "UNSUPPORTED_COMPRESSION"
  | "ENCRYPTED_ENTRY"
  | "MISSING_PACK_MCMETA"
  | "INVALID_PACK_MCMETA";

export class ResourcePackError extends Error {
  readonly code: ResourcePackErrorCode;
  readonly path: string | undefined;

  constructor(code: ResourcePackErrorCode, message: string, path?: string) {
    super(message);
    this.name = "ResourcePackError";
    this.code = code;
    this.path = path;
  }
}

export interface ResourcePackMetadata {
  /** Legacy pack_format, or the highest supported major for modern range-only packs. */
  packFormat: number;
  description: unknown;
  /** Modern pack.mcmeta range. A max minor of 0x7fffffff means any minor in that major. */
  minFormat?: [major: number, minor: number];
  maxFormat?: [major: number, minor: number];
}

export type ResourcePackTextureSize = 16 | 32 | 64 | 128 | 256;

export type TextureIssueCode =
  | "INVALID_NAMESPACE"
  | "INVALID_RESOURCE_PATH"
  | "INVALID_PNG"
  | "NOT_16X16"
  | "INVALID_TEXTURE_MCMETA"
  | "INVALID_TEXTURE_ANIMATION"
  | "ANIMATION_INTERPOLATION_DEGRADED"
  | "ORPHAN_TEXTURE_MCMETA";

export interface ResourcePackAnimationFrame {
  index: number;
  time: number;
}

export interface ResourcePackTextureAnimation {
  frameWidth: ResourcePackTextureSize;
  frameHeight: ResourcePackTextureSize;
  /** Row-major source grid dimensions. Omitted only by legacy 16xN persisted manifests. */
  sourceColumns?: number;
  sourceRows?: number;
  sourceFrameCount: number;
  frametime: number;
  interpolate: boolean;
  frames: ResourcePackAnimationFrame[];
}

export type ResourcePackIssueCode = TextureIssueCode | BlockModelIssueCode | "INVALID_COLORMAP" | ResourcePackSpecialTextureIssueCode;

export interface ResourcePackCompatibilityIssue {
  path: string;
  code: ResourcePackIssueCode;
  message: string;
}

export interface ResourcePackTexture {
  resourceId: string;
  namespace: string;
  texturePath: string;
  archivePath: string;
  /** Source sheet width. Static textures use 16px, 32px, or 64px square frames. */
  width: number;
  height: number;
  png: Uint8Array;
  animation?: ResourcePackTextureAnimation;
  /** Raw metadata is retained for schema-v1 compatibility; consumers use `animation`. */
  metadata?: unknown;
}

export interface ResourcePackCompatibilitySummary {
  archiveFileCount: number;
  candidateTextureCount: number;
  acceptedTextureCount: number;
  rejectedTextureCount: number;
  ignoredFileCount: number;
  namespaces: string[];
  issues: ResourcePackCompatibilityIssue[];
}

export interface ResourcePackManifest {
  schemaVersion: 1;
  pack: ResourcePackMetadata;
  textures: ResourcePackTexture[];
  /** Entity/special-renderer assets. Kept separate from the block atlas. */
  specialTextures?: ResourcePackSpecialTexture[];
  colormaps?: ResourcePackColormap[];
  blockStates: NormalizedBlockState[];
  models: NormalizedBlockModel[];
  summary: ResourcePackCompatibilitySummary;
}

interface ZipEntryAudit {
  path: string;
  originalSize: number;
  isDirectory: boolean;
}

interface ParsedPackOverlay {
  directory: string;
  appliesToTarget: boolean;
}

interface ParsedPackMetadata {
  metadata: ResourcePackMetadata;
  overlays: ParsedPackOverlay[];
}

interface ParsedArchiveFiles {
  files: Record<string, Uint8Array>;
  paths: string[];
  archiveFileCount: number;
  pack: ResourcePackMetadata;
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const namespacePattern = /^[a-z0-9_.-]+$/;
const resourcePathPattern = /^[a-z0-9._/-]+$/;
const texturePattern = /^assets\/([^/]+)\/textures\/block\/(.+)\.png$/;
const textureMetadataPattern = /^assets\/([^/]+)\/textures\/block\/(.+)\.png\.mcmeta$/;
const MAX_ANIMATION_SOURCE_FRAMES = 256;
const MAX_ANIMATION_SEQUENCE_FRAMES = 4096;
const MAX_ANIMATION_FRAME_TIME = 1_000_000;
const TARGET_RESOURCE_PACK_FORMAT = [97, 1] as const;
const MAX_PACK_OVERLAY_ENTRIES = 64;

export function parseJava16xResourcePack(
  zipBytes: Uint8Array,
  overrides: Partial<ResourcePackLimits> = {},
): ResourcePackManifest {
  const limits = validateLimits({ ...DEFAULT_RESOURCE_PACK_LIMITS, ...overrides });
  const extracted = extractResourceArchive(zipBytes, limits);
  const { files, paths, pack, archiveFileCount } = extracted;
  const metadataPaths = new Set(paths.filter((path) => textureMetadataPattern.test(path)));
  const candidatePaths = paths.filter((path) => texturePattern.test(path)).sort(comparePath);
  const issues: ResourcePackCompatibilityIssue[] = [];
  const textures: ResourcePackTexture[] = [];
  const consumedMetadata = new Set<string>();
  const blockAssets = parseBlockAssets(files, paths, parseJsonObject);
  const parsedColormaps = parseResourcePackColormaps(files, paths);
  const parsedSpecialTextures = parseResourcePackSpecialTextures(files, paths, limits.maxSingleFileBytes);

  for (const archivePath of candidatePaths) {
    const match = texturePattern.exec(archivePath);
    if (!match) continue;
    const namespace = match[1] ?? "";
    const texturePath = match[2] ?? "";
    if (!namespacePattern.test(namespace)) {
      issues.push(issue(archivePath, "INVALID_NAMESPACE", `Invalid namespace: ${namespace}`));
      continue;
    }
    if (!isValidResourcePath(texturePath)) {
      issues.push(issue(archivePath, "INVALID_RESOURCE_PATH", `Invalid texture path: ${texturePath}`));
      continue;
    }

    const png = files[archivePath];
    if (!png) {
      issues.push(issue(archivePath, "INVALID_PNG", "Texture was not extracted."));
      continue;
    }
    const dimensions = inspectPngDimensions(png);
    if (!dimensions) {
      issues.push(issue(archivePath, "INVALID_PNG", "File is not a structurally valid PNG."));
      continue;
    }
    const metadataPath = `${archivePath}.mcmeta`;
    let metadata: unknown;
    if (metadataPaths.has(metadataPath)) {
      consumedMetadata.add(metadataPath);
      const metadataBytes = files[metadataPath];
      if (!metadataBytes || metadataBytes.byteLength > limits.maxTextureMetadataBytes) {
        issues.push(
          issue(metadataPath, "INVALID_TEXTURE_MCMETA", "Texture metadata is missing or exceeds its size limit."),
        );
        continue;
      }
      try {
        metadata = parseJsonObject(metadataBytes, metadataPath);
      } catch (cause) {
        issues.push(issue(metadataPath, "INVALID_TEXTURE_MCMETA", errorMessage(cause)));
        continue;
      }
    }

    if (dimensions.width > DEFAULT_PNG_RGBA_LIMITS.maxDimension
      || dimensions.height > DEFAULT_PNG_RGBA_LIMITS.maxDimension
      || dimensions.width * dimensions.height > DEFAULT_PNG_RGBA_LIMITS.maxPixels) {
      issues.push(issue(
        archivePath,
        "INVALID_PNG",
        `Texture sheet ${dimensions.width}x${dimensions.height} exceeds the ${DEFAULT_PNG_RGBA_LIMITS.maxDimension}px dimension or ${DEFAULT_PNG_RGBA_LIMITS.maxPixels}-pixel decode limit.`,
      ));
      continue;
    }
    const staticSquare = isSupportedTextureSize(dimensions.width) && dimensions.height === dimensions.width;
    let animation: ResourcePackTextureAnimation | undefined;
    try {
      animation = normalizeTextureAnimation(metadata, dimensions.width, dimensions.height);
    } catch (cause) {
      issues.push(issue(metadata === undefined ? archivePath : metadataPath, "INVALID_TEXTURE_ANIMATION", errorMessage(cause)));
      // A malformed animation sidecar need not discard an otherwise usable
      // square block texture. Keep its static first frame; strips/grids still
      // require valid animation metadata to avoid guessing frame layout.
      if (!staticSquare) continue;
      metadata = undefined;
    }
    if (animation === undefined && !staticSquare) {
      if (
        isSupportedTextureSize(dimensions.width)
        && dimensions.height > dimensions.width
        && dimensions.height % dimensions.width === 0
        && dimensions.height / dimensions.width <= MAX_ANIMATION_SOURCE_FRAMES
      ) {
        issues.push(issue(archivePath, "INVALID_TEXTURE_ANIMATION", "Vertical texture strips require an animation object in .png.mcmeta."));
        continue;
      }
      issues.push(issue(archivePath, "NOT_16X16", `Static texture is ${dimensions.width}x${dimensions.height}; supported square sizes are 16, 32, 64, 128, and 256 pixels.`));
      continue;
    }

    textures.push({
      resourceId: `${namespace}:block/${texturePath}`,
      namespace,
      texturePath,
      archivePath,
      width: dimensions.width,
      height: dimensions.height,
      png,
      ...(animation === undefined ? {} : { animation }),
      ...(metadata === undefined ? {} : { metadata }),
    });
  }

  for (const metadataPath of [...metadataPaths].sort(comparePath)) {
    if (!consumedMetadata.has(metadataPath)) {
      issues.push(issue(metadataPath, "ORPHAN_TEXTURE_MCMETA", "No accepted 16x16 texture or bounded animation sheet uses this metadata."));
    }
  }

  issues.push(...blockAssets.issues);
  issues.push(...parsedColormaps.issues);
  issues.push(...parsedSpecialTextures.issues);

  issues.sort((left, right) => comparePath(left.path, right.path) || left.code.localeCompare(right.code));
  const namespaces = [...new Set([...textures, ...parsedSpecialTextures.textures].map((texture) => texture.namespace))].sort(comparePath);
  const recognizedPaths = new Set([
    "pack.mcmeta", ...candidatePaths, ...metadataPaths, ...blockAssets.recognizedPaths, ...parsedColormaps.recognizedPaths,
    ...parsedSpecialTextures.recognizedPaths,
  ]);

  return {
    schemaVersion: 1,
    pack,
    textures,
    ...(parsedSpecialTextures.textures.length === 0 ? {} : { specialTextures: parsedSpecialTextures.textures }),
    ...(parsedColormaps.colormaps.length === 0 ? {} : { colormaps: parsedColormaps.colormaps }),
    blockStates: blockAssets.blockStates,
    models: blockAssets.models,
    summary: {
      archiveFileCount,
      candidateTextureCount: candidatePaths.length,
      acceptedTextureCount: textures.length,
      rejectedTextureCount: candidatePaths.length - textures.length,
      ignoredFileCount: paths.filter((path) => !recognizedPaths.has(path)).length,
      namespaces,
      issues,
    },
  };
}

function validateLimits(limits: ResourcePackLimits): ResourcePackLimits {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }
  return limits;
}

function extractResourceArchive(bytes: Uint8Array, limits: ResourcePackLimits): ParsedArchiveFiles {
  if (bytes.byteLength > JAVA_263_CLIENT_JAR_LIMITS.maxInputBytes) {
    throw new ResourcePackError(
      "INPUT_TOO_LARGE",
      `Resource archive is ${bytes.byteLength} bytes; hard limit is ${JAVA_263_CLIENT_JAR_LIMITS.maxInputBytes}.`,
    );
  }
  const auditedEntries = auditZip(bytes);
  const physicalPaths = auditedEntries.filter((entry) => !entry.isDirectory).map((entry) => entry.path);
  const archiveFileCount = physicalPaths.length;
  const rootPackMetadata = auditedEntries.find((entry) => entry.path === "pack.mcmeta" && !entry.isDirectory);
  if (rootPackMetadata) {
    if (bytes.byteLength > limits.maxInputBytes) {
      throw new ResourcePackError(
        "INPUT_TOO_LARGE",
        `Resource pack is ${bytes.byteLength} bytes; limit is ${limits.maxInputBytes}.`,
      );
    }
    validateArchiveBudget(auditedEntries, limits, () => true);
    const files = unzipArchive(bytes);
    validateExtractedBudget(files, limits);
    const packBytes = files["pack.mcmeta"];
    if (!packBytes) {
      throw new ResourcePackError("INVALID_ZIP", "Root pack.mcmeta was not extracted.", "pack.mcmeta");
    }
    if (packBytes.byteLength > limits.maxPackMetadataBytes) {
      throw new ResourcePackError(
        "INVALID_PACK_MCMETA",
        `pack.mcmeta exceeds ${limits.maxPackMetadataBytes} bytes.`,
        "pack.mcmeta",
      );
    }
    const parsedMetadata = parsePackMetadata(packBytes);
    const effective = applyResourcePackOverlays(files, physicalPaths, parsedMetadata.overlays);
    return {
      ...effective,
      archiveFileCount,
      pack: parsedMetadata.metadata,
    };
  }

  const versionEntry = auditedEntries.find((entry) => entry.path === "version.json" && !entry.isDirectory);
  if (!versionEntry || !hasMinecraftClientAssets(physicalPaths)) {
    throw new ResourcePackError("MISSING_PACK_MCMETA", "pack.mcmeta must exist at the ZIP root.");
  }
  const clientLimits = {
    ...limits,
    maxFileCount: JAVA_263_CLIENT_JAR_LIMITS.maxFileCount,
    maxInputBytes: JAVA_263_CLIENT_JAR_LIMITS.maxInputBytes,
    maxSingleFileBytes: Math.min(limits.maxSingleFileBytes, JAVA_263_CLIENT_JAR_LIMITS.maxAssetFileBytes),
    maxTotalUncompressedBytes: Math.min(limits.maxTotalUncompressedBytes, JAVA_263_CLIENT_JAR_LIMITS.maxAssetUncompressedBytes),
  };
  if (auditedEntries.length > clientLimits.maxFileCount) {
    throw new ResourcePackError(
      "TOO_MANY_FILES",
      `Minecraft client JAR contains ${auditedEntries.length} entries; limit is ${clientLimits.maxFileCount}.`,
    );
  }
  if (versionEntry.originalSize > Math.min(limits.maxPackMetadataBytes, JAVA_263_CLIENT_JAR_LIMITS.maxVersionMetadataBytes)) {
    throw new ResourcePackError("FILE_TOO_LARGE", "version.json exceeds the client metadata limit.", "version.json");
  }
  const selectedAssetEntries = auditedEntries.filter((entry) => !entry.isDirectory && entry.path.startsWith("assets/"));
  if (selectedAssetEntries.length > JAVA_263_CLIENT_JAR_LIMITS.maxAssetFileCount) {
    throw new ResourcePackError(
      "TOO_MANY_FILES",
      `Minecraft client JAR contains ${selectedAssetEntries.length} selected asset files; limit is ${JAVA_263_CLIENT_JAR_LIMITS.maxAssetFileCount}.`,
    );
  }
  validateArchiveBudget(auditedEntries, clientLimits, (entry) => entry.path.startsWith("assets/"));
  const versionFiles = unzipArchive(bytes, (file) => file.name === "version.json");
  const versionBytes = versionFiles["version.json"];
  if (!versionBytes || !isMinecraft263Client(versionBytes)) {
    throw new ResourcePackError("MISSING_PACK_MCMETA", "Only a Java 26.3 client JAR with resource pack format 97.1 can omit pack.mcmeta.");
  }
  const files = unzipArchive(bytes, (file) => file.name.startsWith("assets/"));
  validateExtractedBudget(files, clientLimits);
  const paths = selectedAssetEntries.map((entry) => entry.path).sort(comparePath);
  return {
    files,
    paths,
    archiveFileCount,
    pack: {
      packFormat: TARGET_RESOURCE_PACK_FORMAT[0],
      minFormat: [...TARGET_RESOURCE_PACK_FORMAT],
      maxFormat: [...TARGET_RESOURCE_PACK_FORMAT],
      description: { text: "Minecraft Java Edition 26.3 client assets" },
    },
  };
}

function hasMinecraftClientAssets(paths: readonly string[]): boolean {
  return paths.some((path) => path.startsWith("assets/minecraft/blockstates/"))
    && paths.some((path) => path.startsWith("assets/minecraft/textures/block/"));
}

function isMinecraft263Client(bytes: Uint8Array): boolean {
  try {
    const version = parseJsonObject(bytes, "version.json");
    if (version.id !== "26.3" || !isRecord(version.pack_version)) return false;
    return version.pack_version.resource_major === TARGET_RESOURCE_PACK_FORMAT[0]
      && version.pack_version.resource_minor === TARGET_RESOURCE_PACK_FORMAT[1];
  } catch {
    return false;
  }
}

function unzipArchive(bytes: Uint8Array, filter?: (file: { name: string }) => boolean): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes, filter ? { filter } : undefined);
  } catch (cause) {
    throw new ResourcePackError("INVALID_ZIP", `Resource archive could not be decompressed: ${errorMessage(cause)}`);
  }
}

function validateArchiveBudget(
  entries: readonly ZipEntryAudit[],
  limits: ResourcePackLimits,
  include: (entry: ZipEntryAudit) => boolean,
): void {
  if (entries.length > limits.maxFileCount) {
    throw new ResourcePackError("TOO_MANY_FILES", `ZIP contains ${entries.length} entries; limit is ${limits.maxFileCount}.`);
  }
  let total = 0;
  for (const entry of entries) {
    if (!include(entry)) continue;
    if (entry.originalSize > limits.maxSingleFileBytes) {
      throw new ResourcePackError(
        "FILE_TOO_LARGE",
        `${entry.path} expands to ${entry.originalSize} bytes; per-file limit is ${limits.maxSingleFileBytes}.`,
        entry.path,
      );
    }
    total += entry.originalSize;
    if (total > limits.maxTotalUncompressedBytes) {
      throw new ResourcePackError("TOTAL_UNCOMPRESSED_TOO_LARGE", `ZIP expands beyond ${limits.maxTotalUncompressedBytes} selected bytes.`);
    }
  }
}

function validateExtractedBudget(files: Record<string, Uint8Array>, limits: ResourcePackLimits): void {
  let extractedTotal = 0;
  for (const [path, bytes] of Object.entries(files)) {
    if (bytes.byteLength > limits.maxSingleFileBytes) {
      throw new ResourcePackError("FILE_TOO_LARGE", `${path} exceeds the extracted per-file limit.`, path);
    }
    extractedTotal += bytes.byteLength;
    if (extractedTotal > limits.maxTotalUncompressedBytes) {
      throw new ResourcePackError("TOTAL_UNCOMPRESSED_TOO_LARGE", "Extracted resource archive exceeds the selected size limit.");
    }
  }
}

function auditZip(bytes: Uint8Array): ZipEntryAudit[] {
  if (bytes.byteLength < 22) throw new ResourcePackError("INVALID_ZIP", "ZIP is too short.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ResourcePackError("ZIP64_UNSUPPORTED", "Multi-disk and ZIP64 resource packs are not supported.");
  }
  if (entryCount > JAVA_263_CLIENT_JAR_LIMITS.maxFileCount) {
    throw new ResourcePackError(
      "TOO_MANY_FILES",
      `ZIP contains ${entryCount} entries; hard limit is ${JAVA_263_CLIENT_JAR_LIMITS.maxFileCount}.`,
    );
  }
  if (centralOffset + centralSize > eocd || centralOffset + centralSize > bytes.byteLength) {
    throw new ResourcePackError("INVALID_ZIP", "ZIP central directory is outside the archive.");
  }

  const entries: ZipEntryAudit[] = [];
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new ResourcePackError("INVALID_ZIP", "Malformed ZIP central directory.");
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const originalSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > bytes.byteLength) throw new ResourcePackError("INVALID_ZIP", "Truncated ZIP entry.");
    if ((flags & 1) !== 0) throw new ResourcePackError("ENCRYPTED_ENTRY", "Encrypted ZIP entries are unsupported.");
    if (compression !== 0 && compression !== 8) {
      throw new ResourcePackError("UNSUPPORTED_COMPRESSION", `ZIP compression method ${compression} is unsupported.`);
    }
    if (originalSize === 0xffffffff) {
      throw new ResourcePackError("ZIP64_UNSUPPORTED", "ZIP64 entries are unsupported.");
    }

    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const decoded = decodeEntryName(rawName, (flags & 0x800) !== 0);
    const path = normalizeArchivePath(decoded);
    if (exact.has(path)) throw new ResourcePackError("DUPLICATE_PATH", `Duplicate ZIP path: ${path}`, path);
    const lower = path.toLocaleLowerCase("en-US");
    const previous = folded.get(lower);
    if (previous && previous !== path) {
      throw new ResourcePackError("CASE_COLLISION", `ZIP paths differ only by case: ${previous}, ${path}`, path);
    }
    exact.add(path);
    folded.set(lower, path);

    entries.push({ path, originalSize, isDirectory: path.endsWith("/") });
    offset = recordEnd;
  }
  if (offset !== centralOffset + centralSize) {
    throw new ResourcePackError("INVALID_ZIP", "ZIP central directory size does not match its entries.");
  }
  return entries;
}

function findEocd(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === view.byteLength) return offset;
    }
  }
  throw new ResourcePackError("INVALID_ZIP", "ZIP end-of-central-directory record was not found.");
}

function decodeEntryName(bytes: Uint8Array, utf8: boolean): string {
  try {
    if (!utf8 && bytes.some((value) => value > 0x7f)) {
      throw new Error("Non-ASCII legacy ZIP names are unsupported.");
    }
    return textDecoder.decode(bytes);
  } catch (cause) {
    throw new ResourcePackError("INVALID_ZIP", `Invalid ZIP entry name: ${errorMessage(cause)}`);
  }
}

function normalizeArchivePath(raw: string): string {
  if (!raw || raw.includes("\0") || raw.includes("\\") || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    throw new ResourcePackError("UNSAFE_PATH", `Unsafe ZIP path: ${raw || "<empty>"}`, raw);
  }
  const trailingSlash = raw.endsWith("/");
  const segments = raw.split("/");
  if (trailingSlash) segments.pop();
  if (segments.length === 0 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ResourcePackError("UNSAFE_PATH", `Unsafe ZIP path: ${raw}`, raw);
  }
  return `${segments.join("/")}${trailingSlash ? "/" : ""}`;
}

function parsePackMetadata(bytes: Uint8Array): ParsedPackMetadata {
  let value: unknown;
  try {
    value = parseJsonObject(bytes, "pack.mcmeta");
  } catch (cause) {
    throw new ResourcePackError("INVALID_PACK_MCMETA", errorMessage(cause), "pack.mcmeta");
  }
  const pack = (value as Record<string, unknown>).pack;
  if (!isRecord(pack)) {
    throw new ResourcePackError("INVALID_PACK_MCMETA", "pack.mcmeta must contain a pack object.", "pack.mcmeta");
  }
  const legacyPackFormat = pack.pack_format;
  if (legacyPackFormat !== undefined && (!Number.isSafeInteger(legacyPackFormat) || (legacyPackFormat as number) <= 0)) {
    throw new ResourcePackError(
      "INVALID_PACK_MCMETA",
      "pack.pack_format must be a positive integer.",
      "pack.mcmeta",
    );
  }
  const hasModernRange = pack.min_format !== undefined || pack.max_format !== undefined;
  if (hasModernRange && (pack.min_format === undefined || pack.max_format === undefined)) {
    throw new ResourcePackError(
      "INVALID_PACK_MCMETA",
      "pack.min_format and pack.max_format must be supplied together.",
      "pack.mcmeta",
    );
  }
  let minFormat: ResourcePackMetadata["minFormat"];
  let maxFormat: ResourcePackMetadata["maxFormat"];
  if (hasModernRange) {
    minFormat = parsePackFormatBound(pack.min_format, "min_format", 0);
    maxFormat = parsePackFormatBound(pack.max_format, "max_format", 0x7fffffff);
    if (minFormat[0] > maxFormat[0] || (minFormat[0] === maxFormat[0] && minFormat[1] > maxFormat[1])) {
      throw new ResourcePackError("INVALID_PACK_MCMETA", "pack.min_format must not exceed pack.max_format.", "pack.mcmeta");
    }
    if (minFormat[0] < 65 && legacyPackFormat === undefined) {
      throw new ResourcePackError(
        "INVALID_PACK_MCMETA",
        "pack.pack_format is required when the supported range includes resource-pack formats before 65.",
        "pack.mcmeta",
      );
    }
  } else if (legacyPackFormat === undefined) {
    throw new ResourcePackError(
      "INVALID_PACK_MCMETA",
      "pack.pack_format or a modern min_format/max_format range is required.",
      "pack.mcmeta",
    );
  }
  if (!("description" in pack)) {
    throw new ResourcePackError("INVALID_PACK_MCMETA", "pack.description is required.", "pack.mcmeta");
  }
  return {
    metadata: {
      packFormat: (legacyPackFormat as number | undefined) ?? maxFormat![0],
      description: pack.description,
      ...(minFormat && maxFormat ? { minFormat, maxFormat } : {}),
    },
    overlays: parsePackOverlays((value as Record<string, unknown>).overlays),
  };
}

function parsePackOverlays(raw: unknown): ParsedPackOverlay[] {
  if (raw === undefined) return [];
  if (!isRecord(raw) || !Array.isArray(raw.entries) || raw.entries.length > MAX_PACK_OVERLAY_ENTRIES) {
    throw new ResourcePackError(
      "INVALID_PACK_MCMETA",
      `pack.overlays.entries must be an array of at most ${MAX_PACK_OVERLAY_ENTRIES} entries.`,
      "pack.mcmeta",
    );
  }
  const directories = new Set<string>();
  return raw.entries.map((entry, index) => {
    if (!isRecord(entry)) throw invalidOverlayMetadata(index, "entry must be an object.");
    const directory = entry.directory;
    if (typeof directory !== "string" || directory.length > 64 || !/^[a-z0-9_-]+$/.test(directory)) {
      throw invalidOverlayMetadata(index, "directory must contain only lowercase letters, digits, underscores, and hyphens.");
    }
    if (directories.has(directory)) throw invalidOverlayMetadata(index, `directory ${directory} is declared more than once.`);
    directories.add(directory);

    const hasModernMin = entry.min_format !== undefined;
    const hasModernMax = entry.max_format !== undefined;
    if (hasModernMin !== hasModernMax) {
      throw invalidOverlayMetadata(index, "min_format and max_format must be supplied together.");
    }
    const hasLegacyFormats = entry.formats !== undefined;
    if (!hasModernMin && !hasLegacyFormats) {
      throw invalidOverlayMetadata(index, "a formats range or min_format/max_format pair is required.");
    }

    let modernRangeMatches = true;
    if (hasModernMin && hasModernMax) {
      let minimum: [number, number];
      let maximum: [number, number];
      try {
        minimum = parsePackFormatBound(entry.min_format, `overlays.entries[${index}].min_format`, 0);
        maximum = parsePackFormatBound(entry.max_format, `overlays.entries[${index}].max_format`, 0x7fffffff);
      } catch (cause) {
        throw invalidOverlayMetadata(index, errorMessage(cause));
      }
      if (comparePackFormat(minimum, maximum) > 0) {
        throw invalidOverlayMetadata(index, "min_format must not exceed max_format.");
      }
      if (minimum[0] < 65 && !hasLegacyFormats) {
        throw invalidOverlayMetadata(index, "formats is required when min_format includes resource-pack formats before 65.");
      }
      modernRangeMatches = packFormatInRange(TARGET_RESOURCE_PACK_FORMAT, minimum, maximum);
    }

    let legacyRangeMatches = true;
    if (hasLegacyFormats) {
      const legacyRange = parseLegacyOverlayFormats(entry.formats, index);
      legacyRangeMatches = TARGET_RESOURCE_PACK_FORMAT[0] >= legacyRange[0]
        && TARGET_RESOURCE_PACK_FORMAT[0] <= legacyRange[1];
    }
    return { directory, appliesToTarget: modernRangeMatches && legacyRangeMatches };
  });
}

function parseLegacyOverlayFormats(raw: unknown, index: number): [number, number] {
  let minimum: unknown;
  let maximum: unknown;
  if (Number.isSafeInteger(raw) && (raw as number) > 0) {
    minimum = raw;
    maximum = raw;
  } else if (Array.isArray(raw) && raw.length === 2) {
    [minimum, maximum] = raw;
  } else if (isRecord(raw)) {
    minimum = raw.min_inclusive;
    maximum = raw.max_inclusive;
  } else {
    throw invalidOverlayMetadata(index, "formats must be a positive format or an inclusive [min, max] range.");
  }
  if (!Number.isSafeInteger(minimum) || (minimum as number) <= 0
    || !Number.isSafeInteger(maximum) || (maximum as number) < (minimum as number)) {
    throw invalidOverlayMetadata(index, "formats must be a non-inverted inclusive positive-integer range.");
  }
  return [minimum as number, maximum as number];
}

function invalidOverlayMetadata(index: number, message: string): ResourcePackError {
  return new ResourcePackError(
    "INVALID_PACK_MCMETA",
    `pack.overlays.entries[${index}]: ${message}`,
    "pack.mcmeta",
  );
}

function comparePackFormat(left: readonly [number, number], right: readonly [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

function packFormatInRange(
  format: readonly [number, number],
  minimum: readonly [number, number],
  maximum: readonly [number, number],
): boolean {
  return comparePackFormat(format, minimum) >= 0 && comparePackFormat(format, maximum) <= 0;
}

function applyResourcePackOverlays(
  files: Record<string, Uint8Array>,
  physicalPaths: readonly string[],
  overlays: readonly ParsedPackOverlay[],
): Pick<ParsedArchiveFiles, "files" | "paths"> {
  const effectiveFiles: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const path of physicalPaths) {
    if (path.startsWith("overlays/")) continue;
    const bytes = files[path];
    if (bytes) effectiveFiles[path] = bytes;
  }

  for (const overlay of overlays) {
    if (!overlay.appliesToTarget) continue;
    const prefix = `overlays/${overlay.directory}/`;
    for (const archivePath of physicalPaths) {
      if (!archivePath.startsWith(prefix)) continue;
      const path = archivePath.slice(prefix.length);
      if (!path || path === "pack.mcmeta" || path === "pack.png") continue;
      const bytes = files[archivePath];
      if (bytes) effectiveFiles[path] = bytes;
    }
  }
  const paths = Object.keys(effectiveFiles).sort(comparePath);
  return { files: effectiveFiles, paths };
}

function parsePackFormatBound(value: unknown, field: string, integerMinor: number): [number, number] {
  const parts = Array.isArray(value) ? value : [value];
  const validLength = parts.length === 1 || parts.length === 2;
  const major = parts[0];
  const minor = parts.length === 2 ? parts[1] : integerMinor;
  if (!validLength || !Number.isSafeInteger(major) || (major as number) <= 0 ||
      !Number.isSafeInteger(minor) || (minor as number) < 0 || (minor as number) > 0x7fffffff) {
    throw new ResourcePackError(
      "INVALID_PACK_MCMETA",
      `pack.${field} must be a positive major or [major, minor] version.`,
      "pack.mcmeta",
    );
  }
  return [major as number, minor as number];
}

function normalizeTextureAnimation(metadata: unknown, sheetWidth: number, sheetHeight: number): ResourcePackTextureAnimation | undefined {
  const rawAnimation = isRecord(metadata) ? metadata.animation : undefined;
  if (rawAnimation === undefined) {
    return undefined;
  }
  if (!isRecord(rawAnimation)) throw new Error("animation must be an object.");
  const defaultFrameSize = Math.min(sheetWidth, sheetHeight);
  const rawFrameWidth = rawAnimation.width ?? rawAnimation.height ?? defaultFrameSize;
  const rawFrameHeight = rawAnimation.height ?? rawAnimation.width ?? defaultFrameSize;
  const frameWidth = animationFrameSize(rawFrameWidth, "animation.width");
  const frameHeight = animationFrameSize(rawFrameHeight, "animation.height");
  if (frameWidth !== frameHeight) throw new Error("Only square 16px, 32px, 64px, 128px, or 256px animation frames are supported.");
  if (sheetWidth % frameWidth !== 0 || sheetHeight % frameHeight !== 0) {
    throw new Error(`Texture sheet ${sheetWidth}x${sheetHeight} must contain complete ${frameWidth}x${frameHeight} frames.`);
  }
  const sourceColumns = sheetWidth / frameWidth;
  const sourceRows = sheetHeight / frameHeight;
  const sourceFrameCount = sourceColumns * sourceRows;
  if (!Number.isSafeInteger(sourceFrameCount) || sourceFrameCount < 1 || sourceFrameCount > MAX_ANIMATION_SOURCE_FRAMES) {
    throw new Error(`Animation sheet must contain 1-${MAX_ANIMATION_SOURCE_FRAMES} source frames.`);
  }
  const frametime = boundedAnimationTime(rawAnimation.frametime ?? 1, "animation.frametime");
  const interpolate = rawAnimation.interpolate === undefined ? false : rawAnimation.interpolate;
  if (typeof interpolate !== "boolean") throw new Error("animation.interpolate must be boolean.");
  let frames: ResourcePackAnimationFrame[];
  if (rawAnimation.frames === undefined) {
    frames = Array.from({ length: sourceFrameCount }, (_, index) => ({ index, time: frametime }));
  } else {
    if (!Array.isArray(rawAnimation.frames) || rawAnimation.frames.length === 0 || rawAnimation.frames.length > MAX_ANIMATION_SEQUENCE_FRAMES) {
      throw new Error(`animation.frames must contain 1-${MAX_ANIMATION_SEQUENCE_FRAMES} entries.`);
    }
    frames = rawAnimation.frames.map((raw, position) => {
      if (Number.isSafeInteger(raw)) return { index: animationFrameIndex(raw, sourceFrameCount, position), time: frametime };
      if (!isRecord(raw)) throw new Error(`animation.frames[${position}] must be an integer or object.`);
      return {
        index: animationFrameIndex(raw.index, sourceFrameCount, position),
        time: boundedAnimationTime(raw.time ?? frametime, `animation.frames[${position}].time`),
      };
    });
  }
  return { frameWidth, frameHeight, sourceColumns, sourceRows, sourceFrameCount, frametime, interpolate, frames };
}

function animationFrameSize(raw: unknown, name: string): ResourcePackTextureSize {
  if (!isSupportedTextureSize(raw)) throw new Error(`${name} must be 16, 32, 64, 128, or 256.`);
  return raw;
}

function isSupportedTextureSize(value: unknown): value is ResourcePackTextureSize {
  return value === 16 || value === 32 || value === 64 || value === 128 || value === 256;
}

function animationFrameIndex(raw: unknown, sourceFrameCount: number, position: number): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 0 || (raw as number) >= sourceFrameCount) {
    throw new Error(`animation.frames[${position}] index must reference one of ${sourceFrameCount} source frames.`);
  }
  return raw as number;
}

function boundedAnimationTime(raw: unknown, name: string): number {
  if (!Number.isSafeInteger(raw) || (raw as number) <= 0 || (raw as number) > MAX_ANIMATION_FRAME_TIME) {
    throw new Error(`${name} must be an integer from 1 to ${MAX_ANIMATION_FRAME_TIME}.`);
  }
  return raw as number;
}

function parseJsonObject(bytes: Uint8Array, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(textDecoder.decode(bytes));
  } catch (cause) {
    throw new Error(`${path} is not valid UTF-8 JSON: ${errorMessage(cause)}`);
  }
  if (!isRecord(value)) throw new Error(`${path} must contain a JSON object.`);
  return value;
}

function isValidResourcePath(path: string): boolean {
  return (
    resourcePathPattern.test(path) &&
    !path.startsWith("/") &&
    !path.endsWith("/") &&
    !path.includes("//") &&
    !path.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function issue(path: string, code: TextureIssueCode, message: string): ResourcePackCompatibilityIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
