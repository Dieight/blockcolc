import type {
  BlockElementVector,
  BlockFace,
  BlockTextureFallback,
  ResolvedBlockFace,
  ResolvedBlockGeometry,
  ResolvedBlockTextures,
} from "./block-models";
import type { ResourcePackManifest, ResourcePackTextureAnimation } from "./index";
import { decodePngRgba } from "./png";

export type TextureAlphaMode = "opaque" | "cutout" | "translucent";

export const DEFAULT_TEXTURE_ATLAS_LIMITS = Object.freeze({
  maxTextures: 2048,
  maxPageSize: 2048,
  maxPages: 4,
  gutter: 2,
  maxDecodedBytes: 64 * 1024 * 1024,
});

export interface TextureAtlasLimits {
  maxTextures: number;
  maxPageSize: number;
  maxPages: number;
  gutter: number;
  maxDecodedBytes: number;
}

export type TextureAtlasErrorCode =
  | "TOO_MANY_TEXTURES"
  | "INVALID_LIMITS"
  | "ATLAS_TOO_LARGE"
  | "TOO_MANY_PAGES"
  | "INVALID_PNG_PIXELS"
  | "INVALID_ANIMATION"
  | "DUPLICATE_TEXTURE_ID";

export class TextureAtlasError extends Error {
  readonly code: TextureAtlasErrorCode;
  readonly resourceId: string | undefined;

  constructor(code: TextureAtlasErrorCode, message: string, resourceId?: string) {
    super(message);
    this.name = "TextureAtlasError";
    this.code = code;
    this.resourceId = resourceId;
  }
}

export interface TextureAtlasUvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface TextureAtlasEntry {
  resourceId: string;
  /** Stable atlas-global physical tile index. */
  index: number;
  page: number;
  /** Tile index within `page`, used by page-bound GPU shaders. */
  pageTextureIndex: number;
  x: number;
  y: number;
  width: 16;
  height: 16;
  uv: TextureAtlasUvRect;
  alphaMode: TextureAlphaMode;
  animation?: TextureAtlasAnimation;
}

export interface TextureAtlasAnimationFrame {
  /** Stable atlas-global physical tile index. */
  textureIndex: number;
  page: number;
  /** Tile index within `page`, used by page-bound GPU shaders. */
  pageTextureIndex: number;
  uv: TextureAtlasUvRect;
  time: number;
}

export interface TextureAtlasAnimation {
  interpolate: boolean;
  totalTicks: number;
  frames: TextureAtlasAnimationFrame[];
}

export interface TextureAtlasPage {
  index: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  rgba: Uint8Array;
}

export interface TextureAtlas {
  schemaVersion: 1;
  textureSize: 16;
  gutter: number;
  /** Gutter protects this many generated mip levels from immediate neighbour bleeding. */
  safeMipLevels: number;
  pages: TextureAtlasPage[];
  entries: TextureAtlasEntry[];
}

export interface AtlasFaceReference {
  /** Tile index local to `page`. */
  textureIndex: number;
  page: number;
  uv: TextureAtlasUvRect;
  alphaMode: TextureAlphaMode;
  /** Face-local crop normalized from Java model coordinates (0..16) to 0..1. */
  cropUv: readonly [number, number, number, number];
  rotation: 0 | 90 | 180 | 270;
  tintIndex?: number;
  animation?: TextureAtlasAnimation;
}

export interface AtlasBlockTextures {
  status: "resolved";
  modelId: string;
  faces: Record<BlockFace, AtlasFaceReference>;
}

export interface AtlasGeometryFaceReference extends AtlasFaceReference {
  cullFace?: BlockFace;
}

export interface AtlasGeometryElement {
  from: BlockElementVector;
  to: BlockElementVector;
  shade: boolean;
  faces: Partial<Record<BlockFace, AtlasGeometryFaceReference>>;
}

export interface AtlasBlockGeometry {
  status: "resolved_geometry";
  modelId: string;
  elements: AtlasGeometryElement[];
}

export type AtlasBlockGeometryResult = AtlasBlockGeometry | BlockTextureFallback | {
  status: "fallback";
  reason: "MISSING_ATLAS_TEXTURE" | "INVALID_FACE_METADATA" | "INVALID_GEOMETRY_METADATA";
  resourceId: string;
};

