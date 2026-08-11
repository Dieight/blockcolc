import {
  ApplicationPersistenceError,
  ApplicationService,
  type Clock,
  type IdGenerator,
  type NotificationCapability,
  type NotificationPort,
} from "@tomato-clock/application";
import { IndexedDbStateRepository, StorageConflictError } from "@tomato-clock/storage-indexeddb";

const DATABASE_NAME = "tomato-clock-core-loop-e2e";
const INITIAL_NOW = "2026-07-23T01:00:00.000Z";
const FOCUS_DURATION_MS = 25 * 60 * 1000;

class ControllableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current); }
  set(instant: string): void { this.current = new Date(instant); }
}

class CryptoIdGenerator implements IdGenerator {
  next(kind: "project" | "subtask" | "focus-session" | "progress-report"): string {
    return `${kind}-${crypto.randomUUID()}`;
  }
}

class RecordingNotifications implements NotificationPort {
  readonly scheduled: Array<{ sessionId: string; endsAt: string }> = [];
  readonly cancelled: string[] = [];
  private readonly active = new Map<string, string>();

  async requestPermission(): Promise<NotificationCapability> { return capability(); }
  async refreshCapability(): Promise<NotificationCapability> { return capability(); }
  async scheduleFocusCompletion(notification: { sessionId: string; endsAt: string }): Promise<void> {
    this.scheduled.push(structuredClone(notification));
    this.active.set(notification.sessionId, notification.endsAt);
  }
  async cancelFocusCompletion(sessionId: string): Promise<void> {
    this.cancelled.push(sessionId);
    this.active.delete(sessionId);
  }
  async scheduleBreakCompletion(): Promise<void> {}
  async cancelBreakCompletion(): Promise<void> {}
  activeCount(): number { return this.active.size; }
}

function capability(): NotificationCapability {
  return { permission: "granted", precision: "exact", canSchedule: true };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function createService(repository: IndexedDbStateRepository, notifications: RecordingNotifications, clock: ControllableClock) {
  return ApplicationService.initialize({
    repository,
    notifications,
    clock,
    ids: new CryptoIdGenerator(),
    initialTimeZone: "UTC",
    initialRestWeekdays: [0, 6],
  });
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not reset integration database"));
    request.onblocked = () => reject(new Error("Integration database reset was blocked"));
  });
}

export interface BeforeReloadEvidence {
  projectId: string;
  subtaskIds: [string, string];
  completedSessionId: string;
  endsAt: string;
  completedAt: string;
  completedLocalDate: string;
  goalReachedAt: string;
  buildingCompletionBasisPoints: number;
  buildingConditionBasisPoints: number;
  scheduled: Array<{ sessionId: string; endsAt: string }>;
  cancelled: string[];
  persistedRevision: number;
}

export interface AfterReloadEvidence {
  persistedCompletionBasisPoints: number;
  persistedConditionBasisPoints: number;
  completedPomodorosBeforeCancel: number;
  completedPomodorosAfterCancel: number;
  interruptedSessions: number;
  goalReachedAt: string;
  staleWrite: { rejected: boolean; error: string; cause: string };
  titleAfterConflict: string;
  finalRevision: number;
}

async function runBeforeReload(): Promise<BeforeReloadEvidence> {
  await deleteDatabase();
  const clock = new ControllableClock(new Date(INITIAL_NOW));
  const notifications = new RecordingNotifications();
  const firstRepository = new IndexedDbStateRepository({ databaseName: DATABASE_NAME });
  const firstService = await createService(firstRepository, notifications, clock);
  assert(firstService.snapshot().projects.length === 0, "initialize must persist an empty aggregate");

  const created = await firstService.dispatch({
    type: "CreateProject",
    title: "Ship the first release",
    blueprintId: "builtin-small-house",
    subtasks: [{ title: "Domain loop" }, { title: "Android shell" }],
  });
  assert(created.ok, "project creation failed");
  const project = created.state.projects[0];
  assert(project !== undefined && project.subtasks.length === 2, "project must contain two subtasks");
  const subtaskIds = project.subtasks.map((subtask) => subtask.id) as [string, string];

  const goal = await firstService.dispatch({ type: "SetDailyGoal", date: "2026-07-23", targetPomodoros: 1 });
  assert(goal.ok, "daily goal setup failed");
  const started = await firstService.dispatch({
    type: "StartFocus",
    subtaskId: subtaskIds[0],
    plannedDurationMs: FOCUS_DURATION_MS,
  });
  assert(started.ok && started.state.activeFocusSession !== null, "focus start failed");
  const active = started.state.activeFocusSession;
  const expectedEndsAt = new Date(Date.parse(INITIAL_NOW) + FOCUS_DURATION_MS).toISOString();
  assert(active.endsAt === expectedEndsAt, "focus must persist its absolute endsAt");
  assert(notifications.scheduled.some((item) => item.sessionId === active.id && item.endsAt === active.endsAt), "notification was not scheduled by absolute endsAt");

  firstRepository.close();
  const recoveredRepository = new IndexedDbStateRepository({ databaseName: DATABASE_NAME });
  const recoveredService = await createService(recoveredRepository, notifications, clock);
  clock.set(new Date(Date.parse(active.endsAt) + 60_000).toISOString());
  const resumed = await recoveredService.resume();
  assert(resumed.ok, "elapsed focus recovery failed");
  const completed = resumed.state.focusHistory.find((session) => session.id === active.id);
  assert(completed?.status === "completed", "recovered focus must be completed");
  assert(completed.completedAt === active.endsAt, "delayed recovery must complete at endsAt");
  const reachedGoal = resumed.state.dailyGoals.find((candidate) => candidate.date === "2026-07-23");
  assert(reachedGoal?.reachedAt !== null && reachedGoal?.reachedAt !== undefined, "daily goal must be reached by one completed Pomodoro");
  assert(notifications.cancelled.includes(active.id) && notifications.activeCount() === 0, "completed focus notification must be cancelled");

  const reported = await recoveredService.dispatch({
    type: "ReportSubtaskProgress",
    subtaskId: subtaskIds[0],
    focusSessionIds: [active.id],
    progressBasisPoints: 5000,
  });
  assert(reported.ok, "progress report failed");
  const world = recoveredService.worldProjection();
  const projected = world.projects.find((candidate) => candidate.project.id === project.id);
  assert(projected?.building.completionBasisPoints === 2500, "one half-complete subtask out of two must project to 2500 bp");
  assert(projected.building.conditionBasisPoints === 10000, "building condition must remain independent from progress");
  const persisted = await recoveredRepository.load();
  assert(persisted.state !== null, "aggregate must be persisted before reload");
  recoveredRepository.close();

  return {
    projectId: project.id,
    subtaskIds,
    completedSessionId: active.id,
    endsAt: active.endsAt,
    completedAt: completed.completedAt,
    completedLocalDate: completed.completedLocalDate,
    goalReachedAt: reachedGoal.reachedAt,
    buildingCompletionBasisPoints: projected.building.completionBasisPoints,
    buildingConditionBasisPoints: projected.building.conditionBasisPoints,
    scheduled: notifications.scheduled,
    cancelled: notifications.cancelled,
    persistedRevision: persisted.revision,
  };
}

