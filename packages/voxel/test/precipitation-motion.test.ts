import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { precipitationFrameIntervalMs, precipitationMotion, patchPrecipitationMaterial } from '../src/precipitation-motion';

describe('instanced precipitation motion', () => {
  it('keeps hardware weather smooth and bounds idle software submissions by measured cost', () => {
    expect(precipitationFrameIntervalMs(8, false)).toBe(32);
    expect(precipitationFrameIntervalMs(40, false)).toBe(64);
    expect(precipitationFrameIntervalMs(8, true)).toBe(250);
    expect(precipitationFrameIntervalMs(200, true)).toBe(320);
    for (const software of [false, true]) {
      expect(precipitationFrameIntervalMs(2_000, software)).toBe(1_000);
      expect(precipitationFrameIntervalMs(Infinity, software)).toBe(1_000);
      expect(precipitationFrameIntervalMs(NaN, software)).toBe(software ? 250 : 32);
      expect(precipitationFrameIntervalMs(-1, software)).toBe(software ? 250 : 32);
    }
  });
  it('falls continuously, wraps in the same field and layers snow drift', () => {
    expect(precipitationMotion(.7, 0, false).phase).toBeCloseTo(.7);
    expect(precipitationMotion(.7, 16, false).phase).toBeLessThan(.7);
    expect(precipitationMotion(.7, 16, false).phase).not.toBe(precipitationMotion(.7, 32, false).phase);
    for (const elapsed of [1000, 1e6, 1e9]) {
      const p = precipitationMotion(.01, elapsed, true);
      expect(p.phase).toBeGreaterThanOrEqual(0); expect(p.phase).toBeLessThan(1);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1.35); expect(Math.abs(p.z)).toBeLessThanOrEqual(.8);
    }
  });
  it('updates the same shader uniform, without rewriting geometry or instance buffers', () => {
    for (const snow of [false, true]) {
      const material = new THREE.MeshBasicMaterial();
      const uniforms = patchPrecipitationMaterial(material, snow, -2, 30);
      const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>\n#include <project_vertex>' } as THREE.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      uniforms.elapsed.value = 16;
      expect(shader.uniforms.weatherElapsed).toBe(uniforms.elapsed);
      uniforms.center.value[0] = 145; uniforms.field.value[1] = 680;
      expect(shader.uniforms.weatherCenter).toBe(uniforms.center);
      expect(shader.uniforms.weatherField).toBe(uniforms.field);
      expect(shader.vertexShader).toContain('weatherOffset * weatherField');
      expect(shader.vertexShader).toContain('fract(weatherPhase');
      expect(shader.vertexShader).not.toContain('#include <project_vertex>');
      material.dispose();
    }
  });
});
