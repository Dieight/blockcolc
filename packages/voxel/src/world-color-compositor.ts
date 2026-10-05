import * as THREE from 'three';
import { normalizeWorldColor, worldColorIsNeutral, type WorldColorAdjustment } from './world-color-adjustment';

/** Grades the final sRGB world once, before the glass samples it. Neutral costs no draw/copy. */
export class WorldColorCompositor {
  private preference = normalizeWorldColor(null);
  private frame = new THREE.FramebufferTexture(1, 1);
  private readonly size = new THREE.Vector2();
  private readonly viewport = new THREE.Vector4();
  private readonly scissor = new THREE.Vector4();
  private readonly origin = new THREE.Vector2();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D source; uniform vec3 adjustment; varying vec2 vUv;
      void main(){vec3 rgb=texture2D(source,vUv).rgb;
        float y=dot(rgb,vec3(.2126,.7152,.0722));
        rgb=mix(vec3(y),rgb,adjustment.x);
        rgb=(rgb-.5)*adjustment.z+.5;
        gl_FragColor=vec4(clamp(rgb*adjustment.y,0.,1.),1.);}`,
    uniforms: { source: { value: this.frame }, adjustment: { value: new THREE.Vector3(1, 1, 1) } },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  private failed = false;
  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.frame.colorSpace = THREE.NoColorSpace;
    this.material.name = 'blockcolc-world-colour';
    const quad = new THREE.Mesh(this.geometry, this.material); quad.frustumCulled = false; this.scene.add(quad);
  }
  setPreference(input: WorldColorAdjustment | null): void {
    this.preference = normalizeWorldColor(input);
    this.material.uniforms.adjustment!.value.set(this.preference.saturation / 100, this.preference.brightness / 100, this.preference.contrast / 100);
    if (worldColorIsNeutral(this.preference) && (this.frame.image.width !== 1 || this.frame.image.height !== 1)) this.release();
  }
  private release() {
    this.frame.dispose(); this.frame = new THREE.FramebufferTexture(1, 1); this.frame.colorSpace = THREE.NoColorSpace;
    this.material.uniforms.source!.value = this.frame;
  }
  render(): boolean {
    if (this.failed || worldColorIsNeutral(this.preference)) return false;
    this.renderer.getDrawingBufferSize(this.size);
    if (this.size.x > this.renderer.capabilities.maxTextureSize || this.size.y > this.renderer.capabilities.maxTextureSize) return false;
    const target = this.renderer.getRenderTarget(), autoClear = this.renderer.autoClear, test = this.renderer.getScissorTest();
    this.renderer.getViewport(this.viewport); this.renderer.getScissor(this.scissor);
    try {
      if (this.frame.image.width !== this.size.x || this.frame.image.height !== this.size.y) {
        this.frame.dispose(); this.frame = new THREE.FramebufferTexture(this.size.x, this.size.y);
        this.frame.colorSpace = THREE.NoColorSpace; this.material.uniforms.source!.value = this.frame;
      }
      this.renderer.setRenderTarget(null);
      this.renderer.copyFramebufferToTexture(this.frame, this.origin.set(0, 0));
      this.renderer.autoClear = false; this.renderer.setScissorTest(false);
      const ratio = this.renderer.getPixelRatio();
      this.renderer.setViewport(0, 0, this.size.x / ratio, this.size.y / ratio);
      this.renderer.render(this.scene, this.camera); return true;
    } catch {
      this.failed = true; this.release(); return false;
    } finally {
      this.renderer.setRenderTarget(target); this.renderer.setViewport(this.viewport); this.renderer.setScissor(this.scissor);
      this.renderer.setScissorTest(test); this.renderer.autoClear = autoClear;
    }
  }
  dispose(): void { this.frame.dispose(); this.material.dispose(); this.geometry.dispose(); }
}
