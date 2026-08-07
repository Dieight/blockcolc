export type ISODate = string;
export type ISOInstant = string;

export interface Clock {
  now(): Date;
}

export interface Subtask {
  id: string;
  title: string;
  order: number;
  progressBasisPoints: number;
}

export type ImportedBlueprintMaterialId = "stone" | "wood" | "plank" | "roof" | "glass" | "accent";
export type ImportedBlueprintStage = "foundation" | "frame" | "walls" | "roof" | "details";

export interface ImportedBlueprintVoxel {
  x: number;
  y: number;
  z: number;
  materialId: ImportedBlueprintMaterialId;
  stage: ImportedBlueprintStage;
  buildOrder: number;
  sourceBlockId?: string;
  sourceBlockState?: Record<string, string>;
  emissiveKind?: string;
  emissiveLevel?: number;
}

export interface ImportedBlueprintV1 {
  schemaVersion: 1;
  id: string;
  title: string;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
  voxels: ImportedBlueprintVoxel[];
}

export interface Project {
  id: string;
  title: string;
  kind: "finite" | "habit";
  settlementIndex: number;
  blueprintId: string;
  importedBlueprint: ImportedBlueprintV1 | null;
  createdAt: ISOInstant;
  status: "active" | "paused" | "monument" | "deleted";
  subtaskStructureLocked: boolean;
  subtasks: Subtask[];
  habit: HabitProjectState | null;
}

export interface HabitProjectState {
  cycleNumber: number;
  targetRounds: number;
  completedFocusSessionIds: string[];
  awaitingNextBuilding: boolean;
}

export interface HabitBuildingMonument {
  id: string;
  habitProjectId: string;
  habitTitle: string;
  cycleNumber: number;
  settlementIndex: number;
  blueprintId: string;
  importedBlueprint: ImportedBlueprintV1 | null;
  targetRounds: number;
  focusSessionIds: string[];
  completedAt: ISOInstant;
}

export interface FocusSessionBase {
  id: string;
  projectId: string;
  subtaskId: string | null;
  startedAt: ISOInstant;
  endsAt: ISOInstant;
  plannedDurationMs: number;
  timeZoneAtStart: string;
}

export type FocusBackgroundReason = "app-switch" | "screen-lock" | "system-exempt" | "web-visibility";

export interface ActiveFocusIntegrity {
  effectiveExcursions: number;
  backgroundedAt: ISOInstant | null;
  backgroundReason: FocusBackgroundReason | null;
  exemptionPending: boolean;
}

export interface ActiveFocusSession extends FocusSessionBase {
  integrity: ActiveFocusIntegrity;
}

export type FocusInterruptionReason = "user-cancelled" | "app-switch-limit";
export type FocusInterruptionCategory =
  | "external-interruption"
  | "task-blocked"
  | "fatigue"
  | "priority-changed"
  | "device-or-app"
  | "other";

export type FocusSession = FocusSessionBase &
  (
    | { status: "completed"; completedAt: ISOInstant; completedLocalDate: ISODate; actualDurationMs: number }
    | { status: "completed-early"; completedAt: ISOInstant; completedLocalDate: ISODate; actualDurationMs: number }
    | { status: "interrupted"; interruptedAt: ISOInstant; interruptionReason: FocusInterruptionReason; interruptionCategory: FocusInterruptionCategory | null; actualDurationMs: number }
  );

export interface DailyGoal {
  date: ISODate;
  targetPomodoros: number;
  reachedAt: ISOInstant | null;
  enabled: boolean;
}

export interface ProgressReport {
  id: string;
  projectId: string;
  subtaskId: string;
  focusSessionIds: string[];
  progressBasisPoints: number;
  reportedAt: ISOInstant;
}

export interface FocusCalendar {
  timeZone: string;
  restWeekdays: number[];
}

export interface DecayPolicy {
  enabled: boolean;
  gracePlannedDays: number;
  repairMultiplierBasisPoints: number;
  damagePerMissedPlannedDayBasisPoints: number | null;
}

export interface ProjectCondition {
  projectId: string;
  conditionBasisPoints: number;
  inactivityAnchorAt: ISOInstant | null;
  assessedMissedPlannedDays: number;
}

export interface DecorationBlueprintResource {
  id: string;
  blueprint: ImportedBlueprintV1;
  importedAt: ISOInstant;
}

