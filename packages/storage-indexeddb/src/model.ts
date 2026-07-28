import type { DomainState, ISOInstant } from "@tomato-clock/domain";

export interface BackupEnvelopeV1 {
  format: "tomato-clock-backup";
  schemaVersion: 1;
  exportedAt: ISOInstant;
  payload: DomainState;
  checksum: string;
}

export interface StateSummary {
  isEmpty: boolean;
  projectCount: number;
  subtaskCount: number;
  activeProjectId: string | null;
  activeProjectTitle: string | null;
  activeBlueprintId: string | null;
  blueprintIds: string[];
  monumentCount: number;
  completedFocusCount: number;
  interruptedFocusCount: number;
  progressReportCount: number;
}

export interface ImportPreview {
  schemaVersion: 1;
  exportedAt: ISOInstant;
  checksum: string;
  summary: StateSummary;
}

interface RollbackBackupBase {
  id: string;
  createdAt: ISOInstant;
  state: DomainState | null;
}

export type RollbackBackup =
  | (RollbackBackupBase & { reason: "before-import"; sourceChecksum: string })
  | (RollbackBackupBase & { reason: "before-delete-active-project"; projectId: string })
  | (RollbackBackupBase & { reason: "before-restore"; sourceRollbackBackupId: string });

type RollbackCreationReason =
  | { reason: "before-import"; sourceChecksum: string }
  | { reason: "before-delete-active-project"; projectId: string }
  | { reason: "before-restore"; sourceRollbackBackupId: string };

export type { RollbackCreationReason };

type WithoutState<T> = T extends unknown ? Omit<T, "state"> : never;
export type RollbackBackupSummary = WithoutState<RollbackBackup> & { summary: StateSummary };

export interface DeleteActiveProjectRollbackReason {
  type: "before-delete-active-project";
  projectId: string;
}

export interface RepositoryOptions {
  databaseName?: string;
  now?: () => Date;
  newId?: () => string;
}

export interface ReplaceFromImportOptions {
  /** Test-only fault point used to prove the transaction aborts after staging its rollback. */
  injectFailureAfterRollbackWrite?: boolean;
}
