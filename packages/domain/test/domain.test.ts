import { describe, expect, it } from "vitest";
import {
  completedPomodorosOn,
  countPlannedFocusDaysAfter,
  createInitialState,
  dailyGoalForDate,
  execute,
  localDateOf,
  parseDomainState,
  projectProgressBasisPoints,
  type ImportedBlueprintV1,
  type Clock,
  type DomainCommand,
  type DomainState,
} from "../src/index.js";

class TestClock implements Clock {
  constructor(private value = new Date("2026-07-20T09:00:00.000Z")) {}
  now(): Date { return new Date(this.value); }
  set(iso: string): void { this.value = new Date(iso); }
  advance(ms: number): void { this.value = new Date(this.value.getTime() + ms); }
}

function fixture(timeZone = "UTC", restWeekdays = [0, 6]) {
  const clock = new TestClock();
  let state = createInitialState(timeZone, restWeekdays);
  const run = (command: DomainCommand) => {
    const result = execute(state, command, clock);
    if (result.ok) state = result.state;
    return result;
  };
  const create = (projectId = "p1", subtaskIds = ["a", "b"]) => run({
    type: "CreateProject", projectId, title: `Project ${projectId}`, blueprintId: "cottage",
    subtasks: subtaskIds.map((id) => ({ id, title: id.toUpperCase() })),
  });
  const complete = (sessionId: string, subtaskId: string, duration = 1) => {
    run({ type: "StartFocus", sessionId, subtaskId, plannedDurationMs: duration });
    clock.advance(duration);
    return run({ type: "CompleteFocus" });
  };
  const report = (reportId: string, subtaskId: string, progressBasisPoints: number, focusSessionIds: string[]) =>
    run({ type: "ReportSubtaskProgress", reportId, subtaskId, progressBasisPoints, focusSessionIds });
  return { clock, run, create, complete, report, state: () => state };
}

function activeProject(state: DomainState) {
  return state.projects.find((item) => item.id === state.activeProjectId)!;
}

function condition(state: DomainState, projectId = state.activeProjectId!) {
  return state.projectConditions.find((item) => item.projectId === projectId)!;
}

function importedBlueprint(id = "imported-house"): ImportedBlueprintV1 {
  return {
    schemaVersion: 1 as const,
    id,
    title: "Imported house",
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    voxels: [
      { x: 0, y: 0, z: 0, materialId: "stone" as const, stage: "foundation" as const, buildOrder: 0,
        sourceBlockId: "minecraft:torch", sourceBlockState: { facing: "north" }, emissiveKind: "torch", emissiveLevel: 14 },
      { x: 1, y: 0, z: 0, materialId: "wood" as const, stage: "frame" as const, buildOrder: 2_000 },
    ],
  };
}

describe("world environment settings", () => {
  it("changes only the derived environment style and emits a stable event", () => {
    const before = createInitialState("Asia/Shanghai", [0, 6]);
    const result = execute(before, { type: "ConfigureWorldEnvironment", environmentStyle: "classic-island" }, new TestClock());
    if (!result.ok) throw new Error(result.message);
    expect(result.events).toEqual([{ type: "WorldEnvironmentConfigured", environmentStyle: "classic-island" }]);
    expect(result.state.worldSettings).toEqual({
      ...before.worldSettings,
      environmentStyle: "classic-island",
    });
    expect(result.state.projects).toEqual(before.projects);
    expect(result.state.calendar).toEqual(before.calendar);
  });
});

describe("building blueprint library", () => {
  it("stores a display name and renames it without mutating the blueprint snapshot", () => {
    const f = fixture();
    const blueprint = importedBlueprint("library-house");
    expect(f.run({ type: "ImportBuildingBlueprint", blueprint })).toMatchObject({
      ok: true, events: [{ type: "BuildingBlueprintImported", resourceId: blueprint.id }],
    });
    expect(f.state().buildingBlueprintResources[0]).toMatchObject({
      id: blueprint.id, displayName: "Imported house", blueprint: { title: "Imported house" },
    });

    expect(f.run({ type: "RenameBuildingBlueprint", blueprintId: blueprint.id, displayName: "  Reading hall  " })).toMatchObject({
      ok: true, events: [{ type: "BuildingBlueprintRenamed", resourceId: blueprint.id, displayName: "Reading hall" }],
    });
    expect(f.state().buildingBlueprintResources[0]).toMatchObject({
      displayName: "Reading hall", blueprint: { title: "Imported house" },
    });
    expect(f.run({ type: "RenameBuildingBlueprint", blueprintId: blueprint.id, displayName: " " })).toMatchObject({
      ok: false, code: "INVALID_INPUT",
    });
  });
});

