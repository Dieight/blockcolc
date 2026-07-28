import {
  resolveBlockGeometry,
  resolveBlockTextures,
  isSupportedBlockGeometry,
  type BlockFace,
  type BlockTextureFallbackReason,
  type BlockTextureManifest,
} from "./block-models";

export interface CompatibilityBlueprint {
  id: string;
  voxels: ReadonlyArray<{
    sourceBlockId?: string;
    sourceBlockState?: Readonly<Record<string, string>>;
  }>;
}

export type CompatibilityStatus = "supported" | "missing" | "unsupported" | "not-evaluated";

export interface CompatibilityDimension {
  status: CompatibilityStatus;
  detail?: string;
}

export interface CompatibilityCounts {
  supported: number;
  missing: number;
  unsupported: number;
  notEvaluated: number;
}

export type BlueprintFallbackReason =
  | "MISSING_SOURCE_BLOCK_ID"
  | "UNKNOWN_BLOCK_ID"
  | "MISSING_SOURCE_BLOCK_STATE"
  | BlockTextureFallbackReason;

export interface BlockCompatibilityGroup {
  key: string;
  sourceBlockId: string | null;
  sourceBlockState: Readonly<Record<string, string>>;
  voxelCount: number;
  id: CompatibilityDimension;
  state: CompatibilityDimension;
  model: CompatibilityDimension & { modelId?: string };
  texture: CompatibilityDimension & { faces?: Record<BlockFace, string>; geometryFaceCount?: number };
  render: "resource-pack" | "original-fallback";
  fallbackReason?: BlueprintFallbackReason;
}

export interface BlueprintCompatibilitySummary {
  blueprintId: string;
  totalVoxelCount: number;
  uniqueBlockSignatureCount: number;
  texturedVoxelCount: number;
  fallbackVoxelCount: number;
  dimensions: {
    id: CompatibilityCounts;
    state: CompatibilityCounts;
    model: CompatibilityCounts;
    texture: CompatibilityCounts;
  };
  fallbackReasons: Array<{
    reason: BlueprintFallbackReason;
    voxelCount: number;
    signatureCount: number;
  }>;
  blocks: BlockCompatibilityGroup[];
}

interface PendingGroup {
  sourceBlockId: string | null;
  sourceBlockState: Readonly<Record<string, string>>;
  voxelCount: number;
}

export function summarizeBlueprintCompatibility(
  blueprint: CompatibilityBlueprint,
  manifest: BlockTextureManifest,
): BlueprintCompatibilitySummary {
  const grouped = new Map<string, PendingGroup>();
  for (const voxel of blueprint.voxels) {
    const sourceBlockId = normalizeSourceBlockId(voxel.sourceBlockId);
    const sourceBlockState = normalizeSourceBlockState(voxel.sourceBlockState);
    const key = signatureKey(sourceBlockId, sourceBlockState);
    const existing = grouped.get(key);
    if (existing) existing.voxelCount += 1;
    else grouped.set(key, { sourceBlockId, sourceBlockState, voxelCount: 1 });
  }

  const blocks = [...grouped.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, group]) => resolveGroup(key, group, manifest));
  const dimensions = {
    id: emptyCounts(),
    state: emptyCounts(),
    model: emptyCounts(),
    texture: emptyCounts(),
  };
  const reasons = new Map<BlueprintFallbackReason, { voxelCount: number; signatureCount: number }>();
  let texturedVoxelCount = 0;
  for (const block of blocks) {
    addCount(dimensions.id, block.id.status, block.voxelCount);
    addCount(dimensions.state, block.state.status, block.voxelCount);
    addCount(dimensions.model, block.model.status, block.voxelCount);
    addCount(dimensions.texture, block.texture.status, block.voxelCount);
    if (block.render === "resource-pack") texturedVoxelCount += block.voxelCount;
    if (block.fallbackReason) {
      const current = reasons.get(block.fallbackReason) ?? { voxelCount: 0, signatureCount: 0 };
      current.voxelCount += block.voxelCount;
      current.signatureCount += 1;
      reasons.set(block.fallbackReason, current);
    }
  }
  const totalVoxelCount = blueprint.voxels.length;
  return {
    blueprintId: blueprint.id,
    totalVoxelCount,
    uniqueBlockSignatureCount: blocks.length,
    texturedVoxelCount,
    fallbackVoxelCount: totalVoxelCount - texturedVoxelCount,
    dimensions,
    fallbackReasons: [...reasons.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([reason, counts]) => ({ reason, ...counts })),
    blocks,
  };
}

