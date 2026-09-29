import { describe, expect, it } from "vitest";
import {
  emptyPrecipitationViewCache,
  invalidatePrecipitationViewCache,
  rainParticleInstanceCoordinate,
  rainParticleMatricesNeedRewrite,
  updatePrecipitationViewCache,
  type PrecipitationViewSample,
} from "../src/precipitation-view-cache";
import { precipitationFieldForView, type PrecipitationFieldInput } from "../src/precipitation-field";

const sample = (overrides: Partial<PrecipitationViewSample> = {}): PrecipitationViewSample => ({
  cameraDistance: 42,
  cameraPosition: [0, 35, 42],
  cameraDirection: [0, -0.65, -0.76],
  cameraUp: [0, 1, 0],
  fovDegrees: 34,
  aspect: 1.5,
  near: 0.1,
  far: 400,
  rootRotationY: 0,
  rootTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  viewportWidthCss: 900,
  viewportHeightCss: 600,
  rainBaseCrossSection: 0.028,
  targetProjectedCssPx: 1.2,
  maximumCrossSectionScale: 3,
  ...overrides,
});

const fieldInput = (overrides: Partial<PrecipitationFieldInput> = {}): PrecipitationFieldInput => ({
  cameraPosition: { x: 0, y: 35, z: 42 },
  cameraDirection: { x: 0, y: -0.65, z: -0.76 },
  cameraUp: { x: 0, y: 1, z: 0 },
  fovDegrees: 34,
  aspect: 1.5,
  near: 0.1,
  far: 400,
  rootRotationY: 0,
  precipitationMinY: -2,
  precipitationMaxY: 80,
  target: { x: 0, y: 0, z: 0 },
  bounds: { minX: -720, maxX: 720, minZ: -720, maxZ: 720 },
  minSpanX: 24,
  minSpanZ: 24,
  maxSpanX: 48,
  maxSpanZ: 48,
  edgeMargin: 6,
  ...overrides,
});

describe("precipitation view cache", () => {
  it("updates CSS cross-section and frustum projection when a clamped field stays identical", () => {
    const beforeInput = fieldInput();
    const afterInput = fieldInput({
      cameraPosition: { x: 0, y: 20, z: 21 },
      cameraDirection: { x: 0, y: -0.65, z: -0.76 },
    });
    const beforeField = precipitationFieldForView(beforeInput);
    const afterField = precipitationFieldForView(afterInput);
    expect(beforeField).toEqual(afterField);

    const first = updatePrecipitationViewCache(emptyPrecipitationViewCache(), sample());
    const zoomed = updatePrecipitationViewCache(first.cache, sample({
      cameraDistance: 21,
      cameraPosition: [0, 20, 21],
    }));
    expect(zoomed.changed).toBe(true);
    expect(zoomed.projectionChanged).toBe(true);
    expect(zoomed.crossSectionChanged).toBe(true);
  });

  it("keeps identical views a no-op and distinguishes viewport, yaw, and projection work", () => {
    const first = updatePrecipitationViewCache(emptyPrecipitationViewCache(), sample());
    const repeated = updatePrecipitationViewCache(first.cache, sample());
    expect(repeated.changed).toBe(false);
    expect(repeated.projectionChanged).toBe(false);
    expect(repeated.crossSectionChanged).toBe(false);

    const wide = updatePrecipitationViewCache(repeated.cache, sample({ viewportWidthCss: 1_200, viewportHeightCss: 700 }));
    expect(wide.projectionChanged).toBe(true);
    expect(wide.crossSectionChanged).toBe(true);
    const rotated = updatePrecipitationViewCache(wide.cache, sample({
      viewportWidthCss: 1_200,
      viewportHeightCss: 700,
      rootRotationY: Math.PI / 2,
      rootTransform: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1],
    }));
    expect(rotated.projectionChanged).toBe(true);
    expect(rotated.crossSectionChanged).toBe(false);
  });

  it("keeps a bounded invalidated cache while hidden and refreshes once after restore or reduced-motion change", () => {
    const first = updatePrecipitationViewCache(emptyPrecipitationViewCache(), sample());
    const hidden = updatePrecipitationViewCache(first.cache, sample({ cameraDistance: 10 }), false);
    expect(hidden.changed).toBe(false);
    expect(hidden.cache.invalidated).toBe(true);
    const restored = updatePrecipitationViewCache(hidden.cache, sample({ cameraDistance: 10 }));
    expect(restored.projectionChanged).toBe(true);
    expect(restored.crossSectionChanged).toBe(true);
    const reducedMotionChanged = updatePrecipitationViewCache(invalidatePrecipitationViewCache(restored.cache), sample({ cameraDistance: 10 }));
    expect(reducedMotionChanged.changed).toBe(true);
    const resumedNoOp = updatePrecipitationViewCache(reducedMotionChanged.cache, sample({ cameraDistance: 10 }));
    expect(resumedNoOp.changed).toBe(false);
  });

  it("rewrites only on field or physical rain-scale change and compensates 3-to-2 X/Z scaling", () => {
    const fieldPosition = { x: 23.5, z: -17.25 };
    const oldScale = 3;
    const nextScale = 2;
    const oldLocal = {
      x: rainParticleInstanceCoordinate(fieldPosition.x, oldScale),
      z: rainParticleInstanceCoordinate(fieldPosition.z, oldScale),
    };
    const nextLocal = {
      x: rainParticleInstanceCoordinate(fieldPosition.x, nextScale),
      z: rainParticleInstanceCoordinate(fieldPosition.z, nextScale),
    };
    const oldWorld = { x: oldLocal.x * oldScale, z: oldLocal.z * oldScale };
    const nextWorld = { x: nextLocal.x * nextScale, z: nextLocal.z * nextScale };
    expect(oldWorld).toEqual(fieldPosition);
    expect(nextWorld).toEqual(fieldPosition);
    // The logical position consumed by projectedParticleCount is the same point
    // the scaled instanced mesh places on screen, even while its clock is paused.
    expect(nextWorld).toEqual({ x: fieldPosition.x, z: fieldPosition.z });
    expect(rainParticleMatricesNeedRewrite(false, oldScale, nextScale)).toBe(true);
    expect(rainParticleMatricesNeedRewrite(false, oldScale, oldScale)).toBe(false);
    expect(rainParticleMatricesNeedRewrite(true, oldScale, oldScale)).toBe(true);
  });
});
