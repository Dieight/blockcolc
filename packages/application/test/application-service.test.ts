import { describe, expect, it } from "vitest";
import { createInitialState, execute, type Clock, type DomainState } from "@tomato-clock/domain";
import {
  ApplicationPersistenceError,
  ApplicationService,
  type BackupImportPreview,
  type BackupRepository,
  type BreakCompletionNotification,
  type FocusCompletionNotification,
  type IdGenerator,
  type NotificationCapability,
  type NotificationPort,
  type StateRepository,
} from "../src/index.js";

class TestClock implements Clock {
  constructor(private instant = new Date("2026-07-20T09:00:00.000Z")) {}
  now(): Date { return new Date(this.instant); }
  set(iso: string): void { this.instant = new Date(iso); }
}

class MemoryRepository implements StateRepository {
  saves = 0;
  failNextSave = false;
  revision: number;

  constructor(public persisted: DomainState | null = null, private readonly log: string[] = []) {
    this.revision = persisted === null ? 0 : 1;
  }

  async load(): Promise<{ state: DomainState | null; revision: number }> {
    this.log.push("load");
    return { state: this.persisted === null ? null : structuredClone(this.persisted), revision: this.revision };
  }

  async save(state: DomainState, expectedRevision: number): Promise<number> {
    this.log.push("save");
    this.saves += 1;
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("disk full");
    }
    if (expectedRevision !== this.revision) throw new Error("revision conflict");
    this.persisted = structuredClone(state);
    this.revision += 1;
    return this.revision;
  }

  externalReplace(state: DomainState | null): void {
    this.persisted = state === null ? null : structuredClone(state);
    this.revision += 1;
  }
}

class BackupMemoryRepository extends MemoryRepository implements BackupRepository {
  readonly rollbacks: Array<{ id: string; state: DomainState | null; summary: BackupImportPreview["summary"] }> = [];
  private rollbackIndex = 0;

  async exportBackup(): Promise<string> {
    if (this.persisted === null) throw new Error("empty state");
    return JSON.stringify(this.persisted);
  }

  async previewImport(input: string): Promise<BackupImportPreview> {
    const state = JSON.parse(input) as DomainState;
    return { schemaVersion: 1, exportedAt: "2026-07-20T09:00:00.000Z", checksum: "a".repeat(64), summary: summaryOf(state) };
  }

  async replaceFromImport(input: string, expectedRevision: number): Promise<{ rollbackBackupId: string; revision: number }> {
    if (expectedRevision !== this.revision) throw new Error("revision conflict");
    const id = this.addRollback(this.persisted);
    this.persisted = JSON.parse(input) as DomainState;
    this.revision += 1;
    return { rollbackBackupId: id, revision: this.revision };
  }

  async saveWithRollback(state: DomainState, expectedRevision: number): Promise<{ rollbackBackupId: string; revision: number }> {
    if (expectedRevision !== this.revision) throw new Error("revision conflict");
    const id = this.addRollback(this.persisted);
    this.persisted = structuredClone(state);
    this.revision += 1;
    return { rollbackBackupId: id, revision: this.revision };
  }

  async listRollbackBackups() {
    return this.rollbacks.map((backup) => ({
      id: backup.id, createdAt: "2026-07-20T09:00:00.000Z", reason: "before-import" as const,
      sourceChecksum: "a".repeat(64), summary: backup.summary,
    }));
  }

  async restoreRollback(backupId: string, expectedRevision: number): Promise<{ rollbackBackupId: string; revision: number }> {
    if (expectedRevision !== this.revision) throw new Error("revision conflict");
    const target = this.rollbacks.find((backup) => backup.id === backupId);
    if (!target) throw new Error("unknown rollback");
    const id = this.addRollback(this.persisted);
    this.persisted = target.state === null ? null : structuredClone(target.state);
    this.revision += 1;
    return { rollbackBackupId: id, revision: this.revision };
  }

  private addRollback(state: DomainState | null): string {
    const id = `rollback-${++this.rollbackIndex}`;
    this.rollbacks.push({ id, state: state === null ? null : structuredClone(state), summary: summaryOf(state) });
    return id;
  }
}

function summaryOf(state: DomainState | null): BackupImportPreview["summary"] {
  return {
    projectCount: state?.projects.filter((project) => project.status !== "deleted").length ?? 0,
    activeProjectTitle: state?.projects.find((project) => project.id === state.activeProjectId)?.title ?? null,
    monumentCount: state?.projects.filter((project) => project.status === "monument").length ?? 0,
    completedFocusCount: state?.focusHistory.filter((session) => session.status === "completed").length ?? 0,
    interruptedFocusCount: state?.focusHistory.filter((session) => session.status === "interrupted").length ?? 0,
    progressReportCount: state?.progressReports.length ?? 0,
  };
}

class SequentialIds implements IdGenerator {
  private index = 0;
  next(kind: "project" | "subtask" | "focus-session" | "progress-report"): string {
    this.index += 1;
    return `${kind}-${this.index}`;
  }
}

class FakeNotifications implements NotificationPort {
  capability: NotificationCapability = { permission: "granted", precision: "exact", canSchedule: true };
  scheduled = new Map<string, FocusCompletionNotification>();
  scheduledBreak: BreakCompletionNotification | null = null;
  requestCount = 0;
  refreshCount = 0;
  failSchedule = false;
  failCancel = false;
  failRequest = false;
  failRefresh = false;
  refreshGate: Promise<void> | null = null;
  scheduleGate: Promise<void> | null = null;

  constructor(private readonly log: string[] = []) {}

  async requestPermission(): Promise<NotificationCapability> {
    this.requestCount += 1;
    this.log.push("request");
    if (this.failRequest) throw new Error("request failed");
    return this.capability;
  }

