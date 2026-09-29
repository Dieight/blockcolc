import * as THREE from "three";

export interface LightingPostProcessDiagnostics {
  enabled: boolean;
  scale: number;
  passCount: number;
  renderCount: number;
  sampleCount: number;
}

export interface PreparedLightingPostProcessConfiguration {
  commit(): void;
  rollback(): void;
  finalize(): void;
  discard(): void;
}

/** The terminal fullscreen pass must match Three's direct ACES + sRGB output path. */
export const POSTPROCESS_TERMINAL_TONE_MAPPED = true;

/**
 * Small, mobile-oriented bloom compositor. The scene remains the normal
 * forward-rendered scene; only the bright texture and two blur passes use a
 * half-resolution target. This keeps the expensive path opt-in and bounded.
 */
export class LightingPostProcessor {
  private readonly renderer: THREE.WebGLRenderer;
  private sceneTarget: THREE.WebGLRenderTarget;
  private brightTarget: THREE.WebGLRenderTarget;
  private blurTarget: THREE.WebGLRenderTarget;
  private compositeTarget: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly quad = new THREE.Mesh(this.quadGeometry);
  private readonly brightMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private enabled = false;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private renderCount = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.sceneTarget = createTarget(1, 1, true);
    this.sceneTarget.samples = boundedSceneSampleCount(renderer.capabilities.maxSamples);
    // The scene target is sampled as linear data by the bloom shaders. Encoding
    // happens exactly once in the terminal composite pass.
    this.sceneTarget.texture.colorSpace = THREE.NoColorSpace;
    this.brightTarget = createTarget(1, 1, false);
    this.blurTarget = createTarget(1, 1, false);
    this.compositeTarget = createTarget(1, 1, false);

