import type { StateRepository } from "@tomato-clock/application";
import type { DomainState } from "@tomato-clock/domain";
import { cloneAndParseState, createBackupEnvelope, parseBackup, previewOf, stateSummary } from "./codec.js";
import type {
  DeleteActiveProjectRollbackReason,
  ImportPreview,
  RollbackCreationReason,
  ReplaceFromImportOptions,
  RepositoryOptions,
  RollbackBackup,
  RollbackBackupSummary,
} from "./model.js";

const DB_VERSION = 1;
const APP_STATE_STORE = "appState";
const ROLLBACK_STORE = "rollbackBackups";
const METADATA_STORE = "metadata";
const CURRENT_KEY = "current";

interface CurrentStateRecord { id: typeof CURRENT_KEY; revision: number; state: DomainState | null }
interface MetadataRecord { id: "schema"; version: 1 }

export class StorageConflictError extends Error {
  readonly code = "STORAGE_CONFLICT";
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`State revision conflict: expected ${expectedRevision}, found ${actualRevision}`);
    this.name = "StorageConflictError";
  }
}

export class IndexedDbStateRepository implements StateRepository {
  private readonly databaseName: string;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: RepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? "tomato-clock";
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  }

  async load(): Promise<{ state: DomainState | null; revision: number }> {
    return this.readSnapshot();
  }

  private async readSnapshot(): Promise<{ state: DomainState | null; revision: number }> {
    const db = await this.database();
    const tx = db.transaction(APP_STATE_STORE, "readonly");
    const done = transactionDone(tx);
    const record = await requestResult<CurrentStateRecord | undefined>(tx.objectStore(APP_STATE_STORE).get(CURRENT_KEY));
    await done;
    return {
      state: record?.state == null ? null : cloneAndParseState(record.state),
      revision: record?.revision ?? 0,
    };
  }

  async save(state: DomainState, expectedRevision: number): Promise<number> {
    assertExpectedRevision(expectedRevision);
    const safeState = cloneAndParseState(state);
    const db = await this.database();
    const tx = db.transaction(APP_STATE_STORE, "readwrite");
    const done = transactionDone(tx);
    try {
      const store = tx.objectStore(APP_STATE_STORE);
      const current = await requestResult<CurrentStateRecord | undefined>(store.get(CURRENT_KEY));
      const actualRevision = current?.revision ?? 0;
      if (expectedRevision !== actualRevision) {
        throw new StorageConflictError(expectedRevision, actualRevision);
      }
      const nextRevision = actualRevision + 1;
      store.put({ id: CURRENT_KEY, revision: nextRevision, state: safeState } satisfies CurrentStateRecord);
      await done;
      return nextRevision;
    } catch (error) {
      tx.abort();
      await done.catch(() => undefined);
      throw error;
    }
  }

  async exportBackup(): Promise<string> {
    const { state } = await this.readSnapshot();
    if (state === null) throw new Error("Cannot export an empty database");
    return JSON.stringify(await createBackupEnvelope(state, this.now()));
  }

  async previewImport(input: string): Promise<ImportPreview> {
    return previewOf(await parseBackup(input));
  }

  async replaceFromImport(input: string, expectedRevision: number, options: ReplaceFromImportOptions = {}): Promise<{ rollbackBackupId: string; revision: number }> {
    assertExpectedRevision(expectedRevision);
    const incoming = await parseBackup(input);
    const db = await this.database();
    const tx = db.transaction([APP_STATE_STORE, ROLLBACK_STORE], "readwrite");
    const done = transactionDone(tx);
    try {
      const current = await requestResult<CurrentStateRecord | undefined>(tx.objectStore(APP_STATE_STORE).get(CURRENT_KEY));
      const actualRevision = current?.revision ?? 0;
      assertMatchingRevision(expectedRevision, actualRevision);
      const rollback = this.newRollback(current?.state ?? null, { reason: "before-import", sourceChecksum: incoming.checksum });
      tx.objectStore(ROLLBACK_STORE).add(rollback);
      if (options.injectFailureAfterRollbackWrite) throw new Error("Injected import replacement failure");
      const nextRevision = actualRevision + 1;
      tx.objectStore(APP_STATE_STORE).put({ id: CURRENT_KEY, revision: nextRevision, state: cloneAndParseState(incoming.payload) } satisfies CurrentStateRecord);
      await done;
      return { rollbackBackupId: rollback.id, revision: nextRevision };
    } catch (error) {
      tx.abort();
      await done.catch(() => undefined);
      throw error;
    }
  }

  async listRollbackBackups(): Promise<RollbackBackupSummary[]> {
    const db = await this.database();
    const tx = db.transaction(ROLLBACK_STORE, "readonly");
    const done = transactionDone(tx);
    const records = await requestResult<RollbackBackup[]>(tx.objectStore(ROLLBACK_STORE).getAll());
    await done;
    return records.map((record) => {
      const backup = parseRollbackBackup(record);
      const { state, ...summary } = backup;
      return { ...structuredClone(summary), summary: stateSummary(state) };
    }).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  }

  async saveWithRollback(state: DomainState, expectedRevision: number, reason: DeleteActiveProjectRollbackReason): Promise<{ rollbackBackupId: string; revision: number }> {
    assertExpectedRevision(expectedRevision);
    const safeState = cloneAndParseState(state);
    if (reason.type !== "before-delete-active-project" || reason.projectId.trim() === "") throw new Error("Invalid delete rollback reason");
    const replacement = safeState.projects.find((project) => project.id === reason.projectId);
    if (!replacement || replacement.status !== "deleted" || safeState.activeProjectId !== null) {
      throw new Error("Deleted project must remain as a soft-deleted inactive record");
    }
    const db = await this.database();
    const tx = db.transaction([APP_STATE_STORE, ROLLBACK_STORE], "readwrite");
    const done = transactionDone(tx);
    try {
      const store = tx.objectStore(APP_STATE_STORE);
      const current = await requestResult<CurrentStateRecord | undefined>(store.get(CURRENT_KEY));
      const actualRevision = current?.revision ?? 0;
      assertMatchingRevision(expectedRevision, actualRevision);
      const currentState = current?.state == null ? null : cloneAndParseState(current.state);
      if (currentState?.activeProjectId !== reason.projectId) throw new Error("Rollback deletion target must be the active project");
      const rollback = this.newRollback(currentState, { reason: "before-delete-active-project", projectId: reason.projectId });
      tx.objectStore(ROLLBACK_STORE).add(rollback);
      const nextRevision = actualRevision + 1;
      store.put({ id: CURRENT_KEY, revision: nextRevision, state: safeState } satisfies CurrentStateRecord);
      await done;
      return { rollbackBackupId: rollback.id, revision: nextRevision };
    } catch (error) {
      tx.abort();
      await done.catch(() => undefined);
      throw error;
    }
  }

  async restoreRollback(backupId: string, expectedRevision: number): Promise<{ rollbackBackupId: string; revision: number }> {
    if (backupId.trim() === "") throw new Error("Rollback backup ID is required");
    assertExpectedRevision(expectedRevision);
    const db = await this.database();
    const tx = db.transaction([APP_STATE_STORE, ROLLBACK_STORE], "readwrite");
    const done = transactionDone(tx);
    try {
      const rawBackup = await requestResult<RollbackBackup | undefined>(tx.objectStore(ROLLBACK_STORE).get(backupId));
      if (rawBackup === undefined) throw new Error(`Rollback backup ${backupId} was not found`);
      const backup = parseRollbackBackup(rawBackup);
      const current = await requestResult<CurrentStateRecord | undefined>(tx.objectStore(APP_STATE_STORE).get(CURRENT_KEY));
      const actualRevision = current?.revision ?? 0;
      assertMatchingRevision(expectedRevision, actualRevision);
      const beforeRestore = this.newRollback(current?.state ?? null, { reason: "before-restore", sourceRollbackBackupId: backup.id });
      tx.objectStore(ROLLBACK_STORE).add(beforeRestore);
      const nextRevision = actualRevision + 1;
      const state = backup.state === null ? null : cloneAndParseState(backup.state);
      tx.objectStore(APP_STATE_STORE).put({ id: CURRENT_KEY, revision: nextRevision, state } satisfies CurrentStateRecord);
      await done;
      return { rollbackBackupId: beforeRestore.id, revision: nextRevision };
    } catch (error) {
      tx.abort();
      await done.catch(() => undefined);
      throw error;
    }
  }

  close(): void {
    if (this.databasePromise) void this.databasePromise.then((db) => db.close());
    this.databasePromise = undefined;
  }

  private database(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      let pending!: Promise<IDBDatabase>;
      pending = openDatabase(this.databaseName, () => {
        if (this.databasePromise === pending) this.databasePromise = undefined;
      });
      this.databasePromise = pending;
    }
    return this.databasePromise;
  }

  private newRollback(state: DomainState | null, reason: RollbackCreationReason): RollbackBackup {
    const base = { id: this.newId(), createdAt: this.now().toISOString(), state: state === null ? null : cloneAndParseState(state) };
    return { ...base, ...reason } as RollbackBackup;
  }
}

function assertExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("expectedRevision must be a non-negative safe integer");
}

function assertMatchingRevision(expectedRevision: number, actualRevision: number): void {
  if (expectedRevision !== actualRevision) throw new StorageConflictError(expectedRevision, actualRevision);
}

function parseRollbackBackup(value: unknown): RollbackBackup {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim() === "" || !validInstant(value.createdAt)) {
    throw new Error("Invalid rollback backup record");
  }
  const state = value.state === null ? null : cloneAndParseState(value.state);
  switch (value.reason) {
    case "before-import":
      if (!hasExactKeys(value, ["id", "createdAt", "reason", "sourceChecksum", "state"]) || typeof value.sourceChecksum !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceChecksum)) throw new Error("Invalid import rollback backup");
      return { id: value.id, createdAt: value.createdAt, reason: value.reason, sourceChecksum: value.sourceChecksum, state };
    case "before-delete-active-project":
      if (!hasExactKeys(value, ["id", "createdAt", "reason", "projectId", "state"]) || typeof value.projectId !== "string" || value.projectId.trim() === "") throw new Error("Invalid delete rollback backup");
      return { id: value.id, createdAt: value.createdAt, reason: value.reason, projectId: value.projectId, state };
    case "before-restore":
      if (!hasExactKeys(value, ["id", "createdAt", "reason", "sourceRollbackBackupId", "state"]) || typeof value.sourceRollbackBackupId !== "string" || value.sourceRollbackBackupId.trim() === "") throw new Error("Invalid restore rollback backup");
      return { id: value.id, createdAt: value.createdAt, reason: value.reason, sourceRollbackBackupId: value.sourceRollbackBackupId, state };
    default:
      throw new Error("Unknown rollback backup reason");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function openDatabase(name: string, onVersionChange: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(APP_STATE_STORE)) db.createObjectStore(APP_STATE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ROLLBACK_STORE)) db.createObjectStore(ROLLBACK_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const store = db.createObjectStore(METADATA_STORE, { keyPath: "id" });
        store.add({ id: "schema", version: 1 } satisfies MetadataRecord);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => {
        db.close();
        onVersionChange();
      };
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Unable to open IndexedDB"));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("IndexedDB upgrade was blocked"));
    };
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}
