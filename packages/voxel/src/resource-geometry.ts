import {
  isP1BlockGeometry,
  isP2BlockGeometry,
  mapBlockGeometryToAtlas,
  resolveBlockGeometry,
  type AtlasBlockGeometry,
  type AtlasGeometryFaceReference,
  type BlockFace,
  type ResourcePackManifest,
  type TextureAlphaMode,
} from "@tomato-clock/resource-pack";
import * as THREE from "three";
import type { BlueprintVoxel } from "./blueprint";
import {
  createLocalOcclusionField,
  faceOcclusionLevelsFor,
  packFaceOcclusionLevels,
  type LocalOcclusionField,
} from "./local-occlusion";
import { atlasShadowPolicy, disposeAtlasDepthMaterial, type AtlasShadowPolicy } from "./atlas-depth-material";
import {
  BLOCK_FACE_SLOTS,
  NO_FACE_TINT,
  faceTintKind,
  isStateTintKind,
  packFaceTintKinds,
  patchAtlasAnimationFragmentShader,
  patchAtlasTintFragmentShader,
  resolveBlockStateTint,
  type FaceTileIndices,
  type FaceTintKind,
  type FaceTintKinds,
  type ResourcePackAtlas,
  type ResourcePackAtlasPage,
} from "./resource-textures";
import { createVisualBiomePalette } from "./visual-biome";
import { materialResponse, materialResponseCode, materialResponseForVoxel, type MaterialResponseKind } from "./material-response";

export interface AtlasGeometryQuad {
  face: BlockFace;
  positions: readonly [number, number, number, number, number, number, number, number, number, number, number, number];
  normal: readonly [number, number, number];
  bakedUvs: readonly [number, number, number, number, number, number, number, number];
  slot: number;
  faceOcclusionSlot: number;
  shadeFactor: number;
  shade: boolean;
  cullFace?: BlockFace;
}

export interface AtlasGeometryTopology {
  signature: string;
  canonicalPayload: string;
  elementCount: number;
  textureSlotCount: number;
  quads: readonly AtlasGeometryQuad[];
}

export interface GeometryVoxelPlan {
  voxel: BlueprintVoxel;
  page: number;
  topology: AtlasGeometryTopology;
  faceTiles: FaceTileIndices;
  faceTintWord: number;
  /** State-dependent vanilla tint resolved per voxel and uniform batch. */
  stateTintRgb?: number;
  /** Local occlusion is separate from tint so extended tint classes remain exact in Float32. */
  faceOcclusionWord?: number;
  alphaMode: TextureAlphaMode;
}

export interface GeometryVoxelBatch {
  key: string;
  page: number;
  signature: string;
  topology: AtlasGeometryTopology;
  alphaMode: TextureAlphaMode;
  emissiveKind: string;
  emissiveLevel: number;
  stateTintRgb?: number;
  entries: GeometryVoxelPlan[];
}

const alphaRank: Record<TextureAlphaMode, number> = { opaque: 0, cutout: 1, translucent: 2 };
/** Soft draw-call target for imported geometry; crossing it is diagnostic, not a reason to cube valid models. */
export const MAX_GEOMETRY_BATCHES = 64;

export interface GeometryBatchBudget {
  /** Recommended per-scene draw-call target. */
  target: number;
  /** Actual topology/material batches returned for this scene. */
  actual: number;
  /** Number of batches above the target; zero means the target was met. */
  overTarget: number;
}

export interface GeometryBatchPlanningResult {
  batches: GeometryVoxelBatch[];
  fallbackVoxels: BlueprintVoxel[];
  /** Exposes performance pressure while keeping every valid model on the geometry path. */
  batchBudget: GeometryBatchBudget;
}

export function isP1GeometryBlock(
  sourceBlockId: string,
  sourceBlockState: Readonly<Record<string, string>> = {},
): boolean {
  return isP1BlockGeometry(sourceBlockId, sourceBlockState);
}

/** Frozen V3 P2 multipart families. Matching connections are supplied by the
 * imported block state and resolved by resource-pack; the renderer never
 * infers missing neighbours. */
export function isP2GeometryBlock(sourceBlockId: string): boolean {
  return isP2BlockGeometry(sourceBlockId);
}

export function isSupportedGeometryBlock(
  sourceBlockId: string,
  sourceBlockState: Readonly<Record<string, string>> = {},
): boolean {
  return isP1GeometryBlock(sourceBlockId, sourceBlockState) || isP2GeometryBlock(sourceBlockId);
}

export function planGeometryVoxel(
  voxel: BlueprintVoxel,
  manifest: ResourcePackManifest,
  atlas: ResourcePackAtlas,
): GeometryVoxelPlan | undefined {
  const plans = planGeometryVoxelPages(voxel, manifest, atlas);
  return plans?.length === 1 ? plans[0] : undefined;
}