describe("imported daily reward decorations", () => {
  it("deduplicates resources and grants a deterministic placement when the daily goal is reached", () => {
    const first = fixture();
    first.create("p1", ["a"]);
    const blueprint = importedBlueprint("litematic-content-hash");
    expect(first.run({ type: "ImportDecorationBlueprint", blueprint })).toMatchObject({
      ok: true, events: [{ type: "DecorationBlueprintImported", resourceId: blueprint.id }],
    });
    expect(first.run({ type: "ImportDecorationBlueprint", blueprint })).toMatchObject({ ok: true, events: [] });
    first.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 1 });
    const completion = first.complete("focus", "a");
    expect(completion).toMatchObject({ ok: true, events: expect.arrayContaining([
      { type: "DecorationRewardGranted", date: "2026-07-20", projectId: "p1", resourceId: blueprint.id },
    ]) });
    expect(first.state().decorationBlueprintResources).toHaveLength(1);
    expect(first.state().decorationRewards).toEqual([expect.objectContaining({
      date: "2026-07-20", projectId: "p1", resourceId: blueprint.id,
      position: expect.objectContaining({ x: expect.any(Number), z: expect.any(Number) }), rotationQuarterTurns: expect.any(Number),
    })]);

    const second = fixture();
    second.create("p1", ["a"]);
    second.run({ type: "ImportDecorationBlueprint", blueprint });
    second.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 1 });
    second.complete("focus", "a");
    expect(second.state().decorationRewards[0]?.position).toEqual(first.state().decorationRewards[0]?.position);
    expect(second.state().decorationRewards[0]?.rotationQuarterTurns).toBe(first.state().decorationRewards[0]?.rotationQuarterTurns);
  });

  it("enforces the dedicated decoration footprint and voxel limits", () => {
    const f = fixture();
    const tooWide = importedBlueprint("too-wide");
    tooWide.bounds.maxX = 12;
    tooWide.voxels = Array.from({ length: 13 }, (_, x) => ({
      x, y: 0, z: 0, materialId: "stone" as const, stage: "foundation" as const, buildOrder: x * 100,
    }));
    expect(f.run({ type: "ImportDecorationBlueprint", blueprint: tooWide })).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const tooDetailed = importedBlueprint("too-detailed");
    tooDetailed.bounds = { minX: 0, maxX: 10, minY: 0, maxY: 15, minZ: 0, maxZ: 11 };
    tooDetailed.voxels = [];
    for (let y = 0; y <= 15 && tooDetailed.voxels.length < 2_001; y += 1) {
      for (let z = 0; z <= 11 && tooDetailed.voxels.length < 2_001; z += 1) {
        for (let x = 0; x <= 10 && tooDetailed.voxels.length < 2_001; x += 1) {
          tooDetailed.voxels.push({ x, y, z, materialId: "stone", stage: "foundation", buildOrder: 0 });
        }
      }
    }
    expect(f.run({ type: "ImportDecorationBlueprint", blueprint: tooDetailed })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("allows a same-ID decoration to enrich missing source state but rejects state conflicts", () => {
    const f = fixture();
    f.create("p1", ["a"]);
    const enriched = importedBlueprint("state-enrichment");
    const legacy = structuredClone(enriched);
    for (const voxel of legacy.voxels) delete voxel.sourceBlockState;
    expect(f.run({ type: "ImportDecorationBlueprint", blueprint: legacy })).toMatchObject({ ok: true });
    expect(f.run({ type: "ImportDecorationBlueprint", blueprint: enriched })).toMatchObject({
      ok: true, events: [{ type: "DecorationBlueprintImported", resourceId: enriched.id }],
    });
    expect(f.state().decorationBlueprintResources[0]!.blueprint.voxels[0]!.sourceBlockState).toEqual({ facing: "north" });

    const conflicting = structuredClone(enriched);
    conflicting.voxels[0]!.sourceBlockState = { facing: "south" };
    expect(f.run({ type: "ImportDecorationBlueprint", blueprint: conflicting })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("habit task building cycles", () => {
  it("advances on normal and early completion, locks the current blueprint, and snapshots the next target", () => {
    const f = fixture();
    expect(f.run({
      type: "CreateHabitProject", projectId: "habit", title: "Read English", blueprintId: "cottage", targetRounds: 10,
    })).toMatchObject({ ok: true, events: expect.arrayContaining([
      { type: "HabitBuildingSelected", projectId: "habit", cycleNumber: 1, targetRounds: 10 },
    ]) });
    expect(activeProject(f.state())).toMatchObject({
      kind: "habit", settlementIndex: 0, subtaskStructureLocked: true, subtasks: [],
      habit: { cycleNumber: 1, targetRounds: 10, completedFocusSessionIds: [], awaitingNextBuilding: false },
    });

    f.run({ type: "StartFocus", sessionId: "normal", subtaskId: null, plannedDurationMs: 1 });
    f.clock.advance(1);
    expect(f.run({ type: "CompleteFocus" })).toMatchObject({ ok: true, events: expect.arrayContaining([
      { type: "HabitBuildingProgressed", projectId: "habit", completedRounds: 1, targetRounds: 10 },
    ]) });
    f.run({ type: "StartFocus", sessionId: "early", subtaskId: null, plannedDurationMs: 1_000 });
    f.clock.advance(400);
    expect(f.run({ type: "CompleteFocusEarly", reportId: "unused-for-habit" })).toMatchObject({ ok: true, events: expect.arrayContaining([
      { type: "FocusCompletedEarly", sessionId: "early", subtaskId: null, actualDurationMs: 400 },
      { type: "HabitBuildingProgressed", projectId: "habit", completedRounds: 2, targetRounds: 10 },
    ]) });
    expect(f.run({ type: "SelectNextHabitBuilding", blueprintId: "tower", targetRounds: 30 })).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    for (let round = 3; round <= 10; round += 1) {
      f.run({ type: "StartFocus", sessionId: `round-${round}`, subtaskId: null, plannedDurationMs: 1 });
      f.clock.advance(1);
      f.run({ type: "CompleteFocus" });
    }
    expect(f.state().habitBuildings).toEqual([expect.objectContaining({
      id: "habit-building:habit:1", habitProjectId: "habit", cycleNumber: 1, settlementIndex: 0,
      blueprintId: "cottage", targetRounds: 10, focusSessionIds: expect.arrayContaining(["normal", "early", "round-10"]),
    })]);
    expect(activeProject(f.state())).toMatchObject({ settlementIndex: 1, habit: { cycleNumber: 2, targetRounds: 10, completedFocusSessionIds: [], awaitingNextBuilding: true } });
    expect(f.run({ type: "StartFocus", sessionId: "blocked", subtaskId: null, plannedDurationMs: 1 })).toMatchObject({ ok: false, code: "HABIT_BUILDING_SELECTION_REQUIRED" });

    expect(f.run({ type: "SelectNextHabitBuilding", blueprintId: "tower", targetRounds: 30 })).toMatchObject({
      ok: true, events: [{ type: "HabitBuildingSelected", projectId: "habit", cycleNumber: 2, targetRounds: 30 }],
    });
    expect(activeProject(f.state())).toMatchObject({ blueprintId: "tower", settlementIndex: 1, habit: { cycleNumber: 2, targetRounds: 30, awaitingNextBuilding: false } });
  });

  it("keeps completed buildings after deleting the habit task", () => {
    const f = fixture();
    f.run({ type: "CreateHabitProject", projectId: "habit", title: "Practice", blueprintId: "cottage", targetRounds: 10 });
    for (let round = 1; round <= 10; round += 1) {
      f.run({ type: "StartFocus", sessionId: `focus-${round}`, subtaskId: null, plannedDurationMs: 1 });
      f.clock.advance(1);
      f.run({ type: "CompleteFocus" });
    }
    f.run({ type: "SelectNextHabitBuilding", blueprintId: "tower", targetRounds: 10 });
    expect(f.run({ type: "DeleteActiveProject", projectId: "habit" })).toMatchObject({ ok: true });
    expect(f.state()).toMatchObject({ activeProjectId: null, projects: [{ id: "habit", status: "deleted" }] });
    expect(f.state().habitBuildings).toHaveLength(1);
    expect(f.state().habitBuildings[0]).toMatchObject({ habitProjectId: "habit", blueprintId: "cottage", cycleNumber: 1 });
    expect(parseDomainState(f.state())).toEqual(f.state());
  });
});

describe("project lifecycle and ownership", () => {
  it("stores a validated imported blueprint with its owning project", () => {
    const f = fixture();
    const blueprint = importedBlueprint();
    const result = f.run({
      type: "CreateProject", projectId: "imported-project", title: "Imported", blueprintId: blueprint.id,
      importedBlueprint: blueprint, subtasks: [{ id: "step", title: "Step" }],
    });
    expect(result).toMatchObject({ ok: true });
    expect(activeProject(f.state()).importedBlueprint).toEqual(blueprint);
    expect(activeProject(f.state()).importedBlueprint).not.toBe(blueprint);
    blueprint.voxels[0]!.x = 99;
    blueprint.voxels[0]!.sourceBlockState!.facing = "south";
    expect(activeProject(f.state()).importedBlueprint?.voxels[0]!.x).toBe(0);
    expect(activeProject(f.state()).importedBlueprint?.voxels[0]!.sourceBlockState).toEqual({ facing: "north" });
  });

  it("rejects imported blueprints whose ID or geometry contract is invalid", () => {
    const cases = [
      { name: "mismatched ID", blueprintId: "different", blueprint: importedBlueprint() },
      { name: "duplicate coordinate", blueprintId: "imported-house", blueprint: { ...importedBlueprint(), voxels: [importedBlueprint().voxels[0]!, importedBlueprint().voxels[0]!] } },
      { name: "inexact bounds", blueprintId: "imported-house", blueprint: { ...importedBlueprint(), bounds: { ...importedBlueprint().bounds, maxX: 2 } } },
      { name: "oversize footprint", blueprintId: "imported-house", blueprint: { ...importedBlueprint(), bounds: { minX: 0, maxX: 48, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }, voxels: [importedBlueprint().voxels[0]!, { ...importedBlueprint().voxels[1]!, x: 48 }] } },
      { name: "invalid build order", blueprintId: "imported-house", blueprint: { ...importedBlueprint(), voxels: [importedBlueprint().voxels[0]!, { ...importedBlueprint().voxels[1]!, buildOrder: 10_001 }] } },
    ];
    for (const item of cases) {
      const f = fixture();
      expect(f.run({
        type: "CreateProject", projectId: `bad-${item.name}`, title: "Bad", blueprintId: item.blueprintId,
        importedBlueprint: item.blueprint as never, subtasks: [{ id: "step", title: "Step" }],
      })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(f.state().projects).toEqual([]);
    }
  });

  it("accepts imported blueprints at the 48 by 48 footprint and 128 height limits", () => {
    const f = fixture();
    const blueprint = {
      schemaVersion: 1 as const,
      id: "boundary-blueprint",
      title: "Boundary blueprint",
      bounds: { minX: 0, maxX: 47, minY: 0, maxY: 127, minZ: 0, maxZ: 47 },
      voxels: [
        { x: 0, y: 0, z: 0, materialId: "stone" as const, stage: "foundation" as const, buildOrder: 0 },
        { x: 47, y: 127, z: 47, materialId: "accent" as const, stage: "details" as const, buildOrder: 10_000 },
      ],
    };
    expect(f.run({
      type: "CreateProject", projectId: "boundary", title: "Boundary", blueprintId: blueprint.id,
      importedBlueprint: blueprint, subtasks: [{ id: "step", title: "Step" }],
    })).toMatchObject({ ok: true });
  });

  it("pauses the current project when creating another and switches without losing ownership", () => {
    const f = fixture();
    f.create("p1", ["a"]);
    f.complete("focus-a", "a");
    f.report("report-a", "a", 4_000, ["focus-a"]);
    const firstCondition = condition(f.state(), "p1").conditionBasisPoints;

    expect(f.create("p2", ["b"])).toMatchObject({
      ok: true,
      events: [
        { type: "ProjectPaused", projectId: "p1" },
        { type: "ProjectCreated", projectId: "p2" },
      ],
    });
    expect(f.state()).toMatchObject({
      activeProjectId: "p2",
      projects: [{ id: "p1", status: "paused" }, { id: "p2", status: "active" }],
    });

    expect(f.run({ type: "SwitchActiveProject", projectId: "p1" })).toMatchObject({
      ok: true,
      events: [
        { type: "ProjectPaused", projectId: "p2" },
        { type: "ProjectActivated", projectId: "p1" },
      ],
    });
    expect(activeProject(f.state())).toMatchObject({ id: "p1", status: "active", subtasks: [{ progressBasisPoints: 4_000 }] });
    expect(condition(f.state(), "p1").conditionBasisPoints).toBe(firstCondition);
    expect(f.state().focusHistory).toMatchObject([{ id: "focus-a", projectId: "p1" }]);
    expect(f.state().progressReports).toMatchObject([{ id: "report-a", projectId: "p1" }]);
  });

  it("blocks project creation and switching while focus is active or awaiting a progress report", () => {
    const f = fixture();
    f.create("p1", ["a"]);
    f.run({ type: "StartFocus", sessionId: "running", subtaskId: "a", plannedDurationMs: 1 });
    expect(f.create("p2", ["b"])).toMatchObject({ ok: false, code: "ACTIVE_FOCUS_PREVENTS_PROJECT_SWITCH" });
    f.clock.advance(1);
    f.run({ type: "CompleteFocus" });
    expect(f.create("p2", ["b"])).toMatchObject({ ok: false, code: "UNREPORTED_FOCUS_PREVENTS_PROJECT_SWITCH" });
    expect(f.run({ type: "SwitchActiveProject", projectId: "p1" })).toMatchObject({ ok: false, code: "UNREPORTED_FOCUS_PREVENTS_PROJECT_SWITCH" });
    f.report("reported", "a", 0, ["running"]);
    expect(f.create("p2", ["b"]).ok).toBe(true);
    f.run({ type: "StartFocus", sessionId: "running-b", subtaskId: "b", plannedDurationMs: 1 });
    expect(f.run({ type: "SwitchActiveProject", projectId: "p1" })).toMatchObject({ ok: false, code: "ACTIVE_FOCUS_PREVENTS_PROJECT_SWITCH" });
  });

  it("rejects switching monuments or missing projects and treats switching current as a no-op", () => {
    const f = fixture(); f.create("p1", ["a"]);
    expect(f.run({ type: "SwitchActiveProject", projectId: "p1" })).toMatchObject({ ok: true, events: [] });
    expect(f.run({ type: "SwitchActiveProject", projectId: "missing" })).toMatchObject({ ok: false, code: "PROJECT_NOT_FOUND" });
    f.complete("done", "a"); f.report("done-report", "a", 10_000, ["done"]);
    expect(f.run({ type: "SwitchActiveProject", projectId: "p1" })).toMatchObject({ ok: false, code: "PROJECT_IS_MONUMENT" });
  });

  it("keeps monuments and their condition while allowing the next active project", () => {
    const f = fixture();
    f.create();
    f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 1_000, gracePlannedDays: 0 });
    f.clock.set("2026-07-21T09:00:00.000Z");
    f.run({ type: "AssessDecay" });
    f.complete("fa", "a"); f.report("ra", "a", 10_000, ["fa"]);
    f.complete("fb", "b");
    const sealedCondition = condition(f.state(), "p1").conditionBasisPoints;
    f.report("rb", "b", 10_000, ["fb"]);
    expect(f.state()).toMatchObject({ activeProjectId: null, projects: [{ id: "p1", status: "monument" }] });
    expect(f.create("p2", ["c"]).ok).toBe(true);
    expect(f.state().projects).toHaveLength(2);
    expect(condition(f.state(), "p1").conditionBasisPoints).toBe(sealedCondition);
    expect(condition(f.state(), "p2").conditionBasisPoints).toBe(10_000);
  });

  it("locks structure after positive progress, allows active rename/reorder, and rejects monument edits", () => {
    const f = fixture(); f.create(); f.complete("fa", "a"); f.report("ra", "a", 10_000, ["fa"]);
    expect(f.run({ type: "AddSubtask", subtaskId: "x", title: "X" })).toMatchObject({ ok: false, code: "SUBTASK_STRUCTURE_LOCKED" });
    expect(f.run({ type: "RemoveSubtask", subtaskId: "b" })).toMatchObject({ ok: false, code: "SUBTASK_STRUCTURE_LOCKED" });
    expect(f.run({ type: "RenameProject", title: "  Renamed project  " })).toMatchObject({
      ok: true,
      events: [{ type: "ProjectRenamed", projectId: "p1" }],
    });
    expect(f.state().projects[0]!.title).toBe("Renamed project");
    expect(f.run({ type: "RenameSubtask", subtaskId: "a", title: "Renamed" }).ok).toBe(true);
    expect(f.run({ type: "ReorderSubtasks", orderedSubtaskIds: ["b", "a"] }).ok).toBe(true);
    f.complete("fb", "b"); f.report("rb", "b", 10_000, ["fb"]);
    expect(f.run({ type: "RenameProject", title: "No" })).toMatchObject({ ok: false, code: "PROJECT_NOT_FOUND" });
    expect(f.run({ type: "RenameSubtask", subtaskId: "a", title: "No" })).toMatchObject({ ok: false, code: "PROJECT_NOT_FOUND" });
    expect(f.run({ type: "ReorderSubtasks", orderedSubtaskIds: ["a", "b"] })).toMatchObject({ ok: false, code: "PROJECT_NOT_FOUND" });
  });

  it("keeps structure editable after a zero-progress report", () => {
    const f = fixture(); f.create("p1", ["a", "b", "unused"]); f.complete("fa", "a");
    expect(f.report("ra", "a", 0, ["fa"])).toMatchObject({ ok: true });
    expect(activeProject(f.state()).subtaskStructureLocked).toBe(false);
    expect(f.run({ type: "AddSubtask", subtaskId: "c", title: "C" })).toMatchObject({ ok: true });
    expect(f.run({ type: "RemoveSubtask", subtaskId: "unused" })).toMatchObject({ ok: true });
    expect(activeProject(f.state()).subtasks.map((subtask) => subtask.id)).toEqual(["a", "b", "c"]);
  });

  it("rejects invalid reorder sets without changing state", () => {
    const f = fixture(); f.create();
    for (const orderedSubtaskIds of [["a"], ["a", "a"], ["a", "foreign"]]) {
      const before = f.state();
      const result = f.run({ type: "ReorderSubtasks", orderedSubtaskIds });
      expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(result.state).toBe(before);
      expect(f.state()).toBe(before);
    }
  });

  it("rejects a blank project rename without changing the project", () => {
    const f = fixture(); f.create();
    const before = f.state();
    expect(f.run({ type: "RenameProject", title: "   " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(f.state()).toEqual(before);
  });

  it("soft-deletes the confirmed active project while retaining all historical facts", () => {
    const f = fixture(); f.create();
    f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 1 });
    f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 500, gracePlannedDays: 0 });
    f.complete("fa", "a");
    f.report("ra", "a", 5_000, ["fa"]);
    const before = f.state();

    expect(f.run({ type: "DeleteActiveProject", projectId: "p1" })).toMatchObject({
      ok: true,
      events: [{ type: "ProjectDeleted", projectId: "p1" }],
    });
    expect(f.state()).toMatchObject({
      activeProjectId: null,
      projects: [{ id: "p1", status: "deleted", subtasks: before.projects[0]!.subtasks }],
      focusHistory: before.focusHistory,
      progressReports: before.progressReports,
      dailyGoals: before.dailyGoals,
      projectConditions: [{ projectId: "p1", inactivityAnchorAt: null, assessedMissedPlannedDays: 0 }],
    });
    expect(f.create("p2", ["c"]).ok).toBe(true);
    expect(f.state().projects.map((project) => project.status)).toEqual(["deleted", "active"]);
  });

  it("rejects a stale deletion target without changing state", () => {
    const f = fixture(); f.create();
    const before = f.state();
    const result = f.run({ type: "DeleteActiveProject", projectId: "another-project" });
    expect(result).toMatchObject({ ok: false, code: "PROJECT_DELETE_TARGET_MISMATCH" });
    expect(result.state).toBe(before);
    expect(f.state()).toBe(before);
  });

  it("rejects deletion while focus is active without changing state", () => {
    const f = fixture(); f.create();
    f.run({ type: "StartFocus", sessionId: "running", subtaskId: "a", plannedDurationMs: 1_000 });
    const before = f.state();
    const result = f.run({ type: "DeleteActiveProject", projectId: "p1" });
    expect(result).toMatchObject({ ok: false, code: "ACTIVE_FOCUS_PREVENTS_PROJECT_DELETION" });
    expect(result.state).toBe(before);
    expect(f.state()).toBe(before);
  });

  it("rejects deletion with history and permanently retires deleted IDs", () => {
    const f = fixture(); f.create("p1", ["a", "b", "unused"]);
    f.complete("fa", "a");
    expect(f.run({ type: "RemoveSubtask", subtaskId: "a" })).toMatchObject({ ok: false, code: "SUBTASK_HAS_HISTORY" });
    expect(f.run({ type: "RemoveSubtask", subtaskId: "unused" }).ok).toBe(true);
    expect(f.run({ type: "AddSubtask", subtaskId: "unused", title: "Reused" })).toMatchObject({ ok: false, code: "DUPLICATE_ID" });
  });

  it("does not seal while another focus is active", () => {
    const f = fixture(); f.create();
    f.complete("fa", "a"); f.report("ra", "a", 10_000, ["fa"]);
    f.complete("fb", "b");
    f.run({ type: "StartFocus", sessionId: "running", subtaskId: "b", plannedDurationMs: 1000 });
    expect(f.report("rb", "b", 10_000, ["fb"])).toMatchObject({ ok: false, code: "ACTIVE_FOCUS_PREVENTS_SEALING" });
    f.run({ type: "CancelFocus" });
    expect(f.report("rb", "b", 10_000, ["fb"]).ok).toBe(true);
  });

  it("uses equal-share basis points and exact boundaries", () => {
    const f = fixture(); f.create();
    for (const [value, id] of [[0, "z"], [1, "one"], [9_999, "high"], [10_000, "full"]] as const) {
      f.complete(id, "a"); expect(f.report(`r-${id}`, "a", value, [id]).ok).toBe(true);
    }
    expect(projectProgressBasisPoints(activeProject(f.state()))).toBe(5_000);
    for (const value of [-1, 10_001, 0.5]) {
      expect(f.run({ type: "ReportSubtaskProgress", reportId: `bad-${value}`, subtaskId: "b", progressBasisPoints: value, focusSessionIds: [] })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });

  it("returns the exact input state reference for every failure path", () => {
    const clock = new TestClock();
    const state = createInitialState();
    const explicit = execute(state, { type: "CompleteFocus" }, clock);
    const thrown = execute(state, { type: "ConfigureCalendar", timeZone: "Mars/Olympus", restWeekdays: [] }, clock);
    expect(explicit.ok).toBe(false); expect(explicit.state).toBe(state);
    expect(thrown.ok).toBe(false); expect(thrown.state).toBe(state);
  });
});

describe("focus completion and goals", () => {
  it("defaults every new local date to an enabled eight-round goal", () => {
    const state = createInitialState();
    expect(dailyGoalForDate(state, "2026-07-20")).toEqual({
      date: "2026-07-20", targetPomodoros: 8, reachedAt: null, enabled: true,
    });
    expect(state.dailyGoals).toEqual([]);
  });

  it("records delayed recovery at persisted endsAt, not recovery time", () => {
    const f = fixture("Asia/Shanghai");
    f.clock.set("2026-07-20T15:59:59.000Z"); f.create();
    f.run({ type: "StartFocus", sessionId: "midnight", subtaskId: "a", plannedDurationMs: 2_000 });
    f.clock.set("2026-07-23T10:00:00.000Z"); f.run({ type: "CompleteFocus" });
    expect(f.state().focusHistory[0]).toMatchObject({ completedAt: "2026-07-20T16:00:01.000Z", completedLocalDate: "2026-07-21" });
  });

  it("keeps the start timezone if settings change before delayed completion", () => {
    const f = fixture("Asia/Shanghai");
    f.clock.set("2026-07-20T15:59:59.000Z"); f.create();
    f.run({ type: "StartFocus", sessionId: "travel", subtaskId: "a", plannedDurationMs: 2_000 });
    f.run({ type: "ConfigureCalendar", timeZone: "America/Los_Angeles", restWeekdays: [0, 6] });
    f.clock.set("2026-07-22T00:00:00.000Z"); f.run({ type: "CompleteFocus" });
    expect(f.state().focusHistory[0]).toMatchObject({ completedLocalDate: "2026-07-21", timeZoneAtStart: "Asia/Shanghai" });
  });

  it("counts across subtasks toward a daily goal", () => {
    const f = fixture(); f.create();
    f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 2 });
    f.complete("fa", "a"); f.complete("fb", "b");
    expect(completedPomodorosOn(f.state(), "2026-07-20")).toBe(2);
    expect(f.state().dailyGoals[0]!.reachedAt).not.toBeNull();
  });

  it("counts same-day pomodoros completed before the daily goal is enabled", () => {
    const f = fixture(); f.create();
    f.complete("before-goal-a", "a");
    f.complete("before-goal-b", "b");

    expect(f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 2 })).toMatchObject({
      ok: true,
      events: [
        { type: "DailyGoalSet", date: "2026-07-20", targetPomodoros: 2 },
        { type: "DailyGoalReached", date: "2026-07-20" },
      ],
    });
    expect(completedPomodorosOn(f.state(), "2026-07-20")).toBe(2);
    expect(f.state().dailyGoals[0]).toMatchObject({ enabled: true, targetPomodoros: 2, reachedAt: expect.any(String) });
  });

  it("updates, disables, re-enables, and lowers a goal without rewarding it twice", () => {
    const f = fixture(); f.create();
    f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 3 });
    f.complete("fa", "a"); f.complete("fb", "b");
    expect(f.state().dailyGoals[0]).toMatchObject({ targetPomodoros: 3, enabled: true, reachedAt: null });

    f.run({ type: "DisableDailyGoal", date: "2026-07-20" });
    expect(f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 4 })).toMatchObject({
      ok: true,
      events: [{ type: "DailyGoalSet", date: "2026-07-20", targetPomodoros: 4 }],
    });
    expect(f.state().dailyGoals[0]).toMatchObject({ targetPomodoros: 4, enabled: true, reachedAt: null });

    const reached = f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 2 });
    expect(reached).toMatchObject({
      ok: true,
      events: [
        { type: "DailyGoalSet", date: "2026-07-20", targetPomodoros: 2 },
        { type: "DailyGoalReached", date: "2026-07-20" },
      ],
    });
    const reachedAt = f.state().dailyGoals[0]!.reachedAt;
    expect(reachedAt).not.toBeNull();

    expect(f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 1 })).toMatchObject({
      ok: true,
      events: [{ type: "DailyGoalSet", date: "2026-07-20", targetPomodoros: 1 }],
    });
    f.run({ type: "DisableDailyGoal", date: "2026-07-20" });
    expect(f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 3 })).toMatchObject({
      ok: true,
      events: [{ type: "DailyGoalSet", date: "2026-07-20", targetPomodoros: 3 }],
    });
    expect(f.state().dailyGoals[0]).toMatchObject({ targetPomodoros: 3, enabled: true, reachedAt });
  });

  it("rejects invalid daily goal targets without changing state", () => {
    const f = fixture(); f.create();
    f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 2 });
    for (const targetPomodoros of [0, -1, 1.5]) {
      const before = f.state();
      const result = f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros });
      expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(result.state).toBe(before);
      expect(f.state()).toBe(before);
    }
  });

  it("does not reward a disabled unreached goal", () => {
    const f = fixture(); f.create();
    f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 1 });
    f.run({ type: "DisableDailyGoal", date: "2026-07-20" });
    expect(f.complete("fa", "a")).not.toMatchObject({ events: expect.arrayContaining([{ type: "DailyGoalReached" }]) });
    expect(f.state().dailyGoals[0]!.reachedAt).toBeNull();
  });

  it("records early cancel but refuses cancel at endsAt", () => {
    const f = fixture(); f.create();
    f.run({ type: "StartFocus", sessionId: "early", subtaskId: "a", plannedDurationMs: 10 });
    expect(f.run({ type: "CancelFocus" }).ok).toBe(true);
    f.run({ type: "StartFocus", sessionId: "elapsed", subtaskId: "a", plannedDurationMs: 10 }); f.clock.advance(10);
    expect(f.run({ type: "CancelFocus" })).toMatchObject({ ok: false, code: "FOCUS_ALREADY_ELAPSED" });
  });

  it("records categorized interruption without changing task progress", () => {
    const f = fixture(); f.create("p1", ["a"]);
    f.run({ type: "StartFocus", sessionId: "interrupted", subtaskId: "a", plannedDurationMs: 60_000 });
    f.clock.advance(12_000);
    expect(f.run({ type: "CancelFocus", interruptionCategory: "task-blocked" })).toMatchObject({
      ok: true,
      events: [{ type: "FocusInterrupted", sessionId: "interrupted", reason: "user-cancelled", category: "task-blocked" }],
    });
    expect(f.state().focusHistory[0]).toMatchObject({
      status: "interrupted", interruptionCategory: "task-blocked", actualDurationMs: 12_000,
    });
    expect(activeProject(f.state()).subtasks[0]!.progressBasisPoints).toBe(0);
  });

  it("counts an early task completion toward the daily goal", () => {
    const f = fixture(); f.create();
    f.run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 1 });
    f.run({ type: "StartFocus", sessionId: "early-done", subtaskId: "a", plannedDurationMs: 60_000 });
    f.clock.advance(15_000);
    expect(f.run({ type: "CompleteFocusEarly", reportId: "early-report" })).toMatchObject({
      ok: true,
      events: expect.arrayContaining([
        { type: "FocusCompletedEarly", sessionId: "early-done", subtaskId: "a", actualDurationMs: 15_000 },
        { type: "SubtaskProgressReported", subtaskId: "a", progressBasisPoints: 10_000 },
      ]),
    });
    expect(f.state().focusHistory[0]).toMatchObject({ status: "completed-early", actualDurationMs: 15_000 });
    expect(f.state().progressReports[0]).toMatchObject({ id: "early-report", focusSessionIds: ["early-done"], progressBasisPoints: 10_000 });
    expect(activeProject(f.state()).subtasks.map((task) => task.progressBasisPoints)).toEqual([10_000, 0]);
    expect(completedPomodorosOn(f.state(), "2026-07-20")).toBe(1);
    expect(f.state().dailyGoals[0]!.reachedAt).not.toBeNull();
  });
});

