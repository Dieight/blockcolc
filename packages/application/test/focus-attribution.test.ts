import { describe, expect, it } from "vitest";
import { createInitialState, type DomainState, type FocusSession, type Project } from "@tomato-clock/domain";
import { projectFocusAttribution, projectMonumentFocus } from "../src/focus-attribution.js";

function finite(id: string, title: string, subtaskId: string, subtaskTitle: string, status: Project["status"] = "monument"): Project {
  return {
    id, title, kind: "finite", settlementIndex: 0, blueprintId: "cottage", importedBlueprint: null,
    createdAt: "2026-09-01T00:00:00.000Z", status, subtaskStructureLocked: true,
    subtasks: [{ id: subtaskId, title: subtaskTitle, order: 0, progressBasisPoints: 10_000 }], habit: null,
  };
}

function session(id: string, projectId: string, subtaskId: string | null, completedAt: string, actualDurationMs: number, marathon = true): FocusSession {
  return {
    id, projectId, subtaskId, ...(marathon ? { marathon: true as const } : {}), startedAt: new Date(Date.parse(completedAt) - actualDurationMs).toISOString(),
    endsAt: completedAt, plannedDurationMs: actualDurationMs, timeZoneAtStart: "UTC", status: "completed", completedAt,
    completedLocalDate: completedAt.slice(0, 10), actualDurationMs,
  };
}

