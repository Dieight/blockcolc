import type {
  ResourcePackCompatibilityIssue,
  ResourcePackManifest,
} from "./index";

/**
 * Combines two already-parsed schema-v1 manifests in Minecraft pack priority
 * order: `overlay` wins on duplicate resource IDs, while absent IDs inherit
 * from `base`. The function does not mutate either input.
 *
 * Entry arrays are bounded by the parser's per-pack ZIP limits. The merge is
 * linear in the input entries plus a deterministic sort of the effective IDs.
 */
export function layerResourcePackManifests(
  base: ResourcePackManifest,
  overlay: ResourcePackManifest,
): ResourcePackManifest {
  const textures = mergeByResourceId(base.textures, overlay.textures);
  const specialTextures = mergeByResourceId(base.specialTextures ?? [], overlay.specialTextures ?? []);
  const blockStates = mergeByResourceId(base.blockStates, overlay.blockStates);
  const models = mergeByResourceId(base.models, overlay.models);
  const colormaps = mergeByResourceId(base.colormaps ?? [], overlay.colormaps ?? []);

  return {
    schemaVersion: 1,
    // The top layer supplies the active pack's compatibility metadata.
    pack: overlay.pack,
    textures,
    ...(specialTextures.length === 0 ? {} : { specialTextures }),
    ...(colormaps.length === 0 ? {} : { colormaps }),
    blockStates,
    models,
    summary: {
      // Counts describe the two source archives together; accepted assets in
      // both layers remain counted even when the upper layer replaces one.
      archiveFileCount: base.summary.archiveFileCount + overlay.summary.archiveFileCount,
      candidateTextureCount: base.summary.candidateTextureCount + overlay.summary.candidateTextureCount,
      acceptedTextureCount: base.summary.acceptedTextureCount + overlay.summary.acceptedTextureCount,
      rejectedTextureCount: base.summary.rejectedTextureCount + overlay.summary.rejectedTextureCount,
      ignoredFileCount: base.summary.ignoredFileCount + overlay.summary.ignoredFileCount,
      namespaces: sortedUnique([...textures, ...specialTextures].map((texture) => texture.namespace)),
      issues: sortIssues([
        ...withSource(base.summary.issues, "Base pack"),
        ...withSource(overlay.summary.issues, "Overlay pack"),
      ]),
    },
  };
}

function mergeByResourceId<T extends { resourceId: string }>(
  base: readonly T[],
  overlay: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const entry of base) byId.set(entry.resourceId, entry);
  for (const entry of overlay) byId.set(entry.resourceId, entry);
  return [...byId.values()].sort((left, right) => compareText(left.resourceId, right.resourceId));
}

function withSource(
  issues: readonly ResourcePackCompatibilityIssue[],
  source: "Base pack" | "Overlay pack",
): ResourcePackCompatibilityIssue[] {
  return issues.map((entry) => ({
    ...entry,
    message: `${source}: ${entry.message}`,
  }));
}

function sortIssues(issues: ResourcePackCompatibilityIssue[]): ResourcePackCompatibilityIssue[] {
  return issues.sort((left, right) =>
    compareText(left.path, right.path)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message),
  );
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
