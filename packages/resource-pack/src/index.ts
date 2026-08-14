import { unzipSync } from "fflate";
import {
  parseBlockAssets,
  type BlockModelIssueCode,
  type NormalizedBlockModel,
  type NormalizedBlockState,
} from "./block-models";
import { parseResourcePackColormaps, type ResourcePackColormap } from "./colormap";
import { inspectPngDimensions } from "./png";

export * from "./block-models";
export * from "./atlas";
export * from "./compatibility";
export * from "./colormap";
export * from "./png";
export * from "./png";

export const DEFAULT_RESOURCE_PACK_LIMITS = Object.freeze({
  maxInputBytes: 32 * 1024 * 1024,
  maxFileCount: 8192,
  maxSingleFileBytes: 4 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxPackMetadataBytes: 64 * 1024,
  maxTextureMetadataBytes: 64 * 1024,
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
  packFormat: number;
  description: unknown;
}

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
  frameWidth: 16 | 32;
  frameHeight: 16 | 32;
  /** Row-major source grid dimensions. Omitted only by legacy 16xN persisted manifests. */
  sourceColumns?: number;
  sourceRows?: number;
  sourceFrameCount: number;
  frametime: number;
  interpolate: boolean;
  frames: ResourcePackAnimationFrame[];
}

export type ResourcePackIssueCode = TextureIssueCode | BlockModelIssueCode | "INVALID_COLORMAP";

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
  /** Source sheet width. Static textures remain 16x16; animated sheets may use 16px or 32px square frames. */
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

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const namespacePattern = /^[a-z0-9_.-]+$/;
const resourcePathPattern = /^[a-z0-9._/-]+$/;
const texturePattern = /^assets\/([^/]+)\/textures\/block\/(.+)\.png$/;
const textureMetadataPattern = /^assets\/([^/]+)\/textures\/block\/(.+)\.png\.mcmeta$/;
const MAX_ANIMATION_SOURCE_FRAMES = 256;
const MAX_ANIMATION_SEQUENCE_FRAMES = 4096;
const MAX_ANIMATION_FRAME_TIME = 1_000_000;

