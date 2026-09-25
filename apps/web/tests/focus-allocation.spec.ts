import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand, type DomainState } from '@tomato-clock/domain';

const startAt = Date.parse('2026-09-12T08:00:00+08:00');
const viewports = [
  { width: 360, height: 800, name: 'mobile' },
  { width: 412, height: 915, name: 'large-phone' },
  { width: 915, height: 412, name: 'phone-landscape' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1440, height: 900, name: 'desktop' },
] as const;

function dataFixture(): DomainState {
  let state = createInitialState('Asia/Shanghai');
  const run = (command: DomainCommand, now = startAt) => {
    const result = execute(state, command, { now: () => new Date(now) });
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  };
  let now = startAt;
  const tasks = [
    { projectId: 'allocation-long', title: '一个很长的中文任务名称用于验证横向图表标签换行', subtaskId: 'allocation-long-task', minutes: 90 },
    { projectId: 'allocation-medium', title: '第二个任务 · 午后整理资料', subtaskId: 'allocation-medium-task', minutes: 30 },
    { projectId: 'allocation-short', title: '第三个任务', subtaskId: 'allocation-short-task', minutes: 15 },
  ] as const;
  for (const task of tasks) {
    run({ type: 'CreateProject', projectId: task.projectId, title: task.title, blueprintId: 'builtin-small-workshop', subtasks: [{ id: task.subtaskId, title: '整理资料' }] }, now);
    run({ type: 'SwitchActiveProject', projectId: task.projectId }, now);
    run({ type: 'StartFocus', sessionId: `${task.projectId}-session`, subtaskId: task.subtaskId, plannedDurationMs: task.minutes * 60_000 }, now);
    now += task.minutes * 60_000;
    run({ type: 'CompleteFocus' }, now);
    run({
      type: 'ReportSubtaskProgress',
      reportId: `${task.projectId}-report`,
      subtaskId: task.subtaskId,
      focusSessionIds: [`${task.projectId}-session`],
      progressBasisPoints: 5_000,
    }, now);
    now += 60_000;
  }
  return state;
}

async function seed(page: Page, state: DomainState, theme: 'light' | 'dark') {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.evaluate(async ({ state: nextState, theme: nextTheme }) => {
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
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({ focusMinutes: 45, breakMinutes: 5, themeMode: nextTheme }));
    localStorage.removeItem('blockcolc-round-plan-v1');
  }, { state, theme });
  await page.reload();
}

test('F10 allocation keeps true zero-based lengths across light/dark reduced-motion screenshots', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date(startAt + 3 * 60 * 60_000) });
  const state = dataFixture();
  let sawUnlockDialog = false;

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await seed(page, state, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('button', { name: '统计' }).click();
      const unlockDialog = page.getByRole('dialog', { name: '新的成就' });
      // The seeded history satisfies the first achievement batch, so the
      // first visit must exercise the modal.  Once dismissed, the persisted
      // receipt is the product contract: later viewport/theme passes must not
      // require the same historical batch to reappear.
      if (await unlockDialog.count()) {
        await expect(unlockDialog).toBeVisible();
        sawUnlockDialog = true;
        await unlockDialog.getByRole('button', { name: '全部关闭' }).click();
        await expect(unlockDialog).toHaveCount(0);
      }
      const chart = page.locator('.project-allocation');
      await expect(chart).toBeVisible();
      await expect(chart).toContainText('一个很长的中文任务名称用于验证横向图表标签换行');
      await chart.scrollIntoViewIfNeeded();

      const chartFacts = await chart.evaluate((element) => ({
        bars: [...element.querySelectorAll<SVGPathElement>('.allocation-fill')].map((path) => ({
          extent: Number(path.dataset.extent),
          minutes: Number(path.dataset.minutes),
        })),
        animation: getComputedStyle(element.querySelector<SVGPathElement>('.allocation-fill')!).animationName,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clipIds: [...element.querySelectorAll<SVGClipPathElement>('clipPath')].map((clip) => clip.id),
      }));
      expect(chartFacts.bars.map((bar) => bar.minutes)).toEqual([90, 30, 15]);
      expect(chartFacts.bars[0]?.extent).toBeCloseTo(400, 5);
      expect(chartFacts.bars[1]?.extent).toBeCloseTo(400 * 30 / 90, 5);
      expect(chartFacts.bars[2]?.extent).toBeCloseTo(400 * 15 / 90, 5);
      expect((chartFacts.bars[1]?.extent ?? 0) / (chartFacts.bars[2]?.extent ?? 1)).toBeCloseTo(2, 5);
      expect(chartFacts.animation).toBe('none');
      expect(chartFacts.overflow).toBeLessThanOrEqual(1);
      expect(chartFacts.bars.length).toBe(3);
      expect(chartFacts.clipIds.length).toBe(3);
      expect(new Set(chartFacts.clipIds).size).toBe(chartFacts.clipIds.length);

      await page.screenshot({
        path: testInfo.outputPath(`focus-allocation-${viewport.name}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  expect(sawUnlockDialog).toBe(true);
});
