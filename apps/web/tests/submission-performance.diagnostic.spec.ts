import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand, type DomainState } from '@blockcolc/domain';
import { readPersistedDomainState } from './persisted-domain-state';
import { fixBusinessDate } from './fixed-business-date';
import { waitForPreparedWorld } from './world-ready';

const startedAt = Date.parse('2026-09-27T12:00:00+08:00');
const completedAt = startedAt + 130_000;

function reportFixture(marathon = false): DomainState {
  let state = createInitialState('Asia/Shanghai');
  const run = (command: DomainCommand, at: number) => {
    const result = execute(state, command, { now: () => new Date(at) });
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  };
  run({ type: 'CreateProject', projectId: 'private-performance-project', title: '不应进入性能记录的任务正文',
    blueprintId: 'builtin-small-workshop', subtasks: [{ id: 'private-performance-subtask', title: '不应进入性能记录的小任务' }] }, startedAt);
  run({ type: 'StartFocus', sessionId: 'private-performance-first', subtaskId: 'private-performance-subtask', plannedDurationMs: 60_000 }, startedAt);
  run({ type: 'CompleteFocus' }, startedAt + 60_000);
  run({ type: 'ReportSubtaskProgress', reportId: 'private-performance-baseline', subtaskId: 'private-performance-subtask',
    focusSessionIds: ['private-performance-first'], progressBasisPoints: 5_000 }, startedAt + 60_000);
  run(marathon
    ? { type: 'StartFocus', sessionId: 'private-performance-pending', projectId: 'private-performance-project',
      subtaskId: null, marathon: true, deferredSettlement: true, plannedDurationMs: 60_000 }
    : { type: 'StartFocus', sessionId: 'private-performance-pending', subtaskId: 'private-performance-subtask', plannedDurationMs: 60_000 }, startedAt + 70_000);
  run({ type: 'CompleteFocus' }, completedAt);
  return state;
}

interface DiagnosticRecord {
  token: number;
  category: string;
  submittedAtMs: number;
  terminal: string;
  worldKeyChanged: boolean | null;
  failedPhase: string | null;
  phases: Array<{ stage: string; atMs: number; elapsedMs?: number; persistenceCommitted?: boolean;
    rebuildCount?: number; frameCommittedAtMs?: number }>;
}

function records(page: Page): Promise<DiagnosticRecord[]> {
  return page.evaluate(() => {
    const api = (window as typeof window & { __blockcolcSubmissionPerformance?: { read(): DiagnosticRecord[] } })
      .__blockcolcSubmissionPerformance;
    if (!api) throw new Error('Submission diagnostics require the production test-mode server (--production --diagnostics).');
    return api.read();
  });
}

async function seed(page: Page, marathon = false, minimal = false) {
  // Freeze business dates only. CPU durations and observer timers must use
  // the real monotonic clock, not Playwright's simulated performance.now().
  await fixBusinessDate(page, new Date(completedAt + 10_000));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.evaluate(async ({ state, marathon, minimal }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('appState', 'readwrite');
        const store = transaction.objectStore('appState');
        const current = store.get('current');
        current.onsuccess = () => store.put({ id: 'current', revision: (current.result?.revision ?? 0) + 1, state });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
    localStorage.setItem('blockcolc-first-project-setup-v1', '1');
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({ focusMinutes: 1, breakMinutes: 1, minimalMode: minimal }));
    if (marathon) localStorage.setItem('blockcolc-round-plan-v1', JSON.stringify({
      projectId: 'private-performance-project', subtaskId: null, mode: 'marathon', deferredSettlement: true,
      totalRounds: 1, completedRounds: 1, status: 'report', reportedSessionIds: [],
    }));
    else localStorage.removeItem('blockcolc-round-plan-v1');
  }, { state: reportFixture(marathon), marathon, minimal });
  await page.reload();
  expect(await page.evaluate(() => /\[native code\]/.test(performance.now.toString()))).toBe(true);
  await waitForPreparedWorld(page);
  // Marathon reports now share the immersive report surface in both modes.
  if (marathon) {
    const report = page.locator('.focus-report-surface--minimal');
    await expect(report).toBeVisible();
    await expect(report.getByRole('heading', { name: '1 分钟', exact: true })).toBeVisible();
    await expect(report).toContainText('1 轮专注已结束');
  } else {
    await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
  }
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 20_000 });
  const count = (await canvas.getAttribute('data-world-rebuild-count'))!;
  await expect(canvas).toHaveAttribute('data-rendered-world-rebuild-count', count, { timeout: 20_000 });
  await page.evaluate(() => (window as typeof window & { __blockcolcSubmissionPerformance: { reset(): void } })
    .__blockcolcSubmissionPerformance.reset());
  return { canvas, before: await readPersistedDomainState(page), rebuildCount: Number(count) };
}

