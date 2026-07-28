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
  combineTintAndOcclusionWord,
  createLocalOcclusionField,
  faceOcclusionLevelsFor,
  type LocalOcclusionField,
} from "./local-occlusion";
import { atlasShadowPolicy, disposeAtlasDepthMaterial, type AtlasShadowPolicy } from "./atlas-depth-material";
import {
  BLOCK_FACE_SLOTS,
  NO_FACE_TINT,
  faceTintKind,
  packFaceTintKinds,
  patchAtlasAnimationFragmentShader,
  patchAtlasTintFragmentShader,
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
  bakedUvs: readonly [number, number, number, number, number, number, number, number];
  slot: number;
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
  /** Tint plus upper-bit local occlusion, populated only when batching a scene. */
  faceVisualWord?: number;
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
  entries: GeometryVoxelPlan[];
}

const alphaRank: Record<TextureAlphaMode, number> = { opaque: 0, cutout: 1, translucent: 2 };

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
  if (!voxel.sourceBlockId || atlas.pages.length === 0 || !isSupportedGeometryBlock(voxel.sourceBlockId, voxel.sourceBlockState)) return undefined;
  const resolved = resolveBlockGeometry(manifest, voxel.sourceBlockId, voxel.sourceBlockState);
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
  const references: Array<{ page: number; face: BlockFace; element: AtlasBlockGeometry["elements"][number]; reference: AtlasGeometryFaceReference; tintKind: FaceTintKind }> = [];
  for (const element of mapped.elements) {
    if (!element.shade) return undefined;
    for (const face of BLOCK_FACE_SLOTS) {
      const reference = element.faces[face];
      if (!reference) continue;
      const tintKind = faceTintKind(voxel.sourceBlockId, reference.tintIndex);
      if (tintKind === undefined) return undefined;
      references.push({ page: reference.page, face, element, reference, tintKind });
    }
  }
  if (references.length === 0) return undefined;
  const pages = new Map<number, typeof references>();
  for (const item of references) {
    const pageReferences = pages.get(item.page) ?? [];
    pageReferences.push(item);
    pages.set(item.page, pageReferences);
  }
  const plans: GeometryVoxelPlan[] = [];
  for (const [page, pageReferences] of [...pages.entries()].sort(([left], [right]) => left - right)) {
    const slots = new Map<string, number>();
    const tileValues: number[] = [];
    const tintValues: FaceTintKind[] = [];
    const quads: AtlasGeometryQuad[] = [];
    let alphaMode: TextureAlphaMode = "opaque";
    for (const { face, element, reference, tintKind } of pageReferences) {
      const slotKey = `${reference.textureIndex}|${tintKind}`;
      let slot = slots.get(slotKey);
      if (slot === undefined) {
        slot = slots.size;
        if (slot >= 6) return undefined;
        slots.set(slotKey, slot);
        tileValues.push(reference.textureIndex);
        tintValues.push(tintKind);
      }
      quads.push({
        face,
        positions: facePositions(face, element.from, element.to),
        bakedUvs: bakedFaceUvs(face, element.from, element.to, reference),
        slot,
        shade: element.shade,
        ...(reference.cullFace === undefined ? {} : { cullFace: reference.cullFace }),
      });
      if (alphaRank[reference.alphaMode] > alphaRank[alphaMode]) alphaMode = reference.alphaMode;
    }
    while (tileValues.length < 6) tileValues.push(0);
    while (tintValues.length < 6) tintValues.push(NO_FACE_TINT);
    const canonicalPayload = geometryCanonicalPayload(quads);
    const signature = geometrySignature(canonicalPayload);
    plans.push({
      voxel,
      page,
      topology: { signature, canonicalPayload, elementCount: mapped.elements.length, textureSlotCount: slots.size, quads },
      faceTiles: tileValues as unknown as FaceTileIndices,
      faceTintWord: packFaceTintKinds(tintValues as unknown as FaceTintKinds),
      alphaMode,
    });
  }
  return plans;
}

