import {
  createInitialState,
  execute,
  type DomainCommand,
  type DomainEvent,
  type DomainState,
} from "@tomato-clock/domain";
import type { ApplicationCommand, ApplicationResult, ApplicationWarning } from "./model.js";
import { projectAchievements, type AchievementProgress } from './achievements.js';
import {
  projectActiveState,
  projectWorldState,
  type ActiveProjectProjection,
  type WorldProjection,
} from "./model.js";
import type {
  BackupImportPreview,
  BackupRepository,
  BreakCompletionNotification,
  Clock,
  FocusCompletionNotification,
  FocusLifecycleEvent,
  IdGenerator,
  NotificationCapability,
  NotificationPort,
  RollbackBackupSummary,
  StateRepository,
} from "./ports.js";

export interface ApplicationDependencies {
  repository: StateRepository;
  /** The same persistence implementation, when it supports complete-state backup operations. */
  backupRepository?: BackupRepository;
  notifications: NotificationPort;
  clock: Clock;
  ids: IdGenerator;
  initialTimeZone?: string;
  initialRestWeekdays?: number[];
}

export class ApplicationPersistenceError extends Error {
  override readonly name = "ApplicationPersistenceError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class ApplicationService {
  private state: DomainState;
  private revision: number;
  private tail: Promise<void> = Promise.resolve();
  /** Bumped on every adopted state so render-phase projections can be cached per epoch. */
  private stateEpoch = 0;
  private snapshotCache: { epoch: number; value: DomainState } | null = null;
  private worldProjectionCache: { epoch: number; value: WorldProjection } | null = null;
  private activeProjectionCache: { epoch: number; value: ActiveProjectProjection | null } | null = null;
  private achievementsCache: readonly AchievementProgress[] | null = null;
  private readonly committedObservers = new Set<(event: { replacement: boolean; breakEndsAt?: string | null }) => void>();

  /** Read-only post-adoption signal. Observer failures never affect a saved command. */
  subscribeCommitted(observer: (event: { replacement: boolean; breakEndsAt?: string | null }) => void): () => void {
    this.committedObservers.add(observer);
    return () => { this.committedObservers.delete(observer); };
  }

  private signalCommitted(event: { replacement: boolean; breakEndsAt?: string | null }): void {
    for (const observer of this.committedObservers) {
      try { observer(event); } catch { /* A read-only integration cannot fail the command. */ }
    }
  }

  private constructor(private readonly dependencies: ApplicationDependencies, initialState: DomainState, revision: number) {
    this.state = initialState;
    this.revision = revision;
  }

  static async initialize(dependencies: ApplicationDependencies): Promise<ApplicationService> {
    const loaded = await dependencies.repository.load();
    const state = loaded.state ?? createInitialState(
      dependencies.initialTimeZone ?? "UTC",
      dependencies.initialRestWeekdays ?? [0, 6],
    );
    const revision = loaded.state === null
      ? await saveOrThrow(dependencies.repository, state, loaded.revision)
      : loaded.revision;
    return new ApplicationService(dependencies, state, revision);
  }

  snapshot(): DomainState {
    const cached = this.snapshotCache;
    if (cached !== null && cached.epoch === this.stateEpoch) return cached.value;
    const value = structuredClone(this.state);
    this.snapshotCache = { epoch: this.stateEpoch, value };
    return value;
  }

  activeProjectProjection(): ActiveProjectProjection | null {
    const cached = this.activeProjectionCache;
    if (cached !== null && cached.epoch === this.stateEpoch) return cached.value;
    const value = projectActiveState(this.state);
    this.activeProjectionCache = { epoch: this.stateEpoch, value };
    return value;
  }

  worldProjection(): WorldProjection {
    const cached = this.worldProjectionCache;
    if (cached !== null && cached.epoch === this.stateEpoch) return cached.value;
    const value = projectWorldState(this.state);
    this.worldProjectionCache = { epoch: this.stateEpoch, value };
    return value;
  }

  achievementsProjection(): readonly AchievementProgress[] {
    return this.achievementsCache ??= projectAchievements(this.state);
  }

  /** Monotonic persistence revision for cheap lifecycle adoption checks. */
  stateRevision(): number {
    return this.revision;
  }

  notificationCapability(): Promise<NotificationCapability> {
    return this.dependencies.notifications.refreshCapability();
  }

