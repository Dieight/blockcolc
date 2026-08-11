import "fake-indexeddb/auto";
import {
  createInitialState,
  execute,
  type Clock,
  type DomainCommand,
  type DomainState,
} from "@tomato-clock/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BackupValidationError,
  IndexedDbStateRepository,
  sha256,
} from "../src/index.js";
import { projectState } from "./fixture.js";

class TestClock implements Clock {
  constructor(private value = new Date("2026-07-20T09:00:00.000Z")) {}
  now(): Date { return new Date(this.value); }
  set(value: string): void { this.value = new Date(value); }
  advance(ms: number): void { this.value = new Date(this.value.getTime() + ms); }
}

let sequence = 0;
let rollbackSequence = 0;

beforeEach(() => {
  sequence += 1;
  rollbackSequence = 0;
});

describe("backup safety", () => {
  it("round-trips active focus integrity runtime in the v2 payload", async () => {
    const source = createRepository("focus-integrity-source");
    const clock = new TestClock(new Date("2026-07-23T08:00:00.000Z"));
    let state = projectState("Focus integrity");
    const run = (command: DomainCommand) => {
      const result = execute(state, command, clock);
      if (!result.ok) throw new Error(result.message);
      state = result.state;
    };
    run({ type: "StartFocus", sessionId: "focus-integrity", subtaskId: "subtask-1", plannedDurationMs: 60_000 });
    run({ type: "RecordFocusBackgrounded", reason: "app-switch" });
    clock.advance(3_001);
    run({ type: "RecordFocusForegrounded" });
    run({ type: "GrantFocusLifecycleExemption" });
    await source.save(state, 0);

    const destination = createRepository("focus-integrity-destination");
    await destination.replaceFromImport(await source.exportBackup(), 0);
    expect((await destination.load()).state?.activeFocusSession?.integrity).toEqual({
      effectiveExcursions: 1,
      backgroundedAt: null,
      backgroundReason: null,
      exemptionPending: true,
    });
  });

  it("round-trips imported blueprint payloads in backups", async () => {
    const source = createRepository("imported-blueprint-source");
    const state = projectState("Imported blueprint project");
    state.projects[0]!.blueprintId = "imported-blueprint";
    state.projects[0]!.importedBlueprint = sampleImportedBlueprint();
    await source.save(state, 0);

    const destination = createRepository("imported-blueprint-destination");
    await destination.replaceFromImport(await source.exportBackup(), 0);
    expect((await destination.load()).state?.projects[0]!.importedBlueprint).toEqual(sampleImportedBlueprint());
  });

  it("round-trips decoration resources, source light semantics, and earned reward placement", async () => {
    const source = createRepository("decoration-reward-source");
    const clock = new TestClock(new Date("2026-07-23T08:00:00.000Z"));
    let state = projectState("Decoration host");
    const run = (command: DomainCommand) => {
      const result = execute(state, command, clock);
      if (!result.ok) throw new Error(result.message);
      state = result.state;
    };
    const blueprint = sampleImportedBlueprint();
    run({ type: "ImportDecorationBlueprint", blueprint });
    run({ type: "SetDailyGoal", date: "2026-07-23", targetPomodoros: 1 });
    run({ type: "StartFocus", sessionId: "reward-focus", subtaskId: "subtask-1", plannedDurationMs: 1 });
    clock.advance(1);
    run({ type: "CompleteFocus" });
    await source.save(state, 0);

    const destination = createRepository("decoration-reward-destination");
    await destination.replaceFromImport(await source.exportBackup(), 0);
    const restored = (await destination.load()).state!;
    expect(restored.decorationBlueprintResources).toEqual(state.decorationBlueprintResources);
    expect(restored.decorationRewards).toEqual(state.decorationRewards);
    expect(restored.decorationBlueprintResources[0]!.blueprint.voxels[0]).toMatchObject({
      sourceBlockId: "minecraft:lantern", emissiveKind: "lantern", emissiveLevel: 15,
    });
  });

  it("accepts old checksummed v1 backups without importedBlueprint and normalizes future exports", async () => {
    const source = createRepository("old-v1-source");
    await source.save(projectState("Old v1"), 0);
    const oldEnvelope = JSON.parse(await source.exportBackup()) as any;
    oldEnvelope.payload.schemaVersion = 1;
    delete oldEnvelope.payload.focusIntegrityPolicy;
    delete oldEnvelope.payload.decorationBlueprintResources;
    delete oldEnvelope.payload.decorationRewards;
    delete oldEnvelope.payload.buildingBlueprintResources;
    delete oldEnvelope.payload.habitBuildings;
    delete oldEnvelope.payload.worldSettings;
    delete oldEnvelope.payload.projects[0].kind;
    delete oldEnvelope.payload.projects[0].habit;
    delete oldEnvelope.payload.projects[0].settlementIndex;
    delete oldEnvelope.payload.projects[0].importedBlueprint;
    const { checksum: _checksum, ...oldUnsigned } = oldEnvelope;
    oldEnvelope.checksum = await sha256(oldUnsigned);

    const destination = createRepository("old-v1-destination");
    await expect(destination.previewImport(JSON.stringify(oldEnvelope))).resolves.toMatchObject({ schemaVersion: 1 });
    await destination.replaceFromImport(JSON.stringify(oldEnvelope), 0);
    expect((await destination.load()).state?.schemaVersion).toBe(7);
    expect((await destination.load()).state?.focusIntegrityPolicy).toEqual({ enabled: true, maxEffectiveExcursions: 3 });
    expect((await destination.load()).state?.projects[0]!.importedBlueprint).toBeNull();
    const normalized = JSON.parse(await destination.exportBackup()) as any;
    expect(normalized.schemaVersion).toBe(1);
    expect(normalized.payload.schemaVersion).toBe(7);
    expect(normalized.payload.worldSettings).toEqual({ worldSeed: "legacy-project-1", terrainGenerationVersion: 3, environmentStyle: "natural-valley" });
    expect(normalized.payload.projects[0]).toHaveProperty("importedBlueprint", null);
  });

  it("rejects a checksummed backup containing malformed imported blueprint geometry", async () => {
    const source = createRepository("invalid-imported-blueprint");
    const state = projectState();
    state.projects[0]!.blueprintId = "imported-blueprint";
    state.projects[0]!.importedBlueprint = sampleImportedBlueprint();
    await source.save(state, 0);
    const envelope = JSON.parse(await source.exportBackup()) as any;
    envelope.payload.projects[0].importedBlueprint.voxels[1].x = 0;
    const { checksum: _checksum, ...unsigned } = envelope;
    envelope.checksum = await sha256(unsigned);
    await expect(source.previewImport(JSON.stringify(envelope))).rejects.toThrow("Invalid domain state");
  });

  it("rejects a correctly checksummed backup containing malformed source block state", async () => {
    const source = createRepository("invalid-source-block-state");
    const state = projectState();
    state.projects[0]!.blueprintId = "imported-blueprint";
    state.projects[0]!.importedBlueprint = sampleImportedBlueprint();
    await source.save(state, 0);
    const envelope = JSON.parse(await source.exportBackup()) as any;
    envelope.payload.projects[0].importedBlueprint.voxels[0].sourceBlockState = { facing: 1 };
    const { checksum: _checksum, ...unsigned } = envelope;
    envelope.checksum = await sha256(unsigned);
    await expect(source.previewImport(JSON.stringify(envelope))).rejects.toThrow("Invalid domain state");
  });

  it("round-trips paused projects through the unchanged v1 backup envelope", async () => {
    const source = createRepository("paused-source");
    const clock = new TestClock();
    let state = createInitialState();
    const first = execute(state, {
      type: "CreateProject", projectId: "first", title: "First", blueprintId: "workshop-small",
      subtasks: [{ id: "first-step", title: "First step" }],
    }, clock);
    if (!first.ok) throw new Error(first.message);
    const second = execute(first.state, {
      type: "CreateProject", projectId: "second", title: "Second", blueprintId: "tower-small",
      subtasks: [{ id: "second-step", title: "Second step" }],
    }, clock);
    if (!second.ok) throw new Error(second.message);
    state = second.state;
    await source.save(state, 0);

    const exported = JSON.parse(await source.exportBackup()) as { schemaVersion: number; payload: DomainState };
    expect(exported.schemaVersion).toBe(1);
    expect(exported.payload.projects.map((project) => project.status)).toEqual(["paused", "active"]);

    const destination = createRepository("paused-destination");
    const replaced = await destination.replaceFromImport(JSON.stringify(exported), 0);
    expect(replaced).toMatchObject({ revision: 1 });
    expect((await destination.load()).state).toEqual(state);
  });

  it("exports every trusted aggregate fact with a verifiable checksum", async () => {
    const repository = createRepository("rich-export");
    const state = richState();
    await repository.save(state, 0);

    const exported = JSON.parse(await repository.exportBackup()) as Record<string, unknown>;
    expect(Object.keys(exported).sort()).toEqual(["checksum", "exportedAt", "format", "payload", "schemaVersion"]);
    expect(exported).toMatchObject({
      format: "tomato-clock-backup",
      schemaVersion: 1,
      exportedAt: "2026-07-23T10:00:00.000Z",
      payload: state,
    });
    const { checksum, ...unsigned } = exported;
    expect(checksum).toBe(await sha256(unsigned));

    const preview = await repository.previewImport(JSON.stringify(exported));
    expect(preview.summary).toEqual({
      isEmpty: false,
      projectCount: 2,
      subtaskCount: 3,
      activeProjectId: "project-2",
      activeProjectTitle: "Current project",
      activeBlueprintId: "tower-small",
      blueprintIds: ["tower-small", "workshop-small"],
      monumentCount: 1,
      completedFocusCount: 2,
      interruptedFocusCount: 1,
      progressReportCount: 2,
    });
    expect((exported.payload as DomainState).activeFocusSession).toMatchObject({ id: "focus-active", projectId: "project-2" });
    expect((exported.payload as DomainState).retiredSubtaskIds).toEqual(["subtask-retired"]);
  });

  it("rejects an invalid checksum before replacement without changing state, revision, or rollbacks", async () => {
    const repository = createRepository("invalid-checksum");
    await repository.save(projectState("Current"), 0);
    const damaged = JSON.parse(await repository.exportBackup()) as Record<string, unknown>;
    damaged.checksum = "0".repeat(64);
    const before = await repository.load();

    await expect(repository.replaceFromImport(JSON.stringify(damaged), before.revision)).rejects.toBeInstanceOf(BackupValidationError);
    expect(await repository.load()).toEqual(before);
    expect(await repository.listRollbackBackups()).toEqual([]);
  });

  it("rejects blank and unknown rollback IDs without changing persisted data", async () => {
    const repository = createRepository("unknown-rollback");
    await repository.save(projectState("Current"), 0);
    const before = await repository.load();

    await expect(repository.restoreRollback("   ", before.revision)).rejects.toThrow("Rollback backup ID is required");
    await expect(repository.restoreRollback("rollback-missing", before.revision)).rejects.toThrow("was not found");
    expect(await repository.load()).toEqual(before);
    expect(await repository.listRollbackBackups()).toEqual([]);
  });

  it("aborts replacement when the rollback write conflicts and preserves both stores", async () => {
    const repository = new IndexedDbStateRepository({
      databaseName: databaseName("rollback-conflict"),
      now: () => new Date("2026-07-23T10:00:00.000Z"),
      newId: () => "rollback-fixed",
    });
    await repository.save(projectState("Original"), 0);
    const firstSource = createRepository("first-source");
    await firstSource.save(projectState("First import"), 0);
    const firstImport = await repository.replaceFromImport(await firstSource.exportBackup(), 1);
    expect(firstImport).toMatchObject({ rollbackBackupId: "rollback-fixed", revision: 2 });

    await repository.save(projectState("Current before conflict"), 2);
    const before = await repository.load();
    const rollbacksBefore = await repository.listRollbackBackups();
    const secondSource = createRepository("second-source");
    await secondSource.save(projectState("Must not be imported"), 0);

    await expect(repository.replaceFromImport(await secondSource.exportBackup(), before.revision)).rejects.toBeTruthy();
    expect(await repository.load()).toEqual(before);
    expect(await repository.listRollbackBackups()).toEqual(rollbacksBefore);
  });
});