describe("F19/F20 focus attribution projection", () => {
  it("counts explicit ordinary targets once, including a cross-project target", () => {
    const state = createInitialState("UTC");
    state.projects = [finite("p1", "主线", "a", "第一步"), finite("p2", "支线", "c", "另一项")];
    state.focusHistory = [
      session("s1", "p1", "a", "2026-09-03T00:01:00.000Z", 25 * 60_000),
      session("s2", "p1", "a", "2026-09-03T00:02:00.000Z", 15 * 60_000),
    ];
    state.progressReports = [
      { id: "r1", projectId: "p1", subtaskId: "a", focusSessionIds: ["s1"], progressBasisPoints: 10_000, reportedAt: "2026-09-03T00:03:00.000Z", allocation: "explicit" },
      { id: "r2", projectId: "p2", subtaskId: "c", focusSessionIds: ["s2"], progressBasisPoints: 10_000, reportedAt: "2026-09-03T00:03:00.000Z", allocation: "explicit" },
    ];
    const projection = projectFocusAttribution(state);
    expect(projection.sessions.map(item => [item.sessionId, item.projectId, item.subtaskId])).toEqual([
      ["s1", "p1", "a"], ["s2", "p2", "c"],
    ]);
    expect(projection.unallocated).toEqual({ rounds: 0, completedRounds: 0, interruptedRounds: 0, minutes: 0 });
    expect(projectFocusAttribution(JSON.parse(JSON.stringify(state)))).toEqual(projection);
    const monuments = projectMonumentFocus(state);
    expect(monuments.find(item => item.id === "p1")).toMatchObject({ rounds: 1, minutes: 25, subtasks: [{ subtaskId: "a", rounds: 1, minutes: 25, share: 100 }] });
    expect(monuments.find(item => item.id === "p2")).toMatchObject({ rounds: 1, minutes: 15, subtasks: [{ subtaskId: "c", rounds: 1, minutes: 15, share: 100 }] });
  });

  it("does not duplicate a legacy shared block and exposes discarded marathon time", () => {
    const state = createInitialState("UTC");
    state.projects = [finite("p1", "主线", "a", "第一步"), finite("p2", "支线", "c", "另一项")];
    state.focusHistory = [
      session("shared", "p1", "a", "2026-09-04T00:01:00.000Z", 20 * 60_000),
      { ...session("discarded", "p1", "a", "2026-09-04T00:02:00.000Z", 10 * 60_000), settledAt: "2026-09-04T00:03:00.000Z" },
    ];
    state.progressReports = [
      { id: "shared-a", projectId: "p1", subtaskId: "a", focusSessionIds: ["shared"], progressBasisPoints: 2_500, reportedAt: "2026-09-04T00:03:00.000Z", shared: true },
      { id: "shared-c", projectId: "p2", subtaskId: "c", focusSessionIds: ["shared"], progressBasisPoints: 2_500, reportedAt: "2026-09-04T00:03:00.000Z", shared: true },
    ];
    const projection = projectFocusAttribution(state);
    expect(projection.sessions.map(item => ({ id: item.sessionId, kind: item.kind, reason: item.reason }))).toEqual([
      { id: "shared", kind: "unallocated", reason: "legacy-shared" },
      { id: "discarded", kind: "unallocated", reason: "discarded" },
    ]);
    expect(projection.unallocated).toEqual({ rounds: 2, completedRounds: 2, interruptedRounds: 0, minutes: 30 });
  });

  it("keeps shared history as an explicit per-building unknown gap and counts interruptions separately", () => {
    const state = createInitialState("UTC");
    state.projects = [finite("p1", "主线", "a", "第一步"), finite("p2", "支线", "b", "另一项")];
    state.focusHistory = [
      session("known-p1", "p1", "a", "2026-09-06T00:01:30.001Z", 90_001),
      session("cross-to-p2", "p1", "a", "2026-09-06T00:03:00.000Z", 30_000),
      session("shared-gap", "p1", "a", "2026-09-06T00:13:00.000Z", 10 * 60_000),
      { ...session("interrupted-p1", "p1", "a", "2026-09-06T00:20:00.000Z", 5 * 60_000, false), status: "interrupted", interruptedAt: "2026-09-06T00:20:00.000Z", interruptionReason: "user-cancelled", interruptionCategory: "fatigue" },
    ];
    state.progressReports = [
      { id: "known-report", projectId: "p1", subtaskId: "a", focusSessionIds: ["known-p1"], progressBasisPoints: 10_000, reportedAt: "2026-09-06T01:00:00.000Z", allocation: "explicit" },
      { id: "cross-report", projectId: "p2", subtaskId: "b", focusSessionIds: ["cross-to-p2"], progressBasisPoints: 10_000, reportedAt: "2026-09-06T01:00:00.000Z", allocation: "explicit" },
      { id: "shared-p1", projectId: "p1", subtaskId: "a", focusSessionIds: ["shared-gap"], progressBasisPoints: 10_000, reportedAt: "2026-09-06T01:00:00.000Z", shared: true },
      { id: "shared-p2", projectId: "p2", subtaskId: "b", focusSessionIds: ["shared-gap"], progressBasisPoints: 10_000, reportedAt: "2026-09-06T01:00:00.000Z", shared: true },
    ];
    const monuments = projectMonumentFocus(state);
    const p1 = monuments.find(item => item.id === "p1")!;
    const p2 = monuments.find(item => item.id === "p2")!;
    expect(p1).toMatchObject({ rounds: 1, interruptedRounds: 1, minutes: 7, interruptedMinutes: 5, unknownRounds: 1, unknownMinutes: 10 });
    expect(p1.subtasks[0]).toMatchObject({ rounds: 1, interruptedRounds: 1, minutes: 7, interruptedMinutes: 5, share: null });
    expect(p2).toMatchObject({ rounds: 1, interruptedRounds: 0, minutes: 1, unknownRounds: 1, unknownMinutes: 10 });
    // The cross-building explicit session belongs only to p2; it is not
    // repeated as known effort under its host p1.
    expect(p1.minutes).toBe(7);
    expect(p2.minutes).toBe(1);
    expect(projectFocusAttribution(state).unallocated).toMatchObject({ rounds: 1, completedRounds: 1, interruptedRounds: 0, minutes: 10 });
  });

  it("computes subtask shares from milliseconds instead of rounded display minutes", () => {
    const state = createInitialState("UTC");
    state.projects = [{ ...finite("p", "主线", "a", "第一步"), subtasks: [
      { id: "a", title: "第一步", order: 0, progressBasisPoints: 10_000 },
      { id: "b", title: "第二步", order: 1, progressBasisPoints: 10_000 },
    ] }];
    state.focusHistory = [
      session("long", "p", "a", "2026-09-06T02:01:30.001Z", 90_001),
      session("short", "p", "b", "2026-09-06T02:02:00.001Z", 30_000),
    ];
    state.progressReports = [
      { id: "long-report", projectId: "p", subtaskId: "a", focusSessionIds: ["long"], progressBasisPoints: 10_000, reportedAt: "2026-09-06T03:00:00.000Z", allocation: "explicit" },
      { id: "short-report", projectId: "p", subtaskId: "b", focusSessionIds: ["short"], progressBasisPoints: 10_000, reportedAt: "2026-09-06T03:00:00.000Z", allocation: "explicit" },
    ];
    const monument = projectMonumentFocus(state)[0]!;
    expect(monument.subtasks.map(item => item.share)).toEqual([75, 25]);
  });

  it("attributes completed habit buildings by retained historical session ids", () => {
    const state: DomainState = createInitialState("UTC");
    state.projects = [{
      id: "habit", title: "阅读", kind: "habit", settlementIndex: 0, blueprintId: "cottage", importedBlueprint: null,
      createdAt: "2026-09-01T00:00:00.000Z", status: "deleted", subtaskStructureLocked: false, subtasks: [],
      habit: { cycleNumber: 2, targetRounds: 10, completedFocusSessionIds: [], awaitingNextBuilding: false },
    }];
    state.focusHistory = [session("habit-session", "habit", null, "2026-09-05T00:05:00.000Z", 30 * 60_000)];
    state.habitBuildings = [{ id: "building-2", habitProjectId: "habit", habitTitle: "阅读", cycleNumber: 2, settlementIndex: 0, blueprintId: "cottage", importedBlueprint: null, targetRounds: 1, focusSessionIds: ["habit-session"], completedAt: "2026-09-05T00:05:00.000Z" }];
    const [building] = projectMonumentFocus(state);
    expect(building).toMatchObject({ id: "building-2", source: "habit", rounds: 1, expectedRounds: 1, unknownRounds: 0, minutes: 30, interruptedRounds: 0, unknownMinutes: 0 });
    expect(projectFocusAttribution(state).sessions[0]).toMatchObject({ kind: "habit-building", projectId: "habit", targetId: "building-2" });
  });
});