  dispatch(command: ApplicationCommand): Promise<ApplicationResult> {
    return this.serial(() => this.dispatchInternal(materialize(command, this.dependencies.ids), "user"));
  }

  /**
   * Starts one previously reserved automatic round at its absolute schedule
   * instant. The round-plan contract must persist the matching reservation
   * before calling this method. A matching active/history session makes retries
   * idempotent; an elapsed scheduled round is completed immediately on recovery.
   */
  startScheduledFocus(
    command: Extract<ApplicationCommand, { type: "StartFocus" }>,
    reservation: { sessionId: string; scheduledAt: string },
  ): Promise<ApplicationResult> {
    return this.serial(async () => {
      const scheduledAtMs = Date.parse(reservation.scheduledAt);
      if (!command.projectId?.trim() || command.projectId.length > 256
        || !reservation.sessionId.trim() || reservation.sessionId.length > 256
        || !Number.isFinite(scheduledAtMs) || new Date(scheduledAtMs).toISOString() !== reservation.scheduledAt
        || scheduledAtMs > nowMs(this.dependencies.clock)) {
        return {
          ok: false,
          state: this.snapshot(),
          code: "INVALID_INPUT",
          message: "Scheduled focus needs an explicit project, a reserved session ID, and a valid elapsed absolute start time",
          warnings: [],
        };
      }

      const staleSessionId = this.state.activeFocusSession?.id ?? null;
      const loaded = await this.loadCurrentSnapshot();
      if (loaded.state === null) return this.resetMissingState(staleSessionId, loaded.revision);
      this.adoptIfChanged(loaded.state, loaded.revision);

      const requestedProjectId = command.projectId;
      const existing = this.state.activeFocusSession?.id === reservation.sessionId
        ? this.state.activeFocusSession
        : this.state.focusHistory.find(session => session.id === reservation.sessionId);
      if (existing) {
        const sameScheduledRound = existing.projectId === requestedProjectId
          && existing.subtaskId === command.subtaskId
          && existing.startedAt === reservation.scheduledAt
          && existing.plannedDurationMs === command.plannedDurationMs
          && existing.marathon === command.marathon
          && existing.deferredSettlement === command.deferredSettlement;
        if (!sameScheduledRound) {
          return { ok: false, state: this.snapshot(), code: "DUPLICATE_ID", message: "Reserved focus session ID belongs to a different round", warnings: [] };
        }
        if (this.state.activeFocusSession?.id === reservation.sessionId
          && Date.parse(this.state.activeFocusSession.endsAt) <= nowMs(this.dependencies.clock)) {
          return this.resumeInternal();
        }
        return success(this.state, [], []);
      }

      const started = await this.dispatchInternal(
        materialize(command, this.dependencies.ids, reservation.sessionId),
        "recovery",
        { now: () => new Date(scheduledAtMs) },
      );
      if (!started.ok) return started;
      const active = started.state.activeFocusSession;
      if (active?.id === reservation.sessionId && Date.parse(active.endsAt) <= nowMs(this.dependencies.clock)) {
        return combineSuccessfulResults(started, await this.resumeInternal(), []);
      }
      return started;
    });
  }

  scheduleBreakCompletion(notification: BreakCompletionNotification): Promise<ApplicationWarning[]> {
    return this.serial(async () => {
      if (Date.parse(notification.endsAt) <= nowMs(this.dependencies.clock) && notification.deadlineReached !== true) {
        return this.cancelBreakCompletionInternal();
      }
      this.signalCommitted({ replacement: false, breakEndsAt: notification.endsAt });
      const warnings: ApplicationWarning[] = [];
      let capability: NotificationCapability;
      try {
        capability = await this.dependencies.notifications.refreshCapability();
      } catch (cause) {
        return [warning("NOTIFICATION_CAPABILITY_REFRESH_FAILED", "Could not determine break notification capability", cause)];
      }
      if (!capability.canSchedule) {
        return [warning("NOTIFICATION_PERMISSION_DENIED", "Break continues, but its completion notification is unavailable")];
      }
      if (capability.precision === "inexact") {
        warnings.push(warning("NOTIFICATION_INEXACT", "Break notification may be delayed because exact alarms are unavailable"));
      }
      try {
        await this.dependencies.notifications.scheduleBreakCompletion(notification);
      } catch (cause) {
        warnings.push(warning("NOTIFICATION_SCHEDULE_FAILED", "Break continues, but its completion notification could not be scheduled", cause));
      }
      return warnings;
    });
  }

