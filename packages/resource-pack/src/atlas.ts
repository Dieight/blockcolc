import type {
  BlockElementRotation,
  BlockElementVector,
  BlockFace,
  BlockTextureFallback,
  ResolvedBlockFace,
  ResolvedBlockGeometry,
  ResolvedBlockTextures,
} from "./block-models";
import type { ResourcePackManifest, ResourcePackTextureAnimation, ResourcePackTextureSize } from "./index";
import { DEFAULT_PNG_RGBA_LIMITS, decodePngRgba, estimatePngRgbaDecodeMemory } from "./png";

export type TextureAlphaMode = "opaque" | "cutout" | "translucent";

export const DEFAULT_TEXTURE_ATLAS_LIMITS = Object.freeze({
  maxTextures: 4096,
  maxPageSize: 2048,
  maxPages: 4,
  gutter: 2,
  maxPngBytes: 4 * 1024 * 1024,
  maxSourcePixelsPerTexture: DEFAULT_PNG_RGBA_LIMITS.maxPixels,
  // Bounds the conservative simultaneous CPU/GPU estimate, including output
  // pages, their generated mip levels, resident source PNG bytes, and the
  // largest one-PNG decode working set. Normalized-frame copies are avoided.
  maxDecodedBytes: 128 * 1024 * 1024,
  /** Resident CPU/GPU atlas bytes retained while a replacement is built. */
  reservedAtlasBytes: 0,
  /** Other known transient allocations owned by the atlas caller, such as colormaps. */
  additionalWorkingSetBytes: 0,
});

export interface TextureAtlasLimits {
  maxTextures: number;
  maxPageSize: number;
  maxPages: number;
  gutter: number;
  maxPngBytes: number;
  maxSourcePixelsPerTexture: number;
  maxDecodedBytes: number;
  reservedAtlasBytes: number;
  additionalWorkingSetBytes: number;
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
  width: ResourcePackTextureSize;
  height: ResourcePackTextureSize;
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
  /** Native frame size for every tile on this page. */
  textureSize?: ResourcePackTextureSize;
  width: number;
  height: number;
  columns: number;
  rows: number;
  rgba: Uint8Array;
}

export interface TextureAtlas {
  schemaVersion: 1;
  /** Largest source tile size, retained for legacy whole-atlas consumers. */
  textureSize: ResourcePackTextureSize;
  gutter: number;
  /** Gutter protects this many generated mip levels from immediate neighbour bleeding. */
  safeMipLevels: number;
  pages: TextureAtlasPage[];
  entries: TextureAtlasEntry[];
  memoryEstimate?: TextureAtlasMemoryEstimate;
}

export interface TextureAtlasMemoryEstimate {
  limitBytes: number;
  reservedAtlasBytes: number;
  additionalWorkingSetBytes: number;
  sourcePngBytes: number;
  sourceRgbaBytes: number;
  decoderWorkingSetBytes: number;
  normalizationBytes: 0;
  pageRgbaBytes: number;
  mipmapRgbaBytes: number;
  animationLookupRgbaBytes: number;
  estimatedGpuBytes: number;
  estimatedPeakBytes: number;
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
  shadeDirectionOverride?: BlockFace;
  faces: Partial<Record<BlockFace, AtlasGeometryFaceReference>>;
  rotation?: BlockElementRotation;
  blockRotation?: { x: 0 | 90 | 180 | 270; y: 0 | 90 | 180 | 270 };
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

interface AtlasTexturePlan {
  texture: ResourcePackManifest["textures"][number];
  layout: AtlasFrameLayout;
  textureSize: ResourcePackTextureSize;
  frameReferences: Array<(TextureAtlasAnimationFrame & { x: number; y: number }) | undefined>;
  alphaMode?: TextureAlphaMode;
}

interface PlannedAtlasTile {
  texture: AtlasTexturePlan;
  sourceFrame: number;
  pageTextureIndex: number;
}

interface PlannedAtlasPage {
  index: number;
  textureSize: ResourcePackTextureSize;
  cellSize: number;
  columns: number;
  rows: number;
  width: number;
  height: number;
  rgbaBytes: number;
  mipmapBytes: number;
  animationLookupBytes: number;
  tiles: PlannedAtlasTile[];
  textures: AtlasTexturePlan[];
}

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
  if (textures.length === 0) {
    return {
      schemaVersion: 1,
      textureSize: 16,
      gutter: limits.gutter,
      safeMipLevels: safeMipLevels(limits.gutter),
      pages: [],
      entries: [],
      memoryEstimate: emptyMemoryEstimate(limits),
    };
  }

