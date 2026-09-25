/**
 * Read-only Minecraft Java 26.3 model/texture coverage audit.
 *
 * The client JAR and the generated blocks.json are local inputs only. This
 * report contains IDs and counts, never copies any Minecraft asset bytes.
 * Reproduction instructions are printed by `--help`.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import {
  buildJava16xTextureAtlas,
  mapBlockGeometryToAtlas,
  mapBlockTexturesToAtlas,
  parseJava16xResourcePack,
  resolveBlockGeometry,
  resolveBlockTextures,
  type ResourcePackManifest,
} from "../packages/resource-pack/src/index";
import {
  buildResourcePackAtlas,
  faceTintKind,
  NO_FACE_TINT,
  planTexturedVoxelPages,
  type ResourcePackAtlas,
} from "../packages/voxel/src/resource-textures";
import { planGeometryVoxelPages } from "../packages/voxel/src/resource-geometry";
import type { BlueprintVoxel } from "../packages/voxel/src/blueprint";
import * as THREE from "three";
import { isVisuallyEmptyVanillaBlock } from "../packages/voxel/src/resource-empty-blocks";
import { planResourceFluidBatches, planResourceWaterloggedFluidBatches } from "../packages/voxel/src/resource-fluids";
import { addResourceSpecialBoxes } from "../packages/voxel/src/resource-special-boxes";
import { addResourceSpecialDecor } from "../packages/voxel/src/resource-special-decor";
import { addResourceSpecialFigures } from "../packages/voxel/src/resource-special-figures";
import { addResourceSpecialPortals } from "../packages/voxel/src/resource-special-portals";

export const MC263_CLIENT_JAR_SHA1 = "e877b6a07acd633fb3bb475002175cec036e7b87";
export const MC263_SERVER_JAR_SHA1 = "33680f5f2ac32864d6d7cf5e56a705fdb3e05f4c";
export const MC263_BLOCKS_REPORT_SHA256 = "7a0de8aaf7b04d00c40b8ffdc4cfe75184cff2e821d336a020573201867105a4";
export const MC263_SERVER_JAR_URL = "https://piston-data.mojang.com/v1/objects/33680f5f2ac32864d6d7cf5e56a705fdb3e05f4c/server.jar";

const NON_RENDERING_BLOCK_IDS = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
]);
const FACE_NAMES = ["down", "up", "north", "south", "west", "east"] as const;

export interface RegistryState {
  blockId: string;
  stateId: number;
  isDefault: boolean;
  properties: Record<string, string>;
}

export interface MinecraftBlockRegistry {
  blockCount: number;
  stateCount: number;
  blocks: Array<{ blockId: string; stateCount: number }>;
  states: RegistryState[];
}

export type RuntimeRoute = "textured_cube" | "model_geometry" | "fallback" | "not_evaluated" | "intentionally_empty";

export interface StateCoverageRecord {
  blockId: string;
  stateId: number;
  isDefault: boolean;
  properties: Record<string, string>;
  definition: "variants" | "multipart" | "missing";
  modelShape: "full_cube" | "non_cube" | "unresolved" | "not_applicable";
  route: RuntimeRoute;
  fallbackReason?: string;
  geometryFallbackReason?: string;
  geometryFallbackResourceId?: string;
  resolvedModelId?: string;
  unsupportedTintFaces?: number;
  unappliedTintFaces?: number;
  unsupportedTintProviders?: UnsupportedTintProviderReference[];
  tintKinds?: Record<string, number>;
}

export interface UnsupportedTintProviderReference {
  type: string;
  tintIndex: number;
  faceNames: string[];
}

export interface FallbackDiagnostic {
  reason: string;
  fallbackStateCount: number;
  uniqueBlockCount: number;
  unsupportedTintFaceCount?: number;
  tintProviderTypes?: string[];
  suggestedRemediation: string;
  blocks: Array<{
    blockId: string;
    fallbackStateCount: number;
    unsupportedTintFaceCount?: number;
    tintProviderTypes?: string[];
    representativeStates: Array<{
      stateId: number;
      isDefault: boolean;
      properties: Record<string, string>;
      unsupportedTintFaces?: number;
      unsupportedTintProviders?: UnsupportedTintProviderReference[];
      geometryFallbackReason?: string;
      geometryFallbackResourceId?: string;
      resolvedModelId?: string;
    }>;
  }>;
}

export interface Mc263CoverageReport {
  schemaVersion: 1;
  target: { edition: "Minecraft Java Edition"; version: "26.3"; resourcePackFormat: "97.1" };
  source: {
    clientJarSha1: string;
    clientJarBytes: number;
    serverJarSha1: string;
    blocksReportSha256: string;
    officialServerJarUrl: string;
    blocksReportBlockCount: number;
    blocksReportStateCount: number;
  };
  assets: {
    archiveEntries: number;
    blockStateFiles: number;
    parsedBlockStateFiles: number;
    parsedModels: number;
    candidateBlockTextures: number;
    acceptedBlockTextures: number;
    rejectedBlockTextures: number;
    colormaps: string[];
    parseIssuesByCode: Record<string, number>;
    parseIssueExamples: Array<{ path: string; code: string; message: string }>;
  };
  atlas: {
    status: "ready" | "failed";
    pages: number;
    tiles: number;
    alphaModes: Record<string, number>;
    animatedTiles: number;
    error?: string;
  };
  coverage: {
    blocks: number;
    exactBlockStates: number;
    intentionallyEmptyStates: number;
    blockStatesWithDefinition: number;
    exactStatesWithDefinition: number;
    exactStatesUsingMultipart: number;
    exactStatesUsingVariants: number;
    exactStatesWithResolvedModel: number;
    exactStatesWithAtlasMappedGeometry: number;
    runtimeTexturedCubeStates: number;
    runtimeModelGeometryStates: number;
    runtimeFallbackStates: number;
    runtimeNotEvaluatedStates: number;
    routesByFallbackReason: Record<string, number>;
    fallbackDiagnostics: FallbackDiagnostic[];
    geometryResolutionByReason: Record<string, number>;
    modelShape: { fullCubeStates: number; nonCubeStates: number; unresolvedStates: number };
    texturedCubeRouteShapeMismatchStates: number;
    color: {
      colormapSourcesPresent: string[];
      tintedFaces: number;
      supportedTintFaces: number;
      unappliedTintFaces: number;
      unsupportedTintFaces: number;
      tintKindsByFace: Record<string, number>;
      runtimeClimate: { temperature: 0.8; downfall: 0.4 };
      exactVanillaColorParity: "not_compared";
    };
    visualFaceReferences: {
      count: number;
      alphaModes: Record<string, number>;
      animated: number;
    };
    /**
     * Supplemental routes after the legacy block-model planners. These are an
     * additive audit of the same fallback states, not changes to the planner's
     * original route counts above. Category totals are mutually exclusive.
    */
    postPlanner: PostPlannerCoverage;
    /** Registry eligibility and a bounded, isolated probe of the water overlay planner. */
    waterlogged: WaterloggedCoverage;
  };
  states: StateCoverageRecord[];
  blocks: Array<{
    blockId: string;
    exactStates: number;
    stateDefinitions: "variants" | "multipart" | "missing";
    texturedCubeStates: number;
    geometryStates: number;
    fallbackStates: number;
    fallbackReasons: Record<string, number>;
    nonCubeStatesRenderedAsTexturedCube: number;
  }>;
  interpretation: string[];
}

export interface PostPlannerCoverage {
  plannerFallbackStates: number;
  special: {
    states: number;
    blocks: string[];
    byRenderer: Record<"portals" | "decor" | "boxes" | "figures", { states: number; blocks: string[] }>;
  };
  fluids: { states: number; blocks: string[] };
  intentionallyEmpty: { states: number; blocks: string[] };
  blockEntityDependent: {
    states: number;
    blocks: string[];
    note: string;
  };
  unresolved: { states: number; blocks: string[] };
}

