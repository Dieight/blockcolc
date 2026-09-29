import * as THREE from "three";
import { FrameRequestScheduler, PointerOwnership, type ReleasedPointer } from "./input-frame-scheduler";
import { cameraZoomBounds, clampCameraDistance } from "./camera-zoom";
import type { BlockFace, ResourcePackManifest } from "@blockcolc/resource-pack";
import { BlueprintV1, resolveBuiltinBlueprint, validateBlueprint, type BlueprintVoxel } from "./blueprint";
import {
  clusterEmissivePoints,
  emissiveColorForPoint,
  registerEmissivePoint,
  selectEmissiveVisualPoints,
  sourceCandleEmissionForVoxel,
  sourceLanternEmissionForVoxel,
  effectiveEmissionIdentity,
  shadowDirectionFromPosition,
  shadowLightPositionForExtent,
  lightingDirectionFingerprint,
  sunStateForLocalTime,
  type EmissivePoint,
  type SunState,
} from "./lighting";
import { sunStateForAstronomy } from "./astronomy-visual";
import { astronomyDayAt, type AstronomyContext } from "./astronomy";
import {
  cloudBudgetForView,
  cloudAdvectionSpeed,
  conditionVisualForVoxels,
  decorationsForProject,
  effectiveWeatherOverride,
  fogRangeForView,
  localDateForDate,
  precipitationParticleCount,
  weatherForLocalDate,
  weatherForExternalOverride,
  ambientScaleForWeather,
  sunlightScaleForWeather,
  weatherVisualForWeather,
  type ExternalWeatherVisualOverride,
  type WeatherState,
} from "./environment";
import {
  layoutVillage,
  placeImportedDecorations,
  roadCellsForVillage,
  type ImportedDecorationPlacement,
  type RoadCell,
  type VillagePlacement,
} from "./village";
import {
  createRoadGeometryData,
  createSteppedTerrainData,
  terrainGenerationInputKey,
  settlementSupportHeightForPlacement,
  supportGroundHeightAt,
  type MergedGeometryData,
  type TerrainEnvironmentStyle,
  type TerrainGenerationVersion,
  type TerrainPad,
} from "./terrain";
import {
  lowerQualityTier,
  QUALITY_PROFILES,
  selectQualityTierForLighting,
  type QualityProfile,
  type QualityTier,
  type VoxelLightingQuality,
} from "./quality";
import { attemptQualityProjection, resolveCappedQualityTier } from "./quality-projection";
import {
  buildResourcePackAtlas,
  createAtlasMaterial,
  createTextureBatches,
  createTexturedBoxGeometry,
  patchFluidSurfaceVertexShader,
  packFaceUvTransform,
  cropAtlasTilePixels,
  resolvePackTileRect,
  type ResourcePackAtlas,
  type ResourcePackAtlasPage,
  type TexturedVoxelBatch,
  type TexturedVoxelPlan,
} from "./resource-textures";
import { planResourceFluidBatches, planResourceWaterloggedFluidBatches } from "./resource-fluids";
import { isVisuallyEmptyVanillaBlock } from "./resource-empty-blocks";
import { addResourceSpecialPortals } from "./resource-special-portals";
import { addResourceSpecialDecor } from "./resource-special-decor";
import { addResourceSpecialBoxes } from "./resource-special-boxes";
import { addResourceSpecialFigures } from "./resource-special-figures";
import { planMovingPistonRenderVoxels } from "./resource-special-piston";
import { createStaticBlockEntityDisplayRenderer } from "./resource-special-block-entity";
import { applyMaterialEffects, type MaterialEffectsPatch } from "./material-effects";
import { atlasShadowPolicy, createAtlasCutoutDepthMaterial, disposeAtlasDepthMaterial } from "./atlas-depth-material";
import { constructionRevealPlans, constructionRevealScale, constructionWaveSchedule } from "./construction-reveal";
import { createAtlasAnimationController, type AtlasAnimationController } from "./atlas-animation";
import {
  createAtlasGeometry,
  createAtlasGeometryCutoutDepthMaterial,
  createAtlasGeometryMaterial,
  createGeometryBatches,
  disposeAtlasGeometryMeshResources,
  applyGeometryMeshRenderPolicy,
  isP2GeometryBlock,
  type GeometryVoxelBatch,
} from "./resource-geometry";
import {
  LIGHTWEIGHT_SHADING_PROFILES,
  shouldRefreshShadow,
  type ShadowRefreshReason,
  type ShadowRefreshSample,
} from "./lightweight-shading";
import { blockOcclusionFor, createLocalOcclusionField, type LocalOcclusionField } from "./local-occlusion";
import { materialResponse, materialResponseForMaterialId } from "./material-response";
import {
  fallbackVisualStyleForOriginalComponent,
  fallbackVisualStyleForVoxel,
  parseFallbackVisualKey,
  staticFluidHeight,
  staticFluidKind,
} from "./fallback-visual";
import {
  createOriginalMaterialTexture,
  createPlanarQuadUvs,
  originalPatternForMaterialId,
  type OriginalMaterialPattern,
} from "./original-materials";
import { LightingPostProcessor } from "./lighting-postprocess";
import { cloneEnvironmentRevealMaterial } from "./environment-reveal-material";
import { addOriginalFlowerShapes, naturalFlowerSourceBlockId } from "./original-flower-shapes";
import { disableNaturalFlowerShadowCasting } from "./natural-flower-shadow";
import { planNaturalFlowerPackBatches } from "./natural-flower-pack";
import {
  emptyPrecipitationViewCache,
  invalidatePrecipitationViewCache,
  rainParticleInstanceCoordinate,
  rainParticleMatricesNeedRewrite,
  updatePrecipitationViewCache,
  type PrecipitationViewCache,
} from "./precipitation-view-cache";
import {
  createOriginalStaticShapeComponentGeometry,
  createOriginalStaticShapeGeometry,
  groupOriginalStaticShapeEntries,
  isOriginalStaticShapeBlockId,
  planOriginalStaticShapeBatches,
} from "./original-static-shapes";
import { initializeWorldConfiguration } from "./initial-world-configuration";
import { ambientEnvironmentDecorations, naturalDecorationBatchDiagnostics, naturalDecorationLodForCamera, naturalDecorationParts, naturalDecorationVariantVisible, naturalTreeMushroomCandidates, NATURAL_SHELF_MUSHROOM_RENDER_SCALE, visibleNaturalTreeCount, type NaturalDecorationKind, type NaturalDecorationLod, type NaturalDecorationPart, type NaturalDecorationPlacement } from "./natural-decorations";
import { naturalTreeAttachmentMatrix } from "./natural-tree-attachment";
import { precipitationFieldForView, precipitationPositionForOffset, rainCrossSectionScaleForView, stepPrecipitationClock, type PrecipitationField } from "./precipitation-field";
import { commitRenderedWorldFrame, emptyWorldFrameCommitDiagnostics } from "./world-frame-commit";
import { qualityLifecycleAtlasInstance, qualityLifecycleProbe, qualityLifecycleProbeEnabled, qualityLifecycleSampleVisibleFrameError } from "./quality-lifecycle-probe";
import { qualityLifecycleWorldIdentity } from "./quality-lifecycle-world-identity";

export interface WorldSnapshot {
  projectId: string;
  blueprintId: string;
  buildingCompletionBasisPoints: number;
  buildingConditionBasisPoints: number;
  isMonument: boolean;
  /** Current project marker used only by local construction-outline presentation. */
  isActive?: boolean;
  settlementIndex: number;
  /** Reached daily-goal dates assigned to this project. Derived from domain history, never stored here. */
  decorationDates?: readonly string[];
  importedDecorations?: readonly ImportedDecorationSnapshot[];
}

export type ConstructionOutlineVisibility = "off" | "current" | "all";

export interface ImportedDecorationSnapshot {
  rewardId: string;
  resourceId: string;
  date: string;
  blueprint: BlueprintV1;
  localPosition: { x: number; z: number };
  rotationQuarterTurns: 0 | 1 | 2 | 3;
}

export interface PositionedWorldSnapshot extends WorldSnapshot {
  worldPosition: { x: number; y: number; z: number };
  rotationY: number;
  entrance: { x: number; z: number };
  footprint: { width: number; depth: number };
  blueprintOffset: { x: number; z: number };
  blueprint: BlueprintV1;
}

export interface NativeInputSample {
  active: boolean;
  dx: number;
  dy: number;
  sequence: number;
  nativeInputUptimeMs: number;
  nativeDispatchUptimeMs: number;
}

interface PrecipitationParticle {
  x: number;
  z: number;
  offsetX: number;
  offsetZ: number;
  phase: number;
}

interface PrecipitationAnimation {
  mesh: THREE.InstancedMesh;
  particles: readonly PrecipitationParticle[];
  baseY: number;
  spanY: number;
  elapsedMs: number;
  lastUpdateMs: number;
  paused: boolean;
  field: PrecipitationField;
}

interface RainAnimation extends PrecipitationAnimation {
  speedScale: number;
  baseCrossSection: number;
  projectedCssPx: number;
}

type SnowAnimation = PrecipitationAnimation;

export interface RendererDiagnostics {
  qualityTier: QualityTier;
  pixelRatio: number;
  render: { calls: number; triangles: number; points: number; lines: number };
  memory: { geometries: number; textures: number };
  /** Complete scene rebuilds since this renderer instance was created. */
  worldRebuildCount: number;
  /** Rebuilds with a successful visible non-empty renderer submission. */
  renderedWorldRebuildCount: number;
  /** performance.now() at the last successful visible non-empty world submission. */
  lastWorldFrameCommittedAtMs: number | null;
  naturalFlowerPackPlacementCount: number;
  naturalFlowerOriginalFallbackCount: number;
  naturalFlowerVisibleBatchCount: number;
  treeSideMushroomCount: number;
  worldRebuildLastMs: number;
  worldRebuildTotalMs: number;
  worldRebuildMaxMs: number;
  /** Time from renderer construction to its first rendered non-empty scene. */
  firstNonemptyFrameMs: number | null;
  interactionP95Ms: number | null;
  interactionTotalP95Ms: number | null;
  interactionTotalMaxMs: number;
  interactionAnimationFrameP95Ms: number | null;
  interactionAnimationFrameMaxMs: number;
  interactionDelayedFrameCount: number;
  nearDetailLevel: "far" | "near";
  edgeDetailStrength: number;
  gpuTimerAvailable: boolean;
  gpuRenderP95Ms: number | null;
  gpuRenderMaxMs: number;
  gpuRenderSampleCount: number;
  pointerMoveCount: number;
  resizeCount: number;
  shadowToggleCount: number;
  shadowTransformSyncCount: number;
  shadowTransformSyncTotalMs: number;
  shadowTransformSyncMaxMs: number;
  activeResourcePackId: string | null;
  atlasPageCount: number;
  texturedBatchCount: number;
  texturedVoxelCount: number;
  resourceFluidVoxelCount: number;
  resourceFluidAnimatedTextureCount: number;
  resourceSpecialVoxelCount: number;
  constructionPulseCount: number;
  fallbackVoxelCount: number;
  originalMaterialTextureCount: number;
  transformedUvVoxelCount: number;
  geometrySignatureBatchCount: number;
  geometryVoxelCount: number;
  geometryElementInstanceCount: number;
  geometryQuadInstanceCount: number;
  multipartGeometryVoxelCount: number;
  translucentGeometryVoxelCount: number;
  tintedVoxelCount: number;
  animatedTextureCount: number;
  availableAnimatedTextureCount: number;
  animationFrameUpdateCount: number;
  animationInterpolatedTextureCount: number;
  animationScheduled: boolean;
  visualBiomeSource: "original" | "resource-pack";
  visualBiomeGrass: number;
  visualBiomeFoliage: number;
  shaderDetail: QualityTier;
  shadowRefreshCount: number;
  shadowRefreshReason: ShadowRefreshReason | "none";
  cutoutShadowMeshCount: number;
  dayPhase: SunState["phase"];
  /** Current local-time sample and the actual light/shadow vectors applied. */
  lightingUpdateCount: number;
  astronomySource: "synthetic" | "ephemeris-only" | "provider+ephemeris";
  astronomyLocationSource: "none" | "fresh" | "cached";
  sunAltitudeDeg: number | null;
  sunAzimuthDeg: number | null;
  moonAltitudeDeg: number | null;
  moonAzimuthDeg: number | null;
  moonIllumination: number | null;
  astronomyDayStartMs: number | null;
  astronomyDayEndMs: number | null;
  astronomyUpdateCount: number;
  environmentTransitionActive: boolean;
  environmentTransitionTarget: "weather" | "decay" | "astronomy" | "synthetic";
  environmentTransitionStartedCount: number;
  environmentTransitionCompletedCount: number;
  environmentTransitionCancelledCount: number;
  openingRevealStartedCount: number;
  openingRevealCompletedCount: number;
  openingRevealCancelledCount: number;
  lightingSampledAtMs: number;
  lightingFingerprint: string;
  sunPosition: readonly [number, number, number];
  moonPosition: readonly [number, number, number];
  shadowDirection: readonly [number, number, number];
  skyLayerCount: 3;
  sunVisibility: number;
  moonVisibility: number;
  sunInView: boolean;
  moonInView: boolean;
  moonScreenX: number;
  moonScreenY: number;
  visibleStarCount: number;
  cloudBlockCount: number;
  visibleCloudBlockCount: number;
  cloudBudgetMode: "main-world" | "preview";
  cloudBlockScale: number;
  weatherKind: WeatherState["kind"];
  weatherCloudIntensity: number;
  weatherPrecipitationIntensity: number;
  weatherVisualPrecipitationIntensity: number;
  rainDropCount: number;
  visibleRainDropCount: number;
  snowFlakeCount: number;
  visibleSnowFlakeCount: number;
  precipitationFieldMode: "main-world" | "preview";
  precipitationFieldCenterX: number;
  precipitationFieldCenterZ: number;
  precipitationFieldSpanX: number;
  precipitationFieldSpanZ: number;
  precipitationFieldUsedFallback: boolean;
  precipitationFieldSyncCount: number;
  rainCameraFrustumCount: number;
  snowCameraFrustumCount: number;
  precipitationMotionPaused: boolean;
  rainElapsedMs: number;
  snowElapsedMs: number;
  rainStreakProjectedCssPx: number;
  fogNear: number;
  fogFar: number;
  cameraNear: number;
  cameraFar: number;
  visibilityNearestDistance: number;
  visibilityFarthestDistance: number;
  visibilityNearClipSafe: boolean;
  visibilityFarClipSafe: boolean;
  atmosphereFollowsWorld: boolean;
  terrainWaterOpaque: boolean;
  glowSpriteCount: number;
  visibleGlowSpriteCount: number;
  glowSpriteMaximumScale: number;
  glowTextureSize: 32;
  glowTextureShape: "soft-square";
  requestedLightingQuality: VoxelLightingQuality;
  activeLightingQuality: "performance" | "balanced" | "cinematic";
  bloomEnabled: boolean;
  fullscreenPassCount: number;
  postProcessRenderCount: number;
  postProcessBypassCount: number;
  postProcessSampleCount: number;
  continuousRendering: false;
  /** V20: whether the throttled ambient motion pump is currently allowed to animate. */
  ambientMotionActive: boolean;
  /** V20: blocks still waiting to pop in the block-by-block construction reveal. */
  constructionRevealCount: number;
  lowLatencyWebGl: boolean;
  nativeInputReceivedCount: number;
  nativeInputLastSequence: number;
  nativeInputRenderedSequence: number;
  nativeInputTransport: "none" | "capacitor-event" | "direct-snapshot";
  constructionOutlineVisibility: ConstructionOutlineVisibility;
  plannedOutlineVoxelCount: number;
  ambientDecorationCount: number;
  ambientDecorationKindCount: number;
  ambientDecorationDrawCalls: number;
  ambientDecorationAllocatedBatchCount: number;
  ambientDecorationShadowCasters: number;
  localLightCreatedCount: number;
  visibleLocalLightCount: number;
  /** Static original silhouettes actually emitted; safe count only, no user text. */
  originalStaticShapeVoxelCount: number;
  /** Renderer instances grouped by topology and fallback visual material. */
  originalStaticShapeBatchCount: number;
  originalStaticShapeTopologyCount: number;
  originalStaticShapeMaterialGroupCount: number;
  originalStaticShapeEmissiveMaterialGroupCount: number;
  originalStaticShapeTopologyOverflow: number;
  originalStaticShapeMaterialGroupOverflow: number;
  originalStaticShapeBudgetFallbackVoxelCount: number;
  sourceLanternPointLightCount: number;
}

export interface VoxelResourcePack {
  id: string;
  manifest: ResourcePackManifest;
}

export interface VoxelRenderer {
  /** First bootstrap only: stage optional atlas and adopt the initial world with one scene rebuild. */
  initializeWorlds(worlds: readonly WorldSnapshot[], pack: VoxelResourcePack | null): Promise<void>;
  setWorld(world: WorldSnapshot | null): void;
  setWorlds(worlds: readonly WorldSnapshot[]): void;
  /** Updates sky, clouds, precipitation, and ambient light without rebuilding the world. */
  setExternalWeatherOverride(override: ExternalWeatherVisualOverride | null): void;
  setAstronomyContext(context: AstronomyContext | null): void;
  setEnvironmentDebugOverride(override: WorldEnvironmentDebugOverride | null): void;
  revealInitialProject(projectId?: string | null): Promise<"completed" | "cancelled">;
  /** Frames one existing building, or the complete settlement when null, without rebuilding scene geometry or lighting. */
  focusProject(projectId: string | null): void;
  setResourcePack(pack: VoxelResourcePack | null): Promise<void>;
  /** Applies a reversible visual profile to the current scene without replacing its world generation. */
  setLightingQuality(preference: VoxelLightingQuality): boolean;
  setReducedMotion(value: boolean): void;
  /** Pauses frame rendering and texture animation while the canvas pane is hidden (tab switches); resuming re-sizes and renders once. */
  setVisible(value: boolean): void;
  /** Brief bounded glow pulse for construction events (round completed, focus started); skipped under reduced motion. */
  playConstructionPulse(strength?: number): void;
  /**
   * V21 immersive composition: when a frosted band covers part of the
   * full-screen world (bottom on portrait, right-hand column on landscape), aim
   * the camera so the settlement sits in the visible window's center instead of
   * the full-canvas center. Each value is that band's size as a fraction of the
   * viewport (0 = no band on that side).
   */
  setImmersiveBandFraction(bottomFraction: number, rightFraction: number): void;
  resetCamera(): void;
  resize(): void;
  getDiagnostics(): RendererDiagnostics;
  dispose(): void;
}

export type BlueprintResolver = (id: string) => BlueprintV1;

const colors: Record<string, number> = {
  stone: 0x7f8b84,
  wood: 0x6f4e35,
  plank: 0xa9865d,
  roof: 0x6e3e32,
  glass: 0x8eb4b7,
  accent: 0xc3b18d,
  grass: 0x718365,
  dirt: 0x746650,
  terrainStone: 0x69736e,
  terrainWater: 0x4d7f86,
  terrainLava: 0xe96b23,
  leaves: 0x47704a,
  path: 0x9a8b72,
  vine: 0x3f7044,
  lamp: 0xf2c96d,
  flower: 0xd48ca1,
  "grass-tuft": 0x628a50,
  rock: 0x69746e,
  reed: 0x70a06f,
  coral: 0xc47f78,
  shipwreck: 0x6e4c38,
};

export interface WorldEnvironmentDebugOverride {
  date?: number | null;
  weather?: ExternalWeatherVisualOverride | null;
  /** Visual decay amount, 0..1. Null restores each world's real condition. */
  decayAmount?: number | null;
}

const DEFAULT_FACE_UV_WORDS = packFaceUvTransform();
const SKY_RADIUS = 120;
const MAX_STAR_COUNT = 960;
const STAR_RADIUS_RATIO = 0.91;
const CELESTIAL_RADIUS_RATIO = 0.82;
const SKY_FAR_CLIP_RATIO = 0.82;
const STAR_NEAR_CLIP_MARGIN = 1.5;
interface TrackedEmissiveMaterial {
  material: THREE.MeshStandardMaterial;
  level: number;
  kind: string;
}

interface TrackedLocalLight {
  light: THREE.PointLight;
  baseIntensity: number;
}

interface TrackedGlowSprite {
  sprite: THREE.Sprite;
}

interface DisjointTimerQueryWebGl2 {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export function layoutWorlds(
  worlds: readonly WorldSnapshot[],
  resolveBlueprint: BlueprintResolver = resolveBuiltinBlueprint,
): PositionedWorldSnapshot[] {
  const resolved = worlds.map((world) => ({ ...world, blueprint: validateBlueprint(resolveBlueprint(world.blueprintId)) }));
  const placements = layoutVillage(resolved);
  return resolved.map((world, index) => ({ ...world, ...placements[index]! }));
}

export function alignWorldsToEnvironment(
  worlds: readonly PositionedWorldSnapshot[],
  environmentStyle: TerrainEnvironmentStyle,
): PositionedWorldSnapshot[] {
  if (environmentStyle !== "ocean-island") return [...worlds];
  return worlds.map((world) => world.worldPosition.y >= 4
    ? world
    : { ...world, worldPosition: { ...world.worldPosition, y: 4 } });
}

/** Terrain-owned placements shared by production meshes and geometry regressions. */
export function naturalDecorationPlacementsForScene(input: {
  worlds: readonly PositionedWorldSnapshot[];
  roads: readonly RoadCell[];
  importedDecorations: readonly ImportedDecorationPlacement[];
  environmentStyle: TerrainEnvironmentStyle;
  terrain: MergedGeometryData;
  worldSeed?: string;
  qualityTier?: QualityTier;
}): readonly import("./natural-decorations").NaturalDecorationPlacement[] {
  const surfaces = terrainSurfaceRectangles(input.terrain);
  const bounds = input.terrain.framingBounds;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const step = THREE.MathUtils.clamp(span / 14, 8, 18);
  const roadKeys = new Set(input.roads.map(road => `${road.x}:${road.z}`));
  const occupied = [
    ...input.worlds.map(world => ({ x: world.worldPosition.x, z: world.worldPosition.z,
      width: world.footprint.width + 5, depth: world.footprint.depth + 5 })),
    ...input.importedDecorations.map(item => ({ x: item.worldPosition.x, z: item.worldPosition.z,
      width: item.footprint.width + 5, depth: item.footprint.depth + 5 })),
  ];
  const candidates: import("./natural-decorations").NaturalDecorationCandidate[] = [];
  for (let x = bounds.minX + 3; x <= bounds.maxX - 3; x += step) {
    for (let z = bounds.minZ + 3; z <= bounds.maxZ - 3; z += step) {
      if (occupied.some(rect => ambientWithinRect(x, z, rect)) || ambientNearRoad(x, z, roadKeys)) continue;
      const water = input.environmentStyle === "ocean-island"
        ? surfaces.find(rect => rect.water && x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ)
        : undefined;
      const ground = surfaces.find(rect => !rect.water && x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ);
      const surface = water ?? ground;
      if (surface) candidates.push({ x, z, y: surface.supportY, support: water ? "water" : "ground" });
    }
  }
  const visibleTreeCount = visibleNaturalTreeCount(input.terrain.naturalTrees.length, input.qualityTier ?? "high");
  const treeCandidates = naturalTreeMushroomCandidates(input.terrain.naturalTrees, visibleTreeCount)
    .filter(candidate => {
      const tree = input.terrain.naturalTrees[candidate.supportTreeIndex!];
      return tree !== undefined
        && !occupied.some(rect => ambientWithinRect(tree.x, tree.z, rect))
        && !ambientNearRoad(tree.x, tree.z, roadKeys)
        && !occupied.some(rect => ambientWithinRect(candidate.x, candidate.z, rect))
        && !ambientNearRoad(candidate.x, candidate.z, roadKeys);
    });
  candidates.push(...treeCandidates);
  if (input.environmentStyle === "ocean-island") {
    // The settlement frame intentionally excludes the shoreline. Restricting
    // candidate sampling to it silently produced no wreck anywhere in the sea.
    const shoreline = surfaces.filter(surface => surface.water).map(surface => ({
      x: (surface.minX + surface.maxX) / 2,
      z: (surface.minZ + surface.maxZ) / 2,
      y: surface.supportY,
      support: "water" as const,
    })).filter(point => !occupied.some(rect => ambientWithinRect(point.x, point.z, rect))
      && !ambientNearRoad(point.x, point.z, roadKeys))
      .sort((left, right) => left.x ** 2 + left.z ** 2 - right.x ** 2 - right.z ** 2
        || left.x - right.x || left.z - right.z).slice(0, 24);
    candidates.push(...shoreline);
  }
  return ambientEnvironmentDecorations({
    environmentStyle: input.environmentStyle,
    worldSeed: input.worldSeed ?? "world-default",
    candidates,
  });
}

function ambientWithinRect(x: number, z: number, rect: { x: number; z: number; width: number; depth: number }): boolean {
  return Math.abs(x - rect.x) <= rect.width / 2 && Math.abs(z - rect.z) <= rect.depth / 2;
}

function ambientNearRoad(x: number, z: number, roads: ReadonlySet<string>): boolean {
  const baseX = Math.round(x);
  const baseZ = Math.round(z);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) if (roads.has(`${baseX + dx}:${baseZ + dz}`)) return true;
  }
  return false;
}

function terrainSurfaceRectangles(terrain: MergedGeometryData): Array<{ minX: number; maxX: number; minZ: number; maxZ: number; supportY: number; water: boolean }> {
  const rectangles: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; supportY: number; water: boolean }> = [];
  for (const material of ["grass", "dirt", "stone", "water"] as const) {
    const indices = terrain.indicesByMaterial[material];
    for (let index = 0; index + 5 < indices.length; index += 6) {
      const points = [indices[index]!, indices[index + 1]!, indices[index + 2]!, indices[index + 5]!].map((vertex) => ({
        x: terrain.positions[vertex * 3]!,
        y: terrain.positions[vertex * 3 + 1]!,
        z: terrain.positions[vertex * 3 + 2]!,
      }));
      rectangles.push({
        minX: Math.min(...points.map((point) => point.x)),
        maxX: Math.max(...points.map((point) => point.x)),
        minZ: Math.min(...points.map((point) => point.z)),
        maxZ: Math.max(...points.map((point) => point.z)),
        // Terrain top vertices are half a block below the support datum used
        // by buildings/roads, so restore that shared datum for props.
        supportY: Math.max(...points.map((point) => point.y)) + 0.5,
        water: material === "water",
      });
    }
  }
  return rectangles;
}


function sameSpatialWorldLayout(left: readonly WorldSnapshot[], right: readonly WorldSnapshot[]): boolean {
  if (left.length !== right.length) return false;
  const byProject = new Map(left.map((world) => [world.projectId, world]));
  return right.every((world) => {
    const previous = byProject.get(world.projectId);
    return previous !== undefined
      && previous.blueprintId === world.blueprintId
      && previous.settlementIndex === world.settlementIndex;
  });
}