  cancelBreakCompletion(): Promise<ApplicationWarning[]> {
    return this.serial(() => this.cancelBreakCompletionInternal());
  }

  handleLifecycleEvent(event: FocusLifecycleEvent): Promise<ApplicationResult> {
    return this.serial(() => {
      if (event.type === "foreground") return this.resumeInternal();
      // V22 follow-up: a stop while the activity is in a multi-window surface
      // (split screen, OEM floating window) still counts as an app switch —
      // the timer is meant to be watched, not parked in a side window. The
      // domain layer deduplicates repeated background signals for one session.
      const reason = event.context?.exempt
        ? "system-exempt"
        : event.context?.locked || event.context?.screenOff
          ? "screen-lock"
          : event.source === "web" ? "web-visibility" : "app-switch";
      const observedAt = this.dependencies.clock.now();
      const eventAt = event.context?.backgroundedAtEpochMs;
      const startedAt = this.state.activeFocusSession === null ? Number.NEGATIVE_INFINITY : Date.parse(this.state.activeFocusSession.startedAt);
      const useEventTime = Number.isFinite(eventAt) && eventAt! >= startedAt && eventAt! <= observedAt.getTime();
      const eventClock: Clock = useEventTime ? { now: () => new Date(eventAt!) } : this.dependencies.clock;
      return this.dispatchInternal({ type: "RecordFocusBackgrounded", reason }, "recovery", eventClock);
    });
  }

  exportBackup(): Promise<string> {
    return this.serial(async () => this.backups().exportBackup());
  }

  previewImport(input: string): Promise<BackupImportPreview> {
    return this.serial(async () => this.backups().previewImport(input));
  }

  replaceFromImport(input: string): Promise<ApplicationResult> {
    return this.serial(async () => {
      const staleSessionId = this.state.activeFocusSession?.id ?? null;
      await this.backups().replaceFromImport(input, this.revision);
      return this.synchronizeAfterReplacement(staleSessionId);
    });
  }

  listRollbackBackups(): Promise<RollbackBackupSummary[]> {
    return this.serial(async () => this.backups().listRollbackBackups());
  }

  restoreRollback(backupId: string): Promise<ApplicationResult> {
    return this.serial(async () => {
      const staleSessionId = this.state.activeFocusSession?.id ?? null;
      await this.backups().restoreRollback(backupId, this.revision);
      return this.synchronizeAfterReplacement(staleSessionId);
    });
  }

  /** Reconciles persisted timer truth after foreground activation or process recreation. */
  resume(): Promise<ApplicationResult> {
    return this.serial(() => this.resumeInternal());
  }