export function planGeometryVoxelPages(
  voxel: BlueprintVoxel,
  manifest: ResourcePackManifest,
  atlas: ResourcePackAtlas,
): GeometryVoxelPlan[] | undefined {
  if (!voxel.sourceBlockId || atlas.pages.length === 0) return undefined;
  const resolved = resolveBlockGeometry(manifest, voxel.sourceBlockId, voxel.sourceBlockState, voxel);
  const mapped = mapBlockGeometryToAtlas(resolved, atlas.source);
  if (mapped.status !== "resolved_geometry") return undefined;
  for (const element of mapped.elements) {
    for (const reference of Object.values(element.faces)) {
      if (reference && !atlas.pages[reference.page]) return undefined;
    }
  }
  return compileMappedGeometryVoxelPages(voxel, mapped);
}

export function compileMappedGeometryVoxel(
  voxel: BlueprintVoxel,
  mapped: AtlasBlockGeometry,
): GeometryVoxelPlan | undefined {
  const plans = compileMappedGeometryVoxelPages(voxel, mapped);
  return plans?.length === 1 ? plans[0] : undefined;
}

export function compileMappedGeometryVoxelPages(
  voxel: BlueprintVoxel,
  mapped: AtlasBlockGeometry,
): GeometryVoxelPlan[] | undefined {
  if (!voxel.sourceBlockId || mapped.elements.length === 0) return undefined;
  const stateTint = resolveBlockStateTint(voxel.sourceBlockId, voxel.sourceBlockState);
  const references: Array<{ page: number; face: BlockFace; element: AtlasBlockGeometry["elements"][number]; reference: AtlasGeometryFaceReference; tintKind: FaceTintKind }> = [];
  for (const element of mapped.elements) {
    for (const face of BLOCK_FACE_SLOTS) {
      const reference = element.faces[face];
      if (!reference) continue;
      if (!elementFaceHasArea(element.from, element.to, face)) continue;
      const tintKind = faceTintKind(voxel.sourceBlockId, reference.tintIndex);
      if (tintKind === undefined) return undefined;
      references.push({ page: reference.page, face, element, reference, tintKind });
    }
  }
  if (references.length === 0) return undefined;
  const hasStateTint = references.some((reference) => isStateTintKind(reference.tintKind));
  if (hasStateTint && stateTint.status !== "resolved") return undefined;
  const pages = new Map<number, typeof references>();
  for (const item of references) {
    const pageReferences = pages.get(item.page) ?? [];
    pageReferences.push(item);
    pages.set(item.page, pageReferences);
  }
  const plans: GeometryVoxelPlan[] = [];
  for (const [page, pageReferences] of [...pages.entries()].sort(([left], [right]) => left - right)) {
    let slots = new Map<string, number>();
    let tileValues: number[] = [];
    let tintValues: FaceTintKind[] = [];
    let quads: AtlasGeometryQuad[] = [];
    let planElements = new Set<AtlasBlockGeometry["elements"][number]>();
    let alphaMode: TextureAlphaMode = "opaque";
    const flushPlan = () => {
      if (quads.length === 0) return;
      while (tileValues.length < 6) tileValues.push(0);
      while (tintValues.length < 6) tintValues.push(NO_FACE_TINT);
      const canonicalPayload = geometryCanonicalPayload(quads);
      plans.push({
        voxel,
        page,
        topology: {
          signature: geometrySignature(canonicalPayload),
          canonicalPayload,
          elementCount: planElements.size,
          textureSlotCount: slots.size,
          quads,
        },
        faceTiles: tileValues as unknown as FaceTileIndices,
        faceTintWord: packFaceTintKinds(tintValues as unknown as FaceTintKinds),
        ...(pageReferences.some(({ tintKind }) => isStateTintKind(tintKind)) && stateTint.status === "resolved"
          ? { stateTintRgb: stateTint.rgb }
          : {}),
        alphaMode,
      });
      slots = new Map<string, number>();
      tileValues = [];
      tintValues = [];
      quads = [];
      planElements = new Set<AtlasBlockGeometry["elements"][number]>();
      alphaMode = "opaque";
    };
    for (const { face, element, reference, tintKind } of pageReferences) {
      const slotKey = `${reference.textureIndex}|${tintKind}`;
      let slot = slots.get(slotKey);
      if (slot === undefined) {
        if (slots.size === 6) flushPlan();
        slot = slots.size;
        slots.set(slotKey, slot);
        tileValues.push(reference.textureIndex);
        tintValues.push(tintKind);
      }
      const positions = facePositions(face, element.from, element.to);
      const preserveModelSpaceFace = element.rotation === undefined
        && element.blockRotation !== undefined
        && (element.blockRotation.x !== 0 || element.blockRotation.y !== 0);
      const targetFace = preserveModelSpaceFace ? rotateGeometryFace(face, element.blockRotation!) : face;
      const localShadeDirection = element.shadeDirectionOverride ?? (element.shade ? face : "up");
      const shadeDirection = preserveModelSpaceFace && element.shade
        ? rotateGeometryFace(localShadeDirection, element.blockRotation!)
        : localShadeDirection;
      quads.push({
        face: targetFace,
        positions: transformGeometryPositions(positions, element.rotation, element.blockRotation),
        normal: transformGeometryNormal(windingNormal(positions, face), element.rotation, element.blockRotation),
        bakedUvs: bakedFaceUvs(face, element.from, element.to, reference),
        slot,
        faceOcclusionSlot: BLOCK_FACE_SLOTS.indexOf(targetFace),
        shadeFactor: directionalShadeFactor(shadeDirection),
        shade: element.shade,
        ...(reference.cullFace === undefined ? {} : { cullFace: reference.cullFace }),
      });
      planElements.add(element);
      if (alphaRank[reference.alphaMode] > alphaRank[alphaMode]) alphaMode = reference.alphaMode;
    }
    flushPlan();
  }
  return plans;
}

