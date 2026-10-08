import { expect, test, type Page } from '@playwright/test';

async function createDefaultProject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
}
async function openDailyGoal(page: Page) {
  await page.getByRole('button', { name: '调整今日目标' }).click();
  return page.getByRole('dialog', { name: '调整今日目标' });
}
async function currentStateRevision(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ revision?: number } | undefined>((resolve, reject) => {
      const request = db.transaction('appState', 'readonly').objectStore('appState').get('current');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.close(); return record?.revision ?? 0;
  });
}

test('daily goal physical slider persists edits; zero disables and re-enabling restores the saved target', async ({ page }) => {
  await createDefaultProject(page);
  let sheet = await openDailyGoal(page);
  const target = sheet.getByLabel('今日目标次数');
  await expect(target).toHaveValue('8');
  await target.press('ArrowRight'); await expect(target).toHaveValue('9'); await expect(target).toBeEnabled();
  await sheet.getByRole('button', { name: '关闭今日目标' }).click();
  sheet = await openDailyGoal(page); await expect(sheet.getByLabel('今日目标次数')).toHaveValue('9');
  await sheet.getByRole('switch').click(); await expect(sheet.getByRole('switch')).not.toBeChecked();
  await expect(sheet.getByLabel('今日目标次数')).toHaveValue('0');
  await expect(sheet.getByRole('switch')).toBeEnabled();
  await sheet.getByRole('button', { name: '关闭今日目标' }).click();
  await page.reload(); await page.getByRole('button', { name: '任务', exact: true }).click();
  sheet = await openDailyGoal(page); await expect(sheet.getByLabel('今日目标次数')).toHaveValue('0');
  await expect(sheet.getByRole('switch')).not.toBeChecked();
  await sheet.getByRole('switch').click(); await expect(sheet.getByRole('switch')).toBeChecked();
  await expect(sheet.getByLabel('今日目标次数')).toHaveValue('9');
});

test('daily goal sheet traps keyboard focus and restores its trigger', async ({ page }) => {
  await createDefaultProject(page);
  const trigger = page.getByRole('button', { name: '调整今日目标' }), sheet = await openDailyGoal(page);
  const close = sheet.getByRole('button', { name: '关闭今日目标' }), target = sheet.getByLabel('今日目标次数');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab'); await expect(target).toBeFocused();
  await target.press('Tab'); await expect(close).toBeFocused();
  await page.keyboard.press('Escape'); await expect(sheet).toBeHidden(); await expect(trigger).toBeFocused();
});

test('daily goal slider bounds are zero through twenty; zero is not stored as a zero-round goal', async ({ page }) => {
  await createDefaultProject(page); const sheet = await openDailyGoal(page), target = sheet.getByLabel('今日目标次数');
  await expect(target).toHaveAttribute('min', '0'); await expect(target).toHaveAttribute('max', '20');
  await target.press('End'); await expect(target).toHaveValue('20'); await expect(target).toBeEnabled();
  await target.press('Home'); await expect(target).toHaveValue('0'); await expect(target).toBeEnabled();
  await expect(sheet.getByRole('switch')).not.toBeChecked(); await expect(sheet.getByRole('alert')).toHaveCount(0);
  await sheet.getByRole('switch').click(); await expect(target).toHaveValue('20');
});

test('daily goal reports an IndexedDB write failure and reopens from the saved target', async ({ page }) => {
  await createDefaultProject(page); let sheet = await openDailyGoal(page);
  const target = sheet.getByLabel('今日目标次数'); await expect(target).toHaveValue('8');
  await page.evaluate(() => {
    const prototype = IDBObjectStore.prototype, originalPut = prototype.put; let failed = false;
    Object.defineProperty(prototype, 'put', { configurable: true, value: function(this: IDBObjectStore, ...args: any[]) {
      if (!failed && this.name === 'appState') {
        failed = true; Object.defineProperty(prototype, 'put', { configurable: true, value: originalPut });
        throw new Error('synthetic IndexedDB state write failure');
      }
      return originalPut.apply(this, args as [unknown, IDBValidKey?]);
    } });
  });
  await target.press('ArrowRight'); await expect(sheet.getByRole('alert')).toContainText('保存今日目标失败');
  await expect(target).toHaveValue('9'); await sheet.getByRole('button', { name: '关闭今日目标' }).click();
  sheet = await openDailyGoal(page); await expect(sheet.getByLabel('今日目标次数')).toHaveValue('8');
  await expect(sheet.getByRole('alert')).toHaveCount(0); await sheet.getByRole('button', { name: '关闭今日目标' }).click();
  await page.reload(); await page.getByRole('button', { name: '任务', exact: true }).click();
  sheet = await openDailyGoal(page); await expect(sheet.getByLabel('今日目标次数')).toHaveValue('8');
});

test('daily goal horizontal drag previews without saving and commits exactly once on release', async ({ page }) => {
  await createDefaultProject(page); const sheet = await openDailyGoal(page), target = sheet.getByLabel('今日目标次数');
  const rail = (await sheet.locator('.physical-slider-rail').boundingBox())!, y = rail.y + rail.height / 2;
  const before = await currentStateRevision(page);
  await page.mouse.move(rail.x + rail.width * .4, y); await page.mouse.down();
  await page.mouse.move(rail.x + rail.width * .55, y, { steps: 5 });
  await expect(sheet.locator('.daily-goal-target-heading output')).toHaveText('预计 11 轮');
  expect(await currentStateRevision(page)).toBe(before); await expect(target).toHaveValue('8');
  await page.mouse.up(); await expect(target).toHaveValue('11');
  await expect.poll(() => currentStateRevision(page)).toBe(before + 1);
  await expect(target).toBeEnabled(); await sheet.getByRole('switch').click();
  await expect(sheet.getByRole('switch')).not.toBeChecked(); await expect(target).toHaveValue('0');
  await expect.poll(() => currentStateRevision(page)).toBe(before + 2);
  await sheet.getByRole('button', { name: '关闭今日目标' }).click();
  const reopened = await openDailyGoal(page);
  await expect(reopened.getByLabel('今日目标次数')).toHaveValue('0'); await expect(reopened.getByRole('switch')).not.toBeChecked();
});

test('daily goal sheet fits five QA viewports and attaches to phone edges in both themes', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await createDefaultProject(page); const sheet = await openDailyGoal(page);
  const viewports = [
    { name: 'compact-phone', width: 360, height: 800 }, { name: 'large-phone', width: 412, height: 915 },
    { name: 'phone-landscape', width: 915, height: 412 }, { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport); await expect(sheet).toBeVisible();
      await page.screenshot({ path: info.outputPath('daily-goal-' + theme + '-' + viewport.name + '.png'), fullPage: true, animations: 'disabled' });
      const r = await sheet.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, width: r.width, right: r.right, bottom: r.bottom, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }; });
      expect(r.right).toBeLessThanOrEqual(viewport.width + 1); expect(r.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(r.scrollWidth).toBeLessThanOrEqual(r.clientWidth + 1);
      if (viewport.width <= 640) { expect(r.x).toBe(0); expect(r.width).toBe(viewport.width); expect(r.bottom).toBe(viewport.height); }
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; }); await page.setViewportSize({ width: 360, height: 800 });
  const scaled = await sheet.evaluate(e => ({ right: e.getBoundingClientRect().right, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }));
  expect(scaled.right).toBeLessThanOrEqual(361); expect(scaled.scrollWidth).toBeLessThanOrEqual(scaled.clientWidth + 1);
});