/** Locally stored building template available to future projects only. */
export interface BuildingBlueprintResource {
  id: string;
  blueprint: ImportedBlueprintV1;
  importedAt: ISOInstant;
}

export interface DecorationReward {
  date: ISODate;
  projectId: string;
  resourceId: string;
  awardedAt: ISOInstant;
  /** Local X/Z relative to the owning project plot center. Terrain determines Y. */
  position: { x: number; z: number };
  rotationQuarterTurns: 0 | 1 | 2 | 3;
}

export interface FocusIntegrityPolicy {
  enabled: boolean;
  maxEffectiveExcursions: number;
}

export type WorldEnvironmentStyle = "natural-valley" | "classic-island";

export interface WorldSettings {
  worldSeed: string;
  terrainGenerationVersion: 1;
  environmentStyle: WorldEnvironmentStyle;
}

export interface DomainState {
  schemaVersion: 6;
  projects: Project[];
  habitBuildings: HabitBuildingMonument[];
  activeProjectId: string | null;
  retiredSubtaskIds: string[];
  activeFocusSession: ActiveFocusSession | null;
  focusHistory: FocusSession[];
  progressReports: ProgressReport[];
  dailyGoals: DailyGoal[];
  calendar: FocusCalendar;
  decayPolicy: DecayPolicy;
  projectConditions: ProjectCondition[];
  focusIntegrityPolicy: FocusIntegrityPolicy;
  decorationBlueprintResources: DecorationBlueprintResource[];
  decorationRewards: DecorationReward[];
  buildingBlueprintResources: BuildingBlueprintResource[];
  worldSettings: WorldSettings;
}

export type DomainCommand =
  | { type: "CreateProject"; projectId: string; title: string; blueprintId: string; importedBlueprint?: ImportedBlueprintV1 | null; subtasks: Array<{ id: string; title: string }> }
  | { type: "CreateHabitProject"; projectId: string; title: string; blueprintId: string; importedBlueprint?: ImportedBlueprintV1 | null; targetRounds: number }
  | { type: "SelectNextHabitBuilding"; blueprintId: string; importedBlueprint?: ImportedBlueprintV1 | null; targetRounds: number }
  | { type: "SwitchActiveProject"; projectId: string }
  | { type: "RenameProject"; title: string }
  | { type: "DeleteActiveProject"; projectId: string }
  | { type: "AddSubtask"; subtaskId: string; title: string }
  | { type: "RemoveSubtask"; subtaskId: string }
  | { type: "RenameSubtask"; subtaskId: string; title: string }
  | { type: "ReorderSubtasks"; orderedSubtaskIds: string[] }
  | { type: "StartFocus"; sessionId: string; subtaskId: string | null; plannedDurationMs: number }
  | { type: "CompleteFocus" }
  | { type: "CompleteFocusEarly"; reportId: string }
  | { type: "CancelFocus"; interruptionCategory?: FocusInterruptionCategory | null }
  | { type: "ConfigureFocusIntegrity"; enabled: boolean; maxEffectiveExcursions: number }
  | { type: "GrantFocusLifecycleExemption" }
  | { type: "RecordFocusBackgrounded"; reason: FocusBackgroundReason }
  | { type: "RecordFocusForegrounded" }
  | { type: "ReportSubtaskProgress"; reportId: string; subtaskId: string; focusSessionIds: string[]; progressBasisPoints: number }
  | { type: "SetDailyGoal"; date: ISODate; targetPomodoros: number }
  | { type: "DisableDailyGoal"; date: ISODate }
  | { type: "ConfigureCalendar"; timeZone: string; restWeekdays: number[] }
  | { type: "EnableDecay"; damagePerMissedPlannedDayBasisPoints: number; gracePlannedDays: number }
  | { type: "DisableDecay" }
  | { type: "AssessDecay" }
  | { type: "ConfigureWorldEnvironment"; environmentStyle: WorldEnvironmentStyle }
  | { type: "ImportDecorationBlueprint"; blueprint: ImportedBlueprintV1 }
  | { type: "ImportBuildingBlueprint"; blueprint: ImportedBlueprintV1 }
  | { type: "DeleteBuildingBlueprint"; blueprintId: string };