  async refreshCapability(): Promise<NotificationCapability> {
    this.refreshCount += 1;
    this.log.push("refresh");
    if (this.refreshGate) await this.refreshGate;
    if (this.failRefresh) throw new Error("refresh failed");
    return this.capability;
  }

  async scheduleFocusCompletion(notification: FocusCompletionNotification): Promise<void> {
    this.log.push(`schedule:${notification.sessionId}`);
    if (this.scheduleGate) await this.scheduleGate;
    if (this.failSchedule) throw new Error("schedule failed");
    this.scheduled.set(notification.sessionId, notification);
  }

  async cancelFocusCompletion(sessionId: string): Promise<void> {
    this.log.push(`cancel:${sessionId}`);
    if (this.failCancel) throw new Error("cancel failed");
    this.scheduled.delete(sessionId);
  }

  async scheduleBreakCompletion(notification: BreakCompletionNotification): Promise<void> {
    this.log.push('schedule-break');
    if (this.failSchedule) throw new Error('schedule failed');
    this.scheduledBreak = notification;
  }

  async cancelBreakCompletion(): Promise<void> {
    this.log.push('cancel-break');
    if (this.failCancel) throw new Error('cancel failed');
    this.scheduledBreak = null;
  }
}

async function fixture(options: { state?: DomainState; log?: string[]; clock?: TestClock } = {}) {
  const log = options.log ?? [];
  const repository = new MemoryRepository(options.state ?? null, log);
  const notifications = new FakeNotifications(log);
  const clock = options.clock ?? new TestClock();
  const service = await ApplicationService.initialize({
    repository,
    notifications,
    clock,
    ids: new SequentialIds(),
    initialTimeZone: "Asia/Shanghai",
  });
  return { service, repository, notifications, clock, log };
}

async function createProject(service: ApplicationService, subtasks = ["Foundation", "Roof"]) {
  const result = await service.dispatch({
    type: "CreateProject",
    title: "Build release",
    blueprintId: "cottage",
    subtasks: subtasks.map((title) => ({ title })),
  });
  expect(result.ok).toBe(true);
  return service.snapshot().projects[0]!;
}