export interface WaterloggedCoverage {
  registry: {
    eligibleStates: number;
    eligibleBlocks: number;
    blockIds: string[];
  };
  isolatedPlannerProbe: {
    inputStates: number;
    inputBlocks: number;
    chunkSize: number;
    chunks: number;
    atlasAvailable: boolean;
    atlasBackedPlanStates: number;
    proceduralFallbackPlanStates: number;
    plannedOverlayStates: number;
    statesWithoutExposedOverlay: number;
    omittedVoxelCount: number;
    fullSceneVisibility: "not_measured";
    visibilityNote: string;
  };
}

export const WATERLOGGED_AUDIT_CHUNK_SIZE = 256;

/**
 * Validate and enumerate the exact block-state records in Mojang's blocks.json.
 * Every concrete state's full property map is taken from the report itself;
 * no cartesian product is fabricated for the coverage run.
 */
export function enumerateMinecraftBlockStates(value: unknown): MinecraftBlockRegistry {
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error("blocks.json must be a non-empty object keyed by block resource ID.");
  const blocks: MinecraftBlockRegistry["blocks"] = [];
  const states: RegistryState[] = [];
  const seenStateIds = new Set<number>();

  for (const blockId of Object.keys(value).sort(compareText)) {
    if (!/^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.test(blockId)) throw new Error(`Invalid block ID in blocks.json: ${blockId}`);
    const rawBlock = value[blockId];
    if (!isRecord(rawBlock) || !Array.isArray(rawBlock.states) || rawBlock.states.length === 0) {
      throw new Error(`Block ${blockId} has no concrete state list.`);
    }
    const propertyDomains = parsePropertyDomains(blockId, rawBlock.properties);
    const expectedStateCount = [...propertyDomains.values()].reduce((product, domain) => product * domain.length, 1);
    if (expectedStateCount !== rawBlock.states.length) {
      throw new Error(`Block ${blockId} reports ${rawBlock.states.length} states but property domains imply ${expectedStateCount}.`);
    }

    const localStateSignatures = new Set<string>();
    let defaultCount = 0;
    for (const [stateIndex, rawState] of rawBlock.states.entries()) {
      if (!isRecord(rawState) || !Number.isSafeInteger(rawState.id) || (rawState.id as number) < 0) {
        throw new Error(`Block ${blockId} state ${stateIndex} has an invalid numeric ID.`);
      }
      const stateId = rawState.id as number;
      if (seenStateIds.has(stateId)) throw new Error(`Duplicate global state ID ${stateId} in blocks.json.`);
      seenStateIds.add(stateId);

      const properties = parseConcreteProperties(blockId, stateIndex, rawState.properties, propertyDomains);
      const signature = canonicalProperties(properties);
      if (localStateSignatures.has(signature)) throw new Error(`Block ${blockId} repeats concrete property state ${signature}.`);
      localStateSignatures.add(signature);
      const isDefault = rawState.default === true;
      if (rawState.default !== undefined && typeof rawState.default !== "boolean") {
        throw new Error(`Block ${blockId} state ${stateIndex} has a non-boolean default marker.`);
      }
      if (isDefault) defaultCount += 1;
      states.push({ blockId, stateId, isDefault, properties });
    }
    if (defaultCount !== 1) throw new Error(`Block ${blockId} must have exactly one default state; found ${defaultCount}.`);
    blocks.push({ blockId, stateCount: rawBlock.states.length });
  }

  return { blockCount: blocks.length, stateCount: states.length, blocks, states };
}

/**
 * Audit the exact runtime planner paths against all registry states. The
 * supplied atlas is the normal in-memory atlas built by the app; the report
 * never serializes pixel data or PNG payloads.
 */
