import { parseDomainState, type DomainState, type ISOInstant } from "@blockcolc/domain";
import type { BackupEnvelope, ParsedBackupEnvelope, ImportPreview, StateSummary } from "./model.js";
import { MAX_EXPANDED_BACKUP_BYTES, packBackupPayload, unpackBackupPayload } from './compact-backup.js';

export class BackupValidationError extends Error {
  readonly code = "INVALID_BACKUP";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackupValidationError";
  }
}

/** Maximum UTF-8 size accepted by the backup import/preview path. */
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

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

export async function createBackupEnvelope(state: unknown, exportedAt: Date): Promise<BackupEnvelope> {
  const payload = cloneAndParseState(state);
  const unsigned = {
    format: "tomato-clock-backup" as const,
    schemaVersion: 1 as const,
    exportedAt: validInstant(exportedAt.toISOString(), "exportedAt"),
    payload,
  };
  const legacyBytes = new TextEncoder().encode(JSON.stringify({ ...unsigned, checksum: '0'.repeat(64) })).byteLength;
  if (legacyBytes <= MAX_BACKUP_BYTES) return { ...unsigned, checksum: await sha256(unsigned) };
  if (legacyBytes > MAX_EXPANDED_BACKUP_BYTES) throw new BackupValidationError('Backup exceeds the 512 MiB expanded limit');
  const compact = { ...unsigned, schemaVersion: 2 as const, payload: packBackupPayload(payload) };
  // Apply the same reference-expansion budget on both sides of the boundary.
  try { unpackBackupPayload(compact.payload); }
  catch (cause) { throw new BackupValidationError('Backup cannot be safely restored', { cause }); }
  assertBackupSize(JSON.stringify({ ...compact, checksum: '0'.repeat(64) }));
  return { ...compact, checksum: await sha256(compact) };
}

export async function parseBackup(input: string): Promise<ParsedBackupEnvelope> {
  assertBackupSize(input);
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (cause) {
    throw new BackupValidationError("Backup is not valid JSON", { cause });
  }
  const envelope = exactObject(raw, ["format", "schemaVersion", "exportedAt", "payload", "checksum"]);
  if (envelope.format !== "tomato-clock-backup") throw new BackupValidationError("Unknown backup format");
  if (envelope.schemaVersion !== 1 && envelope.schemaVersion !== 2 && envelope.schemaVersion !== 3) throw new BackupValidationError("Unsupported backup schema version");
  const schemaVersion: 1 | 2 | 3 = envelope.schemaVersion;
  const exportedAt = validInstant(envelope.exportedAt, "exportedAt");
  if (typeof envelope.checksum !== "string" || !/^[a-f0-9]{64}$/.test(envelope.checksum)) {
    throw new BackupValidationError("Invalid backup checksum");
  }
  const rawUnsigned = { format: "tomato-clock-backup" as const, schemaVersion, exportedAt, payload: envelope.payload };
  if (await sha256(rawUnsigned) !== envelope.checksum) throw new BackupValidationError("Backup checksum mismatch");
  let payload: DomainState;
  let preferences: Record<string, unknown> | undefined;
  try {
    const portable = schemaVersion === 3 ? exactObject(envelope.payload, ["domain", "domainVersion", "preferences"]) : undefined;
    const domainVersion = portable?.domainVersion ?? schemaVersion;
    if (domainVersion !== 1 && domainVersion !== 2) throw new BackupValidationError("Invalid backup domain version");
    if (portable) {
      const value = portable.preferences;
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new BackupValidationError("Invalid backup preferences");
      preferences = value as Record<string, unknown>;
      if (typeof preferences.focusMinutes !== "number" || typeof preferences.breakMinutes !== "number" ||
          new TextEncoder().encode(JSON.stringify(preferences)).byteLength > 65536) throw new BackupValidationError("Invalid backup preferences");
    }
    const rawState = portable ? portable.domain : envelope.payload;
    payload = cloneAndParseState(domainVersion === 2 ? unpackBackupPayload(rawState) : rawState);
  } catch (cause) {
    throw new BackupValidationError("Invalid domain state", { cause });
  }
  const normalized: Omit<ParsedBackupEnvelope, "checksum"> = { format: "tomato-clock-backup", schemaVersion, exportedAt, payload };
  return { ...normalized, checksum: envelope.checksum, ...(preferences ? { preferences } : {}) };
}

function assertBackupSize(input: string): void {
  if (input.length > MAX_BACKUP_BYTES || new TextEncoder().encode(input).byteLength > MAX_BACKUP_BYTES) {
    throw new BackupValidationError("Backup exceeds the 100 MiB import limit");
  }
}

export function previewOf(envelope: ParsedBackupEnvelope): ImportPreview {
  return {
    schemaVersion: envelope.schemaVersion,
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
    completedFocusCount: state.focusHistory.filter((session) => session.status === "completed" && session.external?.credited !== false).length,
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