    this.brightMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: this.sceneTarget.texture },
        uThreshold: { value: 0.72 },
        uSoftKnee: { value: 0.22 },
      },
      vertexShader: fullscreenVertexShader,
      fragmentShader: brightFragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: this.brightTarget.texture },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: fullscreenVertexShader,
      fragmentShader: blurFragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneTarget.texture },
        tBloom: { value: this.brightTarget.texture },
        uBloomStrength: { value: 0.28 },
        uVignette: { value: 0 },
      },
      vertexShader: fullscreenVertexShader,
      fragmentShader: terminalCompositeFragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: POSTPROCESS_TERMINAL_TONE_MAPPED,
    });
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  configure(enabled: boolean, bloomStrength = 0.28, width = this.width, height = this.height, pixelRatio = this.pixelRatio): void {
    const prepared = this.prepareConfiguration(enabled, bloomStrength, width, height, pixelRatio);
    prepared.commit();
    prepared.finalize();
  }

  prepareConfiguration(enabled: boolean, bloomStrength = 0.28, width = this.width, height = this.height,
    pixelRatio = this.pixelRatio): PreparedLightingPostProcessConfiguration {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const nextPixelRatio = Math.max(0.5, pixelRatio);
    const drawingWidth = Math.max(1, Math.round(nextWidth * nextPixelRatio));
    const drawingHeight = Math.max(1, Math.round(nextHeight * nextPixelRatio));
    if (this.enabled === enabled && this.width === nextWidth && this.height === nextHeight
      && this.pixelRatio === nextPixelRatio
      && this.sceneTarget.width === (enabled ? drawingWidth : 1)
      && this.sceneTarget.height === (enabled ? drawingHeight : 1)) {
      let state: "staged" | "committed" | "discarded" = "staged";
      const previousStrength = this.compositeMaterial.uniforms.uBloomStrength!.value as number;
      return {
        commit: () => {
          if (state !== "staged") return;
          this.compositeMaterial.uniforms.uBloomStrength!.value = THREE.MathUtils.clamp(bloomStrength, 0, 0.75);
          state = "committed";
        },
        rollback: () => {
          if (state !== "committed") return;
          this.compositeMaterial.uniforms.uBloomStrength!.value = previousStrength;
          state = "staged";
        },
        finalize: () => { if (state === "committed") state = "discarded"; },
        discard: () => { if (state === "staged") state = "discarded"; },
      };
    }
    const next = createTargets(this.renderer, enabled ? drawingWidth : 1, enabled ? drawingHeight : 1);
    const previous = this.readTargets();
    const previousConfiguration = { width: this.width, height: this.height, pixelRatio: this.pixelRatio, enabled: this.enabled,
      bloomStrength: this.compositeMaterial.uniforms.uBloomStrength!.value as number };
    let state: "staged" | "committed" | "discarded" = "staged";
    return {
      commit: () => {
        if (state !== "staged") return;
        try {
          this.commitTargets(next);
          this.width = nextWidth;
          this.height = nextHeight;
          this.pixelRatio = nextPixelRatio;
          this.enabled = enabled;
          this.compositeMaterial.uniforms.uBloomStrength!.value = THREE.MathUtils.clamp(bloomStrength, 0, 0.75);
          state = "committed";
        } catch (error) {
          this.commitTargets(previous);
          this.width = previousConfiguration.width;
          this.height = previousConfiguration.height;
          this.pixelRatio = previousConfiguration.pixelRatio;
          this.enabled = previousConfiguration.enabled;
          this.compositeMaterial.uniforms.uBloomStrength!.value = previousConfiguration.bloomStrength;
          throw error;
        }
      },
      rollback: () => {
        if (state !== "committed") return;
        this.commitTargets(previous);
        this.width = previousConfiguration.width;
        this.height = previousConfiguration.height;
        this.pixelRatio = previousConfiguration.pixelRatio;
        this.enabled = previousConfiguration.enabled;
        this.compositeMaterial.uniforms.uBloomStrength!.value = previousConfiguration.bloomStrength;
        state = "staged";
      },
      finalize: () => {
        if (state !== "committed") return;
        state = "discarded";
        disposeTargets(previous);
      },
      discard: () => {
        if (state !== "staged") return;
        state = "discarded";
        disposeTargets(next);
      },
    };
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const nextPixelRatio = Math.max(0.5, pixelRatio);
    if (this.enabled) {
      const current = this.readTargets();
      const next = createTargets(this.renderer,
        Math.max(1, Math.round(nextWidth * nextPixelRatio)),
        Math.max(1, Math.round(nextHeight * nextPixelRatio)));
      this.commitTargets(next);
      disposeTargets(current);
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = nextPixelRatio;
  }

  private readTargets(): TargetBundle {
    return { sceneTarget: this.sceneTarget, brightTarget: this.brightTarget,
      blurTarget: this.blurTarget, compositeTarget: this.compositeTarget };
  }

  private commitTargets(targets: TargetBundle): void {
    this.sceneTarget = targets.sceneTarget;
    this.brightTarget = targets.brightTarget;
    this.blurTarget = targets.blurTarget;
    this.compositeTarget = targets.compositeTarget;
    this.brightMaterial.uniforms.tSource!.value = targets.sceneTarget.texture;
    this.blurMaterial.uniforms.tSource!.value = targets.brightTarget.texture;
    this.compositeMaterial.uniforms.tScene!.value = targets.sceneTarget.texture;
    const width = Math.max(1, Math.ceil(targets.sceneTarget.width * 0.5));
    const height = Math.max(1, Math.ceil(targets.sceneTarget.height * 0.5));
    this.blurMaterial.uniforms.uTexelSize!.value.set(1 / width, 1 / height);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.clear(true, true, false);
    this.renderer.render(scene, camera);

    this.quad.material = this.brightMaterial;
    this.renderQuad(this.brightTarget);
    this.blurMaterial.uniforms.tSource!.value = this.brightTarget.texture;
    this.blurMaterial.uniforms.uDirection!.value.set(1, 0);
    this.quad.material = this.blurMaterial;
    this.renderQuad(this.blurTarget);
    this.blurMaterial.uniforms.tSource!.value = this.blurTarget.texture;
    this.blurMaterial.uniforms.uDirection!.value.set(0, 1);
    this.renderQuad(this.compositeTarget);

    this.compositeMaterial.uniforms.tBloom!.value = this.compositeTarget.texture;
    this.quad.material = this.compositeMaterial;
    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderCount += 1;
  }

  getDiagnostics(): LightingPostProcessDiagnostics {
    return {
      enabled: this.enabled,
      scale: 0.5,
      passCount: this.enabled ? 4 : 0,
      renderCount: this.renderCount,
      sampleCount: this.enabled ? this.sceneTarget.samples : 0,
    };
  }

  dispose(): void {
    disposeTargets(this.readTargets());
    this.quadGeometry.dispose();
    this.brightMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
  }

  private renderQuad(target: THREE.WebGLRenderTarget): void {
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.quadScene, this.quadCamera);
  }
}