export function auditMinecraft263Coverage(
  manifest: ResourcePackManifest,
  registry: MinecraftBlockRegistry,
  atlas: ResourcePackAtlas | undefined,
  provenance: Mc263CoverageReport["source"],
): Mc263CoverageReport {
  const stateDefinitions = new Map(manifest.blockStates.map((entry) => [entry.resourceId, entry]));
  const modelById = new Map(manifest.models.map((model) => [model.resourceId, model]));
  const parsedStateIssueByPath = new Map(
    manifest.summary.issues
      .filter((issue) => issue.code === "INVALID_BLOCKSTATE_JSON" || issue.code === "UNSUPPORTED_MULTIPART")
      .map((issue) => [issue.path, issue]),
  );
  const parseIssuesByCode = countBy(manifest.summary.issues.map((issue) => issue.code));
  const atlasReady = atlas !== undefined;
  const sourceAtlas = atlas?.source;
  const atlasEntryById = new Map((sourceAtlas?.entries ?? []).map((entry) => [entry.resourceId, entry]));
  const stateExamples: StateCoverageRecord[] = [];
  const blockSummaries: Mc263CoverageReport["blocks"] = [];
  const runtimeFallbacks = new Map<string, number>();
  const geometryFallbacks = new Map<string, number>();
  const routeByBlockState = { textured: 0, geometry: 0, fallback: 0, notEvaluated: 0, intentionallyEmpty: 0 };
  const shapeCounts = { fullCubeStates: 0, nonCubeStates: 0, unresolvedStates: 0 };
  const colorCounters = {
    tintedFaces: 0,
    supportedTintFaces: 0,
    unappliedTintFaces: 0,
    unsupportedTintFaces: 0,
    tintKindsByFace: new Map<string, number>(),
  };
  const visualFaces = { count: 0, alphaModes: new Map<string, number>(), animated: 0 };
  const blocksWithDefinition = new Set<string>();
  let exactStatesWithDefinition = 0;
  let exactStatesUsingMultipart = 0;
  let exactStatesUsingVariants = 0;
  let exactStatesWithResolvedModel = 0;
  let exactStatesWithAtlasMappedGeometry = 0;
  let texturedCubeRouteShapeMismatchStates = 0;

  for (const registered of registry.states) {
    const definition = stateDefinitions.get(registered.blockId);
    const definitionKind = definition ? definition.multipart ? "multipart" : "variants" : "missing";
    if (definition) {
      blocksWithDefinition.add(registered.blockId);
      exactStatesWithDefinition += 1;
      if (definition.multipart) exactStatesUsingMultipart += 1;
      else exactStatesUsingVariants += 1;
    }
    if (NON_RENDERING_BLOCK_IDS.has(registered.blockId)) {
      routeByBlockState.intentionallyEmpty += 1;
        stateExamples.push({
          blockId: registered.blockId,
          stateId: registered.stateId,
          isDefault: registered.isDefault,
          properties: registered.properties,
        definition: definitionKind,
        modelShape: "not_applicable",
        route: "intentionally_empty",
      });
      continue;
    }

    if (!atlasReady) {
      routeByBlockState.notEvaluated += 1;
      stateExamples.push({
        blockId: registered.blockId,
        stateId: registered.stateId,
        isDefault: registered.isDefault,
        properties: registered.properties,
        definition: definitionKind,
        modelShape: "unresolved",
        route: "not_evaluated",
        fallbackReason: "ATLAS_BUILD_FAILED",
      });
      continue;
    }

    if (!definition) {
      const [namespace, blockPath] = registered.blockId.split(":");
      const parseIssuePath = `assets/${namespace}/blockstates/${blockPath}.json`;
      const parseIssue = parsedStateIssueByPath.get(parseIssuePath);
      const reason = parseIssue ? `BLOCKSTATE_${parseIssue.code}` : "MISSING_BLOCKSTATE_FILE";
      routeByBlockState.fallback += 1;
      bump(runtimeFallbacks, reason, 1);
      stateExamples.push({
        blockId: registered.blockId,
        stateId: registered.stateId,
        isDefault: registered.isDefault,
        properties: registered.properties,
        definition: definitionKind,
        modelShape: "unresolved",
        route: "fallback",
        fallbackReason: reason,
      });
      continue;
    }

    const voxel: BlueprintVoxel = {
      x: 0, y: 0, z: 0,
      materialId: "stone",
      buildOrder: 0,
      sourceBlockId: registered.blockId,
      sourceBlockState: registered.properties,
    };
    const modelGeometry = resolveBlockGeometry(manifest, registered.blockId, registered.properties);
    const modelShape = modelGeometry.status === "resolved_geometry"
      ? isUnitFullCube(modelGeometry.elements) ? "full_cube" : "non_cube"
      : "unresolved";
    if (modelGeometry.status === "resolved_geometry") exactStatesWithResolvedModel += 1;
    else bump(geometryFallbacks, modelGeometry.reason, 1);
    if (modelShape === "full_cube") shapeCounts.fullCubeStates += 1;
    else if (modelShape === "non_cube") shapeCounts.nonCubeStates += 1;
    else shapeCounts.unresolvedStates += 1;

    const sourceGeometryAtlas = modelGeometry.status === "resolved_geometry" && sourceAtlas
      ? mapBlockGeometryToAtlas(modelGeometry, sourceAtlas)
      : modelGeometry;
    if (sourceGeometryAtlas.status === "resolved_geometry") exactStatesWithAtlasMappedGeometry += 1;
    const geometryFaces = modelGeometry.status === "resolved_geometry"
      ? Object.values(modelGeometry.elements).flatMap((element) => Object.values(element.faces))
      : [];
    const tintAudit = auditTintReferences(registered.blockId, geometryFaces.map((face) => face?.tintIndex).filter((value): value is number => value !== undefined));
    const unsupportedTintProviders = auditUnsupportedTintProviders(registered.blockId, modelGeometry);
    colorCounters.tintedFaces += tintAudit.tintedFaces;
    colorCounters.supportedTintFaces += tintAudit.supportedTintFaces;
    colorCounters.unappliedTintFaces += tintAudit.unappliedTintFaces;
    colorCounters.unsupportedTintFaces += tintAudit.unsupportedTintFaces;
    for (const [kind, count] of Object.entries(tintAudit.tintKinds)) bump(colorCounters.tintKindsByFace, kind, count);
    if (modelGeometry.status === "resolved_geometry") {
      for (const element of modelGeometry.elements) {
        for (const face of Object.values(element.faces)) {
          if (!face) continue;
          const entry = atlasEntryById.get(face.texture);
          if (!entry) continue;
          visualFaces.count += 1;
          bump(visualFaces.alphaModes, face.forceTranslucent ? "translucent" : entry.alphaMode, 1);
          if (entry.animation && entry.animation.frames.length > 1) visualFaces.animated += 1;
        }
      }
    }

    let route: RuntimeRoute = "fallback";
    let fallbackReason: string | undefined;
    let unsupportedTintFaces: number | undefined;
    const cubePlans = planTexturedVoxelPages(voxel, manifest, atlas);
    if (cubePlans && cubePlans.length > 0) {
      route = "textured_cube";
      routeByBlockState.textured += 1;
      if (modelShape === "non_cube") texturedCubeRouteShapeMismatchStates += 1;
    } else {
      const geometryPlans = planGeometryVoxelPages(voxel, manifest, atlas);
      if (geometryPlans && geometryPlans.length > 0) {
        route = "model_geometry";
        routeByBlockState.geometry += 1;
      } else {
        routeByBlockState.fallback += 1;
        const diagnostics = explainRuntimeFallback(manifest, registered.blockId, registered.properties, definition, modelGeometry, sourceGeometryAtlas, sourceAtlas, atlasEntryById, modelById);
        fallbackReason = diagnostics.reason;
        unsupportedTintFaces = diagnostics.unsupportedTintFaces || undefined;
        bump(runtimeFallbacks, diagnostics.reason, 1);
      }
    }

    stateExamples.push({
      blockId: registered.blockId,
      stateId: registered.stateId,
      isDefault: registered.isDefault,
      properties: registered.properties,
      definition: definitionKind,
      modelShape,
      route,
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(modelGeometry.status === "fallback" ? {
        geometryFallbackReason: modelGeometry.reason,
        ...(modelGeometry.resourceId ? { geometryFallbackResourceId: modelGeometry.resourceId } : {}),
      } : {}),
      ...(modelGeometry.status === "resolved_geometry" ? { resolvedModelId: modelGeometry.modelId } : {}),
      ...(unsupportedTintFaces ? { unsupportedTintFaces } : {}),
      ...(tintAudit.unappliedTintFaces ? { unappliedTintFaces: tintAudit.unappliedTintFaces } : {}),
      ...(unsupportedTintProviders.length > 0 ? { unsupportedTintProviders } : {}),
      ...(Object.keys(tintAudit.tintKinds).length > 0 ? { tintKinds: tintAudit.tintKinds } : {}),
    });
  }

  const postPlanner = auditPostPlannerFallbacks(
    manifest,
    atlas,
    stateExamples,
  );
  const waterlogged = auditWaterloggedStates(registry, atlas);

  const perBlock = new Map<string, Mc263CoverageReport["blocks"][number]>();
  for (const state of stateExamples) {
    let summary = perBlock.get(state.blockId);
    if (!summary) {
      const definition = stateDefinitions.get(state.blockId);
      summary = {
        blockId: state.blockId,
        exactStates: 0,
        stateDefinitions: definition ? definition.multipart ? "multipart" : "variants" : "missing",
        texturedCubeStates: 0,
        geometryStates: 0,
        fallbackStates: 0,
        fallbackReasons: {},
        nonCubeStatesRenderedAsTexturedCube: 0,
      };
      perBlock.set(state.blockId, summary);
    }
    summary.exactStates += 1;
    if (state.route === "textured_cube") {
      summary.texturedCubeStates += 1;
      if (state.modelShape === "non_cube") summary.nonCubeStatesRenderedAsTexturedCube += 1;
    } else if (state.route === "model_geometry") summary.geometryStates += 1;
    else if (state.route === "fallback") {
      summary.fallbackStates += 1;
      if (state.fallbackReason) summary.fallbackReasons[state.fallbackReason] = (summary.fallbackReasons[state.fallbackReason] ?? 0) + 1;
    }
  }
  blockSummaries.push(...[...perBlock.values()].sort((left, right) => compareText(left.blockId, right.blockId)));

  const atlases = sourceAtlas?.entries ?? [];
  const runtimeClimate = { temperature: 0.8 as const, downfall: 0.4 as const };
  return {
    schemaVersion: 1,
    target: { edition: "Minecraft Java Edition", version: "26.3", resourcePackFormat: "97.1" },
    source: provenance,
    assets: {
      archiveEntries: manifest.summary.archiveFileCount,
      blockStateFiles: countManifestBlockStates(manifest),
      parsedBlockStateFiles: manifest.blockStates.length,
      parsedModels: manifest.models.length,
      candidateBlockTextures: manifest.summary.candidateTextureCount,
      acceptedBlockTextures: manifest.summary.acceptedTextureCount,
      rejectedBlockTextures: manifest.summary.rejectedTextureCount,
      colormaps: (manifest.colormaps ?? []).map((colormap) => colormap.kind).sort(compareText),
      parseIssuesByCode,
      parseIssueExamples: manifest.summary.issues.slice(0, 50).map(({ path, code, message }) => ({ path, code, message })),
    },
    atlas: atlas
      ? {
          status: "ready",
          pages: atlas.pages.length,
          tiles: atlas.source.entries.length,
          alphaModes: countBy(atlas.source.entries.map((entry) => entry.alphaMode)),
          animatedTiles: atlas.source.entries.filter((entry) => (entry.animation?.frames.length ?? 0) > 1).length,
        }
      : { status: "failed", pages: 0, tiles: 0, alphaModes: {}, animatedTiles: 0, error: "Atlas construction did not complete." },
    coverage: {
      blocks: registry.blockCount,
      exactBlockStates: registry.stateCount,
      intentionallyEmptyStates: routeByBlockState.intentionallyEmpty,
      blockStatesWithDefinition: blocksWithDefinition.size,
      exactStatesWithDefinition,
      exactStatesUsingMultipart,
      exactStatesUsingVariants,
      exactStatesWithResolvedModel,
      exactStatesWithAtlasMappedGeometry,
      runtimeTexturedCubeStates: routeByBlockState.textured,
      runtimeModelGeometryStates: routeByBlockState.geometry,
      runtimeFallbackStates: routeByBlockState.fallback,
      runtimeNotEvaluatedStates: routeByBlockState.notEvaluated,
      routesByFallbackReason: sortMap(runtimeFallbacks),
      fallbackDiagnostics: buildFallbackDiagnostics(stateExamples),
      geometryResolutionByReason: sortMap(geometryFallbacks),
      modelShape: shapeCounts,
      texturedCubeRouteShapeMismatchStates,
      color: {
        colormapSourcesPresent: (manifest.colormaps ?? []).map((colormap) => colormap.kind).sort(compareText),
        tintedFaces: colorCounters.tintedFaces,
        supportedTintFaces: colorCounters.supportedTintFaces,
        unappliedTintFaces: colorCounters.unappliedTintFaces,
        unsupportedTintFaces: colorCounters.unsupportedTintFaces,
        tintKindsByFace: sortMap(colorCounters.tintKindsByFace),
        runtimeClimate,
        exactVanillaColorParity: "not_compared",
      },
      visualFaceReferences: {
        count: visualFaces.count,
        alphaModes: sortMap(visualFaces.alphaModes),
        animated: visualFaces.animated,
      },
      postPlanner,
      waterlogged,
    },
    states: stateExamples,
    blocks: blockSummaries,
    interpretation: [
      "Coverage enumerates the exact property maps and numeric state IDs present in the supplied official blocks.json; it does not infer states from block names or variant keys.",
      "Runtime routes are exercised through the current texture and geometry voxel planners after parsing the official client JAR and building the bounded atlas.",
      "A textured_cube route uses the runtime full-cube textured voxel planner. Non-cube source geometry routed there is counted as a shape mismatch, not as geometry coverage.",
      "The underlying geometry resolver currently uses GEOMETRY_LIMIT_EXCEEDED both for models exceeding element/quad caps and for models where legacy full-cube geometry cannot be inferred. The audit separates model chains with no declared static geometry into MODEL_HAS_NO_STATIC_GEOMETRY and preserves the raw resolver reason in each state record.",
      "The static block-model audit does not exercise block-entity data, dynamic or animated state, shader extensions, lighting parity, or screenshot comparison against the Minecraft client. postPlanner separately executes the currently supported static special-renderer helpers.",
      "postPlanner is an additive, mutually exclusive partition of legacy planner fallbacks. Special renderers and fluid routes are counted only when their runtime helpers return concrete handled voxel plans; these counts do not claim full dynamic block-entity or screenshot parity. moving_piston is explicitly block-entity-dependent and is not counted as visually resolved.",
      "coverage.waterlogged.registry counts exact blocks.json states whose waterlogged property is true, independently of legacy fallback routing. isolatedPlannerProbe runs the waterlogged overlay planner in bounded, spatially isolated chunks; its entries show planner output only, not whether pixels are externally visible after host-model depth/alpha and real-scene neighbor occlusion. The host block's normal model remains a separate renderer layer.",
      "Tint references are split into mapped providers, neutralized references (NO_FACE_TINT), and unsupported providers that prevent a runtime route. The app uses its fixed settlement climate (0.8 temperature/0.4 downfall), so exact biome-dependent vanilla color parity is not claimed.",
      "The report contains no vanilla PNG/model payloads. The client and server JARs and DataGen output remain external local inputs.",
    ],
  };
}