export type AtlasBlockTextureResult = AtlasBlockTextures | BlockTextureFallback | {
  status: "fallback";
  reason: "MISSING_ATLAS_TEXTURE";
  resourceId: string;
} | {
  status: "fallback";
  reason: "INVALID_FACE_METADATA";
  resourceId: string;
};

type ResolutionWithOptionalFaceMetadata = ResolvedBlockTextures & {
  faceMetadata?: Partial<Record<BlockFace, ResolvedBlockFace>>;
};

const TEXTURE_SIZE = 16;

export function buildJava16xTextureAtlas(
  manifest: Pick<ResourcePackManifest, "textures">,
  overrides: Partial<TextureAtlasLimits> = {},
): TextureAtlas {
  const limits = validateLimits({ ...DEFAULT_TEXTURE_ATLAS_LIMITS, ...overrides });
  const textures = [...manifest.textures].sort((left, right) => compareText(left.resourceId, right.resourceId));
  if (textures.length > limits.maxTextures) {
    throw new TextureAtlasError("TOO_MANY_TEXTURES", `Texture count ${textures.length} exceeds ${limits.maxTextures}.`);
  }
  const ids = new Set<string>();
  for (const texture of textures) {
    if (ids.has(texture.resourceId)) throw new TextureAtlasError("DUPLICATE_TEXTURE_ID", `Duplicate texture ${texture.resourceId}.`, texture.resourceId);
    ids.add(texture.resourceId);
  }
  if (textures.length === 0) return { schemaVersion: 1, textureSize: 16, gutter: limits.gutter, safeMipLevels: safeMipLevels(limits.gutter), pages: [], entries: [] };

  const decoded = textures.map((texture) => {
    try {
      const decodedPng = decodePngRgba(texture.png, {
        expectedWidth: texture.width,
        expectedHeight: texture.height,
        maxWidth: 4096,
        maxHeight: 4096,
        maxPixels: 32 * 32 * 256,
        maxDecodedBytes: 32 * 32 * 256 * 4,
      });
      const layout = validateAtlasAnimation(texture.animation, texture.width, texture.height);
      const framesRgba = normalizeFrameTiles(decodedPng.rgba, texture.width, layout);
      return {
        texture,
        rgba: framesRgba,
        decodedSourceBytes: decodedPng.rgba.byteLength,
        sourceFrameCount: layout.sourceFrameCount,
        alphaMode: classifyAlpha(decodedPng.rgba),
      };
    } catch (cause) {
      const code = errorMessage(cause).startsWith("Animation ") ? "INVALID_ANIMATION" : "INVALID_PNG_PIXELS";
      throw new TextureAtlasError(code, `${texture.resourceId}: ${errorMessage(cause)}`, texture.resourceId);
    }
  });
  const physicalTiles = decoded.flatMap((item) => Array.from(
    { length: item.sourceFrameCount },
    (_, sourceFrame) => ({ item, sourceFrame }),
  ));
  if (physicalTiles.length > limits.maxTextures) {
    throw new TextureAtlasError("TOO_MANY_TEXTURES", `Atlas frame count ${physicalTiles.length} exceeds ${limits.maxTextures}.`);
  }
  const cellSize = TEXTURE_SIZE + limits.gutter * 2;
  const cellsPerAxis = Math.floor(limits.maxPageSize / cellSize);
  if (cellsPerAxis < 1) throw new TextureAtlasError("INVALID_LIMITS", "maxPageSize cannot fit one padded 16x texture.");
  const pageCapacity = cellsPerAxis * cellsPerAxis;
  for (const item of decoded) {
    if (item.sourceFrameCount > pageCapacity) {
      throw new TextureAtlasError(
        "ATLAS_TOO_LARGE",
        `Texture animation requires ${item.sourceFrameCount} tiles but one page fits ${pageCapacity}.`,
        item.texture.resourceId,
      );
    }
  }
  // Keep every physical frame of one source texture on the same page. This
  // lets the runtime animate a page-bound material without rebinding textures.
  const pageGroups: Array<typeof physicalTiles> = [];
  let currentPage: typeof physicalTiles = [];
  for (const item of decoded) {
    const itemTiles = Array.from(
      { length: item.sourceFrameCount },
      (_, sourceFrame) => ({ item, sourceFrame }),
    );
    if (currentPage.length > 0 && currentPage.length + itemTiles.length > pageCapacity) {
      pageGroups.push(currentPage);
      currentPage = [];
    }
    currentPage.push(...itemTiles);
  }
  if (currentPage.length > 0) pageGroups.push(currentPage);
  const pageCount = pageGroups.length;
  if (pageCount > limits.maxPages) throw new TextureAtlasError("TOO_MANY_PAGES", `Atlas requires ${pageCount} pages; limit is ${limits.maxPages}.`);
  const pages: TextureAtlasPage[] = [];
  const tileReferences: Array<TextureAtlasAnimationFrame & { x: number; y: number }> = [];
  let decodedBytes = decoded.reduce((sum, item) => sum + item.decodedSourceBytes + item.rgba.byteLength, 0);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageItems = pageGroups[pageIndex]!;
    const columns = Math.min(cellsPerAxis, Math.ceil(Math.sqrt(pageItems.length)));
    const rows = Math.ceil(pageItems.length / columns);
    const width = nextPowerOfTwo(columns * cellSize);
    const height = nextPowerOfTwo(rows * cellSize);
    if (width > limits.maxPageSize || height > limits.maxPageSize) throw new TextureAtlasError("ATLAS_TOO_LARGE", "Atlas page exceeds its configured dimensions.");
    const pageBytes = width * height * 4;
    if (!Number.isSafeInteger(pageBytes) || decodedBytes + pageBytes > limits.maxDecodedBytes) {
      throw new TextureAtlasError("ATLAS_TOO_LARGE", `Decoded textures and atlas pages exceed ${limits.maxDecodedBytes} bytes.`);
    }
    const rgba = new Uint8Array(pageBytes);
    decodedBytes += pageBytes;
    pageItems.forEach((item, localIndex) => {
      const column = localIndex % columns;
      const row = Math.floor(localIndex / columns);
      const x = column * cellSize + limits.gutter;
      const y = row * cellSize + limits.gutter;
      blitWithGutter(rgba, width, item.item.rgba, item.sourceFrame * TEXTURE_SIZE, x, y, limits.gutter);
      const globalIndex = tileReferences.length;
      tileReferences.push({
        textureIndex: globalIndex,
        page: pageIndex,
        pageTextureIndex: localIndex,
        x,
        y,
        uv: { u0: x / width, v0: y / height, u1: (x + TEXTURE_SIZE) / width, v1: (y + TEXTURE_SIZE) / height },
        time: 1,
      });
    });
    pages.push({ index: pageIndex, width, height, columns, rows, rgba });
  }
  const entries: TextureAtlasEntry[] = [];
  let physicalOffset = 0;
  for (const item of decoded) {
    const playback = item.texture.animation?.frames ?? [{ index: 0, time: 1 }];
    const animationFrames = playback.map((frame) => {
      const tile = tileReferences[physicalOffset + frame.index];
      if (!tile) throw new TextureAtlasError("INVALID_ANIMATION", `Animation frame ${frame.index} has no atlas tile.`, item.texture.resourceId);
      return {
        textureIndex: tile.textureIndex,
        page: tile.page,
        pageTextureIndex: tile.pageTextureIndex,
        uv: { ...tile.uv },
        time: frame.time,
      };
    });
    const first = animationFrames[0]!;
    const firstTile = tileReferences[first.textureIndex]!;
    entries.push({
      resourceId: item.texture.resourceId,
      index: first.textureIndex,
      page: first.page,
      pageTextureIndex: first.pageTextureIndex,
      x: firstTile.x,
      y: firstTile.y,
      width: 16,
      height: 16,
      uv: { ...first.uv },
      alphaMode: item.alphaMode,
      ...(item.texture.animation === undefined ? {} : {
        animation: {
          interpolate: item.texture.animation.interpolate,
          totalTicks: animationFrames.reduce((sum, frame) => sum + frame.time, 0),
          frames: animationFrames,
        },
      }),
    });
    physicalOffset += item.sourceFrameCount;
  }
  return { schemaVersion: 1, textureSize: 16, gutter: limits.gutter, safeMipLevels: safeMipLevels(limits.gutter), pages, entries };
}