export function boundedSceneSampleCount(maxSamples: number): number {
  return Number.isFinite(maxSamples) && maxSamples >= 2 ? 2 : 0;
}

interface TargetBundle {
  sceneTarget: THREE.WebGLRenderTarget;
  brightTarget: THREE.WebGLRenderTarget;
  blurTarget: THREE.WebGLRenderTarget;
  compositeTarget: THREE.WebGLRenderTarget;
}

function createTargets(renderer: THREE.WebGLRenderer, width: number, height: number): TargetBundle {
  const targets: Partial<TargetBundle> = {};
  try {
    targets.sceneTarget = createTarget(width, height, true);
    targets.sceneTarget.samples = boundedSceneSampleCount(renderer.capabilities.maxSamples);
    targets.sceneTarget.texture.colorSpace = THREE.NoColorSpace;
    const halfWidth = Math.max(1, Math.ceil(width * 0.5));
    const halfHeight = Math.max(1, Math.ceil(height * 0.5));
    targets.brightTarget = createTarget(halfWidth, halfHeight, false);
    targets.blurTarget = createTarget(halfWidth, halfHeight, false);
    targets.compositeTarget = createTarget(halfWidth, halfHeight, false);
    return targets as TargetBundle;
  } catch (error) {
    disposeTargets(targets as TargetBundle);
    throw error;
  }
}

function disposeTargets(targets: Partial<TargetBundle>): void {
  targets.sceneTarget?.dispose();
  targets.brightTarget?.dispose();
  targets.blurTarget?.dispose();
  targets.compositeTarget?.dispose();
}

function createTarget(width: number, height: number, depthBuffer: boolean): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer,
    stencilBuffer: false,
  });
}

const fullscreenVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const brightFragmentShader = `
uniform sampler2D tSource;
uniform float uThreshold;
uniform float uSoftKnee;
varying vec2 vUv;
void main() {
  vec3 color = texture2D(tSource, vUv).rgb;
  float brightness = max(color.r, max(color.g, color.b));
  float contribution = smoothstep(uThreshold - uSoftKnee, uThreshold + uSoftKnee, brightness);
  gl_FragColor = vec4(color * contribution, 1.0);
}`;

const blurFragmentShader = `
uniform sampler2D tSource;
uniform vec2 uDirection;
uniform vec2 uTexelSize;
varying vec2 vUv;
void main() {
  vec2 stepUv = uDirection * uTexelSize;
  vec3 color = texture2D(tSource, vUv).rgb * 0.227027;
  color += texture2D(tSource, vUv + stepUv * 1.384615).rgb * 0.316216;
  color += texture2D(tSource, vUv - stepUv * 1.384615).rgb * 0.316216;
  color += texture2D(tSource, vUv + stepUv * 3.230769).rgb * 0.070270;
  color += texture2D(tSource, vUv - stepUv * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(color, 1.0);
}`;

export const terminalCompositeFragmentShader = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloomStrength;
uniform float uVignette;
varying vec2 vUv;
void main() {
  vec3 sceneColor = texture2D(tScene, vUv).rgb;
  vec3 bloomColor = texture2D(tBloom, vUv).rgb;
  vec2 centered = vUv * 2.0 - 1.0;
  float vignette = 1.0 - smoothstep(0.35, 1.25, dot(centered, centered)) * uVignette;
  gl_FragColor = vec4((sceneColor + bloomColor * uBloomStrength) * vignette, 1.0);
  #include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