describe("focus integrity", () => {
  it("defaults to enabled with failure on the third effective excursion", () => {
    const f = fixture(); f.create("p1", ["a"]);
    expect(f.state().focusIntegrityPolicy).toEqual({ enabled: true, maxEffectiveExcursions: 3 });
    f.run({ type: "StartFocus", sessionId: "focus", subtaskId: "a", plannedDurationMs: 60_000 });

    for (let count = 1; count <= 3; count += 1) {
      f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" });
      f.clock.advance(3_001);
      const result = f.run({ type: "RecordFocusForegrounded" });
      if (!result.ok) throw new Error(result.message);
      expect(result.events[0]).toMatchObject({
        type: "FocusExcursionRecorded", sessionId: "focus", effectiveExcursions: count, maxEffectiveExcursions: 3,
      });
      expect(result.events.slice(1)).toEqual(count === 3
        ? [{ type: "FocusInterrupted", sessionId: "focus", reason: "app-switch-limit", category: null }]
        : []);
      if (count < 3) expect(f.state().activeFocusSession?.integrity.effectiveExcursions).toBe(count);
    }

    expect(f.state().activeFocusSession).toBeNull();
    expect(f.state().focusHistory).toMatchObject([{
      id: "focus", status: "interrupted", interruptionReason: "app-switch-limit",
    }]);
    expect(f.state().focusHistory[0]).not.toHaveProperty("integrity");
    expect(completedPomodorosOn(f.state(), "2026-07-20")).toBe(0);
  });

  it("does not count a return at exactly three seconds but counts one millisecond later", () => {
    const f = fixture(); f.create("p1", ["a"]);
    f.run({ type: "StartFocus", sessionId: "focus", subtaskId: "a", plannedDurationMs: 60_000 });
    f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" });
    f.clock.advance(3_000);
    expect(f.run({ type: "RecordFocusForegrounded" })).toMatchObject({ ok: true, events: [] });
    expect(f.state().activeFocusSession?.integrity.effectiveExcursions).toBe(0);
    f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" });
    f.clock.advance(3_001);
    expect(f.run({ type: "RecordFocusForegrounded" })).toMatchObject({
      ok: true, events: [{ type: "FocusExcursionRecorded", effectiveExcursions: 1 }],
    });
  });

  it("persists one-shot and lock-screen exemptions without incrementing the count", () => {
    const f = fixture(); f.create("p1", ["a"]);
    f.run({ type: "StartFocus", sessionId: "focus", subtaskId: "a", plannedDurationMs: 60_000 });
    expect(f.run({ type: "GrantFocusLifecycleExemption" })).toMatchObject({
      ok: true, events: [{ type: "FocusLifecycleExemptionGranted", sessionId: "focus" }],
    });
    expect(f.state().activeFocusSession?.integrity.exemptionPending).toBe(true);
    expect(f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" })).toMatchObject({
      ok: true, events: [{ type: "FocusBackgrounded", reason: "system-exempt" }],
    });
    expect(f.state().activeFocusSession?.integrity.exemptionPending).toBe(false);
    f.clock.advance(10_000);
    f.run({ type: "RecordFocusForegrounded" });
    f.run({ type: "RecordFocusBackgrounded", reason: "screen-lock" });
    f.clock.advance(10_000);
    f.run({ type: "RecordFocusForegrounded" });
    expect(f.state().activeFocusSession?.integrity.effectiveExcursions).toBe(0);
  });

  it("completes normally at endsAt before applying the excursion limit", () => {
    const f = fixture(); f.create("p1", ["a"]);
    f.run({ type: "StartFocus", sessionId: "focus", subtaskId: "a", plannedDurationMs: 10_000 });
    for (let count = 0; count < 2; count += 1) {
      f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" });
      f.clock.advance(3_001);
      f.run({ type: "RecordFocusForegrounded" });
    }
    f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" });
    f.clock.advance(3_998);
    expect(f.run({ type: "RecordFocusForegrounded" })).toMatchObject({
      ok: true, events: [{ type: "FocusCompleted", sessionId: "focus" }],
    });
    expect(f.state().focusHistory).toMatchObject([{ id: "focus", status: "completed", completedAt: "2026-07-20T09:00:10.000Z" }]);
  });

  it("supports disabling integrity and configurable limits from one through five", () => {
    const f = fixture(); f.create("p1", ["a"]);
    for (const maxEffectiveExcursions of [1, 2, 3, 4, 5]) {
      expect(f.run({ type: "ConfigureFocusIntegrity", enabled: false, maxEffectiveExcursions })).toMatchObject({ ok: true });
      expect(f.state().focusIntegrityPolicy).toEqual({ enabled: false, maxEffectiveExcursions });
    }
    for (const maxEffectiveExcursions of [0, 6, 1.5]) {
      expect(f.run({ type: "ConfigureFocusIntegrity", enabled: true, maxEffectiveExcursions })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    f.run({ type: "StartFocus", sessionId: "focus", subtaskId: "a", plannedDurationMs: 60_000 });
    f.run({ type: "RecordFocusBackgrounded", reason: "web-visibility" });
    f.clock.advance(10_000);
    f.run({ type: "RecordFocusForegrounded" });
    expect(f.state().activeFocusSession?.integrity.effectiveExcursions).toBe(0);
  });
});

describe("decay policy, calendar, and per-project runtime", () => {
  it("assesses active and paused unfinished projects from independent inactivity anchors", () => {
    const f = fixture("UTC", [0, 6]);
    f.create("p1", ["a"]);
    f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 1_000, gracePlannedDays: 0 });
    f.clock.set("2026-07-21T09:00:00.000Z");
    f.create("p2", ["b"]);
    f.clock.set("2026-07-22T09:00:00.000Z");

    expect(f.run({ type: "AssessDecay" })).toMatchObject({
      ok: true,
      events: [
        { type: "BuildingConditionDecayed", projectId: "p1", newlyMissedPlannedDays: 2 },
        { type: "BuildingConditionDecayed", projectId: "p2", newlyMissedPlannedDays: 1 },
      ],
    });
    expect(condition(f.state(), "p1").conditionBasisPoints).toBe(8_000);
    expect(condition(f.state(), "p2").conditionBasisPoints).toBe(9_000);
    expect(f.run({ type: "SwitchActiveProject", projectId: "p1" }).ok).toBe(true);
    expect(condition(f.state(), "p1").inactivityAnchorAt).toBe("2026-07-20T09:00:00.000Z");
    expect(condition(f.state(), "p2").inactivityAnchorAt).toBe("2026-07-21T09:00:00.000Z");
  });

  it("defaults off with grace 2 and accepts non-negative configured grace", () => {
    const f = fixture(); f.create();
    expect(f.state().decayPolicy).toMatchObject({ enabled: false, gracePlannedDays: 2, repairMultiplierBasisPoints: 20_000 });
    expect(f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 100, gracePlannedDays: -1 })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 100, gracePlannedDays: 0 }).ok).toBe(true);
  });

  it("resets inactivity anchor on decay policy and calendar changes", () => {
    const f = fixture(); f.create();
    f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 100, gracePlannedDays: 2 });
    f.clock.set("2026-07-25T09:00:00.000Z");
    f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 200, gracePlannedDays: 1 });
    expect(condition(f.state()).inactivityAnchorAt).toBe("2026-07-25T09:00:00.000Z");
    f.clock.set("2026-07-26T09:00:00.000Z");
    f.run({ type: "ConfigureCalendar", timeZone: "Asia/Shanghai", restWeekdays: [0] });
    expect(condition(f.state()).inactivityAnchorAt).toBe("2026-07-26T09:00:00.000Z");
  });

  it("supports one-basis-point damage and clamps condition at both bounds", () => {
    const f = fixture(); f.create();
    f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 1, gracePlannedDays: 0 });
    f.clock.set("2026-07-21T09:00:00.000Z"); f.run({ type: "AssessDecay" });
    expect(condition(f.state()).conditionBasisPoints).toBe(9_999);
    f.complete("repair", "a");
    expect(condition(f.state()).conditionBasisPoints).toBe(10_000);
    f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 10_000, gracePlannedDays: 0 });
    f.clock.set("2026-07-22T09:00:01.000Z"); f.run({ type: "AssessDecay" });
    expect(condition(f.state()).conditionBasisPoints).toBe(0);
    f.clock.set("2026-07-23T09:00:01.000Z"); f.run({ type: "AssessDecay" });
    expect(condition(f.state()).conditionBasisPoints).toBe(0);
  });

  it("routes decay and repair events to the active project after a prior monument", () => {
    const f = fixture(); f.create();
    f.complete("p1-a", "a"); f.report("p1-ra", "a", 10_000, ["p1-a"]);
    f.complete("p1-b", "b"); f.report("p1-rb", "b", 10_000, ["p1-b"]);
    f.create("p2", ["c"]);
    f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 1_000, gracePlannedDays: 0 });
    f.clock.set("2026-07-21T09:00:00.002Z");
    expect(f.run({ type: "AssessDecay" })).toMatchObject({
      ok: true,
      events: [{ type: "BuildingConditionDecayed", projectId: "p2", conditionBasisPoints: 9_000 }],
    });
    const repaired = f.complete("p2-c", "c");
    expect(repaired).toMatchObject({
      ok: true,
      events: expect.arrayContaining([{ type: "BuildingConditionRepaired", projectId: "p2", conditionBasisPoints: 10_000 }]),
    });
    expect(condition(f.state(), "p1").conditionBasisPoints).toBe(10_000);
  });

  it("never decays when all weekdays are rest days", () => {
    const f = fixture("UTC", [0, 1, 2, 3, 4, 5, 6]); f.create();
    f.run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 10_000, gracePlannedDays: 0 });
    f.clock.set("2027-07-20T09:00:00.000Z");
    expect(f.run({ type: "AssessDecay" })).toMatchObject({ ok: true, events: [] });
    expect(condition(f.state()).conditionBasisPoints).toBe(10_000);
  });

  it("uses local calendar dates correctly across DST transitions", () => {
    expect(localDateOf("2026-03-08T06:30:00.000Z", "America/New_York")).toBe("2026-03-08");
    expect(localDateOf("2026-03-08T07:30:00.000Z", "America/New_York")).toBe("2026-03-08");
    expect(countPlannedFocusDaysAfter("2026-03-06", "2026-03-09", { timeZone: "America/New_York", restWeekdays: [0, 6] })).toBe(1);
  });
});

