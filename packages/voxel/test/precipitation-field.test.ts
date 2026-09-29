import { describe, expect, it } from "vitest";
import {
  precipitationFieldForView,
  precipitationPositionForOffset,
  rainCrossSectionScaleForView,
  stepPrecipitationClock,
  type PrecipitationFieldInput,
  type PrecipitationVector3,
} from "../src/precipitation-field";

const normalize = (vector: PrecipitationVector3): PrecipitationVector3 => {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};

const rotateY = (point: PrecipitationVector3, yaw: number): PrecipitationVector3 => ({
  x: Math.cos(yaw) * point.x + Math.sin(yaw) * point.z,
  y: point.y,
  z: -Math.sin(yaw) * point.x + Math.cos(yaw) * point.z,
});

function view(overrides: Partial<PrecipitationFieldInput> = {}): PrecipitationFieldInput {
  return {
    cameraPosition: { x: 0, y: 35, z: 42 },
    cameraDirection: normalize({ x: 0, y: -0.65, z: -0.76 }),
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
    maxSpanX: 150,
    maxSpanZ: 150,
    edgeMargin: 5,
    ...overrides,
  };
}

describe("camera-bounded precipitation field", () => {
  it("fits the frustum through the precipitation slab instead of the full terrain envelope", () => {
    const field = precipitationFieldForView(view());
    expect(field.usedFallback).toBe(false);
    expect(field.spanX).toBeGreaterThanOrEqual(24);
    expect(field.spanZ).toBeGreaterThanOrEqual(24);
    expect(field.spanX).toBeLessThanOrEqual(150);
    expect(field.spanZ).toBeLessThanOrEqual(150);
    expect(field.spanX * field.spanZ).toBeLessThan(150 * 150);
  });

  it("responds to zoom and aspect ratio while retaining finite bounds", () => {
    const near = precipitationFieldForView(view());
    const far = precipitationFieldForView(view({
      cameraPosition: { x: 0, y: 35, z: 100 },
      cameraDirection: normalize({ x: 0, y: -0.33, z: -0.94 }),
    }));
    const portrait = precipitationFieldForView(view({ aspect: 0.42 }));
    expect(far.spanZ).toBeGreaterThan(near.spanZ);
    expect(portrait.spanX).toBeLessThan(near.spanX);
    expect([far.spanX, far.spanZ, portrait.spanX, portrait.spanZ].every(Number.isFinite)).toBe(true);
  });

  it("returns the same root-local field when camera and world root rotate together", () => {
    const base = view();
    const yaw = Math.PI / 3;
    const rotated = precipitationFieldForView(view({
      cameraPosition: rotateY(base.cameraPosition, yaw),
      cameraDirection: rotateY(base.cameraDirection, yaw),
      cameraUp: rotateY(base.cameraUp, yaw),
      target: rotateY(base.target, yaw),
      rootRotationY: yaw,
    }));
    const original = precipitationFieldForView(base);
    expect(rotated.centerX).toBeCloseTo(original.centerX, 5);
    expect(rotated.centerZ).toBeCloseTo(original.centerZ, 5);
    expect(rotated.spanX).toBeCloseTo(original.spanX, 5);
    expect(rotated.spanZ).toBeCloseTo(original.spanZ, 5);
  });

  it("keeps preview precipitation inside its independent blueprint-scale bounds", () => {
    const field = precipitationFieldForView(view({
      bounds: { minX: -9, maxX: 9, minZ: -7, maxZ: 7 },
      minSpanX: 8,
      minSpanZ: 8,
      maxSpanX: 18,
      maxSpanZ: 14,
      target: { x: 20, y: 0, z: 20 },
    }));
    expect(field.spanX).toBeLessThanOrEqual(18);
    expect(field.spanZ).toBeLessThanOrEqual(14);
    expect(field.centerX - field.spanX / 2).toBeGreaterThanOrEqual(-9);
    expect(field.centerX + field.spanX / 2).toBeLessThanOrEqual(9);
    expect(field.centerZ - field.spanZ / 2).toBeGreaterThanOrEqual(-7);
    expect(field.centerZ + field.spanZ / 2).toBeLessThanOrEqual(7);
  });

  it("uses a bounded target fallback for invalid camera vectors", () => {
    const field = precipitationFieldForView(view({
      cameraDirection: { x: 0, y: 0, z: 0 },
      target: { x: 700, y: 0, z: -700 },
      maxSpanX: 60,
      maxSpanZ: 48,
    }));
    expect(field.usedFallback).toBe(true);
    expect(field.spanX).toBeLessThanOrEqual(60);
    expect(field.spanZ).toBeLessThanOrEqual(48);
    expect(field.centerX).toBeLessThanOrEqual(720 - field.spanX / 2);
    expect(field.centerZ).toBeGreaterThanOrEqual(-720 + field.spanZ / 2);
  });

  it("sanitizes invalid sizing, margin and rotated fallback target inputs", () => {
    const yaw = Math.PI / 4;
    const targetLocal = { x: 40, y: 0, z: -30 };
    const targetWorld = rotateY(targetLocal, yaw);
    const field = precipitationFieldForView(view({
      cameraDirection: { x: 0, y: 0, z: 0 },
      target: targetWorld,
      rootRotationY: yaw,
      minSpanX: Number.POSITIVE_INFINITY,
      minSpanZ: 40,
      maxSpanX: Number.NaN,
      maxSpanZ: 24,
      edgeMargin: Number.NEGATIVE_INFINITY,
    }));
    expect(field.usedFallback).toBe(true);
    expect([field.centerX, field.centerZ, field.spanX, field.spanZ].every(Number.isFinite)).toBe(true);
    expect(field.centerX).toBeCloseTo(targetLocal.x, 5);
    expect(field.centerZ).toBeCloseTo(targetLocal.z, 5);
    expect(field.spanX).toBeLessThanOrEqual(96);
    expect(field.spanZ).toBeLessThanOrEqual(24);

    const reversedCap = precipitationFieldForView(view({
      cameraDirection: { x: 0, y: 0, z: 0 },
      maxSpanX: -10,
      minSpanX: 40,
      maxSpanZ: Number.NEGATIVE_INFINITY,
      minSpanZ: 30,
    }));
    expect(reversedCap.usedFallback).toBe(true);
    expect([reversedCap.centerX, reversedCap.centerZ, reversedCap.spanX, reversedCap.spanZ]
      .every(Number.isFinite)).toBe(true);
    expect(reversedCap.spanX).toBeLessThanOrEqual(96);
    expect(reversedCap.spanZ).toBeLessThanOrEqual(96);
  });

  it("keeps fallback finite for very large valid bounds and an invalid camera", () => {
    const field = precipitationFieldForView(view({
      cameraDirection: { x: 0, y: 0, z: 0 },
      bounds: { minX: 1e308, maxX: 1.1e308, minZ: -1.1e308, maxZ: -1e308 },
      target: { x: Number.NaN, y: 0, z: Number.POSITIVE_INFINITY },
      minSpanX: Number.NaN,
      maxSpanX: Number.NEGATIVE_INFINITY,
      minSpanZ: Number.POSITIVE_INFINITY,
      maxSpanZ: 0,
      edgeMargin: Number.POSITIVE_INFINITY,
    }));
    expect(field.usedFallback).toBe(true);
    expect([field.centerX, field.centerZ, field.spanX, field.spanZ].every(Number.isFinite)).toBe(true);
    expect(field.spanX).toBeLessThanOrEqual(ABSOLUTE_FALLBACK_LIMIT);
    expect(field.spanZ).toBeLessThanOrEqual(ABSOLUTE_FALLBACK_LIMIT);
  });

  it("returns a finite empty field for zero-sized or unusably tiny bounds", () => {
    const field = precipitationFieldForView(view({
      bounds: { minX: 0, maxX: 0, minZ: -4, maxZ: 4 },
      minSpanX: Number.NaN,
      maxSpanZ: Number.POSITIVE_INFINITY,
    }));
    expect(field).toEqual({ centerX: 0, centerZ: 0, spanX: 0, spanZ: 0, usedFallback: true });

    const tiny = precipitationFieldForView(view({
      bounds: { minX: 2, maxX: 2.005, minZ: -4, maxZ: 4 },
    }));
    expect(tiny).toEqual({ centerX: 0, centerZ: 0, spanX: 0, spanZ: 0, usedFallback: true });
  });

  it("reuses stable normalized offsets when camera framing changes", () => {
    const offsets = [{ x: -0.5, z: 0.25 }, { x: 0.1, z: -0.4 }, { x: 0.5, z: 0.5 }];
    const first = precipitationFieldForView(view());
    const second = precipitationFieldForView(view({
      cameraPosition: { x: 0, y: 35, z: 80 },
      cameraDirection: normalize({ x: 0, y: -0.42, z: -0.91 }),
    }));
    const remapped = offsets.map(offset => precipitationPositionForOffset(second, offset.x, offset.z));
    expect(remapped).toEqual(offsets.map(offset => precipitationPositionForOffset(second, offset.x, offset.z)));
    expect(precipitationPositionForOffset(first, offsets[0]!.x, offsets[0]!.z))
      .not.toEqual(remapped[0]);
    expect(remapped.every(point => Number.isFinite(point.x) && Number.isFinite(point.z))).toBe(true);
  });

  it("widens rain cross-sections only within the approved bounded view scale", () => {
    const input = { baseCrossSection: 0.028, fovDegrees: 34, viewportHeightCss: 800,
      targetProjectedCssPx: 1.2, maximumScale: 3 };
    const far = rainCrossSectionScaleForView({ ...input, cameraDistance: 100 });
    const near = rainCrossSectionScaleForView({ ...input, cameraDistance: 20 });
    expect(far.scale).toBeGreaterThan(near.scale);
    expect(far.scale).toBeLessThanOrEqual(3);
    expect(near.scale).toBe(1);
    expect(near.scale).toBeLessThanOrEqual(3);
    expect(far.projectedCssPx).toBeGreaterThan(1);
    expect(far.projectedCssPx).toBeLessThanOrEqual(1.2);
  });

  it("freezes elapsed motion while paused and resumes without catching up hidden time", () => {
    const paused = stepPrecipitationClock({ elapsedMs: 500, lastUpdateMs: 1_000, paused: false }, 1_080, true, 80);
    expect(paused).toEqual({ elapsedMs: 500, lastUpdateMs: 1_080, paused: true, advanced: false, resumed: false });
    const resumed = stepPrecipitationClock(paused, 50_000, false, 80);
    expect(resumed).toEqual({ elapsedMs: 500, lastUpdateMs: 50_000, paused: false, advanced: false, resumed: true });
    const nextTick = stepPrecipitationClock(resumed, 50_080, false, 80);
    expect(nextTick).toEqual({ elapsedMs: 580, lastUpdateMs: 50_080, paused: false, advanced: true, resumed: false });
  });
});

const ABSOLUTE_FALLBACK_LIMIT = 4096;