function auditWaterloggedStates(
  registry: MinecraftBlockRegistry,
  atlas: ResourcePackAtlas | undefined,
): WaterloggedCoverage {
  const eligible = registry.states.filter((state) => state.properties.waterlogged === "true");
  const blockIds = [...new Set(eligible.map((state) => state.blockId))].sort(compareText);
  let atlasOverlayStates = 0;
  let proceduralFallbackOverlayStates = 0;
  let statesWithoutExposedOverlay = 0;
  let omittedVoxelCount = 0;
  let chunks = 0;

  for (let offset = 0; offset < eligible.length; offset += WATERLOGGED_AUDIT_CHUNK_SIZE) {
    const stateChunk = eligible.slice(offset, offset + WATERLOGGED_AUDIT_CHUNK_SIZE);
    const voxels = stateChunk.map((state, index): BlueprintVoxel => ({
      // Keep each registry record isolated. This probe deliberately supplies
      // no adjacent host/fluid scene and therefore cannot predict occlusion.
      x: (offset + index) * 2,
      y: 0,
      z: 0,
      materialId: "stone",
      buildOrder: 0,
      sourceBlockId: state.blockId,
      sourceBlockState: state.properties,
    }));
    const plan = planResourceWaterloggedFluidBatches(voxels, atlas);
    const atlasEntries = new Set(plan.batches.flatMap((batch) => batch.entries.map((entry) => entry.voxel)));
    const fallbackEntries = new Set(plan.fallbackEntries.map((entry) => entry.voxel));
    const planned = new Set([...atlasEntries, ...fallbackEntries]);
    atlasOverlayStates += atlasEntries.size;
    proceduralFallbackOverlayStates += fallbackEntries.size;
    statesWithoutExposedOverlay += stateChunk.length - planned.size;
    omittedVoxelCount += plan.omittedVoxelCount;
    chunks += 1;
  }

  return {
    registry: {
      eligibleStates: eligible.length,
      eligibleBlocks: blockIds.length,
      blockIds,
    },
    isolatedPlannerProbe: {
      inputStates: eligible.length,
      inputBlocks: blockIds.length,
      chunkSize: WATERLOGGED_AUDIT_CHUNK_SIZE,
      chunks,
      atlasAvailable: atlas !== undefined,
      atlasBackedPlanStates: atlasOverlayStates,
      proceduralFallbackPlanStates: proceduralFallbackOverlayStates,
      plannedOverlayStates: atlasOverlayStates + proceduralFallbackOverlayStates,
      statesWithoutExposedOverlay,
      omittedVoxelCount,
      fullSceneVisibility: "not_measured",
      visibilityNote: "Isolated planner output only; visible contribution remains dependent on host-model depth/alpha and real scene neighbors. The host block model is preserved as a separate layer; no external visibility or exact client parity is claimed.",
    },
  };
}

