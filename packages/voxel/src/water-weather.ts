import type * as THREE from 'three';

/** Applies after atlas per-face response too; changing material.roughness alone
 * would be overwritten by the atlas shader's glass/water response. */
export function patchWeatherWaterMaterial(material: THREE.MeshStandardMaterial, clearSky: { value: number }): void {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.blockcolcWaterClearSky = clearSky;
    shader.fragmentShader = `uniform float blockcolcWaterClearSky;\n${shader.fragmentShader}`.replace(
      '#include <lights_physical_fragment>',
      'roughnessFactor = mix(1.0, roughnessFactor, blockcolcWaterClearSky);\nmetalnessFactor *= blockcolcWaterClearSky;\n#include <lights_physical_fragment>',
    );
  };
  material.customProgramCacheKey = () => `${key}|weather-water-v1`;
}
