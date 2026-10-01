import type * as THREE from 'three';

/** Idle weather shares one scheduler with input. Hardware keeps ~30 Hz; a
 * software rasterizer must leave compositor time instead of queuing full-world
 * draws faster than it can consume them. This never gates input-driven frames. */
export function precipitationFrameIntervalMs(frameCostMs: number, softwareRenderer: boolean): number {
  const minimum = softwareRenderer ? 250 : 32;
  const measured = Number.isNaN(frameCostMs) ? 0 : Math.max(0, frameCostMs);
  return Math.min(1_000, Math.max(minimum, Math.ceil(measured * 1.6)));
}

/** Shared with the vertex shader and the frustum probe; milliseconds never use wall time. */
export function precipitationMotion(phase: number, elapsedMs: number, snow: boolean, speed = 1): { phase: number; x: number; z: number } {
  const fall = elapsedMs * (snow ? .00022 : .00078 * speed);
  const drift = phase * Math.PI * 2 + elapsedMs * .00055;
  return { phase: ((phase - fall) % 1 + 1) % 1,
    x: snow ? Math.sin(drift) * 1.35 : 0, z: snow ? Math.cos(drift * .72) * .8 : 0 };
}

export interface PrecipitationUniforms {
  elapsed: { value: number };
  base: { value: number };
  span: { value: number };
  speed: { value: number };
  size: { value: number };
}

/** Move particles in the existing instanced draw; only uniforms change per frame. */
export function patchPrecipitationMaterial(material: THREE.MeshBasicMaterial, snow: boolean, base: number, span: number, speed = 1): PrecipitationUniforms {
  const uniforms = { elapsed: { value: 0 }, base: { value: base }, span: { value: span },
    speed: { value: speed }, size: { value: 1 } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { weatherElapsed: uniforms.elapsed, weatherBase: uniforms.base,
      weatherSpan: uniforms.span, weatherSpeed: uniforms.speed, weatherSize: uniforms.size });
    shader.vertexShader = `attribute float weatherPhase;
uniform float weatherElapsed; uniform float weatherBase; uniform float weatherSpan;
uniform float weatherSpeed; uniform float weatherSize;\n${shader.vertexShader}`;
    if (snow) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed *= weatherSize * (0.65 + weatherPhase * 0.9);');
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  mvPosition.y += weatherBase + fract(weatherPhase - weatherElapsed * ${snow ? '0.00022' : '0.00078 * weatherSpeed'}) * weatherSpan - instanceMatrix[3].y;
  ${snow ? 'float drift = weatherPhase * 6.28318530718 + weatherElapsed * 0.00055; mvPosition.x += sin(drift) * 1.35; mvPosition.z += cos(drift * 0.72) * 0.8;' : ''}
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => `blockcolc-precipitation-${snow ? 'snow' : 'rain'}-v1`;
  return uniforms;
}