  const plans: AtlasTexturePlan[] = [];
  let physicalTileCount = 0;
  let sourcePngBytes = 0;
  let sourceRgbaBytes = 0;
  let decoderWorkingSetBytes = 0;
  for (const texture of textures) {
    if (!(texture.png instanceof Uint8Array) || texture.png.byteLength < 1 || texture.png.byteLength > limits.maxPngBytes) {
      throw new TextureAtlasError(
        "INVALID_PNG_PIXELS",
        `${texture.resourceId}: PNG byte length ${texture.png?.byteLength ?? 0} exceeds the per-texture limit of ${limits.maxPngBytes} bytes.`,
        texture.resourceId,
      );
    }
    const estimate = estimatePngRgbaDecodeMemory(texture.png);
    if (!estimate || estimate.width !== texture.width || estimate.height !== texture.height) {
      throw new TextureAtlasError("INVALID_PNG_PIXELS", `${texture.resourceId}: PNG dimensions do not match the manifest or the PNG structure is invalid.`, texture.resourceId);
    }
    if (estimate.width > DEFAULT_PNG_RGBA_LIMITS.maxDimension || estimate.height > DEFAULT_PNG_RGBA_LIMITS.maxDimension
      || estimate.pixelCount > limits.maxSourcePixelsPerTexture) {
      throw new TextureAtlasError(
        "ATLAS_TOO_LARGE",
        `${texture.resourceId}: PNG ${estimate.width}x${estimate.height} has ${estimate.pixelCount} pixels; per-texture decode limit is ${limits.maxSourcePixelsPerTexture} pixels (${limits.maxSourcePixelsPerTexture * 4} RGBA bytes).`,
        texture.resourceId,
      );
    }
    let layout: AtlasFrameLayout;
    try {
      layout = validateAtlasAnimation(texture.animation, texture.width, texture.height);
    } catch (cause) {
      throw new TextureAtlasError("INVALID_ANIMATION", `${texture.resourceId}: ${errorMessage(cause)}`, texture.resourceId);
    }
    physicalTileCount += layout.sourceFrameCount;
    if (physicalTileCount > limits.maxTextures) {
      throw new TextureAtlasError("TOO_MANY_TEXTURES", `Atlas frame count ${physicalTileCount} exceeds ${limits.maxTextures}.`);
    }
    sourcePngBytes += texture.png.byteLength;
    sourceRgbaBytes += estimate.rgbaBytes;
    decoderWorkingSetBytes = Math.max(decoderWorkingSetBytes, estimate.workingSetBytes);
    plans.push({
      texture,
      layout,
      textureSize: layout.frameWidth,
      frameReferences: new Array(layout.sourceFrameCount),
    });
  }

  const pagePlans = planAtlasPages(plans, limits);
  if (pagePlans.length > limits.maxPages) {
    const pageCounts = [...new Set(plans.map((plan) => plan.textureSize))]
      .sort((left, right) => left - right)
      .map((size) => `${size}px: ${pagePlans.filter((page) => page.textureSize === size).length}`)
      .join(", ");
    throw new TextureAtlasError("TOO_MANY_PAGES", `Atlas requires ${pagePlans.length} pages (${pageCounts}); limit is ${limits.maxPages}.`);
  }