export function createGeometryBatches(
  voxels: readonly BlueprintVoxel[],
  manifest: ResourcePackManifest,
  atlas: ResourcePackAtlas,
  occlusionField: LocalOcclusionField = createLocalOcclusionField(voxels),
): { batches: GeometryVoxelBatch[]; fallbackVoxels: BlueprintVoxel[] } {
  const plans: GeometryVoxelPlan[] = [];
  const fallbackVoxels: BlueprintVoxel[] = [];
  const cache = new Map<string, GeometryVoxelPlan[] | null>();
  for (const voxel of voxels) {
    const cacheKey = geometryVoxelCacheKey(voxel);
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
    plans.push(...template.map((plan) => ({
      ...plan,
      voxel,
      faceVisualWord: combineTintAndOcclusionWord(plan.faceTintWord, levels),
    })));
  }
  return { batches: batchGeometryPlans(plans), fallbackVoxels };
}

export function batchGeometryPlans(plans: readonly GeometryVoxelPlan[]): GeometryVoxelBatch[] {
  const groups = new Map<string, GeometryVoxelBatch>();
  for (const plan of plans) {
    const emissiveKind = plan.voxel.emissiveKind ?? "";
    const emissiveLevel = plan.voxel.emissiveLevel ?? 0;
    const key = `${plan.page}|${plan.topology.signature}|${plan.topology.canonicalPayload}|${plan.alphaMode}|${emissiveKind}|${emissiveLevel}`;
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
        entries: [],
      };
      groups.set(key, batch);
    }
    batch.entries.push(plan);
  }
  return [...groups.values()].sort((left, right) => compareText(left.key, right.key));
}

