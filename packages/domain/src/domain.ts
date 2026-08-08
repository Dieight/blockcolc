import {
  assertISODate,
  assertValidTimeZone,
  countPlannedFocusDaysAfter,
  localDateOf,
} from "./calendar.js";
import { parseDecorationBlueprint, parseImportedBlueprint } from "./validation.js";
import { FOCUS_INTEGRITY_GRACE_MS } from "./model.js";
import type {
  Clock,
  CommandResult,
  DomainCommand,
  DomainErrorCode,
  DomainEvent,
  DomainState,
  FocusSession,
  FocusSessionBase,
  ImportedBlueprintV1,
  Project,
  ProjectCondition,
} from "./model.js";

export function createInitialState(timeZone = "UTC", restWeekdays: number[] = [0, 6]): DomainState {
  assertCalendar(timeZone, restWeekdays);
  return {
    schemaVersion: 6,
    projects: [],
    habitBuildings: [],
    activeProjectId: null,
    retiredSubtaskIds: [],
    activeFocusSession: null,
    focusHistory: [],
    progressReports: [],
    dailyGoals: [],
    calendar: { timeZone, restWeekdays: [...restWeekdays].sort() },
    decayPolicy: {
      enabled: false,
      gracePlannedDays: 2,
      repairMultiplierBasisPoints: 20_000,
      damagePerMissedPlannedDayBasisPoints: null,
    },
    projectConditions: [],
    focusIntegrityPolicy: { enabled: true, maxEffectiveExcursions: 3 },
    decorationBlueprintResources: [],
    decorationRewards: [],
    buildingBlueprintResources: [],
    worldSettings: { worldSeed: "world-default", terrainGenerationVersion: 2, environmentStyle: "natural-valley" },
  };
}

export function execute(state: DomainState, command: DomainCommand, clock: Clock): CommandResult {
  try {
    const result = handle(structuredClone(state), command, clock);
    return result.ok ? result : { ...result, state };
  } catch (error) {
    if (isDomainException(error)) return fail(state, error.domainCode, error.message);
    return fail(state, "INVALID_INPUT", error instanceof Error ? error.message : "Invalid input");
  }
}

export function projectProgressBasisPoints(project: Project): number {
  if (project.kind === "habit") {
    const habit = requireHabit(project);
    if (habit.awaitingNextBuilding) return 10_000;
    return Math.floor((habit.completedFocusSessionIds.length * 10_000) / habit.targetRounds);
  }
  if (project.subtasks.length === 0) return 0;
  return Math.floor(project.subtasks.reduce((sum, item) => sum + item.progressBasisPoints, 0) / project.subtasks.length);
}

export function completedPomodorosOn(state: DomainState, date: string): number {
  assertISODate(date);
  return state.focusHistory.filter((session) => session.status === "completed" && session.completedLocalDate === date).length;
}