export type DomainEvent =
  | { type: "ProjectCreated"; projectId: string }
  | { type: "HabitBuildingSelected"; projectId: string; cycleNumber: number; targetRounds: number }
  | { type: "HabitBuildingProgressed"; projectId: string; completedRounds: number; targetRounds: number }
  | { type: "HabitBuildingCompleted"; projectId: string; buildingId: string; cycleNumber: number }
  | { type: "ProjectPaused"; projectId: string }
  | { type: "ProjectActivated"; projectId: string }
  | { type: "ProjectRenamed"; projectId: string }
  | { type: "ProjectDeleted"; projectId: string }
  | { type: "SubtaskAdded"; subtaskId: string }
  | { type: "SubtaskRemoved"; subtaskId: string }
  | { type: "SubtaskRenamed"; subtaskId: string }
  | { type: "SubtasksReordered" }
  | { type: "FocusStarted"; sessionId: string; endsAt: ISOInstant }
  | { type: "FocusCompleted"; sessionId: string }
  | { type: "FocusCompletedEarly"; sessionId: string; subtaskId: string | null; actualDurationMs: number }
  | { type: "FocusInterrupted"; sessionId: string; reason: FocusInterruptionReason; category: FocusInterruptionCategory | null }
  | { type: "FocusIntegrityConfigured"; enabled: boolean; maxEffectiveExcursions: number }
  | { type: "FocusLifecycleExemptionGranted"; sessionId: string }
  | { type: "FocusBackgrounded"; sessionId: string; reason: FocusBackgroundReason; backgroundedAt: ISOInstant }
  | { type: "FocusExcursionRecorded"; sessionId: string; effectiveExcursions: number; maxEffectiveExcursions: number }
  | { type: "SubtaskProgressReported"; subtaskId: string; progressBasisPoints: number }
  | { type: "SubtaskStructureLocked" }
  | { type: "ProjectSealedAsMonument"; projectId: string }
  | { type: "DailyGoalSet"; date: ISODate; targetPomodoros: number }
  | { type: "DailyGoalReached"; date: ISODate }
  | { type: "DailyGoalDisabled"; date: ISODate }
  | { type: "CalendarConfigured" }
  | { type: "DecayEnabled" }
  | { type: "DecayDisabled" }
  | { type: "BuildingConditionDecayed"; projectId: string; conditionBasisPoints: number; newlyMissedPlannedDays: number }
  | { type: "BuildingConditionRepaired"; projectId: string; conditionBasisPoints: number }
  | { type: "DecorationBlueprintImported"; resourceId: string }
  | { type: "BuildingBlueprintImported"; resourceId: string }
  | { type: "BuildingBlueprintDeleted"; resourceId: string }
  | { type: "WorldEnvironmentConfigured"; environmentStyle: WorldEnvironmentStyle }
  | { type: "DecorationRewardGranted"; date: ISODate; projectId: string; resourceId: string };

export type DomainErrorCode =
  | "PROJECT_ALREADY_EXISTS"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_IS_MONUMENT"
  | "PROJECT_DELETE_TARGET_MISMATCH"
  | "INVALID_INPUT"
  | "DUPLICATE_ID"
  | "SUBTASK_NOT_FOUND"
  | "SUBTASK_IN_USE"
  | "SUBTASK_STRUCTURE_LOCKED"
  | "FOCUS_ALREADY_ACTIVE"
  | "FOCUS_NOT_ACTIVE"
  | "FOCUS_NOT_ELAPSED"
  | "FOCUS_ALREADY_ELAPSED"
  | "PROGRESS_CANNOT_DECREASE"
  | "PROGRESS_REQUIRES_COMPLETED_FOCUS"
  | "FOCUS_ALREADY_REPORTED"
  | "ACTIVE_FOCUS_PREVENTS_SEALING"
  | "ACTIVE_FOCUS_PREVENTS_PROJECT_DELETION"
  | "ACTIVE_FOCUS_PREVENTS_PROJECT_SWITCH"
  | "UNREPORTED_FOCUS_PREVENTS_PROJECT_SWITCH"
  | "HABIT_BUILDING_SELECTION_REQUIRED"
  | "SUBTASK_HAS_HISTORY"
  | "DECAY_DISABLED";

export const FOCUS_INTEGRITY_GRACE_MS = 3_000;

export type CommandResult =
  | { ok: true; state: DomainState; events: DomainEvent[] }
  | { ok: false; state: DomainState; code: DomainErrorCode; message: string };
