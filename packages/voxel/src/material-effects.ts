import * as THREE from "three";

const MATERIAL_EFFECTS_CACHE_KEY = "blockcolc-material-effects-v1";
const PATCH_MARKER = "// blockcolc-material-effects-v1";

export interface MaterialEffectsOptions {
  lightDirection: THREE.Vector3 | readonly [number, number, number];
  lightTint: THREE.ColorRepresentation;
  shadowTint: THREE.ColorRepresentation;
  strength: number;
}

export interface MaterialEffectsUniforms {
  blockcolcEffectLightDirection: THREE.IUniform<THREE.Vector3>;
  blockcolcEffectLightTint: THREE.IUniform<THREE.Color>;
  blockcolcEffectShadowTint: THREE.IUniform<THREE.Color>;
  blockcolcEffectStrength: THREE.IUniform<number>;
}

export interface MaterialEffectsPatch {
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: MaterialEffectsUniforms;
  update(options: Partial<MaterialEffectsOptions>): void;
}

const patches = new WeakMap<THREE.MeshStandardMaterial, MaterialEffectsPatch>();

/**
 * Adds inexpensive, Minecraft-like face shading to a standard voxel material.
 *
 * The patch composes with an existing `onBeforeCompile` hook, so it can be used
 * by both the original colour materials and resource-pack atlas materials.
 * Applying it repeatedly returns the same live patch instead of nesting hooks.
 */
export function applyMaterialEffects(
  material: THREE.MeshStandardMaterial,
  options: Partial<MaterialEffectsOptions> = {},
): MaterialEffectsPatch {
  const existing = patches.get(material);
  if (existing) {
    existing.update(options);
    return existing;
  }

  const uniforms: MaterialEffectsUniforms = {
    blockcolcEffectLightDirection: { value: new THREE.Vector3(-0.55, 0.82, 0.38).normalize() },
    blockcolcEffectLightTint: { value: new THREE.Color(0xffedcf) },
    blockcolcEffectShadowTint: { value: new THREE.Color(0xaebed3) },
    blockcolcEffectStrength: { value: 0.18 },
  };
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey();

  const patch: MaterialEffectsPatch = {
    material,
    uniforms,
    update(next) {
      if (next.lightDirection !== undefined) setDirection(uniforms.blockcolcEffectLightDirection.value, next.lightDirection);
      if (next.lightTint !== undefined) uniforms.blockcolcEffectLightTint.value.set(next.lightTint);
      if (next.shadowTint !== undefined) uniforms.blockcolcEffectShadowTint.value.set(next.shadowTint);
      if (next.strength !== undefined) uniforms.blockcolcEffectStrength.value = THREE.MathUtils.clamp(next.strength, 0, 1);
    },
  };

  patch.update(options);
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);
    installUniforms(shader.uniforms, uniforms);
    if (shader.vertexShader.includes(PATCH_MARKER)) return;
    shader.vertexShader = patchVertexShader(shader.vertexShader);
    shader.fragmentShader = patchFragmentShader(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => `${previousCacheKey}|${MATERIAL_EFFECTS_CACHE_KEY}`;
  material.needsUpdate = true;
  patches.set(material, patch);
  return patch;
}

function installUniforms(
  target: Record<string, THREE.IUniform>,
  uniforms: MaterialEffectsUniforms,
): void {
  target.blockcolcEffectLightDirection = uniforms.blockcolcEffectLightDirection;
  target.blockcolcEffectLightTint = uniforms.blockcolcEffectLightTint;
  target.blockcolcEffectShadowTint = uniforms.blockcolcEffectShadowTint;
  target.blockcolcEffectStrength = uniforms.blockcolcEffectStrength;
}

function patchVertexShader(source: string): string {
  return source
    .replace(
      "#include <common>",
      `#include <common>\n${PATCH_MARKER}\nvarying vec3 vBlockcolcEffectNormal;`,
    )
    .replace(
      "#include <beginnormal_vertex>",
      "#include <beginnormal_vertex>\nvBlockcolcEffectNormal = normalize( objectNormal );",
    );
}

function patchFragmentShader(source: string): string {
  return source
    .replace(
      "#include <common>",
      `#include <common>\n${PATCH_MARKER}\nvarying vec3 vBlockcolcEffectNormal;\nuniform vec3 blockcolcEffectLightDirection;\nuniform vec3 blockcolcEffectLightTint;\nuniform vec3 blockcolcEffectShadowTint;\nuniform float blockcolcEffectStrength;`,
    )
    .replace(
      "#include <opaque_fragment>",
      `float blockcolcEffectFacing = smoothstep( -0.45, 0.75, dot( normalize( vBlockcolcEffectNormal ), blockcolcEffectLightDirection ) );
vec3 blockcolcEffectTint = mix( blockcolcEffectShadowTint, blockcolcEffectLightTint, blockcolcEffectFacing );
float blockcolcEffectBrightness = mix( 0.84, 1.05, blockcolcEffectFacing );
outgoingLight *= mix( vec3( 1.0 ), blockcolcEffectTint * blockcolcEffectBrightness, blockcolcEffectStrength );
#include <opaque_fragment>`,
    );
}

function setDirection(target: THREE.Vector3, source: THREE.Vector3 | readonly [number, number, number]): void {
  if (source instanceof THREE.Vector3) target.copy(source);
  else target.set(source[0], source[1], source[2]);
  if (target.lengthSq() < 1e-8) target.set(-0.55, 0.82, 0.38);
  target.normalize();
}