function elementFaceHasArea(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  face: BlockFace,
): boolean {
  if (face === "down" || face === "up") return from[0] !== to[0] && from[2] !== to[2];
  if (face === "north" || face === "south") return from[0] !== to[0] && from[1] !== to[1];
  return from[1] !== to[1] && from[2] !== to[2];
}

export function createGeometryBatches(
  voxels: readonly BlueprintVoxel[],
  manifest: ResourcePackManifest,
  atlas: ResourcePackAtlas,
  occlusionField: LocalOcclusionField = createLocalOcclusionField(voxels),
): GeometryBatchPlanningResult {
  const fallbackVoxels: BlueprintVoxel[] = [];
  const cache = new Map<string, GeometryVoxelPlan[] | null>();
  // Position-weighted variants are resolved with the 26.3 block seed. Reusing
  // a block/state template across coordinates would freeze every random shape
  // to the first block; keep the fast shared cache for all single-choice IDs.
  const positionVariantIds = new Set(manifest.blockStates
    .filter((blockState) => blockState.variants.some((variant) => variant.choices.length > 1)
      || blockState.multipart?.some((part) => part.apply.length > 1))
    .map((blockState) => blockState.resourceId));
  const groups = new Map<string, GeometryVoxelBatch>();
  for (const voxel of voxels) {
    const positionKey = positionVariantIds.has(voxel.sourceBlockId ?? "")
      && [voxel.x, voxel.y, voxel.z].every((coordinate) => Number.isInteger(coordinate)
        && coordinate >= -0x80000000 && coordinate <= 0x7fffffff)
      ? `@${voxel.x}:${voxel.y}:${voxel.z}` : "";
    const cacheKey = `${geometryVoxelCacheKey(voxel)}${positionKey}`;
    let template = cache.get(cacheKey);
    if (template === undefined) {
      template = planGeometryVoxelPages(voxel, manifest, atlas) ?? null;
      cache.set(cacheKey, template);
    }
    if (!template) {
      fallbackVoxels.push(voxel);
      continue;
    }
    const levels = faceOcclusionLevelsFor(voxel, occlusionField);
    for (const plan of template) {
      appendGeometryPlan(groups, {
        ...plan,
        voxel,
        faceOcclusionWord: packFaceOcclusionLevels(levels),
      });
    }
  }
  const batches = [...groups.values()].sort((left, right) => compareText(left.key, right.key));
  return {
    batches,
    fallbackVoxels,
    batchBudget: {
      target: MAX_GEOMETRY_BATCHES,
      actual: batches.length,
      overTarget: Math.max(0, batches.length - MAX_GEOMETRY_BATCHES),
    },
  };
}

export function batchGeometryPlans(plans: readonly GeometryVoxelPlan[]): GeometryVoxelBatch[] {
  const groups = new Map<string, GeometryVoxelBatch>();
  for (const plan of plans) appendGeometryPlan(groups, plan);
  return [...groups.values()].sort((left, right) => compareText(left.key, right.key));
}

function appendGeometryPlan(groups: Map<string, GeometryVoxelBatch>, plan: GeometryVoxelPlan): void {
  const emissiveKind = plan.voxel.emissiveKind ?? "";
  const emissiveLevel = plan.voxel.emissiveLevel ?? 0;
  const key = geometryBatchKey(plan);
  let batch = groups.get(key);
  if (!batch) {
    batch = {
      key,
      page: plan.page,
      signature: plan.topology.signature,
      topology: plan.topology,
      alphaMode: plan.alphaMode,
      emissiveKind,
      emissiveLevel,
      ...(plan.stateTintRgb === undefined ? {} : { stateTintRgb: plan.stateTintRgb }),
      entries: [],
    };
    groups.set(key, batch);
  }
  batch.entries.push(plan);
}

function geometryBatchKey(plan: GeometryVoxelPlan): string {
  const emissiveKind = plan.voxel.emissiveKind ?? "";
  const emissiveLevel = plan.voxel.emissiveLevel ?? 0;
  const tintKey = plan.stateTintRgb === undefined ? "" : plan.stateTintRgb.toString(16).padStart(6, "0");
  return `${plan.page}|${plan.topology.signature}|${plan.topology.canonicalPayload}|${plan.alphaMode}|${emissiveKind}|${emissiveLevel}|${tintKey}`;
}