function auditPostPlannerFallbacks(
  manifest: ResourcePackManifest,
  atlas: ResourcePackAtlas | undefined,
  states: readonly StateCoverageRecord[],
): PostPlannerCoverage {
  const fallbackStates = states.filter((state) => state.route === "fallback");
  const fallbackVoxels = fallbackStates.map((state, index): BlueprintVoxel => ({
    // Keep every audit voxel isolated so the fluid planner cannot infer
    // adjacency between unrelated registry states.
    x: index * 2,
    y: 0,
    z: 0,
    materialId: "stone",
    buildOrder: 0,
    sourceBlockId: state.blockId,
    sourceBlockState: state.properties,
  }));
  const stateByVoxel = new Map(fallbackVoxels.map((voxel, index) => [voxel, fallbackStates[index]!]));
  // Match renderer.ts: empty fallbacks are filtered before custom renderers.
  // moving_piston is listed separately because its appearance depends on
  // block-entity state; the generic empty helper intentionally suppresses it.
  const blockEntityDependent = new Set(fallbackVoxels.filter((voxel) => voxel.sourceBlockId === "minecraft:moving_piston"));
  const intentionallyEmpty = new Set(fallbackVoxels.filter((voxel) =>
    !blockEntityDependent.has(voxel) && isVisuallyEmptyVanillaBlock(voxel),
  ));
  const visibleFallbackVoxels = fallbackVoxels.filter((voxel) =>
    !blockEntityDependent.has(voxel) && !intentionallyEmpty.has(voxel),
  );
  const root = new THREE.Group();
  const specialTextures = manifest.specialTextures ?? [];
  let rendererSets: PostPlannerCoverage["special"]["byRenderer"] | undefined;
  let actualRendererSets: {
    portals: Set<BlueprintVoxel>;
    decor: Set<BlueprintVoxel>;
    boxes: Set<BlueprintVoxel>;
    figures: Set<BlueprintVoxel>;
  } | undefined;
  let fluidHandled = new Set<BlueprintVoxel>();
  try {
    // Execute helpers in renderer.ts order, passing each only voxels that the
    // preceding route did not handle. Their returned Sets are the evidence.
    const portals = addResourceSpecialPortals(root, visibleFallbackVoxels, specialTextures);
    const afterPortals = visibleFallbackVoxels.filter((voxel) => !portals.has(voxel));
    const boxes = addResourceSpecialBoxes(root, afterPortals, specialTextures);
    const afterBoxes = afterPortals.filter((voxel) => !boxes.has(voxel));
    const figures = addResourceSpecialFigures(root, afterBoxes, specialTextures);
    const afterFigures = afterBoxes.filter((voxel) => !figures.has(voxel));
    const decor = addResourceSpecialDecor(root, afterFigures, specialTextures);
    actualRendererSets = { portals, decor, boxes, figures };
    rendererSets = {
      portals: summarizeVoxelSet(portals, stateByVoxel),
      decor: summarizeVoxelSet(decor, stateByVoxel),
      boxes: summarizeVoxelSet(boxes, stateByVoxel),
      figures: summarizeVoxelSet(figures, stateByVoxel),
    };

    if (atlas) {
      const specialHandled = new Set([...portals, ...boxes, ...figures, ...decor]);
      const ordinaryFallbackVoxels = visibleFallbackVoxels.filter((voxel) => !specialHandled.has(voxel));
      const fluidPlan = planResourceFluidBatches(ordinaryFallbackVoxels, atlas);
      fluidHandled = new Set(fluidPlan.batches.flatMap((batch) => batch.entries.map((entry) => entry.voxel)));
    }
  } finally {
    disposeAuditScene(root);
  }
  if (!rendererSets || !actualRendererSets) throw new Error("Special-renderer audit did not initialize.");
  const specialHandled = new Set<BlueprintVoxel>([
    ...actualRendererSets.portals,
    ...actualRendererSets.decor,
    ...actualRendererSets.boxes,
    ...actualRendererSets.figures,
  ]);
  const fluidEffective = new Set(fluidHandled);
  const unresolved = new Set(visibleFallbackVoxels.filter((voxel) =>
    !specialHandled.has(voxel) && !fluidEffective.has(voxel),
  ));

  // The temporary groups, model geometries, decoded textures and materials
  // were only needed to execute the real helpers; the JSON report holds IDs.
  // Dispose once per owned resource because multiple InstancedMeshes can share.
  return {
    plannerFallbackStates: fallbackVoxels.length,
    special: {
      states: specialHandled.size,
      blocks: blockIdsFor(specialHandled, stateByVoxel),
      byRenderer: rendererSets,
    },
    fluids: { states: fluidEffective.size, blocks: blockIdsFor(fluidEffective, stateByVoxel) },
    intentionallyEmpty: { states: intentionallyEmpty.size, blocks: blockIdsFor(intentionallyEmpty, stateByVoxel) },
    blockEntityDependent: {
      states: blockEntityDependent.size,
      blocks: blockIdsFor(blockEntityDependent, stateByVoxel),
      note: "Requires block-entity data/runtime state; excluded from visually resolved coverage.",
    },
    unresolved: { states: unresolved.size, blocks: blockIdsFor(unresolved, stateByVoxel) },
  };
}

function summarizeVoxelSet(
  voxels: ReadonlySet<BlueprintVoxel>,
  stateByVoxel: ReadonlyMap<BlueprintVoxel, StateCoverageRecord>,
): { states: number; blocks: string[] } {
  return { states: voxels.size, blocks: blockIdsFor(voxels, stateByVoxel) };
}

function blockIdsFor(
  voxels: ReadonlySet<BlueprintVoxel>,
  stateByVoxel: ReadonlyMap<BlueprintVoxel, StateCoverageRecord>,
): string[] {
  return [...new Set([...voxels].flatMap((voxel) => {
    const blockId = stateByVoxel.get(voxel)?.blockId;
    return blockId ? [blockId] : [];
  }))].sort(compareText);
}

function disposeAuditScene(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      geometries.add(mesh.geometry);
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of meshMaterials) {
        materials.add(material);
        const map = (material as THREE.Material & { map?: THREE.Texture | null }).map;
        if (map) textures.add(map);
      }
    }
    const ownedMaterial = object.userData.ownedMaterial as THREE.Material | undefined;
    const ownedTexture = object.userData.ownedTexture as THREE.Texture | undefined;
    if (ownedMaterial) materials.add(ownedMaterial);
    if (ownedTexture) textures.add(ownedTexture);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  root.clear();
}

export function verifyMinecraft263Inputs(clientJar: Uint8Array, blocksReportBytes: Uint8Array): {
  clientJarSha1: string;
  blocksReportSha256: string;
} {
  const clientJarSha1 = digest("sha1", clientJar);
  const blocksReportSha256 = digest("sha256", blocksReportBytes);
  if (clientJarSha1 !== MC263_CLIENT_JAR_SHA1) {
    throw new Error(`Client JAR SHA-1 mismatch: expected ${MC263_CLIENT_JAR_SHA1}; received ${clientJarSha1}.`);
  }
  if (blocksReportSha256 !== MC263_BLOCKS_REPORT_SHA256) {
    throw new Error(`blocks.json SHA-256 mismatch: expected ${MC263_BLOCKS_REPORT_SHA256}; received ${blocksReportSha256}. Regenerate it from the pinned Mojang server JAR first.`);
  }
  return { clientJarSha1, blocksReportSha256 };
}