describe("initialization and command persistence", () => {
  it("exposes a read-only notification capability refresh without requesting permission", async () => {
    const { service, notifications } = await fixture();
    notifications.capability = { permission: "granted", precision: "inexact", canSchedule: true };
    await expect(service.notificationCapability()).resolves.toEqual(notifications.capability);
    expect(notifications.refreshCount).toBe(1);
    expect(notifications.requestCount).toBe(0);
  });

  it("loads existing state or creates and saves a default aggregate", async () => {
    const fresh = await fixture();
    expect(fresh.repository.saves).toBe(1);
    expect(fresh.service.snapshot().calendar.timeZone).toBe("Asia/Shanghai");

    const state = createInitialState("America/New_York", [0]);
    const loaded = await fixture({ state });
    expect(loaded.repository.saves).toBe(0);
    expect(loaded.service.snapshot()).toEqual(state);
  });

  it("does not save a rejected domain command", async () => {
    const f = await fixture();
    const savesBefore = f.repository.saves;
    const result = await f.service.dispatch({ type: "CompleteFocus" });
    expect(result).toMatchObject({ ok: false, code: "FOCUS_NOT_ACTIVE" });
    expect(f.repository.saves).toBe(savesBefore);
  });

  it("does not expose its internal state through a rejected result", async () => {
    const f = await fixture();
    const result = await f.service.dispatch({ type: "CompleteFocus" });
    expect(result.ok).toBe(false);
    result.state.calendar.timeZone = "America/New_York";
    result.state.projects.push({
      id: "external", title: "Mutation", settlementIndex: 0, blueprintId: "x", createdAt: "2026-01-01T00:00:00.000Z",
      kind: "finite", habit: null, importedBlueprint: null, status: "active", subtaskStructureLocked: false, subtasks: [],
    });
    expect(f.service.snapshot().calendar.timeZone).toBe("Asia/Shanghai");
    expect(f.service.snapshot().projects).toEqual([]);
  });

  it("keeps in-memory truth unchanged when an atomic save rejects", async () => {
    const f = await fixture();
    f.repository.failNextSave = true;
    await expect(createProject(f.service)).rejects.toBeInstanceOf(ApplicationPersistenceError);
    expect(f.service.snapshot().projects).toEqual([]);
    expect(f.repository.persisted?.projects).toEqual([]);
  });

  it("does not run StartFocus side effects when its save rejects", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    f.repository.failNextSave = true;
    await expect(f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 1_000 }))
      .rejects.toBeInstanceOf(ApplicationPersistenceError);
    expect(f.notifications.requestCount).toBe(0);
    expect(f.notifications.scheduled.size).toBe(0);
    expect(f.service.snapshot().activeFocusSession).toBeNull();
  });

  it("persists FocusStarted before permission and absolute scheduling side effects", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    f.log.length = 0;
    const result = await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 25 * 60_000 });
    expect(result.ok).toBe(true);
    expect(f.log).toEqual(["save", "request", "schedule:focus-session-3"]);
    expect(f.notifications.scheduled.get("focus-session-3")).toEqual({
      sessionId: "focus-session-3",
      endsAt: "2026-07-20T09:25:00.000Z",
    });
  });

  it("returns a warning without rolling back timer truth when scheduling fails", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    f.notifications.failSchedule = true;
    const result = await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 1_000 });
    expect(result).toMatchObject({ ok: true, warnings: [{ code: "NOTIFICATION_SCHEDULE_FAILED" }] });
    expect(f.repository.persisted?.activeFocusSession?.endsAt).toBe("2026-07-20T09:00:01.000Z");
    expect(f.service.snapshot().activeFocusSession?.id).toBe("focus-session-3");
  });

  it("keeps the saved focus active when permission request fails", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    f.notifications.failRequest = true;
    const result = await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 1_000 });
    expect(result).toMatchObject({ ok: true, warnings: [{ code: "NOTIFICATION_PERMISSION_REQUEST_FAILED" }] });
    expect(f.repository.persisted?.activeFocusSession).not.toBeNull();
    expect(f.notifications.scheduled.size).toBe(0);
  });

  it("schedules and cancels an absolute break completion notification without prompting", async () => {
    const f = await fixture();
    f.log.length = 0;
    const endsAt = "2026-07-20T09:05:00.000Z";
    await expect(f.service.scheduleBreakCompletion({ endsAt })).resolves.toEqual([]);
    expect(f.log).toEqual(["refresh", "schedule-break"]);
    expect(f.notifications.requestCount).toBe(0);
    expect(f.notifications.scheduledBreak).toEqual({ endsAt });

    f.log.length = 0;
    await expect(f.service.cancelBreakCompletion()).resolves.toEqual([]);
    expect(f.log).toEqual(["cancel-break"]);
    expect(f.notifications.scheduledBreak).toBeNull();
  });

  it("does not schedule an already elapsed break notification", async () => {
    const f = await fixture();
    f.log.length = 0;
    await expect(f.service.scheduleBreakCompletion({ endsAt: "2026-07-20T08:59:59.000Z" })).resolves.toEqual([]);
    expect(f.log).toEqual(["cancel-break"]);
    expect(f.notifications.refreshCount).toBe(0);
  });

  it("rejects a stale service revision and writes only after resume adopts repository truth", async () => {
    const repository = new MemoryRepository();
    const clock = new TestClock();
    const first = await ApplicationService.initialize({
      repository, notifications: new FakeNotifications(), clock, ids: new SequentialIds(),
    });
    const stale = await ApplicationService.initialize({
      repository, notifications: new FakeNotifications(), clock, ids: new SequentialIds(),
    });

    const created = await first.dispatch({
      type: "CreateProject", title: "Imported truth", blueprintId: "cottage", subtasks: [{ title: "Keep me" }],
    });
    expect(created.ok).toBe(true);
    const committedRevision = repository.revision;
    const committed = structuredClone(repository.persisted);

    await expect(stale.dispatch({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 2 }))
      .rejects.toBeInstanceOf(ApplicationPersistenceError);
    expect(repository.revision).toBe(committedRevision);
    expect(repository.persisted).toEqual(committed);
    expect(stale.snapshot().projects).toEqual([]);

    await expect(stale.resume()).resolves.toMatchObject({ ok: true });
    const subtaskId = stale.snapshot().projects[0]!.subtasks[0]!.id;
    await expect(stale.dispatch({ type: "RenameSubtask", subtaskId, title: "Adopted" }))
      .resolves.toMatchObject({ ok: true });
    expect(repository.revision).toBe(committedRevision + 1);
    expect(repository.persisted?.projects[0]!.subtasks[0]!.title).toBe("Adopted");
  });

  it("persists an active project rename before returning its event", async () => {
    const log: string[] = [];
    const f = await fixture({ log });
    await createProject(f.service, ["One"]);
    log.length = 0;

    const result = await f.service.dispatch({ type: "RenameProject", title: "  Release renamed  " });

    expect(result).toMatchObject({
      ok: true,
      state: { projects: [{ title: "Release renamed", blueprintId: "cottage" }] },
      events: [{ type: "ProjectRenamed", projectId: "project-1" }],
    });
    expect(log).toEqual(["save"]);
    expect(f.repository.persisted?.projects[0]).toMatchObject({
      title: "Release renamed",
      blueprintId: "cottage",
    });
  });

  it("persists multiple unfinished projects and switches the active project", async () => {
    const f = await fixture();
    await f.service.dispatch({
      type: "CreateProject", title: "First", blueprintId: "cottage", subtasks: [{ title: "First step" }],
    });
    const firstId = f.service.snapshot().activeProjectId!;
    await expect(f.service.dispatch({
      type: "CreateProject", title: "Second", blueprintId: "tower", subtasks: [{ title: "Second step" }],
    })).resolves.toMatchObject({
      ok: true,
      state: { projects: [{ status: "paused" }, { status: "active" }] },
    });
    const secondId = f.service.snapshot().activeProjectId!;

    await expect(f.service.dispatch({ type: "SwitchActiveProject", projectId: firstId })).resolves.toMatchObject({
      ok: true,
      state: { activeProjectId: firstId, projects: [{ status: "active" }, { status: "paused" }] },
    });
    expect(f.repository.persisted).toMatchObject({
      activeProjectId: firstId,
      projects: [{ id: firstId, status: "active" }, { id: secondId, status: "paused" }],
    });
    expect(f.service.worldProjection().projects).toMatchObject([
      { isActive: true, settlementIndex: 0, project: { id: firstId, status: "active" } },
      { isActive: false, settlementIndex: 1, project: { id: secondId, status: "paused" } },
    ]);
  });

  it("does not persist a project switch rejected by pending focus reporting", async () => {
    const f = await fixture();
    await f.service.dispatch({
      type: "CreateProject", title: "First", blueprintId: "cottage", subtasks: [{ title: "First step" }],
    });
    const first = f.service.activeProjectProjection()!;
    await f.service.dispatch({ type: "StartFocus", subtaskId: first.project.subtasks[0]!.id, plannedDurationMs: 1 });
    f.clock.set("2026-07-20T09:00:00.001Z");
    await f.service.dispatch({ type: "CompleteFocus" });
    const savesBefore = f.repository.saves;

    const result = await f.service.dispatch({
      type: "CreateProject", title: "Blocked", blueprintId: "tower", subtasks: [{ title: "No" }],
    });
    expect(result).toMatchObject({ ok: false, code: "UNREPORTED_FOCUS_PREVENTS_PROJECT_SWITCH" });
    expect(f.repository.saves).toBe(savesBefore);
    expect(f.service.snapshot().projects).toHaveLength(1);
  });
});