export function createAtlasGeometry(batch: GeometryVoxelBatch): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const faceSlots: number[] = [];
  const faceOcclusionSlots: number[] = [];
  const shadeFactors: number[] = [];
  const indices: number[] = [];
  for (const quad of batch.topology.quads) {
    const base = positions.length / 3;
    positions.push(...quad.positions.map((value) => ((value / 16) - 0.5) * 0.97));
    const normal = quad.normal;
    for (let vertex = 0; vertex < 4; vertex += 1) {
      normals.push(...normal);
      faceSlots.push(quad.slot);
      faceOcclusionSlots.push(quad.faceOcclusionSlot);
      shadeFactors.push(quad.shadeFactor);
    }
    uvs.push(...quad.bakedUvs);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = `blockcolc-geometry-${batch.signature}`;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("faceSlot", new THREE.Float32BufferAttribute(faceSlots, 1));
  geometry.setAttribute("faceOcclusionSlot", new THREE.Float32BufferAttribute(faceOcclusionSlots, 1));
  geometry.setAttribute("faceShadeFactor", new THREE.Float32BufferAttribute(shadeFactors, 1));
  geometry.setIndex(indices);

  const tileA = new Float32Array(batch.entries.length * 3);
  const tileB = new Float32Array(batch.entries.length * 3);
  const tintKinds = new Float32Array(batch.entries.length);
  const faceOcclusion = new Float32Array(batch.entries.length);
  const materialResponses = new Float32Array(batch.entries.length);
  batch.entries.forEach((entry, index) => {
    tileA.set(entry.faceTiles.slice(0, 3), index * 3);
    tileB.set(entry.faceTiles.slice(3, 6), index * 3);
    tintKinds[index] = entry.faceTintWord;
    faceOcclusion[index] = entry.faceOcclusionWord ?? 0;
    materialResponses[index] = materialResponseCode(materialResponseForVoxel(entry.voxel));
  });
  geometry.setAttribute("instanceFaceTilesA", new THREE.InstancedBufferAttribute(tileA, 3));
  geometry.setAttribute("instanceFaceTilesB", new THREE.InstancedBufferAttribute(tileB, 3));
  geometry.setAttribute("instanceFaceTintKinds", new THREE.InstancedBufferAttribute(tintKinds, 1));
  geometry.setAttribute("instanceFaceOcclusion", new THREE.InstancedBufferAttribute(faceOcclusion, 1));
  geometry.setAttribute("instanceMaterialResponse", new THREE.InstancedBufferAttribute(materialResponses, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.blockcolcGeometrySignature = batch.signature;
  return geometry;
}

export function createAtlasGeometryMaterial(
  page: ResourcePackAtlasPage,
  alphaMode: TextureAlphaMode,
  responseKind: MaterialResponseKind = alphaMode === "translucent" ? "glass" : "default",
  stateTintRgb?: number,
): THREE.MeshStandardMaterial {
  const response = materialResponse(responseKind);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: page.texture,
    roughness: response.roughness,
    metalness: response.metalness,
    transparent: alphaMode === "translucent",
    opacity: 1,
    depthWrite: alphaMode !== "translucent",
    alphaTest: alphaMode === "cutout" ? 0.5 : 0,
  });
  material.name = `blockcolc-atlas-geometry-${alphaMode}-${responseKind}`;
  material.customProgramCacheKey = () => `blockcolc-atlas-geometry-v3-${alphaMode}-${page.animationLookup ? "animated" : "static"}`;
  material.onBeforeCompile = (shader) => {
    installGeometryAtlasUniforms(shader, page, stateTintRgb);
    shader.vertexShader = patchAtlasGeometryVertexShader(shader.vertexShader, page.animationLookup !== undefined);
    shader.fragmentShader = patchAtlasTintFragmentShader(shader.fragmentShader);
    shader.fragmentShader = patchAtlasAnimationFragmentShader(shader.fragmentShader, page.animationLookup !== undefined);
  };
  return material;
}

/** Applies the same intentionally unsorted translucent policy as the cube
 * atlas path. Geometry panes receive scene shadows but never cast them. */
export function applyGeometryMeshRenderPolicy(
  mesh: THREE.Mesh,
  alphaMode: TextureAlphaMode,
  cutoutShadowsEnabled: boolean,
): AtlasShadowPolicy {
  const shadowPolicy = atlasShadowPolicy(alphaMode);
  mesh.castShadow = shadowPolicy.castShadow && (alphaMode !== "cutout" || cutoutShadowsEnabled);
  mesh.receiveShadow = true;
  mesh.renderOrder = alphaMode === "translucent" ? 10 : 0;
  return shadowPolicy;
}

