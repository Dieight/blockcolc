import * as THREE from "three";

export interface LightingPostProcessDiagnostics {
  enabled: boolean;
  scale: number;
  passCount: number;
  renderCount: number;
  sampleCount: number;
}

/**
 * Small, mobile-oriented bloom compositor. The scene remains the normal
 * forward-rendered scene; only the bright texture and two blur passes use a
 * half-resolution target. This keeps the expensive path opt-in and bounded.
 */
export class LightingPostProcessor {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly brightTarget: THREE.WebGLRenderTarget;
  private readonly blurTarget: THREE.WebGLRenderTarget;
  private readonly compositeTarget: THREE.WebGLRenderTarget;
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
      fragmentShader: compositeFragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  configure(enabled: boolean, bloomStrength = 0.28): void {
    this.enabled = enabled;
    this.compositeMaterial.uniforms.uBloomStrength!.value = THREE.MathUtils.clamp(bloomStrength, 0, 0.75);
    if (enabled) this.resizeTargets();
    else this.releaseLargeTargets();
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.pixelRatio = Math.max(0.5, pixelRatio);
    if (!this.enabled) {
      this.releaseLargeTargets();
      return;
    }
    this.resizeTargets();
  }

  private resizeTargets(): void {
    const drawingWidth = Math.max(1, Math.round(this.width * this.pixelRatio));
    const drawingHeight = Math.max(1, Math.round(this.height * this.pixelRatio));
    this.sceneTarget.setSize(drawingWidth, drawingHeight);
    const halfWidth = Math.max(1, Math.ceil(drawingWidth * 0.5));
    const halfHeight = Math.max(1, Math.ceil(drawingHeight * 0.5));
    this.brightTarget.setSize(halfWidth, halfHeight);
    this.blurTarget.setSize(halfWidth, halfHeight);
    this.compositeTarget.setSize(halfWidth, halfHeight);
    this.blurMaterial.uniforms.uTexelSize!.value.set(1 / halfWidth, 1 / halfHeight);
  }

  private releaseLargeTargets(): void {
    this.sceneTarget.setSize(1, 1);
    this.brightTarget.setSize(1, 1);
    this.blurTarget.setSize(1, 1);
    this.compositeTarget.setSize(1, 1);
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
    this.sceneTarget.dispose();
    this.brightTarget.dispose();
    this.blurTarget.dispose();
    this.compositeTarget.dispose();
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

const compositeFragmentShader = `
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
#include <colorspace_fragment>
}`;
