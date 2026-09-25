import { describe, expect, it } from "vitest";
import {
  DomainStateValidationError,
  createInitialState,
  execute,
  parseDomainState,
  type Clock,
  type DomainCommand,
  type DomainState,
} from "../src/index.js";

class ClockStub implements Clock {
  constructor(private instant = new Date("2026-07-20T09:00:00.000Z")) {}
  now(): Date { return new Date(this.instant); }
  advance(ms: number): void { this.instant = new Date(this.instant.getTime() + ms); }
}

function validState(): DomainState {
  const clock = new ClockStub();
  let state = createInitialState("Asia/Shanghai", [0, 6]);
  const run = (command: DomainCommand) => {
    const result = execute(state, command, clock);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    state = result.state;
  };
  run({ type: "CreateProject", projectId: "p1", title: "Project", blueprintId: "cottage", subtasks: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "retire-me", title: "Unused" }] });
  run({ type: "RemoveSubtask", subtaskId: "retire-me" });
  run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 100, gracePlannedDays: 2 });
  run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 2 });
  run({ type: "StartFocus", sessionId: "done", subtaskId: "a", plannedDurationMs: 1_000 });
  clock.advance(1_000);
  run({ type: "CompleteFocus" });
  run({ type: "ReportSubtaskProgress", reportId: "report", subtaskId: "a", focusSessionIds: ["done"], progressBasisPoints: 5_000 });
  run({ type: "StartFocus", sessionId: "active", subtaskId: "b", plannedDurationMs: 60_000 });
  return state;
}

