import { describe, expect, it } from "vitest";
import { SMALL_WORKSHOP_BLUEPRINT } from "../src/blueprint";
import {
  ambientScaleForWeather,
  cloudBudgetForView,
  cloudAdvectionSpeed,
  conditionVisualForVoxels,
  decorationsForProject,
  effectiveWeatherOverride,
  fogRangeForView,
  localDateForDate,
  sunlightScaleForWeather,
  weatherForExternalOverride,
  weatherForLocalDate,
  weatherVisualForKind,
  weatherVisualForWeather,
} from "../src/environment";
import { ambientEnvironmentDecorations } from "../src/natural-decorations";

describe("deterministic local environment", () => {
  it("keeps the external weather active when a debug projection has weather null", () => {
    const external = { kind: "rain" as const, precipitationIntensity: 0.65 };
    expect(effectiveWeatherOverride(null, external)).toBe(external);
    expect(effectiveWeatherOverride(undefined, external)).toBe(external);
    const debug = { kind: "snow" as const };
    expect(effectiveWeatherOverride(debug, external)).toBe(debug);
    expect(effectiveWeatherOverride(debug, null)).toBe(debug);
  });

  it("derives a stable weather state from a local calendar date", () => {
    const first = weatherForLocalDate("2026-07-25");
    expect(weatherForLocalDate("2026-07-25")).toEqual(first);
    expect(first.localDate).toBe("2026-07-25");
    expect(first.rainDropCount).toBe(first.kind === "rain" ? 72 : 0);
  });

  it("produces the supported weather range without persisted randomness", () => {
    const weather = Array.from({ length: 365 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
        return weatherForLocalDate(date).kind;
      });
    const kinds = new Set(weather);
    expect(kinds).toEqual(new Set(["clear", "cloudy", "rain", "mist"]));
    const storms = Array.from({ length: 365 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
      return weatherForLocalDate(date);
    }).filter(state => state.thunderstorm);
    expect(storms.length).toBeGreaterThan(0);
    expect(storms.every(state => state.kind === "rain" && state.cloudIntensity === 1)).toBe(true);
  });

  it("rejects impossible dates and formats device-local dates", () => {
    expect(() => weatherForLocalDate("2026-02-29")).toThrow(RangeError);
    expect(() => weatherForLocalDate("July 25")).toThrow(RangeError);
    expect(localDateForDate(new Date(2026, 6, 5, 12))).toBe("2026-07-05");
  });

  it("keeps deterministic mist behind the readable settlement depth", () => {
    expect(weatherForLocalDate("2026-07-28").kind).toBe("mist");
    const mist = fogRangeForView("mist", 80, 24);
    const clear = fogRangeForView("clear", 80, 24);
    expect(mist.near).toBeCloseTo(74.72);
    expect(mist.far).toBeCloseTo(128);
    expect(mist.near).toBeLessThan(clear.near);
    expect(mist.far).toBeLessThan(clear.far);
    expect(mist.near).toBeGreaterThan(50);
  });

  it("keeps weather appearance unified while preserving ocean probability bias", () => {
    for (const kind of ["clear", "cloudy", "rain", "mist"] as const) {
      expect(fogRangeForView(kind, 80, 24, true)).toEqual(fogRangeForView(kind, 80, 24, false));
      const visual = weatherVisualForKind(kind);
      expect(Object.isFrozen(visual)).toBe(true);
      expect(visual.cloudBlend).toBeGreaterThanOrEqual(0);
      expect(visual.cloudBlend).toBeLessThanOrEqual(1);
      expect(visual.sunlightScale).toBeGreaterThan(0);
      expect(visual.sunlightScale).toBeLessThanOrEqual(1);
    }
    const dates = Array.from({ length: 120 }, (_, index) => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
    const land = dates.map((date) => weatherForLocalDate(date).kind);
    const ocean = dates.map((date) => weatherForLocalDate(date, true).kind);
    expect(ocean).not.toEqual(land);
  });

  it("projects external weather into shared valley and island visuals with bounded intensities", () => {
    const date = "2026-09-23";
    const cloudy = weatherForExternalOverride(date, { kind: "cloudy", cloudIntensity: 0.5 });
    expect(cloudy).toEqual(weatherForExternalOverride(date, { kind: "cloudy", cloudIntensity: 0.5 }));
    expect(cloudy.cloudCount).toBe(6);
    expect(cloudy.cloudIntensity).toBe(0.5);
    expect(cloudy.precipitationIntensity).toBe(0);
    expect(cloudy.rainDropCount).toBe(0);
    expect(cloudy.snowFlakeCount).toBe(0);

    const noClouds = weatherForExternalOverride(date, { kind: "clear", cloudIntensity: -2, precipitationIntensity: 8 });
    expect(noClouds.cloudCount).toBe(0);
    expect(noClouds.cloudIntensity).toBe(0);
    expect(noClouds.precipitationIntensity).toBe(1);
    expect(noClouds.rainDropCount).toBe(0);
    expect(noClouds.snowFlakeCount).toBe(0);
    expect(sunlightScaleForWeather(noClouds)).toBe(1);

    const rain = weatherForExternalOverride(date, { kind: "rain", cloudIntensity: 0.5, precipitationIntensity: 0.25 });
    expect(rain.rainDropCount).toBe(40);
    expect(rain.snowFlakeCount).toBe(0);

    const snow = weatherForExternalOverride(date, { kind: "snow", cloudIntensity: 1.5, precipitationIntensity: 0.4 });
    expect(snow.cloudIntensity).toBe(1);
    expect(snow.precipitationIntensity).toBe(0.4);
    expect(snow.rainDropCount).toBe(0);
    expect(snow.snowFlakeCount).toBe(64);
    expect(weatherVisualForKind(snow.kind).tint).not.toBeNull();
    expect(sunlightScaleForWeather(snow)).toBeLessThan(1);
  });

  it("keeps ordinary rain distinct from explicitly signalled thunder and dims the daytime nonlinearly", () => {
    const rain = weatherForExternalOverride("2026-09-23", { kind: "rain", cloudIntensity: 0.7, precipitationIntensity: 0.6 });
    const storm = weatherForExternalOverride("2026-09-23", { kind: "rain", cloudIntensity: 0.7,
      precipitationIntensity: 0.6, thunderstorm: true });
    expect(rain.thunderstorm).toBe(false);
    expect(storm.thunderstorm).toBe(true);
    expect(weatherVisualForWeather(storm).tint).not.toBe(weatherVisualForWeather(rain).tint);
    expect(sunlightScaleForWeather(storm)).toBeLessThan(sunlightScaleForWeather(rain));
    expect(ambientScaleForWeather(storm)).toBeLessThan(ambientScaleForWeather(rain));
    expect(ambientScaleForWeather(storm, 1)).toBeGreaterThan(ambientScaleForWeather(storm, 0));
    expect(weatherForExternalOverride("2026-09-23", { kind: "snow", thunderstorm: true }).thunderstorm).toBe(false);
    expect(sunlightScaleForWeather({ ...rain, kind: "clear", cloudIntensity: 0 })).toBe(1);
    expect(cloudAdvectionSpeed(storm)).toBeGreaterThan(cloudAdvectionSpeed(rain));
    expect(cloudAdvectionSpeed(rain)).toBeGreaterThan(cloudAdvectionSpeed({ ...rain, kind: "mist" }));
  });
});

describe("daily-goal decorations", () => {
  it("is idempotent, deduplicated, and independent of input ordering", () => {
    const dates = ["2026-07-27", "2026-07-25", "2026-07-26", "2026-07-25"];
    const first = decorationsForProject("project-a", dates, SMALL_WORKSHOP_BLUEPRINT);
    const second = decorationsForProject("project-a", [...dates].reverse(), SMALL_WORKSHOP_BLUEPRINT);
    expect(first).toEqual(second);
    expect(first.map((item) => item.date)).toEqual(["2026-07-25", "2026-07-26", "2026-07-27"]);
    expect(new Set(first.map((item) => `${item.x}:${item.z}`)).size).toBe(first.length);
  });

  it("keeps placements outside the building and varies them by project", () => {
    const dates = ["2026-07-25", "2026-07-26", "2026-07-27", "2026-07-28"];
    const first = decorationsForProject("project-a", dates, SMALL_WORKSHOP_BLUEPRINT);
    const otherProject = decorationsForProject("project-b", dates, SMALL_WORKSHOP_BLUEPRINT);
    for (const item of first) {
      const insideX = item.x >= SMALL_WORKSHOP_BLUEPRINT.bounds.minX && item.x <= SMALL_WORKSHOP_BLUEPRINT.bounds.maxX;
      const insideZ = item.z >= SMALL_WORKSHOP_BLUEPRINT.bounds.minZ && item.z <= SMALL_WORKSHOP_BLUEPRINT.bounds.maxZ;
      expect(insideX && insideZ).toBe(false);
    }
    expect(otherProject).not.toEqual(first);
  });

  it("allocates a unique deterministic visual for long histories", () => {
    const dates = Array.from({ length: 100 }, (_, index) => (
      new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
    ));
    const placements = decorationsForProject("long-project", dates, SMALL_WORKSHOP_BLUEPRINT);
    expect(placements).toHaveLength(100);
    expect(new Set(placements.map((item) => `${item.x}:${item.z}`)).size).toBe(100);
  });

  it("does not move earned decorations when a later reward is added", () => {
    const prior = decorationsForProject(
      "project-a",
      ["2026-07-25", "2026-07-26"],
      SMALL_WORKSHOP_BLUEPRINT,
    );
    const after = decorationsForProject(
      "project-a",
      ["2026-07-25", "2026-07-26", "2026-07-27"],
      SMALL_WORKSHOP_BLUEPRINT,
    );
    expect(after.slice(0, prior.length)).toEqual(prior);
  });
});

describe("bounded world follow-up presentation", () => {
  it("sizes preview clouds from the preview content rather than the terrain envelope", () => {
    const small = cloudBudgetForView({
      previewMode: true,
      weatherCloudCount: 12,
      weatherDensity: 1,
      weatherKind: "cloudy",
      contentWidth: 12,
      contentDepth: 10,
      visibleWidth: 128,
      visibleDepth: 128,
    });
    const large = cloudBudgetForView({
      previewMode: true,
      weatherCloudCount: 12,
      weatherDensity: 1,
      weatherKind: "cloudy",
      contentWidth: 46,
      contentDepth: 38,
      visibleWidth: 128,
      visibleDepth: 128,
    });
    expect(small.previewMode).toBe(true);
    expect(small.cloudCount).toBe(1);
    expect(small.blockScale).toBeCloseTo(0.2);
    expect(small.maxInstances).toBe(12);
    expect(small.spanX).toBeCloseTo(13.8);
    expect(small.spanZ).toBeCloseTo(11.5);
    // The normal preview cloud cluster has at most seven blocks. Bound the
    // sum of their projected top-face areas against the preview's sky envelope
    // (a conservative coverage estimate; overlap only reduces the visible area).
    const largestBlock = 5.6 * small.blockScale;
    const previewCloudCoverage = small.cloudCount * 7 * largestBlock * (largestBlock * 1.15)
      / (small.spanX * small.spanZ);
    expect(previewCloudCoverage).toBeLessThan(0.07);
    expect(small.cloudCount).toBeLessThan(large.cloudCount);
    expect(small.maxInstances).toBeLessThan(large.maxInstances);
    expect(small.blockScale).toBeLessThan(large.blockScale);
    expect(small.spanX).toBeLessThan(large.spanX);
    expect(small.spanZ).toBeLessThan(large.spanZ);
    const clearPreview = cloudBudgetForView({
      previewMode: true,
      weatherCloudCount: 0,
      weatherDensity: 1,
      weatherKind: "clear",
      contentWidth: 12,
      contentDepth: 10,
      visibleWidth: 128,
      visibleDepth: 128,
    });
    expect(clearPreview.cloudCount).toBe(0);
  });

  it("keeps main-world cloud coverage on the visibility envelope", () => {
    const budget = cloudBudgetForView({
      previewMode: false,
      weatherCloudCount: 9,
      weatherDensity: 1,
      weatherKind: "cloudy",
      contentWidth: 30,
      contentDepth: 30,
      visibleWidth: 420,
      visibleDepth: 380,
    });
    expect(budget.previewMode).toBe(false);
    expect(budget.blockScale).toBe(1);
    expect(budget.spanX).toBeGreaterThan(420);
    expect(budget.spanZ).toBeGreaterThan(380);
    expect(budget.maxInstances).toBe(900);
  });

  it("keeps cloudy sky visibly denser than mist on expanded terrain", () => {
    const input = { previewMode: false, weatherCloudCount: 9, weatherDensity: 1,
      contentWidth: 30, contentDepth: 30, visibleWidth: 420, visibleDepth: 380 };
    const cloudy = cloudBudgetForView({ ...input, weatherKind: "cloudy" });
    const mist = cloudBudgetForView({ ...input, weatherKind: "mist" });
    expect(cloudy.cloudCount).toBeGreaterThan(mist.cloudCount * 1.8);
    expect(cloudy.cloudCount).toBeLessThan(85);
  });

  it("does not create any main-world cloud coverage when clear weather reports zero clouds", () => {
    const budget = cloudBudgetForView({
      previewMode: false,
      weatherCloudCount: 0,
      weatherDensity: 1,
      weatherKind: "clear",
      contentWidth: 30,
      contentDepth: 30,
      visibleWidth: 420,
      visibleDepth: 380,
    });
    expect(budget.cloudCount).toBe(0);
  });

  it("keeps earned decorations independent of a natural environment plan", () => {
    const dates = ["2026-09-20", "2026-09-21", "2026-09-22"];
    const earned = decorationsForProject("reward-owner", dates, SMALL_WORKSHOP_BLUEPRINT);
    ambientEnvironmentDecorations({
      worldSeed: "natural-field",
      environmentStyle: "natural-valley",
      candidates: [{ x: 12, z: 8, support: "ground" }, { x: -12, z: -8, support: "ground" }],
    });
    expect(decorationsForProject("reward-owner", dates, SMALL_WORKSHOP_BLUEPRINT)).toEqual(earned);
  });
});

describe("condition visuals", () => {
  const built = SMALL_WORKSHOP_BLUEPRINT.voxels;

  it("leaves a fully repaired building spatially intact", () => {
    const visual = conditionVisualForVoxels("project-a", built, 10_000);
    expect(visual.intactVoxels).toEqual(built);
    expect(visual.missingVoxels).toHaveLength(0);
    expect(visual.vines).toHaveLength(0);
    expect(visual.weathering).toBe(0);
  });

  it("uses missing blocks and vines so decay is not color-only", () => {
    const visual = conditionVisualForVoxels("project-a", built, 0);
    expect(visual.missingVoxels.length).toBeGreaterThan(0);
    expect(visual.vines.length).toBeGreaterThan(0);
    expect(visual.intactVoxels.length + visual.missingVoxels.length).toBe(built.length);
    expect(visual.missingVoxels.every((voxel) => voxel.buildOrder > 1800 && voxel.y > 0)).toBe(true);
  });

  it("restores a monotonic subset as condition increases", () => {
    const damaged = conditionVisualForVoxels("project-a", built, 2_500);
    const repairing = conditionVisualForVoxels("project-a", built, 7_500);
    const repaired = conditionVisualForVoxels("project-a", built, 10_000);
    const key = (voxel: { x: number; y: number; z: number }) => `${voxel.x}:${voxel.y}:${voxel.z}`;
    const damagedMissing = new Set(damaged.missingVoxels.map(key));
    expect(repairing.missingVoxels.every((voxel) => damagedMissing.has(key(voxel)))).toBe(true);
    expect(damaged.missingVoxels.length).toBeGreaterThanOrEqual(repairing.missingVoxels.length);
    expect(repairing.missingVoxels.length).toBeGreaterThanOrEqual(repaired.missingVoxels.length);
    expect(damaged.vines.length).toBeGreaterThan(repairing.vines.length);
  });
});