function handle(state: DomainState, command: DomainCommand, clock: Clock): CommandResult {
  const now = validNow(clock).toISOString();
  switch (command.type) {
    case "CreateProject": {
      if (state.activeFocusSession !== null) return fail(state, "ACTIVE_FOCUS_PREVENTS_PROJECT_SWITCH", "Cancel or complete active focus before creating another project");
      if (activeProjectHasUnreportedFocus(state)) return fail(state, "UNREPORTED_FOCUS_PREVENTS_PROJECT_SWITCH", "Report completed focus progress before creating another project");
      requireNonBlank(command.projectId, "projectId");
      requireNonBlank(command.title, "title");
      requireNonBlank(command.blueprintId, "blueprintId");
      const importedBlueprint = command.importedBlueprint == null ? null : parseImportedBlueprint(command.importedBlueprint, "$.command.importedBlueprint");
      if (importedBlueprint !== null && importedBlueprint.id !== command.blueprintId) throw new Error("Imported blueprint ID must match blueprintId");
      if (state.projects.some((item) => item.id === command.projectId)) return fail(state, "DUPLICATE_ID", "Project ID already exists");
      if (command.subtasks.length === 0) throw new Error("At least one subtask is required");
      const ids = command.subtasks.map((item) => item.id);
      if (new Set(ids).size !== ids.length) return fail(state, "DUPLICATE_ID", "Subtask IDs must be unique");
      const unavailableIds = allKnownSubtaskIds(state);
      for (const item of command.subtasks) {
        requireNonBlank(item.id, "subtaskId");
        requireNonBlank(item.title, "subtask title");
        if (unavailableIds.has(item.id)) return fail(state, "DUPLICATE_ID", "Subtask ID was already used");
      }
      const project: Project = {
        id: command.projectId,
        title: command.title.trim(),
        kind: "finite",
        settlementIndex: nextSettlementIndex(state),
        blueprintId: command.blueprintId,
        importedBlueprint,
        createdAt: now,
        status: "active",
        subtaskStructureLocked: false,
        subtasks: command.subtasks.map((item, order) => ({ id: item.id, title: item.title.trim(), order, progressBasisPoints: 0 })),
        habit: null,
      };
      if (state.projects.length === 0 && state.worldSettings.worldSeed === "world-default") {
        state.worldSettings.worldSeed = `world-${project.id}`;
      }
      state.projects.push(project);
      const events: DomainEvent[] = [];
      if (state.activeProjectId !== null) {
        const previous = activeProject(state);
        previous.status = "paused";
        events.push({ type: "ProjectPaused", projectId: previous.id });
      }
      state.activeProjectId = project.id;
      state.projectConditions.push({
        projectId: project.id,
        conditionBasisPoints: 10_000,
        inactivityAnchorAt: state.decayPolicy.enabled ? now : null,
        assessedMissedPlannedDays: 0,
      });
      events.push({ type: "ProjectCreated", projectId: project.id });
      return ok(state, events);
    }
    case "CreateHabitProject": {
      if (state.activeFocusSession !== null) return fail(state, "ACTIVE_FOCUS_PREVENTS_PROJECT_SWITCH", "Cancel or complete active focus before creating another project");
      if (activeProjectHasUnreportedFocus(state)) return fail(state, "UNREPORTED_FOCUS_PREVENTS_PROJECT_SWITCH", "Report completed focus progress before creating another project");
      requireNonBlank(command.projectId, "projectId");
      requireNonBlank(command.title, "title");
      requireNonBlank(command.blueprintId, "blueprintId");
      requireHabitTargetRounds(command.targetRounds);
      const importedBlueprint = command.importedBlueprint == null ? null : parseImportedBlueprint(command.importedBlueprint, "$.command.importedBlueprint");
      if (importedBlueprint !== null && importedBlueprint.id !== command.blueprintId) throw new Error("Imported blueprint ID must match blueprintId");
      if (state.projects.some((item) => item.id === command.projectId)) return fail(state, "DUPLICATE_ID", "Project ID already exists");
      const project: Project = {
        id: command.projectId,
        title: command.title.trim(),
        kind: "habit",
        settlementIndex: nextSettlementIndex(state),
        blueprintId: command.blueprintId,
        importedBlueprint,
        createdAt: now,
        status: "active",
        subtaskStructureLocked: true,
        subtasks: [],
        habit: { cycleNumber: 1, targetRounds: command.targetRounds, completedFocusSessionIds: [], awaitingNextBuilding: false },
      };
      if (state.projects.length === 0 && state.worldSettings.worldSeed === "world-default") {
        state.worldSettings.worldSeed = `world-${project.id}`;
      }
      state.projects.push(project);
      const events: DomainEvent[] = [];
      if (state.activeProjectId !== null) {
        const previous = activeProject(state);
        previous.status = "paused";
        events.push({ type: "ProjectPaused", projectId: previous.id });
      }
      state.activeProjectId = project.id;
      state.projectConditions.push({
        projectId: project.id,
        conditionBasisPoints: 10_000,
        inactivityAnchorAt: state.decayPolicy.enabled ? now : null,
        assessedMissedPlannedDays: 0,
      });
      events.push({ type: "ProjectCreated", projectId: project.id });
      events.push({ type: "HabitBuildingSelected", projectId: project.id, cycleNumber: 1, targetRounds: command.targetRounds });
      return ok(state, events);
    }
    case "SelectNextHabitBuilding": {
      const project = activeProject(state);
      const habit = requireHabit(project);
      if (!habit.awaitingNextBuilding) throw new Error("The current habit building must be completed before selecting another");
      if (state.activeFocusSession !== null) return fail(state, "FOCUS_ALREADY_ACTIVE", "A focus session is already active");
      requireNonBlank(command.blueprintId, "blueprintId");
      requireHabitTargetRounds(command.targetRounds);
      const importedBlueprint = command.importedBlueprint == null ? null : parseImportedBlueprint(command.importedBlueprint, "$.command.importedBlueprint");
      if (importedBlueprint !== null && importedBlueprint.id !== command.blueprintId) throw new Error("Imported blueprint ID must match blueprintId");
      project.blueprintId = command.blueprintId;
      project.importedBlueprint = importedBlueprint;
      habit.targetRounds = command.targetRounds;
      habit.completedFocusSessionIds = [];
      habit.awaitingNextBuilding = false;
      const runtime = projectCondition(state, project.id);
      runtime.conditionBasisPoints = 10_000;
      runtime.inactivityAnchorAt = state.decayPolicy.enabled ? now : null;
      runtime.assessedMissedPlannedDays = 0;
      return ok(state, [{ type: "HabitBuildingSelected", projectId: project.id, cycleNumber: habit.cycleNumber, targetRounds: habit.targetRounds }]);
    }
    case "SwitchActiveProject": {
      requireNonBlank(command.projectId, "projectId");
      if (state.activeFocusSession !== null) return fail(state, "ACTIVE_FOCUS_PREVENTS_PROJECT_SWITCH", "Cancel or complete active focus before switching projects");
      if (activeProjectHasUnreportedFocus(state)) return fail(state, "UNREPORTED_FOCUS_PREVENTS_PROJECT_SWITCH", "Report completed focus progress before switching projects");
      const target = state.projects.find((project) => project.id === command.projectId);
      if (!target || target.status === "deleted") return fail(state, "PROJECT_NOT_FOUND", "Project does not exist");
      if (target.status === "monument") return fail(state, "PROJECT_IS_MONUMENT", "Monuments cannot become the active project");
      if (target.status === "active") return ok(state, []);
      const events: DomainEvent[] = [];
      if (state.activeProjectId !== null) {
        const previous = activeProject(state);
        previous.status = "paused";
        events.push({ type: "ProjectPaused", projectId: previous.id });
      }
      target.status = "active";
      state.activeProjectId = target.id;
      events.push({ type: "ProjectActivated", projectId: target.id });
      return ok(state, events);
    }
    case "RenameProject": {
      const project = activeProject(state);
      requireNonBlank(command.title, "title");
      project.title = command.title.trim();
      return ok(state, [{ type: "ProjectRenamed", projectId: project.id }]);
    }
    case "DeleteActiveProject": {
      const project = activeProject(state);
      if (command.projectId !== project.id) {
        return fail(state, "PROJECT_DELETE_TARGET_MISMATCH", "The active project no longer matches the confirmed deletion target");
      }
      if (state.activeFocusSession !== null) {
        return fail(state, "ACTIVE_FOCUS_PREVENTS_PROJECT_DELETION", "Cancel or complete active focus before deleting the project");
      }
      project.status = "deleted";
      state.activeProjectId = null;
      const runtime = projectCondition(state, project.id);
      runtime.inactivityAnchorAt = null;
      runtime.assessedMissedPlannedDays = 0;
      return ok(state, [{ type: "ProjectDeleted", projectId: project.id }]);
    }
    case "AddSubtask": {
      const project = activeProject(state);
      if (project.kind !== "finite") return fail(state, "SUBTASK_STRUCTURE_LOCKED", "Habit projects do not have subtasks");
      if (project.subtaskStructureLocked) return fail(state, "SUBTASK_STRUCTURE_LOCKED", "Subtask structure is locked");
      requireNonBlank(command.subtaskId, "subtaskId");
      requireNonBlank(command.title, "title");
      if (allKnownSubtaskIds(state).has(command.subtaskId)) return fail(state, "DUPLICATE_ID", "Subtask ID was already used");
      project.subtasks.push({ id: command.subtaskId, title: command.title.trim(), order: project.subtasks.length, progressBasisPoints: 0 });
      return ok(state, [{ type: "SubtaskAdded", subtaskId: command.subtaskId }]);
    }
    case "RemoveSubtask": {
      const project = activeProject(state);
      if (project.kind !== "finite") return fail(state, "SUBTASK_STRUCTURE_LOCKED", "Habit projects do not have subtasks");
      if (project.subtaskStructureLocked) return fail(state, "SUBTASK_STRUCTURE_LOCKED", "Subtask structure is locked");
      const index = project.subtasks.findIndex((item) => item.id === command.subtaskId);
      if (index < 0) return fail(state, "SUBTASK_NOT_FOUND", "Subtask does not exist");
      if (project.subtasks.length === 1) throw new Error("A project must keep at least one subtask");
      if (state.activeFocusSession?.subtaskId === command.subtaskId) return fail(state, "SUBTASK_IN_USE", "An active focus session uses this subtask");
      if (state.focusHistory.some((item) => item.subtaskId === command.subtaskId) || state.progressReports.some((item) => item.subtaskId === command.subtaskId)) {
        return fail(state, "SUBTASK_HAS_HISTORY", "A subtask with history cannot be deleted");
      }
      project.subtasks.splice(index, 1);
      state.retiredSubtaskIds.push(command.subtaskId);
      normalizeOrder(project);
      return ok(state, [{ type: "SubtaskRemoved", subtaskId: command.subtaskId }]);
    }
    case "RenameSubtask": {
      const project = activeProject(state);
      if (project.kind !== "finite") return fail(state, "SUBTASK_NOT_FOUND", "Habit projects do not have subtasks");
      requireNonBlank(command.title, "title");
      const subtask = project.subtasks.find((item) => item.id === command.subtaskId);
      if (!subtask) return fail(state, "SUBTASK_NOT_FOUND", "Subtask does not exist");
      subtask.title = command.title.trim();
      return ok(state, [{ type: "SubtaskRenamed", subtaskId: subtask.id }]);
    }
    case "ReorderSubtasks": {
      const project = activeProject(state);
      if (project.kind !== "finite") return fail(state, "SUBTASK_STRUCTURE_LOCKED", "Habit projects do not have subtasks");
      const current = new Set(project.subtasks.map((item) => item.id));
      if (command.orderedSubtaskIds.length !== current.size || new Set(command.orderedSubtaskIds).size !== current.size || command.orderedSubtaskIds.some((id) => !current.has(id))) {
        throw new Error("Reorder must contain every subtask ID exactly once");
      }
      const byId = new Map(project.subtasks.map((item) => [item.id, item]));
      project.subtasks = command.orderedSubtaskIds.map((id, order) => ({ ...byId.get(id)!, order }));
      return ok(state, [{ type: "SubtasksReordered" }]);
    }
    case "StartFocus": {
      const project = activeProject(state);
      if (state.activeFocusSession) return fail(state, "FOCUS_ALREADY_ACTIVE", "A focus session is already active");
      requireNonBlank(command.sessionId, "sessionId");
      if (state.focusHistory.some((item) => item.id === command.sessionId)) return fail(state, "DUPLICATE_ID", "Session ID already exists");
      if (project.kind === "habit") {
        if (command.subtaskId !== null) return fail(state, "SUBTASK_NOT_FOUND", "Habit focus cannot target a subtask");
        if (requireHabit(project).awaitingNextBuilding) return fail(state, "HABIT_BUILDING_SELECTION_REQUIRED", "Select the next habit building before focusing");
      } else if (command.subtaskId === null || !project.subtasks.some((item) => item.id === command.subtaskId)) {
        return fail(state, "SUBTASK_NOT_FOUND", "Subtask does not exist");
      }
      if (!Number.isInteger(command.plannedDurationMs) || command.plannedDurationMs <= 0) throw new Error("plannedDurationMs must be a positive integer");
      const endsAt = new Date(Date.parse(now) + command.plannedDurationMs).toISOString();
      state.activeFocusSession = {
        id: command.sessionId,
        projectId: project.id,
        subtaskId: command.subtaskId,
        startedAt: now,
        endsAt,
        plannedDurationMs: command.plannedDurationMs,
        timeZoneAtStart: state.calendar.timeZone,
        integrity: {
          effectiveExcursions: 0,
          backgroundedAt: null,
          backgroundReason: null,
          exemptionPending: false,
        },
      };
      return ok(state, [{ type: "FocusStarted", sessionId: command.sessionId, endsAt }]);
    }
    case "CompleteFocus": {
      const active = state.activeFocusSession;
      if (!active) return fail(state, "FOCUS_NOT_ACTIVE", "No focus session is active");
      if (Date.parse(now) < Date.parse(active.endsAt)) return fail(state, "FOCUS_NOT_ELAPSED", "Focus session has not reached its end time");
      return ok(state, completeActiveFocus(state, active));
    }
    case "CompleteFocusEarly": {
      const active = state.activeFocusSession;
      if (!active) return fail(state, "FOCUS_NOT_ACTIVE", "No focus session is active");
      if (Date.parse(now) >= Date.parse(active.endsAt)) return fail(state, "FOCUS_ALREADY_ELAPSED", "Elapsed focus must be completed normally");
      requireNonBlank(command.reportId, "reportId");
      const project = activeProject(state);
      if (project.kind === "habit") {
        const actualDurationMs = Math.max(0, Date.parse(now) - Date.parse(active.startedAt));
        const session: FocusSession = {
          ...focusSessionBase(active), status: "completed-early", completedAt: now,
          completedLocalDate: localDateOf(now, active.timeZoneAtStart), actualDurationMs,
        };
        state.focusHistory.push(session);
        state.activeFocusSession = null;
        const events: DomainEvent[] = [{ type: "FocusCompletedEarly", sessionId: session.id, subtaskId: null, actualDurationMs }];
        applyRepair(state, project.id, now, events);
        advanceHabitBuilding(state, project, session, events);
        return ok(state, events);
      }
      if (state.progressReports.some((report) => report.id === command.reportId)) return fail(state, "DUPLICATE_ID", "Progress report ID already exists");
      const subtask = project.subtasks.find((item) => item.id === active.subtaskId);
      if (!subtask) return fail(state, "SUBTASK_NOT_FOUND", "Subtask does not exist");
      const actualDurationMs = Math.max(0, Date.parse(now) - Date.parse(active.startedAt));
      const session: FocusSession = {
        ...focusSessionBase(active), status: "completed-early", completedAt: now,
        completedLocalDate: localDateOf(now, active.timeZoneAtStart), actualDurationMs,
      };
      state.focusHistory.push(session);
      state.activeFocusSession = null;
      subtask.progressBasisPoints = 10_000;
      state.progressReports.push({
        id: command.reportId, projectId: project.id, subtaskId: subtask.id,
        focusSessionIds: [session.id], progressBasisPoints: 10_000, reportedAt: now,
      });
      const events: DomainEvent[] = [
        { type: "FocusCompletedEarly", sessionId: session.id, subtaskId: subtask.id, actualDurationMs },
        { type: "SubtaskProgressReported", subtaskId: subtask.id, progressBasisPoints: 10_000 },
      ];
      if (!project.subtaskStructureLocked) {
        project.subtaskStructureLocked = true;
        events.push({ type: "SubtaskStructureLocked" });
      }
      applyRepair(state, project.id, now, events);
      if (project.subtasks.every((item) => item.progressBasisPoints === 10_000)) {
        project.status = "monument";
        state.activeProjectId = null;
        events.push({ type: "ProjectSealedAsMonument", projectId: project.id });
      }
      return ok(state, events);
    }
    case "CancelFocus": {
      const active = state.activeFocusSession;
      if (!active) return fail(state, "FOCUS_NOT_ACTIVE", "No focus session is active");
      if (Date.parse(now) >= Date.parse(active.endsAt)) return fail(state, "FOCUS_ALREADY_ELAPSED", "Elapsed focus must be completed, not interrupted");
      const interruptionCategory = command.interruptionCategory ?? null;
      if (interruptionCategory !== null && !["external-interruption", "task-blocked", "fatigue", "priority-changed", "device-or-app", "other"].includes(interruptionCategory)) {
        throw new Error("Invalid interruption category");
      }
      state.focusHistory.push({
        ...focusSessionBase(active), status: "interrupted", interruptedAt: now,
        interruptionReason: "user-cancelled", interruptionCategory,
        actualDurationMs: Math.max(0, Date.parse(now) - Date.parse(active.startedAt)),
      });
      state.activeFocusSession = null;
      return ok(state, [{ type: "FocusInterrupted", sessionId: active.id, reason: "user-cancelled", category: interruptionCategory }]);
    }
    case "ConfigureFocusIntegrity": {
      if (typeof command.enabled !== "boolean") throw new Error("enabled must be boolean");
      if (!Number.isInteger(command.maxEffectiveExcursions) || command.maxEffectiveExcursions < 1 || command.maxEffectiveExcursions > 5) {
        throw new Error("maxEffectiveExcursions must be an integer from 1 through 5");
      }
      state.focusIntegrityPolicy = { enabled: command.enabled, maxEffectiveExcursions: command.maxEffectiveExcursions };
      return ok(state, [{ type: "FocusIntegrityConfigured", ...state.focusIntegrityPolicy }]);
    }
    case "GrantFocusLifecycleExemption": {
      const active = state.activeFocusSession;
      if (!active || active.integrity.exemptionPending) return ok(state, []);
      active.integrity.exemptionPending = true;
      return ok(state, [{ type: "FocusLifecycleExemptionGranted", sessionId: active.id }]);
    }
    case "RecordFocusBackgrounded": {
      const active = state.activeFocusSession;
      if (!active) return ok(state, []);
      if (Date.parse(now) >= Date.parse(active.endsAt)) return ok(state, completeActiveFocus(state, active));
      if (active.integrity.backgroundedAt !== null) return ok(state, []);
      const reason = active.integrity.exemptionPending ? "system-exempt" : command.reason;
      active.integrity.exemptionPending = false;
      active.integrity.backgroundedAt = now;
      active.integrity.backgroundReason = reason;
      return ok(state, [{ type: "FocusBackgrounded", sessionId: active.id, reason, backgroundedAt: now }]);
    }
    case "RecordFocusForegrounded": {
      const active = state.activeFocusSession;
      if (!active) return ok(state, []);
      if (Date.parse(now) >= Date.parse(active.endsAt)) return ok(state, completeActiveFocus(state, active));
      const backgroundedAt = active.integrity.backgroundedAt;
      const reason = active.integrity.backgroundReason;
      if (backgroundedAt === null || reason === null) return ok(state, []);
      active.integrity.backgroundedAt = null;
      active.integrity.backgroundReason = null;
      const elapsedMs = Date.parse(now) - Date.parse(backgroundedAt);
      const counts = state.focusIntegrityPolicy.enabled
        && elapsedMs > FOCUS_INTEGRITY_GRACE_MS
        && (reason === "app-switch" || reason === "web-visibility");
      if (!counts) return ok(state, []);
      active.integrity.effectiveExcursions += 1;
      const events: DomainEvent[] = [{
        type: "FocusExcursionRecorded",
        sessionId: active.id,
        effectiveExcursions: active.integrity.effectiveExcursions,
        maxEffectiveExcursions: state.focusIntegrityPolicy.maxEffectiveExcursions,
      }];
      if (active.integrity.effectiveExcursions < state.focusIntegrityPolicy.maxEffectiveExcursions) return ok(state, events);
      state.focusHistory.push({
        ...focusSessionBase(active), status: "interrupted", interruptedAt: now, interruptionReason: "app-switch-limit",
        interruptionCategory: null, actualDurationMs: Math.max(0, Date.parse(now) - Date.parse(active.startedAt)),
      });
      state.activeFocusSession = null;
      events.push({ type: "FocusInterrupted", sessionId: active.id, reason: "app-switch-limit", category: null });
      return ok(state, events);
    }
    case "ReportSubtaskProgress": {
      const project = activeProject(state);
      if (!Number.isInteger(command.progressBasisPoints) || command.progressBasisPoints < 0 || command.progressBasisPoints > 10_000) throw new Error("progressBasisPoints must be an integer from 0 through 10000");
      requireNonBlank(command.reportId, "reportId");
      if (state.progressReports.some((report) => report.id === command.reportId)) return fail(state, "DUPLICATE_ID", "Progress report ID already exists");
      const subtask = project.subtasks.find((item) => item.id === command.subtaskId);
      if (!subtask) return fail(state, "SUBTASK_NOT_FOUND", "Subtask does not exist");
      if (command.progressBasisPoints < subtask.progressBasisPoints) return fail(state, "PROGRESS_CANNOT_DECREASE", "Reported task progress cannot decrease");
      if (command.focusSessionIds.length === 0 || new Set(command.focusSessionIds).size !== command.focusSessionIds.length) return fail(state, "PROGRESS_REQUIRES_COMPLETED_FOCUS", "A progress report needs unique completed focus sessions");
      const sessions = command.focusSessionIds.map((id) => state.focusHistory.find((session) => session.id === id));
      if (sessions.some((session) => !session || session.status !== "completed" || session.projectId !== project.id || session.subtaskId !== subtask.id)) return fail(state, "PROGRESS_REQUIRES_COMPLETED_FOCUS", "Every supporting session must be completed for this project and subtask");
      const reportedSessions = new Set(state.progressReports.flatMap((report) => report.focusSessionIds));
      if (command.focusSessionIds.some((id) => reportedSessions.has(id))) return fail(state, "FOCUS_ALREADY_REPORTED", "A completed focus session can support only one progress report");
      const wouldSeal = command.progressBasisPoints === 10_000 && project.subtasks.every((item) => item.id === subtask.id || item.progressBasisPoints === 10_000);
      if (wouldSeal && state.activeFocusSession) return fail(state, "ACTIVE_FOCUS_PREVENTS_SEALING", "Cancel or complete active focus before sealing the project");
      subtask.progressBasisPoints = command.progressBasisPoints;
      state.progressReports.push({ id: command.reportId, projectId: project.id, subtaskId: subtask.id, focusSessionIds: [...command.focusSessionIds], progressBasisPoints: command.progressBasisPoints, reportedAt: now });
      const events: DomainEvent[] = [{ type: "SubtaskProgressReported", subtaskId: subtask.id, progressBasisPoints: command.progressBasisPoints }];
      if (command.progressBasisPoints > 0 && !project.subtaskStructureLocked) {
        project.subtaskStructureLocked = true;
        events.push({ type: "SubtaskStructureLocked" });
      }
      if (wouldSeal) {
        project.status = "monument";
        state.activeProjectId = null;
        events.push({ type: "ProjectSealedAsMonument", projectId: project.id });
      }
      return ok(state, events);
    }
    case "SetDailyGoal": {
      assertISODate(command.date);
      if (!Number.isInteger(command.targetPomodoros) || command.targetPomodoros <= 0) throw new Error("targetPomodoros must be a positive integer");
      const prior = state.dailyGoals.find((goal) => goal.date === command.date);
      if (prior) {
        prior.targetPomodoros = command.targetPomodoros;
        prior.enabled = true;
      } else {
        state.dailyGoals.push({ date: command.date, targetPomodoros: command.targetPomodoros, reachedAt: null, enabled: true });
      }
      const events: DomainEvent[] = [{ type: "DailyGoalSet", date: command.date, targetPomodoros: command.targetPomodoros }];
      reachGoalForDate(state, command.date, now, events);
      return ok(state, events);
    }
    case "DisableDailyGoal": {
      assertISODate(command.date);
      const goal = state.dailyGoals.find((item) => item.date === command.date);
      if (!goal || !goal.enabled) return ok(state, []);
      goal.enabled = false;
      return ok(state, [{ type: "DailyGoalDisabled", date: command.date }]);
    }
    case "ConfigureCalendar": {
      assertCalendar(command.timeZone, command.restWeekdays);
      state.calendar = { timeZone: command.timeZone, restWeekdays: [...command.restWeekdays].sort() };
      resetActiveDecayAnchors(state, now);
      return ok(state, [{ type: "CalendarConfigured" }]);
    }
    case "ConfigureWorldEnvironment": {
      if (command.environmentStyle !== "natural-valley" && command.environmentStyle !== "classic-island") {
        throw new Error("Invalid world environment style");
      }
      if (state.worldSettings.environmentStyle === command.environmentStyle) return ok(state, []);
      state.worldSettings.environmentStyle = command.environmentStyle;
      return ok(state, [{ type: "WorldEnvironmentConfigured", environmentStyle: command.environmentStyle }]);
    }
    case "EnableDecay": {
      if (!Number.isInteger(command.damagePerMissedPlannedDayBasisPoints) || command.damagePerMissedPlannedDayBasisPoints <= 0 || command.damagePerMissedPlannedDayBasisPoints > 10_000) throw new Error("damagePerMissedPlannedDayBasisPoints must be an integer from 1 through 10000");
      if (!Number.isInteger(command.gracePlannedDays) || command.gracePlannedDays < 0) throw new Error("gracePlannedDays must be a non-negative integer");
      state.decayPolicy.enabled = true;
      state.decayPolicy.damagePerMissedPlannedDayBasisPoints = command.damagePerMissedPlannedDayBasisPoints;
      state.decayPolicy.gracePlannedDays = command.gracePlannedDays;
      resetActiveDecayAnchors(state, now);
      return ok(state, [{ type: "DecayEnabled" }]);
    }
    case "DisableDecay": {
      state.decayPolicy.enabled = false;
      state.decayPolicy.damagePerMissedPlannedDayBasisPoints = null;
      for (const runtime of state.projectConditions) {
        runtime.inactivityAnchorAt = null;
        runtime.assessedMissedPlannedDays = 0;
      }
      return ok(state, [{ type: "DecayDisabled" }]);
    }
    case "AssessDecay": {
      if (!state.decayPolicy.enabled) return fail(state, "DECAY_DISABLED", "Decay is disabled");
      const rate = state.decayPolicy.damagePerMissedPlannedDayBasisPoints;
      if (rate === null) throw new Error("Enabled decay is missing its damage rate");
      const events: DomainEvent[] = [];
      for (const project of state.projects) {
        if (project.status !== "active" && project.status !== "paused") continue;
        if (project.kind === "habit" && requireHabit(project).awaitingNextBuilding) continue;
        const runtime = projectCondition(state, project.id);
        if (!runtime.inactivityAnchorAt) throw new Error("Enabled decay is missing an inactivity anchor");
        const plannedDays = countPlannedFocusDaysAfter(localDateOf(runtime.inactivityAnchorAt, state.calendar.timeZone), localDateOf(now, state.calendar.timeZone), state.calendar);
        const missedDays = Math.max(0, plannedDays - state.decayPolicy.gracePlannedDays);
        const newlyMissed = Math.max(0, missedDays - runtime.assessedMissedPlannedDays);
        runtime.assessedMissedPlannedDays = Math.max(runtime.assessedMissedPlannedDays, missedDays);
        if (newlyMissed === 0) continue;
        runtime.conditionBasisPoints = clampBasisPoints(runtime.conditionBasisPoints - newlyMissed * rate);
        events.push({ type: "BuildingConditionDecayed", projectId: project.id, conditionBasisPoints: runtime.conditionBasisPoints, newlyMissedPlannedDays: newlyMissed });
      }
      return ok(state, events);
    }
    case "ImportDecorationBlueprint": {
      const blueprint = parseDecorationBlueprint(command.blueprint, "$.command.blueprint");
      const existing = state.decorationBlueprintResources.find((resource) => resource.id === blueprint.id);
      if (existing) {
        if (JSON.stringify(existing.blueprint) === JSON.stringify(blueprint)) return ok(state, []);
        if (!isSourceBlockStateEnrichment(existing.blueprint, blueprint)) throw new Error("Decoration blueprint ID conflicts with different content");
        existing.blueprint = blueprint;
        return ok(state, [{ type: "DecorationBlueprintImported", resourceId: blueprint.id }]);
      }
      state.decorationBlueprintResources.push({ id: blueprint.id, blueprint, importedAt: now });
      return ok(state, [{ type: "DecorationBlueprintImported", resourceId: blueprint.id }]);
    }
    case "ImportBuildingBlueprint": {
      const blueprint = parseImportedBlueprint(command.blueprint, "$.command.blueprint");
      const existing = state.buildingBlueprintResources.find((resource) => resource.id === blueprint.id);
      if (existing) {
        if (JSON.stringify(existing.blueprint) === JSON.stringify(blueprint)) return ok(state, []);
        if (!isSourceBlockStateEnrichment(existing.blueprint, blueprint)) throw new Error("Building blueprint ID conflicts with different content");
        existing.blueprint = blueprint;
        return ok(state, [{ type: "BuildingBlueprintImported", resourceId: blueprint.id }]);
      }
      if (state.buildingBlueprintResources.length >= 12) throw new Error("Building blueprint library is limited to 12 entries");
      state.buildingBlueprintResources.push({ id: blueprint.id, blueprint, importedAt: now });
      return ok(state, [{ type: "BuildingBlueprintImported", resourceId: blueprint.id }]);
    }
    case "DeleteBuildingBlueprint": {
      requireNonBlank(command.blueprintId, "blueprintId");
      const index = state.buildingBlueprintResources.findIndex((resource) => resource.id === command.blueprintId);
      if (index < 0) return ok(state, []);
      state.buildingBlueprintResources.splice(index, 1);
      return ok(state, [{ type: "BuildingBlueprintDeleted", resourceId: command.blueprintId }]);
    }
  }
}