function resolveGroup(key: string, group: PendingGroup, manifest: BlockTextureManifest): BlockCompatibilityGroup {
  const notEvaluated = (): CompatibilityDimension => ({ status: "not-evaluated" });
  if (group.sourceBlockId === null) {
    return {
      key,
      ...group,
      id: { status: "missing", detail: "sourceBlockId is absent" },
      state: notEvaluated(), model: notEvaluated(), texture: notEvaluated(),
      render: "original-fallback",
      fallbackReason: "MISSING_SOURCE_BLOCK_ID",
    };
  }
  const blockState = manifest.blockStates.find((candidate) => candidate.resourceId === group.sourceBlockId);
  if (!blockState) {
    return {
      key,
      ...group,
      id: { status: "missing", detail: "resource pack has no matching blockstate" },
      state: notEvaluated(), model: notEvaluated(), texture: notEvaluated(),
      render: "original-fallback",
      fallbackReason: "UNKNOWN_BLOCK_ID",
    };
  }

  const geometryEligible = isSupportedBlockGeometry(group.sourceBlockId, group.sourceBlockState);
  const resolved = geometryEligible
    ? resolveBlockGeometry(manifest, group.sourceBlockId, group.sourceBlockState)
    : resolveBlockTextures(manifest, group.sourceBlockId, group.sourceBlockState);
  if (resolved.status === "resolved") {
    return {
      key,
      ...group,
      id: { status: "supported" },
      state: { status: "supported", detail: stateIsRequired(blockState) ? "matching variant" : "default variant" },
      model: { status: "supported", modelId: resolved.modelId },
      texture: { status: "supported", faces: { ...resolved.faces } },
      render: "resource-pack",
    };
  }
  if (resolved.status === "resolved_geometry") {
    const geometryFaceCount = resolved.elements.reduce((sum, element) => sum + Object.keys(element.faces).length, 0);
    return {
      key,
      ...group,
      id: { status: "supported" },
      state: { status: "supported", detail: stateIsRequired(blockState) ? "matching variant" : "default variant" },
      model: { status: "supported", modelId: resolved.modelId, detail: "axis-aligned geometry" },
      texture: { status: "supported", detail: `${geometryFaceCount} declared geometry faces`, geometryFaceCount },
      render: "resource-pack",
    };
  }

  const missingState = resolved.reason === "NO_MATCHING_VARIANT"
    && Object.keys(group.sourceBlockState).length === 0
    && stateIsRequired(blockState);
  const fallbackReason: BlueprintFallbackReason = missingState ? "MISSING_SOURCE_BLOCK_STATE" : resolved.reason;
  const state = stateDimension(resolved.reason, missingState);
  const model = modelDimension(resolved.reason);
  const texture = textureDimension(resolved.reason);
  return {
    key,
    ...group,
    id: { status: "supported" },
    state,
    model,
    texture,
    render: "original-fallback",
    fallbackReason,
  };
}

function stateDimension(reason: BlockTextureFallbackReason, missingState: boolean): CompatibilityDimension {
  if (reason === "NO_MATCHING_VARIANT") {
    return missingState
      ? { status: "missing", detail: "blueprint has no source block state" }
      : { status: "unsupported", detail: reason };
  }
  return { status: "supported" };
}

function modelDimension(reason: BlockTextureFallbackReason): CompatibilityDimension {
  switch (reason) {
    case "NO_MATCHING_VARIANT":
    case "UNKNOWN_BLOCKSTATE":
      return { status: "not-evaluated" };
    case "MISSING_MODEL":
      return { status: "missing", detail: reason };
    case "MODEL_REFERENCE_CYCLE":
    case "COMPLEX_GEOMETRY":
    case "MISSING_FACE":
    case "UNSUPPORTED_MULTIPART":
    case "INVALID_MULTIPART":
    case "GEOMETRY_LIMIT_EXCEEDED":
      return { status: "unsupported", detail: reason };
    default:
      return { status: "supported" };
  }
}

function textureDimension(reason: BlockTextureFallbackReason): CompatibilityDimension {
  switch (reason) {
    case "MISSING_TEXTURE":
    case "MISSING_TEXTURE_VARIABLE":
      return { status: "missing", detail: reason };
    case "TEXTURE_REFERENCE_CYCLE":
      return { status: "unsupported", detail: reason };
    default:
      return { status: "not-evaluated" };
  }
}

function stateIsRequired(blockState: BlockTextureManifest["blockStates"][number]): boolean {
  if (blockState.multipart) {
    return blockState.multipart.some((part) => part.when.clauses.some((clause) => Object.keys(clause).length > 0));
  }
  return !blockState.variants.some((variant) => Object.keys(variant.conditions).length === 0);
}

function normalizeSourceBlockId(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeSourceBlockState(value: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareText(left, right)));
}

function signatureKey(sourceBlockId: string | null, state: Readonly<Record<string, string>>): string {
  return `${sourceBlockId ?? "<missing>"}[${Object.entries(state).map(([key, value]) => `${key}=${value}`).join(",")}]`;
}

function emptyCounts(): CompatibilityCounts {
  return { supported: 0, missing: 0, unsupported: 0, notEvaluated: 0 };
}

function addCount(counts: CompatibilityCounts, status: CompatibilityStatus, amount: number): void {
  if (status === "not-evaluated") counts.notEvaluated += amount;
  else counts[status] += amount;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