function explainRuntimeFallback(
  manifest: ResourcePackManifest,
  blockId: string,
  state: Readonly<Record<string, string>>,
  blockStateDefinition: ResourcePackManifest["blockStates"][number] | undefined,
  geometry: ReturnType<typeof resolveBlockGeometry>,
  mappedGeometry: ReturnType<typeof mapBlockGeometryToAtlas> | ReturnType<typeof resolveBlockGeometry>,
  sourceAtlas: ReturnType<typeof buildJava16xTextureAtlas> | undefined,
  atlasEntryById: ReadonlyMap<string, ReturnType<typeof buildJava16xTextureAtlas>["entries"][number]>,
  modelById: ReadonlyMap<string, ResourcePackManifest["models"][number]>,
): { reason: string; unsupportedTintFaces: number } {
  if (geometry.status === "fallback" && geometry.reason === "NO_MATCHING_VARIANT"
    && multipartHasNoApplicablePart(blockStateDefinition, state)) {
    return { reason: "EMPTY_MULTIPART_STATE", unsupportedTintFaces: 0 };
  }
  if (geometry.status === "fallback" && geometry.reason !== "COMPLEX_GEOMETRY") {
    if (geometry.reason === "GEOMETRY_LIMIT_EXCEEDED" && geometry.resourceId
      && !modelDeclaresStaticGeometry(modelById, geometry.resourceId)) {
      return { reason: "MODEL_HAS_NO_STATIC_GEOMETRY", unsupportedTintFaces: 0 };
    }
    return { reason: `MODEL_${geometry.reason}`, unsupportedTintFaces: 0 };
  }
  if (!sourceAtlas) return { reason: "ATLAS_NOT_AVAILABLE", unsupportedTintFaces: 0 };

  const faces = geometry.status === "resolved_geometry"
    ? geometry.elements.flatMap((element) => Object.values(element.faces).filter((face): face is NonNullable<typeof face> => face !== undefined))
    : [];
  const textured = resolveBlockTextures(manifest, blockId, state);
  if (textured.status === "fallback" && textured.reason !== "COMPLEX_GEOMETRY") {
    const mapped = mapBlockTexturesToAtlas(textured, sourceAtlas);
    if (mapped.status === "fallback" && mapped.reason === "MISSING_ATLAS_TEXTURE") return { reason: "TEXTURE_ATLAS_MISSING_TILE", unsupportedTintFaces: 0 };
    if (textured.reason === "MISSING_TEXTURE" || textured.reason === "MISSING_TEXTURE_VARIABLE") {
      return { reason: `TEXTURE_${textured.reason}`, unsupportedTintFaces: 0 };
    }
  }
  if (mappedGeometry.status === "fallback") {
    const reason = mappedGeometry.reason;
    if (reason === "MISSING_ATLAS_TEXTURE") return { reason: "GEOMETRY_ATLAS_MISSING_TILE", unsupportedTintFaces: 0 };
    if (reason === "INVALID_FACE_METADATA" || reason === "INVALID_GEOMETRY_METADATA") return { reason: `GEOMETRY_ATLAS_${reason}`, unsupportedTintFaces: 0 };
    return { reason: `GEOMETRY_${reason}`, unsupportedTintFaces: 0 };
  }

  let unsupportedTintFaces = 0;
  for (const face of faces) {
    if (face.tintIndex !== undefined && faceTintKind(blockId, face.tintIndex) === undefined) unsupportedTintFaces += 1;
    if (!atlasEntryById.has(face.texture)) return { reason: "GEOMETRY_ATLAS_MISSING_TILE", unsupportedTintFaces };
  }
  if (unsupportedTintFaces > 0) return { reason: "COLOR_UNSUPPORTED_TINT_PROVIDER", unsupportedTintFaces };
  return { reason: geometryCompilerFailureReason(blockId, mappedGeometry, atlasEntryById), unsupportedTintFaces };
}

function geometryCompilerFailureReason(
  blockId: string,
  mappedGeometry: ReturnType<typeof mapBlockGeometryToAtlas> | ReturnType<typeof resolveBlockGeometry>,
  atlasEntryById: ReadonlyMap<string, ReturnType<typeof buildJava16xTextureAtlas>["entries"][number]>,
): string {
  if (mappedGeometry.status !== "resolved_geometry") return "GEOMETRY_COMPILER_REJECTED_UNEXPLAINED";
  const slotsByPage = new Map<number, Set<string>>();
  let renderableFaces = 0;
  for (const element of mappedGeometry.elements) {
    for (const faceName of FACE_NAMES) {
      const face = element.faces[faceName];
      if (!face || !geometryFaceHasArea(element.from, element.to, faceName)) continue;
      renderableFaces += 1;
      const entry = "texture" in face ? atlasEntryById.get(face.texture) : undefined;
      const page = "page" in face && typeof face.page === "number" ? face.page : entry?.page;
      const textureIndex = "textureIndex" in face && typeof face.textureIndex === "number"
        ? face.textureIndex
        : entry?.pageTextureIndex;
      if (page === undefined || textureIndex === undefined) return "GEOMETRY_ATLAS_MISSING_TILE";
      const tintKind = faceTintKind(blockId, face.tintIndex);
      if (tintKind === undefined) return "COLOR_UNSUPPORTED_TINT_PROVIDER";
      const slots = slotsByPage.get(page) ?? new Set<string>();
      slots.add(`${textureIndex}|${tintKind}`);
      slotsByPage.set(page, slots);
    }
  }
  if (renderableFaces === 0) return "GEOMETRY_NO_RENDERABLE_FACES";
  if ([...slotsByPage.values()].some((slots) => slots.size > 6)) return "GEOMETRY_TEXTURE_SLOT_LIMIT_EXCEEDED";
  return "GEOMETRY_COMPILER_REJECTED_UNEXPLAINED";
}

function geometryFaceHasArea(
  from: readonly number[],
  to: readonly number[],
  face: typeof FACE_NAMES[number],
): boolean {
  if (face === "down" || face === "up") return from[0] !== to[0] && from[2] !== to[2];
  if (face === "north" || face === "south") return from[0] !== to[0] && from[1] !== to[1];
  return from[1] !== to[1] && from[2] !== to[2];
}

function multipartHasNoApplicablePart(
  definition: ResourcePackManifest["blockStates"][number] | undefined,
  state: Readonly<Record<string, string>>,
): boolean {
  if (!definition?.multipart) return false;
  return !definition.multipart.some((part) => part.when.clauses.some((clause) =>
    Object.entries(clause).every(([property, allowedValues]) => {
      const stateValue = state[property];
      return stateValue !== undefined && allowedValues.includes(stateValue);
    }),
  ));
}

function modelDeclaresStaticGeometry(
  models: ReadonlyMap<string, ResourcePackManifest["models"][number]>,
  resourceId: string,
): boolean {
  const seen = new Set<string>();
  let currentId: string | undefined = resourceId;
  while (currentId && !seen.has(currentId) && seen.size < 32) {
    seen.add(currentId);
    const model = models.get(currentId);
    if (!model) return false;
    if (model.elements && model.elements.length > 0) return true;
    if (model.faces && Object.keys(model.faces).length > 0) return true;
    currentId = model.parent;
  }
  // A cycle/depth cut cannot prove an absence of geometry; retain the more
  // conservative raw resolver limit classification in that case.
  return currentId !== undefined;
}

function auditTintReferences(blockId: string, values: readonly number[]): {
  tintedFaces: number;
  supportedTintFaces: number;
  unappliedTintFaces: number;
  unsupportedTintFaces: number;
  tintKinds: Record<string, number>;
} {
  let supportedTintFaces = 0;
  let unappliedTintFaces = 0;
  let unsupportedTintFaces = 0;
  const tintKinds = new Map<string, number>();
  for (const tintIndex of values) {
    const tintKind = faceTintKind(blockId, tintIndex);
    if (tintKind === undefined) {
      unsupportedTintFaces += 1;
      continue;
    }
    if (tintKind === NO_FACE_TINT) {
      unappliedTintFaces += 1;
      continue;
    }
    supportedTintFaces += 1;
    bump(tintKinds, ([
      "none",
      "foliage",
      "grass",
      "water",
      "dry_foliage",
      "spruce_leaves",
      "birch_leaves",
      "lily_pad",
      "attached_stem",
      "redstone_wire",
      "growing_stem",
    ] as const)[tintKind] ?? "unknown", 1);
  }
  return {
    tintedFaces: values.length,
    supportedTintFaces,
    unappliedTintFaces,
    unsupportedTintFaces,
    tintKinds: sortMap(tintKinds),
  };
}