export function parseJava16xResourcePack(
  zipBytes: Uint8Array,
  overrides: Partial<ResourcePackLimits> = {},
): ResourcePackManifest {
  const limits = validateLimits({ ...DEFAULT_RESOURCE_PACK_LIMITS, ...overrides });
  if (zipBytes.byteLength > limits.maxInputBytes) {
    throw new ResourcePackError(
      "INPUT_TOO_LARGE",
      `Resource pack is ${zipBytes.byteLength} bytes; limit is ${limits.maxInputBytes}.`,
    );
  }

  const auditedEntries = auditZip(zipBytes, limits);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch (cause) {
    throw new ResourcePackError(
      "INVALID_ZIP",
      `Resource pack could not be decompressed: ${errorMessage(cause)}`,
    );
  }
  let extractedTotal = 0;
  for (const [path, bytes] of Object.entries(files)) {
    if (bytes.byteLength > limits.maxSingleFileBytes) {
      throw new ResourcePackError("FILE_TOO_LARGE", `${path} exceeds the extracted per-file limit.`, path);
    }
    extractedTotal += bytes.byteLength;
    if (extractedTotal > limits.maxTotalUncompressedBytes) {
      throw new ResourcePackError("TOTAL_UNCOMPRESSED_TOO_LARGE", "Extracted ZIP exceeds the total size limit.");
    }
  }

  const packBytes = files["pack.mcmeta"];
  if (!packBytes) {
    throw new ResourcePackError("MISSING_PACK_MCMETA", "pack.mcmeta must exist at the ZIP root.");
  }
  if (packBytes.byteLength > limits.maxPackMetadataBytes) {
    throw new ResourcePackError(
      "INVALID_PACK_MCMETA",
      `pack.mcmeta exceeds ${limits.maxPackMetadataBytes} bytes.`,
      "pack.mcmeta",
    );
  }
  const pack = parsePackMetadata(packBytes);

  const paths = auditedEntries.filter((entry) => !entry.isDirectory).map((entry) => entry.path);
  const metadataPaths = new Set(paths.filter((path) => textureMetadataPattern.test(path)));
  const candidatePaths = paths.filter((path) => texturePattern.test(path)).sort(comparePath);
  const issues: ResourcePackCompatibilityIssue[] = [];
  const textures: ResourcePackTexture[] = [];
  const consumedMetadata = new Set<string>();
  const blockAssets = parseBlockAssets(files, paths, parseJsonObject);
  const parsedColormaps = parseResourcePackColormaps(files, paths);

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

    let animation: ResourcePackTextureAnimation | undefined;
    try {
      animation = normalizeTextureAnimation(metadata, dimensions.width, dimensions.height);
    } catch (cause) {
      issues.push(issue(metadata === undefined ? archivePath : metadataPath, "INVALID_TEXTURE_ANIMATION", errorMessage(cause)));
      continue;
    }
    if (animation === undefined && (dimensions.width !== 16 || dimensions.height !== 16)) {
      if (
        dimensions.width === 16
        && dimensions.height > 16
        && dimensions.height % 16 === 0
        && dimensions.height / 16 <= MAX_ANIMATION_SOURCE_FRAMES
      ) {
        issues.push(issue(archivePath, "INVALID_TEXTURE_ANIMATION", "Vertical texture strips require an animation object in .png.mcmeta."));
        continue;
      }
      issues.push(issue(archivePath, "NOT_16X16", `Static texture is ${dimensions.width}x${dimensions.height}; expected 16x16.`));
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

  issues.sort((left, right) => comparePath(left.path, right.path) || left.code.localeCompare(right.code));
  const namespaces = [...new Set(textures.map((texture) => texture.namespace))].sort(comparePath);
  const recognizedPaths = new Set([
    "pack.mcmeta", ...candidatePaths, ...metadataPaths, ...blockAssets.recognizedPaths, ...parsedColormaps.recognizedPaths,
  ]);

  return {
    schemaVersion: 1,
    pack,
    textures,
    ...(parsedColormaps.colormaps.length === 0 ? {} : { colormaps: parsedColormaps.colormaps }),
    blockStates: blockAssets.blockStates,
    models: blockAssets.models,
    summary: {
      archiveFileCount: paths.length,
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

function auditZip(bytes: Uint8Array, limits: ResourcePackLimits): ZipEntryAudit[] {
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
  if (entryCount > limits.maxFileCount) {
    throw new ResourcePackError("TOO_MANY_FILES", `ZIP contains ${entryCount} entries; limit is ${limits.maxFileCount}.`);
  }
  if (centralOffset + centralSize > eocd || centralOffset + centralSize > bytes.byteLength) {
    throw new ResourcePackError("INVALID_ZIP", "ZIP central directory is outside the archive.");
  }

  const entries: ZipEntryAudit[] = [];
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  let offset = centralOffset;
  let total = 0;
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

    if (originalSize > limits.maxSingleFileBytes) {
      throw new ResourcePackError(
        "FILE_TOO_LARGE",
        `${path} expands to ${originalSize} bytes; per-file limit is ${limits.maxSingleFileBytes}.`,
        path,
      );
    }
    total += originalSize;
    if (total > limits.maxTotalUncompressedBytes) {
      throw new ResourcePackError(
        "TOTAL_UNCOMPRESSED_TOO_LARGE",
        `ZIP expands beyond ${limits.maxTotalUncompressedBytes} bytes.`,
      );
    }
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

function parsePackMetadata(bytes: Uint8Array): ResourcePackMetadata {
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
  const packFormat = pack.pack_format;
  if (!Number.isSafeInteger(packFormat) || (packFormat as number) <= 0) {
    throw new ResourcePackError(
      "INVALID_PACK_MCMETA",
      "pack.pack_format must be a positive integer.",
      "pack.mcmeta",
    );
  }
  if (!("description" in pack)) {
    throw new ResourcePackError("INVALID_PACK_MCMETA", "pack.description is required.", "pack.mcmeta");
  }
  return { packFormat: packFormat as number, description: pack.description };
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
  if (frameWidth !== frameHeight) throw new Error("Only square 16px or 32px animation frames are supported.");
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

function animationFrameSize(raw: unknown, name: string): 16 | 32 {
  if (raw !== 16 && raw !== 32) throw new Error(`${name} must be 16 or 32.`);
  return raw;
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
