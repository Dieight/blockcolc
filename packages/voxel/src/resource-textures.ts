import {
  buildJava16xTextureAtlas,
  decodeResourcePackColormap,
  mapBlockTexturesToAtlas,
  resolveBlockTextures,
  type BlockFace,
  type ResourcePackManifest,
  type TextureAlphaMode,
  type TextureAtlas,
} from "@tomato-clock/resource-pack";
import * as THREE from "three";
import type { BlueprintVoxel } from "./blueprint";
import {
  combineTintAndOcclusionWord,
  createLocalOcclusionField,
  faceOcclusionLevelsFor,
  type LocalOcclusionField,
} from "./local-occlusion";
import { createVisualBiomePalette, type VisualBiomePalette } from "./visual-biome";
import { materialResponse, materialResponseCode, materialResponseForVoxel, type MaterialResponseKind } from "./material-response";

export const BLOCK_FACE_SLOTS = ["down", "up", "north", "south", "west", "east"] as const satisfies readonly BlockFace[];
export type FaceTileIndices = readonly [number, number, number, number, number, number];
export type FaceUvWords = readonly [number, number, number, number, number, number];
export type NormalizedFaceCropUv = readonly [number, number, number, number];
export type FaceUvRotation = 0 | 90 | 180 | 270;
export type FaceTintKind = 0 | 1 | 2 | 3;
export type FaceTintKinds = readonly [FaceTintKind, FaceTintKind, FaceTintKind, FaceTintKind, FaceTintKind, FaceTintKind];

export const FULL_FACE_CROP_UV: NormalizedFaceCropUv = Object.freeze([0, 0, 1, 1]);
export const NO_FACE_TINT: FaceTintKind = 0;
export const FOLIAGE_FACE_TINT: FaceTintKind = 1;
export const GRASS_FACE_TINT: FaceTintKind = 2;
export const WATER_FACE_TINT: FaceTintKind = 3;

export interface AtlasAnimationFrame {
  textureIndex: number;
  time: number;
}

export interface AtlasAnimationSequence {
  textureIndex: number;
  totalTicks: number;
  interpolate: boolean;
  frames: readonly AtlasAnimationFrame[];
}

export interface AtlasAnimationLookup {
  texture: THREE.DataTexture;
  pixels: Uint8Array;
  blendTexture: THREE.DataTexture;
  blendPixels: Uint8Array;
  width: number;
  height: number;
  tileCount: number;
  sequences: readonly AtlasAnimationSequence[];
}

export interface AtlasTile {
  resourceId: string;
  index: number;
  page: number;
  pageTextureIndex: number;
  alphaMode: TextureAlphaMode;
}

export interface ResourcePackAtlasPage {
  texture: THREE.DataTexture;
  width: number;
  height: number;
  columns: number;
  cellSize: number;
  padding: number;
  animationLookup?: AtlasAnimationLookup;
  visualBiomePalette?: VisualBiomePalette;
}

export interface ResourcePackAtlas {
  pages: readonly ResourcePackAtlasPage[];
  tiles: ReadonlyMap<string, AtlasTile>;
  source: TextureAtlas;
  dispose(): void;
}

export interface TexturedVoxelPlan {
  voxel: BlueprintVoxel;
  page: number;
  faceMask: number;
  faceTiles: FaceTileIndices;
  faceUvWordsA: FaceUvWords;
  faceUvWordsB: FaceUvWords;
  faceTintWord: number;
  /** Tint plus upper-bit local occlusion, populated only when batching a scene. */
  faceVisualWord?: number;
  alphaMode: TextureAlphaMode;
}

export interface TexturedVoxelBatch {
  key: string;
  page: number;
  faceMask: number;
  alphaMode: TextureAlphaMode;
  emissiveKind: string;
  emissiveLevel: number;
  entries: TexturedVoxelPlan[];
}

const alphaRank: Record<TextureAlphaMode, number> = { opaque: 0, cutout: 1, translucent: 2 };