async function runAfterReload(expected: BeforeReloadEvidence): Promise<AfterReloadEvidence> {
  const clock = new ControllableClock(new Date("2026-07-23T02:00:00.000Z"));
  const currentNotifications = new RecordingNotifications();
  const currentRepository = new IndexedDbStateRepository({ databaseName: DATABASE_NAME });
  const currentService = await createService(currentRepository, currentNotifications, clock);
  const world = currentService.worldProjection();
  const projected = world.projects.find((candidate) => candidate.project.id === expected.projectId);
  assert(projected?.building.completionBasisPoints === 2500, "building completion did not survive page reload");
  assert(projected.building.conditionBasisPoints === 10000, "building condition did not survive page reload");
  const restoredState = currentService.snapshot();
  assert(restoredState.progressReports.length === 1, "progress report did not survive page reload");
  assert(restoredState.focusHistory.some((session) => session.id === expected.completedSessionId && session.status === "completed"), "completed session did not survive page reload");

  const staleRepository = new IndexedDbStateRepository({ databaseName: DATABASE_NAME });
  const staleService = await createService(staleRepository, new RecordingNotifications(), clock);
  const completedBefore = restoredState.focusHistory.filter((session) => session.status === "completed").length;

  const started = await currentService.dispatch({
    type: "StartFocus",
    subtaskId: expected.subtaskIds[1],
    plannedDurationMs: FOCUS_DURATION_MS,
  });
  assert(started.ok && started.state.activeFocusSession !== null, "second focus start failed");
  const cancelled = await currentService.dispatch({ type: "CancelFocus" });
  assert(cancelled.ok, "second focus cancel failed");
  const completedAfter = cancelled.state.focusHistory.filter((session) => session.status === "completed").length;
  const interrupted = cancelled.state.focusHistory.filter((session) => session.status === "interrupted").length;
  assert(completedAfter === completedBefore, "cancelled focus must not increase completed Pomodoros");
  assert(interrupted === 1, "cancelled focus must append one interrupted session");
  const goal = cancelled.state.dailyGoals.find((candidate) => candidate.date === "2026-07-23");
  assert(goal?.reachedAt === expected.goalReachedAt, "cancellation must not alter the reached daily goal fact");

  let staleRejected = false;
  let staleError = "";
  let staleCause = "";
  try {
    await staleService.dispatch({ type: "RenameSubtask", subtaskId: expected.subtaskIds[0], title: "Stale overwrite" });
  } catch (error) {
    staleRejected = error instanceof ApplicationPersistenceError;
    staleError = error instanceof Error ? error.name : String(error);
    staleCause = error instanceof ApplicationPersistenceError && error.cause instanceof Error ? error.cause.name : "";
    assert(error instanceof ApplicationPersistenceError && error.cause instanceof StorageConflictError, "stale write must expose the storage conflict through the application boundary");
  }
  assert(staleRejected, "stale service write must be rejected");
  const final = await currentRepository.load();
  assert(final.state !== null, "final aggregate is missing");
  const finalProject = final.state.projects.find((candidate) => candidate.id === expected.projectId);
  const finalSubtask = finalProject?.subtasks.find((candidate) => candidate.id === expected.subtaskIds[0]);
  assert(finalSubtask?.title === "Domain loop", "stale write overwrote the current aggregate");

  staleRepository.close();
  currentRepository.close();
  return {
    persistedCompletionBasisPoints: projected.building.completionBasisPoints,
    persistedConditionBasisPoints: projected.building.conditionBasisPoints,
    completedPomodorosBeforeCancel: completedBefore,
    completedPomodorosAfterCancel: completedAfter,
    interruptedSessions: interrupted,
    goalReachedAt: goal.reachedAt,
    staleWrite: { rejected: staleRejected, error: staleError, cause: staleCause },
    titleAfterConflict: finalSubtask.title,
    finalRevision: final.revision,
  };
}

declare global {
  interface Window {
    tomatoClockHarness: {
      runBeforeReload(): Promise<BeforeReloadEvidence>;
      runAfterReload(expected: BeforeReloadEvidence): Promise<AfterReloadEvidence>;
    };
  }
}

window.tomatoClockHarness = { runBeforeReload, runAfterReload };