function isSourceBlockStateEnrichment(existing: ImportedBlueprintV1, incoming: ImportedBlueprintV1): boolean {
  const stripStates = (blueprint: ImportedBlueprintV1) => ({
    ...blueprint,
    voxels: blueprint.voxels.map(({ sourceBlockState: _sourceBlockState, ...voxel }) => voxel),
  });
  if (JSON.stringify(stripStates(existing)) !== JSON.stringify(stripStates(incoming))) return false;
  let enriched = false;
  for (let index = 0; index < existing.voxels.length; index += 1) {
    const before = existing.voxels[index]!.sourceBlockState;
    const after = incoming.voxels[index]!.sourceBlockState;
    if (before === undefined) {
      if (after !== undefined) enriched = true;
      continue;
    }
    if (after === undefined || JSON.stringify(before) !== JSON.stringify(after)) return false;
  }
  return enriched;
}

function completeActiveFocus(state: DomainState, active: NonNullable<DomainState["activeFocusSession"]>): DomainEvent[] {
  const session: FocusSession = {
    ...focusSessionBase(active),
    status: "completed",
    completedAt: active.endsAt,
    completedLocalDate: localDateOf(active.endsAt, active.timeZoneAtStart),
    actualDurationMs: active.plannedDurationMs,
  };
  state.focusHistory.push(session);
  state.activeFocusSession = null;
  const events: DomainEvent[] = [{ type: "FocusCompleted", sessionId: session.id }];
  applyRepair(state, session.projectId, session.completedAt, events);
  const project = state.projects.find((candidate) => candidate.id === session.projectId);
  if (!project) throw new Error("Completed focus references a missing project");
  if (project.kind === "habit") advanceHabitBuilding(state, project, session, events);
  reachGoalForDate(state, session.completedLocalDate, session.completedAt, events, session.projectId);
  return events;
}

