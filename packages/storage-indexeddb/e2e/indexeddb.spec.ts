import { expect, test } from "@playwright/test";

const state = (title: string) => ({
  schemaVersion: 7 as const,
  projects: [{ id: "p1", kind: "finite" as const, habit: null, settlementIndex: 0, title, blueprintId: "small", importedBlueprint: null, createdAt: "2026-07-23T08:00:00.000Z", status: "active" as const, subtaskStructureLocked: false, subtasks: [{ id: "s1", title: "First", order: 0, progressBasisPoints: 0 }] }],
  habitBuildings: [],
  activeProjectId: "p1",
  retiredSubtaskIds: [],
  activeFocusSession: null,
  focusHistory: [],
  progressReports: [],
  dailyGoals: [],
  calendar: { timeZone: "Asia/Shanghai", restWeekdays: [0, 6] },
  decayPolicy: { enabled: false, gracePlannedDays: 2, repairMultiplierBasisPoints: 20_000, damagePerMissedPlannedDayBasisPoints: null },
  projectConditions: [{ projectId: "p1", conditionBasisPoints: 10_000, inactivityAnchorAt: null, assessedMissedPlannedDays: 0 }],
  focusIntegrityPolicy: { enabled: true, maxEffectiveExcursions: 3 },
  decorationBlueprintResources: [],
  decorationRewards: [],
  buildingBlueprintResources: [],
  worldSettings: { worldSeed: "fixture-world", terrainGenerationVersion: 4 as const, environmentStyle: "natural-valley" as const },
});

test("real browser saves across reload, previews without mutation, replaces and restores", async ({ page }) => {
  await page.goto("/e2e/");
  await page.waitForFunction(() => Boolean(window.storageHarness));
  await page.evaluate(async (value) => {
    const repository = window.storageHarness.create("browser-storage");
    const snapshot = await repository.load();
    await repository.save(value, snapshot.revision);
  }, state("Current"));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.storageHarness));
  expect(await page.evaluate(async () => (await window.storageHarness.create("browser-storage").load()).state?.projects[0]?.title)).toBe("Current");

  const backup = await page.evaluate(async (incoming) => {
    const source = window.storageHarness.create("browser-source");
    await source.save(incoming, (await source.load()).revision);
    return source.exportBackup();
  }, state("Incoming"));
  const preview = await page.evaluate(async (input) => window.storageHarness.create("browser-storage").previewImport(input), backup);
  expect(preview.summary.activeProjectTitle).toBe("Incoming");
  expect(await page.evaluate(async () => (await window.storageHarness.create("browser-storage").load()).state?.projects[0]?.title)).toBe("Current");
  const staleBeforeImport = await page.evaluate(async () => (await window.storageHarness.create("browser-storage").load()).revision);

  const result = await page.evaluate(async (input) => {
    const repository = window.storageHarness.create("browser-storage");
    return repository.replaceFromImport(input, (await repository.load()).revision);
  }, backup);
  expect(result.revision).toBe(2);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.storageHarness));
  expect(await page.evaluate(async () => (await window.storageHarness.create("browser-storage").load()).state?.projects[0]?.title)).toBe("Incoming");
  expect(await page.evaluate(async ({ value, revision }) => {
    try { await window.storageHarness.create("browser-storage").save(value, revision); return "saved"; }
    catch (error) { return (error as { code?: string }).code; }
  }, { value: state("Stale after import"), revision: staleBeforeImport })).toBe("STORAGE_CONFLICT");
  const postImportRevision = await page.evaluate(async (value) => {
    const repository = window.storageHarness.create("browser-storage");
    const snapshot = await repository.load();
    return repository.save(value, snapshot.revision);
  }, state("Incoming after explicit reload"));
  expect(postImportRevision).toBe(3);
  await page.evaluate(async (id) => {
    const repository = window.storageHarness.create("browser-storage");
    return repository.restoreRollback(id, (await repository.load()).revision);
  }, result.rollbackBackupId);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.storageHarness));
  expect(await page.evaluate(async () => (await window.storageHarness.create("browser-storage").load()).state?.projects[0]?.title)).toBe("Current");
  expect(await page.evaluate(async ({ value, revision }) => {
    try { await window.storageHarness.create("browser-storage").save(value, revision); return "saved"; }
    catch (error) { return (error as { code?: string }).code; }
  }, { value: state("Stale after restore"), revision: postImportRevision })).toBe("STORAGE_CONFLICT");
  expect(await page.evaluate(async (value) => {
    const repository = window.storageHarness.create("browser-storage");
    const snapshot = await repository.load();
    return repository.save(value, snapshot.revision);
  }, state("Current after explicit reload"))).toBe(5);
  expect(await page.evaluate(async () => (await window.storageHarness.create("browser-storage").listRollbackBackups()).map((item) => item.id))).toContain(result.rollbackBackupId);

  const upgrade = await page.evaluate(async () => {
    const held = window.storageHarness.create("browser-storage");
    await held.load();
    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open("browser-storage", 2);
      const timeout = window.setTimeout(() => reject(new Error("external v2 upgrade remained blocked")), 2000);
      request.onupgradeneeded = () => request.result.createObjectStore("external-v2-proof");
      request.onerror = () => { window.clearTimeout(timeout); reject(request.error); };
      request.onblocked = () => { /* Allow onversionchange handlers time to release every v1 connection. */ };
      request.onsuccess = () => {
        window.clearTimeout(timeout);
        const names = Array.from(request.result.objectStoreNames);
        request.result.close();
        resolve(names.includes("external-v2-proof") ? "upgraded" : "missing-proof-store");
      };
    });
  });
  expect(upgrade).toBe("upgraded");
});
