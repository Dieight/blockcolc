/**
 * Read-only diagnostic for a user-supplied Java resource-pack ZIP. Never copies
 * or emits texture/model payloads; the JSON report contains only counts and IDs.
 * Run with: node_modules/.bin/vite-node --script tools/audit-resource-pack.ts <zip> [owned-26.3-client.jar]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  buildJava16xTextureAtlas,
  layerResourcePackManifests,
  mapBlockGeometryToAtlas,
  mapBlockTexturesToAtlas,
  parseJava16xResourcePack,
  resolveBlockGeometry,
  resolveBlockTextures,
  type BlockTextureFallbackReason,
} from "../packages/resource-pack/src/index";

const archivePath = process.argv[2];
const baseArchivePath = process.argv[3];
if (!archivePath) {
  process.stderr.write("Usage: audit-resource-pack.ts <resource-pack.zip> [owned-26.3-client.jar]\n");
  process.exitCode = 2;
} else {
  const archive = readFileSync(archivePath);
  const overlay = parseJava16xResourcePack(archive, {
    maxInputBytes: 128 * 1024 * 1024,
    maxFileCount: 32_768,
    maxSingleFileBytes: 16 * 1024 * 1024,
    maxTotalUncompressedBytes: 256 * 1024 * 1024,
  });
  const baseArchive = baseArchivePath ? readFileSync(baseArchivePath) : undefined;
  const manifest = baseArchive
    ? layerResourcePackManifests(parseJava16xResourcePack(baseArchive), overlay)
    : overlay;
  const parseIssues = countBy(manifest.summary.issues.map((issue) => issue.code));
  let atlas: ReturnType<typeof buildJava16xTextureAtlas> | undefined;
  let atlasError: string | undefined;
  try {
    atlas = buildJava16xTextureAtlas(manifest);
  } catch (cause) {
    atlasError = cause instanceof Error ? cause.message : String(cause);
  }
  const geometryFallbacks: BlockTextureFallbackReason[] = [];
  const textureFallbacks: BlockTextureFallbackReason[] = [];
  const unresolvedGeometryBlockIds = new Set<string>();
  const examples: Array<{
    blockId: string;
    state: Record<string, string>;
    geometry: string;
    geometryTarget?: string;
    texture: string;
    textureTarget?: string;
  }> = [];
  let checkedVariants = 0;
  let modelResolvedVariants = 0;
  let atlasMappableVariants = 0;
  for (const blockState of manifest.blockStates) {
    // Variant entries are exact state examples. Multipart coverage needs a
    // separate registry of concrete states, so we do not invent one here.
    for (const variant of blockState.variants) {
      const state = variant.conditions;
      const geometry = resolveBlockGeometry(manifest, blockState.resourceId, state);
      const texture = resolveBlockTextures(manifest, blockState.resourceId, state);
      checkedVariants += 1;
      if (geometry.status === "fallback") {
        geometryFallbacks.push(geometry.reason);
        unresolvedGeometryBlockIds.add(blockState.resourceId);
      }
      if (texture.status === "fallback") textureFallbacks.push(texture.reason);
      if (geometry.status !== "fallback" || texture.status !== "fallback") modelResolvedVariants += 1;
      if (atlas && (
        (geometry.status !== "fallback" && mapBlockGeometryToAtlas(geometry, atlas).status === "resolved_geometry") ||
        (texture.status !== "fallback" && mapBlockTexturesToAtlas(texture, atlas).status === "resolved")
      )) atlasMappableVariants += 1;
      if ((geometry.status === "fallback" || texture.status === "fallback") && examples.length < 50) {
        examples.push({
          blockId: blockState.resourceId,
          state,
          geometry: geometry.status === "fallback" ? geometry.reason : geometry.status,
          ...(geometry.status === "fallback" && geometry.resourceId ? { geometryTarget: geometry.resourceId } : {}),
          texture: texture.status === "fallback" ? texture.reason : texture.status,
          ...(texture.status === "fallback" && texture.resourceId ? { textureTarget: texture.resourceId } : {}),
        });
      }
    }
  }
  const format = manifest.pack;
  const supports263 = format.minFormat && format.maxFormat
    ? compareFormat(format.minFormat, [97, 1]) <= 0 && compareFormat(format.maxFormat, [97, 1]) >= 0
    : format.packFormat === 97;
  process.stdout.write(`${JSON.stringify({
    archive: basename(archivePath),
    archiveBytes: archive.byteLength,
    ...(baseArchivePath && baseArchive ? { baseArchive: basename(baseArchivePath), baseArchiveBytes: baseArchive.byteLength } : {}),
    declaredFormat: {
      packFormat: format.packFormat,
      minFormat: format.minFormat ?? null,
      maxFormat: format.maxFormat ?? null,
      includesJava263: supports263,
    },
    assets: {
      blockTextures: manifest.textures.length,
      blockstates: manifest.blockStates.length,
      models: manifest.models.length,
      multipartBlockstatesNotMeasured: manifest.blockStates.filter((block) => block.multipart).length,
    },
    parseIssues,
    parseIssueExamples: manifest.summary.issues.slice(0, 30),
    atlas: atlas
      ? { pages: atlas.pages.length, tiles: atlas.entries.length, error: null }
      : { pages: 0, tiles: 0, error: atlasError ?? null },
    checkedVariants,
    modelResolvedVariants,
    atlasMappableVariants,
    geometryFallbacks: countBy(geometryFallbacks),
    unresolvedGeometryBlockIds: [...unresolvedGeometryBlockIds],
    textureFallbacks: countBy(textureFallbacks),
    examples,
    note: "Variant coverage is restricted to state signatures declared by this pack; atlas mapping does not imply Minecraft registry coverage or successful GPU rendering.",
  }, null, 2)}\n`);
}

function compareFormat(left: readonly number[], right: readonly number[]): number {
  return left[0]! - right[0]! || left[1]! - right[1]!;
}

function countBy(values: readonly string[]): Record<string, number> {
  return Object.fromEntries(
    [...values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string, number>())]
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