export function createAtlasGeometry(batch: GeometryVoxelBatch): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const faceSlots: number[] = [];
  const indices: number[] = [];
  for (const quad of batch.topology.quads) {
    const base = positions.length / 3;
    positions.push(...quad.positions.map((value) => ((value / 16) - 0.5) * 0.97));
    const normal = faceNormal(quad.face);
    for (let vertex = 0; vertex < 4; vertex += 1) {
      normals.push(...normal);
      faceSlots.push(quad.slot);
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
  geometry.setIndex(indices);

  const tileA = new Float32Array(batch.entries.length * 3);
  const tileB = new Float32Array(batch.entries.length * 3);
  const tintKinds = new Float32Array(batch.entries.length);
  const materialResponses = new Float32Array(batch.entries.length);
  batch.entries.forEach((entry, index) => {
    tileA.set(entry.faceTiles.slice(0, 3), index * 3);
    tileB.set(entry.faceTiles.slice(3, 6), index * 3);
    tintKinds[index] = entry.faceVisualWord ?? entry.faceTintWord;
    materialResponses[index] = materialResponseCode(materialResponseForVoxel(entry.voxel));
  });
  geometry.setAttribute("instanceFaceTilesA", new THREE.InstancedBufferAttribute(tileA, 3));
  geometry.setAttribute("instanceFaceTilesB", new THREE.InstancedBufferAttribute(tileB, 3));
  geometry.setAttribute("instanceFaceTintKinds", new THREE.InstancedBufferAttribute(tintKinds, 1));
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
  material.customProgramCacheKey = () => `blockcolc-atlas-geometry-v2-${alphaMode}-${page.animationLookup ? "animated" : "static"}`;
  material.onBeforeCompile = (shader) => {
    installGeometryAtlasUniforms(shader, page);
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
  material.customProgramCacheKey = () => `blockcolc-atlas-geometry-depth-v2-${page.animationLookup ? "animated" : "static"}`;
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
      `#include <common>\nattribute float faceSlot;\nattribute vec3 instanceFaceTilesA;\nattribute vec3 instanceFaceTilesB;\nattribute float instanceFaceTintKinds;\nuniform vec2 blockcolcAtlasSize;\nuniform float blockcolcAtlasColumns;\nuniform float blockcolcAtlasCellSize;\nuniform float blockcolcAtlasPadding;\nuniform vec3 blockcolcFoliageTint;\nuniform vec3 blockcolcGrassTint;\nvarying vec3 vBlockcolcTint;\nvarying float vBlockcolcLocalOcclusion;${animationDeclarations}`,
    )
    .replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>\nfloat blockcolcTile = faceSlot < 0.5 ? instanceFaceTilesA.x : faceSlot < 1.5 ? instanceFaceTilesA.y : faceSlot < 2.5 ? instanceFaceTilesA.z : faceSlot < 3.5 ? instanceFaceTilesB.x : faceSlot < 4.5 ? instanceFaceTilesB.y : instanceFaceTilesB.z;${animationSampling}\nfloat blockcolcTintDivisor = faceSlot < 0.5 ? 1.0 : faceSlot < 1.5 ? 4.0 : faceSlot < 2.5 ? 16.0 : faceSlot < 3.5 ? 64.0 : faceSlot < 4.5 ? 256.0 : 1024.0;\nfloat blockcolcTintKind = mod(floor(instanceFaceTintKinds / blockcolcTintDivisor), 4.0);\nvBlockcolcTint = blockcolcTintKind > 1.5 ? blockcolcGrassTint : blockcolcTintKind > 0.5 ? blockcolcFoliageTint : vec3(1.0);\nvBlockcolcLocalOcclusion = mod(floor(instanceFaceTintKinds / (4096.0 * blockcolcTintDivisor)), 4.0) / 3.0;\nfloat blockcolcColumn = mod(blockcolcTile, blockcolcAtlasColumns);\nfloat blockcolcRow = floor(blockcolcTile / blockcolcAtlasColumns);\nfloat blockcolcNextColumn = mod(blockcolcNextTile, blockcolcAtlasColumns);\nfloat blockcolcNextRow = floor(blockcolcNextTile / blockcolcAtlasColumns);\nvec2 blockcolcPixelUv = vMapUv * 16.0;\nvMapUv = (vec2(blockcolcColumn, blockcolcRow) * blockcolcAtlasCellSize + vec2(blockcolcAtlasPadding) + blockcolcPixelUv) / blockcolcAtlasSize;\n${animated ? "vBlockcolcNextMapUv = (vec2(blockcolcNextColumn, blockcolcNextRow) * blockcolcAtlasCellSize + vec2(blockcolcAtlasPadding) + blockcolcPixelUv) / blockcolcAtlasSize;" : ""}`,
    )
    .replace("attribute float instanceFaceTintKinds;", "attribute float instanceFaceTintKinds;\nattribute float instanceMaterialResponse;")
    .replace("varying float vBlockcolcLocalOcclusion;", "varying float vBlockcolcLocalOcclusion;\nvarying float vBlockcolcMaterialResponse;")
    .replace("#include <uv_vertex>\n", "#include <uv_vertex>\nvBlockcolcMaterialResponse = instanceMaterialResponse;\n");
}

function installGeometryAtlasUniforms(
  shader: THREE.WebGLProgramParametersWithUniforms,
  page: ResourcePackAtlasPage,
): void {
  shader.uniforms.blockcolcAtlasSize = { value: new THREE.Vector2(page.width, page.height) };
  shader.uniforms.blockcolcAtlasColumns = { value: page.columns };
  shader.uniforms.blockcolcAtlasCellSize = { value: page.cellSize };
  shader.uniforms.blockcolcAtlasPadding = { value: page.padding };
  const visualBiomePalette = page.visualBiomePalette ?? createVisualBiomePalette([]);
  shader.uniforms.blockcolcFoliageTint = { value: new THREE.Color(visualBiomePalette.foliage) };
  shader.uniforms.blockcolcGrassTint = { value: new THREE.Color(visualBiomePalette.grass) };
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
    bakedUvs: quad.bakedUvs.map(canonicalNumber),
    slot: quad.slot,
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