export function createVoxelRenderer(
  canvas: HTMLCanvasElement,
  options: {
    blueprint?: BlueprintV1;
    resolveBlueprint?: BlueprintResolver;
    resourcePackAtlasMaximumSize?: number;
    lightingQuality?: VoxelLightingQuality;
    constructionOutlineVisibility?: ConstructionOutlineVisibility;
    environmentStyle?: TerrainEnvironmentStyle;
    worldSeed?: string;
    terrainGenerationVersion?: TerrainGenerationVersion;
    onSelectProject?: (projectId: string) => void;
    /** Diagnostic: a light tap reports the terrain cell under the pointer. */
    onPickTerrain?: (position: { x: number; y: number; z: number }) => void;
    /** Previews keep the camera fitted to the building while terrain extends past the viewport. */
    previewMode?: boolean;
    /** Diagnostic mode: every part renders in a flat distinct color so visual bugs can be attributed. */
    debugFlatColors?: boolean;
    /** Diagnostic mode: real materials against a pure-black backdrop with fog off, so geometric holes read as black pixels and fog-faded faces keep their material color. */
    debugVoidScan?: boolean;
    readNativeInput?: () => NativeInputSample | null;
    subscribeNativeInput?: (listener: (sample: NativeInputSample) => void) => Promise<() => Promise<void>>;
  } = {},
): VoxelRenderer {
  const previewBlueprint = options.blueprint ? validateBlueprint(options.blueprint) : null;
  const resolveBlueprint = options.resolveBlueprint ?? ((id: string) => (
    previewBlueprint && previewBlueprint.id === id ? previewBlueprint : resolveBuiltinBlueprint(id)
  ));
  const requestedLowLatencyWebGl = options.previewMode !== true;
  const lowLatencyContext = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
    desynchronized: requestedLowLatencyWebGl,
  });
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context: lowLatencyContext ?? undefined,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.info.autoReset = false;
  const webGlContext = renderer.getContext();
  // Software rasterizers (SwiftShader/llvmpipe — headless gate machines, low-end
  // VMs) render the refined far-fine terrain mesh far slower than any real GPU.
  // Detect them once and let the terrain generator fall back to the classic
  // coarse far ring there, so expensive off-screen/gate environments stay
  // fluid while real devices keep the refined ring.
  const softwareRendererName = (() => {
    try {
      const debugInfo = webGlContext.getExtension("WEBGL_debug_renderer_info");
      const raw = String(debugInfo
        ? webGlContext.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : webGlContext.getParameter(webGlContext.RENDERER));
      return /swiftshader|llvmpipe|software|mesa offscreen/i.test(raw);
    } catch {
      return false;
    }
  })();
  const webGl2Context = typeof WebGL2RenderingContext !== "undefined" && webGlContext instanceof WebGL2RenderingContext
    ? webGlContext
    : null;
  const gpuTimerExtension = webGl2Context
    ? webGl2Context.getExtension("EXT_disjoint_timer_query_webgl2") as DisjointTimerQueryWebGl2 | null
    : null;
  const lowLatencyWebGl = renderer.getContext().getContextAttributes()?.desynchronized === true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.type = options.previewMode ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0xb9c8bd, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 500);
  const rotatableWorldRoot = new THREE.Group();
  rotatableWorldRoot.name = "rotatableWorldRoot";
  const terrainGroup = new THREE.Group();
  terrainGroup.name = "terrain";
  const roadGroup = new THREE.Group();
  roadGroup.name = "roads";
  const buildingGroup = new THREE.Group();
  buildingGroup.name = "buildingsAndDecorations";
  const blockEntityDisplay = createStaticBlockEntityDisplayRenderer();
  const lightRig = new THREE.Group();
  lightRig.name = "worldLightRig";
  const localLightGroup = new THREE.Group();
  localLightGroup.name = "clusteredLocalLights";
  lightRig.add(localLightGroup);
  const atmosphereGroup = new THREE.Group();
  atmosphereGroup.name = "atmosphere";
  rotatableWorldRoot.add(terrainGroup, roadGroup, buildingGroup, lightRig, atmosphereGroup);
  scene.add(rotatableWorldRoot);
  const skyGroup = new THREE.Group();
  skyGroup.name = "layeredSky";
  scene.add(skyGroup);

  const skyGeometry = new THREE.SphereGeometry(SKY_RADIUS, 24, 12);
  skyGeometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(skyGeometry.getAttribute("position").count * 3), 3));
  const skyMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
  skyDome.name = "threeLayerSkyDome";
  skyDome.renderOrder = -1000;
  skyDome.frustumCulled = false;
  skyGroup.add(skyDome);

  const starGeometry = createStarGeometry(MAX_STAR_COUNT, SKY_RADIUS * STAR_RADIUS_RATIO);
  const starMaterial = new THREE.PointsMaterial({
    color: 0xdce8ff, size: 1.45, sizeAttenuation: false,
    transparent: false, depthWrite: false, depthTest: false, fog: false,
  });
  const starField = new THREE.Points(starGeometry, starMaterial);
  starField.name = "deterministicStars";
  starField.renderOrder = -998;
  starField.frustumCulled = false;
  skyGroup.add(starField);

  const hemisphere = new THREE.HemisphereLight(0xf4f0dc, 0x4d6659, 1.42);
  lightRig.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffedc5, 3.2);
  sun.target.position.set(0, 2, 0);
  sun.castShadow = true;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.018;
  lightRig.add(sun, sun.target);
  const sunSpriteMaterial = new THREE.SpriteMaterial({ color: 0xffe2a1, transparent: true, opacity: 1, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  const moonPhaseUniforms = {
    uMoonIllumination: { value: 1 },
    uMoonWaxing: { value: 1 },
    uMoonBrightLimbAngle: { value: 0 },
  };
  const moonSpriteMaterial = new THREE.SpriteMaterial({
    color: 0xd7e3ef, transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
  });
  (moonSpriteMaterial as THREE.SpriteMaterial & { onBeforeCompile: THREE.Material["onBeforeCompile"] }).onBeforeCompile = function (shader) {
      Object.assign(shader.uniforms, moonPhaseUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uMoonIllumination;\nuniform float uMoonWaxing;\nuniform float uMoonBrightLimbAngle;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          vec2 moonUv = vUv * 2.0 - 1.0;
          float moonRadiusSq = dot(moonUv, moonUv);
          if (moonRadiusSq > 1.0) discard;
          float moonCosPhase = clamp(2.0 * uMoonIllumination - 1.0, -1.0, 1.0);
          float moonLimb = sqrt(max(0.0, 1.0 - moonCosPhase * moonCosPhase)) * uMoonWaxing;
          float moonAngleCos = cos(uMoonBrightLimbAngle);
          float moonAngleSin = sin(uMoonBrightLimbAngle);
          vec2 moonRotated = vec2(moonUv.x * moonAngleCos - moonUv.y * moonAngleSin,
                                  moonUv.x * moonAngleSin + moonUv.y * moonAngleCos);
          vec3 moonNormal = vec3(moonRotated, sqrt(max(0.0, 1.0 - moonRadiusSq)));
          vec3 moonLightDirection = normalize(vec3(moonLimb, 0.0, moonCosPhase));
          float moonLit = smoothstep(-0.035, 0.035, dot(moonNormal, moonLightDirection));
          diffuseColor.rgb *= mix(0.12, 1.0, moonLit);
          diffuseColor.a *= smoothstep(0.0, 0.06, 1.0 - moonRadiusSq);`);
    };
  const glowTexture = createLampGlowTexture();
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffb45f,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const glowMaterials = new Map<number, THREE.SpriteMaterial>([
    [0xffb45f, glowMaterial],
    [0x65cfe3, glowMaterial.clone()],
    [0xe94b35, glowMaterial.clone()],
  ]);
  for (const [color, spriteMaterial] of glowMaterials) spriteMaterial.color.setHex(color);
  const sunSprite = new THREE.Sprite(sunSpriteMaterial);
  sunSprite.name = "squareSun";
  sunSprite.scale.set(8.5, 8.5, 1);
  sunSprite.renderOrder = -997;
  const moonSprite = new THREE.Sprite(moonSpriteMaterial);
  moonSprite.name = "squareMoon";
  moonSprite.scale.set(6.2, 6.2, 1);
  moonSprite.renderOrder = -997;
  // Celestial sprites belong to the camera-centred sky, not the settlement
  // light rig. The directional light remains world-anchored for stable shadows.
  skyGroup.add(sunSprite, moonSprite);

  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const originalMaterialTextures = new Map<OriginalMaterialPattern, THREE.DataTexture>();
  let emissiveMaterials: TrackedEmissiveMaterial[] = [];
  let localLights: TrackedLocalLight[] = [];
  let glowSprites: TrackedGlowSprite[] = [];
  let reducedMotion = false;
  let disposed = false;
  /** False while the canvas pane is hidden (tab switch); frame rendering pauses until setVisible(true). */
  let paneVisible = true;
  let constructionPulseUntilMs = 0;
  let constructionPulseStartedMs = 0;
  let constructionPulseStrength = 0;
  let constructionPulseCount = 0;
  let contentBounds = defaultContentBounds();
  let visibilityBounds = defaultContentBounds();
  let terrainBoundsBox = defaultContentBounds();
  let visibilityNearestDistance = 0;
  let visibilityFarthestDistance = 0;
  let currentWeather: WeatherState = weatherForLocalDate(localDateForDate(new Date()));
  let externalWeatherOverride: ExternalWeatherVisualOverride | null = null;
  let astronomyContext: AstronomyContext | null = null;
  let environmentDebugOverride: WorldEnvironmentDebugOverride | null = null;
  let lightingTransition: { from: SunState; startedAtMs: number; durationMs: number } | null = null;
  let environmentReveal: { startedAtMs: number; durationMs: number; target: "weather" | "decay";
    objects: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }>;
    clones: Map<THREE.Material, { material: THREE.Material; opacity: number }> } | null = null;
  let decayRevealRequested = false;
  let environmentTransitionStartedCount = 0;
  let environmentTransitionCompletedCount = 0;
  let environmentTransitionCancelledCount = 0;
  let astronomyUpdateCount = 0;
  let openingReveal: { fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromDistance: number; toDistance: number; startedAtMs: number; durationMs: number; resolve: (result: "completed" | "cancelled") => void } | null = null;
  let openingRevealStartedCount = 0;
  let openingRevealCompletedCount = 0;
  let openingRevealCancelledCount = 0;
  let currentLighting = sunStateForLocalTime(new Date());
  let lightingUpdateCount = 0;
  let lightingSampledAtMs = Date.now();
  let requestedLightingQuality = options.lightingQuality ?? "auto";
  const constructionOutlineVisibility = options.constructionOutlineVisibility ?? "current";
  let qualityTier = selectQualityTierForLighting(deviceSignals(renderer, 0), requestedLightingQuality);
  let qualityProfile = QUALITY_PROFILES[qualityTier];
  let adaptiveQualityCap: QualityTier = "high";
  const fallbackOcclusionMeshes = new Map<THREE.InstancedMesh, { voxels: BlueprintV1["voxels"]; field: LocalOcclusionField }>();
  let interactionFrameDurations: number[] = [];
  let interactionTotalDurations: number[] = [];
  let interactionTotalMaxMs = 0;
  let interactionAnimationFrameIntervals: number[] = [];
  let interactionAnimationFrameMaxMs = 0;
  let interactionDelayedFrameCount = 0;
  let lastInteractionAnimationFrameMs: number | null = null;
  let gpuTimerAvailable = webGl2Context !== null && gpuTimerExtension !== null;
  let gpuTimerQuery: WebGLQuery | null = null;
  let gpuTimerQueryInteracting = false;
  let gpuRenderDurations: number[] = [];
  let gpuRenderMaxMs = 0;
  const lightingPostProcessor = new LightingPostProcessor(renderer);
  let postProcessRenderCount = 0;
  let postProcessBypassCount = 0;
  const rendererCreatedAtMs = performance.now();
  const lifecycleProbeEnabled = qualityLifecycleProbeEnabled();
  function buildQualityLifecycleAtlas(manifest: ResourcePackManifest, maximumSize: number): ResourcePackAtlas {
    const startedAt = lifecycleProbeEnabled ? performance.now() : 0;
    try {
      const atlas = buildResourcePackAtlas(manifest, maximumSize);
      if (lifecycleProbeEnabled) {
        const durationMs = performance.now() - startedAt;
        const atlasInstance = qualityLifecycleAtlasInstance(atlas);
        const atlasTextureCount = atlas.pages.reduce((count, page) => count + 1 + (page.animationLookup ? 2 : 0), 0);
        qualityLifecycleProbe("atlas-build-complete", {
          durationMs, rendererGeneration: Number(canvas.dataset.rendererGeneration ?? 0),
          atlasInstance, atlasPageCount: atlas.pages.length, atlasTextureCount, status: "ok",
        });
      }
      return atlas;
    } catch (error) {
      if (lifecycleProbeEnabled) qualityLifecycleProbe("atlas-build-complete", { durationMs: performance.now() - startedAt, status: "failed" });
      throw error;
    }
  }
  function disposeQualityLifecycleAtlas(atlas: ResourcePackAtlas | null | undefined): void {
    if (!atlas) return;
    if (lifecycleProbeEnabled) qualityLifecycleProbe("atlas-disposed", {
      rendererGeneration: Number(canvas.dataset.rendererGeneration ?? 0),
      atlasInstance: qualityLifecycleAtlasInstance(atlas),
      atlasPageCount: atlas.pages.length,
      atlasTextureCount: atlas.pages.reduce((count, page) => count + 1 + (page.animationLookup ? 2 : 0), 0),
      status: "ok",
    });
    atlas.dispose();
  }
  function lifecycleIdentityMetrics() {
    if (!lifecycleProbeEnabled) return {};
    const atlas = activeResourcePack?.atlas;
    return {
      rendererGeneration: Number(canvas.dataset.rendererGeneration ?? 0),
      worldIdentityFingerprint: qualityLifecycleWorldIdentity(
        lastWorlds, options.worldSeed, options.environmentStyle ?? "classic-island", options.terrainGenerationVersion,
      ),
      ...(atlas ? {
        atlasInstance: qualityLifecycleAtlasInstance(atlas),
        atlasPageCount: atlas.pages.length,
        atlasTextureCount: atlas.pages.reduce((count, page) => count + 1 + (page.animationLookup ? 2 : 0), 0),
      } : {}),
    };
  }
  let worldRebuildCount = 0;
  let worldFrameCommit = emptyWorldFrameCommitDiagnostics;
  let worldRebuildLastMs = 0;
  let worldRebuildTotalMs = 0;
  let worldRebuildMaxMs = 0;
  let terrainGenerationCache: { key: string; data: MergedGeometryData } | null = null;
  let firstNonemptyFrameMs: number | null = null;
  let qualityFramePendingSinceMs: number | null = null;
  let pointerMoveCount = 0;
  let resizeCount = 0;
  let shadowToggleCount = 0;
  let shadowTransformSyncTotalMs = 0;
  let shadowTransformSyncMaxMs = 0;
  let interacting = false;
  let nativeInputActive = false;
  let nativeInputDeltaX = 0;
  let nativeInputDeltaY = 0;
  let nativeInputLastSequence = 0;
  let nativeInputRenderedSequence = 0;
  let nativeInputUnsubscribe: (() => Promise<void>) | null = null;
  let nativeInputReceivedCount = 0;
  const nativeInputTransport: RendererDiagnostics["nativeInputTransport"] = options.readNativeInput
    ? "direct-snapshot"
    : options.subscribeNativeInput
      ? "capacitor-event"
      : "none";

  function consumeNativeInput(sample: NativeInputSample | null): void {
    if (disposed || !sample || sample.sequence <= nativeInputLastSequence) return;
    nativeInputLastSequence = sample.sequence;
    nativeInputActive = sample.active;
    nativeInputDeltaX += sample.dx;
    nativeInputDeltaY += sample.dy;
    nativeInputReceivedCount += 1;
  }

  function pollNativeInput(): void {
    if (!options.readNativeInput) return;
    try { consumeNativeInput(options.readNativeInput()); } catch { /* A missing native bridge falls back to DOM input. */ }
  }

  function finishOpeningReveal(result: "completed" | "cancelled"): void {
    const reveal = openingReveal;
    if (!reveal) return;
    openingReveal = null;
    if (result === "completed") openingRevealCompletedCount += 1;
    else openingRevealCancelledCount += 1;
    canvas.dataset.openingRevealState = result;
    canvas.dataset.initialRevealCompletedCount = String(openingRevealCompletedCount);
    canvas.dataset.initialRevealCancelledCount = String(openingRevealCancelledCount);
    reveal.resolve(result);
    updateDiagnosticsDataset();
  }

  function updateOpeningReveal(nowMs: number): boolean {
    const reveal = openingReveal;
    if (!reveal) return false;
    if (disposed || !paneVisible || document.hidden || reducedMotion || interacting) {
      finishOpeningReveal("cancelled");
      return false;
    }
    const progress = Math.min(1, Math.max(0, (nowMs - reveal.startedAtMs) / reveal.durationMs));
    const eased = smoothstep(0, 1, progress);
    cameraTarget.lerpVectors(reveal.fromTarget, reveal.toTarget, eased);
    cameraDistance = reveal.fromDistance + (reveal.toDistance - reveal.fromDistance) * eased;
    updateCamera();
    canvas.dataset.openingRevealProgress = eased.toFixed(3);
    if (progress >= 1) {
      finishOpeningReveal("completed");
      return false;
    }
    return true;
  }

  function startOpeningReveal(projectId?: string | null): Promise<"completed" | "cancelled"> {
    if (openingReveal) finishOpeningReveal("cancelled");
    if (disposed || !paneVisible || document.hidden || reducedMotion || positionedWorlds.length === 0) {
      openingRevealCancelledCount += 1;
      canvas.dataset.openingRevealState = "cancelled";
      updateDiagnosticsDataset();
      return Promise.resolve("cancelled");
    }
    frameScene(true);
    const fromTarget = cameraTarget.clone();
    const fromDistance = maximumCameraDistance;
    cameraDistance = fromDistance;
    updateCamera();
    let toTarget = fromTarget.clone();
    // Settlement opening (minimal and marathon) must traverse the complete
    // approved zoom range, not stop at the intermediate fit distance.
    let toDistance = minimumCameraDistance;
    const project = projectId ? positionedWorlds.find(world => world.projectId === projectId) : undefined;
    if (project) {
      const bounds = focusBoundsFor(project);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(6, size.length() / 2);
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.1, camera.aspect));
      const fit = (radius / Math.sin(Math.max(0.1, Math.min(verticalFov, horizontalFov)) / 2)) * 1.04;
      const boundsForFocus = cameraZoomBounds(fit, "focused");
      toDistance = THREE.MathUtils.clamp(fit * 0.84, boundsForFocus.minimum, boundsForFocus.maximum);
      toTarget = new THREE.Vector3(center.x, Math.max(1.5, center.y * 0.68), center.z);
    }
    openingRevealStartedCount += 1;
    canvas.dataset.openingRevealState = "active";
    canvas.dataset.initialRevealStartedCount = String(openingRevealStartedCount);
    canvas.dataset.openingRevealProjectTarget = project ? "focused" : "settlement";
    canvas.dataset.openingRevealFromDistance = fromDistance.toFixed(3);
    canvas.dataset.openingRevealToDistance = toDistance.toFixed(3);
    updateDiagnosticsDataset();
    return new Promise(resolve => {
      openingReveal = {
        fromTarget, toTarget, fromDistance, toDistance,
        startedAtMs: performance.now(), durationMs: 1_500, resolve,
      };
      requestRender();
    });
  }

  let sceneVoxelCount = 0;
  let plannedOutlineVoxelCount = 0;
  let fittedDistance = 24;
  let cameraDistance = 24;
  let minimumCameraDistance = fittedDistance * 0.65;
  let maximumCameraDistance = fittedDistance * 1.35;
  let positionedWorlds: readonly PositionedWorldSnapshot[] = [];
  let focusedProjectId: string | null = null;
  let cameraPitch = THREE.MathUtils.degToRad(38);
  const defaultCameraPitch = THREE.MathUtils.degToRad(38);
  let cameraAzimuth = Math.PI / 4;
  const defaultCameraAzimuth = Math.PI / 4;
  let targetCameraPitch = cameraPitch;
  let targetCameraAzimuth = cameraAzimuth;
  let lastCameraUpdateMs = performance.now();
  const cameraTarget = new THREE.Vector3(0, 3, 0);
  const settlementProjected = new THREE.Vector3();
  /** V21: fraction of the viewport covered by the immersive bottom band (0 = none). */
  let immersiveBottomBand = 0;
  /** V21: fraction of the viewport covered by the immersive right-hand column (0 = none). */
  let immersiveRightBand = 0;
  const pointerOwnership = new PointerOwnership(2_500);
  let previousPinchDistance: number | null = null;
  let previousPinchCenterY: number | null = null;
  let cachedShadowTransformSyncs = 0;
  let lastWorlds: readonly WorldSnapshot[] = [];
  let resourcePackGeneration = 0;
  let activeResourcePack: { id: string; manifest: ResourcePackManifest; atlas: ResourcePackAtlas } | null = null;
  let atlasAnimationControllers: Array<AtlasAnimationController | null> = [];
  const referencedAnimatedTextureIndices = new Map<number, Set<number>>();
  const referencedFluidAnimatedTextures = new Set<string>();
  const fluidAvailableAnimationIndices = new Map<number, Set<number>>();
  let texturedBatchCount = 0;
  let texturedVoxelCount = 0;
  let originalStaticShapeVoxelCount = 0;
  let originalStaticShapeBatchCount = 0;
  let originalStaticShapeTopologyCount = 0;
  let originalStaticShapeMaterialGroupCount = 0;
  let originalStaticShapeEmissiveMaterialGroupCount = 0;
  let originalStaticShapeTopologyOverflow = 0;
  let originalStaticShapeMaterialGroupOverflow = 0;
  let originalStaticShapeBudgetFallbackVoxelCount = 0;
  let sourceLanternPointLightCount = 0;
  const emissivePointColors = new Map<string, number>();
  let resourceFluidVoxelCount = 0;
  let resourceSpecialVoxelCount = 0;
  let fallbackVoxelCount = 0;
  let transformedUvVoxelCount = 0;
  let geometrySignatureBatchCount = 0;
  let geometryVoxelCount = 0;
  let geometryElementInstanceCount = 0;
  let geometryQuadInstanceCount = 0;
  let multipartGeometryVoxelCount = 0;
  let translucentGeometryVoxelCount = 0;
  let tintedVoxelCount = 0;
  const materialEffectPatches = new Map<THREE.MeshStandardMaterial, MaterialEffectsPatch>();
  const materialEdgeStrengths = new Map<THREE.MeshStandardMaterial, number>();
  let nearDetailFactor = 0;
  const cutoutShadowMeshes = new Set<THREE.Mesh>();
  let sceneRevision = 0;
  let shadowRefreshCount = 0;
  let lastShadowRefreshReason: ShadowRefreshReason | "none" = "none";
  let lastShadowSample: ShadowRefreshSample | undefined;
  let shadowExtent = 18;
  let cloudMaterial: THREE.MeshLambertMaterial | null = null;
  let cloudBlockCount = 0;
  let cloudBudgetMode: "main-world" | "preview" = "main-world";
  let cloudBlockScale = 1;
  let cloudsBuiltSpanX = 0;
  let cloudsBuiltSpanZ = 0;
  let cloudsBuiltBaseY = 0;
  const previewMode = options.previewMode === true;
  let naturalTreeMeshes: { trunks: THREE.InstancedMesh; crowns: THREE.InstancedMesh; total: number } | null = null;
  let rainAnimation: RainAnimation | null = null;
  let snowAnimation: SnowAnimation | null = null;
  const stormFlash = new THREE.PointLight(0xd9e7ff, 0, 28, 2);
  stormFlash.castShadow = false;
  lightRig.add(stormFlash);
  let lightningBolt: THREE.Group | null = null;
  let lightningStartedAtMs = Number.NEGATIVE_INFINITY;
  let nextLightningAtMs = Number.POSITIVE_INFINITY;
  let lightningStrikeCount = 0;
  let stormRandom = seededRandom(0x26c3);
  let precipitationField: PrecipitationField | null = null;
  let precipitationFieldSyncCount = 0;
  let precipitationViewCache: PrecipitationViewCache = emptyPrecipitationViewCache();
  let rainCameraFrustumCount = 0;
  let snowCameraFrustumCount = 0;
  let rainStreakProjectedCssPx = 0;
  const precipitationProjectionPoint = new THREE.Vector3();
  const precipitationCameraWorldPosition = new THREE.Vector3();
  const precipitationCameraDirection = new THREE.Vector3();
  // Ambient motion runs while the pane is visible and the tab is foreground.
  // Weather clouds advect across the sky; each tree crown
  // and trunk tilts around its planted base; newly completed buildings grow
  // block by block. Everything is driven by one throttled interval pump (never a
  // continuous rAF loop), stays silent under reduced motion and on the
  // performance tier, and stops the moment the pane hides or the tab backgrounds.
  let cloudDrift: {
    mesh: THREE.InstancedMesh;
    clouds: Array<{ first: number; count: number; speed: number; angle: number }>;
    basePositions: Float32Array;
    spanX: number;
    spanZ: number;
    elapsedMs: number;
    lastUpdateMs: number;
  } | null = null;
  let naturalTreeSway: {
    trunks: THREE.InstancedMesh;
    crowns: THREE.InstancedMesh;
    trees: Array<{ pivotX: number; pivotY: number; pivotZ: number; trunkY: number; crownY: number; scale: number; phase: number; periodMs: number; amp: number; axisAngle: number }>;
    attachments: Array<{ mesh: THREE.InstancedMesh; index: number; treeIndex: number; baseMatrix: THREE.Matrix4 }>;
    elapsedMs: number;
    lastUpdateMs: number;
  } | null = null;
  let constructionReveals: Array<{ mesh: THREE.InstancedMesh; index: number; popAtMs: number; targetScale: number; done: boolean }> = [];
  let constructionRevealStartedMs = 0;
  const terrainPackTextures: THREE.Texture[] = [];
  let terrainMeshForPicking: THREE.Mesh | null = null;
  let ambientDecorationCount = 0;
  let ambientDecorationKindCount = 0;
  let ambientDecorationDrawCalls = 0;
  let ambientDecorationAllocatedBatchCount = 0;
  let ambientDecorationShadowCasters = 0;
  let naturalFlowerPackPlacementCount = 0;
  let naturalFlowerOriginalFallbackCount = 0;
  let treeSideMushroomCount = 0;

  function material(id: string): THREE.MeshStandardMaterial {
    let found = materials.get(id);
    if (!found) {
      if (options.debugFlatColors) {
        found = new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: flatDebugColorFor(id),
          emissiveIntensity: 1,
          roughness: 1,
          fog: false,
        });
        materials.set(id, found);
        return found;
      }
      const fallbackVisual = parseFallbackVisualKey(id);
      const response = materialResponse(fallbackVisual?.response ?? materialResponseForMaterialId(id));
      const terrainWater = id === "terrainWater";
      const terrainLava = id === "terrainLava";
      // Water is rendered as a surface, not a transparent volume. Keeping a
      // depth-writing surface prevents camera-facing sky stars from bleeding
      // through the terrain and reads more like a night reflection.
      const transparent = fallbackVisual?.transparent === true || id === "glass";
      const pattern = fallbackVisual?.pattern ?? originalPatternForMaterialId(id);
      found = new THREE.MeshStandardMaterial({
        color: fallbackVisual?.color ?? colors[id] ?? 0xffffff,
        map: originalMaterialTexture(pattern),
        roughness: id === "glass" ? 0.1 : terrainWater ? 0.34 : response.roughness,
        metalness: id === "glass" ? 0.08 : terrainWater ? 0.05 : response.metalness,
        transparent,
        opacity: fallbackVisual?.opacity ?? (id === "glass" ? 0.44 : 1),
        depthWrite: !transparent,
        emissive: terrainLava ? 0x8f1f08 : id === "glass" ? 0x315c72 : 0x000000,
        emissiveIntensity: terrainLava ? 0.68 : id === "glass" ? 0.13 : 0,
      });
      const voxelEdgeStrength = transparent ? 0.22 : fallbackVisual ? 0.12 : ["stone", "wood", "plank", "roof", "accent"].includes(id) ? 0.12 : 0;
      trackMaterialEffects(found, voxelEdgeStrength);
      materials.set(id, found);
    }
    return found;
  }

  function originalMaterialTexture(pattern: OriginalMaterialPattern): THREE.DataTexture {
    let found = originalMaterialTextures.get(pattern);
    if (!found) {
      found = createOriginalMaterialTexture(pattern);
      originalMaterialTextures.set(pattern, found);
    }
    return found;
  }

  function flatDebugColorFor(id: string): number {
    if (id === "grass") return 0x2ecc40;
    if (id === "dirt") return 0x8b5a2b;
    if (id === "stone" || id === "terrainStone") return 0x7f8c8d;
    if (id === "terrainWater") return 0x2a7fff;
    if (id === "path") return 0xff3333;
    if (id === "wood") return 0xffff00;
    if (id === "leaves") return 0x33cc33;
    if (id === "terrainLava") return 0xff4400;
    return 0xff00e0;
  }

  function flatDebugMaterial(color: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 1, roughness: 1, fog: false });
  }

  function pollGpuTimer(): void {
    if (!gpuTimerQuery || !webGl2Context || !gpuTimerExtension) return;
    try {
      const available = webGl2Context.getQueryParameter(gpuTimerQuery, webGl2Context.QUERY_RESULT_AVAILABLE) === true;
      if (!available) return;
      const disjoint = webGl2Context.getParameter(gpuTimerExtension.GPU_DISJOINT_EXT) === true;
      const elapsedNanoseconds = Number(webGl2Context.getQueryParameter(gpuTimerQuery, webGl2Context.QUERY_RESULT));
      if (!disjoint && gpuTimerQueryInteracting && Number.isFinite(elapsedNanoseconds)) {
        const elapsedMs = elapsedNanoseconds / 1_000_000;
        gpuRenderDurations.push(elapsedMs);
        if (gpuRenderDurations.length > 120) gpuRenderDurations.shift();
        gpuRenderMaxMs = Math.max(gpuRenderMaxMs, elapsedMs);
      }
      webGl2Context.deleteQuery(gpuTimerQuery);
      gpuTimerQuery = null;
    } catch {
      if (gpuTimerQuery) webGl2Context.deleteQuery(gpuTimerQuery);
      gpuTimerQuery = null;
      gpuTimerAvailable = false;
    }
  }

  function beginGpuTimer(): void {
    if (!gpuTimerAvailable || gpuTimerQuery || !webGl2Context || !gpuTimerExtension) return;
    try {
      const query = webGl2Context.createQuery();
      if (!query) return;
      webGl2Context.beginQuery(gpuTimerExtension.TIME_ELAPSED_EXT, query);
      gpuTimerQuery = query;
      gpuTimerQueryInteracting = interacting;
    } catch {
      if (gpuTimerQuery) webGl2Context.deleteQuery(gpuTimerQuery);
      gpuTimerQuery = null;
      gpuTimerAvailable = false;
    }
  }

  function endGpuTimer(): void {
    if (!gpuTimerQuery || !webGl2Context || !gpuTimerExtension) return;
    try {
      webGl2Context.endQuery(gpuTimerExtension.TIME_ELAPSED_EXT);
    } catch {
      webGl2Context.deleteQuery(gpuTimerQuery);
      gpuTimerQuery = null;
      gpuTimerAvailable = false;
    }
  }

  let totalRenderedFrames = 0;
  function renderFrame(frameStarted: number): boolean {
    pollNativeInput();
    if ((options.readNativeInput || options.subscribeNativeInput) && (nativeInputDeltaX !== 0 || nativeInputDeltaY !== 0)) {
      targetCameraAzimuth += nativeInputDeltaX * 0.011;
      targetCameraPitch = THREE.MathUtils.clamp(targetCameraPitch + nativeInputDeltaY * 0.0045, THREE.MathUtils.degToRad(24), THREE.MathUtils.degToRad(64));
      nativeInputDeltaX = 0;
      nativeInputDeltaY = 0;
      nativeInputRenderedSequence = nativeInputLastSequence;
    }
    const revealStillMoving = updateOpeningReveal(frameStarted);
    const cameraStillMoving = applyPendingCameraUpdate(frameStarted) || revealStillMoving || updateEnvironmentReveal(frameStarted);
    // Also catch a changed parent/root transform on a request-driven frame,
    // without tying precipitation synchronization to a world rebuild.
    syncPrecipitationField();
    const pulseActive = frameStarted < constructionPulseUntilMs;
    let pulseGlow = 0;
    if (pulseActive) {
      const duration = Math.max(1, constructionPulseUntilMs - constructionPulseStartedMs);
      const progress = THREE.MathUtils.clamp((frameStarted - constructionPulseStartedMs) / duration, 0, 1);
      pulseGlow = Math.sin(Math.PI * progress) * constructionPulseStrength;
      renderer.toneMappingExposure *= 1 + pulseGlow * 0.35;
      for (const entry of emissiveMaterials) entry.material.emissiveIntensity *= 1 + pulseGlow * 0.8;
    }
    pollGpuTimer();
    beginGpuTimer();
    const started = performance.now();
    renderer.info.reset();
    const postProcessEnabled = lightingPostProcessor.getDiagnostics().enabled;
    try {
      if (postProcessEnabled) {
        lightingPostProcessor.render(scene, camera);
        postProcessRenderCount += 1;
      } else {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
    } finally {
      endGpuTimer();
    }
    totalRenderedFrames += 1;
    canvas.dataset.renderFrameCount = String(totalRenderedFrames);
    canvas.dataset.renderCalls = String(renderer.info.render.calls);
    canvas.dataset.renderTriangles = String(renderer.info.render.triangles);
    canvas.dataset.pixelRatio = renderer.getPixelRatio().toFixed(2);
    canvas.dataset.postProcessRenderCount = String(postProcessRenderCount);
    canvas.dataset.postProcessBypassCount = String(postProcessBypassCount);
    const previousWorldFrameCommit = worldFrameCommit;
    worldFrameCommit = commitRenderedWorldFrame({
      current: worldFrameCommit,
      worldRebuildCount,
      renderedTriangles: renderer.info.render.triangles,
      worldHasGeometry: sceneVoxelCount > 0,
      committedAtMs: performance.now(),
      visible: paneVisible && !document.hidden,
      disposed,
    });
    if (worldFrameCommit !== previousWorldFrameCommit) {
      canvas.dataset.renderedWorldRebuildCount = String(worldFrameCommit.renderedWorldRebuildCount);
      if (worldFrameCommit.lastWorldFrameCommittedAtMs !== null) {
        canvas.dataset.lastWorldFrameCommittedAtMs = String(worldFrameCommit.lastWorldFrameCommittedAtMs);
      }
    }
    if (qualityFramePendingSinceMs !== null && paneVisible && !document.hidden
      && sceneVoxelCount > 0 && worldRebuildCount > 0
      && worldFrameCommit.renderedWorldRebuildCount === worldRebuildCount
      && renderer.info.render.triangles > 0
      && !renderer.getContext().isContextLost()) {
      qualityLifecycleProbe("visible-world-frame", {
        durationMs: performance.now() - qualityFramePendingSinceMs,
        renderedWorldRebuildCount: worldFrameCommit.renderedWorldRebuildCount,
        worldRebuildCount,
        renderedTriangleCount: renderer.info.render.triangles,
        requestedPreference: requestedLightingQuality,
        effectiveTier: qualityTier,
        ...lifecycleIdentityMetrics(),
        status: "ok",
      });
      qualityLifecycleSampleVisibleFrameError(renderer.getContext());
      qualityFramePendingSinceMs = null;
    }
    if (firstNonemptyFrameMs === null && renderer.info.render.triangles > 0) {
      firstNonemptyFrameMs = performance.now() - rendererCreatedAtMs;
      qualityLifecycleProbe("first-nonempty-frame", { durationMs: firstNonemptyFrameMs, status: "ok" });
      canvas.dataset.firstNonemptyFrameMs = firstNonemptyFrameMs.toFixed(2);
      logNativeRenderDiagnostic(`[blockcolc-first-nonempty-frame] ${JSON.stringify({ durationMs: Number(firstNonemptyFrameMs.toFixed(2)), triangles: renderer.info.render.triangles, rebuildCount: worldRebuildCount })}`);
    }
    const elapsed = performance.now() - started;
    if (ambientFrameInFlight) {
      // Adapt the ambient cadence to the measured frame cost so a slow
      // environment never turns the living world into a render-hogging loop.
      ambientFrameInFlight = false;
      ambientFrameIntervalMs = THREE.MathUtils.clamp(Math.round(elapsed * 1.6), 250, 1_000);
      canvas.dataset.ambientFrameIntervalMs = String(ambientFrameIntervalMs);
    }
    if (interacting) {
      if (lastInteractionAnimationFrameMs !== null) {
        const interval = frameStarted - lastInteractionAnimationFrameMs;
        interactionAnimationFrameIntervals.push(interval);
        if (interactionAnimationFrameIntervals.length > 120) interactionAnimationFrameIntervals.shift();
        interactionAnimationFrameMaxMs = Math.max(interactionAnimationFrameMaxMs, interval);
        if (interval > 12.5) interactionDelayedFrameCount += 1;
      }
      lastInteractionAnimationFrameMs = frameStarted;
      interactionFrameDurations.push(elapsed);
      if (interactionFrameDurations.length > 60) interactionFrameDurations.shift();
      const totalElapsed = performance.now() - frameStarted;
      interactionTotalDurations.push(totalElapsed);
      if (interactionTotalDurations.length > 60) interactionTotalDurations.shift();
      interactionTotalMaxMs = Math.max(interactionTotalMaxMs, totalElapsed);
    } else lastInteractionAnimationFrameMs = null;
    maybeDowngradeQuality();
    if (pulseActive) {
      renderer.toneMappingExposure /= 1 + pulseGlow * 0.35;
      for (const entry of emissiveMaterials) entry.material.emissiveIntensity /= 1 + pulseGlow * 0.8;
    } else if (constructionPulseUntilMs !== 0) {
      constructionPulseUntilMs = 0;
      updateLighting(new Date());
    }
    return cameraStillMoving;
  }

  const frameScheduler = new FrameRequestScheduler({
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: frameId => cancelAnimationFrame(frameId),
    now: () => performance.now(),
    canRender: () => !disposed && paneVisible,
    render: frameStartedAtMs => {
      releaseStaleInteraction(frameStartedAtMs);
      const cameraStillMoving = renderFrame(frameStartedAtMs);
      // Software WebGL can spend longer than the entire stale window inside a
      // single frame. Recheck after rendering so a stolen pointer cannot keep
      // scheduling expensive interaction frames while interval tasks starve.
      releaseStaleInteraction(performance.now());
      return interacting || nativeInputActive || cameraStillMoving || openingReveal !== null || performance.now() < constructionPulseUntilMs;
    },
  });

  function requestRender(): void {
    frameScheduler.request();
  }

  // V20 CT-01: ambient frames (cloud drift, tree sway) share the same single rAF
  // slot as interaction frames, and the next ambient frame is only requested once
  // the previous one finished AND the adaptive interval elapsed. The interval
  // scales with the measured frame cost (250 ms on fast devices, up to 1 s when a
  // single cinematic frame is expensive), so the ambient loop can never saturate
  // the render pipeline — on software WebGL it simply breathes slower instead of
  // starving the compositor and every screenshot/tap behind it.
  let ambientFrameIntervalMs = 250;
  let lastAmbientFrameStartedMs = Number.NEGATIVE_INFINITY;
  let ambientFrameInFlight = false;
  function requestAmbientRender(nowMs: number): void {
    if (disposed || frameScheduler.pending || !paneVisible || nowMs - lastAmbientFrameStartedMs < ambientFrameIntervalMs) return;
    lastAmbientFrameStartedMs = nowMs;
    ambientFrameInFlight = true;
    requestRender();
  }

  function animationControllersFor(atlas: ResourcePackAtlas): Array<AtlasAnimationController | null> {
    const startedAtMs = performance.now();
    const controllers: Array<AtlasAnimationController | null> = [];
    try {
      for (const page of atlas.pages) {
        controllers.push(page.animationLookup
          ? createAtlasAnimationController(page.animationLookup, requestRender, {
            reducedMotion,
            visible: !document.hidden,
            activeTextureIndices: [],
            startedAtMs,
          })
          : null);
      }
      return controllers;
    } catch (error) {
      for (const controller of controllers) {
        try { controller?.dispose(); } catch { /* release the remaining staged controllers */ }
      }
      throw error;
    }
  }

  function referenceAnimatedTexture(page: number, textureIndex: number): void {
    const indices = referencedAnimatedTextureIndices.get(page) ?? new Set<number>();
    indices.add(textureIndex);
    referencedAnimatedTextureIndices.set(page, indices);
  }

  function referenceFluidAnimatedTexture(page: number, textureIndex: number): void {
    referenceAnimatedTexture(page, textureIndex);
    let available = fluidAvailableAnimationIndices.get(page);
    if (!available) {
      available = new Set(activeResourcePack?.atlas.pages[page]?.animationLookup?.sequences.map((sequence) => sequence.textureIndex) ?? []);
      fluidAvailableAnimationIndices.set(page, available);
    }
    if (available.has(textureIndex)) referencedFluidAnimatedTextures.add(`${page}:${textureIndex}`);
  }

  function rebuild(worlds: readonly WorldSnapshot[], previousWorlds: readonly WorldSnapshot[] = lastWorlds): void {
    if (openingReveal) finishOpeningReveal("cancelled");
    if (environmentReveal) finishEnvironmentReveal(true);
    const rebuildStartedAtMs = performance.now();
    const rebuildStageMs: Record<string, number> = {};
    let rebuildStageStartedAtMs = rebuildStartedAtMs;
    const finishRebuildStage = (stage: string) => {
      const now = performance.now();
      rebuildStageMs[stage] = Number((now - rebuildStageStartedAtMs).toFixed(2));
      rebuildStageStartedAtMs = now;
    };
    const preserveCameraView = positionedWorlds.length > 0 && sameSpatialWorldLayout(previousWorlds, worlds);
    sceneRevision += 1;
    clearGroup(buildingGroup);
    fallbackOcclusionMeshes.clear();
    cutoutShadowMeshes.clear();
    blockEntityDisplay.reset();
    clearGroup(terrainGroup);
    // A rebuild invalidates every per-frame animation state whose meshes just got
    // disposed: stale reveal entries must never write into freed instanced meshes.
    constructionReveals = [];
    cloudDrift = null;
    naturalTreeSway = null;
    for (const texture of terrainPackTextures) texture.dispose();
    terrainPackTextures.length = 0;
    clearGroup(roadGroup);
    naturalTreeMeshes = null;
    clearLights();
    emissiveMaterials = [];
    texturedBatchCount = 0;
    texturedVoxelCount = 0;
    originalStaticShapeVoxelCount = 0;
    originalStaticShapeBatchCount = 0;
    originalStaticShapeTopologyCount = 0;
    originalStaticShapeMaterialGroupCount = 0;
    originalStaticShapeEmissiveMaterialGroupCount = 0;
    originalStaticShapeTopologyOverflow = 0;
    originalStaticShapeMaterialGroupOverflow = 0;
    originalStaticShapeBudgetFallbackVoxelCount = 0;
    sourceLanternPointLightCount = 0;
    emissivePointColors.clear();
    resourceFluidVoxelCount = 0;
    resourceSpecialVoxelCount = 0;
    fallbackVoxelCount = 0;
    transformedUvVoxelCount = 0;
    geometrySignatureBatchCount = 0;
    geometryVoxelCount = 0;
    geometryElementInstanceCount = 0;
    geometryQuadInstanceCount = 0;
    multipartGeometryVoxelCount = 0;
    translucentGeometryVoxelCount = 0;
    tintedVoxelCount = 0;
    plannedOutlineVoxelCount = 0;
    ambientDecorationCount = 0;
    ambientDecorationKindCount = 0;
    ambientDecorationDrawCalls = 0;
    ambientDecorationAllocatedBatchCount = 0;
    ambientDecorationShadowCasters = 0;
    naturalFlowerPackPlacementCount = 0;
    naturalFlowerOriginalFallbackCount = 0;
    treeSideMushroomCount = 0;
    referencedAnimatedTextureIndices.clear();
    referencedFluidAnimatedTextures.clear();
    fluidAvailableAnimationIndices.clear();
    finishRebuildStage("clear");
    const initialPositioned = layoutWorlds(worlds, resolveBlueprint);
    const environmentStyle: TerrainEnvironmentStyle = previewMode
      ? "classic-island"
      : options.environmentStyle ?? "classic-island";
    const alignedPositioned = alignWorldsToEnvironment(
      initialPositioned,
      environmentStyle,
    );
    const buildingPads: TerrainPad[] = [];
    const positioned = alignedPositioned.map((world) => {
      const supportY = settlementSupportHeightForPlacement(world, environmentStyle);
      const next = supportY > world.worldPosition.y
        ? { ...world, worldPosition: { ...world.worldPosition, y: supportY } }
        : world;
      // Every environment gets an explicit support pad. This shared datum keeps
      // terrain, foundations, roads and lamps from disagreeing about ground.
      buildingPads.push({ x: next.worldPosition.x, z: next.worldPosition.z, width: next.footprint.width, depth: next.footprint.depth, groundLevel: next.worldPosition.y });
      return next;
    });
    positionedWorlds = positioned;
    const voxelCount = positioned.reduce((sum, world) => sum + world.blueprint.voxels.length, 0);
    sceneVoxelCount = voxelCount;
    adaptiveQualityCap = "high";
    qualityTier = selectQualityTierForLighting(deviceSignals(renderer, voxelCount), requestedLightingQuality);
    applyQuality(qualityTier, false, true);

    // V20 BX-01: when a focus round completes, the finished building grows block
    // by block instead of popping in whole. Reveal only applies to buildings whose
    // completion actually advanced between rebuilds (never the initial load, never
    // environment or resource-pack swaps), and is skipped under reduced motion and
    // in diagnostic screenshot modes where the world must render complete
    // immediately.
    const revealPlans = constructionRevealPlans(
      previousWorlds,
      worlds,
      // The reveal is a bounded one-shot ceremony (like the construction pulse),
      // so it is not gated on the lighting tier — only reduced motion and the
      // diagnostic screenshot modes skip it. Idle ambient motion (clouds, trees)
      // is what the performance tier disables.
      !reducedMotion && !options.debugFlatColors && !options.debugVoidScan && !previewMode,
    );
    if (revealPlans.size > 0) constructionRevealStartedMs = performance.now();

    const roads = roadCellsForVillage(positioned);
    const importedDecorations = placeImportedDecorations(
      positioned.flatMap((world) => (world.importedDecorations ?? []).map((reward) => ({
        ...reward,
        projectId: world.projectId,
        blueprint: validateBlueprint(reward.blueprint),
      }))),
      positioned,
      roads,
    );
    const decorationPads: TerrainPad[] = importedDecorations.map((decoration) => ({
      x: decoration.worldPosition.x,
      z: decoration.worldPosition.z,
      width: decoration.footprint.width,
      depth: decoration.footprint.depth,
      groundLevel: decoration.worldPosition.y,
    }));
    finishRebuildStage("layout");
    const terrainPads = [...buildingPads, ...decorationPads];
    const terrainMinimumRadius = previewMode ? { x: 64, z: 64 } : undefined;
    const terrainOptions = {
      environmentStyle,
      worldSeed: options.worldSeed,
      terrainGenerationVersion: options.terrainGenerationVersion,
      refinedFar: !softwareRendererName,
    };
    const terrainKey = terrainGenerationInputKey(positioned, roads, terrainPads, terrainMinimumRadius, terrainOptions);
    const terrainCacheHit = terrainGenerationCache?.key === terrainKey;
    const terrainData = terrainCacheHit
      ? terrainGenerationCache!.data
      : createSteppedTerrainData(positioned, roads, terrainPads, terrainMinimumRadius, terrainOptions);
    if (!terrainCacheHit) {
      const numericLength = terrainData.positions.length
        + Object.values(terrainData.indicesByMaterial).reduce((sum, indices) => sum + indices.length, 0)
        + terrainData.sideIndices.dirt.length + terrainData.sideIndices.stone.length;
      // Keep at most one recent layout, and never pin an unusually large world.
      terrainGenerationCache = numericLength * 8 <= 16 * 1024 * 1024
        ? { key: terrainKey, data: terrainData }
        : null;
    }
    canvas.dataset.terrainGenerationCacheHit = String(terrainCacheHit);
    finishRebuildStage("terrainGeneration");
    canvas.dataset.environmentStyle = environmentStyle;
    canvas.dataset.terrainGenerationVersion = String(terrainData.terrainGenerationVersion);
    canvas.dataset.terrainCellCount = String(terrainData.cellCount);
    canvas.dataset.naturalTreeCount = String(terrainData.naturalTrees.length);
    canvas.dataset.terrainWaterTriangles = String(terrainData.indicesByMaterial.water.length / 3);
    canvas.dataset.terrainNearCellCount = String(terrainData.lodCellCounts.near);
    canvas.dataset.terrainMiddleCellCount = String(terrainData.lodCellCounts.middle);
    canvas.dataset.terrainFarCellCount = String(terrainData.lodCellCounts.far);
    canvas.dataset.oceanIsletCount = String(terrainData.oceanIslets?.length ?? 0);
    canvas.dataset.oceanIsletPositions = (terrainData.oceanIslets ?? []).map((islet) => `${Math.round(islet.x)}:${Math.round(islet.z)}:${Math.round(islet.radius)}`).join(",");
    canvas.dataset.oceanMainRadius = String(terrainData.oceanMain?.radius ?? "");
    canvas.dataset.oceanMainBeach = String(terrainData.oceanMain?.beach ?? "");
    canvas.dataset.terrainHydrologyNetworkCount = String(terrainData.hydrology.networkCount);
    canvas.dataset.terrainHydrologyBasinCount = String(terrainData.hydrology.basinCount);
    canvas.dataset.terrainHydrologySegmentCount = String(terrainData.hydrology.riverSegmentCount);
    canvas.dataset.terrainHydrologyOutletCount = String(terrainData.hydrology.outletCount);
    canvas.dataset.terrainHydrologyMaxUphill = String(terrainData.hydrology.maxUphillWaterStep);
    canvas.dataset.terrainHydrologyProtectedWater = String(terrainData.hydrology.protectedWaterCellCount);
    canvas.dataset.terrainFarExtent = String(terrainData.bounds.maxX);
    addTerrain(terrainData);
    finishRebuildStage("terrainMesh");
    const roadGroundHeightAt = (x: number, z: number) => supportGroundHeightAt(
      x,
      z,
      positioned,
      [...buildingPads, ...decorationPads],
      environmentStyle,
    );
    canvas.dataset.roadCellCount = String(roads.length);
    canvas.dataset.buildingSupportMinY = String(positioned.length === 0
      ? 0
      : Math.min(...positioned.map((world) => world.worldPosition.y)));
    canvas.dataset.roadSupportMinY = String(roads.length === 0
      ? 0
      : Math.min(...roads.map((road) => roadGroundHeightAt(road.x, road.z))));
    addRoads(roads, positioned, [...buildingPads, ...decorationPads], roadGroundHeightAt);
    const emissivePoints: EmissivePoint[] = [];
    addRoadLamps(roads, positioned, emissivePoints, roadGroundHeightAt);
    finishRebuildStage("roadsAndLamps");
    for (const world of positioned) addBuilding(world, emissivePoints, revealPlans.get(world.projectId) ?? null);
    for (const decoration of importedDecorations) addImportedDecoration(decoration, emissivePoints);
    finishRebuildStage("buildings");
    addNaturalEnvironmentDecorations(positioned, roads, importedDecorations, environmentStyle, terrainData);
    finishRebuildStage("naturalDecorations");
    activeResourcePack?.atlas.pages.forEach((page, pageIndex) => {
      const controller = atlasAnimationControllers[pageIndex];
      if (page.animationLookup && controller) controller.setActiveTextureIndices(referencedAnimatedTextureIndices.get(pageIndex) ?? []);
    });
    addClusteredLights(emissivePoints, emissivePointColors);
    updateSceneBounds(positioned, importedDecorations, terrainData, previewMode);
    // Frame the new content before capturing the forced shadow sample. Doing
    // this afterward leaves the sample anchored to the previous camera target,
    // so the next ordinary lighting tick is misclassified as camera movement.
    frameScene(!preserveCameraView, preserveCameraView);
    updateWeather(localDateForDate(new Date()), true);
    if (decayRevealRequested) {
      decayRevealRequested = false;
      startEnvironmentReveal([terrainGroup, roadGroup, buildingGroup], "decay");
    }
    updateLighting(new Date(), true);
    cacheStaticWorldTransforms();
    finishRebuildStage("lightingAndFinalize");
    canvas.dataset.worldRebuildStagesMs = JSON.stringify(rebuildStageMs);
    worldRebuildLastMs = performance.now() - rebuildStartedAtMs;
    worldRebuildCount += 1;
    worldRebuildTotalMs += worldRebuildLastMs;
    worldRebuildMaxMs = Math.max(worldRebuildMaxMs, worldRebuildLastMs);
    qualityLifecycleProbe("world-rebuild-complete", {
      durationMs: worldRebuildLastMs,
      worldRebuildCount,
      renderedWorldRebuildCount: worldFrameCommit.renderedWorldRebuildCount,
      ...lifecycleIdentityMetrics(),
      status: "ok",
    });
    logNativeRenderDiagnostic(`[blockcolc-world-rebuild] ${JSON.stringify({ count: worldRebuildCount, durationMs: Number(worldRebuildLastMs.toFixed(2)), worldCount: worlds.length, environmentStyle })}`);
    updateDiagnosticsDataset();
    requestRender();
  }

  function cacheStaticWorldTransforms(): void {
    cacheStaticTransformNode(scene);
    cacheStaticTransformNode(rotatableWorldRoot);
    cacheStaticTransformTree(terrainGroup);
    cacheStaticTransformTree(roadGroup);
    cacheStaticTransformTree(buildingGroup);
    cacheStaticTransformTree(atmosphereGroup);
    // The sky follows the camera's position. Cache its contents, but leave the
    // group itself under explicit camera control so focused framing cannot leave
    // stars and the dome at the previous camera anchor.
    cacheStaticTransformTree(skyDome);
    cacheStaticTransformTree(starField);
    skyGroup.matrixAutoUpdate = false;
    skyGroup.updateMatrix();
    skyGroup.matrixWorldNeedsUpdate = true;
    scene.updateMatrixWorld(true);
  }

  function cacheStaticTransformNode(object: THREE.Object3D): void {
    object.updateMatrix();
    object.matrixAutoUpdate = false;
    object.matrixWorldNeedsUpdate = true;
  }

  function cacheStaticTransformTree(root: THREE.Object3D): void {
    root.traverse((object) => cacheStaticTransformNode(object));
  }

  function addTerrain(data: MergedGeometryData): void {
    terrainBoundsBox = new THREE.Box3(
      new THREE.Vector3(data.bounds.minX, data.bounds.minY, data.bounds.minZ),
      new THREE.Vector3(data.bounds.maxX, data.bounds.maxY, data.bounds.maxZ),
    );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(createPlanarQuadUvs(data.positions), 2));
    const combined: number[] = [];
    const materialIds: readonly TerrainMaterialKey[] = ["grass", "dirt", "stone", "water"];
    materialIds.forEach((id, materialIndex) => {
      const indices = data.indicesByMaterial[id];
      geometry.addGroup(combined.length, indices.length, materialIndex);
      for (const index of indices) combined.push(index);
    });
    // Vertical step faces share the geometry but render with darkened materials:
    // the original textures are low-contrast light gray and a thin edge-on face
    // reads nearly white against the terrain, so the sides get their own groups.
    const sideIds: Array<"dirt" | "stone"> = ["dirt", "stone"];
    sideIds.forEach((id, offset) => {
      const indices = data.sideIndices?.[id] ?? [];
      const materialIndex = materialIds.length + offset;
      geometry.addGroup(combined.length, indices.length, materialIndex);
      for (const index of indices) combined.push(index);
    });
    geometry.setIndex(combined);
    geometry.computeVertexNormals();
    // V24: water keeps its flat surface normals — the vertex-tilt experiment
    // made the day-lit open sea read as noisy mush over the far LOD cells and
    // was rolled back (user-accepted mirror gloss stays for now).
    // Terrain surfaces retexture through pack tiles when the pack provides them;
    // water keeps the opaque procedural contract.
    const grassPack = packTileMaterial("minecraft:grass_block", "up");
    const dirtPack = packTileMaterial("minecraft:dirt", "up");
    const stonePack = packTileMaterial("minecraft:stone", "up");
    canvas.dataset.terrainPackTextured = String(grassPack !== null || dirtPack !== null || stonePack !== null);
    const shadeSide = (base: THREE.Material): THREE.Material => {
      const clone = base.clone();
      if (clone instanceof THREE.MeshStandardMaterial || clone instanceof THREE.MeshLambertMaterial) {
        // Side textures are near-white (229 base) procedural grays. A gentle
        // multiplier still clips to pure white under the low-sun directional
        // light, which is exactly the reported "white step faces"; 0.4 keeps
        // the same faces in the mid-gray range under any sun angle.
        clone.color = clone.color.clone().multiplyScalar(0.4);
      }
      return clone;
    };
    const mesh = new THREE.Mesh(geometry, options.debugFlatColors ? [
      flatDebugMaterial(0x2ecc40), // grass
      flatDebugMaterial(0x8b5a2b), // dirt
      flatDebugMaterial(0x7f8c8d), // stone
      flatDebugMaterial(0x2a7fff), // water
      flatDebugMaterial(0xff00e0), // side dirt (magenta)
      flatDebugMaterial(0xff7b00), // side stone (orange)
    ] : [
      grassPack ?? material("grass"),
      dirtPack ?? material("dirt"),
      stonePack ?? material("terrainStone"),
      material("terrainWater"),
      shadeSide(dirtPack ?? material("dirt")),
      shadeSide(stonePack ?? material("terrainStone")),
    ]);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.terrainTriangles = data.triangleCount;
    terrainGroup.add(mesh);
    terrainMeshForPicking = mesh;
    addNaturalBackdrop(data);
    addNaturalTrees(data);
  }

  /**
   * Repeat-sampling material for one face of a pack block. Cropping the atlas
   * tile first keeps world-scale terrain UVs from wrapping into adjacent blocks.
   */
  function packTileMaterial(blockId: string, face: BlockFace): THREE.MeshStandardMaterial | null {
    const pack = activeResourcePack;
    if (!pack) return null;
    const rect = resolvePackTileRect(pack.manifest, pack.atlas, blockId, face);
    if (!rect) return null;
    const page = pack.atlas.pages[rect.page];
    if (!page) return null;
    // Terrain UVs span many world cells. Sampling the full atlas page with a
    // repeated normalized rectangle wraps into neighboring block tiles, which
    // is especially visible on coarse far-LOD cells as multicolored terrain.
    // Crop the selected tile into its own tiny texture before enabling repeat.
    const texture = cropAtlasTileTexture(page, rect);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    // Sample only the tile rect at full resolution: mipmaps blend across the
    // atlas gutter (white padding) and bleach distant terrain sides white.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 1;
    texture.needsUpdate = true;
    terrainPackTextures.push(texture);
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture, roughness: 0.94, metalness: 0 });
  }

  function cropAtlasTileTexture(page: ResourcePackAtlasPage, rect: { u0: number; v0: number; u1: number; v1: number }): THREE.DataTexture {
    const source = page.texture.image?.data as Uint8Array | undefined;
    if (!source) {
      throw new Error("Resource-pack atlas page has no readable RGBA pixels.");
    }
    const cropped = cropAtlasTilePixels(source, page.width, page.height, rect);
    const texture = new THREE.DataTexture(cropped.pixels, cropped.width, cropped.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.name = `blockcolc-terrain-tile-${cropped.width}x${cropped.height}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  function addNaturalBackdrop(data: MergedGeometryData): void {
    if (data.terrainGenerationVersion >= 2) return;
    if (data.bounds.maxX <= data.framingBounds.maxX) return;
    const size = Math.max(1_000, (data.bounds.maxX - data.bounds.minX) * 6);
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material("grass"));
    backdrop.name = "lowDetailNaturalBackdrop";
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -4;
    backdrop.receiveShadow = false;
    backdrop.castShadow = false;
    backdrop.renderOrder = -2;
    terrainGroup.add(backdrop);
  }

  function addNaturalTrees(data: MergedGeometryData): void {
    if (data.naturalTrees.length === 0) return;
    const trunksMaterial = packTileMaterial("minecraft:oak_log", "north") ?? material("wood");
    const crownsMaterial = packTileMaterial("minecraft:oak_leaves", "up") ?? material("leaves");
    const trunks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 2.4, 0.72), trunksMaterial, data.naturalTrees.length);
    const crowns = new THREE.InstancedMesh(new THREE.BoxGeometry(2.55, 2.35, 2.55), crownsMaterial, data.naturalTrees.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    data.naturalTrees.forEach((tree, index) => {
      matrix.compose(
        new THREE.Vector3(tree.x, tree.y + 1.2 * tree.scale, tree.z),
        rotation,
        new THREE.Vector3(tree.scale, tree.scale, tree.scale),
      );
      trunks.setMatrixAt(index, matrix);
      matrix.compose(
        new THREE.Vector3(tree.x, tree.y + 2.8 * tree.scale, tree.z),
        rotation,
        new THREE.Vector3(tree.scale, tree.scale, tree.scale),
      );
      crowns.setMatrixAt(index, matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    crowns.castShadow = false;
    trunks.receiveShadow = true;
    crowns.receiveShadow = true;
    naturalTreeMeshes = { trunks, crowns, total: data.naturalTrees.length };
    // V20 WX-01: trunk-pivot sway. Each tree rocks a fraction of a degree around
    // a horizontal axis through its planted base, trunk and crown together, so the
    // base stays rooted. Phases and periods are deterministic per tree index, which
    // keeps repeated rebuilds stable while the motion itself stays alive.
    naturalTreeSway = {
      trunks,
      crowns,
      trees: data.naturalTrees.map((tree, index) => ({
        pivotX: tree.x,
        pivotY: tree.y,
        pivotZ: tree.z,
        trunkY: tree.y + 1.2 * tree.scale,
        crownY: tree.y + 2.8 * tree.scale,
        scale: tree.scale,
        phase: (index * 0.6180339887) % 1,
        periodMs: 5_000 + ((index * 137) % 4_000),
        amp: 0.06 + ((index * 97) % 12) / 12 * 0.04,
        axisAngle: ((index * 53) % 360) * (Math.PI / 180),
      })),
      attachments: [],
      elapsedMs: 0,
      lastUpdateMs: performance.now(),
    };
    updateNaturalTreeDensity();
    terrainGroup.add(trunks, crowns);
  }

  function updateNaturalTreeDensity(): void {
    if (!naturalTreeMeshes) return;
    const visible = visibleNaturalTreeCount(naturalTreeMeshes.total, qualityTier);
    naturalTreeMeshes.trunks.count = visible;
    naturalTreeMeshes.crowns.count = visible;
    naturalTreeMeshes.trunks.castShadow = qualityTier === "high";
    syncNaturalTreeAttachments();
  }

  function syncNaturalTreeAttachments(): void {
    const sway = naturalTreeSway;
    const visibleCount = naturalTreeMeshes?.trunks.count ?? 0;
    if (!sway) {
      treeSideMushroomCount = 0;
      return;
    }
    for (const attachment of sway.attachments) {
      const tree = sway.trees[attachment.treeIndex];
      if (!tree) continue;
      const swayAngle = sway.elapsedMs > 0
        ? tree.amp * Math.sin((sway.elapsedMs / tree.periodMs) * Math.PI * 2 + tree.phase * Math.PI * 2)
        : 0;
      attachment.mesh.setMatrixAt(attachment.index, naturalTreeAttachmentMatrix({
        baseMatrix: attachment.baseMatrix,
        pivot: [tree.pivotX, tree.pivotY, tree.pivotZ],
        axisAngle: tree.axisAngle,
        swayAngle,
        hostVisible: attachment.treeIndex < visibleCount,
      }));
    }
    for (const mesh of new Set(sway.attachments.map(attachment => attachment.mesh))) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    treeSideMushroomCount = sway.attachments.filter(attachment => attachment.treeIndex < visibleCount).length;
  }

  type TerrainMaterialKey = "grass" | "dirt" | "stone" | "water";

  function addRoads(roads: ReturnType<typeof roadCellsForVillage>, placements: readonly VillagePlacement[], pads: readonly TerrainPad[], groundHeightAt: (x: number, z: number) => number): void {
    const data = createRoadGeometryData(roads, placements, pads, groundHeightAt);
    if (data.indices.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(createPlanarQuadUvs(data.positions), 2));
    geometry.setIndex(data.indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material("path"));
    mesh.receiveShadow = true;
    mesh.userData.roadTriangles = data.triangleCount;
    roadGroup.add(mesh);
  }

  function addRoadLamps(roads: ReturnType<typeof roadCellsForVillage>, placements: readonly VillagePlacement[], emissivePoints: EmissivePoint[], groundHeightAt: (x: number, z: number) => number): void {
    if (roads.length < 8) return;
    const occupied = placements.map((placement) => ({
      x: placement.worldPosition.x, z: placement.worldPosition.z,
      radius: Math.max(placement.footprint.width, placement.footprint.depth) / 2 + 2,
    }));
    const candidates = roads.filter((cell, index) => index % 14 === 7
      && occupied.every((building) => Math.hypot(cell.x - building.x, cell.z - building.z) > building.radius));
    const selected = candidates.slice(0, 8);
    if (selected.length === 0) return;
    const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 2.5, 0.28), material("wood"), selected.length);
    const lanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 0.72, 0.72), material("lamp"), selected.length);
    const matrix = new THREE.Matrix4();
    selected.forEach((cell, index) => {
      const ground = groundHeightAt(cell.x, cell.z) - 0.455;
      matrix.makeTranslation(cell.x, ground + 1.25, cell.z); poles.setMatrixAt(index, matrix);
      matrix.makeTranslation(cell.x, ground + 2.55, cell.z); lanterns.setMatrixAt(index, matrix);
        registerEmissivePoint(emissivePoints, emissivePointColors,
          { x: cell.x, y: ground + 2.55, z: cell.z, intensity: 15 }, 0xffb45f);
    });
    poles.instanceMatrix.needsUpdate = true;
    lanterns.instanceMatrix.needsUpdate = true;
    poles.castShadow = true;
    lanterns.castShadow = true;
    roadGroup.add(poles, lanterns);
  }

  function addBuilding(world: PositionedWorldSnapshot, emissivePoints: EmissivePoint[], reveal: { previousCompletionBasisPoints: number } | null): void {
    const root = new THREE.Group();
    root.position.set(world.worldPosition.x, world.worldPosition.y, world.worldPosition.z);
    root.rotation.y = world.rotationY;
    root.userData.projectId = world.projectId;
    buildingGroup.add(root);
    const structure = new THREE.Group();
    structure.position.set(world.blueprintOffset.x, 0, world.blueprintOffset.z);
    root.add(structure);
    const completion = Math.max(0, Math.min(10_000, world.buildingCompletionBasisPoints));
    // Moved piston blocks stay render-only clones: their source blueprint and
    // persisted build-order prefix remain authoritative for construction.
    const renderVoxels = planMovingPistonRenderVoxels(world.blueprint.voxels).displayVoxels;
    const visible = renderVoxels.filter((voxel) => voxel.buildOrder <= completion);
    const conditionVisual = conditionVisualForVoxels(world.projectId, visible, world.buildingConditionBasisPoints);
    const occlusionField = createLocalOcclusionField(conditionVisual.intactVoxels);
    for (const voxel of conditionVisual.intactVoxels) {
      const sourceEmission = sourceLanternEmissionForVoxel(voxel) ?? sourceCandleEmissionForVoxel(voxel);
      if (sourceEmission) {
        const cos = Math.cos(world.rotationY); const sin = Math.sin(world.rotationY);
        const localX = voxel.x + world.blueprintOffset.x;
        const localZ = voxel.z + world.blueprintOffset.z;
        const point = {
          x: world.worldPosition.x + localX * cos + localZ * sin,
          y: world.worldPosition.y + voxel.y,
          z: world.worldPosition.z - localX * sin + localZ * cos,
          intensity: sourceEmission.level,
        };
        registerEmissivePoint(emissivePoints, emissivePointColors, point, sourceEmission.color);
        if (sourceEmission.kind === "lantern" || sourceEmission.kind === "soul-lantern") sourceLanternPointLightCount += 1;
      }
    }
    // V20 BX-01: the increment this round just built appears block by block, from
    // the ground up. Waves of consecutive blocks pop in over ~3.5 s so every block
    // is individually visible; anything already standing renders immediately.
    const newVoxels = reveal !== null
      ? conditionVisual.intactVoxels.filter((voxel) => voxel.buildOrder > reveal.previousCompletionBasisPoints)
      : [];
    const orderedNew = newVoxels.length > 0
      ? [...newVoxels].sort((left, right) => left.y - right.y || left.x - right.x || left.z - right.z)
      : [];
    const revealing = orderedNew.length > 0;
    const revealOrderIndex = revealing ? new Map(orderedNew.map((voxel, index) => [voxel, index])) : null;
    const revealSchedule = constructionWaveSchedule(orderedNew.length);
    // While a building reveals, its voxels render through the per-instance fallback
    // path so each block's scale can animate independently; the merged atlas
    // batches cannot hide single voxels. The next rebuild re-batches it normally.
    // Known non-cube vanilla states bypass the generic six-face cube texture
    // route. Give a resolved pack model first chance through geometry planning;
    // unresolved states then use the original static silhouette below.
    const staticShapeCandidates = conditionVisual.intactVoxels.filter((voxel) => isOriginalStaticShapeBlockId(voxel.sourceBlockId));
    const genericTextureCandidates = conditionVisual.intactVoxels.filter((voxel) => !isOriginalStaticShapeBlockId(voxel.sourceBlockId));
    const texturePlan = activeResourcePack && !revealing
      ? createTextureBatches(genericTextureCandidates, activeResourcePack.manifest, activeResourcePack.atlas, occlusionField)
      : { batches: [], fallbackVoxels: genericTextureCandidates };
    addTexturedBatches(structure, texturePlan.batches, conditionVisual.weathering);
    const geometryCandidates = !activeResourcePack ? [] : revealing
      ? staticShapeCandidates
      : [...texturePlan.fallbackVoxels, ...staticShapeCandidates];
    const geometryPlan = activeResourcePack
      ? createGeometryBatches(geometryCandidates, activeResourcePack.manifest, activeResourcePack.atlas, occlusionField)
      : { batches: [], fallbackVoxels: [] };
    addGeometryBatches(structure, geometryPlan.batches, conditionVisual.weathering,
      revealing ? revealOrderIndex : null, revealSchedule);
    const fallbackCandidates = !activeResourcePack
      ? [...genericTextureCandidates, ...staticShapeCandidates]
      : revealing
        ? [...texturePlan.fallbackVoxels, ...geometryPlan.fallbackVoxels]
        : geometryPlan.fallbackVoxels;
    const visibleFallbackVoxels = fallbackCandidates.filter((voxel) => !isVisuallyEmptyVanillaBlock(voxel));
    const specialVoxels = addSpecialResourceVoxels(structure, visibleFallbackVoxels);
    resourceSpecialVoxelCount += specialVoxels.size;
    const blockEntityFallbackVoxels = blockEntityDisplay.add(
      structure,
      conditionVisual.intactVoxels,
      visibleFallbackVoxels,
    );
    addWaterloggedFluidVoxels(structure, conditionVisual.intactVoxels);
    const ordinaryFallbackVoxels = visibleFallbackVoxels.filter((voxel) => (
      !specialVoxels.has(voxel) && !blockEntityFallbackVoxels.has(voxel)
    ));
    const flowerShapes = addOriginalFlowerShapes(structure, ordinaryFallbackVoxels);
    const remainingFallbackVoxels = ordinaryFallbackVoxels.filter((voxel) => !flowerShapes.has(voxel));
    const resourceFluidCount = addStaticFluidVoxels(structure, remainingFallbackVoxels, conditionVisual.intactVoxels);
    if (activeResourcePack) fallbackVoxelCount += ordinaryFallbackVoxels.length - resourceFluidCount;
    const staticShapeVoxels = remainingFallbackVoxels.filter((voxel) => isOriginalStaticShapeBlockId(voxel.sourceBlockId));
    const staticShapeFallback = addOriginalStaticShapeMeshes(structure, staticShapeVoxels, occlusionField,
      conditionVisual.weathering, revealOrderIndex, revealSchedule);
    const cubeFallbackVoxels = remainingFallbackVoxels.filter((voxel) => (
      staticFluidKind(voxel) === undefined && !staticShapeFallback.has(voxel)
    ));
    const groups = groupFallbackVoxels(cubeFallbackVoxels);
    for (const [key, voxels] of groups) {
      const [materialId, emissiveKind = "", levelText = ""] = key.split("|");
      const level = levelText === "" ? 0 : Number(levelText);
      const emissiveActive = level > 0;
      const owned = conditionVisual.weathering > 0 || emissiveActive;
      const meshMaterial = owned ? material(materialId!).clone() : material(materialId!);
      const translucent = materialId === "glass" || parseFallbackVisualKey(materialId!)?.transparent === true;
      trackMaterialEffects(meshMaterial, translucent ? 0.22 : 0.12);
      if (conditionVisual.weathering > 0) {
        meshMaterial.color.multiplyScalar(1 - conditionVisual.weathering * 0.28);
        meshMaterial.roughness = Math.min(1, meshMaterial.roughness + conditionVisual.weathering * 0.1);
      }
      if (emissiveActive) {
        emissiveMaterials.push({ material: meshMaterial, level: level > 0 ? level : 15, kind: emissiveKind || "light" });
      }
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.97, 0.97, 0.97), meshMaterial, voxels.length);
      const matrix = new THREE.Matrix4();
      const hiddenMatrix = new THREE.Matrix4();
      voxels.forEach((voxel, index) => {
        const orderIndex = revealOrderIndex?.get(voxel);
        if (orderIndex !== undefined) {
          // Zero scale hides the block until its pop moment; the pop animation
          // (updateConstructionReveals) writes the settling scale afterwards.
          hiddenMatrix.makeTranslation(voxel.x, voxel.y, voxel.z).scale(new THREE.Vector3(0.0001, 0.0001, 0.0001));
          mesh.setMatrixAt(index, hiddenMatrix);
          constructionReveals.push({
            mesh,
            index,
            popAtMs: revealSchedule.popAtMsFor(constructionRevealStartedMs, orderIndex),
            targetScale: 0.97,
            done: false,
          });
          return;
        }
        matrix.makeTranslation(voxel.x, voxel.y, voxel.z);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      applyFallbackOcclusion(mesh, voxels, occlusionField);
      mesh.castShadow = !translucent;
      mesh.receiveShadow = true;
      if (translucent) mesh.renderOrder = 10;
      if (owned) mesh.userData.ownedMaterial = meshMaterial;
      structure.add(mesh);
    }
    addVines(structure, conditionVisual.vines);
    const showOutline = constructionOutlineVisibility === "all"
      || (constructionOutlineVisibility === "current" && world.isActive === true);
    addPlannedOutline(structure, world.blueprint, completion, showOutline);
    addDecorations(structure, world, emissivePoints);
  }

  function addImportedDecoration(decoration: ImportedDecorationPlacement, emissivePoints: EmissivePoint[]): void {
    const root = new THREE.Group();
    root.position.set(decoration.worldPosition.x, decoration.worldPosition.y, decoration.worldPosition.z);
    root.rotation.y = decoration.rotationY;
    root.userData.rewardId = decoration.rewardId;
    root.userData.resourceId = decoration.resourceId;
    const structure = new THREE.Group();
    structure.position.set(decoration.blueprintOffset.x, 0, decoration.blueprintOffset.z);
    root.add(structure);
    buildingGroup.add(root);
    const renderVoxels = planMovingPistonRenderVoxels(decoration.blueprint.voxels).displayVoxels;
    const occlusionField = createLocalOcclusionField(renderVoxels);
    for (const voxel of renderVoxels) {
      const sourceEmission = sourceLanternEmissionForVoxel(voxel) ?? sourceCandleEmissionForVoxel(voxel);
      if (sourceEmission) {
        const localX = voxel.x + decoration.blueprintOffset.x;
        const localZ = voxel.z + decoration.blueprintOffset.z;
        const cos = Math.cos(decoration.rotationY); const sin = Math.sin(decoration.rotationY);
        const point = {
          x: decoration.worldPosition.x + localX * cos + localZ * sin,
          y: decoration.worldPosition.y + voxel.y,
          z: decoration.worldPosition.z - localX * sin + localZ * cos,
          intensity: sourceEmission.level,
        };
        registerEmissivePoint(emissivePoints, emissivePointColors, point, sourceEmission.color);
        if (sourceEmission.kind === "lantern" || sourceEmission.kind === "soul-lantern") sourceLanternPointLightCount += 1;
      }
    }
    const staticShapeCandidates = renderVoxels.filter((voxel) => isOriginalStaticShapeBlockId(voxel.sourceBlockId));
    const genericTextureCandidates = renderVoxels.filter((voxel) => !isOriginalStaticShapeBlockId(voxel.sourceBlockId));
    const texturePlan = activeResourcePack
      ? createTextureBatches(genericTextureCandidates, activeResourcePack.manifest, activeResourcePack.atlas, occlusionField)
      : { batches: [], fallbackVoxels: genericTextureCandidates };
    addTexturedBatches(structure, texturePlan.batches, 0);
    const geometryCandidates = activeResourcePack ? [...texturePlan.fallbackVoxels, ...staticShapeCandidates] : [];
    const geometryPlan = activeResourcePack
      ? createGeometryBatches(geometryCandidates, activeResourcePack.manifest, activeResourcePack.atlas, occlusionField)
      : { batches: [], fallbackVoxels: [] };
    addGeometryBatches(structure, geometryPlan.batches, 0);
    const fallbackCandidates = activeResourcePack
      ? geometryPlan.fallbackVoxels
      : [...genericTextureCandidates, ...staticShapeCandidates];
    const visibleFallbackVoxels = fallbackCandidates.filter((voxel) => !isVisuallyEmptyVanillaBlock(voxel));
    const specialVoxels = addSpecialResourceVoxels(structure, visibleFallbackVoxels);
    resourceSpecialVoxelCount += specialVoxels.size;
    const blockEntityFallbackVoxels = blockEntityDisplay.add(structure, renderVoxels, visibleFallbackVoxels);
    addWaterloggedFluidVoxels(structure, renderVoxels);
    const ordinaryFallbackVoxels = visibleFallbackVoxels.filter((voxel) => (
      !specialVoxels.has(voxel) && !blockEntityFallbackVoxels.has(voxel)
    ));
    const flowerShapes = addOriginalFlowerShapes(structure, ordinaryFallbackVoxels);
    const remainingFallbackVoxels = ordinaryFallbackVoxels.filter((voxel) => !flowerShapes.has(voxel));
    const resourceFluidCount = addStaticFluidVoxels(structure, remainingFallbackVoxels, renderVoxels);
    if (activeResourcePack) fallbackVoxelCount += ordinaryFallbackVoxels.length - resourceFluidCount;
    const staticShapeVoxels = remainingFallbackVoxels.filter((voxel) => isOriginalStaticShapeBlockId(voxel.sourceBlockId));
    const staticShapeFallback = addOriginalStaticShapeMeshes(structure, staticShapeVoxels, occlusionField, 0, null, null);
    const cubeFallbackVoxels = remainingFallbackVoxels.filter((voxel) => (
      staticFluidKind(voxel) === undefined && !staticShapeFallback.has(voxel)
    ));
    const groups = groupFallbackVoxels(cubeFallbackVoxels);
    for (const [key, voxels] of groups) {
      const [materialId, emissiveKind = "", levelText = ""] = key.split("|");
      const level = levelText === "" ? 0 : Number(levelText);
      const emissiveActive = level > 0;
      const owned = emissiveActive;
      const meshMaterial = owned ? material(materialId!).clone() : material(materialId!);
      const translucent = materialId === "glass" || parseFallbackVisualKey(materialId!)?.transparent === true;
      trackMaterialEffects(meshMaterial, translucent ? 0.22 : 0.12);
      if (emissiveActive) emissiveMaterials.push({ material: meshMaterial, level: level > 0 ? level : 15, kind: emissiveKind || "light" });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.97, 0.97, 0.97), meshMaterial, voxels.length);
      const matrix = new THREE.Matrix4();
      voxels.forEach((voxel, index) => { matrix.makeTranslation(voxel.x, voxel.y, voxel.z); mesh.setMatrixAt(index, matrix); });
      mesh.instanceMatrix.needsUpdate = true;
      applyFallbackOcclusion(mesh, voxels, occlusionField);
      mesh.castShadow = !translucent;
      mesh.receiveShadow = true;
      if (translucent) mesh.renderOrder = 10;
      if (owned) mesh.userData.ownedMaterial = meshMaterial;
      structure.add(mesh);
    }
  }

  function addTexturedBatches(root: THREE.Group, batches: readonly TexturedVoxelBatch[], weathering: number): void {
    for (const batch of batches) {
      const page = activeResourcePack?.atlas.pages[batch.page];
      if (!page) continue;
      const meshMaterial = createAtlasMaterial(page, batch.alphaMode, undefined, batch.stateTintRgb);
      trackMaterialEffects(meshMaterial, 0.09);
      if (weathering > 0) {
        meshMaterial.color.multiplyScalar(1 - weathering * 0.28);
        meshMaterial.roughness = Math.min(1, meshMaterial.roughness + weathering * 0.1);
      }
      if (batch.emissiveLevel > 0) {
        emissiveMaterials.push({
          material: meshMaterial,
          level: batch.emissiveLevel > 0 ? batch.emissiveLevel : 15,
          kind: batch.emissiveKind || "light",
        });
      }
      const geometry = createTexturedBoxGeometry(batch.entries);
      for (const entry of batch.entries) {
        entry.faceTiles.forEach((textureIndex, face) => {
          if ((entry.faceMask & (1 << face)) !== 0) referenceAnimatedTexture(batch.page, textureIndex);
        });
      }
      const mesh = new THREE.InstancedMesh(geometry, meshMaterial, batch.entries.length);
      const matrix = new THREE.Matrix4();
      batch.entries.forEach((entry, index) => {
        matrix.makeTranslation(entry.voxel.x, entry.voxel.y, entry.voxel.z);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      const shadowPolicy = applyGeometryMeshRenderPolicy(
        mesh,
        batch.alphaMode,
        LIGHTWEIGHT_SHADING_PROFILES[qualityTier].features.cutoutShadows,
      );
      if (shadowPolicy.customDepthMaterial === "atlas-cutout") {
        const depthMaterial = createAtlasCutoutDepthMaterial(page);
        mesh.customDepthMaterial = depthMaterial;
        mesh.userData.ownedDepthMaterial = depthMaterial;
        cutoutShadowMeshes.add(mesh);
      }
      mesh.receiveShadow = true;
      mesh.renderOrder = batch.alphaMode === "translucent" ? 10 : 0;
      mesh.userData.ownedMaterial = meshMaterial;
      mesh.userData.textureAlphaMode = batch.alphaMode;
      root.add(mesh);
      texturedBatchCount += 1;
      texturedVoxelCount += batch.entries.length;
      transformedUvVoxelCount += batch.entries.filter(hasTransformedFaceUv).length;
      tintedVoxelCount += batch.entries.filter((entry) => entry.faceTintWord !== 0).length;
    }
  }

  function applyFallbackOcclusion(
    mesh: THREE.InstancedMesh,
    voxels: BlueprintV1["voxels"],
    field: LocalOcclusionField,
    tier: QualityTier = qualityTier,
  ): void {
    fallbackOcclusionMeshes.set(mesh, { voxels, field });
    const strength = LIGHTWEIGHT_SHADING_PROFILES[tier].ambientOcclusionStrength * 0.7;
    const color = new THREE.Color();
    voxels.forEach((voxel, index) => {
      const brightness = 1 - blockOcclusionFor(voxel, field) * strength;
      color.setRGB(brightness, brightness, brightness);
      mesh.setColorAt(index, color);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function addGeometryBatches(
    root: THREE.Group,
    batches: readonly GeometryVoxelBatch[],
    weathering: number,
    revealOrderIndex: ReadonlyMap<BlueprintV1["voxels"][number], number> | null = null,
    revealSchedule: ReturnType<typeof constructionWaveSchedule> | null = null,
    instanceTransform?: (voxel: BlueprintVoxel) => THREE.Matrix4 | undefined,
  ): void {
    for (const batch of batches) {
      const page = activeResourcePack?.atlas.pages[batch.page];
      if (!page) continue;
      const meshMaterial = createAtlasGeometryMaterial(page, batch.alphaMode, undefined, batch.stateTintRgb);
      trackMaterialEffects(meshMaterial, 0.045);
      if (weathering > 0) {
        meshMaterial.color.multiplyScalar(1 - weathering * 0.28);
        meshMaterial.roughness = Math.min(1, meshMaterial.roughness + weathering * 0.1);
      }
      if (batch.emissiveLevel > 0) {
        emissiveMaterials.push({
          material: meshMaterial,
          level: batch.emissiveLevel > 0 ? batch.emissiveLevel : 15,
          kind: batch.emissiveKind || "light",
        });
      }
      const geometry = createAtlasGeometry(batch);
      const mesh = new THREE.InstancedMesh(geometry, meshMaterial, batch.entries.length);
      const matrix = new THREE.Matrix4();
      const hiddenMatrix = new THREE.Matrix4();
      for (const [index, entry] of batch.entries.entries()) {
        const orderIndex = revealOrderIndex?.get(entry.voxel);
        if (orderIndex !== undefined && revealSchedule) {
          hiddenMatrix.makeTranslation(entry.voxel.x, entry.voxel.y, entry.voxel.z)
            .scale(new THREE.Vector3(0.0001, 0.0001, 0.0001));
          mesh.setMatrixAt(index, hiddenMatrix);
          constructionReveals.push({
            mesh,
            index,
            popAtMs: revealSchedule.popAtMsFor(constructionRevealStartedMs, orderIndex),
            targetScale: 1,
            done: false,
          });
        } else {
          const transformed = instanceTransform?.(entry.voxel);
          if (transformed) mesh.setMatrixAt(index, transformed);
          else {
            matrix.makeTranslation(entry.voxel.x, entry.voxel.y, entry.voxel.z);
            mesh.setMatrixAt(index, matrix);
          }
        }
        for (const textureIndex of entry.faceTiles.slice(0, batch.topology.textureSlotCount)) {
          referenceAnimatedTexture(batch.page, textureIndex);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      const shadowPolicy = atlasShadowPolicy(batch.alphaMode);
      mesh.castShadow = shadowPolicy.castShadow
        && (batch.alphaMode !== "cutout" || LIGHTWEIGHT_SHADING_PROFILES[qualityTier].features.cutoutShadows);
      if (shadowPolicy.customDepthMaterial === "atlas-cutout") {
        const depthMaterial = createAtlasGeometryCutoutDepthMaterial(page);
        mesh.customDepthMaterial = depthMaterial;
        mesh.userData.ownedDepthMaterial = depthMaterial;
        cutoutShadowMeshes.add(mesh);
      }
      mesh.userData.ownedMaterial = meshMaterial;
      mesh.userData.textureAlphaMode = batch.alphaMode;
      mesh.userData.geometrySignature = batch.signature;
      root.add(mesh);
      texturedBatchCount += 1;
      texturedVoxelCount += batch.entries.length;
      transformedUvVoxelCount += batch.entries.length;
      geometrySignatureBatchCount += 1;
      geometryVoxelCount += batch.entries.length;
      geometryElementInstanceCount += batch.entries.length * batch.topology.elementCount;
      geometryQuadInstanceCount += batch.entries.length * batch.topology.quads.length;
      multipartGeometryVoxelCount += batch.entries.filter((entry) => (
        entry.voxel.sourceBlockId !== undefined && isP2GeometryBlock(entry.voxel.sourceBlockId)
      )).length;
      if (batch.alphaMode === "translucent") translucentGeometryVoxelCount += batch.entries.length;
    }
  }

  function groupFallbackVoxels(voxels: readonly BlueprintV1["voxels"][number][]): Map<string, BlueprintV1["voxels"]> {
    const groups = new Map<string, BlueprintV1["voxels"]>();
    for (const voxel of voxels) {
      const materialKey = voxel.sourceBlockId ? fallbackVisualStyleForVoxel(voxel).key : voxel.materialId;
      const emission = effectiveEmissionIdentity(voxel);
      const key = `${materialKey}|${emission.kind}|${emission.level}`;
      const list = groups.get(key) ?? [];
      list.push(voxel);
      groups.set(key, list);
    }
    return groups;
  }

  function addSpecialResourceVoxels(
    root: THREE.Group,
    voxels: readonly BlueprintV1["voxels"][number][],
  ): Set<BlueprintV1["voxels"][number]> {
    const handled = new Set<BlueprintV1["voxels"][number]>();
    if (!activeResourcePack) return handled;
    const textures = activeResourcePack.manifest.specialTextures ?? [];
    for (const voxel of addResourceSpecialPortals(root, voxels, textures)) handled.add(voxel);
    for (const voxel of addResourceSpecialBoxes(root, voxels.filter((voxel) => !handled.has(voxel)), textures)) handled.add(voxel);
    for (const voxel of addResourceSpecialFigures(root, voxels.filter((voxel) => !handled.has(voxel)), textures)) handled.add(voxel);
    for (const voxel of addResourceSpecialDecor(root, voxels.filter((voxel) => !handled.has(voxel)), textures)) handled.add(voxel);
    return handled;
  }

  function addStaticFluidVoxels(
    root: THREE.Group,
    voxels: readonly BlueprintV1["voxels"][number][],
    neighboringVoxels: readonly BlueprintV1["voxels"][number][] = voxels,
  ): number {
    const resourcePlan = planResourceFluidBatches(voxels, activeResourcePack?.atlas, neighboringVoxels);
    const drawnAtlasVoxels = new Set<BlueprintV1["voxels"][number]>();
    const drawnFallbackVoxels = new Set<BlueprintV1["voxels"][number]>();

    for (const batch of resourcePlan.batches) {
      const page = activeResourcePack?.atlas.pages[batch.page];
      if (!page) continue;
      const geometry = createTexturedBoxGeometry(batch.entries);
      for (const entry of batch.entries) {
        entry.faceTiles.forEach((textureIndex, face) => {
          if ((entry.faceMask & (1 << face)) !== 0) referenceFluidAnimatedTexture(batch.page, textureIndex);
        });
      }
      geometry.scale(0.995 / 0.97, 1 / 0.97, 0.995 / 0.97);
      const meshMaterial = createAtlasMaterial(page, batch.alphaMode);
      if (batch.kind === "water") {
        meshMaterial.transparent = true;
        meshMaterial.opacity = 0.76;
        meshMaterial.depthWrite = false;
      } else {
        meshMaterial.emissive.setHex(0x70290c);
        meshMaterial.emissiveIntensity = 0.16;
      }
      const mesh = new THREE.InstancedMesh(geometry, meshMaterial, batch.entries.length);
      const matrix = new THREE.Matrix4();
      batch.entries.forEach((entry, index) => {
        matrix.makeTranslation(entry.voxel.x, entry.voxel.y, entry.voxel.z);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = batch.kind === "water";
      mesh.renderOrder = batch.kind === "water" ? 10 : 1;
      mesh.userData.ownedMaterial = meshMaterial;
      mesh.userData.resourceFluid = batch.kind;
      root.add(mesh);
      batch.entries.forEach((entry) => drawnAtlasVoxels.add(entry.voxel));
      texturedBatchCount += 1;
    }

    for (const batch of resourcePlan.fallbackBatches) {
      const geometry = createTexturedBoxGeometry(batch.entries);
      geometry.scale(0.995 / 0.97, 1 / 0.97, 0.995 / 0.97);
      const meshMaterial = material(batch.kind === "lava" ? "terrainLava" : "terrainWater").clone();
      trackMaterialEffects(meshMaterial, 0);
      patchFluidFallbackMaterial(meshMaterial);
      if (batch.kind === "water") {
        meshMaterial.transparent = true;
        meshMaterial.opacity = activeResourcePack ? 0.48 : 0.76;
        meshMaterial.depthWrite = false;
      }
      const mesh = new THREE.InstancedMesh(geometry, meshMaterial, batch.entries.length);
      const matrix = new THREE.Matrix4();
      batch.entries.forEach((entry, index) => {
        matrix.makeTranslation(entry.voxel.x, entry.voxel.y, entry.voxel.z);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = batch.kind === "water";
      mesh.renderOrder = batch.kind === "water" ? 10 : 1;
      mesh.userData.ownedMaterial = meshMaterial;
      mesh.userData.resourceFluid = `${batch.kind}-fallback`;
      root.add(mesh);
      batch.entries.forEach((entry) => drawnFallbackVoxels.add(entry.voxel));
    }
    texturedVoxelCount += drawnAtlasVoxels.size;
    resourceFluidVoxelCount += drawnAtlasVoxels.size + drawnFallbackVoxels.size;
    return drawnAtlasVoxels.size + drawnFallbackVoxels.size;
  }

  function addWaterloggedFluidVoxels(root: THREE.Group, voxels: readonly BlueprintV1["voxels"][number][]): void {
    const plan = planResourceWaterloggedFluidBatches(voxels, activeResourcePack?.atlas);
    const drawnAtlasVoxels = new Set<BlueprintV1["voxels"][number]>();
    const drawnFallbackVoxels = new Set<BlueprintV1["voxels"][number]>();

    for (const batch of plan.batches) {
      const page = activeResourcePack?.atlas.pages[batch.page];
      if (!page) continue;
      const geometry = createTexturedBoxGeometry(batch.entries);
      // Slightly inset the complete liquid cell. Imported model depth/alpha
      // then determines which parts of this volume can actually show through.
      geometry.scale(0.985 / 0.97, 1 / 0.97, 0.985 / 0.97);
      const meshMaterial = createAtlasMaterial(page, "translucent");
      meshMaterial.transparent = true;
      meshMaterial.opacity = 0.76;
      meshMaterial.depthWrite = false;
      const mesh = new THREE.InstancedMesh(geometry, meshMaterial, batch.entries.length);
      const matrix = new THREE.Matrix4();
      batch.entries.forEach((entry, index) => {
        entry.faceTiles.forEach((textureIndex, face) => {
          if ((entry.faceMask & (1 << face)) !== 0) referenceFluidAnimatedTexture(batch.page, textureIndex);
        });
        matrix.makeTranslation(entry.voxel.x, entry.voxel.y, entry.voxel.z);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 10;
      mesh.userData.ownedMaterial = meshMaterial;
      mesh.userData.resourceFluid = "waterlogged";
      root.add(mesh);
      batch.entries.forEach((entry) => drawnAtlasVoxels.add(entry.voxel));
      texturedBatchCount += 1;
    }

    for (const batch of plan.fallbackBatches) {
      const geometry = createTexturedBoxGeometry(batch.entries);
      geometry.scale(0.985 / 0.97, 1 / 0.97, 0.985 / 0.97);
      const meshMaterial = material("terrainWater").clone();
      trackMaterialEffects(meshMaterial, 0);
      patchFluidFallbackMaterial(meshMaterial);
      meshMaterial.transparent = true;
      meshMaterial.opacity = 0.48;
      meshMaterial.depthWrite = false;
      const mesh = new THREE.InstancedMesh(geometry, meshMaterial, batch.entries.length);
      const matrix = new THREE.Matrix4();
      batch.entries.forEach((entry, index) => {
        matrix.makeTranslation(entry.voxel.x, entry.voxel.y, entry.voxel.z);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 10;
      mesh.userData.ownedMaterial = meshMaterial;
      mesh.userData.resourceFluid = "waterlogged-fallback";
      root.add(mesh);
      batch.entries.forEach((entry) => drawnFallbackVoxels.add(entry.voxel));
    }
    texturedVoxelCount += drawnAtlasVoxels.size;
    resourceFluidVoxelCount += drawnAtlasVoxels.size + drawnFallbackVoxels.size;
  }

  function patchFluidFallbackMaterial(meshMaterial: THREE.MeshStandardMaterial): void {
    const previousOnBeforeCompile = meshMaterial.onBeforeCompile;
    const previousCacheKey = meshMaterial.customProgramCacheKey();
    meshMaterial.onBeforeCompile = (shader, renderer) => {
      previousOnBeforeCompile.call(meshMaterial, shader, renderer);
      shader.vertexShader = patchFluidSurfaceVertexShader(shader.vertexShader);
    };
    meshMaterial.customProgramCacheKey = () => `${previousCacheKey}|blockcolc-fluid-surface-v1`;
    meshMaterial.needsUpdate = true;
  }

  function addVines(root: THREE.Group, vines: ReturnType<typeof conditionVisualForVoxels>["vines"]): void {
    if (vines.length === 0) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material("vine"), vines.length);
    const matrix = new THREE.Matrix4();
    vines.forEach((vine, index) => {
      matrix.compose(
        new THREE.Vector3(vine.x, vine.y, vine.z),
        new THREE.Quaternion(),
        new THREE.Vector3(vine.axis === "x" ? 0.12 : 0.58, 0.78, vine.axis === "z" ? 0.12 : 0.58),
      );
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.userData.decayFeature = "vines";
    root.add(mesh);
  }

  function addPlannedOutline(root: THREE.Group, blueprint: BlueprintV1, completion: number, showOutline: boolean): void {
    if (!showOutline) return;
    const occupied = new Set(blueprint.voxels.map((voxel) => `${voxel.x}:${voxel.y}:${voxel.z}`));
    const planned = blueprint.voxels.filter((voxel) => voxel.buildOrder > completion && isExposedVoxel(voxel, occupied));
    if (planned.length === 0) return;
    plannedOutlineVoxelCount += planned.length;
    const plannedMaterial = new THREE.MeshStandardMaterial({
      color: 0x8fa097,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    const outline = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), plannedMaterial, planned.length);
    const matrix = new THREE.Matrix4();
    planned.forEach((voxel, index) => { matrix.makeTranslation(voxel.x, voxel.y, voxel.z); outline.setMatrixAt(index, matrix); });
    outline.instanceMatrix.needsUpdate = true;
    outline.userData.ownedMaterial = plannedMaterial;
    root.add(outline);
  }

  function isExposedVoxel(voxel: BlueprintV1["voxels"][number], occupied: ReadonlySet<string>): boolean {
    return !occupied.has(`${voxel.x - 1}:${voxel.y}:${voxel.z}`)
      || !occupied.has(`${voxel.x + 1}:${voxel.y}:${voxel.z}`)
      || !occupied.has(`${voxel.x}:${voxel.y - 1}:${voxel.z}`)
      || !occupied.has(`${voxel.x}:${voxel.y + 1}:${voxel.z}`)
      || !occupied.has(`${voxel.x}:${voxel.y}:${voxel.z - 1}`)
      || !occupied.has(`${voxel.x}:${voxel.y}:${voxel.z + 1}`);
  }

  function addNaturalEnvironmentDecorations(
    worlds: readonly PositionedWorldSnapshot[],
    roads: readonly ReturnType<typeof roadCellsForVillage>[number][],
    importedDecorations: readonly ImportedDecorationPlacement[],
    environmentStyle: TerrainEnvironmentStyle,
    terrain: MergedGeometryData,
  ): void {
    const placements = naturalDecorationPlacementsForScene({
      worlds, roads, importedDecorations, environmentStyle, terrain, worldSeed: options.worldSeed, qualityTier,
    });
    const lod = naturalDecorationLodForCamera(cameraDistance, maximumCameraDistance);
    for (const kind of [...new Set(placements.map(entry => entry.kind))]) {
      const entries = placements.filter(entry => entry.kind === kind);
      if (kind === "flower") {
        addNaturalFlowerBatches(entries, lod);
        continue;
      }
      const fullGeometry = naturalDecorationGeometry(kind, "full");
      const silhouetteGeometry = naturalDecorationGeometry(kind, "silhouette");
      const geometry = lod === "full" ? fullGeometry : silhouetteGeometry;
      const alternateGeometry = lod === "full" ? silhouetteGeometry : fullGeometry;
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      const kindScale = naturalDecorationRenderScale(kind);
      const matrix = new THREE.Matrix4();
      entries.forEach((entry, index) => {
        const scale = kindScale * entry.scale;
        const y = naturalDecorationOriginY(kind, entry.support, entry.y!, geometry.boundingBox!.min.y, scale);
        matrix.compose(new THREE.Vector3(entry.x, y, entry.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), entry.rotationY),
          new THREE.Vector3(scale, scale, scale));
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = `natural-environment-${kind}-${lod}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData.naturalDecorationKind = kind;
      mesh.userData.naturalDecorationIds = entries.map(entry => entry.id);
      mesh.userData.naturalDecorationLod = lod;
      mesh.userData.ownedMaterial = material;
      mesh.userData.naturalDecorationAlternateGeometry = alternateGeometry;
      mesh.userData.naturalDecorationPlacements = entries;
      mesh.userData.naturalDecorationKindScale = kindScale;
      if (kind === "shelf-mushroom" && naturalTreeSway) {
        entries.forEach((entry, index) => {
          if (entry.supportTreeIndex === undefined) return;
          const baseMatrix = new THREE.Matrix4();
          mesh.getMatrixAt(index, baseMatrix);
          naturalTreeSway!.attachments.push({ mesh, index, treeIndex: entry.supportTreeIndex, baseMatrix });
        });
      }
      buildingGroup.add(mesh);
    }
    ambientDecorationCount = placements.length;
    treeSideMushroomCount = placements.filter(entry => entry.kind === "shelf-mushroom" && entry.supportTreeIndex !== undefined
      && entry.supportTreeIndex < visibleNaturalTreeCount(terrain.naturalTrees.length, qualityTier)).length;
    syncNaturalTreeAttachments();
    syncNaturalDecorationBatchDiagnostics();
    canvas.dataset.naturalDecorationCount = String(placements.length);
    canvas.dataset.naturalDecorationLod = lod;
  }

  function syncNaturalDecorationBatchDiagnostics(): void {
    const batches = buildingGroup.children.filter((child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh && typeof child.userData.naturalDecorationKind === "string");
    const diagnostics = naturalDecorationBatchDiagnostics(batches.map(child => ({
      kind: String(child.userData.naturalDecorationKind), visible: child.visible, castsShadow: child.castShadow,
    })));
    // Kind count represents currently visible kinds; allocation includes alternate LODs.
    ambientDecorationKindCount = diagnostics.kindCount;
    ambientDecorationDrawCalls = diagnostics.drawCalls;
    ambientDecorationAllocatedBatchCount = diagnostics.allocatedBatchCount;
    ambientDecorationShadowCasters = diagnostics.shadowCasters;
    canvas.dataset.ambientDecorationKindCount = String(ambientDecorationKindCount);
    canvas.dataset.ambientDecorationDrawCalls = String(ambientDecorationDrawCalls);
    canvas.dataset.ambientDecorationAllocatedBatchCount = String(ambientDecorationAllocatedBatchCount);
    canvas.dataset.ambientDecorationShadowCasters = String(ambientDecorationShadowCasters);
    canvas.dataset.naturalDecorationDrawCalls = String(ambientDecorationDrawCalls);
    canvas.dataset.naturalDecorationAllocatedBatchCount = String(ambientDecorationAllocatedBatchCount);
  }

  function addNaturalFlowerBatches(entries: readonly NaturalDecorationPlacement[], lod: NaturalDecorationLod): void {
    const voxelPlacements = new Map<BlueprintVoxel, NaturalDecorationPlacement>();
    const bySource = new Map<string, BlueprintVoxel[]>();
    for (const entry of entries) {
      const sourceBlockId = naturalFlowerSourceBlockId(entry.variant);
      const voxel: BlueprintVoxel = {
        x: entry.x,
        y: entry.y!,
        z: entry.z,
        materialId: "accent",
        buildOrder: 0,
        sourceBlockId,
      };
      voxelPlacements.set(voxel, entry);
      const group = bySource.get(sourceBlockId) ?? [];
      group.push(voxel);
      bySource.set(sourceBlockId, group);
    }

    const originalChildren = new Set(buildingGroup.children);
    const packSuccess = new Set<BlueprintVoxel>();
    for (const voxels of bySource.values()) {
      const plan = planNaturalFlowerPackBatches(voxels, activeResourcePack?.manifest, activeResourcePack?.atlas);
      plan.packVoxels.forEach(voxel => packSuccess.add(voxel));
      if (activeResourcePack) {
        const transform = (voxel: BlueprintVoxel): THREE.Matrix4 | undefined => {
          const placement = voxelPlacements.get(voxel);
          if (!placement) return undefined;
          const scale = naturalDecorationRenderScale("flower") * placement.scale;
          const y = naturalDecorationOriginY("flower", "ground", placement.y!, -0.5, scale);
          return new THREE.Matrix4().compose(
            new THREE.Vector3(placement.x, y, placement.z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotationY),
            new THREE.Vector3(scale, scale, scale),
          );
        };
        addGeometryBatches(buildingGroup, plan.batches, 0, null, null, transform);
      }
    }

    const newlyAddedFull = buildingGroup.children.filter((child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh && !originalChildren.has(child));
    for (const mesh of newlyAddedFull) {
      mesh.userData.naturalDecorationKind = "flower";
      mesh.userData.naturalDecorationVariant = "full";
      mesh.userData.naturalDecorationLod = lod;
      mesh.visible = naturalDecorationVariantVisible(lod, "full");
      mesh.frustumCulled = false;
      // Ambient flowers intentionally do not cast shadows. Resource-pack cutout
      // geometry is otherwise registered for atlas depth passes by the generic batcher.
      disableNaturalFlowerShadowCasting(mesh, cutoutShadowMeshes);
    }

    const fallback = [...voxelPlacements.keys()].filter(voxel => !packSuccess.has(voxel));
    const fallbackChildren = new Set(buildingGroup.children);
    addOriginalFlowerShapes(buildingGroup, fallback, (voxel) => {
      const placement = voxelPlacements.get(voxel);
      if (!placement) return undefined;
      const scale = naturalDecorationRenderScale("flower") * placement.scale;
      const y = naturalDecorationOriginY("flower", "ground", placement.y!, -0.45, scale);
      return new THREE.Matrix4().compose(
        new THREE.Vector3(placement.x, y, placement.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotationY),
        new THREE.Vector3(scale, scale, scale),
      );
    });
    for (const child of buildingGroup.children) {
      if (child instanceof THREE.InstancedMesh && !fallbackChildren.has(child)) {
        child.userData.naturalDecorationKind = "flower";
        child.userData.naturalDecorationVariant = "full";
        child.userData.naturalDecorationLod = lod;
        child.visible = naturalDecorationVariantVisible(lod, "full");
        child.frustumCulled = false;
      }
    }
    const silhouette = naturalDecorationGeometry("flower", "silhouette");
    const silhouetteMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const silhouetteMesh = new THREE.InstancedMesh(silhouette, silhouetteMaterial, entries.length);
    const kindScale = naturalDecorationRenderScale("flower");
    const matrix = new THREE.Matrix4();
    entries.forEach((entry, index) => {
      const scale = kindScale * entry.scale;
      const y = naturalDecorationOriginY("flower", entry.support, entry.y!, silhouette.boundingBox!.min.y, scale);
      matrix.compose(new THREE.Vector3(entry.x, y, entry.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), entry.rotationY),
        new THREE.Vector3(scale, scale, scale));
      silhouetteMesh.setMatrixAt(index, matrix);
    });
    silhouetteMesh.instanceMatrix.needsUpdate = true;
    silhouetteMesh.name = `natural-environment-flower-silhouette`;
    silhouetteMesh.castShadow = false;
    silhouetteMesh.receiveShadow = false;
    silhouetteMesh.frustumCulled = false;
    silhouetteMesh.userData.naturalDecorationKind = "flower";
    silhouetteMesh.userData.naturalDecorationVariant = "silhouette";
    silhouetteMesh.userData.naturalDecorationLod = lod;
    silhouetteMesh.userData.naturalDecorationIds = entries.map(entry => entry.id);
    silhouetteMesh.userData.ownedMaterial = silhouetteMaterial;
    silhouetteMesh.visible = naturalDecorationVariantVisible(lod, "silhouette");
    buildingGroup.add(silhouetteMesh);
    naturalFlowerPackPlacementCount = packSuccess.size;
    naturalFlowerOriginalFallbackCount = fallback.length;
  }

  function updateNaturalDecorationLod(): void {
    const observedLods = new Set<NaturalDecorationLod>();
    for (const child of buildingGroup.children) {
      if (!(child instanceof THREE.InstancedMesh) || !String(child.userData.naturalDecorationKind ?? "").length) continue;
      const currentLod = child.userData.naturalDecorationLod as NaturalDecorationLod;
      const targetLod = naturalDecorationLodForCamera(cameraDistance, maximumCameraDistance, currentLod);
      observedLods.add(targetLod);
      const variant = child.userData.naturalDecorationVariant as "full" | "silhouette" | undefined;
      if (variant) {
        child.visible = naturalDecorationVariantVisible(targetLod, variant);
        child.userData.naturalDecorationLod = targetLod;
        continue;
      }
      if (child.userData.naturalDecorationLod === targetLod) continue;
      const alternate = child.userData.naturalDecorationAlternateGeometry as THREE.BufferGeometry | undefined;
      const placements = child.userData.naturalDecorationPlacements as readonly NaturalDecorationPlacement[] | undefined;
      if (!alternate || !placements || !alternate.boundingBox) continue;
      const current = child.geometry;
      child.geometry = alternate;
      child.userData.naturalDecorationAlternateGeometry = current;
      child.userData.naturalDecorationLod = targetLod;
      const kind = child.userData.naturalDecorationKind as NaturalDecorationKind;
      const kindScale = child.userData.naturalDecorationKindScale as number;
      const matrix = new THREE.Matrix4();
      placements.forEach((entry, index) => {
        const scale = kindScale * entry.scale;
        const y = naturalDecorationOriginY(kind, entry.support, entry.y!, alternate.boundingBox!.min.y, scale);
        matrix.compose(new THREE.Vector3(entry.x, y, entry.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), entry.rotationY),
          new THREE.Vector3(scale, scale, scale));
        child.setMatrixAt(index, matrix);
      });
      child.instanceMatrix.needsUpdate = true;
    }
    syncNaturalTreeAttachments();
    syncNaturalDecorationBatchDiagnostics();
    canvas.dataset.naturalDecorationLod = observedLods.size > 1 ? "mixed"
      : observedLods.values().next().value ?? "none";
  }

  function addDecorations(root: THREE.Group, world: PositionedWorldSnapshot, emissivePoints: EmissivePoint[]): void {
    for (const placement of decorationsForProject(world.projectId, world.decorationDates ?? [], world.blueprint)) {
      const decoration = new THREE.Group();
      decoration.position.set(placement.x, 0, placement.z);
      decoration.userData.decorationId = placement.id;
      decoration.userData.decorationKind = placement.kind;
      if (placement.kind === "tree") {
        addBox(decoration, "wood", [0.72, 2.7, 0.72], [0, 1.35, 0]);
        addBox(decoration, "leaves", [2.3, 1.8, 2.3], [0, 3.05, 0]);
        if (placement.variant % 2 === 1) addBox(decoration, "leaves", [1.5, 1.1, 1.5], [0, 4.15, 0]);
      } else if (placement.kind === "road") addBox(decoration, "path", [1.8, 0.18, 1.8], [0, -0.05, 0]);
      else if (placement.kind === "lamp") {
        addBox(decoration, "wood", [0.28, 2.5, 0.28], [0, 1.25, 0]);
        addBox(decoration, "lamp", [0.72, 0.72, 0.72], [0, 2.55, 0]);
        const localX = placement.x + world.blueprintOffset.x;
        const localZ = placement.z + world.blueprintOffset.z;
        const cos = Math.cos(world.rotationY); const sin = Math.sin(world.rotationY);
        registerEmissivePoint(emissivePoints, emissivePointColors, {
          x: world.worldPosition.x + localX * cos + localZ * sin,
          y: world.worldPosition.y + 2.55,
          z: world.worldPosition.z - localX * sin + localZ * cos,
          intensity: 15,
        }, 0xffb45f);
      } else {
        addBox(decoration, "wood", [1.8, 0.3, 0.7], [0, 0.75, 0]);
        addBox(decoration, "wood", [0.25, 0.75, 0.25], [-0.62, 0.35, 0]);
        addBox(decoration, "wood", [0.25, 0.75, 0.25], [0.62, 0.35, 0]);
      }
      root.add(decoration);
    }
  }

  function addBox(parent: THREE.Group, materialId: string, scale: readonly [number, number, number], position: readonly [number, number, number]): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...scale), material(materialId));
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  function addClusteredLights(points: readonly EmissivePoint[], colors: ReadonlyMap<string, number>): void {
    clearLights();
    const lightPoints = clusterEmissivePoints(points, QUALITY_PROFILES.high.maxLocalLights);
    for (const point of lightPoints) {
      const light = new THREE.PointLight(emissiveColorForPoint(point, colors), 0, 12, 2);
      light.position.set(point.x, point.y, point.z);
      light.castShadow = false;
      localLightGroup.add(light);
      localLights.push({ light, baseIntensity: 0.75 + (point.intensity / 15) * 1.1 });
    }
    // Glow sprites are a presentation cue, so anchor them to actual lamp
    // blocks instead of the centroids used to amortize dynamic point lights.
    for (const point of selectEmissiveVisualPoints(points, QUALITY_PROFILES.high.maxGlowSprites)) {
      const color = emissiveColorForPoint(point, colors);
      const sprite = new THREE.Sprite(glowMaterials.get(color) ?? glowMaterial);
      const scale = 0.92 + (point.intensity / 15) * 0.2;
      sprite.position.set(point.x, point.y, point.z);
      sprite.scale.set(scale, scale, 1);
      sprite.renderOrder = 5;
      localLightGroup.add(sprite);
      glowSprites.push({ sprite });
    }
  }

  function updateLighting(now: Date, forceShadowRefresh = false): void {
    const projectedNow = environmentDebugOverride?.date == null
      ? now
      : new Date(environmentDebugOverride.date);
    const targetLighting = astronomyContext
      ? sunStateForAstronomy(projectedNow, astronomyContext.coordinates) ?? sunStateForLocalTime(projectedNow)
      : sunStateForLocalTime(projectedNow);
    const transition = lightingTransition;
    if (transition && !reducedMotion && paneVisible && !document.hidden) {
      const progress = Math.min(1, Math.max(0, (performance.now() - transition.startedAtMs) / transition.durationMs));
      currentLighting = interpolateSunState(transition.from, targetLighting, smoothstep(0, 1, progress));
      if (progress >= 1) {
        lightingTransition = null;
        environmentTransitionCompletedCount += 1;
      }
    } else {
      currentLighting = targetLighting;
      if (lightingTransition && (reducedMotion || !paneVisible || document.hidden)) {
        lightingTransition = null;
        environmentTransitionCancelledCount += 1;
      }
    }
    const state = currentLighting;
    lightingUpdateCount += 1;
    lightingSampledAtMs = projectedNow.getTime();
    if (astronomyContext) astronomyUpdateCount += 1;
    const snappedTarget = snappedShadowTarget();
    sun.target.position.copy(snappedTarget);
    const shadowSource = shadowLightPositionForExtent(state.position, shadowExtent);
    sun.position.set(
      snappedTarget.x + shadowSource[0],
      snappedTarget.y + shadowSource[1],
      snappedTarget.z + shadowSource[2],
    );
    // Shadow auto-update is intentionally disabled for mobile cost. Explicitly
    // flush the dynamic light rig before requesting the next depth sample so a
    // time-of-day update cannot render one frame with the previous light matrix.
    lightRig.updateMatrixWorld(true);
    sun.shadow.updateMatrices(sun);
    // Night readability comes from hemisphere/exposure, not a below-horizon
    // directional source that would keep casting a false daytime shadow.
    sun.intensity = state.intensity * state.sunVisibility * sunlightScaleForWeather(currentWeather);
    sun.color.setHex(state.color);
    hemisphere.color.setHex(state.hemisphereSkyColor);
    hemisphere.groundColor.setHex(state.hemisphereGroundColor);
    const sunlightScale = sunlightScaleForWeather(currentWeather);
    hemisphere.intensity = state.hemisphereIntensity * ambientScaleForWeather(currentWeather, state.nightFactor);
    renderer.toneMappingExposure = state.exposure;
    for (const entry of emissiveMaterials) {
      entry.material.emissive.setHex(emissiveColor(entry.kind));
      entry.material.emissiveIntensity = state.nightFactor * (entry.level / 15) * 1.55;
    }
    const lamp = materials.get("lamp");
    if (lamp) { lamp.emissive.setHex(0xffb75f); lamp.emissiveIntensity = state.nightFactor * 1.2; }
    for (const [index, entry] of localLights.entries()) {
      entry.light.visible = index < qualityProfile.maxLocalLights;
      entry.light.intensity = entry.baseIntensity * state.nightFactor;
    }
    setGlowMaterialsOpacity(state.nightFactor * (qualityTier === "high" ? 0.62 : 0.48));
    for (const [index, entry] of glowSprites.entries()) entry.sprite.visible = index < qualityProfile.maxGlowSprites
      && glowMaterial.opacity > 0.015;
    updateReflectiveMaterials(state);
    updateMaterialEffects(state);
    applyAtmosphere();
    requestShadowRefresh(projectedNow, forceShadowRefresh);
    // Keep the diagnostic vector fields coherent with the fingerprint and
    // update count.  The lighting timer changes the scene synchronously and
    // schedules its render on the one-slot frame pump; waiting for that frame
    // to publish these attributes let observers see a new fingerprint paired
    // with the previous sun/moon/shadow vectors.
    canvas.dataset.lightingUpdateCount = String(lightingUpdateCount);
    canvas.dataset.lightingSampledAtMs = String(lightingSampledAtMs);
    canvas.dataset.lightingFingerprint = lightingDirectionFingerprint(state);
    canvas.dataset.sunPosition = state.sunPosition.map((value) => value.toFixed(4)).join(",");
    canvas.dataset.moonPosition = state.moonPosition.map((value) => value.toFixed(4)).join(",");
    canvas.dataset.shadowDirection = shadowDirectionFromPosition(state.position).map((value) => value.toFixed(4)).join(",");
    canvas.dataset.astronomySampleTime = String(lightingSampledAtMs);
    canvas.dataset.astronomyPhase = state.phase;
    canvas.dataset.environmentTransitionTarget = astronomyContext ? "astronomy" : "synthetic";
    canvas.dataset.environmentTransitionActive = String(lightingTransition !== null || environmentReveal !== null);
    requestRender();
  }

  function beginLightingTransition(): void {
    if (reducedMotion || !paneVisible || document.hidden || disposed) {
      lightingTransition = null;
      updateLighting(new Date(), false);
      return;
    }
    lightingTransition = { from: currentLighting, startedAtMs: performance.now(), durationMs: 1_500 };
    environmentTransitionStartedCount += 1;
    updateLighting(new Date(), false);
  }

  function startEnvironmentReveal(roots: readonly THREE.Group[], target: "weather" | "decay"): void {
    if (environmentReveal) finishEnvironmentReveal(true);
    if (reducedMotion || !paneVisible || document.hidden || disposed) return;
    const objects: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }> = [];
    const clones = new Map<THREE.Material, { material: THREE.Material; opacity: number }>();
    for (const root of roots) root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const original = object.material;
      const originals = Array.isArray(original) ? original : [original];
      const copy = originals.map(material => {
        let entry = clones.get(material);
        if (!entry) {
          const clone = cloneEnvironmentRevealMaterial(material);
          const opacity = material.opacity;
          clone.transparent = true;
          clone.depthWrite = false;
          clone.opacity = 0;
          clone.needsUpdate = true;
          entry = { material: clone, opacity };
          clones.set(material, entry);
        }
        return entry.material;
      });
      objects.push({ mesh: object, material: original });
      object.material = Array.isArray(original) ? copy : copy[0]!;
    });
    if (objects.length === 0) return;
    environmentReveal = { startedAtMs: performance.now(), durationMs: 1_500, target, objects, clones };
    environmentTransitionStartedCount += 1;
    canvas.dataset.environmentTransitionTarget = target;
    canvas.dataset.environmentTransitionActive = "true";
    canvas.dataset.environmentTransitionPhase = "0.000";
    updateDiagnosticsDataset();
    requestRender();
  }

  function updateEnvironmentReveal(nowMs: number): boolean {
    if (!environmentReveal) return false;
    if (reducedMotion || !paneVisible || document.hidden || disposed) {
      finishEnvironmentReveal(true);
      return false;
    }
    const reveal = environmentReveal;
    const progress = THREE.MathUtils.clamp((nowMs - reveal.startedAtMs) / reveal.durationMs, 0, 1);
    const opacity = smoothstep(0, 1, progress);
    for (const entry of reveal.clones.values()) {
      entry.material.opacity = entry.opacity * opacity;
    }
    canvas.dataset.environmentTransitionPhase = opacity.toFixed(3);
    if (progress >= 1) {
      finishEnvironmentReveal(false);
      return false;
    }
    return true;
  }

  function finishEnvironmentReveal(cancelled: boolean): void {
    const reveal = environmentReveal;
    if (!reveal) return;
    environmentReveal = null;
    for (const entry of reveal.objects) entry.mesh.material = entry.material;
    for (const entry of reveal.clones.values()) entry.material.dispose();
    if (cancelled) environmentTransitionCancelledCount += 1;
    else environmentTransitionCompletedCount += 1;
    canvas.dataset.environmentTransitionActive = String(lightingTransition !== null);
    canvas.dataset.environmentTransitionPhase = cancelled ? "cancelled" : "1.000";
    updateDiagnosticsDataset();
  }

  function trackMaterialEffects(meshMaterial: THREE.MeshStandardMaterial, edgeStrength = 0): void {
    const profile = LIGHTWEIGHT_SHADING_PROFILES[qualityTier];
    materialEdgeStrengths.set(meshMaterial, edgeStrength);
    materialEffectPatches.set(meshMaterial, applyMaterialEffects(meshMaterial, {
      lightDirection: currentLighting.position,
      lightTint: currentLighting.color,
      shadowTint: profile.coolColor,
      strength: profile.faceContrast,
      edgeStrength: edgeStrength * (0.35 + nearDetailFactor * 0.65),
    }));
  }

  function updateMaterialEffects(state: SunState): void {
    const profile = LIGHTWEIGHT_SHADING_PROFILES[qualityTier];
    for (const patch of materialEffectPatches.values()) {
      patch.update({
        lightDirection: state.position,
        lightTint: state.color,
        shadowTint: profile.coolColor,
        strength: profile.faceContrast,
      });
    }
  }

  // V24: real-world sea tones — turquoise shallow tropics, deep blue open
  // ocean, emerald phytoplankton-rich water, slate grey temperate seas.
  // The world seed picks one so a world keeps its sea identity forever.
  const OCEAN_SEA_TONES = {
    azure: 0x2ea3ad,
    deep: 0x1d62a8,
    emerald: 0x20998a,
    slate: 0x5b7b99,
  } as const;
  function oceanSeaTone(worldSeed: string): keyof typeof OCEAN_SEA_TONES {
    let hash = 0x811c9dc5;
    for (let index = 0; index < worldSeed.length; index += 1) {
      hash = Math.imul(hash ^ worldSeed.charCodeAt(index), 0x01000193) >>> 0;
    }
    return (["azure", "deep", "emerald", "slate"] as const)[hash % 4]!;
  }

  function updateReflectiveMaterials(state: SunState): void {
    const water = materials.get("terrainWater");
    if (water) {
      // V24: ocean environments pick one of four real-world sea tones,
      // determined by the world seed so every world keeps its identity.
      const base = options.environmentStyle === "ocean-island"
        ? OCEAN_SEA_TONES[oceanSeaTone(options.worldSeed ?? "world-default")]
        : 0x3e7380;
      water.color.setHex(base).lerp(new THREE.Color(state.skyHorizonColor), qualityTier === "high" ? 0.2 : 0.1);
      water.roughness = options.debugVoidScan ? 1 : (qualityTier === "high" ? 0.22 : qualityTier === "balanced" ? 0.3 : 0.48);
      water.metalness = qualityTier === "high" ? 0.1 : 0.04;
      water.emissive.setHex(state.nightFactor > 0.55 ? 0x102c36 : 0x071c22);
      water.emissiveIntensity = qualityTier === "high" ? 0.2 : 0.08;
    }
    const glass = materials.get("glass");
    if (glass) {
      glass.color.setHex(state.nightFactor > 0.55 ? 0x7f9eae : 0x8eb4b7);
      glass.roughness = qualityTier === "high" ? 0.08 : qualityTier === "balanced" ? 0.14 : 0.22;
      glass.opacity = qualityTier === "high" ? 0.52 : qualityTier === "balanced" ? 0.46 : 0.4;
      glass.emissive.setHex(state.nightFactor > 0.55 ? 0x24485b : 0x173641);
      glass.emissiveIntensity = qualityTier === "high" ? 0.18 : 0.1;
    }
  }

  function updateNearDetailEffects(): void {
    const distanceRatio = cameraDistance / Math.max(0.001, fittedDistance);
    const next = focusedProjectId !== null ? 1 : THREE.MathUtils.clamp((1.04 - distanceRatio) / 0.3, 0, 1);
    if (Math.abs(next - nearDetailFactor) < 0.015) return;
    nearDetailFactor = next;
    for (const [meshMaterial, patch] of materialEffectPatches) {
      const base = materialEdgeStrengths.get(meshMaterial) ?? 0;
      patch.update({ edgeStrength: base * (0.35 + nearDetailFactor * 0.65) });
    }
  }

  function snappedShadowTarget(): THREE.Vector3 {
    const center = contentBounds.getCenter(new THREE.Vector3());
    const texelSize = (shadowExtent * 2) / Math.max(1, qualityProfile.shadowMapSize);
    return new THREE.Vector3(
      Math.round(center.x / texelSize) * texelSize,
      Math.max(1.5, center.y),
      Math.round(center.z / texelSize) * texelSize,
    );
  }

  function requestShadowRefresh(now: Date, force = false): void {
    const candidate = {
      sampledAtMs: now.getTime(),
      lightDirection: currentLighting.position,
      cameraAnchor: [cameraTarget.x, cameraTarget.y, cameraTarget.z] as const,
      sceneRevision,
      force,
    };
    const decision = shouldRefreshShadow(
      lastShadowSample,
      candidate,
      LIGHTWEIGHT_SHADING_PROFILES[qualityTier].shadowRefresh,
    );
    if (!decision.refresh) return;
    const alreadyPending = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.needsUpdate = true;
    if (!alreadyPending) shadowRefreshCount += 1;
    lastShadowRefreshReason = decision.reason;
    lastShadowSample = candidate;
  }

  function precipitationFieldForCamera(precipitationMaxY: number): PrecipitationField {
    const bounds = previewMode ? contentBounds : visibilityBounds;
    const boundsSize = bounds.getSize(new THREE.Vector3());
    const focused = focusedProjectId === null ? undefined : positionedWorlds.find(world => world.projectId === focusedProjectId);
    const framingBounds = focused ? focusBoundsFor(focused) : contentBounds;
    const framingSize = framingBounds.getSize(new THREE.Vector3());
    const framingSpanX = Math.max(1, framingSize.x);
    const framingSpanZ = Math.max(1, framingSize.z);
    const maximumSpanX = previewMode
      ? Math.min(boundsSize.x, Math.max(12, framingSpanX * 1.45 + 6))
      : Math.min(boundsSize.x, Math.max(48, Math.min(180, framingSpanX * 2.5 + 12)));
    const maximumSpanZ = previewMode
      ? Math.min(boundsSize.z, Math.max(12, framingSpanZ * 1.45 + 6))
      : Math.min(boundsSize.z, Math.max(48, Math.min(180, framingSpanZ * 2.5 + 12)));
    const minimumSpanX = previewMode
      ? Math.min(maximumSpanX, Math.max(8, framingSpanX * 0.65))
      : Math.min(maximumSpanX, Math.max(24, framingSpanX * 0.65));
    const minimumSpanZ = previewMode
      ? Math.min(maximumSpanZ, Math.max(8, framingSpanZ * 0.65))
      : Math.min(maximumSpanZ, Math.max(24, framingSpanZ * 0.65));
    camera.getWorldDirection(precipitationCameraDirection);
    return precipitationFieldForView({
      cameraPosition: camera.position,
      cameraDirection: precipitationCameraDirection,
      cameraUp: camera.up,
      fovDegrees: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
      rootRotationY: rotatableWorldRoot.rotation.y,
      precipitationMinY: -2,
      precipitationMaxY,
      target: cameraTarget,
      bounds: { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z },
      minSpanX: minimumSpanX,
      minSpanZ: minimumSpanZ,
      maxSpanX: Math.max(1, maximumSpanX),
      maxSpanZ: Math.max(1, maximumSpanZ),
      edgeMargin: previewMode ? 2 : 6,
    });
  }

  function particleY(animation: PrecipitationAnimation, particle: PrecipitationParticle): number {
    const rain = animation === rainAnimation ? rainAnimation : null;
    const fall = rain
      ? animation.elapsedMs * 0.00078 * rain.speedScale
      : animation.elapsedMs * 0.00022;
    return animation.baseY + (((particle.phase - fall + 1) % 1 + 1) % 1) * animation.spanY;
  }

  function projectedParticleCount(animation: PrecipitationAnimation): number {
    let count = 0;
    const rain = animation === rainAnimation ? rainAnimation : null;
    const snow = animation === snowAnimation ? snowAnimation : null;
    const flutter = snow ? snow.elapsedMs * 0.00055 : 0;
    for (const particle of animation.particles.slice(0, animation.mesh.count)) {
      const drift = snow ? particle.phase * Math.PI * 2 + flutter : 0;
      const localX = particle.x + (snow ? Math.sin(drift) * 1.35 : 0);
      const localZ = particle.z + (snow ? Math.cos(drift * 0.72) * 0.8 : 0);
      precipitationProjectionPoint.set(localX, particleY(animation, particle), localZ)
        .applyMatrix4(rotatableWorldRoot.matrixWorld).project(camera);
      if (Math.abs(precipitationProjectionPoint.x) <= 1 && Math.abs(precipitationProjectionPoint.y) <= 1
        && precipitationProjectionPoint.z >= -1 && precipitationProjectionPoint.z <= 1) count += 1;
    }
    if (rain) rainCameraFrustumCount = count;
    if (snow) snowCameraFrustumCount = count;
    return count;
  }

  function writePrecipitationMatrices(animation: PrecipitationAnimation, isRain: boolean): void {
    const rain = isRain ? animation as RainAnimation : null;
    const snow = isRain ? null : animation as SnowAnimation;
    const matrix = new THREE.Matrix4();
    const scaleXz = rain ? rain.mesh.scale.x : 1;
    const flutter = snow ? snow.elapsedMs * 0.00055 : 0;
    animation.particles.forEach((particle, index) => {
      const position = precipitationPositionForOffset(animation.field, particle.offsetX, particle.offsetZ);
      particle.x = position.x;
      particle.z = position.z;
      const drift = snow ? particle.phase * Math.PI * 2 + flutter : 0;
      const instanceX = rain ? rainParticleInstanceCoordinate(particle.x, scaleXz) : particle.x;
      const instanceZ = rain ? rainParticleInstanceCoordinate(particle.z, scaleXz) : particle.z;
      matrix.makeTranslation(
        instanceX + (snow ? Math.sin(drift) * 1.35 : 0),
        particleY(animation, particle),
        instanceZ + (snow ? Math.cos(drift * 0.72) * 0.8 : 0),
      );
      animation.mesh.setMatrixAt(index, matrix);
    });
    animation.mesh.instanceMatrix.needsUpdate = true;
    if (rain) rainCameraFrustumCount = projectedParticleCount(rain);
    if (snow) snowCameraFrustumCount = projectedParticleCount(snow);
  }

  function syncPrecipitationField(force = false): void {
    const rain = rainAnimation;
    const snow = snowAnimation;
    if (!rain && !snow) {
      precipitationField = null;
      precipitationViewCache = emptyPrecipitationViewCache();
      rainCameraFrustumCount = 0;
      snowCameraFrustumCount = 0;
      rainStreakProjectedCssPx = 0;
      canvas.dataset.precipitationFieldMode = previewMode ? "preview" : "main-world";
      canvas.dataset.precipitationFieldCenterX = "0.00";
      canvas.dataset.precipitationFieldCenterZ = "0.00";
      canvas.dataset.precipitationFieldSpanX = "0.00";
      canvas.dataset.precipitationFieldSpanZ = "0.00";
      canvas.dataset.precipitationFieldUsedFallback = "false";
      canvas.dataset.precipitationFieldSyncCount = String(precipitationFieldSyncCount);
      canvas.dataset.rainCameraFrustumCount = "0";
      canvas.dataset.snowCameraFrustumCount = "0";
      canvas.dataset.rainStreakProjectedCssPx = "0.00";
      return;
    }
    if ((!paneVisible || document.hidden) && !force) {
      precipitationViewCache = invalidatePrecipitationViewCache(precipitationViewCache);
      return;
    }
    camera.updateMatrixWorld(true);
    rotatableWorldRoot.updateMatrixWorld(true);
    camera.getWorldDirection(precipitationCameraDirection);
    const rect = canvas.getBoundingClientRect();
    const viewDecision = updatePrecipitationViewCache(precipitationViewCache, {
      cameraDistance,
      cameraPosition: camera.position.toArray() as [number, number, number],
      cameraDirection: precipitationCameraDirection.toArray() as [number, number, number],
      cameraUp: camera.up.toArray() as [number, number, number],
      fovDegrees: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
      rootRotationY: rotatableWorldRoot.rotation.y,
      rootTransform: rotatableWorldRoot.matrixWorld.elements,
      viewportWidthCss: rect.width,
      viewportHeightCss: rect.height,
      rainBaseCrossSection: rain?.baseCrossSection ?? 0,
      targetProjectedCssPx: 1.2,
      maximumCrossSectionScale: 3,
    });
    precipitationViewCache = viewDecision.cache;
    const maxY = Math.max(rain ? rain.baseY + rain.spanY : -2, snow ? snow.baseY + snow.spanY : -2);
    const next = precipitationFieldForCamera(maxY);
    const current = precipitationField;
    const unchanged = current !== null && Math.abs(current.centerX - next.centerX) < 0.75
      && Math.abs(current.centerZ - next.centerZ) < 0.75
      && Math.abs(current.spanX - next.spanX) < 1
      && Math.abs(current.spanZ - next.spanZ) < 1
      && current.usedFallback === next.usedFallback;
    const fieldChanged = force || !unchanged;
    if (!force && !fieldChanged && !viewDecision.changed) return;
    if (fieldChanged) precipitationField = next;
    const activeField = fieldChanged ? next : current!;
    precipitationFieldSyncCount += 1;
    const cssHeight = Math.max(1, rect.height);
    if (rain) {
      let rewriteRainMatrices = fieldChanged;
      if (force || viewDecision.crossSectionChanged) {
        const previousScale = rain.mesh.scale.x;
        const crossSection = rainCrossSectionScaleForView({
          baseCrossSection: rain.baseCrossSection,
          cameraDistance: Math.max(camera.near, cameraDistance),
          fovDegrees: camera.fov,
          viewportHeightCss: cssHeight,
          targetProjectedCssPx: 1.2,
          maximumScale: 3,
        });
        rain.mesh.scale.set(crossSection.scale, 1, crossSection.scale);
        rain.mesh.updateMatrix();
        rewriteRainMatrices = rainParticleMatricesNeedRewrite(fieldChanged, previousScale, crossSection.scale);
        rain.projectedCssPx = crossSection.projectedCssPx;
        rainStreakProjectedCssPx = rain.projectedCssPx;
      }
      rain.field = activeField;
      if (rewriteRainMatrices) writePrecipitationMatrices(rain, true);
      else if (viewDecision.projectionChanged) rainCameraFrustumCount = projectedParticleCount(rain);
    }
    if (snow) {
      snow.field = activeField;
      if (fieldChanged) writePrecipitationMatrices(snow, false);
      else if (viewDecision.projectionChanged) snowCameraFrustumCount = projectedParticleCount(snow);
    }
    canvas.dataset.precipitationFieldMode = previewMode ? "preview" : "main-world";
    canvas.dataset.precipitationFieldCenterX = activeField.centerX.toFixed(2);
    canvas.dataset.precipitationFieldCenterZ = activeField.centerZ.toFixed(2);
    canvas.dataset.precipitationFieldSpanX = activeField.spanX.toFixed(2);
    canvas.dataset.precipitationFieldSpanZ = activeField.spanZ.toFixed(2);
    canvas.dataset.precipitationFieldUsedFallback = String(activeField.usedFallback);
    canvas.dataset.precipitationFieldSyncCount = String(precipitationFieldSyncCount);
    canvas.dataset.rainStreakProjectedCssPx = rainStreakProjectedCssPx.toFixed(2);
    canvas.dataset.rainCameraFrustumCount = String(rainCameraFrustumCount);
    canvas.dataset.snowCameraFrustumCount = String(snowCameraFrustumCount);
    canvas.dataset.rainElapsedMs = String(Math.round(rain?.elapsedMs ?? 0));
    canvas.dataset.snowElapsedMs = String(Math.round(snow?.elapsedMs ?? 0));
    canvas.dataset.precipitationMotionPaused = String(!paneVisible || interacting || reducedMotion || document.hidden);
  }

  function syncPrecipitationMotionGate(nowMs: number): void {
    const shouldPause = !paneVisible || interacting || reducedMotion || document.hidden;
    let resumed = false;
    for (const animation of [rainAnimation, snowAnimation]) {
      if (!animation) continue;
      if (shouldPause) {
        animation.paused = true;
        animation.lastUpdateMs = nowMs;
      } else if (animation.paused) {
        animation.paused = false;
        animation.lastUpdateMs = nowMs;
        resumed = true;
      }
    }
    if (resumed) requestRender();
    canvas.dataset.precipitationMotionPaused = String(shouldPause);
    canvas.dataset.rainElapsedMs = String(Math.round(rainAnimation?.elapsedMs ?? 0));
    canvas.dataset.snowElapsedMs = String(Math.round(snowAnimation?.elapsedMs ?? 0));
  }

  function updateWeather(localDate: string, force = false): void {
    // Clouds and rain cover the full visible terrain, not just the settlement core:
    // V16 expanded the world far beyond contentBounds and the sky must follow it.
    const contentSize = contentBounds.getSize(new THREE.Vector3());
    const visibleSize = visibilityBounds.getSize(new THREE.Vector3());
    const cloudBaseBeforeWeather = previewMode
      ? Math.max(12, contentBounds.max.y + 8)
      : Math.max(20, visibilityBounds.max.y + 9);
    const projectedDate = environmentDebugOverride?.date == null
      ? localDate
      : localDateForDate(new Date(environmentDebugOverride.date));
    // A debug payload often carries weather:null while only pinning time or
    // decay. Null means "no debug weather override", not "erase live weather".
    const activeWeatherOverride = effectiveWeatherOverride(environmentDebugOverride?.weather, externalWeatherOverride);
    const nextWeather = activeWeatherOverride === null
      ? weatherForLocalDate(projectedDate, options.environmentStyle === "ocean-island")
      : weatherForExternalOverride(projectedDate, activeWeatherOverride);
    const weatherChanged = currentWeather.kind !== nextWeather.kind
      || currentWeather.thunderstorm !== nextWeather.thunderstorm
      || currentWeather.visualPrecipitationIntensity !== nextWeather.visualPrecipitationIntensity
      || currentWeather.cloudIntensity !== nextWeather.cloudIntensity;
    const nextCloudBudget = cloudBudgetForView({
      previewMode,
      weatherCloudCount: nextWeather.cloudCount,
      weatherDensity: QUALITY_PROFILES.high.weatherDensity,
      weatherKind: nextWeather.kind,
      contentWidth: contentSize.x,
      contentDepth: contentSize.z,
      visibleWidth: visibleSize.x,
      visibleDepth: visibleSize.z,
    });
    // Rebuild when the terrain envelope changed (environment style switch resizes
    // the whole visible world), not only when the date rolls over.
    if (!force && !weatherChanged && currentWeather.localDate === projectedDate
      && cloudsBuiltBaseY === cloudBaseBeforeWeather
      && cloudsBuiltSpanX === nextCloudBudget.spanX
      && cloudsBuiltSpanZ === nextCloudBudget.spanZ
      && cloudBudgetMode === (nextCloudBudget.previewMode ? "preview" : "main-world")
      && cloudBlockScale === nextCloudBudget.blockScale) return;
    clearLightning();
    currentWeather = nextWeather;
    stormRandom = seededRandom(nextWeather.seed ^ 0x51e7b017);
    nextLightningAtMs = nextWeather.thunderstorm && !previewMode
      ? performance.now() + 1_600 + stormRandom() * 1_600
      : Number.POSITIVE_INFINITY;
    const sunlightScale = sunlightScaleForWeather(currentWeather);
    sun.intensity = currentLighting.intensity * currentLighting.sunVisibility * sunlightScale;
    hemisphere.intensity = currentLighting.hemisphereIntensity * ambientScaleForWeather(currentWeather, currentLighting.nightFactor);
    const cloudBudget = nextCloudBudget;
    const spanX = cloudBudget.spanX;
    const spanZ = cloudBudget.spanZ;
    const cloudBase = cloudBaseBeforeWeather;
    // Restore any reveal-owned clones before destroying the meshes/materials
    // they temporarily replaced. Otherwise those clones are disposed by the
    // clear and again by finishEnvironmentReveal, while the originals leak.
    if (environmentReveal) finishEnvironmentReveal(true);
    clearGroup(atmosphereGroup, true);
    cloudMaterial = null;
    rainAnimation = null;
    snowAnimation = null;
    cloudDrift = null;
    cloudBlockCount = 0;
    const random = seededRandom(currentWeather.seed);
    canvas.dataset.cloudSpanX = String(Math.round(spanX));
    canvas.dataset.cloudSpanZ = String(Math.round(spanZ));
    cloudBudgetMode = cloudBudget.previewMode ? "preview" : "main-world";
    cloudBlockScale = cloudBudget.blockScale;
    const cloudCount = cloudBudget.cloudCount;
    // Typed clouds keep the researched shapes (cirrus wisps high up, puffy cumulus,
    // flat stratus bands, tall storm towers) but render as crisp stacked blocks like
    // the original voxel clouds, spread across the whole visible sky. A few distant
    // giants hug the far horizon so the sky reads deep instead of narrow.
    const cloudKinds: Array<"cirrus" | "cumulus" | "stratus" | "storm"> = [];
    const cloudBlocks: number[] = [];
    const raining = currentWeather.kind === "rain";
    const instanceCap = cloudBudget.maxInstances;
    const distantCount = cloudBudget.cloudCount === 0 || previewMode
      ? 0
      : raining ? 2 : Math.min(5, 2 + Math.round(QUALITY_PROFILES.high.weatherDensity * 2));
    const distantBudget = distantCount * 16;
    let totalInstances = 0;
    for (let cloudIndex = 0; cloudIndex < cloudCount; cloudIndex += 1) {
      const roll = random();
      const kind = currentWeather.thunderstorm
        ? roll < 0.94 ? "storm" : "stratus"
        : raining ? roll < 0.68 ? "storm" : roll < 0.88 ? "cumulus" : "stratus"
          : currentWeather.kind === "mist" ? roll < 0.88 ? "stratus" : "cirrus"
            : currentWeather.kind === "snow" ? roll < 0.7 ? "stratus" : "cumulus"
              : currentWeather.kind === "cloudy" ? roll < 0.55 ? "stratus" : roll < 0.8 ? "cumulus" : "cirrus"
                : roll < 0.48 ? "cirrus" : "cumulus";
      const blocks = kind === "cirrus" ? 3 + Math.floor(random() * 3) : kind === "stratus" ? 4 + Math.floor(random() * 4) : 4 + Math.floor(random() * 4);
      if (totalInstances + blocks > instanceCap - distantBudget) break;
      cloudKinds.push(kind as "cirrus" | "cumulus" | "stratus" | "storm");
      cloudBlocks.push(blocks);
      totalInstances += blocks;
    }
    const distantBlocks: number[] = [];
    for (let distant = 0; distant < distantCount; distant += 1) {
      const blocks = 12 + Math.floor(random() * 8);
      if (totalInstances + blocks > instanceCap) break;
      distantBlocks.push(blocks);
      totalInstances += blocks;
    }
    cloudBlockCount = totalInstances;
    const matrix = new THREE.Matrix4();
    if (totalInstances > 0) {
    const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
    cloudMaterial = new THREE.MeshLambertMaterial({
      color: currentLighting.cloudColor,
      fog: currentWeather.kind === "mist",
    });
    const clouds = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, totalInstances);
    const quaternion = new THREE.Quaternion();
    // V20 WX-02: every cloud remembers its block positions and its own drift
    // rhythm so the ambient pump can move each one along a slow sine path.
    const driftClouds: Array<{ first: number; count: number; speed: number; angle: number }> = [];
    const cloudBasePositions = new Float32Array(totalInstances * 3);
    // The camera always looks down at the settlement, so clouds live just above
    // the terrain silhouette: near ones float in the middle of the frame and far
    // ones ride the fogged horizon. Fog is off on the material so even the far
    // clouds stay crisp white against the hazy sky instead of dissolving into it.
    let instanceIndex = 0;
    const placeBlocks = (kind: "cirrus" | "cumulus" | "stratus" | "storm" | "distant", blocks: number, radius: number): void => {
      const angle = random() * Math.PI * 2;
      const altitudeOffset = previewMode
        ? kind === "cirrus" ? 1.5 + random() * 2 : kind === "stratus" ? -0.5 + random() * 0.5 : 0
        : kind === "cirrus" ? 5 + random() * 6 : kind === "stratus" ? -2 + random() * 2 : kind === "distant" ? -1 + random() * 2 : 0;
      const center = new THREE.Vector3(
        Math.cos(angle) * spanX * radius,
        cloudBase + altitudeOffset + random() * 1.5,
        Math.sin(angle) * spanZ * radius,
      );
      const spanLocal = (kind === "distant" ? 7 : kind === "cirrus" ? 5 : kind === "stratus" ? 6 : 4.6)
        * (previewMode ? cloudBudget.blockScale : 1);
      const layers = kind === "distant" ? 4 + Math.floor(random() * 3) : kind === "storm" ? 3 + Math.floor(random() * 2) : kind === "cirrus" ? 1 : 2;
      const first = instanceIndex;
      for (let block = 0; block < blocks; block += 1) {
        const gx = (random() * 2 - 1) * spanLocal * (kind === "stratus" ? 0.95 : 0.75);
        const gz = (random() * 2 - 1) * spanLocal * 0.62;
        const layer = Math.floor(random() * layers);
        const gy = layer * (previewMode ? 0.35 : 1.0) + random() * 0.3;
        const blockSize = ((kind === "distant" ? 3.8 : 2.3) + random() * (kind === "distant" ? 2.2 : 1.7)) * cloudBudget.blockScale;
        matrix.compose(
          new THREE.Vector3(center.x + gx, center.y + gy, center.z + gz),
          quaternion,
          new THREE.Vector3(blockSize, blockSize * (0.72 + random() * 0.3), blockSize * (0.85 + random() * 0.3)),
        );
        clouds.setMatrixAt(instanceIndex, matrix);
        cloudBasePositions[instanceIndex * 3] = center.x + gx;
        cloudBasePositions[instanceIndex * 3 + 1] = center.y + gy;
        cloudBasePositions[instanceIndex * 3 + 2] = center.z + gz;
        instanceIndex += 1;
      }
      if (instanceIndex > first) {
        driftClouds.push({
          first,
          count: instanceIndex - first,
          speed: cloudAdvectionSpeed(currentWeather) * (previewMode ? 0.25 : 1)
            * (kind === "distant" ? 0.62 : 0.8 + random() * 0.5),
          angle: Math.PI / 5 + (random() - 0.5) * 0.44,
        });
      }
    };
    cloudKinds.forEach((kind, cloudIndex) => {
      // Start right above the settlement so the short non-focus world window
      // sees clouds too, and spread all the way to the far horizon. Small worlds
      // (classic island) bias the spread inward so most clouds stay over the land.
      const spreadBias = previewMode ? 2.4 : spanX > 400 ? 0.85 : 1.6;
      const radius = previewMode
        ? 0.03 + 0.38 * Math.pow(random(), spreadBias)
        : 0.03 + 0.95 * Math.pow(random(), spreadBias);
      placeBlocks(kind, cloudBlocks[cloudIndex]!, radius);
    });
    for (const blocks of distantBlocks) placeBlocks("distant", blocks, 0.72 + random() * 0.26);
    clouds.instanceMatrix.needsUpdate = true;
    clouds.userData.ownedMaterial = cloudMaterial;
    atmosphereGroup.add(clouds);
    cloudDrift = { mesh: clouds, clouds: driftClouds, basePositions: cloudBasePositions,
      spanX, spanZ, elapsedMs: 0, lastUpdateMs: performance.now() };
    }
    const precipitationAreaMultiplier = previewMode
      ? Math.max(1, cloudBudget.cloudCount / 3)
      : Math.min(24, Math.max(1, (visibleSize.x * visibleSize.z) / Math.max(1, contentSize.x * contentSize.z)));
    const rainCount = precipitationParticleCount(currentWeather.rainDropCount, QUALITY_PROFILES.high.weatherDensity,
      precipitationAreaMultiplier, previewMode ? 80 : 600, previewMode ? 3 : 6);
    if (rainCount > 0) {
      const visualIntensity = Math.min(1, Math.max(0, currentWeather.visualPrecipitationIntensity));
      const baseCrossSection = 0.022 + visualIntensity * 0.013;
      const rainMaterial = new THREE.MeshBasicMaterial({ color: currentWeather.thunderstorm ? 0xd5e6f1 : 0xb8d6df,
        transparent: true, opacity: 0.42 + visualIntensity * 0.35, depthWrite: false, fog: false });
      // Narrow tapered streaks read as moving water at the elevated, oblique
      // world camera; the former square prisms looked like stepping pixels.
      const rain = new THREE.InstancedMesh(new THREE.CylinderGeometry(
        baseCrossSection * 0.32, baseCrossSection, 1.02 + visualIntensity * 0.96, 4, 1,
      ), rainMaterial, rainCount);
      rain.frustumCulled = false;
      const drops = Array.from({ length: rainCount }, () => ({ x: 0, z: 0, offsetX: random() - 0.5, offsetZ: random() - 0.5, phase: random() }));
      const rainSpanY = cloudBase + 8;
      for (let index = 0; index < drops.length; index += 1) {
        const drop = drops[index]!;
        matrix.makeTranslation(0, -2 + drop.phase * rainSpanY, 0);
        rain.setMatrixAt(index, matrix);
      }
      rain.instanceMatrix.needsUpdate = true;
      rain.userData.ownedMaterial = rainMaterial;
      atmosphereGroup.add(rain);
      // Rain falls from the storm base all the way to the ground so it stays
      // visually connected to the clouds above the camera.
      rainAnimation = { mesh: rain, particles: drops, baseY: -2, spanY: rainSpanY,
        field: precipitationFieldForCamera(rainSpanY), speedScale: 0.72 + visualIntensity * 0.58,
        elapsedMs: 0, lastUpdateMs: performance.now(), paused: !paneVisible || interacting || reducedMotion || document.hidden,
        baseCrossSection, projectedCssPx: 0 };
      canvas.dataset.rainPhaseMs = "0";
    }
    const snowCount = precipitationParticleCount(currentWeather.snowFlakeCount, QUALITY_PROFILES.high.weatherDensity,
      precipitationAreaMultiplier, previewMode ? 80 : 800, previewMode ? 4 : 8);
    if (snowCount > 0) {
      const snowMaterial = new THREE.MeshBasicMaterial({ color: 0xe6f0f5, transparent: true, opacity: 0.86, depthWrite: false });
      const snow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 5, 4), snowMaterial, snowCount);
      snow.frustumCulled = false;
      const flakes = Array.from({ length: snowCount }, () => ({ x: 0, z: 0, offsetX: random() - 0.5, offsetZ: random() - 0.5, phase: random() }));
      const snowSpanY = cloudBase + 8;
      for (let index = 0; index < flakes.length; index += 1) {
        const flake = flakes[index]!;
        matrix.makeTranslation(0, -2 + flake.phase * snowSpanY, 0);
        snow.setMatrixAt(index, matrix);
      }
      snow.instanceMatrix.needsUpdate = true;
      snow.userData.ownedMaterial = snowMaterial;
      atmosphereGroup.add(snow);
      snowAnimation = { mesh: snow, particles: flakes, baseY: -2, spanY: snowSpanY,
        field: precipitationFieldForCamera(snowSpanY), elapsedMs: 0, lastUpdateMs: performance.now(),
        paused: !paneVisible || interacting || reducedMotion || document.hidden };
      canvas.dataset.snowPhaseMs = "0";
    }
    syncPrecipitationField(true);
    applyAtmosphere();
    syncQualityVisibility();
    cacheStaticTransformTree(atmosphereGroup);
    if (weatherChanged) startEnvironmentReveal([atmosphereGroup], "weather");
    cloudsBuiltSpanX = spanX;
    cloudsBuiltSpanZ = spanZ;
    cloudsBuiltBaseY = cloudBase;
    requestRender();
  }

  function worldsWithDebugDecay(worlds: readonly WorldSnapshot[]): readonly WorldSnapshot[] {
    const decay = environmentDebugOverride?.decayAmount;
    if (decay == null || !Number.isFinite(decay)) return worlds;
    const condition = Math.round((1 - THREE.MathUtils.clamp(decay, 0, 1)) * 10_000);
    return worlds.map(world => ({ ...world, buildingConditionBasisPoints: condition }));
  }

  function updateRainAnimation(nowMs: number): void {
    const rain = rainAnimation;
    if (!rain) return;
    const step = stepPrecipitationClock(rain, nowMs, !paneVisible || interacting || reducedMotion || document.hidden, 30);
    rain.elapsedMs = step.elapsedMs;
    rain.lastUpdateMs = step.lastUpdateMs;
    rain.paused = step.paused;
    if (step.resumed) {
      canvas.dataset.precipitationMotionPaused = "false";
      requestRender();
      return;
    }
    if (!step.advanced) return;
    writePrecipitationMatrices(rain, true);
    canvas.dataset.rainPhaseMs = String(Math.round(rain.elapsedMs));
    canvas.dataset.rainElapsedMs = String(Math.round(rain.elapsedMs));
    canvas.dataset.rainCameraFrustumCount = String(rainCameraFrustumCount);
    requestRender();
  }

  function updateSnowAnimation(nowMs: number): void {
    const snow = snowAnimation;
    if (!snow) return;
    const step = stepPrecipitationClock(snow, nowMs, !paneVisible || interacting || reducedMotion || document.hidden, 30);
    snow.elapsedMs = step.elapsedMs;
    snow.lastUpdateMs = step.lastUpdateMs;
    snow.paused = step.paused;
    if (step.resumed) {
      canvas.dataset.precipitationMotionPaused = "false";
      requestRender();
      return;
    }
    if (!step.advanced) return;
    writePrecipitationMatrices(snow, false);
    canvas.dataset.snowPhaseMs = String(Math.round(snow.elapsedMs));
    canvas.dataset.snowElapsedMs = String(Math.round(snow.elapsedMs));
    canvas.dataset.snowCameraFrustumCount = String(snowCameraFrustumCount);
    requestRender();
  }

  function clearLightning(): void {
    stormFlash.intensity = 0;
    if (lightningBolt) {
      atmosphereGroup.remove(lightningBolt);
      clearGroup(lightningBolt, true);
      lightningBolt = null;
    }
    lightningStartedAtMs = Number.NEGATIVE_INFINITY;
  }

  function updateStormLightning(nowMs: number): void {
    if (!currentWeather.thunderstorm || previewMode || reducedMotion || !paneVisible || document.hidden) {
      if (lightningBolt) { clearLightning(); requestRender(); }
      return;
    }
    if (nowMs >= nextLightningAtMs) {
      clearLightning();
      const center = contentBounds.getCenter(new THREE.Vector3());
      const width = Math.max(8, Math.min(20, contentBounds.max.x - contentBounds.min.x));
      const depth = Math.max(8, Math.min(20, contentBounds.max.z - contentBounds.min.z));
      const targetX = center.x + (stormRandom() - 0.5) * width;
      const targetZ = center.z + (stormRandom() - 0.5) * depth;
      const topY = Math.max(24, cloudsBuiltBaseY + 3);
      const bottomY = Math.max(0, center.y - 1);
      const vertices: THREE.Vector3[] = [];
      for (let index = 0; index <= 8; index += 1) {
        const fraction = index / 8;
        const wander = (1 - fraction) * 2.8;
        vertices.push(new THREE.Vector3(
          targetX + (stormRandom() - 0.5) * wander,
          topY + (bottomY - topY) * fraction,
          targetZ + (stormRandom() - 0.5) * wander,
        ));
      }
      const bolt = new THREE.Group();
      for (let index = 1; index < vertices.length; index += 1) {
        const from = vertices[index - 1]!;
        const to = vertices[index]!;
        const delta = to.clone().sub(from);
        const material = new THREE.MeshBasicMaterial({ color: 0xf2f7ff, transparent: true,
          opacity: 0.96, depthWrite: false, fog: false, toneMapped: false });
        const segment = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.11, delta.length(), 5), material);
        segment.position.copy(from).add(to).multiplyScalar(0.5);
        segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
        segment.renderOrder = 6;
        bolt.add(segment);
      }
      atmosphereGroup.add(bolt);
      lightningBolt = bolt;
      lightningStartedAtMs = nowMs;
      nextLightningAtMs = nowMs + 15_000 + stormRandom() * 16_000;
      lightningStrikeCount += 1;
      stormFlash.position.set(targetX, bottomY + 6, targetZ);
      canvas.dataset.lightningStrikeCount = String(lightningStrikeCount);
      requestRender();
    }
    if (!lightningBolt) return;
    const age = nowMs - lightningStartedAtMs;
    if (age > 1_450) {
      clearLightning();
      requestRender();
      return;
    }
    const core = age < 180 ? 1 : 0;
    const afterglow = Math.max(0, 1 - age / 1_450);
    for (const child of lightningBolt.children) {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        child.material.opacity = 0.12 + core * 0.84 + (1 - core) * afterglow * 0.28;
      }
    }
    stormFlash.intensity = core * 2.3 + afterglow * 0.28;
    requestRender();
  }

  // V20 CT-01: the amended render contract. The world may animate while its pane
  // is visible and the tab is foreground, but never under reduced motion and never
  // on the performance lighting tier (battery-first). The pump below drives it:
  // one throttled interval, not a continuous rAF loop, so `continuousRendering`
  // stays false and a hidden pane stops all motion on the next tick.
  function ambientMotionAllowed(): boolean {
    return paneVisible && !document.hidden && !reducedMotion && qualityTier !== "low"
      && !options.debugFlatColors && !options.debugVoidScan;
  }

  function updateCloudDrift(nowMs: number): void {
    const drift = cloudDrift;
    if (!drift || !paneVisible || document.hidden || reducedMotion || interacting
      || options.debugFlatColors || options.debugVoidScan || nowMs - drift.lastUpdateMs < 100) return;
    drift.elapsedMs += nowMs - drift.lastUpdateMs;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const cloud of drift.clouds) {
      const offsetX = Math.cos(cloud.angle) * cloud.speed * drift.elapsedMs / 1000;
      const offsetZ = Math.sin(cloud.angle) * cloud.speed * drift.elapsedMs / 1000;
      const centerX = drift.basePositions[cloud.first * 3]!;
      const centerZ = drift.basePositions[cloud.first * 3 + 2]!;
      const wrappedCenterX = wrapCloudCoordinate(centerX + offsetX, drift.spanX);
      const wrappedCenterZ = wrapCloudCoordinate(centerZ + offsetZ, drift.spanZ);
      for (let block = 0; block < cloud.count; block += 1) {
        const instance = cloud.first + block;
        drift.mesh.getMatrixAt(instance, matrix);
        matrix.decompose(position, quaternion, scale);
        position.set(
          wrappedCenterX + drift.basePositions[instance * 3]! - centerX,
          drift.basePositions[instance * 3 + 1]!,
          wrappedCenterZ + drift.basePositions[instance * 3 + 2]! - centerZ,
        );
        matrix.compose(position, quaternion, scale);
        drift.mesh.setMatrixAt(instance, matrix);
      }
    }
    drift.mesh.instanceMatrix.needsUpdate = true;
    if (drift.mesh.count > 0) {
      drift.mesh.getMatrixAt(0, matrix);
      position.setFromMatrixPosition(matrix);
      canvas.dataset.cloudFirstBlockPosition = `${position.x.toFixed(4)},${position.z.toFixed(4)}`;
    }
    drift.lastUpdateMs = nowMs;
    canvas.dataset.cloudDriftMs = String(Math.round(drift.elapsedMs));
    requestAmbientRender(nowMs);
  }

  function updateTreeSway(nowMs: number): void {
    const sway = naturalTreeSway;
    if (!sway || !ambientMotionAllowed() || interacting || nowMs - sway.lastUpdateMs < 100) return;
    sway.elapsedMs += nowMs - sway.lastUpdateMs;
    const visible = Math.min(sway.trees.length, sway.trunks.count);
    const axis = new THREE.Vector3();
    const quaternionSway = new THREE.Quaternion();
    const rotation = new THREE.Matrix4();
    const pivotTo = new THREE.Matrix4();
    const pivotBack = new THREE.Matrix4();
    const place = new THREE.Matrix4();
    const size = new THREE.Matrix4();
    const composed = new THREE.Matrix4();
    for (let index = 0; index < visible; index += 1) {
      const tree = sway.trees[index];
      if (!tree) break;
      const angle = tree.amp * Math.sin((sway.elapsedMs / tree.periodMs) * Math.PI * 2 + tree.phase * Math.PI * 2);
      axis.set(Math.cos(tree.axisAngle), 0, Math.sin(tree.axisAngle));
      quaternionSway.setFromAxisAngle(axis, angle);
      rotation.makeRotationFromQuaternion(quaternionSway);
      pivotTo.makeTranslation(tree.pivotX, tree.pivotY, tree.pivotZ);
      pivotBack.makeTranslation(-tree.pivotX, -tree.pivotY, -tree.pivotZ);
      place.makeTranslation(tree.pivotX, tree.trunkY, tree.pivotZ);
      size.makeScale(tree.scale, tree.scale, tree.scale);
      composed.multiplyMatrices(pivotTo, rotation).multiply(pivotBack).multiply(place).multiply(size);
      sway.trunks.setMatrixAt(index, composed);
      place.makeTranslation(tree.pivotX, tree.crownY, tree.pivotZ);
      composed.multiplyMatrices(pivotTo, rotation).multiply(pivotBack).multiply(place).multiply(size);
      sway.crowns.setMatrixAt(index, composed);
    }
    sway.trunks.instanceMatrix.needsUpdate = true;
    sway.crowns.instanceMatrix.needsUpdate = true;
    syncNaturalTreeAttachments();
    sway.lastUpdateMs = nowMs;
    requestAmbientRender(nowMs);
  }

  function updateConstructionReveals(nowMs: number): void {
    if (disposed) return;
    if (constructionReveals.length === 0) {
      // Keep the diagnostic dataset present even when no reveal is running so
      // automated probes can assert the zero state deterministically.
      canvas.dataset.constructionRevealCount = "0";
      return;
    }
    if (!paneVisible || document.hidden) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let remaining = 0;
    for (const reveal of constructionReveals) {
      if (reveal.done) continue;
      const elapsed = nowMs - reveal.popAtMs;
      if (elapsed <= 0) {
        remaining += 1;
        continue;
      }
      const progress = Math.min(1, elapsed / 240);
      const size = constructionRevealScale(progress, reveal.targetScale);
      reveal.mesh.getMatrixAt(reveal.index, matrix);
      matrix.decompose(position, quaternion, scale);
      scale.setScalar(size);
      matrix.compose(position, quaternion, scale);
      reveal.mesh.setMatrixAt(reveal.index, matrix);
      reveal.mesh.instanceMatrix.needsUpdate = true;
      if (progress < 1) remaining += 1;
      else reveal.done = true;
    }
    canvas.dataset.constructionRevealCount = String(remaining);
    if (remaining === 0) constructionReveals = [];
    else requestRender();
  }

  function releaseStaleInteraction(nowMs: number): void {
    if (interacting && pointerOwnership.releaseIfStale(nowMs)) {
      // A pointer that produced no movement for the stale window was left
      // behind by a system gesture; release it so the ambient drift resumes.
      previousPinchDistance = null;
      previousPinchCenterY = null;
      interacting = false;
      updateDiagnosticsDataset();
      requestRender();
    }
  }

  function syncQualityVisibility(): void {
    for (const [mesh, data] of fallbackOcclusionMeshes) applyFallbackOcclusion(mesh, data.voxels, data.field, qualityTier);
    for (const [index, entry] of localLights.entries()) entry.light.visible = index < qualityProfile.maxLocalLights;
    for (const [index, entry] of glowSprites.entries()) entry.sprite.visible = index < qualityProfile.maxGlowSprites
      && glowMaterial.opacity > 0.015;
    updateNaturalTreeDensity();
    for (const animation of [rainAnimation, snowAnimation]) {
      if (!animation) continue;
      animation.mesh.count = Math.min(animation.mesh.instanceMatrix.count,
        Math.max(0, Math.floor(animation.particles.length * qualityProfile.weatherDensity)));
    }
    if (cloudDrift) cloudDrift.mesh.count = Math.min(cloudDrift.mesh.instanceMatrix.count,
      Math.max(0, Math.floor(cloudDrift.mesh.instanceMatrix.count * qualityProfile.weatherDensity)));
    starGeometry.setDrawRange(0, qualityProfile.starCount);
  }

  function setGlowMaterialsOpacity(opacity: number): void {
    for (const spriteMaterial of glowMaterials.values()) spriteMaterial.opacity = opacity;
  }

  function addOriginalStaticShapeMeshes(
    root: THREE.Group,
    voxels: readonly BlueprintV1["voxels"][number][],
    occlusionField: LocalOcclusionField,
    weathering: number,
    revealOrderIndex: ReadonlyMap<BlueprintV1["voxels"][number], number> | null,
    revealSchedule: ReturnType<typeof constructionWaveSchedule> | null,
  ): Set<BlueprintV1["voxels"][number]> {
    const handled = new Set<BlueprintV1["voxels"][number]>();
    if (voxels.length === 0) return handled;
    const plan = planOriginalStaticShapeBatches(voxels);
    const grouped = groupOriginalStaticShapeEntries(
      plan,
      (voxel, componentKey = "") => fallbackVisualStyleForOriginalComponent(voxel, componentKey).key,
      64,
      (voxel, componentKey) => {
        if (componentKey === "lantern-frame" || componentKey === "candle-wax") return { kind: "", level: 0 };
        if (componentKey.startsWith("lantern-core-") && voxel.emissiveLevel === 0) return { kind: "", level: 0 };
        if (componentKey === "candle-wick" && voxel.emissiveLevel === 0) return { kind: "", level: 0 };
        const emission = sourceLanternEmissionForVoxel(voxel) ?? sourceCandleEmissionForVoxel(voxel);
        if ((componentKey.startsWith("lantern-core-") || componentKey === "candle-wick") && emission) return emission;
        return undefined;
      },
    );
    originalStaticShapeTopologyCount += plan.budget.actual;
    originalStaticShapeTopologyOverflow += plan.budget.overflow;
    originalStaticShapeMaterialGroupCount += grouped.groups.length;
    originalStaticShapeMaterialGroupOverflow += grouped.overflow;
    originalStaticShapeBudgetFallbackVoxelCount += new Set(grouped.fallbackEntries.map(({ voxel }) => voxel)).size;
    for (const group of grouped.groups) {
      const { topologyKey, componentKey, component, materialKey: materialId, emissiveKind, emissiveLevel: level, entries } = group;
      const weathered = weathering > 0;
      const emissiveActive = level > 0;
      if (emissiveActive) originalStaticShapeEmissiveMaterialGroupCount += 1;
      const owned = weathered || emissiveActive;
      const meshMaterial = owned ? material(materialId).clone() : material(materialId);
      const translucent = materialId === "glass" || parseFallbackVisualKey(materialId)?.transparent === true;
      trackMaterialEffects(meshMaterial, translucent ? 0.22 : 0.12);
      if (weathered) {
        meshMaterial.color.multiplyScalar(1 - weathering * 0.28);
        meshMaterial.roughness = Math.min(1, meshMaterial.roughness + weathering * 0.1);
      }
      if (emissiveActive) {
        emissiveMaterials.push({ material: meshMaterial, level: level > 0 ? level : 15, kind: emissiveKind || "light" });
      }
      const first = entries[0];
      if (!first || first.shape.kind !== "original-approximation") {
        if (owned) meshMaterial.dispose();
        continue;
      }
      const mesh = new THREE.InstancedMesh(createOriginalStaticShapeComponentGeometry(component), meshMaterial, entries.length);
      const matrix = new THREE.Matrix4();
      const hiddenMatrix = new THREE.Matrix4();
      entries.forEach((entry, index) => {
        handled.add(entry.voxel);
        const entryComponent = entry.shape.kind === "original-approximation"
          ? entry.shape.components?.find((candidate) => candidate.key === componentKey && candidate.topologyKey === topologyKey)
          : undefined;
        const componentTransform = new THREE.Matrix4().fromArray([...(entryComponent?.transform ?? component.transform)]);
        const orderIndex = revealOrderIndex?.get(entry.voxel);
        if (orderIndex !== undefined && revealSchedule) {
          hiddenMatrix.makeTranslation(entry.voxel.x, entry.voxel.y, entry.voxel.z)
            .multiply(componentTransform)
            .scale(new THREE.Vector3(0.0001, 0.0001, 0.0001));
          mesh.setMatrixAt(index, hiddenMatrix);
          constructionReveals.push({
            mesh,
            index,
            popAtMs: revealSchedule.popAtMsFor(constructionRevealStartedMs, orderIndex),
            targetScale: 1,
            done: false,
          });
        } else {
          matrix.makeTranslation(entry.voxel.x, entry.voxel.y, entry.voxel.z).multiply(componentTransform);
          mesh.setMatrixAt(index, matrix);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      applyFallbackOcclusion(mesh, entries.map((entry) => entry.voxel), occlusionField);
      mesh.castShadow = !translucent;
      mesh.receiveShadow = true;
      if (translucent) mesh.renderOrder = 10;
      if (owned) mesh.userData.ownedMaterial = meshMaterial;
      mesh.userData.originalStaticTopology = topologyKey;
      root.add(mesh);
      originalStaticShapeBatchCount += 1;
    }
    originalStaticShapeVoxelCount += handled.size;
    // The planner caps topology batches at 64; over-budget and invalid entries
    // remain untouched so the caller routes them through the established cube path.
    return handled;
  }

  function updateAmbientMotion(nowMs: number): void {
    if (disposed) return;
    releaseStaleInteraction(nowMs);
    if (lightingTransition && paneVisible && !document.hidden && !reducedMotion) updateLighting(new Date());
    updateRainAnimation(nowMs);
    updateSnowAnimation(nowMs);
    updateStormLightning(nowMs);
    updateCloudDrift(nowMs);
    updateTreeSway(nowMs);
    updateConstructionReveals(nowMs);
    canvas.dataset.ambientMotionActive = String(ambientMotionAllowed());
  }

  function applyAtmosphere(): void {
    if (options.debugFlatColors || options.debugVoidScan) {
      // Diagnostics: pure-black background, no sky/clouds/fog, so any dark pixel
      // inside the terrain silhouette is a real hole, never an AA blend that
      // happens to match the sampled sky color, and never a fog-faded face.
      renderer.setClearColor(0x000000, 1);
      scene.fog = null;
      skyGroup.visible = false;
      atmosphereGroup.visible = false;
      sunSprite.visible = false;
      moonSprite.visible = false;
      return;
    }
    const weatherVisual = weatherVisualForWeather(currentWeather);
    const weatherTint = weatherVisual.tint;
    const sky = new THREE.Color(currentLighting.skyColor);
    const fog = new THREE.Color(currentLighting.fogColor);
    if (weatherTint !== null) {
      const response = Math.pow(currentWeather.cloudIntensity, 0.68);
      sky.lerp(new THREE.Color(weatherTint), weatherVisual.cloudBlend * response * 0.82);
      fog.lerp(new THREE.Color(weatherTint), weatherVisual.cloudBlend * response * 0.74);
    }
    renderer.setClearColor(sky, 1);
    updateSkyVisuals(currentLighting);
    scene.fog = new THREE.Fog(fog, 1, 2);
    updateFogDistances();
  }

  function updateFogDistances(): void {
    if (!(scene.fog instanceof THREE.Fog)) return;
    const coreRadius = Math.max(6, contentBounds.getSize(new THREE.Vector3()).length() / 2);
    // The fog horizon must track the actual terrain extent. Natural valleys
    // reach far past the settlement framing (up to 720 units) while the camera
    // fit stays tied to the settlement core; a core-sized fog range then fades
    // every distant mountain face into a flat void-colored wall. Terrain half
    // extent / 6 keeps the six-radius weather formula while placing full fog
    // just past the terrain edge. Compact islands keep the core radius, which
    // is larger than their terrain extent, so their fog is unchanged.
    const terrainHalfExtent = Math.max(
      Math.abs(terrainBoundsBox.min.x), Math.abs(terrainBoundsBox.max.x),
      Math.abs(terrainBoundsBox.min.z), Math.abs(terrainBoundsBox.max.z),
    );
    const radius = Math.max(coreRadius, terrainHalfExtent / 6);
    const range = fogRangeForView(currentWeather.kind, cameraDistance, radius, options.environmentStyle === "ocean-island");
    scene.fog.near = range.near;
    scene.fog.far = range.far;
  }

  function updateSkyVisuals(state: SunState): void {
    const weatherVisual = weatherVisualForWeather(currentWeather);
    const weatherTint = weatherVisual.tint;
    updateSkyDomeColors(skyGeometry, state, weatherTint,
      weatherVisual.cloudBlend * Math.pow(currentWeather.cloudIntensity, 0.68) * 0.78);
    const celestialRadius = SKY_RADIUS * CELESTIAL_RADIUS_RATIO;
    setCelestialPosition(sunSprite, state.sunPosition, celestialRadius);
    setCelestialPosition(moonSprite, state.moonPosition, celestialRadius);
    // skyGroup is camera-centred but its children are cached for the idle path;
    // flush the two time-varying sprite transforms explicitly when the local
    // clock advances so the diagnostic projection and the visible sprites agree.
    skyGroup.updateMatrixWorld(true);
    sunSpriteMaterial.color.setHex(state.color);
    const sunlightScale = sunlightScaleForWeather(currentWeather);
    sunSpriteMaterial.opacity = sunlightScale;
    sunSprite.visible = state.sunVisibility > 0.08 && sunlightScale > 0.08;
    moonSpriteMaterial.color.setHex(state.skyHorizonColor).lerp(new THREE.Color(0xd7e3ef), state.moonVisibility);
    moonPhaseUniforms.uMoonIllumination.value = Number.isFinite(state.moonIllumination) ? state.moonIllumination! : 1;
    moonPhaseUniforms.uMoonWaxing.value = state.moonWaxing === false ? -1 : 1;
    moonPhaseUniforms.uMoonBrightLimbAngle.value = Number.isFinite(state.moonBrightLimbAngleDeg)
      ? state.moonBrightLimbAngleDeg! * Math.PI / 180 : 0;
    moonSprite.visible = state.moonVisibility > 0.08;
    const starStrength = state.starVisibility * weatherVisual.starVisibilityScale;
    starMaterial.color.setHex(state.skyZenithColor).lerp(new THREE.Color(0xdce8ff), THREE.MathUtils.clamp(starStrength * 0.86 + 0.14, 0, 1));
    starGeometry.setDrawRange(0, qualityProfile.starCount);
    starField.visible = starStrength > 0.08;
    if (cloudMaterial) {
      cloudMaterial.color.setHex(state.cloudColor);
      if (weatherTint !== null) cloudMaterial.color.lerp(new THREE.Color(weatherTint), weatherVisual.cloudBlend);
    }
  }

  function updateSceneBounds(
    worlds: readonly PositionedWorldSnapshot[],
    importedDecorations: readonly ImportedDecorationPlacement[],
    terrain: MergedGeometryData,
    framePreview: boolean,
  ): void {
      contentBounds = framePreview
      ? new THREE.Box3(new THREE.Vector3(-9, -2.5, -9), new THREE.Vector3(9, 4, 9))
      : new THREE.Box3(
        // Keep the camera fit tied to the settlement core. The expanded
        // natural ring is intentionally scenery, not a reason to shrink the
        // buildings in the first frame.
        new THREE.Vector3(terrain.framingBounds.minX, -2.5, terrain.framingBounds.minZ),
        new THREE.Vector3(terrain.framingBounds.maxX, 4, terrain.framingBounds.maxZ),
      );
    for (const world of worlds) {
      if (framePreview) {
        const radius = Math.max(9, world.footprint.width * 0.8, world.footprint.depth * 0.8);
        contentBounds.expandByPoint(new THREE.Vector3(world.worldPosition.x - radius, -2.5, world.worldPosition.z - radius));
        contentBounds.expandByPoint(new THREE.Vector3(world.worldPosition.x + radius, world.worldPosition.y + world.blueprint.bounds.maxY + 0.5, world.worldPosition.z + radius));
      }
      contentBounds.expandByPoint(new THREE.Vector3(world.worldPosition.x, world.worldPosition.y + world.blueprint.bounds.maxY + 0.5, world.worldPosition.z));
      for (const decoration of decorationsForProject(world.projectId, world.decorationDates ?? [], world.blueprint)) {
        const cos = Math.cos(world.rotationY); const sin = Math.sin(world.rotationY);
        const localX = decoration.x + world.blueprintOffset.x;
        const localZ = decoration.z + world.blueprintOffset.z;
        const x = world.worldPosition.x + localX * cos + localZ * sin;
        const z = world.worldPosition.z - localX * sin + localZ * cos;
        contentBounds.expandByPoint(new THREE.Vector3(x, world.worldPosition.y + (decoration.kind === "tree" ? 4.8 : 3.1), z));
      }
    }
    for (const decoration of importedDecorations) {
      contentBounds.expandByPoint(new THREE.Vector3(
        decoration.worldPosition.x,
        decoration.worldPosition.y + decoration.blueprint.bounds.maxY + 0.5,
        decoration.worldPosition.z,
      ));
    }
    visibilityBounds = new THREE.Box3(
      new THREE.Vector3(terrain.bounds.minX, terrain.bounds.minY, terrain.bounds.minZ),
      new THREE.Vector3(terrain.bounds.maxX, terrain.bounds.maxY, terrain.bounds.maxZ),
    ).union(contentBounds);
    const size = contentBounds.getSize(new THREE.Vector3());
    shadowExtent = Math.max(18, size.x / 2, size.z / 2, size.y);
    sun.shadow.camera.left = -shadowExtent;
    sun.shadow.camera.right = shadowExtent;
    sun.shadow.camera.top = shadowExtent;
    sun.shadow.camera.bottom = -shadowExtent;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = Math.max(80, shadowExtent * 5);
    sun.shadow.camera.updateProjectionMatrix();
    requestShadowRefresh(new Date(), true);
  }

  function focusBoundsFor(world: PositionedWorldSnapshot): THREE.Box3 {
    const horizontalRadius = Math.max(8, world.footprint.width * 0.78, world.footprint.depth * 0.78);
    const height = Math.max(5, world.blueprint.bounds.maxY - world.blueprint.bounds.minY + 1);
    return new THREE.Box3(
      new THREE.Vector3(world.worldPosition.x - horizontalRadius, world.worldPosition.y - 1, world.worldPosition.z - horizontalRadius),
      new THREE.Vector3(world.worldPosition.x + horizontalRadius, world.worldPosition.y + height + 1, world.worldPosition.z + horizontalRadius),
    );
  }

  function frameScene(resetDistance: boolean, preserveView = false): void {
    const previousTarget = preserveView ? cameraTarget.clone() : null;
    const previousDistance = cameraDistance;
    const focused = focusedProjectId === null ? undefined : positionedWorlds.find((world) => world.projectId === focusedProjectId);
    if (!focused) focusedProjectId = null;
    const bounds = focused ? focusBoundsFor(focused) : contentBounds;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(6, size.length() / 2);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.1, camera.aspect));
    fittedDistance = (radius / Math.sin(Math.max(0.1, Math.min(verticalFov, horizontalFov)) / 2)) * 1.04;
    cameraTarget.set(center.x, Math.max(1.5, center.y * 0.68), center.z);
    // The main settlement can move a little closer than an isolated blueprint
    // preview so imported builds remain inspectable in context. Preview and
    // focused-building framing keep their own tighter distance ranges.
    const zoomBounds = cameraZoomBounds(fittedDistance, focused ? "focused" : previewMode ? "preview" : "settlement");
    minimumCameraDistance = zoomBounds.minimum;
    maximumCameraDistance = zoomBounds.maximum;
    if (preserveView && previousTarget) {
      cameraTarget.copy(previousTarget);
      // A close/switch transition must remain visually still even when the old
      // focused distance falls outside the settlement's normal zoom limits.
      minimumCameraDistance = Math.min(minimumCameraDistance, previousDistance);
      maximumCameraDistance = Math.max(maximumCameraDistance, previousDistance);
      cameraDistance = previousDistance;
    } else if (resetDistance) cameraDistance = fittedDistance;
    cameraDistance = clampCameraDistance(cameraDistance, minimumCameraDistance, maximumCameraDistance);
    updateCamera();
  }

  const immersiveLookTargetValue = new THREE.Vector3();
  function immersiveLookTarget(): THREE.Vector3 {
    immersiveLookTargetValue.copy(cameraTarget);
    if (immersiveBottomBand <= 0 && immersiveRightBand <= 0) return immersiveLookTargetValue;
    const view = new THREE.Vector3().subVectors(cameraTarget, camera.position).normalize();
    // The immersive band hides part of the full-screen world. Tilt the view axis
    // so the settlement (the look-at centroid) lands in the visible window's
    // center: a fractional screen offset f maps to the aim angle atan(f*tan(halfFov)).
    if (immersiveBottomBand > 0) {
      const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
      const aimDown = Math.atan(immersiveBottomBand * Math.tan(halfFov));
      const axis = new THREE.Vector3().crossVectors(view, camera.up).normalize();
      if (axis.lengthSq() > 1e-6) view.applyAxisAngle(axis, -aimDown);
    }
    if (immersiveRightBand > 0) {
      const halfFovV = THREE.MathUtils.degToRad(camera.fov) / 2;
      const halfFovX = Math.atan(Math.tan(halfFovV) * Math.max(0.1, camera.aspect));
      // An azimuth rotation projects at screen-x scaled by cos(pitch), so the
      // aim angle that lands the settlement at NDC x = -right is
      // atan(right * tan(halfFovX) / cos(pitch)).
      const aimRight = Math.atan(immersiveRightBand * Math.tan(halfFovX) / Math.max(0.05, Math.cos(cameraPitch)));
      // Pan the view leftward (negative yaw) so the settlement moves right-to-left
      // into the visible window left of the right-hand column.
      view.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -aimRight);
    }
    return immersiveLookTargetValue.copy(camera.position).addScaledVector(view, camera.position.distanceTo(cameraTarget));
  }

  function updateCamera(): void {
    const horizontal = Math.cos(cameraPitch) * cameraDistance;
    camera.position.set(
      cameraTarget.x + Math.cos(cameraAzimuth) * horizontal,
      cameraTarget.y + Math.sin(cameraPitch) * cameraDistance,
      cameraTarget.z + Math.sin(cameraAzimuth) * horizontal,
    );
    const radius = Math.max(6, contentBounds.getSize(new THREE.Vector3()).length() / 2);
    visibilityNearestDistance = visibilityBounds.distanceToPoint(camera.position);
    visibilityFarthestDistance = farthestDistanceToBox(camera.position, visibilityBounds);
    const framingNear = Math.max(0.1, cameraDistance - radius * 1.65);
    // V16's natural terrain extends far beyond the settlement bounds used for
    // framing. Keep that scenery out of the camera's clip planes without
    // allowing it to shrink the buildings in the default composition.
    const visibilityNear = Math.max(0.5, visibilityNearestDistance * 0.72);
    camera.near = Math.min(framingNear, visibilityNear);
    camera.far = Math.max(
      cameraDistance + radius * 3 + 60,
      visibilityFarthestDistance + 24,
      camera.near * STAR_NEAR_CLIP_MARGIN / (STAR_RADIUS_RATIO * SKY_FAR_CLIP_RATIO),
    );
    camera.updateProjectionMatrix();
    const immersiveLook = immersiveLookTarget();
    canvas.dataset.cameraLookYOffset = (immersiveLook.y - cameraTarget.y).toFixed(3);
    camera.lookAt(immersiveLook);
    camera.updateMatrixWorld(true);
    syncPrecipitationField();
    // V21 diagnostic: where does the settlement centroid actually land on screen?
    // NDC 0 = the canvas center; +1 top/right, -1 bottom/left.
    settlementProjected.copy(cameraTarget).project(camera);
    canvas.dataset.settlementProjectedY = settlementProjected.y.toFixed(3);
    canvas.dataset.settlementProjectedX = settlementProjected.x.toFixed(3);
    const skyDistance = Math.min(
      camera.far * SKY_FAR_CLIP_RATIO,
      Math.max(SKY_RADIUS, camera.near * STAR_NEAR_CLIP_MARGIN / STAR_RADIUS_RATIO),
    );
    skyGroup.position.copy(camera.position);
    skyGroup.scale.setScalar(skyDistance / SKY_RADIUS);
    skyGroup.updateMatrix();
    skyGroup.updateMatrixWorld(true);
    updateFogDistances();
    updateNearDetailEffects();
    updateNaturalDecorationLod();
    // Keep interaction diagnostics truthful while the camera eases after a drag.
    canvas.dataset.cameraAzimuth = cameraAzimuth.toFixed(4);
    canvas.dataset.cameraPitchDegrees = THREE.MathUtils.radToDeg(cameraPitch).toFixed(2);
    canvas.dataset.cameraDistanceRatio = (cameraDistance / fittedDistance).toFixed(4);
    canvas.dataset.cameraTargetX = cameraTarget.x.toFixed(3);
    canvas.dataset.cameraTargetY = cameraTarget.y.toFixed(3);
    canvas.dataset.cameraTargetZ = cameraTarget.z.toFixed(3);
    canvas.dataset.cameraDistance = cameraDistance.toFixed(3);
    canvas.dataset.cameraMinimumDistanceRatio = (minimumCameraDistance / fittedDistance).toFixed(4);
    canvas.dataset.cameraMaximumDistanceRatio = (maximumCameraDistance / fittedDistance).toFixed(4);
    canvas.dataset.cameraNear = camera.near.toFixed(3);
    canvas.dataset.cameraFar = camera.far.toFixed(3);
    canvas.dataset.visibilityNearestDistance = visibilityNearestDistance.toFixed(3);
    canvas.dataset.visibilityFarthestDistance = visibilityFarthestDistance.toFixed(3);
    canvas.dataset.visibilityNearClipSafe = String(camera.near <= Math.max(0.5, visibilityNearestDistance * 0.72) + 0.001);
    canvas.dataset.visibilityFarClipSafe = String(camera.far >= visibilityFarthestDistance + 23.999);
    canvas.dataset.skyCameraWorldOffset = new THREE.Vector3().setFromMatrixPosition(skyGroup.matrixWorld).distanceTo(camera.position).toFixed(4);
    canvas.dataset.skyRadius = skyDistance.toFixed(2);
    canvas.dataset.starNearClipRatio = (skyDistance * STAR_RADIUS_RATIO / camera.near).toFixed(4);
    const moonProjection = celestialProjection(moonSprite, camera);
    canvas.dataset.moonInView = String(moonProjection.inView);
    canvas.dataset.moonScreenX = moonProjection.x.toFixed(3);
    canvas.dataset.moonScreenY = moonProjection.y.toFixed(3);
  }

  function applyPendingCameraUpdate(nowMs: number): boolean {
    const elapsedMs = Math.min(64, Math.max(0, nowMs - lastCameraUpdateMs));
    lastCameraUpdateMs = nowMs;
    const blend = 1 - Math.exp(-elapsedMs / 42);
    const azimuthDelta = targetCameraAzimuth - cameraAzimuth;
    const pitchDelta = targetCameraPitch - cameraPitch;
    if (Math.abs(azimuthDelta) < 0.00005 && Math.abs(pitchDelta) < 0.00005) {
      if (azimuthDelta !== 0 || pitchDelta !== 0) {
        cameraAzimuth = targetCameraAzimuth;
        cameraPitch = targetCameraPitch;
        updateCamera();
      }
      return false;
    }
    cameraAzimuth += azimuthDelta * blend;
    cameraPitch += pitchDelta * blend;
    updateCamera();
    return true;
  }

  function resize(): void {
    resizeCount += 1;
    const rect = canvas.getBoundingClientRect();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    lightingPostProcessor.setSize(Math.max(1, rect.width), Math.max(1, rect.height), renderer.getPixelRatio());
    camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
    frameScene(false);
    requestRender();
  }

  const pointerDown = (event: PointerEvent): void => {
    if (openingReveal) finishOpeningReveal("cancelled");
    if (pointerOwnership.count === 0) {
      pointerMoveCount = 0;
      interactionAnimationFrameIntervals = [];
      interactionAnimationFrameMaxMs = 0;
      interactionDelayedFrameCount = 0;
      lastInteractionAnimationFrameMs = null;
    }
    interacting = true;
    syncPrecipitationMotionGate(performance.now());
    pointerOwnership.begin(event.pointerId, { x: event.clientX, y: event.clientY }, performance.now());
    updateDiagnosticsDataset();
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic QA events do not own native capture. */ }
    if (pointerOwnership.count === 2) updatePinchReference();
    requestRender();
  };
  const pointerMove = (event: PointerEvent): void => {
    pointerMoveCount += 1;
    const movement = pointerOwnership.move(event.pointerId, { x: event.clientX, y: event.clientY }, performance.now());
    if (!movement) return;
    // Only movement from a pointer owned by this canvas can keep an
    // interaction alive. Hover mice, styluses and synthetic QA events may
    // continue moving after Android has stolen a touch pointer; allowing those
    // unrelated IDs to extend the deadline leaves ambient motion stuck.
    const { previous, current: next } = movement;
    if ((options.readNativeInput || options.subscribeNativeInput) && pointerOwnership.count === 1) { requestRender(); return; }
    if (pointerOwnership.count === 1) {
      targetCameraAzimuth += (next.x - previous.x) * 0.011;
      targetCameraPitch = THREE.MathUtils.clamp(targetCameraPitch + (next.y - previous.y) * 0.0045, THREE.MathUtils.degToRad(24), THREE.MathUtils.degToRad(64));
    } else if (pointerOwnership.count === 2) {
      const [first, second] = pointerOwnership.points();
      const distance = Math.hypot(first!.x - second!.x, first!.y - second!.y);
      const centerY = (first!.y + second!.y) / 2;
      if (previousPinchDistance && distance > 1) {
        cameraDistance = clampCameraDistance(
          cameraDistance * (previousPinchDistance / distance),
          minimumCameraDistance,
          maximumCameraDistance,
        );
      }
      if (previousPinchCenterY !== null) {
        targetCameraPitch = THREE.MathUtils.clamp(targetCameraPitch + (centerY - previousPinchCenterY) * 0.0025, THREE.MathUtils.degToRad(24), THREE.MathUtils.degToRad(64));
      }
      previousPinchDistance = distance;
      previousPinchCenterY = centerY;
      updateCamera();
    }
    requestRender();
  };
  const pointerUp = (event: PointerEvent): void => {
    const released = releasePointer(event.pointerId);
    if (released?.wasOnlyPointer && Math.hypot(event.clientX - released.start.x, event.clientY - released.start.y) <= 8) {
      pickTerrainAt(event.clientX, event.clientY);
      selectProjectAt(event.clientX, event.clientY);
    }
  };
  // V24 CT-01: system gestures (notification shade, edge back, incoming calls)
  // fire pointercancel / steal pointer capture instead of pointerup. Without a
  // cleanup the tracked pointer and the interacting flag stayed stuck, which
  // froze the ambient cloud drift / tree sway and interaction frames until the
  // next touch. A stale-interaction guard releases any pointer that produced
  // no movement for 2.5 s as a final safety net.
  const pointerCancel = (event: PointerEvent): void => {
    releasePointer(event.pointerId);
  };
  const releasePointer = (pointerId: number): ReleasedPointer | null => {
    const released = pointerOwnership.release(pointerId);
    if (!released) return null;
    if (pointerOwnership.count < 2) { previousPinchDistance = null; previousPinchCenterY = null; }
    if (pointerOwnership.count === 0) {
      interacting = false;
      syncPrecipitationMotionGate(performance.now());
      updateDiagnosticsDataset();
      requestRender();
    }
    return released;
  };
  const windowBlur = (): void => {
    pointerOwnership.clear();
    previousPinchDistance = null;
    previousPinchCenterY = null;
    interacting = false;
    syncPrecipitationMotionGate(performance.now());
    updateDiagnosticsDataset();
    requestRender();
  };
  const wheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (openingReveal) finishOpeningReveal("cancelled");
    interacting = true;
    cameraDistance = clampCameraDistance(
      cameraDistance * Math.exp(event.deltaY * 0.0012),
      minimumCameraDistance,
      maximumCameraDistance,
    );
    updateCamera();
    requestRender();
    interacting = false;
    syncPrecipitationMotionGate(performance.now());
  };

  function updatePinchReference(): void {
    const [first, second] = pointerOwnership.points();
    previousPinchDistance = Math.hypot(first!.x - second!.x, first!.y - second!.y);
    previousPinchCenterY = (first!.y + second!.y) / 2;
  }

  function pickTerrainAt(clientX: number, clientY: number): void {
    if (!options.onPickTerrain || !terrainMeshForPicking) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(terrainMeshForPicking, false)[0];
    if (!hit) return;
    options.onPickTerrain({
      x: Math.round(hit.point.x),
      y: Math.round(hit.point.y),
      z: Math.round(hit.point.z),
    });
  }

  function selectProjectAt(clientX: number, clientY: number): void {
    if (!options.onSelectProject || positionedWorlds.length === 0) return;    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(buildingGroup, true).find((intersection) => {
      let object: THREE.Object3D | null = intersection.object;
      while (object && object !== buildingGroup) {
        if (typeof object.userData.projectId === "string") return true;
        object = object.parent;
      }
      return false;
    });
    if (!hit) return;
    let object: THREE.Object3D | null = hit.object;
    while (object && object !== buildingGroup) {
      if (typeof object.userData.projectId === "string") {
        options.onSelectProject(object.userData.projectId);
        return;
      }
      object = object.parent;
    }
  }

  function resetView(): void {
    cameraAzimuth = defaultCameraAzimuth;
    cameraPitch = defaultCameraPitch;
    targetCameraAzimuth = defaultCameraAzimuth;
    targetCameraPitch = defaultCameraPitch;
    lastCameraUpdateMs = performance.now();
    frameScene(true);
    requestRender();
  }

  function applyQuality(tier: QualityTier, _runtimeDowngrade = false, force = false): boolean {
    if (disposed) return false;
    if (rendererContextIsLost()) {
      if (lifecycleProbeEnabled) qualityLifecycleProbe("quality-apply-end", {
        ...lifecycleIdentityMetrics(), requestedPreference: requestedLightingQuality,
        effectiveTier: qualityTier, status: "failed",
      });
      return false;
    }
    const previousTier = qualityTier;
    const previousProfile = qualityProfile;
    const previousShadowMapSize = sun.shadow.mapSize.x;
    const previousShadowMap = sun.shadow.map;
    const previousQualityFramePendingSinceMs = qualityFramePendingSinceMs;
    if (!force && tier === previousTier) return true;
    const qualityStartedAt = lifecycleProbeEnabled ? performance.now() : 0;
    const previousPixelRatio = renderer.getPixelRatio();
    const viewport = canvas.getBoundingClientRect();
    const nextPixelRatio = Math.min(window.devicePixelRatio || 1, QUALITY_PROFILES[tier].maxPixelRatio);
    if (lifecycleProbeEnabled) qualityFramePendingSinceMs = qualityStartedAt;
    if (lifecycleProbeEnabled) qualityLifecycleProbe("quality-apply-start", {
      ...lifecycleIdentityMetrics(), requestedPreference: requestedLightingQuality, effectiveTier: tier, status: "ok",
    });
    let preparedPostProcess: ReturnType<typeof lightingPostProcessor.prepareConfiguration> | null = null;
    let projectionCommitted = false;
    try {
      const nextProfile = QUALITY_PROFILES[tier];
      // Allocate/resize the optional post-process before changing the resident
      // projection. Its configuration is transactional; a failed prepare leaves
      // the previous profile and render target usable.
      preparedPostProcess = lightingPostProcessor.prepareConfiguration(
        LIGHTWEIGHT_SHADING_PROFILES[tier].features.halfResolutionBloom,
        tier === "high" ? 0.32 : 0,
        Math.max(1, viewport.width), Math.max(1, viewport.height), nextPixelRatio,
      );
      renderer.setPixelRatio(nextPixelRatio);
      qualityTier = tier;
      qualityProfile = nextProfile;
      renderer.shadowMap.enabled = true;
      sun.shadow.intensity = 0.62 + LIGHTWEIGHT_SHADING_PROFILES[tier].shadowStrength * 0.25;
      sun.shadow.bias = -0.00035;
      sun.shadow.normalBias = tier === "low" ? 0.024 : tier === "balanced" ? 0.018 : 0.013;
      if (sun.shadow.mapSize.x !== qualityProfile.shadowMapSize) {
        sun.shadow.mapSize.set(qualityProfile.shadowMapSize, qualityProfile.shadowMapSize);
      }
      updateMaterialEffects(currentLighting);
      updateReflectiveMaterials(currentLighting);
      setGlowMaterialsOpacity(currentLighting.nightFactor * (tier === "high" ? 0.62 : 0.48));
      for (const mesh of cutoutShadowMeshes) mesh.castShadow = LIGHTWEIGHT_SHADING_PROFILES[tier].features.cutoutShadows;
      syncQualityVisibility();
      requestShadowRefresh(new Date(), true);
      syncPrecipitationMotionGate(performance.now());
      preparedPostProcess.commit();
      requestRender();
      canvas.dataset.qualityTier = tier;
      updateDiagnosticsDataset();
      projectionCommitted = true;
    } catch {
      preparedPostProcess?.rollback();
      preparedPostProcess?.discard();
      qualityTier = previousTier;
      qualityProfile = previousProfile;
      qualityFramePendingSinceMs = previousQualityFramePendingSinceMs;
      try {
        renderer.setPixelRatio(previousPixelRatio);
        sun.shadow.intensity = 0.62 + LIGHTWEIGHT_SHADING_PROFILES[previousTier].shadowStrength * 0.25;
        if (sun.shadow.mapSize.x !== previousShadowMapSize) {
          sun.shadow.mapSize.set(previousShadowMapSize, previousShadowMapSize);
          requestShadowRefresh(new Date(), true);
        }
        sun.shadow.normalBias = previousTier === "low" ? 0.024 : previousTier === "balanced" ? 0.018 : 0.013;
        updateMaterialEffects(currentLighting);
        updateReflectiveMaterials(currentLighting);
        setGlowMaterialsOpacity(currentLighting.nightFactor * (previousTier === "high" ? 0.62 : 0.48));
        for (const mesh of cutoutShadowMeshes) mesh.castShadow = LIGHTWEIGHT_SHADING_PROFILES[previousTier].features.cutoutShadows;
        syncQualityVisibility();
      } catch { /* retain the original projection error; retry remains available */ }
      try {
        canvas.dataset.qualityTier = previousTier;
        updateDiagnosticsDataset();
      } catch (error) { console.error("Lighting quality rollback retained the previous projection, but diagnostics could not be refreshed", error); }
      if (lifecycleProbeEnabled) {
        try {
          qualityLifecycleProbe("quality-apply-end", {
            ...lifecycleIdentityMetrics(), requestedPreference: requestedLightingQuality, effectiveTier: previousTier, status: "failed",
          });
        } catch (error) { console.error("Lighting quality rollback completed, but lifecycle observation failed", error); }
      }
      return false;
    }

    // This is the transaction boundary. All calls that can reject the new
    // projection have completed while the old post-process and shadow targets
    // are still retained. Cleanup faults are not a failed apply/rollback.
    if (!projectionCommitted) return false;
    try {
      preparedPostProcess?.finalize();
      if (previousShadowMap && previousShadowMapSize !== qualityProfile.shadowMapSize) previousShadowMap.dispose();
    } catch (error) {
      console.error("Lighting quality committed, but retired GPU target cleanup failed", error);
    }
    preparedPostProcess = null;
    if (lifecycleProbeEnabled && sceneVoxelCount > 0) {
      try {
        qualityLifecycleProbe("quality-projection-complete", {
          durationMs: performance.now() - qualityStartedAt,
          ...lifecycleIdentityMetrics(),
          requestedPreference: requestedLightingQuality,
          effectiveTier: tier,
          devicePixelRatio: window.devicePixelRatio || 1,
          pixelRatio: renderer.getPixelRatio(),
          shadowMapSize: qualityProfile.shadowMapSize,
          localLightCount: localLights.filter(entry => entry.light.visible).length,
          localLightCreatedCount: localLights.length,
          glowSpriteCount: glowSprites.filter(entry => entry.sprite.visible).length,
          glowSpriteCreatedCount: glowSprites.length,
          naturalTreeCount: naturalTreeMeshes?.trunks.count ?? 0,
          ambientDecorationCount,
          weatherParticleCount: (rainAnimation?.mesh.count ?? 0) + (snowAnimation?.mesh.count ?? 0),
          starCount: starField.visible ? qualityProfile.starCount : 0,
          status: "ok",
        });
      } catch (error) { console.error("Lighting quality committed, but lifecycle observation failed", error); }
    }
    if (lifecycleProbeEnabled) {
      try {
        qualityLifecycleProbe("quality-apply-end", {
          ...lifecycleIdentityMetrics(), requestedPreference: requestedLightingQuality, effectiveTier: tier, status: "ok",
        });
      } catch (error) { console.error("Lighting quality committed, but lifecycle observation failed", error); }
    }
    return true;
  }

  function maybeDowngradeQuality(): void {
    if (qualityTier === "low") return;
    const p95 = interactionP95();
    const render = renderer.info.render;
    const sustainedSlow = interactionFrameDurations.length >= 24 && p95 !== null && p95 > 22;
    const sceneHeavy = render.calls > 180 || render.triangles > 340_000;
    if (!sustainedSlow && !sceneHeavy) return;
    const next = lowerQualityTier(qualityTier);
    if (applyQuality(next, true)) adaptiveQualityCap = next;
    interactionFrameDurations = [];
    resize();
  }

  function rendererContextIsLost(): boolean {
    try { return renderer.getContext().isContextLost(); }
    catch { return true; }
  }

  function getDiagnostics(): RendererDiagnostics {
    const animations = atlasAnimationControllers.flatMap((controller) => controller ? [controller.getDiagnostics()] : []);
    const visualBiomePalette = activeResourcePack?.atlas.pages[0]?.visualBiomePalette;
    const sunProjection = celestialProjection(sunSprite, camera);
    const moonProjection = celestialProjection(moonSprite, camera);
    const astronomyDay = astronomyContext ? astronomyDayAt(astronomyContext.schedule, lightingSampledAtMs) : null;
    return {
      qualityTier,
      pixelRatio: renderer.getPixelRatio(),
      render: { ...renderer.info.render },
      memory: { ...renderer.info.memory },
      worldRebuildCount,
      renderedWorldRebuildCount: worldFrameCommit.renderedWorldRebuildCount,
      lastWorldFrameCommittedAtMs: worldFrameCommit.lastWorldFrameCommittedAtMs,
      naturalFlowerPackPlacementCount,
      naturalFlowerOriginalFallbackCount,
      naturalFlowerVisibleBatchCount: buildingGroup.children.filter(child =>
        child instanceof THREE.InstancedMesh && child.userData.naturalDecorationKind === "flower" && child.visible && child.count > 0).length,
      treeSideMushroomCount,
      worldRebuildLastMs,
      worldRebuildTotalMs,
      worldRebuildMaxMs,
      firstNonemptyFrameMs,
      interactionP95Ms: interactionP95(),
      interactionTotalP95Ms: percentile(interactionTotalDurations, 0.95),
      interactionTotalMaxMs,
      interactionAnimationFrameP95Ms: percentile(interactionAnimationFrameIntervals, 0.95),
      interactionAnimationFrameMaxMs,
      interactionDelayedFrameCount,
      nearDetailLevel: nearDetailFactor >= 0.55 ? "near" : "far",
      edgeDetailStrength: nearDetailFactor,
      gpuTimerAvailable,
      gpuRenderP95Ms: percentile(gpuRenderDurations, 0.95),
      gpuRenderMaxMs,
      gpuRenderSampleCount: gpuRenderDurations.length,
      pointerMoveCount,
      resizeCount,
      shadowToggleCount,
      shadowTransformSyncCount: cachedShadowTransformSyncs,
      shadowTransformSyncTotalMs,
      shadowTransformSyncMaxMs,
      activeResourcePackId: activeResourcePack?.id ?? null,
      atlasPageCount: activeResourcePack?.atlas.pages.length ?? 0,
      texturedBatchCount,
      texturedVoxelCount,
      resourceFluidVoxelCount,
      resourceFluidAnimatedTextureCount: referencedFluidAnimatedTextures.size,
      resourceSpecialVoxelCount,
      constructionPulseCount,
      fallbackVoxelCount,
      originalMaterialTextureCount: originalMaterialTextures.size,
      transformedUvVoxelCount,
      geometrySignatureBatchCount,
      geometryVoxelCount,
      geometryElementInstanceCount,
      geometryQuadInstanceCount,
      multipartGeometryVoxelCount,
      translucentGeometryVoxelCount,
      tintedVoxelCount,
      animatedTextureCount: animations.reduce((sum, animation) => sum + animation.sequenceCount, 0),
      availableAnimatedTextureCount: animations.reduce((sum, animation) => sum + animation.availableSequenceCount, 0),
      animationFrameUpdateCount: animations.reduce((sum, animation) => sum + animation.frameUpdateCount, 0),
      animationInterpolatedTextureCount: animations.reduce((sum, animation) => sum + animation.interpolatedSequenceCount, 0),
      animationScheduled: animations.some((animation) => animation.scheduled),
      visualBiomeSource: visualBiomePalette?.source ?? "original",
      visualBiomeGrass: visualBiomePalette?.grass ?? 0x78a95a,
      visualBiomeFoliage: visualBiomePalette?.foliage ?? 0x619a52,
      shaderDetail: qualityTier,
      shadowRefreshCount,
      shadowRefreshReason: lastShadowRefreshReason,
      cutoutShadowMeshCount: [...cutoutShadowMeshes].filter((mesh) => mesh.castShadow).length,
      dayPhase: currentLighting.phase,
      lightingUpdateCount,
      astronomySource: !astronomyContext ? "synthetic" : astronomyDay ? "provider+ephemeris" : "ephemeris-only",
      astronomyLocationSource: astronomyContext?.locationSource ?? "none",
      sunAltitudeDeg: currentLighting.sunAltitudeDeg ?? null,
      sunAzimuthDeg: currentLighting.sunAzimuthDeg ?? null,
      moonAltitudeDeg: currentLighting.moonAltitudeDeg ?? null,
      moonAzimuthDeg: currentLighting.moonAzimuthDeg ?? null,
      moonIllumination: currentLighting.moonIllumination ?? null,
      astronomyDayStartMs: astronomyDay?.intervalStartMs ?? null,
      astronomyDayEndMs: astronomyDay?.intervalEndMs ?? null,
      astronomyUpdateCount,
      environmentTransitionActive: lightingTransition !== null || environmentReveal !== null,
      environmentTransitionTarget: environmentReveal?.target ?? (astronomyContext ? "astronomy" : "synthetic"),
      environmentTransitionStartedCount,
      environmentTransitionCompletedCount,
      environmentTransitionCancelledCount,
      openingRevealStartedCount,
      openingRevealCompletedCount,
      openingRevealCancelledCount,
      lightingSampledAtMs,
      lightingFingerprint: lightingDirectionFingerprint(currentLighting),
      sunPosition: currentLighting.sunPosition,
      moonPosition: currentLighting.moonPosition,
      shadowDirection: shadowDirectionFromPosition(currentLighting.position),
      skyLayerCount: 3,
      sunVisibility: currentLighting.sunVisibility,
      moonVisibility: currentLighting.moonVisibility,
      sunInView: sunProjection.inView,
      moonInView: moonProjection.inView,
      moonScreenX: moonProjection.x,
      moonScreenY: moonProjection.y,
      visibleStarCount: starField.visible ? qualityProfile.starCount : 0,
      cloudBlockCount,
      visibleCloudBlockCount: cloudDrift?.mesh.count ?? 0,
      cloudBudgetMode,
      cloudBlockScale,
      weatherKind: currentWeather.kind,
      weatherCloudIntensity: currentWeather.cloudIntensity,
      weatherPrecipitationIntensity: currentWeather.precipitationIntensity,
      weatherVisualPrecipitationIntensity: currentWeather.visualPrecipitationIntensity,
      rainDropCount: rainAnimation?.particles.length ?? 0,
      visibleRainDropCount: rainAnimation?.mesh.count ?? 0,
      snowFlakeCount: snowAnimation?.particles.length ?? 0,
      visibleSnowFlakeCount: snowAnimation?.mesh.count ?? 0,
      precipitationFieldMode: previewMode ? "preview" : "main-world",
      precipitationFieldCenterX: precipitationField?.centerX ?? 0,
      precipitationFieldCenterZ: precipitationField?.centerZ ?? 0,
      precipitationFieldSpanX: precipitationField?.spanX ?? 0,
      precipitationFieldSpanZ: precipitationField?.spanZ ?? 0,
      precipitationFieldUsedFallback: precipitationField?.usedFallback ?? false,
      precipitationFieldSyncCount,
      rainCameraFrustumCount,
      snowCameraFrustumCount,
      precipitationMotionPaused: (rainAnimation?.paused ?? false) || (snowAnimation?.paused ?? false)
        || !paneVisible || interacting || reducedMotion || document.hidden,
      rainElapsedMs: rainAnimation?.elapsedMs ?? 0,
      snowElapsedMs: snowAnimation?.elapsedMs ?? 0,
      rainStreakProjectedCssPx,
      fogNear: scene.fog instanceof THREE.Fog ? scene.fog.near : 0,
      fogFar: scene.fog instanceof THREE.Fog ? scene.fog.far : 0,
      cameraNear: camera.near,
      cameraFar: camera.far,
      visibilityNearestDistance,
      visibilityFarthestDistance,
      visibilityNearClipSafe: camera.near <= Math.max(0.5, visibilityNearestDistance * 0.72) + 0.001,
      visibilityFarClipSafe: camera.far >= visibilityFarthestDistance + 23.999,
      atmosphereFollowsWorld: atmosphereGroup.parent === rotatableWorldRoot,
      terrainWaterOpaque: materials.get("terrainWater")?.transparent === false
        && materials.get("terrainWater")?.depthWrite === true
        && materials.get("terrainWater")?.opacity === 1,
      glowSpriteCount: glowSprites.length,
      visibleGlowSpriteCount: glowSprites.filter((entry) => entry.sprite.visible).length,
      glowSpriteMaximumScale: Math.max(0, ...glowSprites.map((entry) => entry.sprite.scale.x)),
      glowTextureSize: 32,
      glowTextureShape: "soft-square",
      requestedLightingQuality,
      activeLightingQuality: qualityTier === "high" ? "cinematic" : qualityTier === "balanced" ? "balanced" : "performance",
      bloomEnabled: lightingPostProcessor.getDiagnostics().enabled,
      fullscreenPassCount: lightingPostProcessor.getDiagnostics().passCount,
      postProcessRenderCount,
      postProcessBypassCount,
      postProcessSampleCount: lightingPostProcessor.getDiagnostics().sampleCount,
      constructionOutlineVisibility,
      plannedOutlineVoxelCount,
      continuousRendering: false,
      ambientMotionActive: ambientMotionAllowed(),
      constructionRevealCount: constructionReveals.filter((reveal) => !reveal.done).length,
      lowLatencyWebGl,
      nativeInputReceivedCount,
      nativeInputLastSequence,
      nativeInputRenderedSequence,
      nativeInputTransport,
      ambientDecorationCount,
      ambientDecorationKindCount,
      ambientDecorationDrawCalls,
      ambientDecorationAllocatedBatchCount,
      ambientDecorationShadowCasters,
      localLightCreatedCount: localLights.length,
      visibleLocalLightCount: localLights.filter(entry => entry.light.visible).length,
      originalStaticShapeVoxelCount,
      originalStaticShapeBatchCount,
      originalStaticShapeTopologyCount,
      originalStaticShapeMaterialGroupCount,
      originalStaticShapeEmissiveMaterialGroupCount,
      originalStaticShapeTopologyOverflow,
      originalStaticShapeMaterialGroupOverflow,
      originalStaticShapeBudgetFallbackVoxelCount,
      sourceLanternPointLightCount,
    };
  }

  function updateDiagnosticsDataset(): void {
    const diagnostics = getDiagnostics();
    canvas.dataset.interacting = String(interacting);
    canvas.dataset.pointerCount = String(pointerOwnership.count);
    canvas.dataset.renderCalls = String(diagnostics.render.calls);
    canvas.dataset.renderTriangles = String(diagnostics.render.triangles);
    canvas.dataset.pixelRatio = diagnostics.pixelRatio.toFixed(2);
    canvas.dataset.worldRebuildCount = String(diagnostics.worldRebuildCount);
    canvas.dataset.renderedWorldRebuildCount = String(diagnostics.renderedWorldRebuildCount);
    if (diagnostics.lastWorldFrameCommittedAtMs !== null) {
      canvas.dataset.lastWorldFrameCommittedAtMs = String(diagnostics.lastWorldFrameCommittedAtMs);
    }
    canvas.dataset.naturalFlowerPackPlacementCount = String(diagnostics.naturalFlowerPackPlacementCount);
    canvas.dataset.naturalFlowerOriginalFallbackCount = String(diagnostics.naturalFlowerOriginalFallbackCount);
    canvas.dataset.naturalFlowerVisibleBatchCount = String(diagnostics.naturalFlowerVisibleBatchCount);
    canvas.dataset.treeSideMushroomCount = String(diagnostics.treeSideMushroomCount);
    canvas.dataset.worldRebuildLastMs = diagnostics.worldRebuildLastMs.toFixed(2);
    canvas.dataset.worldRebuildTotalMs = diagnostics.worldRebuildTotalMs.toFixed(2);
    canvas.dataset.worldRebuildMaxMs = diagnostics.worldRebuildMaxMs.toFixed(2);
    if (diagnostics.firstNonemptyFrameMs !== null) canvas.dataset.firstNonemptyFrameMs = diagnostics.firstNonemptyFrameMs.toFixed(2);
    canvas.dataset.worldRotation = rotatableWorldRoot.rotation.y.toFixed(4);
    canvas.dataset.cameraAzimuth = cameraAzimuth.toFixed(4);
    canvas.dataset.cameraDistanceRatio = (cameraDistance / fittedDistance).toFixed(4);
    canvas.dataset.cameraPitchDegrees = THREE.MathUtils.radToDeg(cameraPitch).toFixed(2);
    canvas.dataset.cameraTargetX = cameraTarget.x.toFixed(3);
    canvas.dataset.cameraTargetY = cameraTarget.y.toFixed(3);
    canvas.dataset.cameraTargetZ = cameraTarget.z.toFixed(3);
    canvas.dataset.cameraDistance = cameraDistance.toFixed(3);
    canvas.dataset.precipitationFieldMode = diagnostics.precipitationFieldMode;
    canvas.dataset.precipitationFieldCenterX = diagnostics.precipitationFieldCenterX.toFixed(2);
    canvas.dataset.precipitationFieldCenterZ = diagnostics.precipitationFieldCenterZ.toFixed(2);
    canvas.dataset.precipitationFieldSpanX = diagnostics.precipitationFieldSpanX.toFixed(2);
    canvas.dataset.precipitationFieldSpanZ = diagnostics.precipitationFieldSpanZ.toFixed(2);
    canvas.dataset.precipitationFieldUsedFallback = String(diagnostics.precipitationFieldUsedFallback);
    canvas.dataset.precipitationFieldSyncCount = String(diagnostics.precipitationFieldSyncCount);
    canvas.dataset.rainCameraFrustumCount = String(diagnostics.rainCameraFrustumCount);
    canvas.dataset.snowCameraFrustumCount = String(diagnostics.snowCameraFrustumCount);
    canvas.dataset.precipitationMotionPaused = String(diagnostics.precipitationMotionPaused);
    canvas.dataset.rainElapsedMs = String(Math.round(diagnostics.rainElapsedMs));
    canvas.dataset.snowElapsedMs = String(Math.round(diagnostics.snowElapsedMs));
    canvas.dataset.rainStreakProjectedCssPx = diagnostics.rainStreakProjectedCssPx.toFixed(2);
    canvas.dataset.skyCameraWorldOffset = new THREE.Vector3().setFromMatrixPosition(skyGroup.matrixWorld).distanceTo(camera.position).toFixed(4);
    canvas.dataset.worldRootMembers = rotatableWorldRoot.children.map((child) => child.name).join(",");
    canvas.dataset.shadowAutoUpdate = String(renderer.shadowMap.autoUpdate);
    canvas.dataset.cachedShadowTransformSyncs = String(cachedShadowTransformSyncs);
    canvas.dataset.interactionTotalP95Ms = String(diagnostics.interactionTotalP95Ms ?? "");
    canvas.dataset.interactionTotalMaxMs = diagnostics.interactionTotalMaxMs.toFixed(2);
    canvas.dataset.interactionAnimationFrameP95Ms = String(diagnostics.interactionAnimationFrameP95Ms ?? "");
    canvas.dataset.interactionAnimationFrameMaxMs = diagnostics.interactionAnimationFrameMaxMs.toFixed(2);
    canvas.dataset.interactionDelayedFrameCount = String(diagnostics.interactionDelayedFrameCount);
    canvas.dataset.nearDetailLevel = diagnostics.nearDetailLevel;
    canvas.dataset.edgeDetailStrength = diagnostics.edgeDetailStrength.toFixed(3);
    canvas.dataset.gpuTimerAvailable = String(diagnostics.gpuTimerAvailable);
    canvas.dataset.gpuRenderP95Ms = String(diagnostics.gpuRenderP95Ms ?? "");
    canvas.dataset.gpuRenderMaxMs = diagnostics.gpuRenderMaxMs.toFixed(2);
    canvas.dataset.gpuRenderSampleCount = String(diagnostics.gpuRenderSampleCount);
    canvas.dataset.pointerMoveCount = String(diagnostics.pointerMoveCount);
    canvas.dataset.resizeCount = String(diagnostics.resizeCount);
    canvas.dataset.shadowToggleCount = String(diagnostics.shadowToggleCount);
    canvas.dataset.shadowTransformSyncTotalMs = diagnostics.shadowTransformSyncTotalMs.toFixed(2);
    canvas.dataset.shadowTransformSyncMaxMs = diagnostics.shadowTransformSyncMaxMs.toFixed(2);
    if (!canvas.getAttribute("aria-label")) canvas.setAttribute("aria-label", `项目建筑世界。诊断：draw calls ${diagnostics.render.calls}，triangles ${diagnostics.render.triangles}，完整交互 p95 ${diagnostics.interactionTotalP95Ms?.toFixed(2) ?? "无"} ms，阴影同步 ${diagnostics.shadowTransformSyncCount} 次，resize ${diagnostics.resizeCount} 次，低延迟 WebGL ${diagnostics.lowLatencyWebGl ? "已启用" : "未启用"}。`);
    canvas.dataset.localLightCount = String(localLights.filter(entry => entry.light.visible).length);
    canvas.dataset.localLightCreatedCount = String(localLights.length);
    canvas.dataset.activeResourcePackId = diagnostics.activeResourcePackId ?? "";
    canvas.dataset.atlasPageCount = String(diagnostics.atlasPageCount);
    canvas.dataset.texturedBatchCount = String(diagnostics.texturedBatchCount);
    canvas.dataset.texturedVoxelCount = String(diagnostics.texturedVoxelCount);
    canvas.dataset.resourceFluidVoxelCount = String(diagnostics.resourceFluidVoxelCount);
    canvas.dataset.resourceFluidAnimatedTextureCount = String(diagnostics.resourceFluidAnimatedTextureCount);
    canvas.dataset.resourceSpecialVoxelCount = String(diagnostics.resourceSpecialVoxelCount);
    canvas.dataset.fallbackVoxelCount = String(diagnostics.fallbackVoxelCount);
    canvas.dataset.originalMaterialTextureCount = String(diagnostics.originalMaterialTextureCount);
    canvas.dataset.transformedUvVoxelCount = String(diagnostics.transformedUvVoxelCount);
    canvas.dataset.geometrySignatureBatchCount = String(diagnostics.geometrySignatureBatchCount);
    canvas.dataset.geometryVoxelCount = String(diagnostics.geometryVoxelCount);
    canvas.dataset.geometryElementInstanceCount = String(diagnostics.geometryElementInstanceCount);
    canvas.dataset.geometryQuadInstanceCount = String(diagnostics.geometryQuadInstanceCount);
    canvas.dataset.multipartGeometryVoxelCount = String(diagnostics.multipartGeometryVoxelCount);
    canvas.dataset.translucentGeometryVoxelCount = String(diagnostics.translucentGeometryVoxelCount);
    canvas.dataset.tintedVoxelCount = String(diagnostics.tintedVoxelCount);
    canvas.dataset.animatedTextureCount = String(diagnostics.animatedTextureCount);
    canvas.dataset.availableAnimatedTextureCount = String(diagnostics.availableAnimatedTextureCount);
    canvas.dataset.animationFrameUpdateCount = String(diagnostics.animationFrameUpdateCount);
    canvas.dataset.animationInterpolatedTextureCount = String(diagnostics.animationInterpolatedTextureCount);
    canvas.dataset.animationScheduled = String(diagnostics.animationScheduled);
    canvas.dataset.visualBiomeSource = diagnostics.visualBiomeSource;
    canvas.dataset.visualBiomeGrass = diagnostics.visualBiomeGrass.toString(16).padStart(6, "0");
    canvas.dataset.visualBiomeFoliage = diagnostics.visualBiomeFoliage.toString(16).padStart(6, "0");
    canvas.dataset.shaderDetail = diagnostics.shaderDetail;
    canvas.dataset.shadowRefreshCount = String(diagnostics.shadowRefreshCount);
    canvas.dataset.shadowRefreshReason = diagnostics.shadowRefreshReason;
    canvas.dataset.cutoutShadowMeshCount = String(diagnostics.cutoutShadowMeshCount);
    canvas.dataset.dayPhase = diagnostics.dayPhase;
    canvas.dataset.lightingUpdateCount = String(diagnostics.lightingUpdateCount);
    canvas.dataset.astronomySource = diagnostics.astronomySource;
    canvas.dataset.astronomySampleTime = String(diagnostics.lightingSampledAtMs);
    canvas.dataset.astronomyPhase = diagnostics.dayPhase;
    canvas.dataset.environmentTransitionTarget = diagnostics.environmentTransitionTarget;
    canvas.dataset.environmentTransitionActive = String(diagnostics.environmentTransitionActive);
    canvas.dataset.initialRevealStartedCount = String(diagnostics.openingRevealStartedCount);
    canvas.dataset.initialRevealCompletedCount = String(diagnostics.openingRevealCompletedCount);
    canvas.dataset.initialRevealCancelledCount = String(diagnostics.openingRevealCancelledCount);
    canvas.dataset.astronomyLocationSource = diagnostics.astronomyLocationSource;
    canvas.dataset.sunAltitudeDeg = diagnostics.sunAltitudeDeg?.toFixed(3) ?? "";
    canvas.dataset.sunAzimuthDeg = diagnostics.sunAzimuthDeg?.toFixed(3) ?? "";
    canvas.dataset.moonAltitudeDeg = diagnostics.moonAltitudeDeg?.toFixed(3) ?? "";
    canvas.dataset.moonAzimuthDeg = diagnostics.moonAzimuthDeg?.toFixed(3) ?? "";
    canvas.dataset.moonIllumination = diagnostics.moonIllumination?.toFixed(3) ?? "";
    canvas.dataset.astronomyDayStartMs = diagnostics.astronomyDayStartMs === null ? "" : String(diagnostics.astronomyDayStartMs);
    canvas.dataset.astronomyDayEndMs = diagnostics.astronomyDayEndMs === null ? "" : String(diagnostics.astronomyDayEndMs);
    canvas.dataset.astronomyUpdateCount = String(diagnostics.astronomyUpdateCount);
    canvas.dataset.environmentTransitionActive = String(diagnostics.environmentTransitionActive);
    canvas.dataset.environmentTransitionStartedCount = String(diagnostics.environmentTransitionStartedCount);
    canvas.dataset.environmentTransitionCompletedCount = String(diagnostics.environmentTransitionCompletedCount);
    canvas.dataset.environmentTransitionCancelledCount = String(diagnostics.environmentTransitionCancelledCount);
    canvas.dataset.openingRevealStartedCount = String(diagnostics.openingRevealStartedCount);
    canvas.dataset.openingRevealCompletedCount = String(diagnostics.openingRevealCompletedCount);
    canvas.dataset.openingRevealCancelledCount = String(diagnostics.openingRevealCancelledCount);
    canvas.dataset.lightingSampledAtMs = String(diagnostics.lightingSampledAtMs);
    canvas.dataset.lightingFingerprint = diagnostics.lightingFingerprint;
    canvas.dataset.sunPosition = diagnostics.sunPosition.map((value) => value.toFixed(4)).join(",");
    canvas.dataset.moonPosition = diagnostics.moonPosition.map((value) => value.toFixed(4)).join(",");
    canvas.dataset.shadowDirection = diagnostics.shadowDirection.map((value) => value.toFixed(4)).join(",");
    canvas.dataset.skyLayerCount = String(diagnostics.skyLayerCount);
    canvas.dataset.sunVisibility = diagnostics.sunVisibility.toFixed(3);
    canvas.dataset.moonVisibility = diagnostics.moonVisibility.toFixed(3);
    canvas.dataset.sunInView = String(diagnostics.sunInView);
    canvas.dataset.moonInView = String(diagnostics.moonInView);
    canvas.dataset.moonScreenX = diagnostics.moonScreenX.toFixed(3);
    canvas.dataset.moonScreenY = diagnostics.moonScreenY.toFixed(3);
    canvas.dataset.visibleStarCount = String(diagnostics.visibleStarCount);
    canvas.dataset.cloudBlockCount = String(diagnostics.cloudBlockCount);
    canvas.dataset.cloudBudgetMode = diagnostics.cloudBudgetMode;
    canvas.dataset.cloudBlockScale = diagnostics.cloudBlockScale.toFixed(3);
    canvas.dataset.weatherKind = diagnostics.weatherKind;
    canvas.dataset.weatherCloudIntensity = diagnostics.weatherCloudIntensity.toFixed(3);
    canvas.dataset.weatherPrecipitationIntensity = diagnostics.weatherPrecipitationIntensity.toFixed(3);
    canvas.dataset.weatherVisualPrecipitationIntensity = diagnostics.weatherVisualPrecipitationIntensity.toFixed(3);
    canvas.dataset.rainDropCount = String(diagnostics.rainDropCount);
    canvas.dataset.snowFlakeCount = String(diagnostics.snowFlakeCount);
    canvas.dataset.fogNear = diagnostics.fogNear.toFixed(2);
    canvas.dataset.fogFar = diagnostics.fogFar.toFixed(2);
    canvas.dataset.cameraNear = diagnostics.cameraNear.toFixed(3);
    canvas.dataset.cameraFar = diagnostics.cameraFar.toFixed(3);
    canvas.dataset.visibilityNearestDistance = diagnostics.visibilityNearestDistance.toFixed(3);
    canvas.dataset.visibilityFarthestDistance = diagnostics.visibilityFarthestDistance.toFixed(3);
    canvas.dataset.visibilityNearClipSafe = String(diagnostics.visibilityNearClipSafe);
    canvas.dataset.visibilityFarClipSafe = String(diagnostics.visibilityFarClipSafe);
    canvas.dataset.atmosphereFollowsWorld = String(diagnostics.atmosphereFollowsWorld);
    canvas.dataset.terrainWaterOpaque = String(diagnostics.terrainWaterOpaque);
    canvas.dataset.glowSpriteCount = String(diagnostics.glowSpriteCount);
    canvas.dataset.visibleGlowSpriteCount = String(diagnostics.visibleGlowSpriteCount);
    canvas.dataset.glowSpriteMaximumScale = diagnostics.glowSpriteMaximumScale.toFixed(3);
    canvas.dataset.glowTextureSize = String(diagnostics.glowTextureSize);
    canvas.dataset.glowTextureShape = diagnostics.glowTextureShape;
    canvas.dataset.requestedLightingQuality = diagnostics.requestedLightingQuality;
    canvas.dataset.activeLightingQuality = diagnostics.activeLightingQuality;
    canvas.dataset.bloomEnabled = String(diagnostics.bloomEnabled);
    canvas.dataset.fullscreenPassCount = String(diagnostics.fullscreenPassCount);
    canvas.dataset.postProcessRenderCount = String(diagnostics.postProcessRenderCount);
    canvas.dataset.postProcessBypassCount = String(diagnostics.postProcessBypassCount);
    canvas.dataset.postProcessSampleCount = String(diagnostics.postProcessSampleCount);
    canvas.dataset.constructionOutlineVisibility = diagnostics.constructionOutlineVisibility;
    canvas.dataset.plannedOutlineVoxelCount = String(diagnostics.plannedOutlineVoxelCount);
    canvas.dataset.continuousRendering = String(diagnostics.continuousRendering);
    canvas.dataset.ambientMotionActive = String(diagnostics.ambientMotionActive);
    canvas.dataset.constructionRevealCount = String(diagnostics.constructionRevealCount);
    canvas.dataset.lowLatencyWebGl = String(diagnostics.lowLatencyWebGl);
    canvas.dataset.nativeInputReceivedCount = String(diagnostics.nativeInputReceivedCount);
    canvas.dataset.nativeInputLastSequence = String(diagnostics.nativeInputLastSequence);
    canvas.dataset.nativeInputRenderedSequence = String(diagnostics.nativeInputRenderedSequence);
    canvas.dataset.nativeInputTransport = diagnostics.nativeInputTransport;
    canvas.dataset.ambientDecorationCount = String(diagnostics.ambientDecorationCount);
    canvas.dataset.ambientDecorationKindCount = String(diagnostics.ambientDecorationKindCount);
    canvas.dataset.ambientDecorationDrawCalls = String(diagnostics.ambientDecorationDrawCalls);
    canvas.dataset.ambientDecorationAllocatedBatchCount = String(diagnostics.ambientDecorationAllocatedBatchCount);
    canvas.dataset.ambientDecorationShadowCasters = String(diagnostics.ambientDecorationShadowCasters);
    canvas.dataset.originalStaticShapeVoxelCount = String(diagnostics.originalStaticShapeVoxelCount);
    canvas.dataset.originalStaticShapeBatchCount = String(diagnostics.originalStaticShapeBatchCount);
    canvas.dataset.originalStaticShapeTopologyCount = String(diagnostics.originalStaticShapeTopologyCount);
    canvas.dataset.originalStaticShapeMaterialGroupCount = String(diagnostics.originalStaticShapeMaterialGroupCount);
    canvas.dataset.originalStaticShapeTopologyOverflow = String(diagnostics.originalStaticShapeTopologyOverflow);
    canvas.dataset.originalStaticShapeMaterialGroupOverflow = String(diagnostics.originalStaticShapeMaterialGroupOverflow);
    canvas.dataset.originalStaticShapeBudgetFallbackVoxelCount = String(diagnostics.originalStaticShapeBudgetFallbackVoxelCount);
    canvas.dataset.sourceLanternPointLightCount = String(diagnostics.sourceLanternPointLightCount);
  }

  function logInteractionDiagnostics(): void {
    const diagnostics = getDiagnostics();
    const payload = JSON.stringify({
      cpuRenderP95Ms: diagnostics.interactionP95Ms,
      totalFrameP95Ms: diagnostics.interactionTotalP95Ms,
      totalFrameMaxMs: diagnostics.interactionTotalMaxMs,
      animationFrameP95Ms: diagnostics.interactionAnimationFrameP95Ms,
      animationFrameMaxMs: diagnostics.interactionAnimationFrameMaxMs,
      delayedFrameCount: diagnostics.interactionDelayedFrameCount,
      gpuTimerAvailable: diagnostics.gpuTimerAvailable,
      gpuRenderP95Ms: diagnostics.gpuRenderP95Ms,
      gpuRenderMaxMs: diagnostics.gpuRenderMaxMs,
      gpuRenderSampleCount: diagnostics.gpuRenderSampleCount,
      drawCalls: diagnostics.render.calls,
      triangles: diagnostics.render.triangles,
      pixelRatio: diagnostics.pixelRatio,
      qualityTier: diagnostics.qualityTier,
      requestedLightingQuality: diagnostics.requestedLightingQuality,
      activeLightingQuality: diagnostics.activeLightingQuality,
      bloomEnabled: diagnostics.bloomEnabled,
      fullscreenPassCount: diagnostics.fullscreenPassCount,
      postProcessRenderCount: diagnostics.postProcessRenderCount,
      postProcessBypassCount: diagnostics.postProcessBypassCount,
      postProcessSampleCount: diagnostics.postProcessSampleCount,
      nearDetailLevel: diagnostics.nearDetailLevel,
      edgeDetailStrength: diagnostics.edgeDetailStrength,
      memoryGeometries: diagnostics.memory.geometries,
      memoryTextures: diagnostics.memory.textures,
      pointerMoveCount: diagnostics.pointerMoveCount,
      nativeInputReceivedCount: diagnostics.nativeInputReceivedCount,
      nativeInputLastSequence: diagnostics.nativeInputLastSequence,
      nativeInputRenderedSequence: diagnostics.nativeInputRenderedSequence,
      shadowRefreshCount: diagnostics.shadowRefreshCount,
      shadowTransformSyncCount: diagnostics.shadowTransformSyncCount,
      lightingUpdateCount: diagnostics.lightingUpdateCount,
      lightingSampledAtMs: diagnostics.lightingSampledAtMs,
      lightingFingerprint: diagnostics.lightingFingerprint,
      shadowDirection: diagnostics.shadowDirection,
      cloudBudgetMode: diagnostics.cloudBudgetMode,
      cloudBlockScale: diagnostics.cloudBlockScale,
      ambientDecorationCount: diagnostics.ambientDecorationCount,
      ambientDecorationKindCount: diagnostics.ambientDecorationKindCount,
      ambientDecorationDrawCalls: diagnostics.ambientDecorationDrawCalls,
      ambientDecorationAllocatedBatchCount: diagnostics.ambientDecorationAllocatedBatchCount,
      ambientDecorationShadowCasters: diagnostics.ambientDecorationShadowCasters,
      nativeInputTransport: diagnostics.nativeInputTransport,
    });
    console.info("[blockcolc-render-diagnostic]", payload);
    logNativeRenderDiagnostic(`[blockcolc-render-diagnostic] ${payload}`);
  }

  function logNativeRenderDiagnostic(message: string): void {
    try {
      const bridge = (window as unknown as {
        BlockcolcNativeInput?: { logRenderDiagnostic?: (value: string) => void };
      }).BlockcolcNativeInput;
      bridge?.logRenderDiagnostic?.(message);
    } catch { /* The native diagnostic bridge is optional on web. */ }
  }

  function interactionP95(): number | null {
    return percentile(interactionFrameDurations, 0.95);
  }

  function percentile(values: readonly number[], fraction: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
  }

  function clearLights(): void {
    localLightGroup.clear();
    localLights = [];
    glowSprites = [];
  }

  function clearGroup(group: THREE.Group, disposeAllMaterials = false): void {
    const disposedTextures = new Set<THREE.Texture>();
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object.userData.geometrySignature) {
          const owned = object.userData.ownedMaterial as THREE.MeshStandardMaterial | undefined;
          if (owned) {
            materialEffectPatches.delete(owned);
            materialEdgeStrengths.delete(owned);
          }
          disposeAtlasGeometryMeshResources(object);
          cutoutShadowMeshes.delete(object);
          return;
        }
        object.geometry.dispose();
        const alternateLodGeometry = object.userData.naturalDecorationAlternateGeometry as THREE.BufferGeometry | undefined;
        if (alternateLodGeometry && alternateLodGeometry !== object.geometry) alternateLodGeometry.dispose();
        if (disposeAllMaterials) {
          const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
          meshMaterials.forEach((entry) => entry.dispose());
        } else {
        const owned = object.userData.ownedMaterial as THREE.Material | undefined;
        if (owned) {
          materialEffectPatches.delete(owned as THREE.MeshStandardMaterial);
          materialEdgeStrengths.delete(owned as THREE.MeshStandardMaterial);
          owned.dispose();
        }
        const ownedDepth = object.userData.ownedDepthMaterial as THREE.MeshDepthMaterial | undefined;
        if (ownedDepth) disposeAtlasDepthMaterial(ownedDepth);
        cutoutShadowMeshes.delete(object);
        }
        const ownedTexture = object.userData.ownedTexture as THREE.Texture | undefined;
        if (ownedTexture && !disposedTextures.has(ownedTexture)) {
          disposedTextures.add(ownedTexture);
          ownedTexture.dispose();
        }
      });
    }
  }

  const contextLost = (event: Event): void => { event.preventDefault(); };
  const contextRestored = (): void => { resize(); };
  const visibilityChange = (): void => {
    if (document.hidden) precipitationViewCache = invalidatePrecipitationViewCache(precipitationViewCache);
    for (const controller of atlasAnimationControllers) controller?.setVisible(!document.hidden && paneVisible);
    syncPrecipitationMotionGate(performance.now());
    if (!document.hidden) { updateLighting(new Date()); updateWeather(localDateForDate(new Date())); }
    else if (lightingTransition) {
      lightingTransition = null;
      environmentTransitionCancelledCount += 1;
    }
    if (document.hidden && environmentReveal) finishEnvironmentReveal(true);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("lostpointercapture", pointerCancel);
  canvas.addEventListener("wheel", wheel, { passive: false });
  window.addEventListener("blur", windowBlur);
  if (options.subscribeNativeInput) {
    void options.subscribeNativeInput((sample) => {
      consumeNativeInput(sample);
      requestRender();
    }).then((unsubscribe) => {
      if (disposed) void unsubscribe();
      else nativeInputUnsubscribe = unsubscribe;
    }).catch(() => undefined);
  }
  document.addEventListener("visibilitychange", visibilityChange);
  applyQuality(qualityTier, false, true);
  updateLighting(new Date(), true);
  updateWeather(localDateForDate(new Date()), true);
  // A visible-only 30-second sample keeps the celestial path current without
  // adding a continuous render loop or background work.
  const lightingTimer = window.setInterval(() => {
    if (document.hidden || !paneVisible) return;
    const now = new Date();
    updateLighting(now);
    updateWeather(localDateForDate(now));
  }, 30_000);
  // Precipitation used to advance on this 100 ms pump (snow additionally every
  // 120 ms), making a nominally live storm look like an 8–10 fps slideshow.
  // The frame scheduler still coalesces requests and hidden/reduced-motion
  // paths pause the motion; visible weather can now present at ~30 fps.
  const ambientMotionTimer = window.setInterval(() => updateAmbientMotion(performance.now()), 32);
  resize();

  return {
    async initializeWorlds(worlds, pack) {
      const generation = ++resourcePackGeneration;
      await initializeWorldConfiguration(worlds, pack, {
        async prepare(selectedPack) {
          if (selectedPack === null) return { pack: null, atlas: null, controllers: [] as Array<AtlasAnimationController | null> };
          const requestedMaximum = options.resourcePackAtlasMaximumSize ?? 2048;
          const atlas = buildQualityLifecycleAtlas(
            selectedPack.manifest,
            Math.min(requestedMaximum, renderer.capabilities.maxTextureSize),
          );
          try {
            return { pack: { id: selectedPack.id, manifest: selectedPack.manifest }, atlas, controllers: animationControllersFor(atlas) };
          } catch (error) {
            disposeQualityLifecycleAtlas(atlas);
            throw error;
          }
        },
        isCurrent: () => !disposed && generation === resourcePackGeneration,
        capture: () => ({ worlds: lastWorlds, pack: activeResourcePack, controllers: atlasAnimationControllers }),
        commit(stagedWorlds, staged) {
          const previousWorlds = lastWorlds;
          lastWorlds = [...stagedWorlds];
          activeResourcePack = staged.atlas === null || staged.pack === null
            ? null
            : { ...staged.pack, atlas: staged.atlas };
          atlasAnimationControllers = staged.controllers;
          rebuild(worldsWithDebugDecay(lastWorlds), worldsWithDebugDecay(previousWorlds));
        },
        rollback(previous, staged) {
          lastWorlds = previous.worlds;
          activeResourcePack = previous.pack;
          atlasAnimationControllers = previous.controllers;
          try {
            rebuild(worldsWithDebugDecay(previous.worlds), worldsWithDebugDecay(previous.worlds));
          } catch {
            // Preserve the original failed commit; renderer references are already
            // restored so a later world update can rebuild from the prior state.
          }
          // The generic transaction owns staged disposal after rollback.
          void staged;
        },
        disposeStaged(staged) {
          for (const controller of staged.controllers) {
            try { controller?.dispose(); } catch { /* continue releasing staged resources */ }
          }
          try { disposeQualityLifecycleAtlas(staged.atlas); } catch { /* do not hide the original transaction result */ }
        },
        disposePrevious(previous) {
          for (const controller of previous.controllers) {
            try { controller?.dispose(); } catch { /* retire every prior controller */ }
          }
          try { disposeQualityLifecycleAtlas(previous.pack?.atlas); } catch { /* committed configuration remains active */ }
        },
      });
    },
    setWorld(world) {
      const previous = lastWorlds;
      lastWorlds = world === null ? [] : [world];
      rebuild(worldsWithDebugDecay(lastWorlds), worldsWithDebugDecay(previous));
    },
    setWorlds(worlds) {
      const previous = lastWorlds;
      lastWorlds = [...worlds];
      rebuild(worldsWithDebugDecay(lastWorlds), worldsWithDebugDecay(previous));
    },
    setExternalWeatherOverride(override) {
      if (disposed) return;
      externalWeatherOverride = override === null ? null : { ...override };
      updateWeather(localDateForDate(new Date()), true);
      beginLightingTransition();
      updateDiagnosticsDataset();
    },
    setAstronomyContext(context) {
      if (disposed) return;
      const previous = astronomyContext;
      const unchanged = previous === context || (previous !== null && context !== null
        && previous.coordinates.latitude === context.coordinates.latitude
        && previous.coordinates.longitude === context.coordinates.longitude
        && previous.locationSource === context.locationSource
        && previous.schedule?.fetchedAtMs === context.schedule?.fetchedAtMs);
      if (unchanged) return;
      astronomyContext = context === null ? null : {
        coordinates: { ...context.coordinates },
        locationSource: context.locationSource,
        schedule: context.schedule,
      };
      beginLightingTransition();
      canvas.dataset.astronomySource = astronomyContext
        ? astronomyDayAt(astronomyContext.schedule, Date.now()) ? "provider+ephemeris" : "ephemeris-only"
        : "synthetic";
      updateDiagnosticsDataset();
    },
    setEnvironmentDebugOverride(override) {
      if (disposed) return;
      const previousDecay = environmentDebugOverride?.decayAmount ?? null;
      environmentDebugOverride = override === null ? null : {
        ...override,
        date: override.date !== undefined && override.date !== null && Number.isFinite(override.date) ? override.date : null,
        decayAmount: override.decayAmount !== undefined && override.decayAmount !== null && Number.isFinite(override.decayAmount)
          ? THREE.MathUtils.clamp(override.decayAmount, 0, 1) : null,
        weather: override.weather ? { ...override.weather } : override.weather,
      };
      const nextDecay = environmentDebugOverride?.decayAmount ?? null;
      if (previousDecay !== nextDecay) {
        decayRevealRequested = true;
        rebuild(worldsWithDebugDecay(lastWorlds), worldsWithDebugDecay(lastWorlds));
      }
      updateWeather(localDateForDate(new Date()), true);
      beginLightingTransition();
      updateDiagnosticsDataset();
    },
    revealInitialProject(projectId) {
      return startOpeningReveal(projectId);
    },
    focusProject(projectId) {
      if (projectId === focusedProjectId) return;
      focusedProjectId = projectId;
      // Closing the memory panel no longer clears focus. Reaching null is an
      // explicit "reset map" action, so restore the settlement target and zoom
      // instead of preserving the former building as the orbit pivot.
      frameScene(true);
      requestRender();
    },
    async setResourcePack(pack) {
      const generation = ++resourcePackGeneration;
      if (pack === null) {
        // Initial boot has already built the untextured world. Treating an
        // already-null pack as a change used to rebuild the entire terrain a
        // second time before the first useful frame.
        if (activeResourcePack === null) return;
        const previous = activeResourcePack;
        const previousAnimations = atlasAnimationControllers;
        activeResourcePack = null;
        atlasAnimationControllers = [];
        rebuild(worldsWithDebugDecay(lastWorlds));
        for (const controller of previousAnimations) controller?.dispose();
        disposeQualityLifecycleAtlas(previous?.atlas);
        return;
      }
      const requestedMaximum = options.resourcePackAtlasMaximumSize ?? 2048;
      const atlas = buildQualityLifecycleAtlas(pack.manifest, Math.min(requestedMaximum, renderer.capabilities.maxTextureSize));
      if (disposed || generation !== resourcePackGeneration) {
        disposeQualityLifecycleAtlas(atlas);
        return;
      }
      const previous = activeResourcePack;
      const previousAnimations = atlasAnimationControllers;
      activeResourcePack = { id: pack.id, manifest: pack.manifest, atlas };
      atlasAnimationControllers = animationControllersFor(atlas);
      try {
        rebuild(worldsWithDebugDecay(lastWorlds));
      } catch (error) {
        for (const controller of atlasAnimationControllers) controller?.dispose();
        activeResourcePack = previous;
        atlasAnimationControllers = previousAnimations;
        disposeQualityLifecycleAtlas(atlas);
        rebuild(worldsWithDebugDecay(lastWorlds));
        throw error;
      }
      for (const controller of previousAnimations) controller?.dispose();
      disposeQualityLifecycleAtlas(previous?.atlas);
    },
    setLightingQuality(preference) {
      if (disposed || rendererContextIsLost()) {
        if (lifecycleProbeEnabled) qualityLifecycleProbe("quality-apply-end", {
          ...lifecycleIdentityMetrics(),
          requestedPreference: requestedLightingQuality, effectiveTier: qualityTier, status: "failed",
        });
        return false;
      }
      const attempt = attemptQualityProjection(
        { preference: requestedLightingQuality, tier: qualityTier },
        preference,
        resolveCappedQualityTier(deviceSignals(renderer, sceneVoxelCount), preference, adaptiveQualityCap),
        tier => {
          const previousPreference = requestedLightingQuality;
          requestedLightingQuality = preference;
          const succeeded = applyQuality(tier);
          if (!succeeded) {
            requestedLightingQuality = previousPreference;
            try { updateDiagnosticsDataset(); }
            catch (error) { console.error("Lighting quality failure retained the previous request, but diagnostics could not be refreshed", error); }
          }
          return succeeded;
        },
      );
      if (attempt.succeeded) {
        requestedLightingQuality = attempt.state.preference;
        // The effective tier can already match a newly selected preference
        // (for example auto -> balanced). Keep the public DOM diagnostics in
        // sync even though the renderer projection itself was a true no-op.
        try { updateDiagnosticsDataset(); }
        catch (error) { console.error("Lighting quality preference committed, but diagnostics could not be refreshed", error); }
      }
      return attempt.succeeded;
    },
    setReducedMotion(value) {
      if (reducedMotion !== value) precipitationViewCache = invalidatePrecipitationViewCache(precipitationViewCache);
      reducedMotion = value;
      syncPrecipitationMotionGate(performance.now());
      if (value && lightingTransition) {
        lightingTransition = null;
        environmentTransitionCancelledCount += 1;
        updateLighting(new Date());
      }
      if (value && environmentReveal) finishEnvironmentReveal(true);
      if (value) finishOpeningReveal("cancelled");
      for (const controller of atlasAnimationControllers) controller?.setReducedMotion(value);
      canvas.dataset.reducedMotion = String(value);
    },
    setVisible(value) {
      paneVisible = value;
      if (!value) precipitationViewCache = invalidatePrecipitationViewCache(precipitationViewCache);
      syncPrecipitationMotionGate(performance.now());
      if (!value) {
        if (lightingTransition) {
          lightingTransition = null;
          environmentTransitionCancelledCount += 1;
        }
        if (environmentReveal) finishEnvironmentReveal(true);
        finishOpeningReveal("cancelled");
      }
      for (const controller of atlasAnimationControllers) controller?.setVisible(!document.hidden && value);
      if (value) {
        updateLighting(new Date());
        updateWeather(localDateForDate(new Date()));
        resize();
      }
    },
    playConstructionPulse(strength = 1) {
      if (reducedMotion || disposed) return;
      constructionPulseStrength = Math.max(0.25, Math.min(1.5, strength));
      constructionPulseStartedMs = performance.now();
      constructionPulseUntilMs = constructionPulseStartedMs + 900;
      constructionPulseCount += 1;
      canvas.dataset.constructionPulseCount = String(constructionPulseCount);
      requestRender();
    },
    resetCamera: resetView,
    setImmersiveBandFraction(bottomFraction, rightFraction = 0) {
      const bottom = Number.isFinite(bottomFraction) ? Math.max(0, Math.min(0.75, bottomFraction)) : 0;
      const right = Number.isFinite(rightFraction) ? Math.max(0, Math.min(0.75, rightFraction)) : 0;
      canvas.dataset.immersiveBandFraction = bottom.toFixed(3);
      canvas.dataset.immersiveRightBandFraction = right.toFixed(3);
      if (bottom === immersiveBottomBand && right === immersiveRightBand) return;
      immersiveBottomBand = bottom;
      immersiveRightBand = right;
      updateCamera();
      requestRender();
    },
    resize,
    getDiagnostics,
    dispose() {
      disposed = true;
      terrainGenerationCache = null;
      if (lightingTransition) {
        lightingTransition = null;
        environmentTransitionCancelledCount += 1;
      }
      finishOpeningReveal("cancelled");
      if (environmentReveal) finishEnvironmentReveal(true);
      if (nativeInputUnsubscribe) void nativeInputUnsubscribe();
      resourcePackGeneration += 1;
      frameScheduler.dispose();
      for (const controller of atlasAnimationControllers) controller?.dispose();
      atlasAnimationControllers = [];
      window.clearInterval(lightingTimer);
      window.clearInterval(ambientMotionTimer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChange);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("lostpointercapture", pointerCancel);
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", windowBlur);
      clearGroup(buildingGroup);
      blockEntityDisplay.reset();
      clearGroup(terrainGroup);
      for (const texture of terrainPackTextures) texture.dispose();
      terrainPackTextures.length = 0;
      clearGroup(roadGroup);
      clearGroup(atmosphereGroup, true);
      lightingPostProcessor.dispose();
      skyGeometry.dispose();
      skyMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      sunSpriteMaterial.dispose();
      moonSpriteMaterial.dispose();
      for (const spriteMaterial of glowMaterials.values()) if (spriteMaterial !== glowMaterial) spriteMaterial.dispose();
      glowMaterial.dispose();
      glowTexture.dispose();
      clearLights();
      if (gpuTimerQuery && webGl2Context && gpuTimerExtension) {
        try { webGl2Context.endQuery(gpuTimerExtension.TIME_ELAPSED_EXT); } catch { /* The context may already be lost. */ }
        webGl2Context.deleteQuery(gpuTimerQuery);
        gpuTimerQuery = null;
      }
      renderer.dispose();
      materials.forEach((entry) => entry.dispose());
      originalMaterialTextures.forEach((entry) => entry.dispose());
      disposeQualityLifecycleAtlas(activeResourcePack?.atlas);
      activeResourcePack = null;
    },
  };
}

function deviceSignals(renderer: THREE.WebGLRenderer, voxelCount: number) {
  const deviceNavigator = navigator as Navigator & { deviceMemory?: number };
  return {
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: deviceNavigator.deviceMemory,
    maxTextureSize: renderer.capabilities.maxTextureSize,
    voxelCount,
  };
}

function farthestDistanceToBox(point: THREE.Vector3, bounds: THREE.Box3): number {
  const dx = Math.max(Math.abs(point.x - bounds.min.x), Math.abs(point.x - bounds.max.x));
  const dy = Math.max(Math.abs(point.y - bounds.min.y), Math.abs(point.y - bounds.max.y));
  const dz = Math.max(Math.abs(point.z - bounds.min.z), Math.abs(point.z - bounds.max.z));
  return Math.hypot(dx, dy, dz);
}

function emissiveColor(kind: string): number {
  return /soul/i.test(kind) ? 0x65cfe3 : /redstone/i.test(kind) ? 0xe94b35 : 0xffb45f;
}

function createLampGlowTexture(): THREE.DataTexture {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      // A soft square keeps the aura aligned with the voxel lamp instead of
      // reading as a spherical billboard floating over the building.
      const edgeDistance = Math.max(Math.abs(dx), Math.abs(dy));
      const falloff = Math.max(0, 1 - edgeDistance);
      const alpha = Math.round((falloff * falloff * (3 - 2 * falloff)) * 255);
      const offset = (y * size + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "blockcolc-local-lamp-glow-32";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createStarGeometry(count: number, radius: number): THREE.BufferGeometry {
  const random = seededRandom(0x5a17c9e3);
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const azimuth = random() * Math.PI * 2;
    const y = random() * 2 - 1;
    const horizontal = Math.sqrt(1 - y * y);
    positions[index * 3] = Math.cos(azimuth) * horizontal * radius;
    positions[index * 3 + 1] = y * radius;
    positions[index * 3 + 2] = Math.sin(azimuth) * horizontal * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, count);
  return geometry;
}

function updateSkyDomeColors(geometry: THREE.BufferGeometry, state: SunState, weatherTint: number | null, weatherBlend: number): void {
  const positions = geometry.getAttribute("position");
  const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
  const zenith = new THREE.Color(state.skyZenithColor);
  const horizon = new THREE.Color(state.skyHorizonColor);
  const lower = new THREE.Color(state.skyLowerColor);
  const tint = weatherTint === null ? null : new THREE.Color(weatherTint);
  const color = new THREE.Color();
  for (let index = 0; index < positions.count; index += 1) {
    const height = positions.getY(index) / SKY_RADIUS;
    if (height >= 0) color.copy(horizon).lerp(zenith, smoothstep01(height / 0.82));
    else color.copy(lower).lerp(horizon, smoothstep01((height + 0.72) / 0.72));
    if (tint) color.lerp(tint, weatherBlend);
    colors.setXYZ(index, color.r, color.g, color.b);
  }
  colors.needsUpdate = true;
}

function wrapCloudCoordinate(value: number, halfSpan: number): number {
  const radius = Math.max(1, Math.abs(halfSpan));
  const period = radius * 2;
  return ((value + radius) % period + period) % period - radius;
}

function setCelestialPosition(
  sprite: THREE.Sprite,
  direction: readonly [number, number, number],
  radius: number,
): void {
  const length = Math.max(1e-6, Math.hypot(direction[0], direction[1], direction[2]));
  sprite.position.set(direction[0] / length, direction[1] / length, direction[2] / length).multiplyScalar(radius);
}

const naturalPalette: Readonly<Record<NaturalDecorationKind, Readonly<Record<NaturalDecorationPart["palette"], number>>>> = {
  "flower": { base: 0x477345, secondary: 0x35613e, accent: 0xe8b86c },
  "grass-tuft": { base: 0x60864f, secondary: 0x497448, accent: 0x90a85c },
  "rock": { base: 0x777d79, secondary: 0x9a9c91, accent: 0xb7a689 },
  "reed": { base: 0x78885a, secondary: 0x596f4d, accent: 0xa3925b },
  "coral": { base: 0xd77a56, secondary: 0xb55b4a, accent: 0xf1bd80 },
  "red-shrub": { base: 0x8f6344, secondary: 0x6f4d38, accent: 0xb74d3e },
  "leaf-litter": { base: 0x9d6939, secondary: 0xb78945, accent: 0xc3944e },
  "shelf-mushroom": { base: 0x9c634a, secondary: 0xd8b990, accent: 0xb57e5c },
  "camp": { base: 0xc4a57b, secondary: 0x715b43, accent: 0xd77b43 },
  "shipwreck": { base: 0x75533a, secondary: 0x493c34, accent: 0xb0783c },
};

export function naturalDecorationRenderScale(kind: NaturalDecorationKind): number {
  switch (kind) {
    case "flower": return 3.8;
    case "grass-tuft": return 4.1;
    case "rock": return 2.8;
    case "reed": return 2.8;
    case "coral": return 2.7;
    case "red-shrub": return 3.2;
    case "leaf-litter": return 2.5;
    case "shelf-mushroom": return NATURAL_SHELF_MUSHROOM_RENDER_SCALE;
    case "camp": return 3.2;
    case "shipwreck": return 4.2;
  }
}

export function naturalDecorationOriginY(kind: NaturalDecorationKind, support: "ground" | "water" | "tree",
  supportY: number, minimumY: number, scale: number): number {
  if (support === "tree") return supportY;
  const surfaceY = supportY - 0.5;
  // Hull and water flora straddle the visible water surface, not its support datum.
  if (support === "water") {
    if (kind === "shipwreck") return surfaceY - 0.45 * scale;
    if (kind === "coral") return surfaceY - 0.62 * scale;
    if (kind === "reed") return surfaceY - 0.5 * scale;
    return surfaceY - minimumY * scale - 0.25 * scale;
  }
  return surfaceY - minimumY * scale;
}

export function naturalDecorationGeometry(kind: NaturalDecorationKind, lod: NaturalDecorationLod,
  colors: Readonly<Record<NaturalDecorationPart["palette"], number>> = naturalPalette[kind]): THREE.BufferGeometry {
  const positions: number[] = [];
  const vertexColors: number[] = [];
  for (const part of naturalDecorationParts(kind, lod)) {
    const indexed = new THREE.BoxGeometry(...part.size);
    const box = indexed.toNonIndexed();
    indexed.dispose();
    const transform = new THREE.Matrix4().makeRotationZ(part.rotationZ ?? 0)
      .multiply(new THREE.Matrix4().makeRotationY(part.rotationY ?? 0));
    transform.setPosition(...part.position);
    box.applyMatrix4(transform);
    const attribute = box.getAttribute("position");
    const color = new THREE.Color(colors[part.palette]);
    for (let index = 0; index < attribute.count; index += 1) {
      positions.push(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
      vertexColors.push(color.r, color.g, color.b);
    }
    box.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function smoothstep01(value: number): number {
  const amount = THREE.MathUtils.clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function interpolateSunState(from: SunState, to: SunState, amount: number): SunState {
  const t = THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 1, 0, 1);
  const scalarKeys = ["sunVisibility", "moonVisibility", "starVisibility", "intensity", "hemisphereIntensity",
    "exposure", "nightFactor", "directSunIntensity", "sunAzimuthDeg", "sunAltitudeDeg", "moonAzimuthDeg",
    "moonAltitudeDeg", "moonIllumination", "moonPhase", "moonBrightLimbAngleDeg"] as const;
  const result: SunState = { ...to,
    position: interpolateVector(from.position, to.position, t),
    sunPosition: interpolateVector(from.sunPosition, to.sunPosition, t),
    moonPosition: interpolateVector(from.moonPosition, to.moonPosition, t),
    phase: t < 0.5 ? from.phase : to.phase,
    color: interpolateColor(from.color, to.color, t),
    skyColor: interpolateColor(from.skyColor, to.skyColor, t),
    skyZenithColor: interpolateColor(from.skyZenithColor, to.skyZenithColor, t),
    skyHorizonColor: interpolateColor(from.skyHorizonColor, to.skyHorizonColor, t),
    skyLowerColor: interpolateColor(from.skyLowerColor, to.skyLowerColor, t),
    cloudColor: interpolateColor(from.cloudColor, to.cloudColor, t),
    fogColor: interpolateColor(from.fogColor, to.fogColor, t),
    hemisphereSkyColor: interpolateColor(from.hemisphereSkyColor, to.hemisphereSkyColor, t),
    hemisphereGroundColor: interpolateColor(from.hemisphereGroundColor, to.hemisphereGroundColor, t),
    moonWaxing: t < 0.5 ? from.moonWaxing : to.moonWaxing,
  };
  for (const key of scalarKeys) {
    const left = from[key];
    const right = to[key];
    if (typeof left === "number" && typeof right === "number") result[key] = left + (right - left) * t;
  }
  return result;
}

function interpolateVector(from: readonly [number, number, number], to: readonly [number, number, number], amount: number): readonly [number, number, number] {
  return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount, from[2] + (to[2] - from[2]) * amount];
}

function interpolateColor(from: number, to: number, amount: number): number {
  const t = THREE.MathUtils.clamp(amount, 0, 1);
  const channel = (shift: number) => Math.round(((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function celestialProjection(sprite: THREE.Sprite, camera: THREE.Camera): { x: number; y: number; inView: boolean } {
  const projected = sprite.getWorldPosition(new THREE.Vector3()).project(camera);
  return {
    x: projected.x,
    y: projected.y,
    inView: projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1,
  };
}

function hasTransformedFaceUv(entry: TexturedVoxelPlan): boolean {
  return entry.faceUvWordsA.some((word) => word !== DEFAULT_FACE_UV_WORDS[0])
    || entry.faceUvWordsB.some((word) => word !== DEFAULT_FACE_UV_WORDS[1]);
}

function defaultContentBounds(): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(-8, -2.5, -8), new THREE.Vector3(8, 8, 8));
}

function seededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
