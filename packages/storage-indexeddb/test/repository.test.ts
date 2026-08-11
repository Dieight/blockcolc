import "fake-indexeddb/auto";
import { createInitialState } from "@tomato-clock/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { BackupValidationError, IndexedDbStateRepository, canonicalJson, sha256 } from "../src/index.js";
import { projectState } from "./fixture.js";

let sequence = 0;
let rollbackSequence = 0;
let repository: IndexedDbStateRepository;

beforeEach(() => {
  sequence += 1;
  rollbackSequence = 0;
  repository = new IndexedDbStateRepository({
    databaseName: `storage-test-${sequence}`,
    now: () => new Date("2026-07-23T10:00:00.000Z"),
    newId: () => `rollback-${sequence}-${++rollbackSequence}`,
  });
});

describe("IndexedDbStateRepository", () => {
  it("starts empty, saves, reloads, and prevents input/output aliases", async () => {
    expect(await repository.load()).toEqual({ state: null, revision: 0 });
    const state = projectState();
    expect(await repository.save(state, 0)).toBe(1);
    state.projects[0]!.title = "mutated input";
    const first = await repository.load();
    expect(first.state?.projects[0]?.title).toBe("Build a portfolio");
    first.state!.projects[0]!.title = "mutated output";
    expect((await repository.load()).state?.projects[0]?.title).toBe("Build a portfolio");
  });

  it("makes repeated saves idempotent", async () => {
    const state = projectState();
    expect(await repository.save(state, 0)).toBe(1);
    expect(await repository.save(structuredClone(state), 1)).toBe(2);
    expect(await repository.load()).toEqual({ state, revision: 2 });
  });

  it("rejects a stale writer with a stable conflict and preserves the first commit", async () => {
    const databaseName = `conflict-${sequence}`;
    const first = new IndexedDbStateRepository({ databaseName });
    const second = new IndexedDbStateRepository({ databaseName });
    const firstRead = await first.load();
    const secondRead = await second.load();
    await first.save(projectState("First writer"), firstRead.revision);
    await expect(second.save(projectState("Stale writer"), secondRead.revision)).rejects.toMatchObject({
      name: "StorageConflictError",
      code: "STORAGE_CONFLICT",
      expectedRevision: 0,
      actualRevision: 1,
    });
    expect((await first.load()).state?.projects[0]?.title).toBe("First writer");

    const neverLoaded = new IndexedDbStateRepository({ databaseName });
    await expect(neverLoaded.save(projectState("Blind writer"), 0)).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });
    expect((await first.load()).state?.projects[0]?.title).toBe("First writer");
  });

  it("does not let export refresh a stale writer token", async () => {
    const databaseName = `export-token-${sequence}`;
    const stale = new IndexedDbStateRepository({ databaseName });
    const writer = new IndexedDbStateRepository({ databaseName });
    const staleRead = await stale.load();
    await writer.save(projectState("Committed"), 0);
    await expect(stale.exportBackup()).resolves.toContain('"format":"tomato-clock-backup"');
    await expect(stale.save(projectState("Must conflict"), staleRead.revision)).rejects.toMatchObject({
      code: "STORAGE_CONFLICT",
      expectedRevision: 0,
      actualRevision: 1,
    });
    expect((await writer.load()).state?.projects[0]?.title).toBe("Committed");
  });

  it("previews without mutating current data or creating rollback records", async () => {
    await repository.save(projectState("Current"), 0);
    const source = new IndexedDbStateRepository({ databaseName: `export-${sequence}`, now: () => new Date("2026-07-23T09:00:00.000Z") });
    await source.save(projectState("Incoming"), 0);
    const preview = await repository.previewImport(await source.exportBackup());
    expect(preview.summary).toMatchObject({ projectCount: 1, activeProjectTitle: "Incoming", monumentCount: 0 });
    expect((await repository.load()).state?.projects[0]?.title).toBe("Current");
    expect(await repository.listRollbackBackups()).toEqual([]);
  });

  it("atomically aborts rollback and replacement after an injected failure", async () => {
    await repository.save(projectState("Current"), 0);
    const source = new IndexedDbStateRepository({ databaseName: `abort-export-${sequence}` });
    await source.save(projectState("Incoming"), 0);
    const backup = await source.exportBackup();
    await expect(repository.replaceFromImport(backup, 1, { injectFailureAfterRollbackWrite: true })).rejects.toThrow("Injected");
    expect((await repository.load()).state?.projects[0]?.title).toBe("Current");
    expect(await repository.listRollbackBackups()).toEqual([]);
  });

  it("replaces without merging and restores the immutable rollback", async () => {
    await repository.save(projectState("Current"), 0);
    const staleBeforeImport = await repository.load();
    const source = new IndexedDbStateRepository({ databaseName: `replace-export-${sequence}` });
    await source.save(projectState("Incoming"), 0);
    const { rollbackBackupId, revision: importedRevision } = await repository.replaceFromImport(await source.exportBackup(), 1);
    expect(importedRevision).toBe(2);
    await expect(repository.save(projectState("Stale after import"), staleBeforeImport.revision)).rejects.toMatchObject({ code: "STORAGE_CONFLICT", actualRevision: 2 });
    const imported = await repository.load();
    expect(imported.state?.projects[0]?.title).toBe("Incoming");
    expect(await repository.save(projectState("Saved after reload"), imported.revision)).toBe(3);
    const summaries = await repository.listRollbackBackups();
    expect(summaries).toEqual([expect.objectContaining({ id: rollbackBackupId, reason: "before-import" })]);
    const restored = await repository.restoreRollback(rollbackBackupId, 3);
    expect(restored.revision).toBe(4);
    await expect(repository.save(projectState("Stale after restore"), 3)).rejects.toMatchObject({ code: "STORAGE_CONFLICT", actualRevision: 4 });
    const restoredState = await repository.load();
    expect(restoredState.state?.projects[0]?.title).toBe("Current");
    expect(await repository.save(projectState("Fresh after restore"), restoredState.revision)).toBe(5);
    expect((await repository.listRollbackBackups()).map((item) => item.id)).toEqual([restored.rollbackBackupId, rollbackBackupId]);
  });

  it("keeps only the two most recent automatic rollback backups", async () => {
    await repository.save(projectState("Original"), 0);
    const rollbackIds: string[] = [];
    let revision = 1;
    for (const title of ["First import", "Second import", "Third import"]) {
      const source = new IndexedDbStateRepository({ databaseName: `rotation-export-${sequence}-${revision}` });
      await source.save(projectState(title), 0);
      const result = await repository.replaceFromImport(await source.exportBackup(), revision);
      rollbackIds.push(result.rollbackBackupId);
      revision = result.revision;
    }

    const retained = (await repository.listRollbackBackups()).map((item) => item.id);
    expect(retained).toEqual([rollbackIds[2], rollbackIds[1]]);
    expect(retained).not.toContain(rollbackIds[0]);
  });

  it("imports into an empty installation and can restore the empty state", async () => {
    const source = new IndexedDbStateRepository({ databaseName: `fresh-export-${sequence}` });
    await source.save(projectState("Recovered"), 0);
    const { rollbackBackupId } = await repository.replaceFromImport(await source.exportBackup(), 0);
    expect((await repository.load()).state?.projects[0]?.title).toBe("Recovered");
    await repository.restoreRollback(rollbackBackupId, 1);
    expect(await repository.load()).toEqual({ state: null, revision: 2 });
  });

  it("saves an active-project deletion with its rollback in one compare-and-swap transaction", async () => {
    await repository.save(projectState("Current"), 0);
    const replacement = projectState("Current");
    replacement.projects[0]!.status = "deleted";
    replacement.activeProjectId = null;
    const result = await repository.saveWithRollback(replacement, 1, { type: "before-delete-active-project", projectId: "project-1" });
    expect(result.revision).toBe(2);
    expect((await repository.load()).state?.projects).toMatchObject([{ id: "project-1", status: "deleted" }]);
    expect(await repository.listRollbackBackups()).toEqual([expect.objectContaining({
      id: result.rollbackBackupId,
      reason: "before-delete-active-project",
      projectId: "project-1",
      summary: expect.objectContaining({ activeProjectTitle: "Current" }),
    })]);
    await expect(repository.saveWithRollback(replacement, 1, { type: "before-delete-active-project", projectId: "project-1" })).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });
  });

  it("rejects invalid domain schema and cross-record invariants on save", async () => {
    await expect(repository.save({ ...createInitialState(), schemaVersion: 99 } as never, 0)).rejects.toThrow("schemaVersion");
    const broken = projectState();
    broken.activeProjectId = "missing";
    await expect(repository.save(broken, 0)).rejects.toThrow("activeProjectId");
    expect(await repository.load()).toEqual({ state: null, revision: 0 });
  });

  it("fails closed on unknown envelope fields, domain violations, and checksum damage", async () => {
    await repository.save(projectState(), 0);
    const valid = JSON.parse(await repository.exportBackup()) as Record<string, unknown>;
    await expect(repository.previewImport(JSON.stringify({ ...valid, extra: true }))).rejects.toBeInstanceOf(BackupValidationError);

    const invalidPayload = structuredClone(valid) as Record<string, unknown>;
    (invalidPayload.payload as Record<string, unknown>).activeProjectId = "missing";
    const unsigned = Object.fromEntries(Object.entries(invalidPayload).filter(([key]) => key !== "checksum"));
    invalidPayload.checksum = await sha256(unsigned);
    await expect(repository.previewImport(JSON.stringify(invalidPayload))).rejects.toThrow("Invalid domain state");

    const unknownDomainField = structuredClone(valid) as Record<string, unknown>;
    (unknownDomainField.payload as Record<string, unknown>).futureField = true;
    const unknownUnsigned = Object.fromEntries(Object.entries(unknownDomainField).filter(([key]) => key !== "checksum"));
    unknownDomainField.checksum = await sha256(unknownUnsigned);
    await expect(repository.previewImport(JSON.stringify(unknownDomainField))).rejects.toThrow("Invalid domain state");

    valid.checksum = "0".repeat(64);
    await expect(repository.previewImport(JSON.stringify(valid))).rejects.toThrow("checksum mismatch");
  });

  it("uses sorted object keys for canonical JSON and checksum verification", async () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    await repository.save(projectState(), 0);
    const envelope = JSON.parse(await repository.exportBackup()) as Record<string, unknown>;
    const reordered = { checksum: envelope.checksum, payload: envelope.payload, exportedAt: envelope.exportedAt, schemaVersion: 1, format: envelope.format };
    await expect(repository.previewImport(JSON.stringify(reordered))).resolves.toMatchObject({ schemaVersion: 1 });
  });
});
