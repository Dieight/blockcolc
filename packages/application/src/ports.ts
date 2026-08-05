import type { Clock, DomainState, ISOInstant } from "@tomato-clock/domain";

export type { Clock };

export interface StateSnapshot {
  state: DomainState | null;
  revision: number;
}

export interface StateRepository {
  load(): Promise<StateSnapshot>;
  /** Atomically replaces the aggregate only when expectedRevision is still current. */
  save(state: DomainState, expectedRevision: number): Promise<number>;
}

export interface BackupImportPreview {
  schemaVersion: 1;
  exportedAt: ISOInstant;
  checksum: string;
  summary: {
    projectCount: number;
    activeProjectTitle: string | null;
    monumentCount: number;
    completedFocusCount: number;
    interruptedFocusCount: number;
    progressReportCount: number;
    subtaskCount?: number;
    activeBlueprintId?: string | null;
    deletedProjectCount?: number;
  };
}

export interface DeleteActiveProjectRollbackReason {
  type: "before-delete-active-project";
  projectId: string;
}

export interface RollbackBackupSummary {
  id: string;
  createdAt: ISOInstant;
  reason: "before-import" | "before-delete-active-project" | "before-restore";
  sourceChecksum?: string;
  projectId?: string;
  sourceRollbackBackupId?: string;
  summary: BackupImportPreview["summary"];
}

/**
 * Operations that replace the complete aggregate. Implementations must commit
 * the rollback record and the new aggregate in one transaction.
 */
export interface BackupRepository {
  exportBackup(): Promise<string>;
  previewImport(input: string): Promise<BackupImportPreview>;
  replaceFromImport(input: string, expectedRevision: number): Promise<{ rollbackBackupId: string; revision: number }>;
  saveWithRollback(state: DomainState, expectedRevision: number, reason: DeleteActiveProjectRollbackReason): Promise<{ rollbackBackupId: string; revision: number }>;
  listRollbackBackups(): Promise<RollbackBackupSummary[]>;
  restoreRollback(backupId: string, expectedRevision: number): Promise<{ rollbackBackupId: string; revision: number }>;
}

export type NotificationPermission = "granted" | "denied" | "prompt" | "unavailable";
export type NotificationPrecision = "exact" | "inexact" | "unavailable";

export interface NotificationCapability {
  permission: NotificationPermission;
  precision: NotificationPrecision;
  canSchedule: boolean;
}

export interface FocusCompletionNotification {
  sessionId: string;
  endsAt: ISOInstant;
}

export interface BreakCompletionNotification {
  endsAt: ISOInstant;
}

export interface NotificationPort {
  /** May show a system prompt. Called only after an explicit user StartFocus command. */
  requestPermission(): Promise<NotificationCapability>;
  /** Read-only capability refresh. Must never show a permission prompt. */
  refreshCapability(): Promise<NotificationCapability>;
  scheduleFocusCompletion(notification: FocusCompletionNotification): Promise<void>;
  cancelFocusCompletion(sessionId: string): Promise<void>;
  scheduleBreakCompletion(notification: BreakCompletionNotification): Promise<void>;
  cancelBreakCompletion(): Promise<void>;
}

export type FocusLifecycleEvent =
  | { type: "foreground" }
  | {
      type: "background";
      source: "native" | "web";
      context?: { locked?: boolean; screenOff?: boolean; exempt?: boolean; backgroundedAtEpochMs?: number };
    };

export interface FocusLifecyclePort {
  subscribe(listener: (event: FocusLifecycleEvent) => void | Promise<void>): Promise<() => void | Promise<void>>;
}

export interface IdGenerator {
  next(kind: "project" | "subtask" | "focus-session" | "progress-report"): string;
}