export function mapBlockTexturesToAtlas(
  resolution: ResolvedBlockTextures | BlockTextureFallback,
  atlas: Pick<TextureAtlas, "entries">,
): AtlasBlockTextureResult {
  if (resolution.status === "fallback") return resolution;
  const entries = new Map(atlas.entries.map((entry) => [entry.resourceId, entry]));
  const mapped = {} as Record<BlockFace, AtlasFaceReference>;
  const metadata = (resolution as ResolutionWithOptionalFaceMetadata).faceMetadata;
  for (const [face, resourceId] of Object.entries(resolution.faces) as Array<[BlockFace, string]>) {
    const entry = entries.get(resourceId);
    if (!entry) return { status: "fallback", reason: "MISSING_ATLAS_TEXTURE", resourceId };
    const faceMetadata = metadata?.[face];
    if (faceMetadata !== undefined && !validFaceMetadata(faceMetadata, resourceId)) {
      return { status: "fallback", reason: "INVALID_FACE_METADATA", resourceId };
    }
    mapped[face] = {
      textureIndex: entry.pageTextureIndex,
      page: entry.page,
      uv: { ...entry.uv },
      alphaMode: entry.alphaMode,
      cropUv: normalizeFaceUv(faceMetadata?.uv),
      rotation: faceMetadata?.rotation ?? 0,
      ...(faceMetadata?.tintIndex === undefined ? {} : { tintIndex: faceMetadata.tintIndex }),
      ...(entry.animation === undefined ? {} : { animation: cloneAtlasAnimation(entry.animation) }),
    };
  }
  return { status: "resolved", modelId: resolution.modelId, faces: mapped };
}