describe("lifecycle recovery", () => {
  it("persists native app-switch excursions and maps lock/exemption context", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });

    await expect(f.service.handleLifecycleEvent({ type: "background", source: "native" })).resolves.toMatchObject({
      ok: true, events: [{ type: "FocusBackgrounded", reason: "app-switch" }],
    });
    expect(f.repository.persisted?.activeFocusSession?.integrity.backgroundReason).toBe("app-switch");
    f.clock.set("2026-07-20T09:00:03.001Z");
    await expect(f.service.handleLifecycleEvent({ type: "foreground" })).resolves.toMatchObject({
      ok: true, events: [{ type: "FocusExcursionRecorded", effectiveExcursions: 1 }],
    });
    expect(f.repository.persisted?.activeFocusSession?.integrity.effectiveExcursions).toBe(1);

    await f.service.handleLifecycleEvent({ type: "background", source: "native", context: { locked: true } });
    expect(f.repository.persisted?.activeFocusSession?.integrity.backgroundReason).toBe("screen-lock");
    f.clock.set("2026-07-20T09:00:10.000Z");
    await f.service.handleLifecycleEvent({ type: "foreground" });
    await f.service.handleLifecycleEvent({ type: "background", source: "native", context: { exempt: true } });
    expect(f.repository.persisted?.activeFocusSession?.integrity.backgroundReason).toBe("system-exempt");
    f.clock.set("2026-07-20T09:00:20.000Z");
    await f.service.handleLifecycleEvent({ type: "foreground" });
    expect(f.service.snapshot().activeFocusSession?.integrity.effectiveExcursions).toBe(1);
  });

  it("counts multi-window stops as app-switch excursions (split-screen anti-cheat)", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });
    await f.service.handleLifecycleEvent({ type: "background", source: "native", context: { multiWindow: true } });
    expect(f.repository.persisted?.activeFocusSession?.integrity.backgroundReason).toBe("app-switch");
    f.clock.set("2026-07-20T09:00:04.000Z");
    await expect(f.service.handleLifecycleEvent({ type: "foreground" })).resolves.toMatchObject({
      ok: true, events: [{ type: "FocusExcursionRecorded", effectiveExcursions: 1 }],
    });
    expect(f.service.snapshot().activeFocusSession?.integrity.effectiveExcursions).toBe(1);
  });

  it("uses the native background instant when context delivery is delayed", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });
    f.clock.set("2026-07-20T09:00:05.000Z");
    await f.service.handleLifecycleEvent({
      type: "background",
      source: "native",
      context: { backgroundedAtEpochMs: Date.parse("2026-07-20T09:00:00.000Z") },
    });
    expect(f.service.snapshot().activeFocusSession?.integrity.backgroundedAt).toBe("2026-07-20T09:00:00.000Z");
    await expect(f.service.handleLifecycleEvent({ type: "foreground" })).resolves.toMatchObject({
      ok: true, events: [{ type: "FocusExcursionRecorded", effectiveExcursions: 1 }],
    });
  });

  it("treats Web visibility as best-effort and completes at endsAt before a limiting excursion", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "ConfigureFocusIntegrity", enabled: true, maxEffectiveExcursions: 1 });
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 5_000 });
    await f.service.handleLifecycleEvent({ type: "background", source: "web" });
    expect(f.service.snapshot().activeFocusSession?.integrity.backgroundReason).toBe("web-visibility");
    f.clock.set("2026-07-20T09:00:05.000Z");

    const result = await f.service.handleLifecycleEvent({ type: "foreground" });
    expect(result).toMatchObject({ ok: true, events: [{ type: "FocusCompleted" }] });
    expect(f.service.snapshot().focusHistory).toMatchObject([{ status: "completed" }]);
    expect(f.service.snapshot().activeFocusSession).toBeNull();
  });

  it("re-reads persisted state and reschedules without requesting permission", async () => {
    const clock = new TestClock();
    const seed = createInitialState("Asia/Shanghai");
    let result = execute(seed, {
      type: "CreateProject", projectId: "p", title: "P", blueprintId: "cottage", subtasks: [{ id: "s", title: "S" }],
    }, clock);
    if (!result.ok) throw new Error("seed failed");
    result = execute(result.state, { type: "StartFocus", sessionId: "f", subtaskId: "s", plannedDurationMs: 60_000 }, clock);
    if (!result.ok) throw new Error("seed failed");
    const f = await fixture({ state: result.state, clock });

    const resumed = await f.service.resume();
    expect(resumed).toMatchObject({ ok: true, events: [], warnings: [] });
    expect(f.notifications.requestCount).toBe(0);
    expect(f.notifications.refreshCount).toBe(1);
    expect(f.notifications.scheduled.get("f")?.endsAt).toBe("2026-07-20T09:01:00.000Z");
  });

  it("completes delayed cross-midnight focus at endsAt and saves before cancelling", async () => {
    const clock = new TestClock(new Date("2026-07-20T15:59:59.000Z"));
    let state = createInitialState("Asia/Shanghai");
    const created = execute(state, {
      type: "CreateProject", projectId: "p", title: "P", blueprintId: "cottage", subtasks: [{ id: "s", title: "S" }],
    }, clock);
    if (!created.ok) throw new Error("seed failed");
    const started = execute(created.state, { type: "StartFocus", sessionId: "midnight", subtaskId: "s", plannedDurationMs: 2_000 }, clock);
    if (!started.ok) throw new Error("seed failed");
    state = started.state;
    clock.set("2026-07-23T10:00:00.000Z");
    const log: string[] = [];
    const f = await fixture({ state, clock, log });
    log.length = 0;

    const resumed = await f.service.resume();
    expect(resumed).toMatchObject({ ok: true, events: [{ type: "FocusCompleted", sessionId: "midnight" }] });
    expect(log).toEqual(["load", "save", "cancel:midnight"]);
    expect(f.repository.persisted?.focusHistory[0]).toMatchObject({
      completedAt: "2026-07-20T16:00:01.000Z",
      completedLocalDate: "2026-07-21",
    });
    expect(f.notifications.requestCount).toBe(0);
    expect(f.notifications.refreshCount).toBe(0);
  });

  it("uses repository truth instead of a stale in-memory session", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });
    f.repository.externalReplace(createInitialState("UTC"));
    const resumed = await f.service.resume();
    expect(resumed).toMatchObject({ ok: true, events: [] });
    expect(f.service.snapshot().activeFocusSession).toBeNull();
  });

  it("reports refresh failure without prompting or changing persisted timer truth", async () => {
    const clock = new TestClock();
    let state = createInitialState();
    const created = execute(state, {
      type: "CreateProject", projectId: "p", title: "P", blueprintId: "cottage", subtasks: [{ id: "s", title: "S" }],
    }, clock);
    if (!created.ok) throw new Error("seed failed");
    const started = execute(created.state, { type: "StartFocus", sessionId: "f", subtaskId: "s", plannedDurationMs: 60_000 }, clock);
    if (!started.ok) throw new Error("seed failed");
    state = started.state;
    const f = await fixture({ state, clock });
    f.notifications.failRefresh = true;
    const result = await f.service.resume();
    expect(result).toMatchObject({ ok: true, warnings: [{ code: "NOTIFICATION_CAPABILITY_REFRESH_FAILED" }] });
    expect(f.notifications.requestCount).toBe(0);
    expect(f.repository.persisted).toEqual(state);
  });

  it("rechecks time after capability refresh and completes instead of scheduling an expired focus", async () => {
    const clock = new TestClock();
    let state = createInitialState();
    const created = execute(state, {
      type: "CreateProject", projectId: "p", title: "P", blueprintId: "cottage", subtasks: [{ id: "s", title: "S" }],
    }, clock);
    if (!created.ok) throw new Error("seed failed");
    const started = execute(created.state, { type: "StartFocus", sessionId: "f", subtaskId: "s", plannedDurationMs: 1_000 }, clock);
    if (!started.ok) throw new Error("seed failed");
    state = started.state;
    const f = await fixture({ state, clock });
    let release!: () => void;
    f.notifications.refreshGate = new Promise<void>((resolve) => { release = resolve; });

    const resume = f.service.resume();
    await waitUntil(() => f.notifications.refreshCount === 1);
    clock.set("2026-07-20T09:00:01.000Z");
    release();
    const result = await resume;
    expect(result).toMatchObject({ ok: true, events: [{ type: "FocusCompleted", sessionId: "f" }] });
    expect(f.notifications.scheduled.size).toBe(0);
    expect(f.repository.persisted?.activeFocusSession).toBeNull();
  });

  it("rechecks repository truth after refresh and never schedules a replaced session", async () => {
    const clock = new TestClock();
    let state = createInitialState();
    const created = execute(state, {
      type: "CreateProject", projectId: "p", title: "P", blueprintId: "cottage", subtasks: [{ id: "s", title: "S" }],
    }, clock);
    if (!created.ok) throw new Error("seed failed");
    const started = execute(created.state, { type: "StartFocus", sessionId: "old", subtaskId: "s", plannedDurationMs: 60_000 }, clock);
    if (!started.ok) throw new Error("seed failed");
    state = started.state;
    const f = await fixture({ state, clock });
    let release!: () => void;
    f.notifications.refreshGate = new Promise<void>((resolve) => { release = resolve; });

    const resume = f.service.resume();
    await waitUntil(() => f.notifications.refreshCount === 1);
    const replacement = structuredClone(state);
    replacement.activeFocusSession = { ...replacement.activeFocusSession!, id: "replacement" };
    f.repository.externalReplace(replacement);
    release();
    const result = await resume;
    expect(result).toMatchObject({ ok: true, events: [] });
    expect(f.notifications.scheduled.size).toBe(0);
    expect(f.log).toContain("cancel:old");
    expect(f.service.snapshot().activeFocusSession?.id).toBe("replacement");
  });

  it("rechecks time after scheduling and cancels the newly expired notification", async () => {
    const clock = new TestClock();
    let state = createInitialState();
    const created = execute(state, {
      type: "CreateProject", projectId: "p", title: "P", blueprintId: "cottage", subtasks: [{ id: "s", title: "S" }],
    }, clock);
    if (!created.ok) throw new Error("seed failed");
    const started = execute(created.state, { type: "StartFocus", sessionId: "f", subtaskId: "s", plannedDurationMs: 1_000 }, clock);
    if (!started.ok) throw new Error("seed failed");
    state = started.state;
    const f = await fixture({ state, clock });
    let release!: () => void;
    f.notifications.scheduleGate = new Promise<void>((resolve) => { release = resolve; });

    const resume = f.service.resume();
    await waitUntil(() => f.log.includes("schedule:f"));
    clock.set("2026-07-20T09:00:01.000Z");
    release();
    const result = await resume;
    expect(result).toMatchObject({ ok: true, events: [{ type: "FocusCompleted", sessionId: "f" }] });
    expect(f.notifications.scheduled.size).toBe(0);
    expect(f.log.slice(-3)).toEqual(["load", "save", "cancel:f"]);
  });

  it("cancels a schedule when persisted endsAt changes across the scheduling boundary", async () => {
    const clock = new TestClock();
    let state = createInitialState();
    const created = execute(state, {
      type: "CreateProject", projectId: "p", title: "P", blueprintId: "cottage", subtasks: [{ id: "s", title: "S" }],
    }, clock);
    if (!created.ok) throw new Error("seed failed");
    const started = execute(created.state, { type: "StartFocus", sessionId: "f", subtaskId: "s", plannedDurationMs: 60_000 }, clock);
    if (!started.ok) throw new Error("seed failed");
    state = started.state;
    const f = await fixture({ state, clock });
    let release!: () => void;
    f.notifications.scheduleGate = new Promise<void>((resolve) => { release = resolve; });

    const resume = f.service.resume();
    await waitUntil(() => f.log.includes("schedule:f"));
    const changed = structuredClone(state);
    changed.activeFocusSession = { ...changed.activeFocusSession!, endsAt: "2026-07-20T09:02:00.000Z" };
    f.repository.externalReplace(changed);
    release();
    const result = await resume;
    expect(result).toMatchObject({ ok: true, events: [] });
    expect(f.notifications.scheduled.size).toBe(0);
    expect(f.service.snapshot().activeFocusSession?.endsAt).toBe("2026-07-20T09:02:00.000Z");
    expect(f.log.at(-1)).toBe("cancel:f");
  });

  it("saves a fresh aggregate then cleans a stale notification when storage was cleared", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });
    const sessionId = f.service.snapshot().activeFocusSession!.id;
    expect(f.notifications.scheduled.has(sessionId)).toBe(true);
    f.repository.externalReplace(null);
    f.log.length = 0;

    const result = await f.service.resume();
    expect(result).toMatchObject({ ok: true, events: [], warnings: [] });
    expect(f.log).toEqual(["load", "save", `cancel:${sessionId}`]);
    expect(f.repository.persisted).toEqual(f.service.snapshot());
    expect(f.notifications.scheduled.size).toBe(0);
  });

  it("keeps a freshly saved aggregate and warns if stale notification cleanup fails", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });
    f.repository.externalReplace(null);
    f.notifications.failCancel = true;
    const result = await f.service.resume();
    expect(result).toMatchObject({ ok: true, warnings: [{ code: "NOTIFICATION_CANCEL_FAILED" }] });
    const saved = f.repository.persisted as DomainState | null;
    expect(saved?.activeFocusSession).toBeNull();
    expect(saved?.projects).toEqual([]);
  });

  it("keeps the old state-revision pair when an initial null recovery save fails", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });
    const before = f.service.snapshot();
    f.repository.externalReplace(null);
    f.repository.failNextSave = true;

    await expect(f.service.resume()).rejects.toBeInstanceOf(ApplicationPersistenceError);
    expect(f.service.snapshot()).toEqual(before);
    await expect(f.service.dispatch({ type: "CancelFocus" })).rejects.toBeInstanceOf(ApplicationPersistenceError);
    expect(f.repository.persisted).toBeNull();
    expect(f.service.snapshot()).toEqual(before);
  });

  it("keeps the old state-revision pair when null appears after notification refresh", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });
    const before = f.service.snapshot();
    let release!: () => void;
    f.notifications.refreshGate = new Promise<void>((resolve) => { release = resolve; });

    const resume = f.service.resume();
    await waitUntil(() => f.notifications.refreshCount === 1);
    f.repository.externalReplace(null);
    f.repository.failNextSave = true;
    release();

    await expect(resume).rejects.toBeInstanceOf(ApplicationPersistenceError);
    expect(f.service.snapshot()).toEqual(before);
    await expect(f.service.dispatch({ type: "CancelFocus" })).rejects.toBeInstanceOf(ApplicationPersistenceError);
    expect(f.repository.persisted).toBeNull();
    expect(f.service.snapshot()).toEqual(before);
  });
});

