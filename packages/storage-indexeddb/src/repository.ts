import type { StateRepository, DailyBackupRepository, DailyBackupCollection, DailyBackupSummary } from "@blockcolc/application";
import { assertISODate, localDateOf, type DomainState } from "@blockcolc/domain";
import { cloneAndParseState, createBackupEnvelope, parseBackup, previewOf, stateSummary } from "./codec.js";
import { DAILY_BACKUP_BLOCK_STORE, DAILY_BACKUP_STORE, DAILY_BACKUP_MAX_BYTES, DAILY_BACKUP_RETENTION_DAYS,
  prepareDailyBackup, parseDailyManifest, expandDailyBackup, retainedDailyBackups, dailyBackupStoredBytes, dailyBackupSummary,
  type DailyBackupBlock, type DailyBackupManifest } from './daily-backups.js';
import type {
  DeleteActiveProjectRollbackReason,
  ImportPreview,
  RollbackCreationReason,
  ReplaceFromImportOptions,
  RepositoryOptions,
  RollbackBackup,
  RollbackBackupSummary,
} from "./model.js";

const DB_VERSION = 2;
const APP_STATE_STORE = "appState";
const ROLLBACK_STORE = "rollbackBackups";
const METADATA_STORE = "metadata";
const CURRENT_KEY = "current";
const MAX_ROLLBACK_BACKUPS = 2;
const ROLLBACK_SUMMARY_PREFIX = 'rollback-summary:';

interface CurrentStateRecord { id: typeof CURRENT_KEY; revision: number; state: DomainState | null }
interface MetadataRecord { id: "schema"; version: 1 }

export class StorageConflictError extends Error {
  readonly code = "STORAGE_CONFLICT";
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`State revision conflict: expected ${expectedRevision}, found ${actualRevision}`);
    this.name = "StorageConflictError";
  }
}

export class IndexedDbStateRepository implements StateRepository, DailyBackupRepository {
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

  async loadIfChanged(knownRevision: number): Promise<{ state: DomainState | null; revision: number } | null> {
    assertExpectedRevision(knownRevision);
    return this.readSnapshot(knownRevision);
  }