export function createAtlasGeometryCutoutDepthMaterial(page: ResourcePackAtlasPage, alphaTest = 0.5): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ map: page.texture, alphaTest });
  material.name = "blockcolc-atlas-geometry-cutout-depth";
  material.customProgramCacheKey = () => `blockcolc-atlas-geometry-depth-v3-${page.animationLookup ? "animated" : "static"}`;
  material.onBeforeCompile = (shader) => {
    installGeometryAtlasUniforms(shader, page);
    shader.vertexShader = patchAtlasGeometryVertexShader(shader.vertexShader, page.animationLookup !== undefined);
    shader.fragmentShader = patchAtlasAnimationFragmentShader(shader.fragmentShader, page.animationLookup !== undefined);
  };
  return material;
}

export function disposeAtlasGeometryMeshResources(mesh: THREE.Mesh): void {
  if (mesh.userData.blockcolcGeometryDisposed === true) return;
  mesh.userData.blockcolcGeometryDisposed = true;
  mesh.geometry.dispose();
  const ownedMaterial = mesh.userData.ownedMaterial as THREE.Material | undefined;
  ownedMaterial?.dispose();
  const ownedDepth = mesh.userData.ownedDepthMaterial as THREE.MeshDepthMaterial | undefined;
  if (ownedDepth) disposeAtlasDepthMaterial(ownedDepth);
}

