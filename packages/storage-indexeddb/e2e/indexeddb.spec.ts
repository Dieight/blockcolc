import { expect, test } from "@playwright/test";

const state = (title: string) => ({
  schemaVersion: 13 as const,
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
  focusIntegrityPolicy: { enabled: true, maxEffectiveExcursions: 3, excursionThresholdSeconds: 3 },
  decorationBlueprintResources: [],
  decorationRewards: [],
  holidayRewards: [],
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
      const request = indexedDB.open("browser-storage", 3);
      const timeout = window.setTimeout(() => reject(new Error("external v3 upgrade remained blocked")), 2000);
      request.onupgradeneeded = () => request.result.createObjectStore("external-v3-proof");
      request.onerror = () => { window.clearTimeout(timeout); reject(request.error); };
      request.onblocked = () => { /* Allow onversionchange handlers time to release every v2 connection. */ };
      request.onsuccess = () => {
        window.clearTimeout(timeout);
        const names = Array.from(request.result.objectStoreNames);
        request.result.close();
        resolve(names.includes("external-v3-proof") ? "upgraded" : "missing-proof-store");
      };
    });
  });
  expect(upgrade).toBe("upgraded");
});

test("one merged daily checkpoint survives reload; an earlier external export remains independently restorable", async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-25T00:00:00Z'));
  await page.goto('/e2e/');
  await page.waitForFunction(() => Boolean(window.storageHarness));
  const firstExport=await page.evaluate(async value => {
    const repository=window.storageHarness.create('browser-merged-daily');
    await repository.save(value,0);await repository.createDailyBackup('2026-07-23');
    const exported=await repository.exportDailyBackup('2026-07-23');
    const next=structuredClone(value);next.projects[0]!.title='Second checkpoint';
    await repository.save(next,1);await repository.createDailyBackup('2026-07-24');
    return exported;
  },state('First checkpoint'));
  await page.reload();await page.waitForFunction(()=>Boolean(window.storageHarness));
  const contents=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('browser-merged-daily');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{return await new Promise<{manifests:Array<{id:string;stateBlock:string;blocks:Array<{id:string}>}>;blocks:Array<{id:string;data:Uint8Array}>}>((resolve,reject)=>{
      const tx=db.transaction(['dailyBackups','dailyBackupBlocks']);
      const manifests=tx.objectStore('dailyBackups').getAll(),blocks=tx.objectStore('dailyBackupBlocks').getAll();
      tx.oncomplete=()=>resolve({manifests:manifests.result,blocks:blocks.result});tx.onabort=()=>reject(tx.error);
    }).then(({manifests,blocks})=>({manifests,roots:manifests.map(m=>JSON.parse(new TextDecoder().decode(blocks.find(b=>b.id===m.stateBlock)!.data))),stored:blocks.length}));}
    finally{db.close();}
  });
  expect(contents.manifests).toHaveLength(1);
  expect(contents.roots.map(root=>root.format)).toEqual(['blockcolc-daily-merged-v2']);
  expect(contents.manifests[0]!.id).toBe('2026-07-24');
  expect(contents.stored).toBe(contents.manifests[0]!.blocks.length);
  for(const [date,title] of [['2026-07-24','Second checkpoint']]){
    const actual=await page.evaluate(async date=>{
      const repository=window.storageHarness.create('browser-merged-daily');
      const snapshot=await repository.load();await repository.restoreDailyBackup(date!,snapshot.revision);
      const backup=await repository.exportDailyBackup(date!);
      return {title:(await repository.load()).state!.projects[0]!.title,preview:(await repository.previewImport(backup)).summary.activeProjectTitle};
    },date);
    expect(actual).toEqual({title,preview:title});
  }
  expect(await page.evaluate(async exported=>{
    const restored=window.storageHarness.create('browser-exported-daily');
    await restored.replaceFromImport(exported,0);
    return (await restored.load()).state!.projects[0]!.title;
  },firstExport)).toBe('First checkpoint');
});