  const safeMips = safeMipLevels(limits.gutter);
  const pageRgbaBytes = pagePlans.reduce((sum, page) => sum + page.rgbaBytes, 0);
  const mipmapRgbaBytes = pagePlans.reduce((sum, page) => sum + page.mipmapBytes, 0);
  const animationLookupRgbaBytes = pagePlans.reduce((sum, page) => sum + page.animationLookupBytes, 0);
  // Reserve CPU page buffers, CPU mip buffers and a second complete copy for
  // GPU upload, plus all resident source PNGs and the worst one-image decoder
  // working set. Normalization buffers are zero because frames are blitted
  // directly from the decoded source sheet into native-resolution pages.
  const estimatedGpuBytes = pageRgbaBytes + mipmapRgbaBytes + animationLookupRgbaBytes;
  const estimatedPeakBytes = limits.reservedAtlasBytes + limits.additionalWorkingSetBytes + sourcePngBytes
    + pageRgbaBytes + mipmapRgbaBytes + animationLookupRgbaBytes + estimatedGpuBytes + decoderWorkingSetBytes;
  const memoryEstimate: TextureAtlasMemoryEstimate = {
    limitBytes: limits.maxDecodedBytes,
    reservedAtlasBytes: limits.reservedAtlasBytes,
    additionalWorkingSetBytes: limits.additionalWorkingSetBytes,
    sourcePngBytes,
    sourceRgbaBytes,
    decoderWorkingSetBytes,
    normalizationBytes: 0,
    pageRgbaBytes,
    mipmapRgbaBytes,
    animationLookupRgbaBytes,
    estimatedGpuBytes,
    estimatedPeakBytes,
  };
  if (!Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes > limits.maxDecodedBytes) {
    throw new TextureAtlasError(
      "ATLAS_TOO_LARGE",
      `Atlas memory estimate ${estimatedPeakBytes} bytes exceeds ${limits.maxDecodedBytes} bytes `
      + `(previous atlas resident ${limits.reservedAtlasBytes}, additional working set ${limits.additionalWorkingSetBytes}, `
        + `source PNGs ${sourcePngBytes}, one-PNG decode working set ${decoderWorkingSetBytes}, `
        + `page RGBA ${pageRgbaBytes}, mipmaps ${mipmapRgbaBytes}, animation lookups ${animationLookupRgbaBytes}, `
        + `estimated GPU upload ${estimatedGpuBytes}, normalization buffers 0).`,
    );
  }

  const pages: TextureAtlasPage[] = [];
  let nextGlobalTileIndex = 0;
  for (const plan of pagePlans) {
    const rgba = new Uint8Array(plan.rgbaBytes);
    for (const texturePlan of plan.textures) {
      let decoded: ReturnType<typeof decodePngRgba>;
      try {
        decoded = decodePngRgba(texturePlan.texture.png, {
          expectedWidth: texturePlan.texture.width,
          expectedHeight: texturePlan.texture.height,
          maxWidth: DEFAULT_PNG_RGBA_LIMITS.maxDimension,
          maxHeight: DEFAULT_PNG_RGBA_LIMITS.maxDimension,
          maxPixels: limits.maxSourcePixelsPerTexture,
          maxDecodedBytes: limits.maxSourcePixelsPerTexture * 4,
        });
      } catch (cause) {
        throw new TextureAtlasError("INVALID_PNG_PIXELS", `${texturePlan.texture.resourceId}: ${errorMessage(cause)}`, texturePlan.texture.resourceId);
      }
      texturePlan.alphaMode = classifyAlpha(decoded.rgba);
      for (const tile of plan.tiles) {
        if (tile.texture !== texturePlan) continue;
        const x = (tile.pageTextureIndex % plan.columns) * plan.cellSize + limits.gutter;
        const y = Math.floor(tile.pageTextureIndex / plan.columns) * plan.cellSize + limits.gutter;
        blitSourceFrameWithGutter(rgba, plan.width, decoded.rgba, texturePlan.texture.width, texturePlan.layout, tile.sourceFrame, x, y, limits.gutter);
        texturePlan.frameReferences[tile.sourceFrame] = {
          textureIndex: nextGlobalTileIndex++,
          page: plan.index,
          pageTextureIndex: tile.pageTextureIndex,
          x,
          y,
          uv: {
            u0: x / plan.width,
            v0: y / plan.height,
            u1: (x + plan.textureSize) / plan.width,
            v1: (y + plan.textureSize) / plan.height,
          },
          time: 1,
        };
      }
    }
    pages.push({
      index: plan.index,
      textureSize: plan.textureSize,
      width: plan.width,
      height: plan.height,
      columns: plan.columns,
      rows: plan.rows,
      rgba,
    });
  }

