import { decodePngRgba } from "./png";

/** Bounded assets consumed by special block/entity renderers, outside the cube atlas. */
export interface ResourcePackSpecialTexture {
  resourceId: string;
  namespace: string;
  /** Path below textures/entity, without the `.png` suffix. */
  texturePath: string;
  archivePath: string;
  width: number;
  height: number;
  png: Uint8Array;
}

export type ResourcePackSpecialTextureIssueCode =
  | "INVALID_SPECIAL_TEXTURE_PATH"
  | "INVALID_SPECIAL_TEXTURE_PNG"
  | "SPECIAL_TEXTURE_LIMIT_EXCEEDED"
  | "SPECIAL_TEXTURE_PIXEL_LIMIT_EXCEEDED";

export interface ResourcePackSpecialTextureIssue {
  path: string;
  code: ResourcePackSpecialTextureIssueCode;
  message: string;
}

export interface ParsedResourcePackSpecialTextures {
  textures: ResourcePackSpecialTexture[];
  issues: ResourcePackSpecialTextureIssue[];
  recognizedPaths: string[];
  candidateCount: number;
}

/**
 * The parser only admits textures used by the supported Java special renderers.
 * They intentionally remain separate from `textures`, which feeds the block atlas.
 */
export const RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS = Object.freeze({
  maxTextureCount: 512,
  maxPngBytes: 4 * 1024 * 1024,
  maxTotalPngBytes: 16 * 1024 * 1024,
  maxDimension: 1024,
  maxPixelsPerTexture: 1_048_576,
  maxTotalPixels: 4_194_304,
});

const namespacePattern = /^[a-z0-9_.-]+$/;
const resourcePathPattern = /^[a-z0-9._/-]+$/;
const entityPngPattern = /^assets\/([^/]+)\/textures\/entity\/(.+)\.png$/;

const entityRoots = new Set([
  "banner",
  "chest",
  "conduit",
  "copper_golem",
  "creeper",
  "decorated_pot",
  "end_portal",
  "enderdragon",
  "piglin",
  "shulker",
  "skeleton",
  "zombie",
]);

/** True for a supported special-renderer subtree, not arbitrary entity textures. */
export function isAllowedSpecialTexturePath(path: string): boolean {
  if (!isSafeTexturePath(path)) return false;
  const segments = path.split("/");
  const root = segments[0];
  if (root === "player") return segments.length === 3 && (segments[1] === "wide" || segments[1] === "slim");
  return root !== undefined && entityRoots.has(root);
}

/** Strictly decodes a stored special texture under the same bounds as import. */
export function decodeResourcePackSpecialTexture(texture: ResourcePackSpecialTexture): Uint8Array {
  return decodePngRgba(texture.png, {
    expectedWidth: texture.width,
    expectedHeight: texture.height,
    maxWidth: RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxDimension,
    maxHeight: RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxDimension,
    maxPixels: RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxPixelsPerTexture,
    maxDecodedBytes: RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxPixelsPerTexture * 4,
  }).rgba;
}

/**
 * Parses only whitelisted textures/entity PNGs. Each PNG is fully decoded once
 * during admission to validate its stream and enforce aggregate decoded-pixel
 * limits; only the compressed PNG is retained in the schema-v1 manifest.
 */
export function parseResourcePackSpecialTextures(
  files: Readonly<Record<string, Uint8Array>>,
  archivePaths: readonly string[],
  maxSingleFileBytes = RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxPngBytes,
): ParsedResourcePackSpecialTextures {
  const candidates = archivePaths.filter((path) => {
    const match = entityPngPattern.exec(path);
    return match !== null && isAllowedSpecialTexturePath(match[2] ?? "");
  }).sort(compareText);
  const textures: ResourcePackSpecialTexture[] = [];
  const issues: ResourcePackSpecialTextureIssue[] = [];
  let totalPngBytes = 0;
  let totalPixels = 0;

  for (const archivePath of candidates) {
    if (textures.length >= RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxTextureCount) {
      issues.push({
        path: archivePath,
        code: "SPECIAL_TEXTURE_LIMIT_EXCEEDED",
        message: `Special texture count exceeds ${RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxTextureCount}; remaining special textures were skipped.`,
      });
      break;
    }
    const match = entityPngPattern.exec(archivePath);
    if (!match) continue;
    const namespace = match[1] ?? "";
    const texturePath = match[2] ?? "";
    if (namespace.length > 128 || !namespacePattern.test(namespace) || !isSafeTexturePath(texturePath)) {
      issues.push({ path: archivePath, code: "INVALID_SPECIAL_TEXTURE_PATH", message: "Invalid namespace or entity texture path." });
      continue;
    }
    const png = files[archivePath];
    if (!png || png.byteLength === 0 || png.byteLength > Math.min(maxSingleFileBytes, RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxPngBytes)) {
      issues.push({
        path: archivePath,
        code: "INVALID_SPECIAL_TEXTURE_PNG",
        message: `Special texture is missing, empty, or exceeds the ${Math.min(maxSingleFileBytes, RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxPngBytes)} byte PNG limit.`,
      });
      continue;
    }
    if (png.byteLength + totalPngBytes > RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxTotalPngBytes) {
      issues.push({
        path: archivePath,
        code: "SPECIAL_TEXTURE_LIMIT_EXCEEDED",
        message: `Special texture PNG bytes exceed ${RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxTotalPngBytes}; remaining special textures were skipped.`,
      });
      break;
    }
    try {
      const decoded = decodePngRgba(png, {
        maxWidth: RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxDimension,
        maxHeight: RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxDimension,
        maxPixels: RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxPixelsPerTexture,
        maxDecodedBytes: RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxPixelsPerTexture * 4,
      });
      const pixels = decoded.width * decoded.height;
      if (pixels + totalPixels > RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxTotalPixels) {
        issues.push({
          path: archivePath,
          code: "SPECIAL_TEXTURE_PIXEL_LIMIT_EXCEEDED",
          message: `Decoded special texture pixels exceed ${RESOURCE_PACK_SPECIAL_TEXTURE_LIMITS.maxTotalPixels}; remaining special textures were skipped.`,
        });
        break;
      }
      const resourceId = `${namespace}:entity/${texturePath}`;
      textures.push({
        resourceId,
        namespace,
        texturePath,
        archivePath,
        width: decoded.width,
        height: decoded.height,
        png,
      });
      totalPngBytes += png.byteLength;
      totalPixels += pixels;
    } catch (cause) {
      issues.push({
        path: archivePath,
        code: "INVALID_SPECIAL_TEXTURE_PNG",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return {
    textures,
    issues,
    recognizedPaths: candidates,
    candidateCount: candidates.length,
  };
}

function isSafeTexturePath(path: string): boolean {
  return path.length <= 256
    && resourcePathPattern.test(path)
    && !path.startsWith("/")
    && !path.endsWith("/")
    && !path.includes("//")
    && !path.split("/").some((segment) => segment === "." || segment === "..");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