  private async resumeInternal(): Promise<ApplicationResult> {
      const staleSessionId = this.state.activeFocusSession?.id ?? null;
      const loaded = await this.loadCurrentSnapshot();
      if (loaded.state === null) {
        return this.resetMissingState(staleSessionId, loaded.revision);
      }

      // A native foreground callback often arrives with the exact state and
      // revision already held by this service. Re-adopting that clone bumps
      // the projection epoch and wakes renderer subscribers even though no
      // persisted fact changed (the notification shade path is especially
      // sensitive to that duplicate work).
      this.adoptIfChanged(loaded.state, loaded.revision);
      const active = loaded.state.activeFocusSession;
      const warnings = staleSessionId !== null && staleSessionId !== active?.id
        ? await this.cancelStaleNotification(staleSessionId)
        : [];
      if (active === null) {
        return success(loaded.state, [], warnings);
      }

      if (nowMs(this.dependencies.clock) >= Date.parse(active.endsAt)) {
        return mergeWarnings(await this.dispatchInternal({ type: "CompleteFocus" }, "recovery"), warnings);
      }
      if (active.integrity.backgroundedAt !== null) {
        const reconciled = await this.dispatchInternal({ type: "RecordFocusForegrounded" }, "recovery");
        if (!reconciled.ok || reconciled.state.activeFocusSession === null) return mergeWarnings(reconciled, warnings);
        return combineSuccessfulResults(reconciled, await this.resumeInternal(), warnings);
      }

      let capability: NotificationCapability | null = null;
      try {
        capability = await this.dependencies.notifications.refreshCapability();
      } catch (cause) {
        warnings.push(warning("NOTIFICATION_CAPABILITY_REFRESH_FAILED", "Could not refresh notification capability", cause));
      }

      const afterRefresh = await this.reloadExpectedSession(active, warnings);
      if (afterRefresh.result) return afterRefresh.result;
      const refreshedActive = afterRefresh.active;
      if (nowMs(this.dependencies.clock) >= Date.parse(refreshedActive.endsAt)) {
        return mergeWarnings(await this.dispatchInternal({ type: "CompleteFocus" }, "recovery"), warnings);
      }

      if (capability === null) return success(this.state, [], warnings);
      if (!capability.canSchedule) {
        warnings.push(warning("NOTIFICATION_PERMISSION_DENIED", "Focus continues, but completion notifications are unavailable"));
        return success(this.state, [], warnings);
      }
      if (capability.precision === "inexact") {
        warnings.push(warning("NOTIFICATION_INEXACT", "Focus completion notification may be delayed because exact alarms are unavailable"));
      }

      try {
        await this.dependencies.notifications.scheduleFocusCompletion(focusCompletionNotification(this.state, refreshedActive));
      } catch (cause) {
        warnings.push(warning("NOTIFICATION_SCHEDULE_FAILED", "Focus was restored, but its completion notification could not be scheduled", cause));
      }

      const afterSchedule = await this.reloadExpectedSession(refreshedActive, warnings);
      if (afterSchedule.result) return afterSchedule.result;
      if (nowMs(this.dependencies.clock) >= Date.parse(afterSchedule.active.endsAt)) {
        return mergeWarnings(await this.dispatchInternal({ type: "CompleteFocus" }, "recovery"), warnings);
      }
      return success(this.state, [], warnings);
  }

  private async reloadExpectedSession(
    expectedSession: NonNullable<DomainState["activeFocusSession"]>,
    priorWarnings: ApplicationWarning[],
  ): Promise<{ active: NonNullable<DomainState["activeFocusSession"]>; result?: never } | { active?: never; result: ApplicationResult }> {
    const loaded = await this.loadCurrentSnapshot();
    if (loaded.state === null) {
      return { result: mergeWarnings(await this.resetMissingState(expectedSession.id, loaded.revision), priorWarnings) };
    }

    this.adoptIfChanged(loaded.state, loaded.revision);
    if (loaded.state.activeFocusSession?.id === expectedSession.id && loaded.state.activeFocusSession.endsAt === expectedSession.endsAt) {
      return { active: loaded.state.activeFocusSession };
    }
    const cancelWarnings = await this.cancelStaleNotification(expectedSession.id);
    return { result: success(loaded.state, [], [...priorWarnings, ...cancelWarnings]) };
  }

  private async loadCurrentSnapshot() {
    const repository = this.dependencies.repository;
    if (!repository.loadIfChanged) return repository.load();
    return await repository.loadIfChanged(this.revision)
      ?? { state: this.state, revision: this.revision };
  }

  private async resetMissingState(staleSessionId: string | null, expectedRevision: number): Promise<ApplicationResult> {
    const initial = createInitialState(
      this.dependencies.initialTimeZone ?? "UTC",
      this.dependencies.initialRestWeekdays ?? [0, 6],
    );
    const committedRevision = await saveOrThrow(this.dependencies.repository, initial, expectedRevision);
    this.adopt(initial, committedRevision, true);
    const warnings = staleSessionId === null ? [] : await this.cancelStaleNotification(staleSessionId);
    return success(initial, [], warnings);
  }

  private async cancelStaleNotification(sessionId: string): Promise<ApplicationWarning[]> {
    try {
      await this.dependencies.notifications.cancelFocusCompletion(sessionId);
      return [];
    } catch (cause) {
      return [warning("NOTIFICATION_CANCEL_FAILED", "Persisted timer truth changed, but its stale notification could not be cancelled", cause)];
    }
  }

  private async cancelBreakCompletionInternal(): Promise<ApplicationWarning[]> {
    this.signalCommitted({ replacement: false, breakEndsAt: null });
    try {
      await this.dependencies.notifications.cancelBreakCompletion();
      return [];
    } catch (cause) {
      return [warning("NOTIFICATION_CANCEL_FAILED", "The stale break notification could not be cancelled", cause)];
    }
  }

