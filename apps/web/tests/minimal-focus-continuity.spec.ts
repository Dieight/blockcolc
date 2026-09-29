import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand, type DomainState } from '@blockcolc/domain';
import type { RoundPlan } from '../src/round-plan';
import { preparePlanCancellation } from './focus-plan-controls';

const startAt = Date.parse('2026-09-06T08:00:00Z');
function fixture(kind: 'finite' | 'habit', complete = false, orphan = false) {
  let state = createInitialState('Asia/Shanghai');
  const run = (command: DomainCommand, now = startAt) => {
    const result = execute(state, command, { now: () => new Date(now) });
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  };
  run({ type: 'CreateHabitProject', projectId: 'h', title: '阅读', blueprintId: 'builtin-small-workshop', targetRounds: 10 });
  if (!orphan) run({ type: 'CreateProject', projectId: 'p', title: '工作', blueprintId: 'builtin-small-workshop', subtasks: [{ id: 's', title: '整理资料' }] });
  const host = kind === 'habit' ? 'h' : 'p';
  if (host !== state.activeProjectId) run({ type: 'SwitchActiveProject', projectId: host });
  run({ type: 'StartFocus', sessionId: 'r1', projectId: host, subtaskId: null, marathon: true, deferredSettlement: true, plannedDurationMs: 60_000 });
  if (complete) run({ type: 'CompleteFocus' }, startAt + 60_000);
  if (orphan) run({ type: 'DeleteActiveProject', projectId: host }, startAt + 60_000);
  const plan: RoundPlan = { projectId: host, subtaskId: null, mode: 'marathon', deferredSettlement: true,
    totalRounds: 2, completedRounds: 0, status: 'focus', currentSessionId: 'r1', reportedSessionIds: [],
    endAt: new Date(startAt + 3 * 60_000).toISOString() };
  return { state, plan };
}

async function seed(page: Page, state: DomainState, plan: RoundPlan | null) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.evaluate(async ({ state, plan }) => {
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
        current.onsuccess = () => store.put({ id: 'current', revision: (current.result?.revision ?? 0) + 1, state });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({ focusMinutes: 1, habitFocusMinutes: 20, breakMinutes: 1 }));
    if (plan) localStorage.setItem('blockcolc-round-plan-v1', JSON.stringify(plan));
    else localStorage.removeItem('blockcolc-round-plan-v1');
  }, { state, plan });
  await page.reload();
}

