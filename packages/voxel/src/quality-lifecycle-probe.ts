type Stage =
  | 'atlas-build-start' | 'atlas-build-end' | 'atlas-build-complete' | 'atlas-disposed'
  | 'quality-apply-start' | 'quality-apply-end' | 'quality-projection-complete'
  | 'world-rebuild-start' | 'world-rebuild-end' | 'world-rebuild-complete'
  | 'first-nonempty-frame' | 'visible-world-frame';
type Preference = 'auto' | 'performance' | 'balanced' | 'cinematic';
type Tier = 'low' | 'balanced' | 'high';
interface Metrics {
  durationMs?: number; rendererGeneration?: number; worldRebuildCount?: number;
  renderedWorldRebuildCount?: number; renderedTriangleCount?: number; worldIdentityFingerprint?: number;
  atlasInstance?: number; atlasPageCount?: number;
  atlasTextureCount?: number; devicePixelRatio?: number; pixelRatio?: number;
  shadowMapSize?: number; localLightCount?: number; localLightCreatedCount?: number;
  glowSpriteCount?: number; glowSpriteCreatedCount?: number;
  naturalTreeCount?: number; ambientDecorationCount?: number; weatherParticleCount?: number;
  starCount?: number; requestedPreference?: Preference; effectiveTier?: Tier;
  status?: 'ok' | 'failed' | 'stale' | 'fallback';
}
type ProbeWindow = {
  __blockcolcQualityLifecycle?: { record(stage: Stage, metrics?: Metrics): void };
  __blockcolcQualityGpuDiagnostics?: {
    sampleVisibleFrameError(gl: WebGLRenderingContext | WebGL2RenderingContext): void;
  };
};

const enabled = import.meta.env.MODE === 'test';
const atlasInstances = new WeakMap<object, number>();
let nextAtlasInstance = 1;

export function qualityLifecycleProbe(stage: Stage, metrics?: Metrics): void {
  if (!enabled || typeof window === 'undefined') return;
  (window as unknown as ProbeWindow).__blockcolcQualityLifecycle?.record(stage, metrics);
}

export function qualityLifecycleProbeEnabled(): boolean {
  return enabled;
}

export function qualityLifecycleSampleVisibleFrameError(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
  if (!enabled || typeof window === 'undefined') return;
  (window as unknown as ProbeWindow).__blockcolcQualityGpuDiagnostics?.sampleVisibleFrameError(gl);
}

export function qualityLifecycleAtlasInstance(atlas: object): number {
  if (!enabled) return 0;
  let instance = atlasInstances.get(atlas);
  if (instance === undefined) {
    instance = nextAtlasInstance++;
    atlasInstances.set(atlas, instance);
  }
  return instance;
}
