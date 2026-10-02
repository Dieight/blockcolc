import * as THREE from 'three';
import { glassMaterialFor, glassRegionFor, type GlassSurfacePreference } from './glass-material';
export { glassMaterialFor, glassRegionFor, type GlassSurfacePreference } from './glass-material';

const vertexShader = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// The input is an already tone-mapped, sRGB framebuffer. Do not decode it as a
// material texture or tone-map it again. Blur samples stay at their original
// coordinates: this is scattering, not edge displacement/refraction.
const fragmentShader = `uniform sampler2D source;
uniform vec2 stepUv;
uniform float saturation;
uniform float brightness;
uniform float finishPass;
varying vec2 vUv;
void main() {
  vec3 rgb = vec3(0.0);
  float weights = 0.0;
  for (int i = -6; i <= 6; i++) {
    float weight = exp(-float(i * i) / 8.0);
    rgb += texture2D(source, clamp(vUv + float(i) * stepUv, vec2(0.001), vec2(0.999))).rgb * weight;
    weights += weight;
  }
  rgb /= weights;
  if (finishPass > 0.5) {
    float luminance = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = mix(vec3(luminance), rgb, saturation) * brightness;
  }
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

/** Two bounded GPU draws inside the world's existing frame. No readPixels,
 * Canvas2D, extra context, animation loop, foreground text, or gesture layer. */
export class GlassWorldCompositor {
  private frame = new THREE.FramebufferTexture(1, 1);
  private horizontal = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geometry = new THREE.PlaneGeometry(2, 2);
  private material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { source: { value: this.frame }, stepUv: { value: new THREE.Vector2() },
      saturation: { value: 1 }, brightness: { value: 1 }, finishPass: { value: 0 } },
  });
  private preference: GlassSurfacePreference | null = null;
  private failed = false;
  private copies = 0;
  private lastCpuMs = 0;
  private mode: 'none' | 'gpu' | 'css' | 'solid' = 'none';
  private size = new THREE.Vector2();
  private viewport = new THREE.Vector4();
  private scissor = new THREE.Vector4();
  private origin = new THREE.Vector2();

  constructor(private renderer: THREE.WebGLRenderer) {
    this.configureTexture(this.frame);
    this.horizontal.texture.colorSpace = THREE.NoColorSpace;
    this.material.name = 'blockcolc-glass-scattering';
    const quad = new THREE.Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setPreference(preference: GlassSurfacePreference | null): void {
    this.preference = preference ? { ...preference } : null;
    if (!preference?.enabled || preference.reducedTransparency) {
      this.releaseLargeTargets();
      this.mode = preference?.enabled && preference.reducedTransparency ? 'solid' : 'none';
    }
  }

  private configureTexture(texture: THREE.FramebufferTexture): void {
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
  }

  private releaseLargeTargets(): void {
    if (this.frame.image.width !== 1 || this.frame.image.height !== 1) {
      this.frame.dispose();
      this.frame = new THREE.FramebufferTexture(1, 1);
      this.configureTexture(this.frame);
    }
    this.horizontal.setSize(1, 1);
  }

  render(bottom: number, right: number): void {
    const preference = this.preference;
    if (!preference?.enabled || preference.reducedTransparency) return;
    if (this.failed) { this.mode = 'css'; return; }
    this.renderer.getDrawingBufferSize(this.size);
    const region = glassRegionFor(this.size.x, this.size.y, bottom, right);
    if (!region) { this.releaseLargeTargets(); this.mode = 'none'; return; }
    // Native panel pixels only; cap allocations instead of copying a truncated
    // piece and stretching it across a larger screen. Unsupported sizes use CSS.
    const limit = Math.min(4096, this.renderer.capabilities.maxTextureSize);
    if (region.width > limit || region.height > limit) { this.releaseLargeTargets(); this.mode = 'css'; return; }
    const started = performance.now();
    const previousTarget = this.renderer.getRenderTarget();
    const autoClear = this.renderer.autoClear;
    this.renderer.getViewport(this.viewport);
    this.renderer.getScissor(this.scissor);
    const scissorTest = this.renderer.getScissorTest();
    try {
      if (this.frame.image.width !== region.width || this.frame.image.height !== region.height) {
        this.frame.dispose();
        this.frame = new THREE.FramebufferTexture(region.width, region.height);
        this.configureTexture(this.frame);
      }
      this.horizontal.setSize(Math.max(1, Math.ceil(region.width / 2)), Math.max(1, Math.ceil(region.height / 2)));
      const material = glassMaterialFor(preference.clarity);
      const ratio = this.renderer.getPixelRatio();
      // Scene/bloom has finished into the native backbuffer at this point.
      this.renderer.setRenderTarget(null);
      this.renderer.copyFramebufferToTexture(this.frame, this.origin.set(region.x, region.y));
      this.copies++;
      this.renderer.autoClear = false;
      this.renderer.setScissorTest(false);
      this.material.uniforms.source!.value = this.frame;
      this.material.uniforms.stepUv!.value.set(material.blur * ratio / (3 * region.width), 0);
      this.material.uniforms.finishPass!.value = 0;
      this.renderer.setRenderTarget(this.horizontal);
      this.renderer.render(this.scene, this.camera);
      this.material.uniforms.source!.value = this.horizontal.texture;
      this.material.uniforms.stepUv!.value.set(0, material.blur * ratio / (3 * region.height));
      this.material.uniforms.saturation!.value = material.saturation;
      this.material.uniforms.brightness!.value = preference.theme === 'dark' ? .92 : material.brightness;
      this.material.uniforms.finishPass!.value = 1;
      this.renderer.setRenderTarget(null);
      this.renderer.setViewport(region.x / ratio, region.y / ratio, region.width / ratio, region.height / ratio);
      this.renderer.setScissor(region.x / ratio, region.y / ratio, region.width / ratio, region.height / ratio);
      this.renderer.setScissorTest(true);
      this.renderer.render(this.scene, this.camera);
      this.mode = 'gpu';
    } catch (error) {
      this.failed = true;
      this.releaseLargeTargets();
      this.mode = 'css';
      console.warn('World glass compositor unavailable; using CSS material', error);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setViewport(this.viewport);
      this.renderer.setScissor(this.scissor);
      this.renderer.setScissorTest(scissorTest);
      this.renderer.autoClear = autoClear;
      this.lastCpuMs = performance.now() - started;
    }
  }

  getDiagnostics() {
    return { mode: this.mode, copies: this.copies, cpuMs: this.lastCpuMs,
      width: this.frame.image.width, height: this.frame.image.height,
      blurWidth: this.horizontal.width, blurHeight: this.horizontal.height };
  }

  dispose(): void {
    this.frame.dispose(); this.horizontal.dispose(); this.geometry.dispose(); this.material.dispose();
    this.preference = null;
  }
}
