import type { TextureAlphaMode } from "@tomato-clock/resource-pack";
import * as THREE from "three";
import { patchAtlasAnimationFragmentShader, patchAtlasUvVertexShader, type ResourcePackAtlasPage } from "./resource-textures";

export interface AtlasShadowPolicy {
  castShadow: boolean;
  customDepthMaterial: "none" | "atlas-cutout";
}

const SHADOW_POLICIES: Readonly<Record<TextureAlphaMode, AtlasShadowPolicy>> = {
  opaque: Object.freeze({ castShadow: true, customDepthMaterial: "none" }),
  cutout: Object.freeze({ castShadow: true, customDepthMaterial: "atlas-cutout" }),
  translucent: Object.freeze({ castShadow: false, customDepthMaterial: "none" }),
};

/**
 * Keeps shadow participation separate from renderer wiring so quality profiles
 * can later disable cutout shadows without changing atlas texture planning.
 */
export function atlasShadowPolicy(alphaMode: TextureAlphaMode): AtlasShadowPolicy {
  return SHADOW_POLICIES[alphaMode];
}

/**
 * Creates a depth-only material whose alpha test samples the same atlas tile as
 * the visible material. The geometry must use the faceSlot, tile, and packed
 * face-UV attributes created by createTexturedBoxGeometry. Sharing the vertex
 * patch keeps cutout silhouettes aligned with their rendered UVs.
 *
 * The returned material does not own page.texture. Dispose it with
 * disposeAtlasDepthMaterial; the ResourcePackAtlas remains responsible for the
 * shared texture.
 */
export function createAtlasCutoutDepthMaterial(
  page: ResourcePackAtlasPage,
  alphaTest = 0.5,
): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({
    map: page.texture,
    alphaTest,
  });
  material.name = "blockcolc-atlas-cutout-depth";
  material.customProgramCacheKey = () => `blockcolc-atlas-cutout-depth-v4-${page.animationLookup ? "animated" : "static"}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.blockcolcAtlasSize = { value: new THREE.Vector2(page.width, page.height) };
    shader.uniforms.blockcolcAtlasColumns = { value: page.columns };
    shader.uniforms.blockcolcAtlasCellSize = { value: page.cellSize };
    shader.uniforms.blockcolcAtlasPadding = { value: page.padding };
    shader.uniforms.blockcolcFoliageTint = { value: new THREE.Color(0x619a52) };
    if (page.animationLookup) {
      shader.uniforms.blockcolcAnimationLookup = { value: page.animationLookup.texture };
      shader.uniforms.blockcolcAnimationBlendLookup = { value: page.animationLookup.blendTexture };
      shader.uniforms.blockcolcAnimationLookupSize = { value: new THREE.Vector2(page.animationLookup.width, page.animationLookup.height) };
    }
    shader.vertexShader = patchAtlasUvVertexShader(shader.vertexShader, page.animationLookup !== undefined);
    shader.fragmentShader = patchAtlasAnimationFragmentShader(shader.fragmentShader, page.animationLookup !== undefined);
  };
  return material;
}

/** Idempotently releases only the depth material, never the shared atlas. */
export function disposeAtlasDepthMaterial(material: THREE.MeshDepthMaterial): void {
  if (material.userData.blockcolcDisposed === true) return;
  material.userData.blockcolcDisposed = true;
  material.dispose();
}
