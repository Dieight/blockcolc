import type * as THREE from 'three';

export function cloudDisplacement(center: readonly [number, number], velocity: readonly [number, number], elapsedSeconds: number, span: readonly [number, number]): [number, number] {
  const wrap = (v: number, width: number) => ((v + width / 2) % width + width) % width - width / 2;
  return [wrap(center[0] + velocity[0] * elapsedSeconds, span[0]) - center[0],
    wrap(center[1] + velocity[1] * elapsedSeconds, span[1]) - center[1]];
}

/** Each connected cloud wraps as a unit; its blocks never drift apart. */
export function patchCloudMotion(material: THREE.MeshLambertMaterial, spanX: number, spanZ: number) {
  const uniforms = { elapsed: { value: 0 }, span: { value: [spanX, spanZ] as [number, number] } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { cloudElapsed: uniforms.elapsed, cloudSpan: uniforms.span });
    shader.vertexShader = `attribute vec2 cloudCenter; attribute vec2 cloudVelocity;
uniform float cloudElapsed; uniform vec2 cloudSpan;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec2 center = mod(cloudCenter + cloudVelocity * cloudElapsed + cloudSpan * 0.5, cloudSpan) - cloudSpan * 0.5;
  mvPosition.xz += center - cloudCenter;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => 'blockcolc-cloud-advection-v1';
  return uniforms;
}