function advanceHabitBuilding(state: DomainState, project: Project, session: FocusSession, events: DomainEvent[]): void {
  const habit = requireHabit(project);
  if (habit.awaitingNextBuilding) throw new Error("Habit focus completed without a selected building");
  if (habit.completedFocusSessionIds.includes(session.id)
    || state.habitBuildings.some((building) => building.focusSessionIds.includes(session.id))) {
    throw new Error("Habit focus session was already applied to a building");
  }
  habit.completedFocusSessionIds.push(session.id);
  events.push({
    type: "HabitBuildingProgressed",
    projectId: project.id,
    completedRounds: habit.completedFocusSessionIds.length,
    targetRounds: habit.targetRounds,
  });
  if (habit.completedFocusSessionIds.length < habit.targetRounds) return;
  if (habit.completedFocusSessionIds.length > habit.targetRounds) throw new Error("Habit building progress exceeded its target");
  const buildingId = `habit-building:${project.id}:${habit.cycleNumber}`;
  if (state.habitBuildings.some((building) => building.id === buildingId)) throw new Error("Habit building ID already exists");
  const completedSettlementIndex = project.settlementIndex;
  project.settlementIndex = nextSettlementIndex(state);
  state.habitBuildings.push({
    id: buildingId,
    habitProjectId: project.id,
    habitTitle: project.title,
    cycleNumber: habit.cycleNumber,
    settlementIndex: completedSettlementIndex,
    blueprintId: project.blueprintId,
    importedBlueprint: structuredClone(project.importedBlueprint),
    targetRounds: habit.targetRounds,
    focusSessionIds: [...habit.completedFocusSessionIds],
    completedAt: session.status === "interrupted" ? session.interruptedAt : session.completedAt,
  });
  habit.cycleNumber += 1;
  habit.completedFocusSessionIds = [];
  habit.awaitingNextBuilding = true;
  const runtime = projectCondition(state, project.id);
  runtime.conditionBasisPoints = 10_000;
  runtime.inactivityAnchorAt = null;
  runtime.assessedMissedPlannedDays = 0;
  events.push({ type: "HabitBuildingCompleted", projectId: project.id, buildingId, cycleNumber: habit.cycleNumber - 1 });
}

