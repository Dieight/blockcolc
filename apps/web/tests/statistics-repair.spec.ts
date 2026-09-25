import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand, type DomainState } from '@tomato-clock/domain';
import { createBackupEnvelope } from '@tomato-clock/storage-indexeddb';

const RECEIPT_KEY = 'blockcolc-achievement-display-receipts-v1';
const startAt = Date.parse('2026-09-13T08:00:00+08:00');

function stateWithOneCompletedRound(): DomainState {
  let state = createInitialState('Asia/Shanghai');
  const run = (command: DomainCommand, now: number) => {
    const result = execute(state, command, { now: () => new Date(now) });
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  };
  run({ type: 'CreateProject', projectId: 'stats-project', title: '统计验证任务', blueprintId: 'builtin-small-workshop', subtasks: [{ id: 'stats-task', title: '统计验证步骤' }] }, startAt);
  run({ type: 'StartFocus', sessionId: 'stats-session', subtaskId: 'stats-task', plannedDurationMs: 60_000 }, startAt);
  run({ type: 'CompleteFocus' }, startAt + 60_000);
  run({ type: 'ReportSubtaskProgress', reportId: 'stats-report', subtaskId: 'stats-task', focusSessionIds: ['stats-session'], progressBasisPoints: 10_000 }, startAt + 61_000);
  return state;
}

function stateWithUnknownHistoricalBuildingDate(): DomainState {
  let state = createInitialState('Asia/Shanghai');
  const result = execute(state, {
    type: 'CreateProject', projectId: 'unknown-date-project', title: '历史建筑', blueprintId: 'builtin-small-workshop',
    subtasks: [{ id: 'unknown-date-task', title: '已完成历史步骤' }],
  }, { now: () => new Date(startAt) });
  if (!result.ok) throw new Error(result.message);
  state = result.state;
  const project = state.projects.find(item => item.id === 'unknown-date-project');
  if (!project) throw new Error('historical fixture project missing');
  project.status = 'monument';
  project.subtaskStructureLocked = true;
  project.subtasks[0]!.progressBasisPoints = 10_000;
  state.activeProjectId = null;
  return state;
}

function stateWithDeferredMixedRounds(): DomainState {
  let state = createInitialState('Asia/Shanghai');
  const run = (command: DomainCommand, now: number) => {
    const result = execute(state, command, { now: () => new Date(now) });
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  };
  run({ type: 'CreateProject', projectId: 'round-host', title: '已结束的马拉松宿主', blueprintId: 'builtin-small-workshop', subtasks: [{ id: 'host-task', title: '宿主记录' }] }, startAt);
  run({ type: 'CreateProject', projectId: 'ordinary-target', title: '普通目标', blueprintId: 'builtin-small-workshop', subtasks: [{ id: 'ordinary-task', title: '普通推进项' }] }, startAt + 1_000);
  run({ type: 'CreateHabitProject', projectId: 'habit-target', title: '习惯目标', blueprintId: 'builtin-small-workshop', targetRounds: 10 }, startAt + 2_000);
  run({ type: 'SwitchActiveProject', projectId: 'round-host' }, startAt + 3_000);
  let now = startAt + 4_000;
  for (const sessionId of ['mixed-round-1', 'mixed-round-2']) {
    run({ type: 'StartFocus', sessionId, projectId: 'round-host', subtaskId: null, plannedDurationMs: 60_000, marathon: true, deferredSettlement: true }, now);
    run({ type: 'CompleteFocus' }, now + 60_000);
    now += 61_000;
  }
  // Deleting the focus host leaves the retained deferred rounds visible while
  // the ordinary and habit targets remain real, selectable report targets.
  run({ type: 'DeleteActiveProject', projectId: 'round-host' }, now);
  return state;
}

async function snapshot(page: Page): Promise<DomainState> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<DomainState>((resolve, reject) => {
        const request = database.transaction('appState', 'readonly').objectStore('appState').get('current');
        request.onsuccess = () => resolve(request.result.state as DomainState);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

async function seed(page: Page, state: DomainState, expectedBootstrapState: 'ready' | 'failed' = 'ready') {
  // Use a fresh document for the write and an explicit second navigation for
  // the read.  The app keeps its repository connection open during bootstrap;
  // a plain reload can race that document's initial empty-state adoption and
  // leave the next assertion looking at first-run setup even though the IDB
  // transaction has completed.
  const seedUrl = `/?e2e-seed=${Date.now()}`;
  await page.goto(seedUrl);
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.evaluate(async (nextState) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('appState', 'readwrite');
        const store = transaction.objectStore('appState');
        const current = store.get('current');
        current.onsuccess = () => store.put({ id: 'current', revision: (current.result?.revision ?? 0) + 1, state: nextState });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({ focusMinutes: 25, breakMinutes: 0, themeMode: 'light' }));
    // Keep the first-run gate out of this seeded historical-data fixture.  A
    // rollback to an empty state must still allow the user to re-enter Stats.
    localStorage.setItem('blockcolc-first-project-setup-v1', '1');
    localStorage.setItem('blockcolc-achievement-display-receipts-v1', '{broken receipt');
  }, state);
  await page.goto(`${seedUrl}&read=1`);
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', expectedBootstrapState);
}