  private adopt(state: DomainState, revision: number, replacement = false): void {
    this.state = state;
    this.revision = revision;
    this.stateEpoch += 1;
    this.snapshotCache = null;
    this.worldProjectionCache = null;
    this.activeProjectionCache = null;
    this.achievementsCache = null;
    this.signalCommitted({ replacement });
  }

  private adoptIfChanged(state: DomainState, revision: number, replacement = false): boolean {
    if (revision === this.revision) return false;
    this.adopt(state, revision, replacement);
    return true;
  }

  private async dispatchInternal(command: DomainCommand, origin: "user" | "recovery", clock: Clock = this.dependencies.clock): Promise<ApplicationResult> {
    const result = execute(this.state, command, clock);
    if (!result.ok) {
      return { ok: false, state: structuredClone(result.state), code: result.code, message: result.message, warnings: [] };
    }

    // Native attention callbacks can report the same physical transition more
    // than once. A lifecycle no-op must not write the cloned aggregate, bump
    // the epoch, or notify renderer consumers; a real foreground reconciliation
    // that merely clears the pending background still differs and is saved.
    if (origin === "recovery" && result.events.length === 0 && sameRecoveryFacts(this.state, result.state)) {
      return success(this.state, [], []);
    }

    const deleted = result.events.find((event) => event.type === "ProjectDeleted");
    const committedRevision = deleted
      ? await this.saveDeleteWithRollback(result.state, deleted.projectId)
      : await saveOrThrow(this.dependencies.repository, result.state, this.revision);
    this.adopt(result.state, committedRevision);
    const warnings = await this.runNotificationEffects(result.events, origin);
    return success(result.state, result.events, warnings);
  }

  private async saveDeleteWithRollback(state: DomainState, projectId: string): Promise<number> {
    try {
      const committed = await this.backups().saveWithRollback(state, this.revision, {
        type: "before-delete-active-project",
        projectId,
      });
      return committed.revision;
    } catch (cause) {
      throw new ApplicationPersistenceError("Could not atomically save project deletion and rollback", { cause });
    }
  }

  private async synchronizeAfterReplacement(staleSessionId: string | null): Promise<ApplicationResult> {
    const loaded = await this.dependencies.repository.load();
    if (loaded.state === null) return this.resetMissingState(staleSessionId, loaded.revision);
    this.adopt(loaded.state, loaded.revision, true);
    const warnings = staleSessionId !== null && staleSessionId !== loaded.state.activeFocusSession?.id
      ? await this.cancelStaleNotification(staleSessionId)
      : [];
    return mergeWarnings(await this.resumeInternal(), warnings);
  }

  private backups(): BackupRepository {
    if (!this.dependencies.backupRepository) {
      throw new ApplicationPersistenceError("This installation does not support local backup operations");
    }
    return this.dependencies.backupRepository;
  }

