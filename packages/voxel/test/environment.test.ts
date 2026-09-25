import { describe, expect, it } from "vitest";
import { SMALL_WORKSHOP_BLUEPRINT } from "../src/blueprint";
import {
  AMBIENT_DECORATION_BUDGETS,
  ambientDecorationsForWorld,
  cloudBudgetForView,
  conditionVisualForVoxels,
  decorationsForProject,
  fogRangeForView,
  localDateForDate,
  sunlightScaleForWeather,
  weatherForExternalOverride,
  weatherForLocalDate,
  weatherVisualForKind,
} from "../src/environment";

describe("deterministic local environment", () => {
  it("derives a stable weather state from a local calendar date", () => {
    const first = weatherForLocalDate("2026-07-25");
    expect(weatherForLocalDate("2026-07-25")).toEqual(first);
    expect(first.localDate).toBe("2026-07-25");
    expect(first.rainDropCount).toBe(first.kind === "rain" ? 72 : 0);
  });

  it("produces the supported weather range without persisted randomness", () => {
    const kinds = new Set(
      Array.from({ length: 120 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
        return weatherForLocalDate(date).kind;
      }),
    );
    expect(kinds).toEqual(new Set(["clear", "cloudy", "rain", "mist"]));
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
    expect(mist.near).toBeCloseTo(76.4);
    expect(mist.far).toBeCloseTo(156.8);
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
    expect(rain.rainDropCount).toBe(18);
    expect(rain.snowFlakeCount).toBe(0);

    const snow = weatherForExternalOverride(date, { kind: "snow", cloudIntensity: 1.5, precipitationIntensity: 0.4 });
    expect(snow.cloudIntensity).toBe(1);
    expect(snow.precipitationIntensity).toBe(0.4);
    expect(snow.rainDropCount).toBe(0);
    expect(snow.snowFlakeCount).toBe(38);
    expect(weatherVisualForKind(snow.kind).tint).not.toBeNull();
    expect(sunlightScaleForWeather(snow)).toBeLessThan(1);
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

  it("derives deterministic environment props without touching reward decorations", () => {
    const natural = ambientDecorationsForWorld({
      projectId: "ambient-a",
      blueprint: SMALL_WORKSHOP_BLUEPRINT,
      environmentStyle: "natural-valley",
      worldSeed: "seed-a",
    });
    const naturalAgain = ambientDecorationsForWorld({
      projectId: "ambient-a",
      blueprint: SMALL_WORKSHOP_BLUEPRINT,
      environmentStyle: "natural-valley",
      worldSeed: "seed-a",
    });
    const ocean = ambientDecorationsForWorld({
      projectId: "ambient-a",
      blueprint: SMALL_WORKSHOP_BLUEPRINT,
      environmentStyle: "ocean-island",
      worldSeed: "seed-a",
    });
    expect(natural).toEqual(naturalAgain);
    expect(natural.length).toBeLessThanOrEqual(AMBIENT_DECORATION_BUDGETS["natural-valley"].maxInstances);
    expect(ocean.length).toBeLessThanOrEqual(AMBIENT_DECORATION_BUDGETS["ocean-island"].maxInstances);
    expect(natural.some((entry) => entry.kind === "flower" || entry.kind === "grass-tuft")).toBe(true);
    expect(ocean.filter((entry) => entry.kind === "shipwreck")).toHaveLength(0);
    expect(natural.filter((entry) => entry.castsShadow).length)
      .toBeLessThanOrEqual(AMBIENT_DECORATION_BUDGETS["natural-valley"].maxShadowCasters);
    for (const entry of natural) {
      const insideX = entry.x >= SMALL_WORKSHOP_BLUEPRINT.bounds.minX && entry.x <= SMALL_WORKSHOP_BLUEPRINT.bounds.maxX;
      const insideZ = entry.z >= SMALL_WORKSHOP_BLUEPRINT.bounds.minZ && entry.z <= SMALL_WORKSHOP_BLUEPRINT.bounds.maxZ;
      expect(insideX && insideZ).toBe(false);
    }
  });

  it("distributes ambient candidates around all four settlement sides", () => {
    const candidates = ambientDecorationsForWorld({
      projectId: "ambient-four-sides",
      blueprint: SMALL_WORKSHOP_BLUEPRINT,
      environmentStyle: "classic-island",
      worldSeed: "visible-props",
    });
    const bounds = SMALL_WORKSHOP_BLUEPRINT.bounds;
    const sides = {
      east: candidates.some((entry) => entry.x > bounds.maxX),
      south: candidates.some((entry) => entry.z > bounds.maxZ),
      west: candidates.some((entry) => entry.x < bounds.minX),
      north: candidates.some((entry) => entry.z < bounds.minZ),
    };
    expect(candidates.length).toBeGreaterThanOrEqual(8);
    expect(sides).toEqual({ east: true, south: true, west: true, north: true });
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