  const entries: TextureAtlasEntry[] = plans.map((plan) => {
    const playback = plan.texture.animation?.frames ?? [{ index: 0, time: 1 }];
    const animationFrames = playback.map((frame) => {
      const tile = plan.frameReferences[frame.index];
      if (!tile) throw new TextureAtlasError("INVALID_ANIMATION", `Animation frame ${frame.index} has no atlas tile.`, plan.texture.resourceId);
      return {
        textureIndex: tile.textureIndex,
        page: tile.page,
        pageTextureIndex: tile.pageTextureIndex,
        uv: { ...tile.uv },
        time: frame.time,
      };
    });
    const first = animationFrames[0]!;
    const firstTile = plan.frameReferences[playback[0]!.index]!;
    return {
      resourceId: plan.texture.resourceId,
      index: first.textureIndex,
      page: first.page,
      pageTextureIndex: first.pageTextureIndex,
      x: firstTile.x,
      y: firstTile.y,
      width: plan.textureSize,
      height: plan.textureSize,
      uv: { ...first.uv },
      alphaMode: plan.alphaMode ?? "opaque",
      ...(plan.texture.animation === undefined ? {} : {
        animation: {
          interpolate: plan.texture.animation.interpolate,
          totalTicks: animationFrames.reduce((sum, frame) => sum + frame.time, 0),
          frames: animationFrames,
        },
      }),
    };
  });
  const textureSize = plans.reduce<ResourcePackTextureSize>(
    (largest, plan) => Math.max(largest, plan.textureSize) as ResourcePackTextureSize,
    16,
  );
  return { schemaVersion: 1, textureSize, gutter: limits.gutter, safeMipLevels: safeMips, pages, entries, memoryEstimate };
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
      alphaMode: faceMetadata?.forceTranslucent ? "translucent" : entry.alphaMode,
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
        alphaMode: metadata.forceTranslucent ? "translucent" : entry.alphaMode,
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
      ...(element.shadeDirectionOverride === undefined ? {} : { shadeDirectionOverride: element.shadeDirectionOverride }),
      faces: mappedFaces,
      ...(element.rotation === undefined ? {} : { rotation: structuredClone(element.rotation) }),
      ...(element.blockRotation === undefined ? {} : { blockRotation: { ...element.blockRotation } }),
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
    if (candidate.shadeDirectionOverride !== undefined && !isBlockFace(candidate.shadeDirectionOverride)) return false;
    if (candidate.rotation !== undefined && !validElementRotation(candidate.rotation)) return false;
    if (candidate.blockRotation !== undefined
      && (![0, 90, 180, 270].includes(candidate.blockRotation.x) || ![0, 90, 180, 270].includes(candidate.blockRotation.y))) return false;
    if (!candidate.faces || typeof candidate.faces !== "object" || Array.isArray(candidate.faces)) return false;
    const faceKeys = Object.keys(candidate.faces);
    if (faceKeys.length === 0 || faceKeys.length > 6 || faceKeys.some((face) => !isBlockFace(face))) return false;
    quadCount += faceKeys.length;
    if (quadCount > 768) return false;
    const zeroAxes = candidate.from.map((value, axis) => value === candidate.to[axis]).flatMap((zero, axis) => zero ? [axis] : []);
    if (zeroAxes.length > 1) return false;
  }
  return true;
}

function validElementVector(vector: unknown): vector is BlockElementVector {
  return Array.isArray(vector)
    && vector.length === 3
    && vector.every((value) => typeof value === "number" && Number.isFinite(value) && value >= -16 && value <= 32);
}

function validElementRotation(rotation: unknown): rotation is BlockElementRotation {
  if (!rotation || typeof rotation !== "object" || Array.isArray(rotation)) return false;
  const candidate = rotation as BlockElementRotation;
  if (!validElementVector(candidate.origin) || typeof candidate.rescale !== "boolean") return false;
  if (candidate.euler !== undefined) {
    return !candidate.rescale && Array.isArray(candidate.euler) && candidate.euler.length === 3
      && candidate.euler.every((angle) => typeof angle === "number" && Number.isFinite(angle) && angle >= -180 && angle <= 180)
      && candidate.axis === undefined && candidate.angle === undefined;
  }
  return (candidate.axis === "x" || candidate.axis === "y" || candidate.axis === "z")
    && typeof candidate.angle === "number" && Number.isFinite(candidate.angle)
    && candidate.angle >= -90 && candidate.angle <= 90
    && (!candidate.rescale || Math.abs(candidate.angle) <= 45);
}

function isBlockFace(value: unknown): value is BlockFace {
  return value === "down" || value === "up" || value === "north" || value === "south" || value === "west" || value === "east";
}