describe("serialization and projection", () => {
  it("materializes, persists, and projects an imported blueprint without aliases", async () => {
    const f = await fixture();
    const importedBlueprint = {
      schemaVersion: 1 as const,
      id: "imported-blueprint",
      title: "Imported blueprint",
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [
        { x: 0, y: 0, z: 0, materialId: "stone" as const, stage: "foundation" as const, buildOrder: 0,
          sourceBlockId: "minecraft:oak_log", sourceBlockState: { axis: "x" } },
        { x: 1, y: 0, z: 0, materialId: "wood" as const, stage: "frame" as const, buildOrder: 2_000 },
      ],
    };
    await expect(f.service.dispatch({
      type: "CreateProject", title: "Imported", blueprintId: importedBlueprint.id,
      importedBlueprint, subtasks: [{ title: "Step" }],
    })).resolves.toMatchObject({ ok: true });

    const active = f.service.activeProjectProjection()!;
    const world = f.service.worldProjection();
    expect(active.building.importedBlueprint).toEqual(importedBlueprint);
    expect(world.projects[0]!.building.importedBlueprint).toEqual(importedBlueprint);
    expect(f.repository.persisted?.projects[0]!.importedBlueprint).toEqual(importedBlueprint);
    active.building.importedBlueprint!.voxels[0]!.x = 99;
    active.building.importedBlueprint!.voxels[0]!.sourceBlockState!.axis = "z";
    world.projects[0]!.building.importedBlueprint!.title = "Mutated";
    expect(f.service.snapshot().projects[0]!.importedBlueprint).toEqual(importedBlueprint);
  });

  it("projects earned imported decorations with stable local placement and an inline blueprint", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    const blueprint = {
      schemaVersion: 1 as const,
      id: "decoration-content-hash",
      title: "Lantern post",
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: "accent" as const, stage: "details" as const, buildOrder: 10_000,
        sourceBlockId: "minecraft:lantern", sourceBlockState: { hanging: "true" }, emissiveKind: "lantern", emissiveLevel: 15 }],
    };
    await f.service.dispatch({ type: "ImportDecorationBlueprint", blueprint });
    await f.service.dispatch({ type: "SetDailyGoal", date: "2026-07-20", targetPomodoros: 1 });
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 1 });
    f.clock.set("2026-07-20T09:00:00.001Z");
    await f.service.dispatch({ type: "CompleteFocus" });

    const reward = f.service.worldProjection().projects[0]!.importedDecorations[0]!;
    expect(reward).toMatchObject({
      rewardId: `2026-07-20:${blueprint.id}`,
      resourceId: blueprint.id,
      date: "2026-07-20",
      blueprint,
      localPosition: { x: expect.any(Number), z: expect.any(Number) },
      rotationQuarterTurns: expect.any(Number),
    });
    reward.blueprint.title = "Mutated projection";
    reward.blueprint.voxels[0]!.sourceBlockState!.hanging = "false";
    expect(f.service.snapshot().decorationBlueprintResources[0]!.blueprint.title).toBe("Lantern post");
    expect(f.service.snapshot().decorationBlueprintResources[0]!.blueprint.voxels[0]!.sourceBlockState).toEqual({ hanging: "true" });
  });

  it("serializes schedule and cancel so cancellation wins an in-flight schedule", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    let release!: () => void;
    f.notifications.scheduleGate = new Promise<void>((resolve) => { release = resolve; });
    f.log.length = 0;

    const start = f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });
    await waitUntil(() => f.log.some((entry) => entry.startsWith("schedule:")));
    const cancel = f.service.dispatch({ type: "CancelFocus" });
    await Promise.resolve();
    expect(f.log.some((entry) => entry.startsWith("cancel:"))).toBe(false);
    release();
    await expect(start).resolves.toMatchObject({ ok: true });
    await expect(cancel).resolves.toMatchObject({ ok: true });
    expect(f.log.slice(-2)).toEqual(["save", "cancel:focus-session-3"]);
    expect(f.notifications.scheduled.size).toBe(0);
  });

  it("serializes concurrent commands against the latest accepted state", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    const command = { type: "StartFocus" as const, subtaskId: project.subtasks[0]!.id, plannedDurationMs: 1_000 };
    const [first, second] = await Promise.all([f.service.dispatch(command), f.service.dispatch(command)]);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, code: "FOCUS_ALREADY_ACTIVE" });
    expect(f.repository.persisted?.activeFocusSession?.id).toBe("focus-session-3");
  });

  it("returns cancel warnings after persisting the interrupted session", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 1_000 });
    f.notifications.failCancel = true;
    const result = await f.service.dispatch({ type: "CancelFocus" });
    expect(result).toMatchObject({ ok: true, warnings: [{ code: "NOTIFICATION_CANCEL_FAILED" }] });
    expect(f.repository.persisted?.activeFocusSession).toBeNull();
    expect(f.repository.persisted?.focusHistory[0]).toMatchObject({ status: "interrupted" });
  });

  it("projects building progress, condition, and only unreported completed sessions", async () => {
    const f = await fixture();
    const project = await createProject(f.service, ["One", "Two"]);
    const firstSubtask = project.subtasks[0]!;
    await f.service.dispatch({ type: "StartFocus", subtaskId: firstSubtask.id, plannedDurationMs: 1 });
    f.clock.set("2026-07-20T09:00:00.001Z");
    await f.service.dispatch({ type: "CompleteFocus" });
    let projection = f.service.activeProjectProjection();
    expect(projection).toMatchObject({
      building: { blueprintId: "cottage", completionBasisPoints: 0, conditionBasisPoints: 10_000 },
      unreportedCompletedSessions: [{ id: "focus-session-4", subtaskId: firstSubtask.id }],
    });

    await f.service.dispatch({
      type: "ReportSubtaskProgress",
      subtaskId: firstSubtask.id,
      focusSessionIds: ["focus-session-4"],
      progressBasisPoints: 5_000,
    });
    projection = f.service.activeProjectProjection();
    expect(projection?.building.completionBasisPoints).toBe(2_500);
    expect(projection?.unreportedCompletedSessions).toEqual([]);
  });

  it("projects both permanent monuments and the current active building", async () => {
    const f = await fixture();
    const first = await createProject(f.service, ["One"]);
    await f.service.dispatch({ type: "StartFocus", subtaskId: first.subtasks[0]!.id, plannedDurationMs: 1 });
    f.clock.set("2026-07-20T09:00:00.001Z");
    await f.service.dispatch({ type: "CompleteFocus" });
    await f.service.dispatch({
      type: "ReportSubtaskProgress", subtaskId: first.subtasks[0]!.id,
      focusSessionIds: ["focus-session-3"], progressBasisPoints: 10_000,
    });
    await f.service.dispatch({ type: "CreateProject", title: "Second", blueprintId: "tower", subtasks: [{ title: "Two" }] });

    const world = f.service.worldProjection();
    expect(world.projects).toHaveLength(2);
    expect(world.projects[0]).toMatchObject({
      isActive: false,
      settlementIndex: 0,
      project: { status: "monument" },
      building: { completionBasisPoints: 10_000, conditionBasisPoints: 10_000 },
    });
    expect(world.projects[1]).toMatchObject({
      isActive: true,
      settlementIndex: 1,
      project: { status: "active", blueprintId: "tower" },
      building: { completionBasisPoints: 0, conditionBasisPoints: 10_000 },
    });
    // Projections are epoch-cached shared copies (render-phase performance contract):
    // stable identity within a state epoch, fresh copies after the next adopted state.
    expect(f.service.worldProjection()).toBe(world);
    await f.service.dispatch({ type: "RenameProject", title: "Release renamed" });
    expect(f.service.worldProjection()).not.toBe(world);
    expect(f.service.worldProjection().projects[1]!.project.title).toBe("Release renamed");
  });

  it("keeps a completed habit building on its plot and assigns the next cycle a new plot", async () => {
    const f = await fixture();
    await f.service.dispatch({ type: "CreateHabitProject", title: "Read English", blueprintId: "cottage", targetRounds: 10 });
    const habitProjectId = f.service.snapshot().activeProjectId!;
    const base = Date.parse("2026-07-20T09:00:00.000Z");
    for (let round = 0; round < 10; round += 1) {
      const startedAt = base + round * 2;
      f.clock.set(new Date(startedAt).toISOString());
      await f.service.dispatch({ type: "StartFocus", subtaskId: null, plannedDurationMs: 1 });
      f.clock.set(new Date(startedAt + 1).toISOString());
      await f.service.dispatch({ type: "CompleteFocus" });
    }

    expect(f.service.worldProjection().projects).toMatchObject([
      { project: { status: "monument", kind: "habit" }, settlementIndex: 0, building: { blueprintId: "cottage", completionBasisPoints: 10_000 } },
    ]);
    expect(f.service.activeProjectProjection()).toMatchObject({ project: { id: habitProjectId, settlementIndex: 1, habit: { awaitingNextBuilding: true } } });

    await f.service.dispatch({ type: "SelectNextHabitBuilding", blueprintId: "tower", targetRounds: 30 });
    const world = f.service.worldProjection();
    expect(world.projects.map((project) => project.settlementIndex).sort((left, right) => left - right)).toEqual([0, 1]);
    expect(world.projects.find((project) => project.isActive)).toMatchObject({ settlementIndex: 1, building: { blueprintId: "tower", completionBasisPoints: 0 } });
    expect(world.projects.find((project) => project.project.status === "monument")).toMatchObject({ settlementIndex: 0, building: { blueprintId: "cottage" } });

    await f.service.dispatch({ type: "CreateProject", title: "Finite", blueprintId: "workshop", subtasks: [{ title: "Ship" }] });
    expect(f.service.worldProjection().projects.map((project) => project.settlementIndex).sort((left, right) => left - right)).toEqual([0, 1, 2]);
  });

  it("keeps settlement plot indices stable across soft deletion", async () => {
    const repository = new BackupMemoryRepository();
    const service = await ApplicationService.initialize({
      repository, backupRepository: repository, notifications: new FakeNotifications(), clock: new TestClock(), ids: new SequentialIds(),
    });
    const first = await createProject(service, ["One"]);
    await service.dispatch({ type: "DeleteActiveProject", projectId: first.id });
    await service.dispatch({ type: "CreateProject", title: "Second", blueprintId: "tower", subtasks: [{ title: "Two" }] });

    expect(service.worldProjection().projects).toMatchObject([
      { project: { title: "Second" }, settlementIndex: 1, isActive: true },
    ]);
  });
});