export function mapBlockGeometryToAtlas(
  resolution: ResolvedBlockGeometry | BlockTextureFallback,
  atlas: Pick<TextureAtlas, "entries">,
): AtlasBlockGeometryResult {
  if (resolution.status === "fallback") return resolution;
  if (!validGeometryElements(resolution.elements)) {
    return { status: "fallback", reason: "INVALID_GEOMETRY_METADATA", resourceId: resolution.modelId };
  }
  const entries = new Map(atlas.entries.map((entry) => [entry.resourceId, entry]));
  const elements: AtlasGeometryElement[] = [];
  for (const element of resolution.elements) {
    const mappedFaces: Partial<Record<BlockFace, AtlasGeometryFaceReference>> = {};
    for (const [face, metadata] of Object.entries(element.faces) as Array<[BlockFace, ResolvedBlockFace]>) {
      if (!validFaceMetadata(metadata, metadata?.texture) || (metadata.cullFace !== undefined && !isBlockFace(metadata.cullFace))) {
        return { status: "fallback", reason: "INVALID_FACE_METADATA", resourceId: metadata?.texture ?? resolution.modelId };
      }
      const entry = entries.get(metadata.texture);
      if (!entry) return { status: "fallback", reason: "MISSING_ATLAS_TEXTURE", resourceId: metadata.texture };
      mappedFaces[face] = {
        textureIndex: entry.pageTextureIndex,
        page: entry.page,
        uv: { ...entry.uv },
        alphaMode: entry.alphaMode,
        cropUv: normalizeFaceUv(metadata.uv),
        rotation: metadata.rotation,
        ...(metadata.tintIndex === undefined ? {} : { tintIndex: metadata.tintIndex }),
        ...(metadata.cullFace === undefined ? {} : { cullFace: metadata.cullFace }),
        ...(entry.animation === undefined ? {} : { animation: cloneAtlasAnimation(entry.animation) }),
      };
    }
    elements.push({
      from: [...element.from] as unknown as BlockElementVector,
      to: [...element.to] as unknown as BlockElementVector,
      shade: element.shade,
      faces: mappedFaces,
    });
  }
  return { status: "resolved_geometry", modelId: resolution.modelId, elements };
}