function focusSessionBase(active: NonNullable<DomainState["activeFocusSession"]>): FocusSessionBase {
  const { integrity: _integrity, ...base } = active;
  return base;
}

function applyRepair(state: DomainState, projectId: string, at: string, events: DomainEvent[]): void {
  if (!state.decayPolicy.enabled) return;
  const project = state.projects.find((item) => item.id === projectId);
  if (!project || project.status === "monument") return;
  const rate = state.decayPolicy.damagePerMissedPlannedDayBasisPoints;
  if (rate === null) return;
  const runtime = projectCondition(state, projectId);
  const before = runtime.conditionBasisPoints;
  const repair = Math.floor((rate * state.decayPolicy.repairMultiplierBasisPoints) / 10_000);
  runtime.conditionBasisPoints = clampBasisPoints(before + repair);
  runtime.inactivityAnchorAt = at;
  runtime.assessedMissedPlannedDays = 0;
  if (runtime.conditionBasisPoints !== before) events.push({ type: "BuildingConditionRepaired", projectId, conditionBasisPoints: runtime.conditionBasisPoints });
}

function reachGoalForDate(state: DomainState, date: string, at: string, events: DomainEvent[], completingProjectId?: string): void {
  const goal = state.dailyGoals.find((item) => item.date === date);
  if (!goal?.enabled || goal.reachedAt || completedPomodorosOn(state, date) < goal.targetPomodoros) return;
  goal.reachedAt = at;
  events.push({ type: "DailyGoalReached", date });
  grantDecorationReward(state, date, at, events, completingProjectId);
}

