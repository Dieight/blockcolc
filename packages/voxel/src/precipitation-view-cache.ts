export type PrecipitationViewVector = readonly [number, number, number];

/** Fixed, bounded renderer state used to gate view-dependent precipitation work. */
export interface PrecipitationViewSample {
  cameraDistance: number;
  cameraPosition: PrecipitationViewVector;
  cameraDirection: PrecipitationViewVector;
  cameraUp: PrecipitationViewVector;
  fovDegrees: number;
  aspect: number;
  near: number;
  far: number;
  rootRotationY: number;
  rootTransform: readonly number[];
  viewportWidthCss: number;
  viewportHeightCss: number;
  rainBaseCrossSection: number;
  targetProjectedCssPx: number;
  maximumCrossSectionScale: number;
}

export interface PrecipitationViewCache {
  projectionKey: string | null;
  crossSectionKey: string | null;
  invalidated: boolean;
}

export interface PrecipitationViewCacheDecision {
  cache: PrecipitationViewCache;
  projectionChanged: boolean;
  crossSectionChanged: boolean;
  changed: boolean;
}

export function emptyPrecipitationViewCache(): PrecipitationViewCache {
  return { projectionKey: null, crossSectionKey: null, invalidated: true };
}

export function invalidatePrecipitationViewCache(cache: PrecipitationViewCache): PrecipitationViewCache {
  return { ...cache, invalidated: true };
}

/** Keeps a rain particle at its field position under the mesh's X/Z cross-section scale. */
export function rainParticleInstanceCoordinate(worldCoordinate: number, meshScale: number): number {
  const safeCoordinate = Number.isFinite(worldCoordinate) ? worldCoordinate : 0;
  const safeScale = Number.isFinite(meshScale) && meshScale > 0.0001 ? meshScale : 1;
  return safeCoordinate / safeScale;
}

export function rainParticleMatricesNeedRewrite(
  fieldChanged: boolean,
  previousScale: number,
  nextScale: number,
): boolean {
  return fieldChanged || !Number.isFinite(previousScale) || !Number.isFinite(nextScale)
    || Math.abs(previousScale - nextScale) > 1e-6;
}

/**
 * Returns view-only work deltas. The keys contain a fixed set of quantized
 * camera/projection/root/viewport values; no per-frame history can accumulate.
 */
export function updatePrecipitationViewCache(
  cache: PrecipitationViewCache,
  sample: PrecipitationViewSample,
  enabled = true,
): PrecipitationViewCacheDecision {
  if (!enabled) {
    return {
      cache: invalidatePrecipitationViewCache(cache),
      projectionChanged: false,
      crossSectionChanged: false,
      changed: false,
    };
  }
  const projectionKey = stableKey([
    ...sample.cameraPosition,
    ...sample.cameraDirection,
    ...sample.cameraUp,
    sample.fovDegrees, sample.aspect, sample.near, sample.far,
    sample.rootRotationY,
    ...sample.rootTransform.slice(0, 16),
    sample.viewportWidthCss, sample.viewportHeightCss,
  ]);
  const crossSectionKey = stableKey([
    sample.cameraDistance,
    sample.fovDegrees,
    sample.viewportHeightCss,
    sample.rainBaseCrossSection,
    sample.targetProjectedCssPx,
    sample.maximumCrossSectionScale,
  ]);
  const projectionChanged = cache.invalidated || cache.projectionKey !== projectionKey;
  const crossSectionChanged = cache.invalidated || cache.crossSectionKey !== crossSectionKey;
  return {
    cache: { projectionKey, crossSectionKey, invalidated: false },
    projectionChanged,
    crossSectionChanged,
    changed: projectionChanged || crossSectionChanged,
  };
}

function stableKey(values: readonly number[]): string {
  return values.map((value) => {
    if (!Number.isFinite(value)) return "invalid";
    const rounded = Math.round(value * 1_000) / 1_000;
    return (Object.is(rounded, -0) ? 0 : rounded).toFixed(3);
  }).join(",");
}