function validGeometryElements(elements: readonly unknown[]): elements is ResolvedBlockGeometry["elements"] {
  if (!Array.isArray(elements) || elements.length === 0 || elements.length > 128) return false;
  let quadCount = 0;
  for (const element of elements) {
    if (!element || typeof element !== "object") return false;
    const candidate = element as ResolvedBlockGeometry["elements"][number];
    if (!validElementVector(candidate.from) || !validElementVector(candidate.to) || typeof candidate.shade !== "boolean") return false;
    if (candidate.from.some((value, axis) => value > candidate.to[axis]!)) return false;
    if (!candidate.faces || typeof candidate.faces !== "object" || Array.isArray(candidate.faces)) return false;
    const faceKeys = Object.keys(candidate.faces);
    if (faceKeys.length === 0 || faceKeys.length > 6 || faceKeys.some((face) => !isBlockFace(face))) return false;
    quadCount += faceKeys.length;
    if (quadCount > 768) return false;
    const zeroAxes = candidate.from.map((value, axis) => value === candidate.to[axis]).flatMap((zero, axis) => zero ? [axis] : []);
    if (zeroAxes.length > 1) return false;
    if (zeroAxes.length === 1) {
      const allowed = zeroAxes[0] === 0 ? new Set(["west", "east"])
        : zeroAxes[0] === 1 ? new Set(["down", "up"])
          : new Set(["north", "south"]);
      if (faceKeys.some((face) => !allowed.has(face))) return false;
    }
  }
  return true;
}

function validElementVector(vector: unknown): vector is BlockElementVector {
  return Array.isArray(vector)
    && vector.length === 3
    && vector.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 16);
}

function isBlockFace(value: unknown): value is BlockFace {
  return value === "down" || value === "up" || value === "north" || value === "south" || value === "west" || value === "east";
}

function validFaceMetadata(metadata: ResolvedBlockFace, resourceId: string): boolean {
  if (!metadata || typeof metadata !== "object" || metadata.texture !== resourceId) return false;
  if (metadata.rotation !== 0 && metadata.rotation !== 90 && metadata.rotation !== 180 && metadata.rotation !== 270) return false;
  if (metadata.tintIndex !== undefined && (!Number.isSafeInteger(metadata.tintIndex) || metadata.tintIndex < 0 || metadata.tintIndex > 255)) return false;
  if (metadata.uv === undefined) return true;
  return Array.isArray(metadata.uv)
    && metadata.uv.length === 4
    && metadata.uv.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 16);
}

function cloneAtlasAnimation(animation: TextureAtlasAnimation): TextureAtlasAnimation {
  return {
    interpolate: animation.interpolate,
    totalTicks: animation.totalTicks,
    frames: animation.frames.map((frame) => ({ ...frame, uv: { ...frame.uv } })),
  };
}

function normalizeFaceUv(uv: readonly [number, number, number, number] | undefined): readonly [number, number, number, number] {
  return uv === undefined ? [0, 0, 1, 1] : [uv[0] / 16, uv[1] / 16, uv[2] / 16, uv[3] / 16];
}

export function classifyJava16xPngAlpha(png: Uint8Array): TextureAlphaMode {
  return classifyAlpha(decodePngRgba(png, { expectedWidth: 16, expectedHeight: 16, maxPixels: 256, maxDecodedBytes: 1024 }).rgba);
}

function classifyAlpha(rgba: Uint8Array): TextureAlphaMode {
  let sawTransparent = false;
  for (let index = 3; index < rgba.length; index += 4) {
    const alpha = rgba[index] ?? 255;
    if (alpha > 0 && alpha < 255) return "translucent";
    if (alpha === 0) sawTransparent = true;
  }
  return sawTransparent ? "cutout" : "opaque";
}

