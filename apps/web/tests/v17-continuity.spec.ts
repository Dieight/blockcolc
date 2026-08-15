import { expect, test } from '@playwright/test';

async function createDefaultProject(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
}

async function revealFocusControls(page: import('@playwright/test').Page) {
  const endButton = page.getByRole('button', { name: '结束本次专注' });
  if (await endButton.isVisible().catch(() => false)) return;
  // Aim the double-tap at the hint paragraph, never at a fixed band offset:
  // a tap that lands on the end button would open the end dialog, and the
  // band moves between panel layouts, so pixel offsets can hit other controls.
  const hint = page.locator('.immersive-hint');
  const box = (await hint.boundingBox()) ?? (await page.locator('.focus-panel').boundingBox());
  if (!box) throw new Error('Focus panel has no layout box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // A mouse double-click fires two pointerup events in the same spot, which
    // the gesture detector reads as a double-tap; it also works on desktop
    // contexts where touchscreen emulation is unavailable.
    await page.mouse.dblclick(x, y);
    try {
      await expect(endButton).toBeVisible({ timeout: 1_500 });
      return;
    } catch {
      await page.waitForTimeout(300);
    }
  }
  throw new Error('Focus controls did not reveal after repeated double-taps');
}
test('keeps the global task portfolio collapsed until requested', async ({ page }, testInfo) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await expect(page.getByRole('button', { name: /任务总览/ })).toHaveCount(0);
  await page.getByRole('button', { name: '新增任务' }).click();
  await page.getByLabel('大型任务').fill('第二项长期工作');
  await page.getByRole('button', { name: '清空小任务' }).click();
  await page.getByLabel('新增小任务').fill('完成第二项工作');
  await page.getByLabel('新增小任务').press('Enter');
  await page.getByRole('radio', { name: /河岸木屋/ }).check();
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  const portfolio = page.getByRole('button', { name: /任务总览/ });
  await expect(portfolio).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.task-project-title ~ .project-portfolio')).toHaveCount(1);
  await portfolio.click();
  await expect(portfolio).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.project-portfolio-row')).toHaveCount(2);
  await expect(page.locator('.project-portfolio')).toContainText('当前');
  await expect(page.locator('.project-portfolio')).toContainText('暂停');
  await page.screenshot({ path: testInfo.outputPath('task-portfolio-mobile.png'), fullPage: true });
});

test('explains interrupted time in recent rhythm, project allocation, building memory, and notification status', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-08-12T08:00:00+08:00') });
  await createDefaultProject(page);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('普通任务专注分钟').fill('120');
  await page.getByLabel('普通任务专注分钟').press('Enter');
  await page.getByRole('button', { name: '计时' }).click();
  await page.getByRole('button', { name: '开始 1 轮' }).click();
  await page.clock.fastForward(75 * 60_000);
  await revealFocusControls(page);
  await page.getByRole('button', { name: '结束本次专注' }).click();
  await page.getByRole('button', { name: /中断本轮/ }).click();
  await page.getByRole('button', { name: '外部打扰' }).click();

  await page.getByRole('button', { name: '统计' }).click();
  await page.clock.fastForward(5_100);
  await expect(page.getByRole('heading', { name: '近期专注' })).toBeVisible();
  await expect(page.locator('.rhythm-grid')).toContainText('近 7 天');
  await expect(page.locator('.rhythm-grid')).toContainText('1 小时 15 分钟');
  await expect(page.locator('.rhythm-grid')).not.toContainText('近 7 天分钟');
  await expect(page.locator('.project-allocation')).toContainText('我的第一座工坊');
  await expect(page.locator('.project-allocation')).toContainText('1 小时 15 分钟');
  await page.screenshot({ path: testInfo.outputPath('explanatory-stats-mobile.png'), fullPage: true });

  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '查看建筑' }).click();
  await expect(page.locator('.world-building-details')).toContainText('累计 75 分钟');
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('.notification-health')).toContainText(/提醒|通知/);
});