export function buildResourcePackAtlas(manifest: ResourcePackManifest, maximumSize = 2048): ResourcePackAtlas {
  const source = buildJava16xTextureAtlas(manifest, { maxPageSize: maximumSize });
  const visualBiomePalette = createVisualBiomePalette((manifest.colormaps ?? []).map((colormap) => ({
    kind: colormap.kind,
    width: colormap.width,
    height: colormap.height,
    rgba: decodeResourcePackColormap(colormap),
  })));
  if (source.pages.length === 0) return disposableAtlas(source, [], new Map());
  const cellSize = source.textureSize + source.gutter * 2;
  const pages = source.pages.map((page) => {
    const columns = page.columns ?? atlasColumnCount(source, page.index, page.width, cellSize);
    const texture = new THREE.DataTexture(page.rgba, page.width, page.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.name = `blockcolc-resource-pack-atlas-${page.index}`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = true;
    texture.needsUpdate = true;
    const animationLookup = createAtlasAnimationLookup(source, page.index, maximumSize);
    return {
      texture, width: page.width, height: page.height, columns, cellSize, padding: source.gutter,
      ...(animationLookup ? { animationLookup } : {}), visualBiomePalette,
    };
  });
  const tiles = new Map(source.entries.map((entry) => [entry.resourceId, {
    resourceId: entry.resourceId,
    index: entry.index,
    page: entry.page,
    pageTextureIndex: entry.pageTextureIndex,
    alphaMode: entry.alphaMode,
  }]));
  return disposableAtlas(source, pages, tiles);
}

export function planTexturedVoxel(
  voxel: BlueprintVoxel,
  manifest: ResourcePackManifest,
  atlas: ResourcePackAtlas,
): TexturedVoxelPlan | undefined {
  const plans = planTexturedVoxelPages(voxel, manifest, atlas);
  return plans?.length === 1 ? plans[0] : undefined;
}

export function planTexturedVoxelPages(
  voxel: BlueprintVoxel,
  manifest: ResourcePackManifest,
  atlas: ResourcePackAtlas,
): TexturedVoxelPlan[] | undefined {
  if (!voxel.sourceBlockId || atlas.pages.length === 0) return undefined;
  const sourceBlockId = voxel.sourceBlockId;
  const resolution = resolveBlockTextures(manifest, sourceBlockId, voxel.sourceBlockState);
  const mapped = mapBlockTexturesToAtlas(resolution, atlas.source);
  if (mapped.status !== "resolved") return undefined;
  const resolvedFaces = BLOCK_FACE_SLOTS.map((face, faceIndex) => {
    const reference = mapped.faces[face];
    if (!atlas.pages[reference.page]) return undefined;
    const optionalTransform = reference as typeof reference & {
      cropUv?: NormalizedFaceCropUv;
      rotation?: FaceUvRotation;
      tintIndex?: number;
    };
    const [wordA, wordB] = packFaceUvTransform(
      optionalTransform.cropUv ?? FULL_FACE_CROP_UV,
      optionalTransform.rotation ?? 0,
    );
    const tintKind = faceTintKind(sourceBlockId, optionalTransform.tintIndex);
    if (tintKind === undefined) return undefined;
    return { faceIndex, reference, wordA, wordB, tintKind };
  });
  if (resolvedFaces.some((face) => face === undefined)) return undefined;
  type ResolvedFace = NonNullable<(typeof resolvedFaces)[number]>;
  const byPage = new Map<number, ResolvedFace[]>();
  for (const face of resolvedFaces as ResolvedFace[]) {
    const list = byPage.get(face.reference.page) ?? [];
    list.push(face);
    byPage.set(face.reference.page, list);
  }
  const defaultUv = packFaceUvTransform();
  return [...byPage.entries()].sort(([left], [right]) => left - right).map(([page, faces]) => {
    const faceTiles = Array(6).fill(0) as number[];
    const faceUvWordsA = Array(6).fill(defaultUv[0]) as number[];
    const faceUvWordsB = Array(6).fill(defaultUv[1]) as number[];
    const faceTintKinds = Array(6).fill(NO_FACE_TINT) as FaceTintKind[];
    let alphaMode: TextureAlphaMode = "opaque";
    let faceMask = 0;
    for (const face of faces) {
      faceTiles[face.faceIndex] = face.reference.textureIndex;
      faceUvWordsA[face.faceIndex] = face.wordA;
      faceUvWordsB[face.faceIndex] = face.wordB;
      faceTintKinds[face.faceIndex] = face.tintKind;
      faceMask |= 1 << face.faceIndex;
      if (alphaRank[face.reference.alphaMode] > alphaRank[alphaMode]) alphaMode = face.reference.alphaMode;
    }
    return {
      voxel, page, faceMask,
      faceTiles: faceTiles as unknown as FaceTileIndices,
      faceUvWordsA: faceUvWordsA as unknown as FaceUvWords,
      faceUvWordsB: faceUvWordsB as unknown as FaceUvWords,
      faceTintWord: packFaceTintKinds(faceTintKinds as unknown as FaceTintKinds),
      alphaMode,
    };
  });
}

export function createTextureBatches(
  voxels: readonly BlueprintVoxel[],
  manifest: ResourcePackManifest,
  atlas: ResourcePackAtlas,
  occlusionField: LocalOcclusionField = createLocalOcclusionField(voxels),
): { batches: TexturedVoxelBatch[]; fallbackVoxels: BlueprintVoxel[] } {
  const groups = new Map<string, TexturedVoxelBatch>();
  const fallbackVoxels: BlueprintVoxel[] = [];
  for (const voxel of voxels) {
    const plans = planTexturedVoxelPages(voxel, manifest, atlas);
    if (!plans) {
      fallbackVoxels.push(voxel);
      continue;
    }
    for (const sourcePlan of plans) {
      const planned = {
        ...sourcePlan,
        faceVisualWord: combineTintAndOcclusionWord(sourcePlan.faceTintWord, faceOcclusionLevelsFor(voxel, occlusionField)),
      };
      const emissiveKind = voxel.emissiveKind ?? "";
      const emissiveLevel = voxel.emissiveLevel ?? 0;
      const key = `${planned.page}|${planned.faceMask}|${planned.alphaMode}|${emissiveKind}|${emissiveLevel}`;
      let batch = groups.get(key);
      if (!batch) {
        batch = {
          key, page: planned.page, faceMask: planned.faceMask,
          alphaMode: planned.alphaMode, emissiveKind, emissiveLevel, entries: [],
        };
        groups.set(key, batch);
      }
      batch.entries.push(planned);
    }
  }
  return { batches: [...groups.values()].sort((left, right) => compareText(left.key, right.key)), fallbackVoxels };
}

export function createTexturedBoxGeometry(entries: readonly TexturedVoxelPlan[]): THREE.BufferGeometry {
  if (entries.length === 0) throw new Error("Textured geometry requires at least one entry.");
  const faceMask = entries[0]!.faceMask;
  if (entries.some((entry) => entry.faceMask !== faceMask)) throw new Error("Textured entries must share one face mask.");
  const geometry = new THREE.BoxGeometry(0.97, 0.97, 0.97);
  const normals = geometry.getAttribute("normal");
  const slots = new Float32Array(normals.count);
  for (let index = 0; index < normals.count; index += 1) {
    slots[index] = faceSlotForNormal(normals.getX(index), normals.getY(index), normals.getZ(index));
  }
  geometry.setAttribute("faceSlot", new THREE.Float32BufferAttribute(slots, 1));
  const first = new Float32Array(entries.length * 3);
  const second = new Float32Array(entries.length * 3);
  const uvWordAFirst = new Float32Array(entries.length * 3);
  const uvWordASecond = new Float32Array(entries.length * 3);
  const uvWordBFirst = new Float32Array(entries.length * 3);
  const uvWordBSecond = new Float32Array(entries.length * 3);
  const tintKinds = new Float32Array(entries.length);
  const materialResponses = new Float32Array(entries.length);
  entries.forEach((entry, index) => {
    first.set(entry.faceTiles.slice(0, 3), index * 3);
    second.set(entry.faceTiles.slice(3, 6), index * 3);
    uvWordAFirst.set(entry.faceUvWordsA.slice(0, 3), index * 3);
    uvWordASecond.set(entry.faceUvWordsA.slice(3, 6), index * 3);
    uvWordBFirst.set(entry.faceUvWordsB.slice(0, 3), index * 3);
    uvWordBSecond.set(entry.faceUvWordsB.slice(3, 6), index * 3);
    tintKinds[index] = entry.faceVisualWord ?? entry.faceTintWord;
    materialResponses[index] = materialResponseCode(materialResponseForVoxel(entry.voxel));
  });
  geometry.setAttribute("instanceFaceTilesA", new THREE.InstancedBufferAttribute(first, 3));
  geometry.setAttribute("instanceFaceTilesB", new THREE.InstancedBufferAttribute(second, 3));
  geometry.setAttribute("instanceFaceUvWordA0", new THREE.InstancedBufferAttribute(uvWordAFirst, 3));
  geometry.setAttribute("instanceFaceUvWordA1", new THREE.InstancedBufferAttribute(uvWordASecond, 3));
  geometry.setAttribute("instanceFaceUvWordB0", new THREE.InstancedBufferAttribute(uvWordBFirst, 3));
  geometry.setAttribute("instanceFaceUvWordB1", new THREE.InstancedBufferAttribute(uvWordBSecond, 3));
  geometry.setAttribute("instanceFaceTintKinds", new THREE.InstancedBufferAttribute(tintKinds, 1));
  geometry.setAttribute("instanceMaterialResponse", new THREE.InstancedBufferAttribute(materialResponses, 1));
  const originalIndex = geometry.getIndex();
  if (originalIndex && faceMask !== 0b11_1111) {
    const selected: number[] = [];
    for (let index = 0; index < originalIndex.count; index += 3) {
      const vertex = originalIndex.getX(index);
      const slot = slots[vertex]!;
      if ((faceMask & (1 << slot)) !== 0) {
        selected.push(originalIndex.getX(index), originalIndex.getX(index + 1), originalIndex.getX(index + 2));
      }
    }
    geometry.setIndex(selected);
  }
  geometry.userData.blockcolcFaceMask = faceMask;
  return geometry;
}

export function createAtlasMaterial(
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
  material.name = `blockcolc-atlas-${alphaMode}-${responseKind}`;
  material.customProgramCacheKey = () => `blockcolc-atlas-v4-${alphaMode}-${page.animationLookup ? "animated" : "static"}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.blockcolcAtlasSize = { value: new THREE.Vector2(page.width, page.height) };
    shader.uniforms.blockcolcAtlasColumns = { value: page.columns };
    shader.uniforms.blockcolcAtlasCellSize = { value: page.cellSize };
    shader.uniforms.blockcolcAtlasPadding = { value: page.padding };
    const visualBiomePalette = page.visualBiomePalette ?? createVisualBiomePalette([]);
    shader.uniforms.blockcolcFoliageTint = { value: new THREE.Color(visualBiomePalette.foliage) };
    shader.uniforms.blockcolcGrassTint = { value: new THREE.Color(visualBiomePalette.grass) };
    shader.uniforms.blockcolcWaterTint = { value: new THREE.Color(visualBiomePalette.water) };
    if (page.animationLookup) {
      shader.uniforms.blockcolcAnimationLookup = { value: page.animationLookup.texture };
      shader.uniforms.blockcolcAnimationBlendLookup = { value: page.animationLookup.blendTexture };
      shader.uniforms.blockcolcAnimationLookupSize = { value: new THREE.Vector2(page.animationLookup.width, page.animationLookup.height) };
    }
    shader.vertexShader = patchAtlasUvVertexShader(shader.vertexShader, page.animationLookup !== undefined);
    shader.fragmentShader = patchAtlasTintFragmentShader(shader.fragmentShader);
    shader.fragmentShader = patchAtlasAnimationFragmentShader(shader.fragmentShader, page.animationLookup !== undefined);
  };
  return material;
}

export function packFaceTintKinds(kinds: FaceTintKinds): number {
  return kinds.reduce<number>((word, kind, face) => {
    if (!Number.isInteger(kind) || kind < 0 || kind > 3) throw new RangeError("Face tint kind must be within 0..3");
    return word + kind * (4 ** face);
  }, 0);
}

export function unpackFaceTintKinds(word: number): FaceTintKinds {
  if (!Number.isSafeInteger(word) || word < 0 || word >= 16_777_216) throw new RangeError("Invalid packed face tint kinds");
  const tintWord = word % 4096;
  return BLOCK_FACE_SLOTS.map((_, face) => Math.floor(tintWord / (4 ** face)) % 4) as unknown as FaceTintKinds;
}

export function faceTintKind(blockId: string, tintIndex: number | undefined): FaceTintKind | undefined {
  if (tintIndex === undefined) return NO_FACE_TINT;
  if (tintIndex !== 0 || !blockId.startsWith("minecraft:")) return undefined;
  const path = blockId.slice("minecraft:".length);
  if (path.endsWith("_leaves") || path === "vine") return FOLIAGE_FACE_TINT;
  if (["grass_block", "short_grass", "tall_grass", "fern", "large_fern", "sugar_cane", "lily_pad"].includes(path)) {
    return GRASS_FACE_TINT;
  }
  if (path === "water" || path === "bubble_column") return WATER_FACE_TINT;
  return undefined;
}

/**
 * Packs a face-local crop into two exactly representable Float32 integer words.
 * Each coordinate uses 11-bit UNORM (0..2047); word A also stores rotation.
 * This bounds error below 1/128 of a 16x source pixel while keeping the total
 * vertex attribute count below WebGL2's minimum MAX_VERTEX_ATTRIBS of 16.
 */
export function packFaceUvTransform(
  cropUv: NormalizedFaceCropUv = FULL_FACE_CROP_UV,
  rotation: FaceUvRotation = 0,
): readonly [number, number] {
  if (![0, 90, 180, 270].includes(rotation)) throw new RangeError("Face UV rotation must be 0, 90, 180, or 270 degrees");
  const quantized = cropUv.map((coordinate) => {
    if (!Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1) throw new RangeError("Face crop UV must be within 0..1");
    return Math.round(coordinate * 2047);
  });
  const wordA = quantized[0]! + quantized[1]! * 2048 + (rotation / 90) * 4_194_304;
  const wordB = quantized[2]! + quantized[3]! * 2048;
  return [wordA, wordB];
}

export function unpackFaceUvTransform(wordA: number, wordB: number): { cropUv: NormalizedFaceCropUv; rotation: FaceUvRotation } {
  if (!Number.isSafeInteger(wordA) || wordA < 0 || wordA >= 16_777_216
    || !Number.isSafeInteger(wordB) || wordB < 0 || wordB >= 4_194_304) {
    throw new RangeError("Invalid packed face UV transform");
  }
  const u0 = wordA % 2048;
  const v0 = Math.floor(wordA / 2048) % 2048;
  const u1 = wordB % 2048;
  const v1 = Math.floor(wordB / 2048) % 2048;
  const quarterTurns = Math.floor(wordA / 4_194_304) % 4;
  return {
    cropUv: [u0 / 2047, v0 / 2047, u1 / 2047, v1 / 2047],
    rotation: (quarterTurns * 90) as FaceUvRotation,
  };
}

export function patchAtlasUvVertexShader(vertexShader: string, animated = false): string {
  const animationDeclarations = animated
    ? "\nuniform sampler2D blockcolcAnimationLookup;\nuniform sampler2D blockcolcAnimationBlendLookup;\nuniform vec2 blockcolcAnimationLookupSize;\nvarying vec2 vBlockcolcNextMapUv;\nvarying float vBlockcolcAnimationMix;"
    : "";
  const animationSampling = animated
    ? "float blockcolcLookupX = mod(blockcolcTile, blockcolcAnimationLookupSize.x);\nfloat blockcolcLookupY = floor(blockcolcTile / blockcolcAnimationLookupSize.x);\nvec2 blockcolcLookupUv = (vec2(blockcolcLookupX, blockcolcLookupY) + vec2(0.5)) / blockcolcAnimationLookupSize;\nvec4 blockcolcAnimatedTile = texture2D(blockcolcAnimationLookup, blockcolcLookupUv);\nvec4 blockcolcAnimationBlend = texture2D(blockcolcAnimationBlendLookup, blockcolcLookupUv);\nblockcolcTile = floor(blockcolcAnimatedTile.r * 255.0 + 0.5) + floor(blockcolcAnimatedTile.g * 255.0 + 0.5) * 256.0;\nfloat blockcolcNextTile = floor(blockcolcAnimatedTile.b * 255.0 + 0.5) + floor(blockcolcAnimatedTile.a * 255.0 + 0.5) * 256.0;\nvBlockcolcAnimationMix = blockcolcAnimationBlend.r;\n"
    : "float blockcolcNextTile = blockcolcTile;\n";
  return vertexShader
    .replace(
      "#include <common>",
      `#include <common>\nattribute float faceSlot;\nattribute vec3 instanceFaceTilesA;\nattribute vec3 instanceFaceTilesB;\nattribute vec3 instanceFaceUvWordA0;\nattribute vec3 instanceFaceUvWordA1;\nattribute vec3 instanceFaceUvWordB0;\nattribute vec3 instanceFaceUvWordB1;\nattribute float instanceFaceTintKinds;\nuniform vec2 blockcolcAtlasSize;\nuniform float blockcolcAtlasColumns;\nuniform float blockcolcAtlasCellSize;\nuniform float blockcolcAtlasPadding;\nuniform vec3 blockcolcFoliageTint;\nuniform vec3 blockcolcGrassTint;\nuniform vec3 blockcolcWaterTint;\nvarying vec3 vBlockcolcTint;\nvarying float vBlockcolcLocalOcclusion;${animationDeclarations}`,
    )
    .replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>\nfloat blockcolcTile = faceSlot < 0.5 ? instanceFaceTilesA.x : faceSlot < 1.5 ? instanceFaceTilesA.y : faceSlot < 2.5 ? instanceFaceTilesA.z : faceSlot < 3.5 ? instanceFaceTilesB.x : faceSlot < 4.5 ? instanceFaceTilesB.y : instanceFaceTilesB.z;\nfloat blockcolcUvWordA = faceSlot < 0.5 ? instanceFaceUvWordA0.x : faceSlot < 1.5 ? instanceFaceUvWordA0.y : faceSlot < 2.5 ? instanceFaceUvWordA0.z : faceSlot < 3.5 ? instanceFaceUvWordA1.x : faceSlot < 4.5 ? instanceFaceUvWordA1.y : instanceFaceUvWordA1.z;\nfloat blockcolcUvWordB = faceSlot < 0.5 ? instanceFaceUvWordB0.x : faceSlot < 1.5 ? instanceFaceUvWordB0.y : faceSlot < 2.5 ? instanceFaceUvWordB0.z : faceSlot < 3.5 ? instanceFaceUvWordB1.x : faceSlot < 4.5 ? instanceFaceUvWordB1.y : instanceFaceUvWordB1.z;\nfloat blockcolcU0 = mod(blockcolcUvWordA, 2048.0) / 2047.0;\nfloat blockcolcV0 = mod(floor(blockcolcUvWordA / 2048.0), 2048.0) / 2047.0;\nfloat blockcolcU1 = mod(blockcolcUvWordB, 2048.0) / 2047.0;\nfloat blockcolcV1 = mod(floor(blockcolcUvWordB / 2048.0), 2048.0) / 2047.0;\nfloat blockcolcRotation = mod(floor(blockcolcUvWordA / 4194304.0), 4.0);\nvec2 blockcolcLocalUv = vMapUv;\nif (blockcolcRotation > 2.5) blockcolcLocalUv = vec2(1.0 - vMapUv.y, vMapUv.x);\nelse if (blockcolcRotation > 1.5) blockcolcLocalUv = vec2(1.0 - vMapUv.x, 1.0 - vMapUv.y);\nelse if (blockcolcRotation > 0.5) blockcolcLocalUv = vec2(vMapUv.y, 1.0 - vMapUv.x);\nvec2 blockcolcCropStart = vec2(blockcolcU0, blockcolcV0) * 16.0;\nvec2 blockcolcCropDelta = (vec2(blockcolcU1, blockcolcV1) - vec2(blockcolcU0, blockcolcV0)) * 16.0;\nvec2 blockcolcCropAbs = abs(blockcolcCropDelta);\nvec2 blockcolcCropDirection = mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), blockcolcCropDelta));\nvec2 blockcolcCropInset = min(vec2(0.5), blockcolcCropAbs * 0.5);\nvec2 blockcolcCropSpan = max(blockcolcCropAbs - vec2(1.0), vec2(0.0));\nvec2 blockcolcPixelUv = blockcolcCropStart + blockcolcCropDirection * (blockcolcCropInset + blockcolcLocalUv * blockcolcCropSpan);\nfloat blockcolcColumn = mod(blockcolcTile, blockcolcAtlasColumns);\nfloat blockcolcRow = floor(blockcolcTile / blockcolcAtlasColumns);\nfloat blockcolcNextColumn = mod(blockcolcNextTile, blockcolcAtlasColumns);\nfloat blockcolcNextRow = floor(blockcolcNextTile / blockcolcAtlasColumns);\nvMapUv = (vec2(blockcolcColumn, blockcolcRow) * blockcolcAtlasCellSize + vec2(blockcolcAtlasPadding) + blockcolcPixelUv) / blockcolcAtlasSize;\n${animated ? "vBlockcolcNextMapUv = (vec2(blockcolcNextColumn, blockcolcNextRow) * blockcolcAtlasCellSize + vec2(blockcolcAtlasPadding) + blockcolcPixelUv) / blockcolcAtlasSize;" : ""}`,
    )
    .replace(
      "float blockcolcUvWordA =",
      `${animationSampling}float blockcolcUvWordA =`,
    )
    .replace(
      "float blockcolcU0 =",
      "float blockcolcTintDivisor = faceSlot < 0.5 ? 1.0 : faceSlot < 1.5 ? 4.0 : faceSlot < 2.5 ? 16.0 : faceSlot < 3.5 ? 64.0 : faceSlot < 4.5 ? 256.0 : 1024.0;\nfloat blockcolcTintKind = mod(floor(instanceFaceTintKinds / blockcolcTintDivisor), 4.0);\nvBlockcolcTint = blockcolcTintKind > 2.5 ? blockcolcWaterTint : blockcolcTintKind > 1.5 ? blockcolcGrassTint : blockcolcTintKind > 0.5 ? blockcolcFoliageTint : vec3(1.0);\nvBlockcolcLocalOcclusion = mod(floor(instanceFaceTintKinds / (4096.0 * blockcolcTintDivisor)), 4.0) / 3.0;\nfloat blockcolcU0 =",
    )
    .replace("attribute float instanceFaceTintKinds;", "attribute float instanceFaceTintKinds;\nattribute float instanceMaterialResponse;")
    .replace("varying float vBlockcolcLocalOcclusion;", "varying float vBlockcolcLocalOcclusion;\nvarying float vBlockcolcMaterialResponse;")
    .replace("#include <uv_vertex>\n", "#include <uv_vertex>\nvBlockcolcMaterialResponse = instanceMaterialResponse;\n");
}

export function patchAtlasAnimationFragmentShader(fragmentShader: string, animated = false): string {
  if (!animated) return fragmentShader;
  return fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec2 vBlockcolcNextMapUv;\nvarying float vBlockcolcAnimationMix;")
    .replace(
      "#include <map_fragment>",
      "#ifdef USE_MAP\nvec4 sampledDiffuseColor = texture2D(map, vMapUv);\nvec4 blockcolcNextDiffuseColor = texture2D(map, vBlockcolcNextMapUv);\nsampledDiffuseColor = mix(sampledDiffuseColor, blockcolcNextDiffuseColor, vBlockcolcAnimationMix);\n#ifdef DECODE_VIDEO_TEXTURE\nsampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);\n#endif\ndiffuseColor *= sampledDiffuseColor;\n#endif",
    );
}

export function patchAtlasTintFragmentShader(fragmentShader: string): string {
  return fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vBlockcolcTint;\nvarying float vBlockcolcLocalOcclusion;\nvarying float vBlockcolcMaterialResponse;")
    .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= vBlockcolcTint;\ndiffuseColor.rgb *= 1.0 - vBlockcolcLocalOcclusion * 0.28;")
    .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = vBlockcolcMaterialResponse < 0.5 ? 0.9 : vBlockcolcMaterialResponse < 1.5 ? 0.96 : vBlockcolcMaterialResponse < 2.5 ? 0.82 : vBlockcolcMaterialResponse < 3.5 ? 0.5 : 0.16;")
    .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = vBlockcolcMaterialResponse > 2.5 && vBlockcolcMaterialResponse < 3.5 ? 0.32 : 0.0;");
}

export function faceSlotForNormal(x: number, y: number, z: number): number {
  if (y < -0.5) return 0;
  if (y > 0.5) return 1;
  if (z < -0.5) return 2;
  if (z > 0.5) return 3;
  return x < 0 ? 4 : 5;
}

function disposableAtlas(
  source: TextureAtlas,
  pages: ResourcePackAtlas["pages"],
  tiles: ReadonlyMap<string, AtlasTile>,
): ResourcePackAtlas {
  let disposed = false;
  return {
    source,
    pages,
    tiles,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const page of pages) {
        page.texture.dispose();
        page.animationLookup?.texture.dispose();
        page.animationLookup?.blendTexture.dispose();
      }
    },
  };
}

type AnimatedAtlasEntry = TextureAtlas["entries"][number] & {
  animation?: {
    interpolate: boolean;
    totalTicks: number;
    frames: ReadonlyArray<{
      textureIndex: number;
      page: number;
      pageTextureIndex: number;
      uv: { u0: number; v0: number; u1: number; v1: number };
      time: number;
    }>;
  };
};

function atlasColumnCount(source: TextureAtlas, pageIndex: number, pageWidth: number, cellSize: number): number {
  const columns = (source.entries as readonly AnimatedAtlasEntry[]).filter((entry) => entry.page === pageIndex).flatMap((entry) => [
    Math.floor((entry.x - source.gutter) / cellSize),
    ...(entry.animation?.frames ?? []).filter((frame) => frame.page === pageIndex)
      .map((frame) => Math.floor((frame.uv.u0 * pageWidth - source.gutter) / cellSize)),
  ]);
  return columns.length === 0 ? 1 : Math.max(...columns) + 1;
}

function createAtlasAnimationLookup(source: TextureAtlas, pageIndex: number, maximumSize: number): AtlasAnimationLookup | undefined {
  const entries = (source.entries as readonly AnimatedAtlasEntry[]).filter((entry) => entry.page === pageIndex);
  const sequences = entries.flatMap((entry): AtlasAnimationSequence[] => {
    const animation = entry.animation;
    if (!animation || animation.frames.length < 2) return [];
    if (animation.frames.some((frame) => frame.page !== pageIndex)) return [];
    return [{
      textureIndex: entry.pageTextureIndex,
      totalTicks: animation.totalTicks,
      interpolate: animation.interpolate,
      frames: animation.frames.map((frame) => ({ textureIndex: frame.pageTextureIndex, time: frame.time })),
    }];
  });
  if (sequences.length === 0) return undefined;
  const tileCount = Math.max(
    ...entries.map((entry) => entry.pageTextureIndex),
    ...sequences.flatMap((sequence) => sequence.frames.map((frame) => frame.textureIndex)),
  ) + 1;
  if (tileCount > 65_536) throw new Error("Animated atlas exceeds the 16-bit tile lookup limit.");
  const width = Math.min(maximumSize, tileCount);
  const height = Math.ceil(tileCount / width);
  if (height > maximumSize) throw new Error("Animated atlas lookup exceeds the GPU texture-size limit.");
  const pixels = new Uint8Array(width * height * 4);
  const blendPixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < tileCount; index += 1) writeLookupTile(pixels, index, index);
  for (let index = 0; index < tileCount; index += 1) writeLookupBlend(blendPixels, index, 0);
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "blockcolc-animation-tile-lookup";
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  const blendTexture = new THREE.DataTexture(blendPixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  blendTexture.name = "blockcolc-animation-blend-lookup";
  blendTexture.colorSpace = THREE.NoColorSpace;
  blendTexture.magFilter = THREE.NearestFilter;
  blendTexture.minFilter = THREE.NearestFilter;
  blendTexture.generateMipmaps = false;
  blendTexture.flipY = false;
  blendTexture.needsUpdate = true;
  return { texture, pixels, blendTexture, blendPixels, width, height, tileCount, sequences };
}

export function writeLookupTile(pixels: Uint8Array, lookupIndex: number, textureIndex: number): void {
  writeLookupFrames(pixels, lookupIndex, textureIndex, textureIndex);
}

export function writeLookupFrames(pixels: Uint8Array, lookupIndex: number, currentTextureIndex: number, nextTextureIndex: number): void {
  const offset = lookupIndex * 4;
  pixels[offset] = currentTextureIndex & 0xff;
  pixels[offset + 1] = (currentTextureIndex >>> 8) & 0xff;
  pixels[offset + 2] = nextTextureIndex & 0xff;
  pixels[offset + 3] = (nextTextureIndex >>> 8) & 0xff;
}

export function writeLookupBlend(pixels: Uint8Array, lookupIndex: number, blend: number): void {
  const offset = lookupIndex * 4;
  pixels[offset] = Math.max(0, Math.min(255, Math.round(blend * 255)));
  pixels[offset + 1] = 0;
  pixels[offset + 2] = 0;
  pixels[offset + 3] = 255;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