async function emptyBackup(): Promise<string> {
  return JSON.stringify(await createBackupEnvelope(createInitialState('Asia/Shanghai'), new Date('2026-09-13T00:00:00.000Z')));
}

// Stable core interaction source for the statistics/F18/F19 repair.  It is
// collected by the release manifest; execution remains a parent-owned gate.
test.describe('statistics repair interactions', () => {
  test('corrupt receipts can be acknowledged and monument charts stay rulerless', async ({ page }) => {
    await seed(page, stateWithOneCompletedRound());
    await page.getByRole('button', { name: '统计', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新的成就' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('第一块基石');
    await dialog.getByRole('button', { name: '全部关闭' }).click();
    await expect(dialog).toBeHidden();
    const receipts = JSON.parse(await page.evaluate((receiptKey) => localStorage.getItem(receiptKey) ?? '[]', RECEIPT_KEY)) as string[];
    expect(receipts).toEqual(expect.arrayContaining(['focus-first', 'building-first']));

    const memorialSection = page.locator('.monument-statistics');
    await expect(memorialSection).not.toHaveAttribute('open', '');
    await expect(memorialSection.locator('.monument-list')).toBeHidden();
    await memorialSection.locator(':scope > summary').click();
    const memorial = memorialSection.locator('.monument-list details').first();
    await expect(memorialSection.locator('.monument-list')).toBeVisible();
    await expect(memorial).not.toHaveAttribute('open', '');
    await memorial.locator('summary').click();
    await expect(memorial.locator('.monument-detail')).toBeVisible();
    await expect(page.getByRole('heading', { name: '专注轨迹' })).toBeVisible();

    const chart = page.locator('.monument-focus-chart');
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute('data-chart-template', 'G3');
    await expect(chart.locator('.monument-tick')).toHaveCount(0);
    await expect(chart.locator('.monument-bar-fill')).toHaveCount(1);
    await memorial.locator('summary').click();
    await expect(memorial.locator('.monument-detail')).toBeHidden();
    await memorialSection.locator(':scope > summary').click();
    await expect(memorialSection.locator('.monument-list')).toBeHidden();

    // The first historical batch is acknowledged once.  A cold re-entry into
    // Stats must not reopen it when the receipt is now valid.
    await page.reload();
    await page.getByRole('button', { name: '统计', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新的成就' })).toHaveCount(0);
  });

  test('storage failure closes the batch for this session and explains the retry risk', async ({ page }) => {
    await seed(page, stateWithOneCompletedRound());
    // This case targets the write failure, not receipt parsing.  Start from a
    // clean unseen receipt so it remains independent of the corrupt-receipt
    // case above even when the browser profile is reused by the runner.
    await page.evaluate((receiptKey) => localStorage.setItem(receiptKey, '[]'), RECEIPT_KEY);
    await page.reload();
    await page.getByRole('button', { name: '统计', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新的成就' });
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(Storage.prototype, 'setItem', {
        configurable: true,
        value() { throw new Error('quota'); },
      });
    });
    await dialog.getByRole('button', { name: '全部关闭' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.achievement-receipt-notice')).toContainText('展示回执未保存');
  });

  test('rejects a malformed completed-building snapshot rather than fabricating achievement history', async ({ page }) => {
    await seed(page, stateWithUnknownHistoricalBuildingDate(), 'failed');
    // Valid persisted aggregates require the completion report. Unknown-date
    // presentation remains covered by application/component tests; bypassing
    // the persisted invariant here would test a world the app cannot accept.
    await expect(page.getByText('无法打开本地世界', { exact: true })).toBeVisible();
    await expect(page.getByText(/does not match latest report/)).toBeVisible();
    await expect(page.getByRole('dialog', { name: '新的成就' })).toHaveCount(0);
  });

  test('ordinary and habit targets allocate every retained round once', async ({ page }) => {
    await seed(page, stateWithDeferredMixedRounds());
    const report = page.locator('.marathon-progress-report');
    await expect(report).toBeVisible();
    await expect(report.locator('.eyebrow')).toContainText('2 轮专注已结束');

    const habit = page.locator('.marathon-settlement-card').filter({ hasText: '习惯目标' });
    await habit.getByRole('button', { name: /习惯目标/ }).click();
    await habit.getByRole('button', { name: '增加计入轮数' }).click();
    await expect(habit.getByLabel('计入轮数', { exact: true })).toHaveText('1');

    const ordinary = page.locator('.marathon-settlement-card').filter({ hasText: '普通目标' });
    await ordinary.getByRole('button', { name: /普通目标/ }).click();
    const row = ordinary.locator('.marathon-report-row').first();
    await row.getByRole('button', { name: '保持 0%' }).click();
    const keepStepper = row.locator('.task-round-stepper');
    await expect(keepStepper).toBeVisible();
    await expect(keepStepper.getByLabel('普通推进项 计入轮数', { exact: true })).toHaveText('0');
    await keepStepper.getByRole('button', { name: /增加 .*计入轮数/ }).click();
    await expect(keepStepper.getByLabel('普通推进项 计入轮数', { exact: true })).toHaveText('1');
    await keepStepper.getByRole('button', { name: /减少 .*计入轮数/ }).click();
    await expect(keepStepper.getByLabel('普通推进项 计入轮数', { exact: true })).toHaveText('0');
    await row.getByRole('button', { name: '推进至 25%' }).click();
    await row.getByRole('button', { name: /增加 .*计入轮数/ }).click();
    await expect(report).toContainText('全部轮次已明确分配');
    await page.getByRole('button', { name: '一次提交本次推进' }).click();
    await expect(report).toBeHidden();

    const persisted = await snapshot(page);
    const ordinaryProject = persisted.projects.find(project => project.id === 'ordinary-target');
    const habitProject = persisted.projects.find(project => project.id === 'habit-target');
    expect(ordinaryProject?.subtasks[0]?.progressBasisPoints).toBe(2_500);
    expect(habitProject?.habit?.completedFocusSessionIds).toHaveLength(1);
    expect(habitProject?.habit?.completedFocusSessionIds).toEqual(['mixed-round-1']);
    expect(persisted.progressReports).toHaveLength(1);
    expect(persisted.progressReports[0]?.allocation).toBe('explicit');
    expect(persisted.progressReports[0]?.focusSessionIds).toEqual(['mixed-round-2']);
    expect(new Set([
      ...(habitProject?.habit?.completedFocusSessionIds ?? []),
      ...(persisted.progressReports[0]?.focusSessionIds ?? []),
    ])).toEqual(new Set(['mixed-round-1', 'mixed-round-2']));
    expect(persisted.focusHistory.filter(session => session.settledAt !== undefined)).toHaveLength(2);
  });

  test('a failed settlement write keeps the report retryable and a second submit succeeds', async ({ page }) => {
    await seed(page, stateWithDeferredMixedRounds());
    await page.evaluate(() => {
      const originalPut = IDBObjectStore.prototype.put;
      let failNext = true;
      Object.defineProperty(IDBObjectStore.prototype, 'put', {
        configurable: true,
        value(this: IDBObjectStore, value: unknown) {
          if (failNext && this.name === 'appState') {
            failNext = false;
            throw new Error('forced settlement persistence failure');
          }
          return originalPut.call(this, value);
        },
      });
    });
    const report = page.locator('.marathon-progress-report');
    const submit = page.getByRole('button', { name: '一次提交本次推进' });
    await submit.click();
    await expect(report).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(page.locator('.toast')).toContainText('atomically save application state');

    await submit.click();
    await expect(report).toBeHidden();
    const persisted = await snapshot(page);
    expect(persisted.focusHistory.filter(session => session.settledAt !== undefined)).toHaveLength(2);
  });

  test('first achievement batch stays dismissed across import, re-entry, and rollback', async ({ page }) => {
    const completed = stateWithOneCompletedRound();
    await seed(page, completed);
    await page.getByRole('button', { name: '统计', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新的成就' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '全部关闭' }).click();
    await expect(dialog).toHaveCount(0);

    const backup = await emptyBackup();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('选择备份 JSON 文件').setInputFiles({
      name: 'empty-history.json', mimeType: 'application/json', buffer: Buffer.from(backup),
    });
    await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible();
    await page.getByRole('button', { name: '确认替换本地数据' }).click();
    await expect(page.locator('.backup-panel .backup-notice')).toContainText('导入完成');
    await page.getByRole('button', { name: '统计', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新的成就' })).toHaveCount(0);

    await page.getByRole('button', { name: '设置', exact: true }).click();
    const importedBackup = page.locator('.rollback-list li').filter({ hasText: '导入前备份' });
    await expect(importedBackup).toBeVisible();
    await importedBackup.getByRole('button', { name: '恢复' }).click();
    const restoreDialog = page.getByRole('alertdialog').filter({ hasText: '恢复这份备份？' });
    await expect(restoreDialog).toBeVisible();
    await restoreDialog.getByRole('button', { name: '恢复备份' }).click();
    await expect(page.locator('.backup-panel .backup-notice')).toContainText('已恢复备份');
    await page.getByRole('button', { name: '统计', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新的成就' })).toHaveCount(0);
  });
});