async function snapshot(page: Page): Promise<DomainState> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<DomainState>((resolve, reject) => {
        const request = database.transaction('appState', 'readonly').objectStore('appState').get('current');
        request.onsuccess = () => resolve(request.result.state); request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

for (const kind of ['finite', 'habit'] as const) {
  test(`deferred ${kind} rounds survive focus, rest, next start and one explicit final allocation`, async ({ page }) => {
    await page.clock.install({ time: new Date(startAt) });
    const data = fixture(kind);
    await seed(page, data.state, data.plan);
    await expect(page.locator('.world-screen')).toHaveClass(/is-focusing/);
    await expect(page.locator('.focus-building-progress')).toHaveCount(0);
    await page.clock.fastForward(61_000);
    await expect(page.getByRole('button', { name: '跳过休息' })).toBeVisible();
    expect((await snapshot(page)).projects.find(p => p.id === 'h')?.habit?.completedFocusSessionIds).toEqual([]);
    await page.reload();
    await expect(page.getByRole('button', { name: '跳过休息' })).toBeVisible();
    await page.getByRole('button', { name: '跳过休息' }).click();
    await page.getByRole('button', { name: '开始下一轮' }).click();
    const second = (await snapshot(page)).activeFocusSession;
    expect(second).toMatchObject({ subtaskId: null, deferredSettlement: true, plannedDurationMs: 60_000 });
    await page.clock.fastForward(61_000);
    const report = page.locator('.marathon-progress-report');
    await expect(report).toContainText('2 轮专注已结束');
    expect((await snapshot(page)).projects.find(p => p.id === 'h')?.habit?.completedFocusSessionIds).toEqual([]);
    await report.getByRole('button', { name: /阅读/ }).click();
    await expect(report.getByLabel('计入轮数', { exact: true })).toHaveText('0');
    await report.getByRole('button', { name: '增加计入轮数' }).click();
    await report.getByRole('button', { name: '提交本次推进' }).click();
    await expect(report).toBeHidden();
    const settled = await snapshot(page);
    expect(settled.projects.find(p => p.id === 'h')?.habit?.completedFocusSessionIds).toHaveLength(1);
    expect(settled.focusHistory.every(session => session.settledAt !== undefined)).toBe(true);
    await page.reload();
    await expect(report).toBeHidden();
    await expect(page.getByRole('button', { name: '开始 1 轮' })).toBeVisible();
  });

  test(`lost ${kind} schedule recovers retained rounds into final reporting without fake allocation`, async ({ page }) => {
    await page.clock.install({ time: new Date(startAt + 61_000) });
    const data = fixture(kind, true);
    await seed(page, data.state, null);
    const report = page.locator('.marathon-progress-report');
    await expect(report).toContainText('1 轮专注已结束');
    await page.reload();
    await expect(report).toContainText('1 轮专注已结束');
    await report.getByRole('button', { name: '提交本次推进' }).click();
    await expect(report).toBeHidden();
    expect((await snapshot(page)).focusHistory[0]?.settledAt).toBeDefined();
    await page.reload();
    await expect(report).toBeHidden();
  });
}

test('a deleted host with no targets can explicitly settle retained rounds before first-run setup', async ({ page }) => {
  await page.clock.install({ time: new Date(startAt + 61_000) });
  const data = fixture('habit', true, true);
  await seed(page, data.state, null);
  const report = page.locator('.marathon-progress-report');
  await expect(report).toContainText('1 轮专注已结束');
  await report.getByRole('button', { name: '结束计划' }).click();
  await expect(report).toBeHidden();
  expect((await snapshot(page)).focusHistory[0]?.settledAt).toBeDefined();
  await page.reload();
  await expect(report).toBeHidden();
  await expect(page.getByRole('button', { name: '开始建造' })).toBeVisible();
});

test('early completion on a deferred habit host stays unallocated and cancelling the remaining plan opens one report', async ({ page }) => {
  await page.clock.install({ time: new Date(startAt) });
  const data = fixture('habit');
  await seed(page, data.state, data.plan);
  await page.clock.fastForward(10_000);
  await page.locator('.immersive-hint').dblclick();
  await page.getByRole('button', { name: '结束本次专注' }).click();
  await page.getByRole('button', { name: /提前完成本轮/ }).click();
  await expect(page.getByRole('button', { name: '跳过休息' })).toBeVisible();
  expect((await snapshot(page)).projects.find(p => p.id === 'h')?.habit?.completedFocusSessionIds).toEqual([]);
  await page.getByRole('button', { name: '跳过休息' }).click();
  await page.getByRole('button', { name: '调整本次计划' }).click();
  await (await preparePlanCancellation(page.getByRole('dialog', { name: '安排下一轮' }))).click();
  const report = page.locator('.marathon-progress-report');
  await expect(report).toContainText('1 轮专注已结束');
  await report.getByRole('button', { name: '提交本次推进' }).click();
  await expect(report).toBeHidden();
  expect((await snapshot(page)).focusHistory[0]).toMatchObject({ status: 'completed-early', deferredSettlement: true, settledAt: expect.any(String) });
});

test('interrupting the only deferred round preserves the plan but cancelling it creates no fake report', async ({ page }) => {
  await page.clock.install({ time: new Date(startAt) });
  const data = fixture('habit');
  await seed(page, data.state, data.plan);
  await page.clock.fastForward(10_000);
  await page.locator('.immersive-hint').dblclick();
  await page.getByRole('button', { name: '结束本次专注' }).click();
  await page.getByRole('button', { name: /中断本轮/ }).click();
  await page.getByRole('button', { name: '外部打扰' }).click();
  await expect(page.getByRole('button', { name: '调整本次计划' })).toBeVisible();
  await page.getByRole('button', { name: '调整本次计划' }).click();
  await (await preparePlanCancellation(page.getByRole('dialog', { name: '安排下一轮' }))).click();
  await expect(page.locator('.marathon-progress-report')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始 1 轮' })).toBeVisible();
  expect((await snapshot(page)).focusHistory[0]).toMatchObject({ status: 'interrupted', deferredSettlement: true });
});

test('cancelling during a later active round records the note and reports only the earned round in place', async ({ page }) => {
  await page.clock.install({ time: new Date(startAt) });
  const data = fixture('finite');
  await seed(page, data.state, data.plan);
  await page.clock.fastForward(61_000);
  await page.getByRole('button', { name: '跳过休息' }).click();
  await page.getByRole('button', { name: '开始下一轮' }).click();
  // The click handler intentionally starts the application command asynchronously.
  // Wait until both the IDB-owned focus and its plan context are committed before
  // advancing mocked time, otherwise the clock jump can precede StartFocus itself.
  await expect.poll(async () => page.evaluate(async () => {
    const plan = JSON.parse(localStorage.getItem('blockcolc-round-plan-v1') ?? 'null') as
      { status?: string; currentSessionId?: string } | null;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const state = await new Promise<{ activeFocusSession?: { id: string } | null }>((resolve, reject) => {
        const request = database.transaction('appState').objectStore('appState').get('current');
        request.onsuccess = () => resolve(request.result?.state);
        request.onerror = () => reject(request.error);
      });
      return plan?.status === 'focus' && plan.currentSessionId === state.activeFocusSession?.id;
    } finally { database.close(); }
  })).toBe(true);
  await page.clock.fastForward(10_000);
  await page.locator('.immersive-hint').dblclick();
  await page.getByRole('button', { name: '结束本次专注' }).click();
  const dialog = page.getByRole('dialog', { name: '如何结束这次专注？' });
  await dialog.getByRole('button', { name: /取消整个计划/ }).click();
  const confirm = page.getByRole('button', { name: '确认取消整个计划', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: '优先级变化', exact: true }).click();
  await expect(confirm).toBeDisabled();
  await page.getByLabel('补充说明', { exact: true }).fill('测试：改为处理更紧急的工作');
  await confirm.click();
  const report = page.locator('.marathon-progress-report');
  await expect(report).toContainText('1 轮专注已结束');
  await expect(report).toHaveAttribute('data-focus-report-variant', 'immersive');
  await expect(report).toContainText('测试：改为处理更紧急的工作');
  await expect(page.locator('.world-screen')).toHaveClass(/is-focusing/);
  const cancelled = await snapshot(page);
  expect(cancelled.activeFocusSession).toBeNull();
  expect(cancelled.focusHistory.filter(session => session.status === 'interrupted')).toHaveLength(1);
  const interrupted = cancelled.focusHistory.find(session => session.status === 'interrupted')!;
  expect(interrupted).toMatchObject({
    interruptionCategory: 'priority-changed', interruptionNote: '测试：改为处理更紧急的工作',
  });
  expect(interrupted.actualDurationMs).toBe(Date.parse(interrupted.interruptedAt) - Date.parse(interrupted.startedAt));
  expect(interrupted.actualDurationMs).toBeGreaterThanOrEqual(10_000);
  expect(interrupted.actualDurationMs).toBeLessThan(interrupted.plannedDurationMs);
  await page.reload();
  await expect(report).toContainText('测试：改为处理更紧急的工作');
  await report.getByRole('button', { name: '提交本次推进' }).click();
  await expect(report).toBeHidden();
  await expect(page.getByRole('button', { name: '开始 1 轮' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('blockcolc-round-plan-v1'))).toBeNull();
});