function validFaceMetadata(metadata: ResolvedBlockFace, resourceId: string): boolean {
  if (!metadata || typeof metadata !== "object" || metadata.texture !== resourceId) return false;
  if (metadata.rotation !== 0 && metadata.rotation !== 90 && metadata.rotation !== 180 && metadata.rotation !== 270) return false;
  if (metadata.tintIndex !== undefined && (!Number.isSafeInteger(metadata.tintIndex) || metadata.tintIndex < 0 || metadata.tintIndex > 255)) return false;
  if (metadata.forceTranslucent !== undefined && typeof metadata.forceTranslucent !== "boolean") return false;
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

function planAtlasPages(plans: readonly AtlasTexturePlan[], limits: TextureAtlasLimits): PlannedAtlasPage[] {
  const pages: PlannedAtlasPage[] = [];
  const sizes = [...new Set(plans.map((plan) => plan.textureSize))].sort((left, right) => left - right);
  for (const textureSize of sizes) {
    const cellSize = textureSize + limits.gutter * 2;
    const cellsPerAxis = Math.floor(limits.maxPageSize / cellSize);
    if (cellsPerAxis < 1) throw new TextureAtlasError("INVALID_LIMITS", `maxPageSize cannot fit one padded ${textureSize}px texture tile.`);
    const pageCapacity = cellsPerAxis * cellsPerAxis;
    let currentTiles: PlannedAtlasTile[] = [];
    const flush = () => {
      if (currentTiles.length === 0) return;
      const columns = Math.min(cellsPerAxis, Math.ceil(Math.sqrt(currentTiles.length)));
      const rows = Math.ceil(currentTiles.length / columns);
      const width = nextPowerOfTwo(columns * cellSize);
      const height = nextPowerOfTwo(rows * cellSize);
      if (width > limits.maxPageSize || height > limits.maxPageSize) {
        throw new TextureAtlasError("ATLAS_TOO_LARGE", `${textureSize}px atlas page exceeds its configured ${limits.maxPageSize}px dimensions.`);
      }
      const pageTextures: AtlasTexturePlan[] = [];
      const pageTextureSet = new Set<AtlasTexturePlan>();
      for (const tile of currentTiles) {
        if (pageTextureSet.has(tile.texture)) continue;
        pageTextureSet.add(tile.texture);
        pageTextures.push(tile.texture);
      }
      const hasAnimatedSequence = pageTextures.some((plan) => (plan.texture.animation?.frames.length ?? 0) > 1);
      let animationLookupBytes = 0;
      if (hasAnimatedSequence) {
        let greatestReferencedTile = -1;
        for (const texture of pageTextures) {
          const animation = texture.texture.animation;
          const referencedFrames = animation && animation.frames.length > 1
            ? [animation.frames[0]!.index, ...animation.frames.map((frame) => frame.index)]
            : [animation?.frames[0]?.index ?? 0];
          for (const sourceFrame of referencedFrames) {
            const tileIndex = currentTiles.find((tile) => tile.texture === texture && tile.sourceFrame === sourceFrame)?.pageTextureIndex;
            if (tileIndex !== undefined) greatestReferencedTile = Math.max(greatestReferencedTile, tileIndex);
          }
        }
        const lookupTileCount = greatestReferencedTile + 1;
        if (lookupTileCount > 0) {
          const lookupWidth = Math.min(limits.maxPageSize, lookupTileCount);
          const lookupHeight = Math.ceil(lookupTileCount / lookupWidth);
          animationLookupBytes = lookupWidth * lookupHeight * 8;
        }
      }
      pages.push({
        index: pages.length,
        textureSize,
        cellSize,
        columns,
        rows,
        width,
        height,
        rgbaBytes: width * height * 4,
        mipmapBytes: mipmapRgbaByteCount(width, height, safeMipLevels(limits.gutter)),
        animationLookupBytes,
        tiles: currentTiles,
        textures: pageTextures,
      });
      currentTiles = [];
    };

    for (const plan of plans) {
      if (plan.textureSize !== textureSize) continue;
      const frameCount = plan.layout.sourceFrameCount;
      if (frameCount > pageCapacity) {
        throw new TextureAtlasError(
          "ATLAS_TOO_LARGE",
          `${plan.texture.resourceId}: animation has ${frameCount} source tiles; one ${textureSize}px page fits ${pageCapacity} tiles (${cellsPerAxis}x${cellsPerAxis}).`,
          plan.texture.resourceId,
        );
      }
      if (currentTiles.length > 0 && currentTiles.length + frameCount > pageCapacity) flush();
      for (let sourceFrame = 0; sourceFrame < frameCount; sourceFrame += 1) {
        currentTiles.push({ texture: plan, sourceFrame, pageTextureIndex: currentTiles.length });
      }
    }
    flush();
  }
  return pages;
}

function emptyMemoryEstimate(limits: TextureAtlasLimits): TextureAtlasMemoryEstimate {
  return {
    limitBytes: limits.maxDecodedBytes,
    reservedAtlasBytes: limits.reservedAtlasBytes,
    additionalWorkingSetBytes: limits.additionalWorkingSetBytes,
    sourcePngBytes: 0,
    sourceRgbaBytes: 0,
    decoderWorkingSetBytes: 0,
    normalizationBytes: 0,
    pageRgbaBytes: 0,
    mipmapRgbaBytes: 0,
    animationLookupRgbaBytes: 0,
    estimatedGpuBytes: 0,
    estimatedPeakBytes: limits.reservedAtlasBytes + limits.additionalWorkingSetBytes,
  };
}

function mipmapRgbaByteCount(width: number, height: number, safeLevels: number): number {
  let bytes = 0;
  let mipWidth = width;
  let mipHeight = height;
  const levelCount = Math.max(0, Math.min(safeLevels, Math.floor(Math.log2(Math.max(1, Math.min(width, height))))));
  for (let level = 0; level < levelCount; level += 1) {
    mipWidth = Math.max(1, Math.floor(mipWidth / 2));
    mipHeight = Math.max(1, Math.floor(mipHeight / 2));
    bytes += mipWidth * mipHeight * 4;
  }
  return bytes;
}

function blitSourceFrameWithGutter(
  target: Uint8Array,
  targetWidth: number,
  source: Uint8Array,
  sourceWidth: number,
  layout: AtlasFrameLayout,
  frameIndex: number,
  x: number,
  y: number,
  gutter: number,
): void {
  const frameColumn = frameIndex % layout.sourceColumns;
  const frameRow = Math.floor(frameIndex / layout.sourceColumns);
  for (let dy = -gutter; dy < layout.frameHeight + gutter; dy += 1) {
    for (let dx = -gutter; dx < layout.frameWidth + gutter; dx += 1) {
      const sourceX = frameColumn * layout.frameWidth + Math.max(0, Math.min(layout.frameWidth - 1, dx));
      const sourceY = frameRow * layout.frameHeight + Math.max(0, Math.min(layout.frameHeight - 1, dy));
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const targetOffset = ((y + dy) * targetWidth + x + dx) * 4;
      target.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
}

interface AtlasFrameLayout {
  frameWidth: ResourcePackTextureSize;
  frameHeight: ResourcePackTextureSize;
  sourceColumns: number;
  sourceRows: number;
  sourceFrameCount: number;
}

function validateAtlasAnimation(animation: ResourcePackTextureAnimation | undefined, sheetWidth: number, sheetHeight: number): AtlasFrameLayout {
  if (animation === undefined) {
    if (!isTextureSize(sheetWidth) || sheetHeight !== sheetWidth) throw new Error("Animation metadata is required for a non-square 16px/32px/64px/128px/256px texture.");
    return { frameWidth: sheetWidth, frameHeight: sheetWidth, sourceColumns: 1, sourceRows: 1, sourceFrameCount: 1 };
  }
  const sourceColumns = animation.sourceColumns ?? sheetWidth / animation.frameWidth;
  const sourceRows = animation.sourceRows ?? sheetHeight / animation.frameHeight;
  if (
    !isTextureSize(animation.frameWidth)
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

function isTextureSize(value: number): value is ResourcePackTextureSize {
  return value === 16 || value === 32 || value === 64 || value === 128 || value === 256;
}

function validateLimits(limits: TextureAtlasLimits): TextureAtlasLimits {
  for (const [key, value] of Object.entries(limits)) {
    const allowsZero = key === "reservedAtlasBytes" || key === "additionalWorkingSetBytes";
    if (!Number.isSafeInteger(value) || (allowsZero ? value < 0 : value <= 0)) {
      throw new TextureAtlasError("INVALID_LIMITS", `${key} must be a ${allowsZero ? "non-negative" : "positive"} safe integer.`);
    }
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
