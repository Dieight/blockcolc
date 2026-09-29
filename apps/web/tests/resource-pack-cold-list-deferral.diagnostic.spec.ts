import { expect, test, type Page } from '@playwright/test';

interface ColdRepositoryProbeWindow {
  __blockcolcResourcePackColdStartProbe?: {
    read(): { requests: Array<{ caller: string; result: string }> };
    dispose(): void;
  };
  __coldListFailure?: boolean;
  __armColdListFailure?: () => void;
  __blockcolcQualityLifecycle?: { read(): { operations: Array<{ kind: string; phases: Array<{ stage: string; worldRebuildCount?: number; renderedWorldRebuildCount?: number; renderedTriangleCount?: number }> }> } };
  __blockcolcQualityLifecyclePageStartAt?: number;
}

async function createExistingWorld(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as ColdRepositoryProbeWindow).__blockcolcQualityLifecyclePageStartAt = performance.now();
  });
  await page.goto('/?__resourcePackColdStartProbe=1');
  await page.getByLabel('大型任务').fill('隐藏材质列表延后验证');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await expect(page.getByLabel('项目建筑世界')).toBeVisible();
}

async function waitForValidWorldFrame(page: Page): Promise<void> {
  await expect(page.getByLabel('项目建筑世界')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const operations=(window as unknown as ColdRepositoryProbeWindow).__blockcolcQualityLifecycle?.read().operations ?? [];
    return operations.some(operation=>operation.kind==='boot'&&operation.phases.some(phase=>phase.stage==='visible-world-frame'
      &&typeof phase.worldRebuildCount==='number'&&phase.worldRebuildCount>0
      &&phase.renderedWorldRebuildCount===phase.worldRebuildCount
      &&typeof phase.renderedTriangleCount==='number'&&phase.renderedTriangleCount>0));
  }), { timeout: 120_000, intervals: [100, 250, 500] }).toBe(true);
}

async function listCallCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as ColdRepositoryProbeWindow)
    .__blockcolcResourcePackColdStartProbe?.read().requests.filter(request => request.caller === 'list').length ?? 0);
}

test('cold world boot defers the hidden list, then reads once and preserves it across route switches', async ({ page }) => {
  test.setTimeout(240_000);
  await createExistingWorld(page);
  await page.goto('/?__resourcePackColdStartProbe=1');
  await waitForValidWorldFrame(page);

  expect(await listCallCount(page)).toBe(0);
  const settingsRoute = page.locator('[data-route="settings"]');
  await expect(settingsRoute).toHaveCount(1);
  await expect(settingsRoute).toBeHidden();

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('.resource-pack-list-status')).toContainText('本机尚无导入的资源包。');
  expect(await listCallCount(page)).toBe(1);

  const focusMinutes = page.getByLabel('普通任务专注分钟');
  await focusMinutes.fill('42');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(settingsRoute).toBeHidden();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(focusMinutes).toHaveValue('42');
  await expect(page.locator('.resource-pack-list-status')).toContainText('本机尚无导入的资源包。');
  expect(await listCallCount(page)).toBe(1);

  await page.evaluate(() => (window as unknown as ColdRepositoryProbeWindow).__blockcolcResourcePackColdStartProbe?.dispose());
});

test('a failed first list is distinct from empty and can be retried successfully', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const probeWindow = window as unknown as ColdRepositoryProbeWindow;
    probeWindow.__coldListFailure = false;
    probeWindow.__armColdListFailure = () => { probeWindow.__coldListFailure = true; };
    const originalGetAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function(...args: Parameters<IDBObjectStore['getAll']>) {
      if (this.name === 'resourcePacks' && probeWindow.__coldListFailure) {
        probeWindow.__coldListFailure = false;
        throw new Error('synthetic resource list failure');
      }
      return originalGetAll.apply(this, args);
    };
  });

  await createExistingWorld(page);
  await page.goto('/?__resourcePackColdStartProbe=1');
  await waitForValidWorldFrame(page);
  expect(await listCallCount(page)).toBe(0);

  await page.evaluate(() => (window as unknown as ColdRepositoryProbeWindow).__armColdListFailure?.());
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('synthetic resource list failure');
  await expect(page.locator('.resource-pack-original')).toHaveCount(0);
  expect(await listCallCount(page)).toBe(1);

  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.resource-pack-list-status')).toContainText('本机尚无导入的资源包。');
  await expect(page.locator('.resource-pack-original')).toContainText('正在使用');
  expect(await listCallCount(page)).toBe(2);
  await page.evaluate(() => (window as unknown as ColdRepositoryProbeWindow).__blockcolcResourcePackColdStartProbe?.dispose());
});
