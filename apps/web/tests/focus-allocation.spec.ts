import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand, type DomainState } from '@blockcolc/domain';

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
        current.onsuccess = () => store.put({ id: 'current', revision: (current.result?.revision ?? 0) + 1,
          // Allocation fixtures keep the catalog installed by first bootstrap.
          state: { ...nextState, decorationBlueprintResources: current.result?.state?.decorationBlueprintResources
            ?? nextState.decorationBlueprintResources } });
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
  // The simulated clock must release the startup frame before theme/UI checks.
  await page.clock.runFor(32);
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
}

test('L14 allocation keeps duration shares and exact labels across light/dark reduced-motion screenshots', async ({ page }, testInfo) => {
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
      await expect(chart).toHaveAttribute('data-chart-template', 'L14');
      await expect(chart).toContainText('一个很长的中文任务名称用于验证横向图表标签换行');
      await chart.scrollIntoViewIfNeeded();
      await expect(chart.locator('[data-allocation-unit="true"]')).toHaveCount(100);
      await expect(chart.getByRole('img')).toHaveAccessibleName(/1 小时 30 分钟.*30 分钟.*15 分钟/);

      const chartFacts = await chart.evaluate((element) => ({
        clusters: [...element.querySelectorAll<SVGGElement>('g[data-percentage-units]')].map((cluster) => ({
          units: Number(cluster.dataset.percentageUnits),
          points: cluster.querySelectorAll('[data-allocation-unit="true"]').length,
        })),
        minutes: [...element.querySelectorAll<HTMLElement>('.allocation-legend li')].map(row => Number(row.dataset.minutes)),
        shares: [...element.querySelectorAll<HTMLElement>('.allocation-legend-values small')].map(row => row.textContent),
        animation: getComputedStyle(element.querySelector<SVGCircleElement>('.allocation-point')!).animationName,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clipIds: [...element.querySelectorAll<SVGClipPathElement>('clipPath')].map((clip) => clip.id),
      }));
      expect(chartFacts.minutes).toEqual([90, 30, 15]);
      expect(chartFacts.shares).toEqual(['66.7%', '22.2%', '11.1%']);
      expect(chartFacts.clusters).toEqual([{units:67,points:67},{units:22,points:22},{units:11,points:11}]);
      expect(chartFacts.clusters.reduce((sum,cluster) => sum + cluster.units,0)).toBe(100);
      expect(chartFacts.animation).toBe('none');
      expect(chartFacts.overflow).toBeLessThanOrEqual(1);
      // Percentage points are not clipped zero-origin bars; no per-chart SVG
      // definitions are needed and chart instances cannot collide by clip ID.
      expect(chartFacts.clipIds).toEqual([]);
      await expect(chart.locator('.allocation-fill')).toHaveCount(0);

      await page.screenshot({
        path: testInfo.outputPath(`focus-allocation-${viewport.name}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  expect(sawUnlockDialog).toBe(true);
});