function auditUnsupportedTintProviders(
  blockId: string,
  geometry: ReturnType<typeof resolveBlockGeometry>,
): UnsupportedTintProviderReference[] {
  if (geometry.status !== "resolved_geometry") return [];
  const providers = new Map<string, UnsupportedTintProviderReference>();
  for (const element of geometry.elements) {
    for (const faceName of FACE_NAMES) {
      const face = element.faces[faceName];
      if (!face || face.tintIndex === undefined || faceTintKind(blockId, face.tintIndex) !== undefined) continue;
      const type = tintProviderType(blockId);
      const key = `${type}:${face.tintIndex}`;
      const provider = providers.get(key) ?? { type, tintIndex: face.tintIndex, faceNames: [] };
      if (!provider.faceNames.includes(faceName)) provider.faceNames.push(faceName);
      providers.set(key, provider);
    }
  }
  return [...providers.values()]
    .map((provider) => ({ ...provider, faceNames: [...provider.faceNames].sort(compareText) }))
    .sort((left, right) => compareText(left.type, right.type) || left.tintIndex - right.tintIndex);
}

function tintProviderType(blockId: string): string {
  const [namespace, path] = blockId.split(":");
  if (namespace !== "minecraft") return "external_namespace_provider_not_mapped";
  if (path === "redstone_wire") return "state_dependent_redstone_provider";
  if (path === "attached_melon_stem" || path === "attached_pumpkin_stem") return "constant_attached_stem_provider";
  if (path?.endsWith("_stem")) return "state_dependent_stem_provider";
  return "unmapped_vanilla_provider";
}

function buildFallbackDiagnostics(states: readonly StateCoverageRecord[]): FallbackDiagnostic[] {
  const byReason = new Map<string, StateCoverageRecord[]>();
  for (const state of states) {
    if (state.route !== "fallback" || !state.fallbackReason) continue;
    const entries = byReason.get(state.fallbackReason) ?? [];
    entries.push(state);
    byReason.set(state.fallbackReason, entries);
  }

  return [...byReason.entries()].sort(([left], [right]) => compareText(left, right)).map(([reason, reasonStates]) => {
    const byBlock = new Map<string, StateCoverageRecord[]>();
    for (const state of reasonStates) {
      const entries = byBlock.get(state.blockId) ?? [];
      entries.push(state);
      byBlock.set(state.blockId, entries);
    }
    const blocks = [...byBlock.entries()].sort(([left], [right]) => compareText(left, right)).map(([blockId, blockStates]) => {
      const tintProviderTypes = [...new Set(blockStates.flatMap((state) => state.unsupportedTintProviders?.map((provider) => provider.type) ?? []))].sort(compareText);
      const unsupportedTintFaceCount = blockStates.reduce((total, state) => total + (state.unsupportedTintFaces ?? 0), 0);
      const representative = [...blockStates].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.stateId - right.stateId).slice(0, 2);
      return {
        blockId,
        fallbackStateCount: blockStates.length,
        ...(unsupportedTintFaceCount > 0 ? { unsupportedTintFaceCount } : {}),
        ...(tintProviderTypes.length > 0 ? { tintProviderTypes } : {}),
        representativeStates: representative.map((state) => ({
          stateId: state.stateId,
          isDefault: state.isDefault,
          properties: state.properties,
          ...(state.unsupportedTintFaces ? { unsupportedTintFaces: state.unsupportedTintFaces } : {}),
          ...(state.unsupportedTintProviders ? { unsupportedTintProviders: state.unsupportedTintProviders } : {}),
          ...(state.geometryFallbackReason ? { geometryFallbackReason: state.geometryFallbackReason } : {}),
          ...(state.geometryFallbackResourceId ? { geometryFallbackResourceId: state.geometryFallbackResourceId } : {}),
          ...(state.resolvedModelId ? { resolvedModelId: state.resolvedModelId } : {}),
        })),
      };
    });
    const providerTypes = [...new Set(reasonStates.flatMap((state) => state.unsupportedTintProviders?.map((provider) => provider.type) ?? []))].sort(compareText);
    const unsupportedTintFaceCount = reasonStates.reduce((total, state) => total + (state.unsupportedTintFaces ?? 0), 0);
    return {
      reason,
      fallbackStateCount: reasonStates.length,
      uniqueBlockCount: blocks.length,
      ...(unsupportedTintFaceCount > 0 ? { unsupportedTintFaceCount } : {}),
      ...(providerTypes.length > 0 ? { tintProviderTypes: providerTypes } : {}),
      suggestedRemediation: suggestedFallbackRemediation(reason),
      blocks,
    };
  });
}

function suggestedFallbackRemediation(reason: string): string {
  switch (reason) {
    case "COLOR_UNSUPPORTED_TINT_PROVIDER":
      return "Implement the exact block-specific BlockColors behavior, including state-dependent provider inputs, and pass the relevant state into the renderer. Keep these blocks on explicit fallback until parity fixtures cover each provider; a generic constant tint would be incorrect.";
    case "MODEL_GEOMETRY_LIMIT_EXCEEDED":
      return "Inspect the representative model IDs against the resolver's 128-element / 768-quad safety limits. Only if those models actually exceed a cap, add a bounded multi-part or chunked rendering path and stress tests rather than globally raising limits.";
    case "MODEL_HAS_NO_STATIC_GEOMETRY":
      return "The model inheritance chain declares no block elements or legacy full-cube faces (often a special-rendered or intentionally model-less block). Preserve this as explicit empty/special geometry instead of showing a generic cube; only add a custom renderer when the product actually supports that block family.";
    case "MODEL_NO_MATCHING_VARIANT":
      return "Compare each representative full state map with its official blockstate variants/multipart predicates. Extend the state matcher only for a demonstrated mismatch; if no multipart part applies, preserve the zero-part model result instead of inventing a variant or generic cube.";
    case "EMPTY_MULTIPART_STATE":
      return "All official multipart predicates are false for these concrete states, so the model contributes zero parts. Preserve this as an empty multipart result and ensure the app does not replace it with a generic cube; do not broaden predicates to force a model match.";
    case "GEOMETRY_COMPILER_REJECTED":
      return "The route planner rejected the resolved model for a reason not explained by the current lightweight checks. Inspect the listed resolved model and add a focused fixture before changing compiler constraints.";
    case "GEOMETRY_TEXTURE_SLOT_LIMIT_EXCEEDED":
      return "This model needs more than six distinct texture/tint slots on one atlas page, exceeding the voxel shader's fixed slot count. Add a bounded multi-batch strategy or reduce supported combinations; do not change atlas page assignment to hide the limit.";
    case "GEOMETRY_NO_RENDERABLE_FACES":
      return "The resolved elements contain no non-degenerate faces. Treat them as explicit empty geometry if confirmed by vanilla, or fix the zero-area face filter only if the model should visibly render.";
    case "MISSING_BLOCKSTATE_FILE":
      return "Verify whether the vanilla block is intentionally model-less or whether its blockstate resource path was missed; handle an intentional special block explicitly, otherwise correct archive path/namespace mapping and add a parser fixture.";
    default:
      return "Use the listed block IDs and concrete state maps to trace the earliest failed dimension (blockstate parse, model resolution, texture lookup, atlas mapping, tint provider, or geometry compilation); add a targeted fixture and keep the fallback reason specific.";
  }
}

function isUnitFullCube(elements: ReturnType<typeof resolveBlockGeometry> extends infer T ? T extends { status: "resolved_geometry"; elements: infer E } ? E : never : never): boolean {
  if (elements.length !== 1) return false;
  const element = elements[0];
  if (!element || element.rotation !== undefined) return false;
  return sameVector(element.from, [0, 0, 0])
    && sameVector(element.to, [16, 16, 16])
    && FACE_NAMES.every((face) => element.faces[face] !== undefined);
}