function blitWithGutter(target: Uint8Array, targetWidth: number, source: Uint8Array, sourceY: number, x: number, y: number, gutter: number): void {
  for (let dy = -gutter; dy < TEXTURE_SIZE + gutter; dy += 1) {
    for (let dx = -gutter; dx < TEXTURE_SIZE + gutter; dx += 1) {
      const sourceX = Math.max(0, Math.min(TEXTURE_SIZE - 1, dx));
      const clampedSourceY = sourceY + Math.max(0, Math.min(TEXTURE_SIZE - 1, dy));
      const sourceOffset = (clampedSourceY * TEXTURE_SIZE + sourceX) * 4;
      const targetOffset = ((y + dy) * targetWidth + x + dx) * 4;
      target.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
}

interface AtlasFrameLayout {
  frameWidth: 16 | 32;
  frameHeight: 16 | 32;
  sourceColumns: number;
  sourceRows: number;
  sourceFrameCount: number;
}

function validateAtlasAnimation(animation: ResourcePackTextureAnimation | undefined, sheetWidth: number, sheetHeight: number): AtlasFrameLayout {
  if (animation === undefined) {
    if (sheetWidth !== 16 || sheetHeight !== 16) throw new Error("Animation metadata is required for a non-16x16 texture.");
    return { frameWidth: 16, frameHeight: 16, sourceColumns: 1, sourceRows: 1, sourceFrameCount: 1 };
  }
  const sourceColumns = animation.sourceColumns ?? sheetWidth / animation.frameWidth;
  const sourceRows = animation.sourceRows ?? sheetHeight / animation.frameHeight;
  if (
    (animation.frameWidth !== 16 && animation.frameWidth !== 32)
    || animation.frameHeight !== animation.frameWidth
    || !Number.isSafeInteger(sourceColumns)
    || sourceColumns < 1
    || !Number.isSafeInteger(sourceRows)
    || sourceRows < 1
    || sourceColumns * animation.frameWidth !== sheetWidth
    || sourceRows * animation.frameHeight !== sheetHeight
    || animation.sourceFrameCount !== sourceColumns * sourceRows
    || animation.sourceFrameCount < 1
    || animation.sourceFrameCount > 256
    || typeof animation.interpolate !== "boolean"
    || !Number.isSafeInteger(animation.frametime)
    || animation.frametime <= 0
    || !Array.isArray(animation.frames)
    || animation.frames.length === 0
  ) throw new Error("Animation manifest is inconsistent with its texture sheet.");
  for (const frame of animation.frames) {
    if (
      !frame
      || !Number.isSafeInteger(frame.index)
      || frame.index < 0
      || frame.index >= animation.sourceFrameCount
      || !Number.isSafeInteger(frame.time)
      || frame.time <= 0
    ) throw new Error("Animation frame index or time is invalid.");
  }
  return {
    frameWidth: animation.frameWidth,
    frameHeight: animation.frameHeight,
    sourceColumns,
    sourceRows,
    sourceFrameCount: animation.sourceFrameCount,
  };
}

function normalizeFrameTiles(source: Uint8Array, sourceWidth: number, layout: AtlasFrameLayout): Uint8Array {
  const output = new Uint8Array(layout.sourceFrameCount * TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const scale = layout.frameWidth / TEXTURE_SIZE;
  for (let frameIndex = 0; frameIndex < layout.sourceFrameCount; frameIndex += 1) {
    const frameColumn = frameIndex % layout.sourceColumns;
    const frameRow = Math.floor(frameIndex / layout.sourceColumns);
    for (let y = 0; y < TEXTURE_SIZE; y += 1) for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const target = (frameIndex * TEXTURE_SIZE * TEXTURE_SIZE + y * TEXTURE_SIZE + x) * 4;
      if (scale === 1) {
        const sourceOffset = ((frameRow * 16 + y) * sourceWidth + frameColumn * 16 + x) * 4;
        output.set(source.subarray(sourceOffset, sourceOffset + 4), target);
      } else {
        downsamplePremultiplied2x2(source, sourceWidth, frameColumn * 32 + x * 2, frameRow * 32 + y * 2, output, target);
      }
    }
  }
  return output;
}

function downsamplePremultiplied2x2(source: Uint8Array, sourceWidth: number, x: number, y: number, target: Uint8Array, targetOffset: number): void {
  let alphaSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
    const offset = ((y + dy) * sourceWidth + x + dx) * 4;
    const alpha = source[offset + 3] ?? 0;
    alphaSum += alpha;
    redSum += (source[offset] ?? 0) * alpha;
    greenSum += (source[offset + 1] ?? 0) * alpha;
    blueSum += (source[offset + 2] ?? 0) * alpha;
  }
  target[targetOffset] = alphaSum === 0 ? 0 : Math.round(redSum / alphaSum);
  target[targetOffset + 1] = alphaSum === 0 ? 0 : Math.round(greenSum / alphaSum);
  target[targetOffset + 2] = alphaSum === 0 ? 0 : Math.round(blueSum / alphaSum);
  target[targetOffset + 3] = Math.round(alphaSum / 4);
}

function validateLimits(limits: TextureAtlasLimits): TextureAtlasLimits {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TextureAtlasError("INVALID_LIMITS", `${key} must be a positive safe integer.`);
  }
  if (limits.maxPageSize > 4096 || limits.gutter > 16) throw new TextureAtlasError("INVALID_LIMITS", "Atlas dimensions or gutter exceed hard safety bounds.");
  return limits;
}

function safeMipLevels(gutter: number): number {
  return Math.max(0, Math.floor(Math.log2(gutter)) + 1);
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