  private readSnapshot(): Promise<{ state: DomainState | null; revision: number }>;
  private readSnapshot(knownRevision: number): Promise<{ state: DomainState | null; revision: number } | null>;
  private async readSnapshot(knownRevision?: number): Promise<{ state: DomainState | null; revision: number } | null> {
    const db = await this.database();
    const tx = db.transaction(APP_STATE_STORE, "readonly");
    const done = transactionDone(tx);
    const record = await requestResult<CurrentStateRecord | undefined>(tx.objectStore(APP_STATE_STORE).get(CURRENT_KEY));
    await done;
    // Keep the transaction read (including changes made by another tab), but
    // avoid repeated schema validation and a second clone of large blueprints.
    // IndexedDB still performs its own structured clone; this is not a cache.
    if (knownRevision !== undefined && (record?.revision ?? 0) === knownRevision) return null;
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
    const tx = db.transaction([APP_STATE_STORE, ROLLBACK_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(tx);
    try {
      const current = await requestResult<CurrentStateRecord | undefined>(tx.objectStore(APP_STATE_STORE).get(CURRENT_KEY));
      const actualRevision = current?.revision ?? 0;
      assertMatchingRevision(expectedRevision, actualRevision);
      const rollback = this.newRollback(current?.state ?? null, { reason: "before-import", sourceChecksum: incoming.checksum });
      const rollbackStore = tx.objectStore(ROLLBACK_STORE);
      await requestResult(rollbackStore.add(rollback));
      tx.objectStore(METADATA_STORE).put(rollbackSummaryRecord(rollback));
      await pruneRollbackBackups(rollbackStore, tx.objectStore(METADATA_STORE));
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
    const tx = db.transaction([ROLLBACK_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(tx);
    try {
      const records = await readRollbackSummaries(tx.objectStore(ROLLBACK_STORE), tx.objectStore(METADATA_STORE));
      await done;
      return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    } catch(error) { try { tx.abort(); } catch { /* Already closed. */ } await done.catch(()=>undefined); throw error; }
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
    const tx = db.transaction([APP_STATE_STORE, ROLLBACK_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(tx);
    try {
      const store = tx.objectStore(APP_STATE_STORE);
      const current = await requestResult<CurrentStateRecord | undefined>(store.get(CURRENT_KEY));
      const actualRevision = current?.revision ?? 0;
      assertMatchingRevision(expectedRevision, actualRevision);
      const currentState = current?.state == null ? null : cloneAndParseState(current.state);
      if (currentState?.activeProjectId !== reason.projectId) throw new Error("Rollback deletion target must be the active project");
      const rollback = this.newRollback(currentState, { reason: "before-delete-active-project", projectId: reason.projectId });
      const rollbackStore = tx.objectStore(ROLLBACK_STORE);
      await requestResult(rollbackStore.add(rollback));
      tx.objectStore(METADATA_STORE).put(rollbackSummaryRecord(rollback));
      await pruneRollbackBackups(rollbackStore, tx.objectStore(METADATA_STORE));
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
    const tx = db.transaction([APP_STATE_STORE, ROLLBACK_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(tx);
    try {
      const rawBackup = await requestResult<RollbackBackup | undefined>(tx.objectStore(ROLLBACK_STORE).get(backupId));
      if (rawBackup === undefined) throw new Error(`Rollback backup ${backupId} was not found`);
      const backup = parseRollbackBackup(rawBackup);
      const current = await requestResult<CurrentStateRecord | undefined>(tx.objectStore(APP_STATE_STORE).get(CURRENT_KEY));
      const actualRevision = current?.revision ?? 0;
      assertMatchingRevision(expectedRevision, actualRevision);
      const beforeRestore = this.newRollback(current?.state ?? null, { reason: "before-restore", sourceRollbackBackupId: backup.id });
      const rollbackStore = tx.objectStore(ROLLBACK_STORE);
      await requestResult(rollbackStore.add(beforeRestore));
      tx.objectStore(METADATA_STORE).put(rollbackSummaryRecord(beforeRestore));
      await pruneRollbackBackups(rollbackStore, tx.objectStore(METADATA_STORE));
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

  async createDailyBackup(date: string): Promise<DailyBackupSummary | null> {
    assertISODate(date);
    // Hashing does not hold the actor or an IDB transaction. If a user saves
    // while it runs, retry a fresh snapshot rather than archive a torn revision.
    for (let attempt = 0; attempt < 3; attempt++) {
      const db = await this.database();
      const read = db.transaction([APP_STATE_STORE, DAILY_BACKUP_STORE], 'readonly');
      const readDone = transactionDone(read);
      const [current, existing] = await Promise.all([
        requestResult<CurrentStateRecord | undefined>(read.objectStore(APP_STATE_STORE).get(CURRENT_KEY)),
        requestResult<DailyBackupManifest | undefined>(read.objectStore(DAILY_BACKUP_STORE).get(date)),
      ]);
      await readDone;
      if (existing) return await this.compactDailyBackupHistory();
      if (!current?.state) return null;
      const state = cloneAndParseState(current.state);
      const timeZone = state.calendar.timeZone;
      if (date >= localDateOf(this.now(), timeZone)) throw new Error('每日留档只能保存已结束的本地日期。');
      // A fresh installation has no yesterday to recover. An imported or old
      // workspace can still receive its first history point on the next idle turn.
      if (!state.projects.some(project => localDateOf(project.createdAt, timeZone) <= date)
        && !state.habitBuildings.some(building => localDateOf(building.completedAt, timeZone) <= date)) return null;
      const prepared = await prepareDailyBackup(state, date, this.now().toISOString(), current.revision);
      const tx = db.transaction([APP_STATE_STORE, DAILY_BACKUP_STORE, DAILY_BACKUP_BLOCK_STORE], 'readwrite');
      const done = transactionDone(tx);
      try {
        const actual = await requestResult<CurrentStateRecord | undefined>(tx.objectStore(APP_STATE_STORE).get(CURRENT_KEY));
        assertMatchingRevision(current.revision, actual?.revision ?? 0);
        const manifests = tx.objectStore(DAILY_BACKUP_STORE), content = tx.objectStore(DAILY_BACKUP_BLOCK_STORE);
        const old = (await requestResult<DailyBackupManifest[]>(manifests.getAll())).map(parseDailyManifest);
        const duplicate = old.find(item => item.id === date);
        if (duplicate) { await done; return await this.compactDailyBackupHistory(); }
        if(old.some(item=>item.date>date)){await done;return await this.compactDailyBackupHistory();}
        const retained = retainedDailyBackups([...old, prepared.manifest], date);
        if (!retained.some(item => item.id === date)) throw new Error('本次合并备份超出 200 MiB 或早于现存备份；原有备份和当前记录未更改。');
        const keptIds = new Set(retained.map(item => item.id));
        const keptBlocks = new Set(retained.flatMap(item => item.blocks.map(block => block.id)));
        const existingKeys=await requestResult<IDBValidKey[]>(content.getAllKeys());
        const existingIds=new Set(existingKeys.map(String));
        for (const block of prepared.blocks) if(!existingIds.has(block.id))content.put(block);
        manifests.put(prepared.manifest);
        for (const item of old) if (!keptIds.has(item.id)) manifests.delete(item.id);
        // Keys, not getAll(), avoid cloning up to 200 MiB of contents just to prune.
        for (const key of existingKeys) if (!keptBlocks.has(String(key))) content.delete(key);
        await done;
        return dailyBackupSummary(prepared.manifest);
      } catch (error) {
        try { tx.abort(); } catch { /* A request may already have aborted it. */ }
        await done.catch(() => undefined);
        if (error instanceof StorageConflictError && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error('本地记录持续更新，每日留档稍后重试。');
  }

  async listDailyBackups(): Promise<DailyBackupCollection> {
    const db = await this.database();
    const tx = db.transaction(DAILY_BACKUP_STORE, 'readonly');
    const done = transactionDone(tx);
    const manifests = (await requestResult<DailyBackupManifest[]>(tx.objectStore(DAILY_BACKUP_STORE).getAll())).map(parseDailyManifest);
    await done;
    return { backups: manifests.sort((a, b) => b.date.localeCompare(a.date)).map(dailyBackupSummary),
      storedBytes: dailyBackupStoredBytes(manifests), retentionDays: DAILY_BACKUP_RETENTION_DAYS, maximumBytes: DAILY_BACKUP_MAX_BYTES };
  }

  /** Upgrade multi-date normal history only after its newest state validates.
   * Operation rollback points live in a separate store and are never pruned here. */
  private async compactDailyBackupHistory(): Promise<DailyBackupSummary | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const db = await this.database();
      const read = db.transaction(DAILY_BACKUP_STORE, 'readonly');
      const readDone = transactionDone(read);
      const prior = (await requestResult<DailyBackupManifest[]>(read.objectStore(DAILY_BACKUP_STORE).getAll())).map(parseDailyManifest)
        .sort((a,b) => b.date.localeCompare(a.date));
      await readDone;
      if (!prior[0]) return null;
      if (prior.length === 1) return dailyBackupSummary(prior[0]);
      const latest = prior[0];
      await this.readDailyBackup(latest.id); // Missing/corrupt contents preserve every old index.
      const tx = db.transaction([DAILY_BACKUP_STORE, DAILY_BACKUP_BLOCK_STORE], 'readwrite');
      const done = transactionDone(tx), manifests = tx.objectStore(DAILY_BACKUP_STORE), content = tx.objectStore(DAILY_BACKUP_BLOCK_STORE);
      try {
        const current = (await requestResult<DailyBackupManifest[]>(manifests.getAll())).map(parseDailyManifest)
          .sort((a,b) => b.date.localeCompare(a.date));
        if (current[0]?.id !== latest.id || current[0]?.stateBlock !== latest.stateBlock) { await done; continue; }
        const referenced = new Set(latest.blocks.map(block => block.id));
        for (const old of current.slice(1)) manifests.delete(old.id);
        for (const key of await requestResult<IDBValidKey[]>(content.getAllKeys())) if (!referenced.has(String(key))) content.delete(key);
        await done;
        return dailyBackupSummary(latest);
      } catch(error){
        try{tx.abort();}catch{/* It may have aborted already. */}
        await done.catch(()=>undefined);throw error;
      }
    }
    throw new Error('合并备份正在更新，稍后重试。');
  }

  private async readDailyBackup(backupId: string): Promise<{ state: DomainState; manifest: DailyBackupManifest }> {
    assertISODate(backupId);
    const db = await this.database();
    const tx = db.transaction([DAILY_BACKUP_STORE, DAILY_BACKUP_BLOCK_STORE], 'readonly');
    const done = transactionDone(tx);
    const raw = await requestResult<DailyBackupManifest | undefined>(tx.objectStore(DAILY_BACKUP_STORE).get(backupId));
    if (!raw) { await done; throw new Error('这份每日留档已不存在，当前记录未更改。'); }
    const manifest = parseDailyManifest(raw);
    const blocks = await Promise.all(manifest.blocks.map(reference => requestResult<DailyBackupBlock | undefined>(tx.objectStore(DAILY_BACKUP_BLOCK_STORE).get(reference.id))));
    await done;
    return { state: await expandDailyBackup(manifest, blocks), manifest };
  }

  async exportDailyBackup(backupId: string): Promise<string> {
    const { state, manifest } = await this.readDailyBackup(backupId);
    return JSON.stringify(await createBackupEnvelope(state, new Date(manifest.createdAt)));
  }

  async restoreDailyBackup(backupId: string, expectedRevision: number): Promise<{ rollbackBackupId: string; revision: number }> {
    assertExpectedRevision(expectedRevision);
    const { state } = await this.readDailyBackup(backupId);
    const db = await this.database();
    const tx = db.transaction([APP_STATE_STORE, ROLLBACK_STORE, METADATA_STORE], 'readwrite');
    const done = transactionDone(tx);
    try {
      const store = tx.objectStore(APP_STATE_STORE);
      const current = await requestResult<CurrentStateRecord | undefined>(store.get(CURRENT_KEY));
      assertMatchingRevision(expectedRevision, current?.revision ?? 0);
      const rollback = this.newRollback(current?.state ?? null, { reason: 'before-restore', sourceRollbackBackupId: `daily:${backupId}` });
      const rollbackStore = tx.objectStore(ROLLBACK_STORE);
      await requestResult(rollbackStore.add(rollback));
      tx.objectStore(METADATA_STORE).put(rollbackSummaryRecord(rollback));
      await pruneRollbackBackups(rollbackStore, tx.objectStore(METADATA_STORE));
      const revision = expectedRevision + 1;
      store.put({ id: CURRENT_KEY, revision, state } satisfies CurrentStateRecord);
      await done;
      return { rollbackBackupId: rollback.id, revision };
    } catch (error) {
      try { tx.abort(); } catch { /* Preserve the original failure. */ }
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

function rollbackSummaryRecord(backup: RollbackBackup) {
  const { state, ...header } = backup;
  return { id: `${ROLLBACK_SUMMARY_PREFIX}${backup.id}`, backup: { ...header, summary: stateSummary(state) } };
}

/** Listing reads keys and a tiny index, never the retained blueprint payloads.
 * Legacy records get their index once. Restore still validates the full state. */
async function readRollbackSummaries(store: IDBObjectStore, metadata: IDBObjectStore): Promise<RollbackBackupSummary[]> {
  const keys = await requestResult<IDBValidKey[]>(store.getAllKeys());
  const cached = await requestResult<Array<{id:string;backup?:RollbackBackupSummary}>>(metadata.getAll());
  const byId = new Map(cached.filter(item=>item.id.startsWith(ROLLBACK_SUMMARY_PREFIX)).map(item=>[item.id,item.backup]));
  const result: RollbackBackupSummary[] = [];
  for (const key of keys) {
    const metadataId = `${ROLLBACK_SUMMARY_PREFIX}${String(key)}`;
    let summary = byId.get(metadataId);
    if (!summary) {
      const raw = await requestResult<RollbackBackup>(store.get(key));
      // Only the envelope and display counts are needed for a legacy index.
      // This does not make the payload eligible for restore without validation.
      const header = parseRollbackBackup({...raw,state:null});
      const indexed = rollbackSummaryRecord({...header,state:raw.state} as RollbackBackup);
      summary = indexed.backup; metadata.put(indexed);
    }
    const { summary: counts, ...header } = summary;
    parseRollbackBackup({...header,state:null});
    if (summary.id !== String(key) || !counts || typeof counts.isEmpty !== 'boolean'
      || ['projectCount','subtaskCount','monumentCount','completedFocusCount','interruptedFocusCount','progressReportCount']
        .some(field=>!Number.isSafeInteger(counts[field as keyof typeof counts])||Number(counts[field as keyof typeof counts])<0)
      || !Array.isArray(counts.blueprintIds)||counts.blueprintIds.some(id=>typeof id!=='string')
      || [counts.activeProjectId,counts.activeProjectTitle,counts.activeBlueprintId].some(value=>value!==null&&typeof value!=='string')) {
      throw new Error('Invalid rollback summary');
    }
    result.push(summary);
  }
  const expected = new Set(keys.map(key=>`${ROLLBACK_SUMMARY_PREFIX}${String(key)}`));
  for (const item of cached) if(item.id.startsWith(ROLLBACK_SUMMARY_PREFIX)&&!expected.has(item.id))metadata.delete(item.id);
  return result;
}

async function pruneRollbackBackups(store: IDBObjectStore, metadata: IDBObjectStore): Promise<void> {
  const records = await readRollbackSummaries(store, metadata);
  records
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(MAX_ROLLBACK_BACKUPS)
    .forEach((record) => { store.delete(record.id); metadata.delete(`${ROLLBACK_SUMMARY_PREFIX}${record.id}`); });
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
      if (!db.objectStoreNames.contains(DAILY_BACKUP_STORE)) db.createObjectStore(DAILY_BACKUP_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DAILY_BACKUP_BLOCK_STORE)) db.createObjectStore(DAILY_BACKUP_BLOCK_STORE, { keyPath: 'id' });
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
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
  void completion.catch(() => undefined);
  return completion;
}
