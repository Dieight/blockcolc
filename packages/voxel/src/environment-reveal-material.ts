import * as THREE from "three";

/**
 * Material.clone() intentionally does not copy runtime shader callbacks.
 * Environment reveals temporarily replace live materials, so keep the exact
 * shader customization contract while leaving all GPU resources owned by the
 * cloned material (and its caller) independent.
 */
export function cloneEnvironmentRevealMaterial<T extends THREE.Material>(source: T): T {
  const clone = source.clone() as T;
  clone.onBeforeCompile = source.onBeforeCompile;
  clone.customProgramCacheKey = source.customProgramCacheKey;
  return clone;
}
