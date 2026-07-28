import { parseDomainState, type DomainState, type ISOInstant } from "@tomato-clock/domain";
import type { BackupEnvelopeV1, ImportPreview, StateSummary } from "./model.js";

export class BackupValidationError extends Error {
  readonly code = "INVALID_BACKUP";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackupValidationError";
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export async function sha256(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function cloneAndParseState(value: unknown): DomainState {
  return parseDomainState(structuredClone(value));
}

export async function createBackupEnvelope(state: unknown, exportedAt: Date): Promise<BackupEnvelopeV1> {
  const payload = cloneAndParseState(state);
  const unsigned = {
    format: "tomato-clock-backup" as const,
    schemaVersion: 1 as const,
    exportedAt: validInstant(exportedAt.toISOString(), "exportedAt"),
    payload,
  };
  return { ...unsigned, checksum: await sha256(unsigned) };
}

export async function parseBackup(input: string): Promise<BackupEnvelopeV1> {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (cause) {
    throw new BackupValidationError("Backup is not valid JSON", { cause });
  }
  const envelope = exactObject(raw, ["format", "schemaVersion", "exportedAt", "payload", "checksum"]);
  if (envelope.format !== "tomato-clock-backup") throw new BackupValidationError("Unknown backup format");
  if (envelope.schemaVersion !== 1) throw new BackupValidationError("Unsupported backup schema version");
  const exportedAt = validInstant(envelope.exportedAt, "exportedAt");
  if (typeof envelope.checksum !== "string" || !/^[a-f0-9]{64}$/.test(envelope.checksum)) {
    throw new BackupValidationError("Invalid backup checksum");
  }
  const rawUnsigned = { format: "tomato-clock-backup" as const, schemaVersion: 1 as const, exportedAt, payload: envelope.payload };
  if (await sha256(rawUnsigned) !== envelope.checksum) throw new BackupValidationError("Backup checksum mismatch");
  let payload: DomainState;
  try {
    payload = cloneAndParseState(envelope.payload);
  } catch (cause) {
    throw new BackupValidationError("Invalid domain state", { cause });
  }
  const normalized = { format: "tomato-clock-backup" as const, schemaVersion: 1 as const, exportedAt, payload };
  return { ...normalized, checksum: envelope.checksum };
}

export function previewOf(envelope: BackupEnvelopeV1): ImportPreview {
  return {
    schemaVersion: 1,
    exportedAt: envelope.exportedAt,
    checksum: envelope.checksum,
    summary: stateSummary(envelope.payload),
  };
}

export function stateSummary(state: DomainState | null): StateSummary {
  if (state === null) {
    return {
      isEmpty: true, projectCount: 0, subtaskCount: 0, activeProjectId: null, activeProjectTitle: null,
      activeBlueprintId: null, blueprintIds: [], monumentCount: 0, completedFocusCount: 0,
      interruptedFocusCount: 0, progressReportCount: 0,
    };
  }
  const active = state.projects.find((project) => project.id === state.activeProjectId);
  return {
    isEmpty: false,
    projectCount: state.projects.length,
    subtaskCount: state.projects.reduce((count, project) => count + project.subtasks.length, 0),
    activeProjectId: active?.id ?? null,
    activeProjectTitle: active?.title ?? null,
    activeBlueprintId: active?.blueprintId ?? null,
    blueprintIds: [...new Set(state.projects.map((project) => project.blueprintId))].sort(),
    monumentCount: state.projects.filter((project) => project.status === "monument").length,
    completedFocusCount: state.focusHistory.filter((session) => session.status === "completed").length,
    interruptedFocusCount: state.focusHistory.filter((session) => session.status === "interrupted").length,
    progressReportCount: state.progressReports.length,
  };
}

function exactObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BackupValidationError("Backup must be an object");
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new BackupValidationError("Backup has unexpected or missing fields");
  }
  return record;
}

function validInstant(value: unknown, field: string): ISOInstant {
  if (typeof value !== "string") throw new BackupValidationError(`${field} must be an ISO instant`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new BackupValidationError(`${field} must be a canonical ISO instant`);
  return value;
}
