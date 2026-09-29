import { describe, expect, it } from "vitest";
import { astronomyDayAt, moonIlluminationAt, moonPositionAt, sunPositionAt } from "../src/astronomy";
import { celestialWorldDirection, sunStateForAstronomy } from "../src/astronomy-visual";
import { sunStateForLocalTime } from "../src/lighting";

describe("SunCalc 2.x ephemeris", () => {
  it("uses apparent degrees, geographic north, and finite polar positions", () => {
    const date = new Date("2026-06-21T12:00:00.000Z");
    const london = { latitude: 51.5, longitude: 0 };
    const sun = sunPositionAt(date, london)!;
    const moon = moonPositionAt(date, london)!;
    expect(sun.altitudeDeg).toBeGreaterThan(50);
    expect(sun.azimuthDeg).toBeGreaterThan(0);
    expect(sun.azimuthDeg).toBeLessThan(360);
    expect(Number.isFinite(moon.altitudeDeg)).toBe(true);
    expect(Number.isFinite(moon.azimuthDeg)).toBe(true);
    const polarSummer = sunPositionAt(date, { latitude: 80, longitude: 0 })!;
    expect(polarSummer.altitudeDeg).toBeGreaterThan(0);
  });

  it("maps north-clockwise azimuth into a fixed north-up world basis", () => {
    expect(celestialWorldDirection(0, 0)).toEqual([0, 0, -1]);
    expect(celestialWorldDirection(90, 0)[0]).toBeCloseTo(1);
    expect(celestialWorldDirection(180, 0)[2]).toBeCloseTo(1);
    expect(celestialWorldDirection(270, 0)[0]).toBeCloseTo(-1);
  });

  it("keeps altitude-driven night and twilight bands in the correct order", () => {
    const date = new Date("2026-12-21T00:00:00.000Z");
    const coordinates = { latitude: 51.5, longitude: 0 };
    const states = Array.from({ length: 24 }, (_, hour) =>
      sunStateForAstronomy(new Date(date.getTime() + hour * 60 * 60_000), coordinates)!).filter(Boolean);
    expect(states.every(state => [state.intensity, state.nightFactor, state.starVisibility,
      state.sunVisibility, state.moonVisibility, state.exposure].every(Number.isFinite))).toBe(true);
    expect(states.filter(state => state.phase === "night").every(state => state.sunVisibility === 0)).toBe(true);
    expect(states.some(state => state.phase === "day")).toBe(true);
    expect(states.some(state => state.phase === "civil-twilight" || state.phase === "dawn" || state.phase === "dusk")).toBe(true);
    expect(states.some(state => state.phase === "nautical-twilight")).toBe(true);
    expect(states.some(state => state.phase === "astronomical-twilight" || state.phase === "night")).toBe(true);
    expect(sunStateForAstronomy(new Date(NaN), coordinates)).toBeNull();
    expect(sunPositionAt(date, { latitude: 91, longitude: 0 })).toBeNull();
  });

  it("exposes lunar phase separately from geometric visibility", () => {
    const date = new Date("2026-07-29T18:00:00.000Z");
    const illumination = moonIlluminationAt(date)!;
    const state = sunStateForAstronomy(date, { latitude: 35.7, longitude: 139.7 })!;
    expect(illumination.fraction).toBeGreaterThanOrEqual(0);
    expect(illumination.fraction).toBeLessThanOrEqual(1);
    expect(state.moonIllumination).toBe(illumination.fraction);
    expect(state.moonWaxing).toBe(illumination.waxing);
    expect(state.moonPosition.every(Number.isFinite)).toBe(true);
    expect(state.hemisphereIntensity).toBeGreaterThanOrEqual(1.24);
  });

  it("selects event days by half-open UTC intervals, including across DST offset changes", () => {
    const day = {
      intervalStartMs: Date.parse("2026-03-29T00:00:00Z"),
      intervalEndMs: Date.parse("2026-03-30T00:00:00Z"),
      solar: { astronomicalDawnMs: null, nauticalDawnMs: null, civilDawnMs: null, sunriseMs: null,
        solarNoonMs: null, sunsetMs: null, civilDuskMs: null, nauticalDuskMs: null,
        astronomicalDuskMs: null, solarMidnightMs: null },
      lunar: { moonriseMs: null, moonsetMs: null, moonTransitMs: null, moonUnderfootMs: null, phase: null },
    };
    const schedule = { coordinates: { latitude: 51.5, longitude: 0 }, locationSource: "cached" as const,
      fetchedAtMs: 0, days: [day], attribution: [] };
    expect(astronomyDayAt(schedule, day.intervalStartMs)).toBe(day);
    expect(astronomyDayAt(schedule, day.intervalEndMs - 1)).toBe(day);
    expect(astronomyDayAt(schedule, day.intervalEndMs)).toBeNull();
    expect(astronomyDayAt(schedule, NaN)).toBeNull();
  });
});

describe("night readability baseline", () => {
  it("keeps the same readable night baseline independent of graphics tier", () => {
    const night = sunStateForLocalTime(new Date(2026, 6, 24, 2));
    expect(night.intensity).toBeGreaterThan(0.9);
    expect(night.intensity).toBeLessThan(1);
    expect(night.hemisphereIntensity).toBeGreaterThanOrEqual(1.24);
    expect(night.exposure).toBeGreaterThanOrEqual(1.28);
  });
});