function grantDecorationReward(state: DomainState, date: string, at: string, events: DomainEvent[], completingProjectId?: string): void {
  if (state.decorationBlueprintResources.length === 0 || state.decorationRewards.some((reward) => reward.date === date)) return;
  const completions = state.focusHistory
    .filter((session): session is Extract<FocusSession, { status: "completed" }> => session.status === "completed" && session.completedLocalDate === date)
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
  const projectId = completingProjectId ?? completions.at(-1)?.projectId;
  if (!projectId) return;
  const resources = [...state.decorationBlueprintResources].sort((left, right) => left.id.localeCompare(right.id));
  const seed = hash32(`decoration-reward:${date}:${projectId}`);
  const resource = resources[seed % resources.length]!;
  const angle = (seed >>> 8) % 4 as 0 | 1 | 2 | 3;
  const side = (seed >>> 10) % 4;
  // Clears a centered 48x48 main blueprint plus a 12x12 decoration.
  const offset = 34 + ((seed >>> 12) % 8);
  const lateral = ((seed >>> 16) % 13) - 6;
  const position = side === 0 ? { x: offset, z: lateral }
    : side === 1 ? { x: lateral, z: offset }
      : side === 2 ? { x: -offset, z: lateral }
        : { x: lateral, z: -offset };
  state.decorationRewards.push({ date, projectId, resourceId: resource.id, awardedAt: at, position, rotationQuarterTurns: angle });
  events.push({ type: "DecorationRewardGranted", date, projectId, resourceId: resource.id });
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function activeProject(state: DomainState): Project {
  if (state.activeProjectId === null) throwDomain("PROJECT_NOT_FOUND", "No active project exists");
  const project = state.projects.find((item) => item.id === state.activeProjectId);
  if (!project) throw new Error("activeProjectId has no matching project");
  if (project.status !== "active") throwDomain("PROJECT_IS_MONUMENT", "Monuments cannot be edited or focused");
  return project;
}

function projectCondition(state: DomainState, projectId: string): ProjectCondition {
  const runtime = state.projectConditions.find((item) => item.projectId === projectId);
  if (!runtime) throw new Error("Project is missing condition runtime");
  return runtime;
}

function allKnownSubtaskIds(state: DomainState): Set<string> {
  return new Set([...state.retiredSubtaskIds, ...state.projects.flatMap((project) => project.subtasks.map((item) => item.id))]);
}

function nextSettlementIndex(state: DomainState): number {
  const indices = [
    ...state.projects.map((project) => project.settlementIndex),
    ...state.habitBuildings.map((building) => building.settlementIndex),
  ];
  return indices.length === 0 ? 0 : Math.max(...indices) + 1;
}

function activeProjectHasUnreportedFocus(state: DomainState): boolean {
  if (state.activeProjectId === null) return false;
  const project = state.projects.find((candidate) => candidate.id === state.activeProjectId);
  if (project?.kind === "habit") return false;
  const reported = new Set(state.progressReports.flatMap((report) => report.focusSessionIds));
  return state.focusHistory.some((session) =>
    session.status === "completed" && session.projectId === state.activeProjectId && !reported.has(session.id));
}

function resetActiveDecayAnchors(state: DomainState, at: string): void {
  if (!state.decayPolicy.enabled) return;
  for (const project of state.projects) {
    if (project.status !== "active" && project.status !== "paused") continue;
    if (project.kind === "habit" && requireHabit(project).awaitingNextBuilding) continue;
    const runtime = projectCondition(state, project.id);
    runtime.inactivityAnchorAt = at;
    runtime.assessedMissedPlannedDays = 0;
  }
}

function assertCalendar(timeZone: string, restWeekdays: number[]): void {
  assertValidTimeZone(timeZone);
  if (restWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("restWeekdays must contain integers from 0 through 6");
  if (new Set(restWeekdays).size !== restWeekdays.length) throw new Error("restWeekdays cannot contain duplicates");
}

function normalizeOrder(project: Project): void {
  project.subtasks.forEach((item, order) => { item.order = order; });
}

function requireHabit(project: Project) {
  if (project.kind !== "habit" || project.habit === null) throw new Error("Project is not a habit project");
  return project.habit;
}

function requireHabitTargetRounds(value: number): void {
  if (!Number.isInteger(value) || value < 10 || value > 30) throw new Error("Habit target rounds must be an integer from 10 through 30");
}

function requireNonBlank(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} cannot be blank`);
}

function validNow(clock: Clock): Date {
  const now = clock.now();
  if (!Number.isFinite(now.getTime())) throw new Error("Clock returned an invalid date");
  return now;
}

function clampBasisPoints(value: number): number {
  return Math.min(10_000, Math.max(0, value));
}

function ok(state: DomainState, events: DomainEvent[]): CommandResult {
  return { ok: true, state, events };
}

function fail(state: DomainState, code: DomainErrorCode, message: string): CommandResult {
  return { ok: false, state, code, message };
}

function throwDomain(code: DomainErrorCode, message: string): never {
  const error = new Error(message) as Error & { domainCode: DomainErrorCode };
  error.domainCode = code;
  throw error;
}

function isDomainException(error: unknown): error is Error & { domainCode: DomainErrorCode } {
  return error instanceof Error && "domainCode" in error;
}