  private async runNotificationEffects(events: DomainEvent[], origin: "user" | "recovery"): Promise<ApplicationWarning[]> {
    const warnings: ApplicationWarning[] = [];
    for (const event of events) {
      if (event.type === "FocusStarted") {
        const active = this.state.activeFocusSession;
        if (!active || active.id !== event.sessionId) continue;
        if (origin === "recovery" && Date.parse(active.endsAt) <= nowMs(this.dependencies.clock)) continue;
        let capability: NotificationCapability;
        try {
          capability = origin === "user"
            ? await this.dependencies.notifications.requestPermission()
            : await this.dependencies.notifications.refreshCapability();
        } catch (cause) {
          warnings.push(origin === "user"
            ? warning("NOTIFICATION_PERMISSION_REQUEST_FAILED", "Focus started, but notification permission could not be requested", cause)
            : warning("NOTIFICATION_CAPABILITY_REFRESH_FAILED", "Could not determine notification capability", cause));
          continue;
        }
        if (!capability.canSchedule) {
          warnings.push(warning("NOTIFICATION_PERMISSION_DENIED", "Focus started, but completion notifications are unavailable"));
          continue;
        }
        if (capability.precision === "inexact") {
          warnings.push(warning("NOTIFICATION_INEXACT", "Focus completion notification may be delayed because exact alarms are unavailable"));
        }
        try {
          await this.dependencies.notifications.scheduleFocusCompletion(focusCompletionNotification(this.state, active));
        } catch (cause) {
          warnings.push(warning("NOTIFICATION_SCHEDULE_FAILED", "Focus started, but its completion notification could not be scheduled", cause));
        }
      } else if (event.type === "FocusCompleted" || event.type === "FocusCompletedEarly" || event.type === "FocusInterrupted") {
        try {
          await this.dependencies.notifications.cancelFocusCompletion(event.sessionId);
        } catch (cause) {
          warnings.push(warning("NOTIFICATION_CANCEL_FAILED", "Timer state was saved, but its completion notification could not be cancelled", cause));
        }
      }
    }
    return warnings;
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function focusCompletionNotification(
  state: DomainState,
  active: NonNullable<DomainState["activeFocusSession"]>,
): FocusCompletionNotification {
  const project = state.projects.find((candidate) => candidate.id === active.projectId);
  const projectTitle = active.deferredSettlement === true ? "极简专注" : project?.title;
  const taskTitle = active.deferredSettlement === true
    ? "本场专注 · 结束后统一汇报"
    : project?.kind === "habit"
    ? `第 ${project.habit?.cycleNumber ?? 1} 座习惯建筑`
    : active.marathon === true
      ? "本场专注 · 结束后统一汇报"
      : project?.subtasks.find((candidate) => candidate.id === active.subtaskId)?.title;
  return {
    sessionId: active.id,
    endsAt: active.endsAt,
    ...(projectTitle ? { projectTitle } : {}),
    ...(taskTitle ? { taskTitle } : {}),
    ...(active.marathon === true ? { marathon: true } : {}),
  };
}

function materialize(command: ApplicationCommand, ids: IdGenerator, reservedSessionId?: string): DomainCommand {
  switch (command.type) {
    case "CreateProject":
      return {
        ...command,
        projectId: ids.next("project"),
        subtasks: command.subtasks.map((subtask) => ({ ...subtask, id: ids.next("subtask") })),
      };
    case "CreateHabitProject":
      return { ...command, projectId: ids.next("project") };
    case "AddSubtask":
      return { ...command, subtaskId: ids.next("subtask") };
    case "StartFocus":
      return { ...command, sessionId: reservedSessionId ?? ids.next("focus-session") };
    case "ReportSubtaskProgress":
      return { ...command, reportId: ids.next("progress-report") };
    case "ReportMarathonFocus":
      return { ...command, entries: command.entries.map((entry) => ({ ...entry, reportId: ids.next("progress-report") })) };
    case "CompleteFocusEarly":
      return { ...command, reportId: ids.next("progress-report") };
    default:
      return command;
  }
}

async function saveOrThrow(repository: StateRepository, state: DomainState, expectedRevision: number): Promise<number> {
  try {
    return await repository.save(state, expectedRevision);
  } catch (cause) {
    throw new ApplicationPersistenceError("Could not atomically save application state", { cause });
  }
}

function success(state: DomainState, events: DomainEvent[], warnings: ApplicationWarning[]): ApplicationResult {
  return { ok: true, state: structuredClone(state), events: structuredClone(events), warnings };
}

function warning(code: ApplicationWarning["code"], message: string, cause?: unknown): ApplicationWarning {
  return cause === undefined ? { code, message } : { code, message, cause };
}

function mergeWarnings(result: ApplicationResult, warnings: ApplicationWarning[]): ApplicationResult {
  if (!result.ok || warnings.length === 0) return result;
  return { ...result, warnings: [...warnings, ...result.warnings] };
}

function combineSuccessfulResults(first: ApplicationResult, second: ApplicationResult, priorWarnings: ApplicationWarning[]): ApplicationResult {
  if (!first.ok) return mergeWarnings(first, priorWarnings);
  if (!second.ok) return second;
  return {
    ok: true,
    state: second.state,
    events: [...first.events, ...second.events],
    warnings: [...priorWarnings, ...first.warnings, ...second.warnings],
  };
}

function sameRecoveryFacts(left: DomainState, right: DomainState): boolean {
  // A recovery command may be eventless while the aggregate still changes a
  // non-active fact (for example a daily/decay value loaded by a newer
  // revision). Comparing only activeFocusSession silently discarded that
  // state. The full validated aggregate is the only proof this command is a
  // no-op; the JSON shape is deterministic because execute() clones it.
  return JSON.stringify(left) === JSON.stringify(right);
}

function nowMs(clock: Clock): number {
  const value = clock.now().getTime();
  if (!Number.isFinite(value)) throw new Error("Clock returned an invalid date");
  return value;
}
