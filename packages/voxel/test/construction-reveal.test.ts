import { describe, expect, it } from "vitest";
import { constructionRevealPlans, constructionWaveSchedule } from "../src/construction-reveal";

const world = (projectId: string, blueprintId: string, buildingCompletionBasisPoints: number) => ({
  projectId,
  blueprintId,
  buildingCompletionBasisPoints,
});

describe("constructionRevealPlans", () => {
  it("reveals only buildings whose completion advanced since the previous snapshot", () => {
    const previous = [world("a", "chapel", 3_000), world("b", "workshop", 8_000)];
    const next = [world("a", "chapel", 4_200), world("b", "workshop", 8_000), world("c", "chapel", 2_000)];
    const plans = constructionRevealPlans(previous, next, true);
    expect([...plans.keys()]).toEqual(["a"]);
    expect(plans.get("a")?.previousCompletionBasisPoints).toBe(3_000);
  });

  it("treats a completion decrease or an equal completion as no reveal", () => {
    const previous = [world("a", "chapel", 4_000)];
    expect(constructionRevealPlans(previous, [world("a", "chapel", 4_000)], true).size).toBe(0);
    expect(constructionRevealPlans(previous, [world("a", "chapel", 3_900)], true).size).toBe(0);
  });

  it("never reveals on the initial load", () => {
    expect(constructionRevealPlans([], [world("a", "chapel", 5_000)], true).size).toBe(0);
  });

  it("ignores new projects and blueprint swaps", () => {
    const previous = [world("a", "chapel", 3_000)];
    const next = [world("a", "workshop", 6_000), world("b", "chapel", 4_000)];
    expect(constructionRevealPlans(previous, next, true).size).toBe(0);
  });

  it("reveals nothing when the caller disallows animation", () => {
    const previous = [world("a", "chapel", 3_000)];
    const next = [world("a", "chapel", 4_000)];
    expect(constructionRevealPlans(previous, next, false).size).toBe(0);
  });
});

describe("constructionWaveSchedule", () => {
  it("keeps small increments one block per wave at a slow pace", () => {
    const schedule = constructionWaveSchedule(10);
    expect(schedule.waveSize).toBe(1);
    expect(schedule.waveIntervalMs).toBeCloseTo(330, 0);
    const started = 1_000;
    expect(schedule.popAtMsFor(started, 0)).toBe(started + schedule.leadInMs);
    expect(schedule.popAtMsFor(started, 1)).toBe(started + schedule.leadInMs + schedule.waveIntervalMs);
  });

  it("caps the total reveal near 3.5 s even for large increments", () => {
    for (const count of [90, 200, 400]) {
      const schedule = constructionWaveSchedule(count);
      const lastWave = Math.ceil(count / schedule.waveSize) - 1;
      const lastPop = schedule.popAtMsFor(0, count - 1);
      const expected = schedule.leadInMs + lastWave * schedule.waveIntervalMs;
      expect(lastPop).toBe(expected);
      expect(lastPop + schedule.popDurationMs).toBeLessThanOrEqual(4_200);
      // At least 90 waves keep every block visible: consecutive order indices in
      // different waves pop at strictly increasing times.
      expect(schedule.popAtMsFor(0, 0)).toBeLessThan(schedule.popAtMsFor(0, schedule.waveSize));
    }
  });

  it("degrades safely for zero blocks", () => {
    const schedule = constructionWaveSchedule(0);
    expect(schedule.waveSize).toBe(1);
    expect(schedule.waveIntervalMs).toBe(0);
  });
});
