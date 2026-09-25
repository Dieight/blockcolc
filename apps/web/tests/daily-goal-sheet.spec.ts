import { expect, test } from '@playwright/test';

async function createDefaultProject(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
}

async function openDailyGoal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '调整今日目标' }).click();
  return page.getByRole('dialog', { name: '调整今日目标' });
}

async function currentStateRevision(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ revision?: number } | undefined>((resolve, reject) => {
      const request = database.transaction('appState', 'readonly').objectStore('appState').get('current');
      request.onsuccess = () => resolve(request.result as { revision?: number } | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return record?.revision ?? 0;
  });
}

test('daily goal sheet persists switch and stepper edits across close and reload', async ({ page }) => {
  await createDefaultProject(page);
  let sheet = await openDailyGoal(page);
  const target = sheet.getByLabel('今日目标次数');
  const increment = sheet.getByRole('button', { name: '增加目标轮数' });
  await expect(target).toHaveValue('8');
  await increment.click();
  await expect(target).toHaveValue('9');
  await expect(increment).toBeEnabled();
  await sheet.getByRole('button', { name: '关闭今日目标' }).click();
  await expect(page.getByRole('dialog', { name: '调整今日目标' })).toBeHidden();

  sheet = await openDailyGoal(page);
  await expect(sheet.getByLabel('今日目标次数')).toHaveValue('9');
  const toggle = sheet.getByRole('switch');
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  await sheet.getByRole('button', { name: '关闭今日目标' }).click();

  await page.reload();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  sheet = await openDailyGoal(page);
  await expect(sheet.getByLabel('今日目标次数')).toHaveValue('9');
  await expect(sheet.getByRole('switch')).not.toBeChecked();
  await sheet.getByRole('switch').click();
  await expect(sheet.getByRole('switch')).toBeChecked();
});

test('daily goal sheet traps keyboard focus and restores its trigger', async ({ page }) => {
  await createDefaultProject(page);
  const trigger = page.getByRole('button', { name: '调整今日目标' });
  const sheet = await openDailyGoal(page);
  const close = sheet.getByRole('button', { name: '关闭今日目标' });
  const increment = sheet.getByRole('button', { name: '增加目标轮数' });

  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(increment).toBeFocused();
  await increment.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('daily goal sheet announces invalid target input without changing the saved value', async ({ page }) => {
  await createDefaultProject(page);
  const sheet = await openDailyGoal(page);
  const target = sheet.getByLabel('今日目标次数');
  await target.fill('0');
  await target.press('Tab');
  await expect(target).toHaveAttribute('aria-invalid', 'true');
  await expect(sheet.getByRole('alert')).toContainText('请输入至少 1 轮');
  await expect(target).toHaveValue('0');
});

test('daily goal reports an IndexedDB write failure and reopens from the saved target', async ({ page }) => {
  await createDefaultProject(page);
  let sheet = await openDailyGoal(page);
  const target = sheet.getByLabel('今日目标次数');
  await expect(target).toHaveValue('8');

  await page.evaluate(() => {
    const prototype = IDBObjectStore.prototype;
    const originalPut = prototype.put;
    let failed = false;
    Object.defineProperty(prototype, 'put', {
      configurable: true,
      value: function (this: IDBObjectStore, ...args: any[]) {
        if (!failed && this.name === 'appState') {
          failed = true;
          Object.defineProperty(prototype, 'put', { configurable: true, value: originalPut });
          throw new Error('synthetic IndexedDB state write failure');
        }
        return originalPut.apply(this, args as [unknown, IDBValidKey?]);
      },
    });
  });

  await sheet.getByRole('button', { name: '增加目标轮数' }).click();
  await expect(sheet.getByRole('alert')).toContainText('保存今日目标失败');
  await expect(target).toHaveValue('9');
  await sheet.getByRole('button', { name: '关闭今日目标' }).click();

  sheet = await openDailyGoal(page);
  await expect(sheet.getByLabel('今日目标次数')).toHaveValue('8');
  await expect(sheet.getByRole('alert')).toHaveCount(0);
  await sheet.getByRole('button', { name: '关闭今日目标' }).click();
  await page.reload();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  sheet = await openDailyGoal(page);
  await expect(sheet.getByLabel('今日目标次数')).toHaveValue('8');
});

test('daily goal keeps immediate target saves ordered around stepper and toggle clicks', async ({ page }) => {
  await createDefaultProject(page);
  const sheet = await openDailyGoal(page);
  const target = sheet.getByLabel('今日目标次数');
  const increment = sheet.getByRole('button', { name: '增加目标轮数' });
  const revisionBeforeStepper = await currentStateRevision(page);

  await target.fill('9');
  await increment.click();
  await expect(target).toHaveValue('10');
  await expect.poll(() => currentStateRevision(page)).toBe(revisionBeforeStepper + 1);

  const revisionBeforeToggle = await currentStateRevision(page);
  await target.fill('11');
  await sheet.getByRole('switch').click();
  await expect(sheet.getByRole('switch')).not.toBeChecked();
  await expect.poll(() => currentStateRevision(page)).toBe(revisionBeforeToggle + 2);
  await sheet.getByRole('button', { name: '关闭今日目标' }).click();
  const reopened = await openDailyGoal(page);
  await expect(reopened.getByLabel('今日目标次数')).toHaveValue('11');
  await expect(reopened.getByRole('switch')).not.toBeChecked();
});

test('daily goal sheet fits the five visual QA viewports in both themes', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createDefaultProject(page);
  const sheet = await openDailyGoal(page);
  const viewports = [
    { name: 'compact-phone', width: 360, height: 800 },
    { name: 'large-phone', width: 412, height: 915 },
    { name: 'phone-landscape', width: 915, height: 412 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ];

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(nextTheme => { document.documentElement.dataset.theme = nextTheme; }, theme);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(sheet).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`daily-goal-sheet-${theme}-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
      const metrics = await sheet.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { right: rect.right, bottom: rect.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      expect(metrics.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(metrics.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    }
  }

  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await page.setViewportSize({ width: 360, height: 800 });
  const scaled = await sheet.evaluate(element => ({
    rect: element.getBoundingClientRect().toJSON(),
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(scaled.rect.right).toBeLessThanOrEqual(361);
  expect(scaled.scrollWidth).toBeLessThanOrEqual(scaled.clientWidth + 1);
});
