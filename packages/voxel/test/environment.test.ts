import { describe, expect, it } from "vitest";
import { SMALL_WORKSHOP_BLUEPRINT } from "../src/blueprint";
import {
  conditionVisualForVoxels,
  decorationsForProject,
  fogRangeForView,
  localDateForDate,
  weatherForLocalDate,
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