describe("backup orchestration", () => {
  it("adopts an imported aggregate and cancels an old notification only after replacement commits", async () => {
    const repository = new BackupMemoryRepository();
    const notifications = new FakeNotifications();
    const clock = new TestClock();
    const service = await ApplicationService.initialize({ repository, backupRepository: repository, notifications, clock, ids: new SequentialIds() });
    const project = await createProject(service, ["One"]);
    await service.dispatch({ type: "StartFocus", subtaskId: project.subtasks[0]!.id, plannedDurationMs: 60_000 });
    const oldSessionId = service.snapshot().activeFocusSession!.id;
    const replacement = createInitialState("UTC");

    const result = await service.replaceFromImport(JSON.stringify(replacement));
    expect(result).toMatchObject({ ok: true, state: { projects: [], activeFocusSession: null } });
    expect(notifications.scheduled.has(oldSessionId)).toBe(false);
    expect(repository.rollbacks).toHaveLength(1);

    await expect(service.dispatch({ type: "CreateProject", title: "Fresh", blueprintId: "cottage", subtasks: [{ title: "Next" }] }))
      .resolves.toMatchObject({ ok: true });
  });

  it("creates a rollback before soft-deleting the active project and restores it", async () => {
    const repository = new BackupMemoryRepository();
    const service = await ApplicationService.initialize({ repository, backupRepository: repository, notifications: new FakeNotifications(), clock: new TestClock(), ids: new SequentialIds() });
    const project = await createProject(service, ["One"]);

    await expect(service.dispatch({ type: "DeleteActiveProject", projectId: project.id })).resolves.toMatchObject({
      ok: true, events: [{ type: "ProjectDeleted", projectId: project.id }],
    });
    expect(repository.rollbacks).toHaveLength(1);
    expect(service.worldProjection().projects).toEqual([]);

    await expect(service.restoreRollback("rollback-1")).resolves.toMatchObject({
      ok: true, state: { activeProjectId: project.id, projects: [{ status: "active" }] },
    });
    expect(repository.rollbacks).toHaveLength(2);
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for test condition");
}
