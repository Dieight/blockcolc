import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { patchWeatherWaterMaterial } from '../src/water-weather';

describe('water weather response', () => {
  it('uses the same live sky gate after per-face atlas roughness, and leaves diffuse/shadow code intact', () => {
    const material = new THREE.MeshStandardMaterial();
    material.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', 'roughnessFactor = 0.16;'); };
    material.customProgramCacheKey = () => 'atlas-response';
    const gate = { value: 1 };
    patchWeatherWaterMaterial(material, gate);
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#include <roughnessmap_fragment>\n#include <lights_physical_fragment>\n#include <lights_fragment_begin>' };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect((shader.uniforms as Record<string, unknown>).blockcolcWaterClearSky).toBe(gate);
    expect(shader.fragmentShader.indexOf('roughnessFactor = mix')).toBeGreaterThan(shader.fragmentShader.indexOf('roughnessFactor = 0.16'));
    expect(shader.fragmentShader).toContain('#include <lights_physical_fragment>');
    expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(material.customProgramCacheKey()).toBe('atlas-response|weather-water-v1');
    gate.value = 0;
    expect((shader.uniforms as Record<string, { value: number }>).blockcolcWaterClearSky?.value).toBe(0);
    material.dispose();
  });
});