describe("V21 marathon final report", () => {
  it("attributes a block of completed sessions to multiple subtasks atomically", () => {
    const f = fixture();
    f.create("p1", ["a", "b", "c"]);
    f.complete("s1", "a");
    f.complete("s2", "a");
    const result = f.run({
      type: "ReportMarathonFocus",
      entries: [
        { reportId: "m1", subtaskId: "a", progressBasisPoints: 5_000 },
        { reportId: "m2", subtaskId: "b", progressBasisPoints: 2_500 },
      ],
      focusSessionIds: ["s1", "s2"],
    });
    expect(result).toMatchObject({ ok: true });
    const project = activeProject(f.state());
    expect(project.subtasks.find((item) => item.id === "a")).toMatchObject({ progressBasisPoints: 5_000 });
    expect(project.subtasks.find((item) => item.id === "b")).toMatchObject({ progressBasisPoints: 2_500 });
    expect(project.subtasks.find((item) => item.id === "c")).toMatchObject({ progressBasisPoints: 0 });
    expect(f.state().progressReports).toHaveLength(2);
    expect(project.subtaskStructureLocked).toBe(true);
  });

  it("rejects reused sessions, decreasing progress, unknown subtasks, and empty sessions", () => {
    const f = fixture();
    f.create("p1", ["a", "b"]);
    f.complete("s1", "a");
    expect(f.run({
      type: "ReportMarathonFocus",
      entries: [{ reportId: "m1", subtaskId: "a", progressBasisPoints: 1_000 }],
      focusSessionIds: ["s1"],
    })).toMatchObject({ ok: true });
    expect(f.run({
      type: "ReportMarathonFocus",
      entries: [{ reportId: "m2", subtaskId: "b", progressBasisPoints: 1_000 }],
      focusSessionIds: ["s1"],
    })).toMatchObject({ ok: false, code: "FOCUS_ALREADY_REPORTED" });
    expect(f.run({
      type: "ReportMarathonFocus",
      entries: [{ reportId: "m3", subtaskId: "a", progressBasisPoints: 500 }],
      focusSessionIds: ["s1"],
    })).toMatchObject({ ok: false, code: "PROGRESS_CANNOT_DECREASE" });
    expect(f.run({
      type: "ReportMarathonFocus",
      entries: [{ reportId: "m4", subtaskId: "nope", progressBasisPoints: 1_000 }],
      focusSessionIds: ["s2"],
    })).toMatchObject({ ok: false, code: "SUBTASK_NOT_FOUND" });
    expect(f.run({
      type: "ReportMarathonFocus",
      entries: [{ reportId: "m5", subtaskId: "a", progressBasisPoints: 2_500 }],
      focusSessionIds: ["s2"],
    })).toMatchObject({ ok: false, code: "PROGRESS_REQUIRES_COMPLETED_FOCUS" });
    expect(f.run({
      type: "ReportMarathonFocus",
      entries: [{ reportId: "m6", subtaskId: "a", progressBasisPoints: 2_500 }],
      focusSessionIds: [],
    })).toMatchObject({ ok: false, code: "PROGRESS_REQUIRES_COMPLETED_FOCUS" });
  });

  it("seals the project when the marathon completes every subtask", () => {
    const f = fixture();
    f.create("p1", ["a", "b"]);
    f.complete("s1", "a");
    f.complete("s2", "b");
    const result = f.run({
      type: "ReportMarathonFocus",
      entries: [
        { reportId: "m1", subtaskId: "a", progressBasisPoints: 10_000 },
        { reportId: "m2", subtaskId: "b", progressBasisPoints: 10_000 },
      ],
      focusSessionIds: ["s1", "s2"],
    });
    const events = result.ok ? result.events.map((event) => event.type) : [];
    expect(events).toContain("ProjectSealedAsMonument");
  });
});
