import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cloudDisplacement, patchCloudMotion } from '../src/cloud-motion';

describe('connected GPU cloud advection', () => {
  it('keeps a cloud fixed at time zero and wraps the entire cluster, not individual blocks', () => {
    expect(cloudDisplacement([24, -30], [1, -.5], 0, [100, 100])).toEqual([0, 0]);
    expect(cloudDisplacement([24, -30], [1, -.5], 4, [100, 100])).toEqual([4, -2]);
    expect(cloudDisplacement([48, 0], [1, .5], 4, [100, 100])).toEqual([-96, 2]);
  });
  it('holds live time uniforms across compilation and keeps geometry/instance transforms in the same frame', () => {
    const material = new THREE.MeshLambertMaterial();
    const motion = patchCloudMotion(material, 100, 160);
    motion.elapsed.value = 4;
    const shader = { uniforms: {}, vertexShader: '#include <project_vertex>', fragmentShader: '' };
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect((shader.uniforms as Record<string, unknown>).cloudElapsed).toBe(motion.elapsed);
    expect(shader.vertexShader).toContain('center - cloudCenter');
    expect(shader.vertexShader).toContain('instanceMatrix * mvPosition');
    expect(shader.vertexShader).not.toContain('#include <project_vertex>');
    material.dispose();
  });
});
