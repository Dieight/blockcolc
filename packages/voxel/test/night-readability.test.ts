import { describe, expect, it } from "vitest";
import { sunStateForAstronomy } from "../src/astronomy-visual";
import { sunStateForLocalTime } from "../src/lighting";
import { applyNightReadability } from "../src/night-readability";

describe("shared night readability profile", () => {
  it("lifts hemisphere fill and exposure without turning night fill into daylight white", () => {
    const oldNight = {
      nightFactor: 1,
      hemisphereSkyColor: 0x7895b5,
      hemisphereGroundColor: 0x24382d,
      hemisphereIntensity: 1.24,
      exposure: 1.28,
    };
    const readable = applyNightReadability(oldNight);
    expect(readable.hemisphereSkyColor).toBeGreaterThan(oldNight.hemisphereSkyColor);
    expect(readable.hemisphereGroundColor).toBeGreaterThan(oldNight.hemisphereGroundColor);
    expect(readable.hemisphereIntensity).toBeGreaterThan(oldNight.hemisphereIntensity);
    expect(readable.exposure).toBeGreaterThan(oldNight.exposure);
    expect(Math.max((readable.hemisphereSkyColor >> 16) & 0xff,
      (readable.hemisphereSkyColor >> 8) & 0xff, readable.hemisphereSkyColor & 0xff)).toBeLessThan(220);
    expect(readable.nightFactor).toBe(1);
  });

  it("leaves full daylight unchanged and blends smoothly through twilight", () => {
    const daylight = {
      nightFactor: 0,
      hemisphereSkyColor: 0xf4f0dc,
      hemisphereGroundColor: 0x4d6659,
      hemisphereIntensity: 1.12,
      exposure: 1.22,
    };
    expect(applyNightReadability(daylight)).toEqual(daylight);
    const twilight = applyNightReadability({ ...daylight, nightFactor: 0.5 });
    const night = applyNightReadability({ ...daylight, nightFactor: 1 });
    expect(twilight.hemisphereIntensity).toBeGreaterThan(daylight.hemisphereIntensity);
    expect(twilight.hemisphereIntensity).toBeLessThan(night.hemisphereIntensity);
    expect(twilight.exposure).toBeGreaterThan(daylight.exposure);
    expect(twilight.exposure).toBeLessThan(night.exposure);
  });

  it("uses the same no-moon floor in synthetic and astronomical nights, with only a small lunar lift", () => {
    const synthetic = sunStateForLocalTime(new Date(2026, 6, 24, 2));
    const astronomy = sunStateForAstronomy(new Date("2026-06-21T00:00:00.000Z"), { latitude: 51.5, longitude: 0 });
    expect(astronomy).not.toBeNull();
    expect(synthetic.nightFactor).toBe(1);
    expect(astronomy!.nightFactor).toBe(1);
    expect(astronomy!.hemisphereSkyColor).toBe(synthetic.hemisphereSkyColor);
    expect(astronomy!.hemisphereGroundColor).toBe(synthetic.hemisphereGroundColor);
    expect(astronomy!.hemisphereIntensity - synthetic.hemisphereIntensity).toBeGreaterThanOrEqual(0);
    expect(astronomy!.hemisphereIntensity - synthetic.hemisphereIntensity).toBeLessThanOrEqual(0.04);
    expect(astronomy!.exposure - synthetic.exposure).toBeGreaterThanOrEqual(0);
    expect(astronomy!.exposure - synthetic.exposure).toBeLessThanOrEqual(0.02);
    expect(astronomy!.position).not.toEqual(synthetic.position);
    expect(astronomy!.sunVisibility).toBe(0);
    expect(astronomy!.directSunIntensity).toBe(0);
  });

  it("preserves all direction/visibility fields while applying an ambient profile", () => {
    const source = {
      position: [1, 2, 3] as const,
      sunPosition: [4, 5, 6] as const,
      moonPosition: [7, 8, 9] as const,
      sunVisibility: 0,
      directSunIntensity: 0,
      nightFactor: 1,
      hemisphereSkyColor: 0x7895b5,
      hemisphereGroundColor: 0x24382d,
      hemisphereIntensity: 1.24,
      exposure: 1.28,
    };
    const result = applyNightReadability(source);
    expect(result.position).toBe(source.position);
    expect(result.sunPosition).toBe(source.sunPosition);
    expect(result.moonPosition).toBe(source.moonPosition);
    expect(result.sunVisibility).toBe(0);
    expect(result.directSunIntensity).toBe(0);
  });
});
