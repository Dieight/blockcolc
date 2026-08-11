import { describe, expect, it } from "vitest";
import {
  angleBetween,
  LIGHTWEIGHT_SHADING_PROFILES,
  shadeVoxelFace,
  shadowTimeSlice,
  shouldRefreshShadow,
  warmCoolTint,
  type ShadowRefreshSample,
} from "../src/lightweight-shading";

describe("lightweight shading profiles", () => {
  it("keeps expensive optional effects in higher tiers", () => {
    expect(LIGHTWEIGHT_SHADING_PROFILES.low.features.halfResolutionBloom).toBe(false);
    expect(LIGHTWEIGHT_SHADING_PROFILES.low.features.cutoutShadows).toBe(false);
    expect(LIGHTWEIGHT_SHADING_PROFILES.balanced.features.simpleWaterHighlights).toBe(true);
    expect(LIGHTWEIGHT_SHADING_PROFILES.balanced.features.cutoutShadows).toBe(true);
    expect(LIGHTWEIGHT_SHADING_PROFILES.high.features.halfResolutionBloom).toBe(true);
    expect(LIGHTWEIGHT_SHADING_PROFILES.low.shadowRefresh.minimumIntervalMs)
      .toBeGreaterThan(LIGHTWEIGHT_SHADING_PROFILES.high.shadowRefresh.minimumIntervalMs);
    expect(LIGHTWEIGHT_SHADING_PROFILES.low.shadowRefresh.angularThresholdRadians)
      .toBeGreaterThan(LIGHTWEIGHT_SHADING_PROFILES.high.shadowRefresh.angularThresholdRadians);
  });
});

describe("warm/cool voxel face shading", () => {
  const profile = LIGHTWEIGHT_SHADING_PROFILES.balanced;

  it("makes lit top faces brighter and warmer than opposing or bottom faces", () => {
    const top = shadeVoxelFace({ normal: [0, 1, 0], lightDirection: [0, 1, 0], shadow: 0, ambientOcclusion: 0 }, profile);
    const side = shadeVoxelFace({ normal: [1, 0, 0], lightDirection: [0, 1, 0], shadow: 0, ambientOcclusion: 0 }, profile);
    const bottom = shadeVoxelFace({ normal: [0, -1, 0], lightDirection: [0, 1, 0], shadow: 0, ambientOcclusion: 0 }, profile);
    expect(top.brightness).toBeGreaterThan(side.brightness);
    expect(side.brightness).toBeGreaterThan(bottom.brightness);
    expect(top.warmMix).toBeGreaterThan(side.warmMix);
    expect(side.coolMix).toBeGreaterThan(top.coolMix);
  });

  it("darkens and cools shadowed or occluded faces without producing invalid ranges", () => {
    const lit = shadeVoxelFace({ normal: [0, 1, 0], lightDirection: [0, 1, 0], shadow: 0, ambientOcclusion: 0 }, profile);
    const shadowed = shadeVoxelFace({ normal: [0, 1, 0], lightDirection: [0, 1, 0], shadow: 1, ambientOcclusion: 0 }, profile);
    const occluded = shadeVoxelFace({ normal: [0, 1, 0], lightDirection: [0, 1, 0], shadow: 0, ambientOcclusion: 1 }, profile);
    expect(shadowed.brightness).toBeLessThan(lit.brightness);
    expect(shadowed.coolMix).toBeGreaterThan(lit.coolMix);
    expect(occluded.brightness).toBeLessThan(lit.brightness);
    for (const result of [lit, shadowed, occluded]) {
      expect(result.brightness).toBeGreaterThanOrEqual(0);
      expect(result.brightness).toBeLessThanOrEqual(1.5);
      expect(result.tintColor).toBeGreaterThanOrEqual(0);
      expect(result.tintColor).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("mixes colors deterministically and rejects zero-length vectors", () => {
    expect(warmCoolTint(0xffffff, 0xff0000, 0x0000ff, 1, 1)).toBe(0xff0000);
    expect(() => shadeVoxelFace({ normal: [0, 0, 0], lightDirection: [0, 1, 0], shadow: 0, ambientOcclusion: 0 }, profile)).toThrow(RangeError);
  });
});

describe("shadow refresh scheduling", () => {
  const policy = LIGHTWEIGHT_SHADING_PROFILES.balanced.shadowRefresh;
  const previous: ShadowRefreshSample = {
    sampledAtMs: 10_000,
    lightDirection: [0, 1, 0],
    cameraAnchor: [0, 0, 0],
    sceneRevision: 4,
  };

  it("refreshes initial, forced, and scene changes immediately", () => {
    expect(shouldRefreshShadow(undefined, previous, policy)).toMatchObject({ refresh: true, reason: "initial" });
    expect(shouldRefreshShadow(previous, { ...previous, sampledAtMs: 10_001, force: true }, policy)).toMatchObject({ refresh: true, reason: "forced" });
    expect(shouldRefreshShadow(previous, { ...previous, sampledAtMs: 10_001, sceneRevision: 5 }, policy)).toMatchObject({ refresh: true, reason: "scene-change" });
  });

  it("throttles touch-frame churn, then reacts to camera movement", () => {
    expect(shouldRefreshShadow(previous, { ...previous, sampledAtMs: 10_100, cameraAnchor: [20, 0, 0] }, policy))
      .toMatchObject({ refresh: false, reason: "throttled" });
    expect(shouldRefreshShadow(previous, { ...previous, sampledAtMs: 10_500, cameraAnchor: [2, 0, 0] }, policy))
      .toMatchObject({ refresh: true, reason: "camera-movement" });
  });

  it("requires both a new time slice and sufficient solar angle", () => {
    const oneDegree = [Math.sin(Math.PI / 180), Math.cos(Math.PI / 180), 0] as const;
    const threeDegrees = [Math.sin(3 * Math.PI / 180), Math.cos(3 * Math.PI / 180), 0] as const;
    expect(shouldRefreshShadow(previous, { ...previous, sampledAtMs: policy.timeSliceMs - 1, lightDirection: threeDegrees }, policy))
      .toMatchObject({ refresh: false, reason: "unchanged" });
    expect(shouldRefreshShadow(previous, { ...previous, sampledAtMs: policy.timeSliceMs, lightDirection: oneDegree }, policy))
      .toMatchObject({ refresh: false, reason: "unchanged" });
    expect(shouldRefreshShadow(previous, { ...previous, sampledAtMs: policy.timeSliceMs, lightDirection: threeDegrees }, policy))
      .toMatchObject({ refresh: true, reason: "light-angle" });
  });

  it("forces a bounded refresh at the maximum interval", () => {
    expect(shouldRefreshShadow(previous, { ...previous, sampledAtMs: previous.sampledAtMs + policy.maximumIntervalMs }, policy))
      .toMatchObject({ refresh: true, reason: "maximum-interval" });
  });

  it("uses stable slices and robust angular math", () => {
    expect(shadowTimeSlice(policy.timeSliceMs - 1, policy)).toBe(0);
    expect(shadowTimeSlice(policy.timeSliceMs, policy)).toBe(1);
    expect(angleBetween([0, 1, 0], [0, 1, 0])).toBeCloseTo(0);
    expect(angleBetween([0, 1, 0], [0, -1, 0])).toBeCloseTo(Math.PI);
    expect(() => shadowTimeSlice(-1, policy)).toThrow(RangeError);
  });
});
