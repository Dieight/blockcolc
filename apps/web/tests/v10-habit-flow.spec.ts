import { expect, test } from '@playwright/test';

test('runs a repeatable habit building cycle with frozen targets and stable completed buildings', async ({ page }, testInfo) => {
  test.setTimeout(60_000); // Ten early-completed rounds plus a second WebGL preview renderer for the next-building picker exceed the default budget on shared GPUs.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/');
  await page.getByRole('button', { name: '习惯任务' }).click();
  await page.getByLabel('习惯名称').fill('阅读英语');
  await expect(page.locator('.habit-target-summary')).toContainText('10 轮专注');
  await page.getByRole('button', { name: '开始建造' }).click();

  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('普通任务专注分钟')).toHaveValue('45');
  const habitMinutes = page.getByLabel('习惯任务专注分钟');
  await habitMinutes.fill('1');
  await habitMinutes.press('Enter');
  const habitTarget = page.getByLabel('每座习惯建筑轮数');
  await habitTarget.fill('12');
  await habitTarget.press('Enter');

  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(page.locator('.workbench-context')).toContainText('本周期 0 / 10 轮');
  await expect(page.getByRole('button', { name: '调整本次计划' })).toContainText('总计 1 分钟');

  for (let round = 1; round <= 10; round += 1) {
    await page.getByRole('button', { name: '开始 1 轮' }).click();
    await page.getByRole('button', { name: '结束本次专注' }).click();
    const dialog = page.getByRole('dialog', { name: '如何结束这次专注？' });
    await expect(dialog.getByRole('button', { name: /提前完成本轮/ })).toContainText('推进当前习惯建筑');
    await dialog.getByRole('button', { name: /提前完成本轮/ }).click();
    if (round < 10) await expect(page.locator('.workbench-context')).toContainText(`本周期 ${round} / 10 轮`);
  }

  await expect(page.getByRole('heading', { name: '选择第 2 座建筑' })).toBeVisible();
  await expect(page.locator('.habit-selection-heading')).toContainText('已留下 1 座建筑');
  await expect(page.locator('.habit-selection-heading')).toContainText('下一座需要 12 轮专注');
  await page.getByText('河岸木屋', { exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '开始建造这座建筑' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('habit-next-building-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '开始建造这座建筑' }).click();

  await expect(page.getByText('林边聚落 · 2 栋')).toBeVisible();
  await expect(page.locator('.workbench-context')).toContainText('第 2 座');
  await expect(page.locator('.workbench-context')).toContainText('本周期 0 / 12 轮');
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '习惯周期' })).toBeVisible();
  await expect(page.locator('.habit-cycle-panel')).toContainText('已完成建筑');
  await expect(page.locator('.habit-cycle-panel')).toContainText('1 座');
  await expect(page.locator('.habit-cycle-panel')).toContainText('0 / 12 轮');
  await expect(page.locator('.project-delete-zone')).toContainText('已完成的 1 座建筑会保留');
});