describe("parseDomainState", () => {
  it("round-trips a valid v1 state and returns a deep anti-aliasing clone", () => {
    const raw = validState();
    const parsed = parseDomainState(raw);
    expect(parsed).toEqual(raw);
    expect(parsed).not.toBe(raw);
    expect(parsed.projects).not.toBe(raw.projects);
    expect(parsed.projects[0]).not.toBe(raw.projects[0]);
    raw.projects[0]!.title = "Mutated source";
    expect(parsed.projects[0]!.title).toBe("Project");
  });

  it("keeps schema v12 while accepting one active and multiple paused projects", () => {
    const clock = new ClockStub();
    const first = execute(createInitialState(), { type: "CreateProject", projectId: "p1", title: "First", blueprintId: "cottage", subtasks: [{ id: "a", title: "A" }] }, clock);
    if (!first.ok) throw new Error(first.message);
    const second = execute(first.state, { type: "CreateProject", projectId: "p2", title: "Second", blueprintId: "tower", subtasks: [{ id: "b", title: "B" }] }, clock);
    if (!second.ok) throw new Error(second.message);

    expect(second.state.schemaVersion).toBe(12);
    expect(second.state.projects.map((project) => project.status)).toEqual(["paused", "active"]);
    expect(parseDomainState(second.state)).toEqual(second.state);
  });

  it("migrates old v1 focus and project records to schema v12 defaults", () => {
    const raw = asLegacyV1(validState());
    delete raw.projects[0].importedBlueprint;
    const parsed = parseDomainState(raw);
    expect(parsed.schemaVersion).toBe(12);
    expect(parsed.worldSettings).toEqual({ worldSeed: "legacy-p1", terrainGenerationVersion: 4, environmentStyle: "natural-valley" });
    expect(parsed.projects[0]).toMatchObject({ kind: "finite", habit: null });
    expect(parsed.habitBuildings).toEqual([]);
    expect(parsed.projects[0]!.importedBlueprint).toBeNull();
    expect(parsed.focusIntegrityPolicy).toEqual({ enabled: true, maxEffectiveExcursions: 3, excursionThresholdSeconds: 3 });
    expect(parsed.decorationBlueprintResources).toEqual([]);
    expect(parsed.decorationRewards).toEqual([]);
    expect(parsed.buildingBlueprintResources).toEqual([]);
    expect(parsed.activeFocusSession?.integrity).toEqual({
      effectiveExcursions: 0, backgroundedAt: null, backgroundReason: null, exemptionPending: false,
    });
    expect(parsed.focusHistory[0]).not.toHaveProperty("integrity");
  });

  it("migrates a v1 interrupted focus to the user-cancelled reason", () => {
    const clock = new ClockStub();
    clock.advance(2_000);
    const cancelled = execute(validState(), { type: "CancelFocus" }, clock);
    if (!cancelled.ok) throw new Error(cancelled.message);
    const parsed = parseDomainState(asLegacyV1(cancelled.state));
    expect(parsed.focusHistory.at(-1)).toMatchObject({ status: "interrupted", interruptionReason: "user-cancelled" });
  });

  it("migrates a v5 backup without changing project facts", () => {
    const raw: any = structuredClone(validState());
    raw.schemaVersion = 5;
    delete raw.focusIntegrityPolicy.excursionThresholdSeconds;
    delete raw.worldSettings;
    const parsed = parseDomainState(raw);
    expect(parsed.schemaVersion).toBe(12);
    expect(parsed.projects).toEqual(raw.projects);
    expect(parsed.worldSettings).toEqual({ worldSeed: "legacy-p1", terrainGenerationVersion: 4, environmentStyle: "natural-valley" });
  });

  it("migrates v6 terrain and building resource names to schema v12", () => {
    const raw: any = structuredClone(validState());
    raw.schemaVersion = 6;
    delete raw.focusIntegrityPolicy.excursionThresholdSeconds;
    raw.worldSettings.terrainGenerationVersion = 2;
    raw.buildingBlueprintResources = [{
      id: "legacy-library-house",
      blueprint: {
        schemaVersion: 1, id: "legacy-library-house", title: "Legacy library house",
        bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
        voxels: [{ x: 0, y: 0, z: 0, materialId: "stone", stage: "foundation", buildOrder: 0 }],
      },
      importedAt: "2026-07-20T09:00:00.000Z",
    }];
    const parsed = parseDomainState(raw);
    expect(parsed.schemaVersion).toBe(12);
    expect(parsed.worldSettings.terrainGenerationVersion).toBe(4);
    expect(parsed.buildingBlueprintResources[0]).toMatchObject({ displayName: "Legacy library house" });
  });

  it("migrates schema v9 without inventing withdrawn feature state", () => {
    const raw: any = structuredClone(validState());
    raw.schemaVersion = 9;
    delete raw.focusIntegrityPolicy.excursionThresholdSeconds;
    const parsed = parseDomainState(raw);
    expect(parsed.schemaVersion).toBe(12);
    expect(parsed).not.toHaveProperty("todayNextSteps");
  });

  it("drops the withdrawn schema-v10 today-next-steps field without weakening unknown-field validation", () => {
    const raw: any = structuredClone(validState());
    raw.schemaVersion = 10;
    delete raw.focusIntegrityPolicy.excursionThresholdSeconds;
    raw.todayNextSteps = {
      date: "2026-07-20",
      entries: [{ id: "today-a", projectId: "p1", subtaskId: "missing", estimatedRounds: 2, createdAt: "2026-07-20T09:00:00.000Z" }],
    };
    const parsed = parseDomainState(raw);
    expect(parsed).not.toHaveProperty("todayNextSteps");
    expect(parsed.projects).toEqual(raw.projects);
    raw.unrecognizedV26Field = true;
    expect(() => parseDomainState(raw)).toThrow(DomainStateValidationError);
  });

  it("migrates a schema-v7 terrain-v3 world to v4 without changing user facts", () => {
    const raw: any = structuredClone(validState());
    raw.schemaVersion = 7;
    delete raw.focusIntegrityPolicy.excursionThresholdSeconds;
    raw.worldSettings.terrainGenerationVersion = 3;
    const parsed = parseDomainState(raw);
    expect(parsed.worldSettings).toEqual({ ...raw.worldSettings, terrainGenerationVersion: 4 });
    expect(parsed.projects).toEqual(raw.projects);
    expect(parsed.focusHistory).toEqual(raw.focusHistory);
    expect(parsed.dailyGoals).toEqual(raw.dailyGoals);
  });

  it("repairs a v6 goal that becomes reached when early completions start counting", () => {
    const clock = new ClockStub();
    let state = createInitialState();
    const run = (command: DomainCommand) => {
      const result = execute(state, command, clock);
      if (!result.ok) throw new Error(result.message);
      state = result.state;
    };
    run({ type: "CreateProject", projectId: "early-project", title: "Early", blueprintId: "cottage", subtasks: [{ id: "task", title: "Task" }] });
    run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 1 });
    run({ type: "StartFocus", sessionId: "early", subtaskId: "task", plannedDurationMs: 60_000 });
    clock.advance(10_000);
    run({ type: "CompleteFocusEarly", reportId: "early-report" });
    const raw: any = structuredClone(state);
    raw.schemaVersion = 6;
    delete raw.focusIntegrityPolicy.excursionThresholdSeconds;
    raw.worldSettings.terrainGenerationVersion = 2;
    raw.dailyGoals[0].reachedAt = null;

    const parsed = parseDomainState(raw);
    const completion = parsed.focusHistory[0]!;
    if (completion.status === "interrupted") throw new Error("expected an early completion");
    expect(parsed.dailyGoals[0]?.reachedAt).toBe(completion.completedAt);
  });

  it("rejects oversized imported blueprint voxel arrays before accepting storage", () => {
    const raw: any = structuredClone(validState());
    raw.projects[0].blueprintId = "oversized";
    raw.projects[0].importedBlueprint = {
      schemaVersion: 1, id: "oversized", title: "Oversized",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: Array.from({ length: 300_001 }, () => ({
        x: 0, y: 0, z: 0, materialId: "stone", stage: "foundation", buildOrder: 0,
      })),
    };
    expect(() => parseDomainState(raw)).toThrow(DomainStateValidationError);
  });

  it("accepts a dense 60 cubed blueprint and preserves it through JSON backup recovery", () => {
    const raw: any = structuredClone(validState());
    raw.projects[0].blueprintId = "dense-60";
    raw.projects[0].importedBlueprint = {
      schemaVersion: 1, id: "dense-60", title: "Dense 60",
      bounds: { minX: 0, maxX: 59, minY: 0, maxY: 59, minZ: 0, maxZ: 59 },
      voxels: Array.from({ length: 60 * 60 * 60 }, (_, index) => ({
        x: index % 60,
        y: Math.floor(index / (60 * 60)),
        z: Math.floor(index / 60) % 60,
        materialId: "stone",
        stage: "foundation",
        buildOrder: Math.min(10_000, index),
      })),
    };
    const recovered = parseDomainState(JSON.parse(JSON.stringify(raw)));
    expect(recovered.projects[0]!.importedBlueprint).toMatchObject({
      id: "dense-60",
      bounds: { minX: 0, maxX: 59, minY: 0, maxY: 59, minZ: 0, maxZ: 59 },
    });
    expect(recovered.projects[0]!.importedBlueprint!.voxels).toHaveLength(216_000);
  });

  it("keeps the old 128-block height compatible while accepting parser-sized bounds", () => {
    const raw: any = structuredClone(validState());
    raw.projects[0].blueprintId = "tall-legacy";
    raw.projects[0].importedBlueprint = {
      schemaVersion: 1, id: "tall-legacy", title: "Tall legacy",
      bounds: { minX: 0, maxX: 95, minY: 0, maxY: 127, minZ: 0, maxZ: 95 },
      voxels: [
        { x: 0, y: 0, z: 0, materialId: "stone", stage: "foundation", buildOrder: 0 },
        { x: 95, y: 127, z: 95, materialId: "roof", stage: "roof", buildOrder: 10_000 },
      ],
    };
    expect(parseDomainState(JSON.parse(JSON.stringify(raw))).projects[0]!.importedBlueprint!.bounds).toEqual(raw.projects[0].importedBlueprint.bounds);
  });

  it("normalizes imported source block state and rejects malformed state records", () => {
    const raw: any = structuredClone(validState());
    raw.projects[0].blueprintId = "stateful";
    raw.projects[0].importedBlueprint = {
      schemaVersion: 1, id: "stateful", title: "Stateful",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: "roof", stage: "roof", buildOrder: 10_000,
        sourceBlockId: "minecraft:oak_stairs", sourceBlockState: { waterlogged: "false", facing: "west", half: "top" } }],
    };
    const parsed = parseDomainState(raw);
    expect(parsed.projects[0]!.importedBlueprint!.voxels[0]!.sourceBlockState).toEqual({ facing: "west", half: "top", waterlogged: "false" });
    expect(Object.keys(parsed.projects[0]!.importedBlueprint!.voxels[0]!.sourceBlockState!)).toEqual(["facing", "half", "waterlogged"]);

    for (const sourceBlockState of [[], { facing: 1 }, { facing: "" }, { Uppercase: "west" }]) {
      const invalid = structuredClone(raw);
      invalid.projects[0].importedBlueprint.voxels[0].sourceBlockState = sourceBlockState;
      expect(() => parseDomainState(invalid)).toThrow(DomainStateValidationError);
    }
  });

  it("normalizes only bounded moved vanilla block data on moving pistons", () => {
    const raw: any = structuredClone(validState());
    raw.projects[0].blueprintId = "moving-piston";
    raw.projects[0].importedBlueprint = {
      schemaVersion: 1, id: "moving-piston", title: "Moving piston",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: "stone", stage: "foundation", buildOrder: 0,
        sourceBlockId: "minecraft:moving_piston",
        movingPistonMovedState: { blockId: "minecraft:oak_log", properties: { axis: "x" } },
        movingPistonPose: { facing: "west", progress: 0.375, extending: true, source: false } }],
    };
    const parsed = parseDomainState(raw);
    expect(parsed.projects[0]!.importedBlueprint!.voxels[0]!.movingPistonMovedState).toEqual({
      blockId: "minecraft:oak_log", properties: { axis: "x" },
    });
    expect(parsed.projects[0]!.importedBlueprint!.voxels[0]!.movingPistonPose).toEqual({
      facing: "west", progress: 0.375, extending: true, source: false,
    });

    const invalidPayloads = [
      { blockId: "example:oak_log" },
      { blockId: "minecraft:oak_log", properties: { axis: "x value" } },
      { blockId: "minecraft:oak_log", properties: { axis: "x" }, nbt: { Command: "discard" } },
    ];
    for (const movingPistonMovedState of invalidPayloads) {
      const invalid = structuredClone(raw);
      invalid.projects[0].importedBlueprint.voxels[0].movingPistonMovedState = movingPistonMovedState;
      expect(() => parseDomainState(invalid)).toThrow(DomainStateValidationError);
    }
    const invalidPoses = [
      { facing: "northwest", progress: 0.5, extending: true, source: false },
      { facing: "north", progress: Number.NaN, extending: true, source: false },
      { facing: "north", progress: 1.01, extending: true, source: false },
      { facing: "north", progress: 0.5, extending: 1, source: false },
      { facing: "north", progress: 0.5, extending: true, source: false, extra: "not retained" },
    ];
    for (const movingPistonPose of invalidPoses) {
      const invalid = structuredClone(raw);
      invalid.projects[0].importedBlueprint.voxels[0].movingPistonPose = movingPistonPose;
      expect(() => parseDomainState(invalid)).toThrow(DomainStateValidationError);
    }
    const unrelatedBlock = structuredClone(raw);
    unrelatedBlock.projects[0].importedBlueprint.voxels[0].sourceBlockId = "minecraft:oak_log";
    expect(() => parseDomainState(unrelatedBlock)).toThrow(DomainStateValidationError);
  });

  it("round-trips normalized sign faces and bounded campfire slots without changing the domain version", () => {
    const raw: any = structuredClone(validState());
    raw.projects[0].blueprintId = "sign-campfire";
    raw.projects[0].importedBlueprint = {
      schemaVersion: 1, id: "sign-campfire", title: "Sign and campfire",
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [
        { x: 0, y: 0, z: 0, materialId: "plank", stage: "details", buildOrder: 10_000,
          sourceBlockId: "minecraft:oak_wall_sign",
          sign: {
            front: { lines: ["Front line"], dyeColor: "red", glowing: true },
            back: { lines: ["Back line", "Second"], dyeColor: "light_blue", glowing: false },
          } },
        { x: 1, y: 0, z: 0, materialId: "accent", stage: "details", buildOrder: 10_000,
          sourceBlockId: "minecraft:campfire",
          campfire: { slots: [
            { slot: 3, itemId: "minecraft:stick", count: 2 },
            { slot: 0, itemId: "minecraft:bread", count: 1 },
          ] } },
      ],
    };

    const legacy = structuredClone(raw);
    delete legacy.projects[0].importedBlueprint.voxels[0].sign;
    delete legacy.projects[0].importedBlueprint.voxels[1].campfire;
    const legacyParsed = parseDomainState(legacy);
    expect(legacyParsed.schemaVersion).toBe(12);
    expect(legacyParsed.projects[0]!.importedBlueprint!.voxels[0]).not.toHaveProperty("sign");
    expect(legacyParsed.projects[0]!.importedBlueprint!.voxels[1]).not.toHaveProperty("campfire");

    const parsed = parseDomainState(raw);
    expect(parsed.schemaVersion).toBe(12);
    expect(parsed.projects[0]!.importedBlueprint!.voxels[0]!.sign).toEqual({
      front: { lines: ["Front line"], dyeColor: "red", glowing: true },
      back: { lines: ["Back line", "Second"], dyeColor: "light_blue", glowing: false },
    });
    expect(parsed.projects[0]!.importedBlueprint!.voxels[1]!.campfire).toEqual({ slots: [
      { slot: 0, itemId: "minecraft:bread", count: 1 },
      { slot: 3, itemId: "minecraft:stick", count: 2 },
    ] });
    expect(parseDomainState(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("rejects malformed sign display data and campfire slot payloads", () => {
    const raw: any = structuredClone(validState());
    raw.projects[0].blueprintId = "sign-campfire-invalid";
    raw.projects[0].importedBlueprint = {
      schemaVersion: 1, id: "sign-campfire-invalid", title: "Sign and campfire",
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [
        { x: 0, y: 0, z: 0, materialId: "plank", stage: "details", buildOrder: 0,
          sourceBlockId: "minecraft:oak_sign",
          sign: { front: { lines: [], dyeColor: "black", glowing: false }, back: { lines: [], dyeColor: "black", glowing: false } } },
        { x: 1, y: 0, z: 0, materialId: "accent", stage: "details", buildOrder: 10_000,
          sourceBlockId: "minecraft:soul_campfire", campfire: { slots: [] } },
      ],
    };
    const reject = (mutate: (voxels: any[]) => void) => {
      const invalid = structuredClone(raw);
      mutate(invalid.projects[0].importedBlueprint.voxels);
      expect(() => parseDomainState(invalid)).toThrow(DomainStateValidationError);
    };
    reject((voxels) => { voxels[0].sign.front.lines = ["1", "2", "3", "4", "5"]; });
    reject((voxels) => { voxels[0].sign.front.dyeColor = "teal"; });
    reject((voxels) => { voxels[0].sign.back.lines = ["line\nwith break"]; });
    reject((voxels) => { voxels[0].sign.front.clickEvent = { action: "run_command" }; });
    reject((voxels) => { voxels[0].sourceBlockId = "minecraft:oak_log"; });
    reject((voxels) => { voxels[1].campfire.slots = [{ slot: 0, itemId: "minecraft:stick", count: 65 }]; });
    reject((voxels) => { voxels[1].campfire.slots = [{ slot: 0, itemId: "minecraft:stick", count: 1, components: {} }]; });
    reject((voxels) => { voxels[1].campfire.slots = [
      { slot: 0, itemId: "minecraft:stick", count: 1 }, { slot: 0, itemId: "minecraft:bread", count: 1 },
    ]; });
    reject((voxels) => { voxels[1].campfire.slots = [{ slot: 4, itemId: "minecraft:stick", count: 1 }]; });
  });

  const cases: Array<[string, (state: any) => void]> = [
    ["unknown root field", (s) => { s.derivedProgress = 50; }],
    ["unknown nested field", (s) => { s.projects[0].subtasks[0].percent = 50; }],
    ["schema version", (s) => { s.schemaVersion = 99; }],
    ["NaN basis points", (s) => { s.projects[0].subtasks[0].progressBasisPoints = Number.NaN; }],
    ["infinite condition", (s) => { s.projectConditions[0].conditionBasisPoints = Number.POSITIVE_INFINITY; }],
    ["duplicate project ID", (s) => { s.projects.push(structuredClone(s.projects[0])); }],
    ["wrong active project", (s) => { s.activeProjectId = "missing"; }],
    ["missing project condition", (s) => { s.projectConditions = []; }],
    ["duplicate condition", (s) => { s.projectConditions.push(structuredClone(s.projectConditions[0])); }],
    ["current ID in tombstones", (s) => { s.retiredSubtaskIds.push("a"); }],
    ["non-contiguous subtask order", (s) => { s.projects[0].subtasks[1].order = 4; }],
    ["active focus wrong project", (s) => { s.activeFocusSession.projectId = "missing"; }],
    ["active focus wrong duration", (s) => { s.activeFocusSession.endsAt = "2026-07-20T09:01:02.000Z"; }],
    ["active focus before project creation", (s) => { s.activeFocusSession.startedAt = "2026-07-20T08:59:00.000Z"; s.activeFocusSession.endsAt = "2026-07-20T09:00:00.000Z"; }],
    ["duplicate session ID", (s) => { s.activeFocusSession.id = "done"; }],
    ["overlapping history interval", (s) => { const copy = structuredClone(s.focusHistory[0]); copy.id = "overlap"; s.focusHistory.push(copy); }],
    ["active interval overlaps history", (s) => { s.activeFocusSession.startedAt = "2026-07-20T09:00:00.500Z"; s.activeFocusSession.endsAt = "2026-07-20T09:01:00.500Z"; }],
    ["completedAt differs from endsAt", (s) => { s.focusHistory[0].completedAt = "2026-07-20T09:00:02.000Z"; }],
    ["history before project creation", (s) => { s.focusHistory[0].startedAt = "2026-07-20T08:59:59.000Z"; s.focusHistory[0].endsAt = "2026-07-20T09:00:00.000Z"; s.focusHistory[0].completedAt = "2026-07-20T09:00:00.000Z"; }],
    ["wrong completion local date", (s) => { s.focusHistory[0].completedLocalDate = "2026-07-21"; }],
    ["report ownership", (s) => { s.progressReports[0].subtaskId = "b"; }],
    ["report before completion", (s) => { s.progressReports[0].reportedAt = "2026-07-20T09:00:00.000Z"; }],
    ["report session reuse", (s) => { const copy = structuredClone(s.progressReports[0]); copy.id = "second"; s.progressReports.push(copy); }],
    ["stored progress differs from report", (s) => { s.projects[0].subtasks[0].progressBasisPoints = 4_999; }],
    ["unlocked positive progress", (s) => { s.projects[0].subtaskStructureLocked = false; }],
    ["locked without positive progress", (s) => { s.projects[0].subtasks[0].progressBasisPoints = 0; s.progressReports[0].progressBasisPoints = 0; s.projects[0].subtaskStructureLocked = true; }],
    ["invalid daily date", (s) => { s.dailyGoals[0].date = "2026-02-30"; }],
    ["duplicate daily date", (s) => { s.dailyGoals.push(structuredClone(s.dailyGoals[0])); }],
    ["enabled reached threshold without reachedAt", (s) => { s.dailyGoals[0].targetPomodoros = 1; }],
    ["reached goal without date completion", (s) => { s.dailyGoals[0].date = "2026-07-21"; s.dailyGoals[0].reachedAt = "2026-07-21T09:00:00.000Z"; }],
    ["reached goal before first completion", (s) => { s.dailyGoals[0].reachedAt = "2026-07-20T09:00:00.000Z"; }],
    ["invalid timezone", (s) => { s.calendar.timeZone = "Mars/Olympus"; }],
    ["duplicate rest weekday", (s) => { s.calendar.restWeekdays = [0, 0]; }],
    ["unsorted rest weekdays", (s) => { s.calendar.restWeekdays = [6, 0]; }],
    ["enabled decay without damage", (s) => { s.decayPolicy.damagePerMissedPlannedDayBasisPoints = null; }],
    ["wrong repair multiplier", (s) => { s.decayPolicy.repairMultiplierBasisPoints = 10_000; }],
    ["invalid focus integrity limit", (s) => { s.focusIntegrityPolicy.maxEffectiveExcursions = 6; }],
    ["mismatched background lifecycle pair", (s) => { s.activeFocusSession.integrity.backgroundReason = "app-switch"; }],
    ["too many persisted excursions", (s) => { s.activeFocusSession.integrity.effectiveExcursions = 6; }],
    ["unknown focus integrity field", (s) => { s.activeFocusSession.integrity.future = true; }],
    ["enabled active project without anchor", (s) => { s.projectConditions[0].inactivityAnchorAt = null; }],
    ["condition anchor before project", (s) => { s.projectConditions[0].inactivityAnchorAt = "2026-07-20T08:59:59.000Z"; }],
    ["assessed days without anchor", (s) => { s.decayPolicy.enabled = false; s.decayPolicy.damagePerMissedPlannedDayBasisPoints = null; s.projectConditions[0].inactivityAnchorAt = null; s.projectConditions[0].assessedMissedPlannedDays = 1; }],
    ["disabled policy with runtime anchor", (s) => { s.decayPolicy.enabled = false; s.decayPolicy.damagePerMissedPlannedDayBasisPoints = null; }],
    ["monument with incomplete progress", (s) => { s.projects[0].status = "monument"; s.activeProjectId = null; s.activeFocusSession = null; }],
    ["deleted project with decay runtime", (s) => { s.projects[0].status = "deleted"; s.activeProjectId = null; s.activeFocusSession = null; }],
  ];

  it.each(cases)("rejects tampering: %s", (_name, mutate) => {
    const raw: any = structuredClone(validState());
    mutate(raw);
    expect(() => parseDomainState(raw)).toThrow(DomainStateValidationError);
  });

  it("exposes a stable validation error code and path", () => {
    const raw: any = structuredClone(validState());
    raw.projects[0].subtasks[0].progressBasisPoints = 10_001;
    try {
      parseDomainState(raw);
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainStateValidationError);
      expect(error).toMatchObject({ code: "INVALID_DOMAIN_STATE", path: "$.projects[0].subtasks[0].progressBasisPoints" });
    }
  });

  it("accepts a reached fact after its target was later raised", () => {
    const raw: any = structuredClone(validState());
    raw.dailyGoals[0].targetPomodoros = 10;
    raw.dailyGoals[0].reachedAt = raw.focusHistory[0].completedAt;
    expect(parseDomainState(raw)).toEqual(raw);
  });

  it("round-trips a soft-deleted project with retained history and reset decay runtime", () => {
    const clock = new ClockStub();
    let state = validState();
    clock.advance(2_000);
    const cancelled = execute(state, { type: "CancelFocus" }, clock);
    if (!cancelled.ok) throw new Error(cancelled.message);
    state = cancelled.state;
    const deleted = execute(state, { type: "DeleteActiveProject", projectId: "p1" }, clock);
    if (!deleted.ok) throw new Error(deleted.message);
    state = deleted.state;

    expect(state).toMatchObject({
      activeProjectId: null,
      projects: [{ id: "p1", status: "deleted" }],
      projectConditions: [{ projectId: "p1", inactivityAnchorAt: null, assessedMissedPlannedDays: 0 }],
    });
    expect(state.focusHistory).toHaveLength(2);
    expect(state.progressReports).toHaveLength(1);
    expect(parseDomainState(state)).toEqual(state);
  });

  it("round-trips cancel followed by an immediate restart at the interruption instant", () => {
    const clock = new ClockStub();
    let state = createInitialState();
    const run = (command: DomainCommand) => {
      const result = execute(state, command, clock);
      if (!result.ok) throw new Error(result.message);
      state = result.state;
    };
    run({ type: "CreateProject", projectId: "restart-project", title: "Restart", blueprintId: "cottage", subtasks: [{ id: "restart-task", title: "Task" }] });
    run({ type: "StartFocus", sessionId: "cancelled", subtaskId: "restart-task", plannedDurationMs: 60_000 });
    run({ type: "CancelFocus" });
    run({ type: "StartFocus", sessionId: "restarted", subtaskId: "restart-task", plannedDurationMs: 60_000 });
    expect(state.focusHistory[0]).toMatchObject({ status: "interrupted", interruptedAt: state.activeFocusSession!.startedAt });
    expect(parseDomainState(state)).toEqual(state);
  });
});

function asLegacyV1(state: DomainState): any {
  const raw: any = structuredClone(state);
  raw.schemaVersion = 1;
  delete raw.focusIntegrityPolicy;
  delete raw.decorationBlueprintResources;
  delete raw.decorationRewards;
  delete raw.buildingBlueprintResources;
  delete raw.habitBuildings;
  delete raw.worldSettings;
  for (const project of raw.projects) {
    delete project.kind;
    delete project.habit;
    delete project.settlementIndex;
  }
  if (raw.activeFocusSession) delete raw.activeFocusSession.integrity;
  for (const session of raw.focusHistory) {
    delete session.actualDurationMs;
    if (session.status === "interrupted") delete session.interruptionReason;
    if (session.status === "interrupted") delete session.interruptionCategory;
  }
  return raw;
}