function assertSafeRecord(record: DiagnosticRecord) {
  const text = JSON.stringify(record);
  expect(text).not.toContain('private-performance');
  expect(text).not.toContain('不应进入性能记录');
  expect(record.phases.length).toBeLessThanOrEqual(12);
  expect(record.phases.every(phase => Number.isFinite(phase.atMs))).toBe(true);
}

for (const changed of [false, true]) {
  test(`real ordinary report ${changed ? 'changes the world and waits for its committed frame' : 'saves unchanged progress without rebuilding'}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const { canvas, before, rebuildCount } = await seed(page);
    await page.getByRole('button', { name: changed ? '推进至 75%' : '保持 50%', exact: true }).click();
    await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toHaveCount(0);
    await expect.poll(async () => (await records(page)).at(-1)?.terminal,
      { timeout: 20_000 }).toBe(changed ? 'frame-committed' : 'unchanged');
    const result = (await records(page)).at(-1)!;
    const after = await readPersistedDomainState(page);
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.state.progressReports.length).toBe(before.state.progressReports.length + 1);
    expect(after.state.projects[0]!.subtasks[0]!.progressBasisPoints).toBe(changed ? 7_500 : 5_000);
    expect(result.category).toBe('progress');
    expect(result.worldKeyChanged).toBe(changed);
    expect(result.failedPhase).toBeNull();
    expect(result.phases.find(phase => phase.stage === 'dispatch-completed')?.persistenceCommitted).toBe(true);
    expect(result.phases.some(phase => phase.stage === 'projection-completed')).toBe(true);
    if (changed) {
      const committed = result.phases.find(phase => phase.stage === 'renderer-frame-committed')!;
      expect(committed.rebuildCount).toBeGreaterThan(rebuildCount);
      expect(committed.frameCommittedAtMs).toBeGreaterThanOrEqual(result.submittedAtMs);
      expect(Number(await canvas.getAttribute('data-world-rebuild-count'))).toBeGreaterThan(rebuildCount);
    } else {
      expect(Number(await canvas.getAttribute('data-world-rebuild-count'))).toBe(rebuildCount);
      expect(result.phases.some(phase => phase.stage === 'renderer-rebuild-requested')).toBe(false);
      expect(result.phases.some(phase => phase.stage === 'renderer-frame-committed')).toBe(false);
    }
    assertSafeRecord(result);
    await testInfo.attach('real-submit-observation', { body: Buffer.from(JSON.stringify({ result,
      rendererRebuildMs: Number(await canvas.getAttribute('data-world-rebuild-last-ms')),
      rendererRebuildStagesMs: JSON.parse((await canvas.getAttribute('data-world-rebuild-stages-ms')) ?? '{}'),
      terrainGenerationCacheHit: await canvas.getAttribute('data-terrain-generation-cache-hit'),
      terrainCellCount: Number(await canvas.getAttribute('data-terrain-cell-count')),
      scope: 'Real UI and IndexedDB; CPU renderer commit boundary, not GPU presentation or Android speed.' }, null, 2)), contentType: 'application/json' });
  });
}

test('a real IndexedDB save failure retains the report and a retry gets a fresh successful observation', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { before, rebuildCount, canvas } = await seed(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let injected = false;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (!injected && this.name === 'appState' && this.transaction.mode === 'readwrite') {
        injected = true;
        IDBObjectStore.prototype.put = original;
        throw new DOMException('Injected save failure', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '推进至 75%', exact: true }).click();
  await expect.poll(async () => (await records(page)).at(-1)?.terminal).toBe('failed');
  await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
  const failed = (await records(page)).at(-1)!;
  const rejected = await readPersistedDomainState(page);
  expect(rejected.revision).toBe(before.revision);
  expect(rejected.state.progressReports).toEqual(before.state.progressReports);
  expect(Number(await canvas.getAttribute('data-world-rebuild-count'))).toBe(rebuildCount);
  expect(failed.failedPhase).toBe('dispatch');
  expect(failed.phases.some(phase => phase.persistenceCommitted)).toBe(false);
  await page.getByRole('button', { name: '推进至 75%', exact: true }).click();
  await expect.poll(async () => (await records(page)).at(-1)?.terminal,
    { timeout: 20_000 }).toBe('frame-committed');
  const succeeded = (await records(page)).at(-1)!;
  expect(succeeded.token).not.toBe(failed.token);
  expect((await readPersistedDomainState(page)).state.progressReports.length).toBe(before.state.progressReports.length + 1);
  for (const record of [failed, succeeded]) assertSafeRecord(record);
  await testInfo.attach('save-failure-and-retry', { body: Buffer.from(JSON.stringify({ failed, succeeded }, null, 2)), contentType: 'application/json' });
});

test('the real deferred marathon report attributes its round once and observes the resulting frame', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { before, rebuildCount, canvas } = await seed(page, true);
  const report = page.locator('.marathon-progress-report');
  await report.locator('.marathon-settlement-head').first().click();
  const row = report.locator('.marathon-report-row').first();
  await row.getByRole('button', { name: '推进至 75%', exact: true }).click();
  await row.getByRole('button', { name: /增加 .*计入轮数/ }).click();
  await report.getByRole('button', { name: '一次提交本次推进', exact: true }).click();
  await expect(report).toHaveCount(0);
  await expect.poll(async () => (await records(page)).at(-1)?.terminal,
    { timeout: 20_000 }).toBe('frame-committed');
  const result = (await records(page)).at(-1)!;
  expect(await records(page)).toHaveLength(1);
  expect(result.category).toBe('marathon');
  expect(result.worldKeyChanged).toBe(true);
  expect(result.phases.find(phase => phase.stage === 'dispatch-completed')?.persistenceCommitted).toBe(true);
  expect(result.phases.find(phase => phase.stage === 'renderer-frame-committed')?.rebuildCount).toBeGreaterThan(rebuildCount);
  const after = await readPersistedDomainState(page);
  expect(after.state.projects[0]!.subtasks[0]!.progressBasisPoints).toBe(7_500);
  expect(after.state.progressReports.length).toBe(before.state.progressReports.length + 1);
  expect(after.state.focusHistory.find(session => session.id === 'private-performance-pending')?.settledAt).toBeDefined();
  assertSafeRecord(result);
  await testInfo.attach('real-marathon-submit-observation', { body: Buffer.from(JSON.stringify({ result,
    rendererRebuildMs: Number(await canvas.getAttribute('data-world-rebuild-last-ms')),
    rendererRebuildStagesMs: JSON.parse((await canvas.getAttribute('data-world-rebuild-stages-ms')) ?? '{}'),
    terrainGenerationCacheHit: await canvas.getAttribute('data-terrain-generation-cache-hit'),
    terrainCellCount: Number(await canvas.getAttribute('data-terrain-cell-count')),
    scope: 'Deferred marathon UI and IndexedDB, not an Android performance result.' }, null, 2)), contentType: 'application/json' });
});

for (const viewport of [
  { name: 'portrait-phone', width: 412, height: 915, colorScheme: 'light' as const },
  { name: 'landscape-phone', width: 915, height: 412, colorScheme: 'dark' as const },
  { name: 'portrait-tablet', width: 768, height: 1024, colorScheme: 'dark' as const },
]) {
  test(`minimal submission receipt stays inside its submit button on ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ colorScheme: viewport.colorScheme });
    await seed(page, true, true);
    const report = page.locator('.marathon-progress-report');
    await report.locator('.marathon-settlement-head').first().click();
    const row = report.locator('.marathon-report-row').first();
    await row.getByRole('button', { name: '推进至 75%', exact: true }).click();
    await row.getByRole('button', { name: /增加 .*计入轮数/ }).click();
    await report.getByRole('button', { name: '一次提交本次推进', exact: true }).click();
    const feedback = report.getByRole('button', { name: '材料已送达！', exact: true });
    await expect(feedback).toBeVisible();
    const geometry = await page.evaluate(() => {
      const toast = document.querySelector('.marathon-report-submit')?.getBoundingClientRect();
      const band = document.querySelector('.focus-panel')?.getBoundingClientRect();
      return toast && band ? { toast: toast.toJSON(), band: band.toJSON() } : null;
    });
    expect(geometry, 'Receipt must remain in the submitting report.').not.toBeNull();
    const { toast, band } = geometry!;
    const inside = toast.x >= band.x && toast.x + toast.width <= band.x + band.width
      && toast.y >= band.y && toast.y + toast.height <= band.y + band.height;
    await testInfo.attach('feedback-band-geometry', {
      body: Buffer.from(JSON.stringify({ viewport, toast, band, inside,
        scope: 'Real minimal submission and browser layout; screenshot requires separate visual review.' }, null, 2)),
      contentType: 'application/json',
    });
    await page.screenshot({ path: testInfo.outputPath(`minimal-feedback-${viewport.name}.png`) });
    expect(inside, 'The submit receipt must be fully visible inside the information band.').toBe(true);
    await expect(page.locator('.construction-feedback')).toHaveCount(0);
    expect(toast.x).toBeGreaterThanOrEqual(0);
    expect(toast.y).toBeGreaterThanOrEqual(0);
    expect(toast.x + toast.width).toBeLessThanOrEqual(viewport.width);
    expect(toast.y + toast.height).toBeLessThanOrEqual(viewport.height);
  });
}