function sameVector(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function countManifestBlockStates(manifest: ResourcePackManifest): number {
  const parseFailures = new Set(manifest.summary.issues
    .filter((issue) => issue.path.startsWith("assets/") && issue.path.includes("/blockstates/")
      && (issue.code === "INVALID_BLOCKSTATE_JSON" || issue.code === "UNSUPPORTED_MULTIPART"))
    .map((issue) => issue.path));
  return manifest.blockStates.length + parseFailures.size;
}

function parsePropertyDomains(blockId: string, value: unknown): Map<string, string[]> {
  if (value === undefined) return new Map();
  if (!isRecord(value)) throw new Error(`Block ${blockId} has malformed property domains.`);
  const domains = new Map<string, string[]>();
  for (const name of Object.keys(value).sort(compareText)) {
    const rawDomain = value[name];
    if (!/^[a-z0-9_.-]+$/.test(name) || !Array.isArray(rawDomain) || rawDomain.length === 0
      || rawDomain.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error(`Block ${blockId} has an invalid value list for property ${name}.`);
    }
    const domain = rawDomain as string[];
    if (new Set(domain).size !== domain.length) throw new Error(`Block ${blockId} repeats values for property ${name}.`);
    domains.set(name, [...domain]);
  }
  return domains;
}

function parseConcreteProperties(
  blockId: string,
  stateIndex: number,
  rawValue: unknown,
  domains: ReadonlyMap<string, readonly string[]>,
): Record<string, string> {
  if (rawValue === undefined && domains.size === 0) return {};
  if (!isRecord(rawValue)) throw new Error(`Block ${blockId} state ${stateIndex} has malformed properties.`);
  const names = Object.keys(rawValue).sort(compareText);
  if (names.length !== domains.size || names.some((name) => !domains.has(name))) {
    throw new Error(`Block ${blockId} state ${stateIndex} does not carry the complete declared property set.`);
  }
  const result: Record<string, string> = {};
  for (const name of names) {
    const item = rawValue[name];
    if (typeof item !== "string" || !domains.get(name)?.includes(item)) {
      throw new Error(`Block ${blockId} state ${stateIndex} uses an undeclared value for property ${name}.`);
    }
    result[name] = item;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalProperties(properties: Readonly<Record<string, string>>): string {
  return Object.entries(properties).sort(([left], [right]) => compareText(left, right))
    .map(([name, value]) => `${name}=${value}`).join(",");
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) bump(counts, value, 1);
  return sortMap(counts);
}

function sortMap(source: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...source.entries()].sort(([left], [right]) => compareText(left, right)));
}

function bump(target: Map<string, number>, key: string, amount: number): void {
  target.set(key, (target.get(key) ?? 0) + amount);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(algorithm: "sha1" | "sha256", bytes: Uint8Array): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

function usage(): string {
  return [
    "Usage: vite-node --script tools/audit-mc263-coverage.ts <26.3-client.jar> <reports/blocks.json> [report.json]",
    "",
    `Pinned client JAR SHA-1: ${MC263_CLIENT_JAR_SHA1}`,
    `Pinned server JAR SHA-1: ${MC263_SERVER_JAR_SHA1}`,
    `Pinned DataGen blocks.json SHA-256: ${MC263_BLOCKS_REPORT_SHA256}`,
    "",
    "Reproduce the official state report outside the repository in PowerShell:",
    "$scratch = Join-Path $env:TEMP 'blockcolc-mc263-coverage'",
    "$server = Join-Path $scratch 'server.jar'",
    `Invoke-WebRequest -Uri '${MC263_SERVER_JAR_URL}' -OutFile $server`,
    `if ((Get-FileHash -LiteralPath $server -Algorithm SHA1).Hash.ToLowerInvariant() -ne '${MC263_SERVER_JAR_SHA1}') { throw 'server.jar SHA-1 mismatch' }`,
    "New-Item -ItemType Directory -Path (Join-Path $scratch 'generated') -Force | Out-Null",
    "Push-Location $scratch; try { java '-DbundlerMainClass=net.minecraft.data.Main' -jar $server --help; java '-DbundlerMainClass=net.minecraft.data.Main' -jar $server --reports --output (Join-Path $scratch 'generated') } finally { Pop-Location }",
    "Use generated\\reports\\blocks.json as the second input. Keep the JARs and reports out of the repository and never include their assets in the app.",
  ].join("\n");
}

async function runCli(args: readonly string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (args.length < 2 || args.length > 3) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  const clientJarPath = args[0]!;
  const blocksReportPath = args[1]!;
  const outputPath = args[2];
  const clientJar = readFileSync(clientJarPath);
  const blocksReportBytes = readFileSync(blocksReportPath);
  const verifiedHashes = verifyMinecraft263Inputs(clientJar, blocksReportBytes);
  const registryRaw: unknown = JSON.parse(blocksReportBytes.toString("utf8"));
  const registry = enumerateMinecraftBlockStates(registryRaw);
  if (registry.blockCount !== 1286 || registry.stateCount !== 35_723) {
    throw new Error(`Pinned DataGen report had unexpected registry dimensions: ${registry.blockCount} blocks / ${registry.stateCount} states.`);
  }

  const manifest = parseJava16xResourcePack(clientJar);
  let atlas: ResourcePackAtlas | undefined;
  let atlasError: string | undefined;
  try {
    atlas = buildResourcePackAtlas(manifest);
  } catch (cause) {
    atlasError = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  }
  const report = auditMinecraft263Coverage(manifest, registry, atlas, {
    ...verifiedHashes,
    clientJarBytes: clientJar.byteLength,
    serverJarSha1: MC263_SERVER_JAR_SHA1,
    officialServerJarUrl: MC263_SERVER_JAR_URL,
    blocksReportBlockCount: registry.blockCount,
    blocksReportStateCount: registry.stateCount,
  });
  if (atlasError) {
    report.atlas.status = "failed";
    report.atlas.error = atlasError;
    report.coverage.runtimeNotEvaluatedStates = registry.stateCount - report.coverage.intentionallyEmptyStates;
    report.coverage.runtimeFallbackStates = 0;
    report.coverage.runtimeTexturedCubeStates = 0;
    report.coverage.runtimeModelGeometryStates = 0;
    report.coverage.routesByFallbackReason = {};
    report.states = report.states.map((entry) => entry.route === "not_evaluated"
      ? { ...entry, fallbackReason: "ATLAS_BUILD_FAILED" }
      : entry);
  }

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) writeFileSync(outputPath, serialized, { encoding: "utf8", flag: "w" });
  const stdoutReport = outputPath
    ? {
        target: report.target,
        source: report.source,
        assets: report.assets,
        atlas: report.atlas,
        coverage: {
          ...report.coverage,
          fallbackDiagnostics: report.coverage.fallbackDiagnostics.map((entry) => ({
            reason: entry.reason,
            fallbackStateCount: entry.fallbackStateCount,
            uniqueBlockCount: entry.uniqueBlockCount,
            ...(entry.unsupportedTintFaceCount === undefined ? {} : { unsupportedTintFaceCount: entry.unsupportedTintFaceCount }),
            ...(entry.tintProviderTypes === undefined ? {} : { tintProviderTypes: entry.tintProviderTypes }),
            suggestedRemediation: entry.suggestedRemediation,
            fullBlockAndStateDetails: `See ${outputPath}`,
          })),
        },
        reportPath: outputPath,
      }
    : report;
  process.stdout.write(`${JSON.stringify(stdoutReport, null, 2)}\n`);
  atlas?.dispose();
}

const invokedScript = process.argv[1]?.replace(/\\/g, "/").toLowerCase();
if (invokedScript?.endsWith("/audit-mc263-coverage.ts")) {
  void runCli(process.argv.slice(2)).catch((cause: unknown) => {
    process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  });
}