export function patchAtlasGeometryVertexShader(vertexShader: string, animated = false): string {
  const animationDeclarations = animated
    ? "\nuniform sampler2D blockcolcAnimationLookup;\nuniform sampler2D blockcolcAnimationBlendLookup;\nuniform vec2 blockcolcAnimationLookupSize;\nvarying vec2 vBlockcolcNextMapUv;\nvarying float vBlockcolcAnimationMix;"
    : "";
  const animationSampling = animated
    ? "\nfloat blockcolcLookupX = mod(blockcolcTile, blockcolcAnimationLookupSize.x);\nfloat blockcolcLookupY = floor(blockcolcTile / blockcolcAnimationLookupSize.x);\nvec2 blockcolcLookupUv = (vec2(blockcolcLookupX, blockcolcLookupY) + vec2(0.5)) / blockcolcAnimationLookupSize;\nvec4 blockcolcAnimatedTile = texture2D(blockcolcAnimationLookup, blockcolcLookupUv);\nvec4 blockcolcAnimationBlend = texture2D(blockcolcAnimationBlendLookup, blockcolcLookupUv);\nblockcolcTile = floor(blockcolcAnimatedTile.r * 255.0 + 0.5) + floor(blockcolcAnimatedTile.g * 255.0 + 0.5) * 256.0;\nfloat blockcolcNextTile = floor(blockcolcAnimatedTile.b * 255.0 + 0.5) + floor(blockcolcAnimatedTile.a * 255.0 + 0.5) * 256.0;\nvBlockcolcAnimationMix = blockcolcAnimationBlend.r;"
    : "\nfloat blockcolcNextTile = blockcolcTile;";
  return vertexShader
    .replace(
      "#include <common>",
      `#include <common>\nattribute float faceSlot;\nattribute float faceOcclusionSlot;\nattribute float faceShadeFactor;\nattribute vec3 instanceFaceTilesA;\nattribute vec3 instanceFaceTilesB;\nattribute float instanceFaceTintKinds;\nattribute float instanceFaceOcclusion;\nuniform vec2 blockcolcAtlasSize;\nuniform float blockcolcAtlasColumns;\nuniform float blockcolcAtlasCellSize;\nuniform float blockcolcAtlasPadding;\nuniform vec3 blockcolcFoliageTint;\nuniform vec3 blockcolcGrassTint;\nuniform vec3 blockcolcWaterTint;\nuniform vec3 blockcolcDryFoliageTint;\nuniform vec3 blockcolcSpruceLeavesTint;\nuniform vec3 blockcolcBirchLeavesTint;\nuniform vec3 blockcolcLilyPadTint;\nvarying vec3 vBlockcolcTint;\nvarying float vBlockcolcLocalOcclusion;\nvarying float vBlockcolcDirectionalShade;${animationDeclarations}`,
    )
    .replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>\nfloat blockcolcTile = faceSlot < 0.5 ? instanceFaceTilesA.x : faceSlot < 1.5 ? instanceFaceTilesA.y : faceSlot < 2.5 ? instanceFaceTilesA.z : faceSlot < 3.5 ? instanceFaceTilesB.x : faceSlot < 4.5 ? instanceFaceTilesB.y : instanceFaceTilesB.z;${animationSampling}\nfloat blockcolcTintDivisor = faceSlot < 0.5 ? 1.0 : faceSlot < 1.5 ? 16.0 : faceSlot < 2.5 ? 256.0 : faceSlot < 3.5 ? 4096.0 : faceSlot < 4.5 ? 65536.0 : 1048576.0;\nfloat blockcolcTintKind = mod(floor(instanceFaceTintKinds / blockcolcTintDivisor), 16.0);\nvBlockcolcTint = blockcolcTintKind < 0.5 ? vec3(1.0) : blockcolcTintKind < 1.5 ? blockcolcFoliageTint : blockcolcTintKind < 2.5 ? blockcolcGrassTint : blockcolcTintKind < 3.5 ? blockcolcWaterTint : blockcolcTintKind < 4.5 ? blockcolcDryFoliageTint : blockcolcTintKind < 5.5 ? blockcolcSpruceLeavesTint : blockcolcTintKind < 6.5 ? blockcolcBirchLeavesTint : blockcolcTintKind < 7.5 ? blockcolcLilyPadTint : vec3(1.0);\nfloat blockcolcOcclusionDivisor = faceOcclusionSlot < 0.5 ? 1.0 : faceOcclusionSlot < 1.5 ? 4.0 : faceOcclusionSlot < 2.5 ? 16.0 : faceOcclusionSlot < 3.5 ? 64.0 : faceOcclusionSlot < 4.5 ? 256.0 : 1024.0;\nvBlockcolcLocalOcclusion = mod(floor(instanceFaceOcclusion / blockcolcOcclusionDivisor), 4.0) / 3.0;\nvBlockcolcDirectionalShade = faceShadeFactor;\nfloat blockcolcColumn = mod(blockcolcTile, blockcolcAtlasColumns);\nfloat blockcolcRow = floor(blockcolcTile / blockcolcAtlasColumns);\nfloat blockcolcNextColumn = mod(blockcolcNextTile, blockcolcAtlasColumns);\nfloat blockcolcNextRow = floor(blockcolcNextTile / blockcolcAtlasColumns);\nvec2 blockcolcPixelUv = vMapUv * (blockcolcAtlasCellSize - 2.0 * blockcolcAtlasPadding);\nvMapUv = (vec2(blockcolcColumn, blockcolcRow) * blockcolcAtlasCellSize + vec2(blockcolcAtlasPadding) + blockcolcPixelUv) / blockcolcAtlasSize;\n${animated ? "vBlockcolcNextMapUv = (vec2(blockcolcNextColumn, blockcolcNextRow) * blockcolcAtlasCellSize + vec2(blockcolcAtlasPadding) + blockcolcPixelUv) / blockcolcAtlasSize;" : ""}`,
    )
    .replace("attribute float instanceFaceOcclusion;", "attribute float instanceFaceOcclusion;\nattribute float instanceMaterialResponse;")
    .replace("varying float vBlockcolcDirectionalShade;", "varying float vBlockcolcDirectionalShade;\nvarying float vBlockcolcMaterialResponse;")
    .replace("#include <uv_vertex>\n", "#include <uv_vertex>\nvBlockcolcMaterialResponse = instanceMaterialResponse;\n")
    .replace("uniform vec3 blockcolcLilyPadTint;", "uniform vec3 blockcolcLilyPadTint;\nuniform vec3 blockcolcStateTint;")
    .replace(
      ": blockcolcTintKind < 7.5 ? blockcolcLilyPadTint : vec3(1.0);",
      ": blockcolcTintKind < 7.5 ? blockcolcLilyPadTint : blockcolcTintKind < 10.5 ? blockcolcStateTint : vec3(1.0);",
    );
}

function installGeometryAtlasUniforms(
  shader: THREE.WebGLProgramParametersWithUniforms,
  page: ResourcePackAtlasPage,
  stateTintRgb?: number,
): void {
  shader.uniforms.blockcolcAtlasSize = { value: new THREE.Vector2(page.width, page.height) };
  shader.uniforms.blockcolcAtlasColumns = { value: page.columns };
  shader.uniforms.blockcolcAtlasCellSize = { value: page.cellSize };
  shader.uniforms.blockcolcAtlasPadding = { value: page.padding };
  const visualBiomePalette = page.visualBiomePalette ?? createVisualBiomePalette([]);
  shader.uniforms.blockcolcFoliageTint = { value: new THREE.Color(visualBiomePalette.foliage) };
  shader.uniforms.blockcolcGrassTint = { value: new THREE.Color(visualBiomePalette.grass) };
  shader.uniforms.blockcolcWaterTint = { value: new THREE.Color(visualBiomePalette.water) };
  shader.uniforms.blockcolcDryFoliageTint = { value: new THREE.Color(visualBiomePalette.dryFoliage) };
  shader.uniforms.blockcolcSpruceLeavesTint = { value: new THREE.Color(visualBiomePalette.spruceLeaves) };
  shader.uniforms.blockcolcBirchLeavesTint = { value: new THREE.Color(visualBiomePalette.birchLeaves) };
  shader.uniforms.blockcolcLilyPadTint = { value: new THREE.Color(visualBiomePalette.lilyPad) };
  shader.uniforms.blockcolcStateTint = { value: new THREE.Color(stateTintRgb ?? 0xffffff) };
  if (page.animationLookup) {
    shader.uniforms.blockcolcAnimationLookup = { value: page.animationLookup.texture };
    shader.uniforms.blockcolcAnimationBlendLookup = { value: page.animationLookup.blendTexture };
    shader.uniforms.blockcolcAnimationLookupSize = { value: new THREE.Vector2(page.animationLookup.width, page.animationLookup.height) };
  }
}

function geometryCanonicalPayload(quads: readonly AtlasGeometryQuad[]): string {
  const payload = quads.map((quad) => ({
    face: quad.face,
    positions: quad.positions.map(canonicalNumber),
    normal: quad.normal.map(canonicalNumber),
    bakedUvs: quad.bakedUvs.map(canonicalNumber),
    slot: quad.slot,
    faceOcclusionSlot: quad.faceOcclusionSlot,
    shadeFactor: canonicalNumber(quad.shadeFactor),
    shade: quad.shade,
    cullFace: quad.cullFace ?? "",
  }));
  return JSON.stringify(payload);
}

function geometrySignature(canonicalPayload: string): string {
  return `geo:${stableHash(canonicalPayload, 0x811c9dc5)}${stableHash(canonicalPayload, 0x9e3779b9)}`;
}

function bakedFaceUvs(
  face: BlockFace,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  reference: AtlasGeometryFaceReference,
): AtlasGeometryQuad["bakedUvs"] {
  const positions = facePositions(face, from, to);
  const output: number[] = [];
  for (let vertex = 0; vertex < 4; vertex += 1) {
    const point = positions.slice(vertex * 3, vertex * 3 + 3) as [number, number, number];
    const local = localFaceUv(face, point, from, to);
    const rotated = rotateLocalUv(local, reference.rotation);
    const pixel = croppedPixelUv(reference.cropUv, rotated);
    output.push(pixel[0] / 16, pixel[1] / 16);
  }
  return output as unknown as AtlasGeometryQuad["bakedUvs"];
}

function croppedPixelUv(
  crop: readonly [number, number, number, number],
  local: readonly [number, number],
): readonly [number, number] {
  const start = [crop[0] * 16, crop[1] * 16] as const;
  const delta = [(crop[2] - crop[0]) * 16, (crop[3] - crop[1]) * 16] as const;
  return [0, 1].map((axis) => {
    const absolute = Math.abs(delta[axis]!);
    const direction = delta[axis]! < 0 ? -1 : 1;
    const inset = Math.min(0.5, absolute * 0.5);
    const span = Math.max(absolute - 1, 0);
    return start[axis]! + direction * (inset + local[axis]! * span);
  }) as unknown as readonly [number, number];
}

function rotateLocalUv(local: readonly [number, number], rotation: 0 | 90 | 180 | 270): readonly [number, number] {
  if (rotation === 90) return [local[1], 1 - local[0]];
  if (rotation === 180) return [1 - local[0], 1 - local[1]];
  if (rotation === 270) return [1 - local[1], local[0]];
  return local;
}

function localFaceUv(
  face: BlockFace,
  point: readonly [number, number, number],
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): readonly [number, number] {
  const x = ratio(point[0], from[0], to[0]);
  const y = ratio(point[1], from[1], to[1]);
  const z = ratio(point[2], from[2], to[2]);
  switch (face) {
    case "down": return [x, 1 - z];
    case "up": return [x, z];
    case "north": return [1 - x, 1 - y];
    case "south": return [x, 1 - y];
    case "west": return [z, 1 - y];
    case "east": return [1 - z, 1 - y];
  }
}

function facePositions(
  face: BlockFace,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): AtlasGeometryQuad["positions"] {
  const [x0, y0, z0] = from;
  const [x1, y1, z1] = to;
  switch (face) {
    case "down": return [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1];
    case "up": return [x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0];
    case "north": return [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0];
    case "south": return [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
    case "west": return [x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0];
    case "east": return [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1];
  }
}

function transformGeometryPositions(
  positions: AtlasGeometryQuad["positions"],
  rotation: AtlasBlockGeometry["elements"][number]["rotation"],
  blockRotation: AtlasBlockGeometry["elements"][number]["blockRotation"],
): AtlasGeometryQuad["positions"] {
  const output: number[] = [];
  for (let vertex = 0; vertex < 4; vertex += 1) {
    const point = transformGeometryPoint(
      [positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!],
      rotation,
      blockRotation,
    );
    output.push(...point);
  }
  return output as unknown as AtlasGeometryQuad["positions"];
}

function transformGeometryPoint(
  point: readonly [number, number, number],
  rotation: AtlasBlockGeometry["elements"][number]["rotation"],
  blockRotation: AtlasBlockGeometry["elements"][number]["blockRotation"],
): readonly [number, number, number] {
  let output = point;
  if (rotation !== undefined) {
    let relative = subtractVector(output, rotation.origin);
    if (rotation.euler === undefined && rotation.rescale) {
      const factor = 1 / Math.cos(Math.abs(rotation.angle) * Math.PI / 180);
      relative = rotation.axis === "x" ? [relative[0], relative[1] * factor, relative[2] * factor]
        : rotation.axis === "y" ? [relative[0] * factor, relative[1], relative[2] * factor]
          : [relative[0] * factor, relative[1] * factor, relative[2]];
    }
    relative = rotation.euler === undefined
      ? rotateAroundAxis(relative, rotation.axis, rotation.angle)
      : rotateEuler(relative, rotation.euler);
    output = addVector(relative, rotation.origin);
  }
  if (blockRotation !== undefined) output = rotateBlockPoint(output, blockRotation.x, blockRotation.y);
  return output;
}

function transformGeometryNormal(
  normal: readonly [number, number, number],
  rotation: AtlasBlockGeometry["elements"][number]["rotation"],
  blockRotation: AtlasBlockGeometry["elements"][number]["blockRotation"],
): readonly [number, number, number] {
  let output = normal;
  if (rotation !== undefined) {
    output = rotation.euler === undefined
      ? rotateAroundAxis(output, rotation.axis, rotation.angle)
      : rotateEuler(output, rotation.euler);
  }
  if (blockRotation !== undefined) output = rotateBlockVector(output, blockRotation.x, blockRotation.y);
  const length = Math.hypot(...output);
  return length === 0 ? normal : [output[0] / length, output[1] / length, output[2] / length];
}

function rotateAroundAxis(
  vector: readonly [number, number, number],
  axis: "x" | "y" | "z",
  angleDegrees: number,
): readonly [number, number, number] {
  const angle = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const [x, y, z] = vector;
  if (axis === "x") return [x, y * cosine - z * sine, y * sine + z * cosine];
  if (axis === "y") return [x * cosine + z * sine, y, -x * sine + z * cosine];
  return [x * cosine - y * sine, x * sine + y * cosine, z];
}

function rotateEuler(
  vector: readonly [number, number, number],
  euler: readonly [number, number, number],
): readonly [number, number, number] {
  let output = rotateAroundAxis(vector, "x", euler[0]);
  output = rotateAroundAxis(output, "y", euler[1]);
  return rotateAroundAxis(output, "z", euler[2]);
}

function rotateBlockPoint(
  point: readonly [number, number, number],
  x: 0 | 90 | 180 | 270,
  y: 0 | 90 | 180 | 270,
): readonly [number, number, number] {
  return addVector(rotateBlockVector(subtractVector(point, [8, 8, 8]), x, y), [8, 8, 8]);
}

function rotateBlockVector(
  vector: readonly [number, number, number],
  x: 0 | 90 | 180 | 270,
  y: 0 | 90 | 180 | 270,
): readonly [number, number, number] {
  let output = vector;
  for (let turns = 0; turns < x / 90; turns += 1) output = [output[0], -output[2], output[1]];
  for (let turns = 0; turns < y / 90; turns += 1) output = [output[2], output[1], -output[0]];
  return output;
}

function addVector(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtractVector(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function faceNormal(face: BlockFace): readonly [number, number, number] {
  switch (face) {
    case "down": return [0, -1, 0];
    case "up": return [0, 1, 0];
    case "north": return [0, 0, -1];
    case "south": return [0, 0, 1];
    case "west": return [-1, 0, 0];
    case "east": return [1, 0, 0];
  }
}

function windingNormal(positions: AtlasGeometryQuad["positions"], face: BlockFace): readonly [number, number, number] {
  const first = [positions[3]! - positions[0]!, positions[4]! - positions[1]!, positions[5]! - positions[2]!] as const;
  const second = [positions[6]! - positions[0]!, positions[7]! - positions[1]!, positions[8]! - positions[2]!] as const;
  const cross: [number, number, number] = [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
  const length = Math.hypot(...cross);
  return length === 0 ? faceNormal(face) : [cross[0] / length, cross[1] / length, cross[2] / length];
}

function directionalShadeFactor(face: BlockFace): number {
  if (face === "down") return 0.5;
  if (face === "up") return 1;
  if (face === "north" || face === "south") return 0.8;
  return 0.6;
}

function rotateGeometryFace(
  face: BlockFace,
  rotation: NonNullable<AtlasBlockGeometry["elements"][number]["blockRotation"]>,
): BlockFace {
  const vector: [number, number, number] = face === "down" ? [0, -1, 0]
    : face === "up" ? [0, 1, 0]
      : face === "north" ? [0, 0, -1]
        : face === "south" ? [0, 0, 1]
          : face === "west" ? [-1, 0, 0]
            : [1, 0, 0];
  let [x, y, z] = vector;
  for (let turn = 0; turn < rotation.x / 90; turn += 1) [x, y, z] = [x, -z, y];
  for (let turn = 0; turn < rotation.y / 90; turn += 1) [x, y, z] = [z, y, -x];
  if (y < 0) return "down";
  if (y > 0) return "up";
  if (z < 0) return "north";
  if (z > 0) return "south";
  return x < 0 ? "west" : "east";
}

function ratio(value: number, minimum: number, maximum: number): number {
  return maximum === minimum ? 0 : (value - minimum) / (maximum - minimum);
}

function canonicalNumber(value: number): number {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function stableHash(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export function geometryVoxelCacheKey(voxel: BlueprintVoxel): string {
  const state = Object.entries(voxel.sourceBlockState ?? {})
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return `${voxel.sourceBlockId ?? ""}[${state}]`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
