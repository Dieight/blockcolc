import { describe, expect, it } from "vitest";
import { createInitialState, execute, parseDomainState, type Clock, type DomainCommand, type DomainState } from "../src/index.js";

class TestClock implements Clock {
  constructor(private value = new Date("2026-09-10T00:00:00.000Z")) {}
  now(): Date { return new Date(this.value); }
  advance(milliseconds: number): void { this.value = new Date(this.value.getTime() + milliseconds); }
}

function fixture() {
  const clock = new TestClock();
  let state = createInitialState("UTC", [0, 6]);
  const run = (command: DomainCommand) => {
    const result = execute(state, command, clock);
    if (result.ok) state = result.state;
    return result;
  };
  const create = (projectId: string, subtasks: string[]) => run({
    type: "CreateProject", projectId, title: projectId, blueprintId: "cottage",
    subtasks: subtasks.map(id => ({ id, title: id })),
  });
  const completeMarathon = (sessionId: string, hostProjectId = "p1") => {
    const started = run({ type: "StartFocus", sessionId, projectId: hostProjectId, subtaskId: "a", marathon: true, plannedDurationMs: 1_000 });
    if (!started.ok) throw new Error(started.message);
    clock.advance(1_000);
    const completed = run({ type: "CompleteFocus" });
    if (!completed.ok) throw new Error(completed.message);
  };
  return { run, create, completeMarathon, state: () => state };
}

describe("F19 explicit marathon allocation", () => {
  it("assigns each actual session once in completion order across ordinary targets", () => {
    const f = fixture();
    f.create("p1", ["a", "b"]);
    f.create("p2", ["c"]);
    f.completeMarathon("s1");
    f.completeMarathon("s2");
    f.completeMarathon("s3");

    const result = f.run({
      type: "ReportMarathonFocus",
      entries: [
        { reportId: "r-p1", projectId: "p1", subtaskId: "a", progressBasisPoints: 5_000, rounds: 1 },
        { reportId: "r-p2", projectId: "p2", subtaskId: "c", progressBasisPoints: 2_500, rounds: 1 },
      ],
      habitAllocations: [],
      focusSessionIds: ["s3", "s1", "s2"],
    });
    expect(result).toMatchObject({ ok: true });
    expect(f.state().progressReports).toEqual([
      expect.objectContaining({ id: "r-p1", allocation: "explicit", focusSessionIds: ["s1"] }),
      expect.objectContaining({ id: "r-p2", allocation: "explicit", focusSessionIds: ["s2"] }),
    ]);
    expect(f.state().focusHistory.every(session => session.settledAt !== undefined)).toBe(true);
    expect(parseDomainState(f.state())).toEqual(f.state());
  });

  it("rejects over-allocation atomically and keeps the draft-compatible state unchanged", () => {
    const f = fixture();
    f.create("p1", ["a"]);
    f.completeMarathon("s1");
    const before: DomainState = structuredClone(f.state());
    const result = f.run({
      type: "ReportMarathonFocus",
      entries: [{ reportId: "too-many", projectId: "p1", subtaskId: "a", progressBasisPoints: 2_500, rounds: 2 }],
      habitAllocations: [],
      focusSessionIds: ["s1"],
    });
    expect(result).toMatchObject({ ok: false, code: "MARATHON_SPLIT_INVALID" });
    expect(f.state()).toEqual(before);
  });

  it("rejects fractional, negative, mixed, and duplicate explicit round contracts", () => {
    const f = fixture();
    f.create("p1", ["a", "b"]);
    f.completeMarathon("s1");
    f.completeMarathon("s2");
    const base = { habitAllocations: [] as Array<{ projectId: string; rounds: number }>, focusSessionIds: ["s1", "s2"] as string[] };
    expect(f.run({ type: "ReportMarathonFocus", ...base, entries: [{ reportId: "fraction", projectId: "p1", subtaskId: "a", progressBasisPoints: 1_000, rounds: 1.5 }] })).toMatchObject({ ok: false, code: "MARATHON_SPLIT_INVALID" });
    expect(f.run({ type: "ReportMarathonFocus", ...base, entries: [{ reportId: "negative", projectId: "p1", subtaskId: "a", progressBasisPoints: 1_000, rounds: -1 }] })).toMatchObject({ ok: false, code: "MARATHON_SPLIT_INVALID" });
    expect(f.run({ type: "ReportMarathonFocus", ...base, entries: [
      { reportId: "mixed-a", projectId: "p1", subtaskId: "a", progressBasisPoints: 1_000, rounds: 1 },
      { reportId: "mixed-b", projectId: "p1", subtaskId: "b", progressBasisPoints: 1_000 },
    ] })).toMatchObject({ ok: false, code: "MARATHON_SPLIT_INVALID" });
    expect(f.run({ type: "ReportMarathonFocus", ...base, entries: [
      { reportId: "duplicate-a", projectId: "p1", subtaskId: "a", progressBasisPoints: 1_000, rounds: 1 },
      { reportId: "duplicate-b", projectId: "p1", subtaskId: "a", progressBasisPoints: 2_000, rounds: 1 },
    ] })).toMatchObject({ ok: false, code: "DUPLICATE_ID" });
  });
});