function createRepository(label: string): IndexedDbStateRepository {
  return new IndexedDbStateRepository({
    databaseName: databaseName(label),
    now: () => new Date("2026-07-23T10:00:00.000Z"),
    newId: () => `rollback-${label}-${sequence}-${++rollbackSequence}`,
  });
}

function databaseName(label: string): string {
  return `backup-safety-${label}-${sequence}`;
}

function richState(): DomainState {
  const clock = new TestClock();
  let state = createInitialState("Asia/Shanghai", [0, 6]);
  const run = (command: DomainCommand) => {
    const result = execute(state, command, clock);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    state = result.state;
    return result;
  };
  const complete = (sessionId: string, subtaskId: string) => {
    run({ type: "StartFocus", sessionId, subtaskId, plannedDurationMs: 1_000 });
    clock.advance(1_000);
    run({ type: "CompleteFocus" });
  };

  run({
    type: "CreateProject",
    projectId: "project-1",
    title: "Monument project",
    blueprintId: "workshop-small",
    subtasks: [
      { id: "subtask-1", title: "First" },
      { id: "subtask-2", title: "Second" },
    ],
  });
  run({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 1 });
  complete("focus-1", "subtask-1");
  run({ type: "ReportSubtaskProgress", reportId: "report-1", subtaskId: "subtask-1", focusSessionIds: ["focus-1"], progressBasisPoints: 10_000 });
  run({ type: "StartFocus", sessionId: "focus-interrupted", subtaskId: "subtask-2", plannedDurationMs: 1_000 });
  run({ type: "CancelFocus" });
  complete("focus-2", "subtask-2");
  run({ type: "ReportSubtaskProgress", reportId: "report-2", subtaskId: "subtask-2", focusSessionIds: ["focus-2"], progressBasisPoints: 10_000 });

  run({
    type: "CreateProject",
    projectId: "project-2",
    title: "Current project",
    blueprintId: "tower-small",
    subtasks: [{ id: "subtask-3", title: "Current work" }],
  });
  run({ type: "AddSubtask", subtaskId: "subtask-retired", title: "Temporary" });
  run({ type: "RemoveSubtask", subtaskId: "subtask-retired" });
  run({ type: "EnableDecay", damagePerMissedPlannedDayBasisPoints: 500, gracePlannedDays: 0 });
  clock.set("2026-07-21T09:00:03.000Z");
  run({ type: "AssessDecay" });
  run({ type: "StartFocus", sessionId: "focus-active", subtaskId: "subtask-3", plannedDurationMs: 60_000 });
  return state;
}

function sampleImportedBlueprint() {
  return {
    schemaVersion: 1 as const,
    id: "imported-blueprint",
    title: "Imported blueprint",
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    voxels: [
      { x: 0, y: 0, z: 0, materialId: "stone" as const, stage: "foundation" as const, buildOrder: 0,
        sourceBlockId: "minecraft:lantern", sourceBlockState: { hanging: "true" }, emissiveKind: "lantern", emissiveLevel: 15 },
      { x: 1, y: 0, z: 0, materialId: "wood" as const, stage: "frame" as const, buildOrder: 2_000 },
    ],
  };
}
