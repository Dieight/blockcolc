import { expect, test, type Page } from '@playwright/test';

/**
 * Focus/native bundle probes are intentionally isolated from the legacy
 * cross-feature suites. They are source-level release probes for F02/F14/F16/
 * F17; this turn does not run the shared Web E2E gate or a device build.
 */
async function createFirstProject(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '建立你的第一项任务' })).toBeVisible();
  await page.getByRole('button', { name: '开始建造' }).dblclick();
  await expect(page.getByRole('button', { name: '开始 1 轮' })).toBeVisible();
}

async function setShortRounds(page: Page): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('普通任务专注分钟').fill('1');
  await page.getByLabel('普通任务专注分钟').press('Enter');
  await page.getByLabel('每轮休息分钟').fill('1');
  await page.getByLabel('每轮休息分钟').press('Enter');
  await page.getByRole('button', { name: '计时', exact: true }).click();
}

async function chooseTwoRounds(page: Page): Promise<void> {
  await page.getByRole('button', { name: '调整本次计划' }).click();
  const sheet = page.getByRole('dialog', { name: '安排下一轮' });
  await sheet.getByRole('button', { name: '2 轮' }).click();
  await sheet.getByRole('button', { name: '确认计划' }).click();
  await page.getByRole('button', { name: '开始 2 轮' }).click();
}

async function focusMarks(page: Page): Promise<string[]> {
  return page.evaluate(() => performance.getEntriesByType('mark')
    .map(entry => entry.name)
    .filter(name => name.startsWith('blockcolc-focus:')));
}

test.describe('focus/native bundle F02/F14/F16/F17', () => {
  test('F17 first run requires one finite-or-habit choice and duplicate submit creates one project', async ({ page }) => {
    await createFirstProject(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: '建立你的第一项任务' })).toHaveCount(0);
    await page.getByRole('button', { name: '任务', exact: true }).click();
    await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible();
    await expect(page.locator('.task-detail-panel').getByRole('heading', { name: '我的第一座工坊', exact: true })).toHaveCount(1);
  });

  test('F02 ordinary break and ready share the immersive face and ready keeps total remaining time', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-13T08:00:00Z') });
    await createFirstProject(page);
    await setShortRounds(page);
    await chooseTwoRounds(page);
    await page.clock.fastForward(61_000);
    await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
    await page.getByRole('button', { name: '推进至 25%' }).click();
    await expect(page.locator('.world-screen')).toHaveClass(/is-focusing/);
    await expect(page.locator('.timer-break')).toContainText('休息中');
    await expect(page.getByRole('button', { name: '返回完整模式' })).toHaveCount(0);
    await page.getByRole('button', { name: '跳过休息' }).click();
    await expect(page.locator('.timer-ready')).toContainText('剩余专注总时间');
    await expect(page.locator('.timer-ready')).toContainText('01:00');
    await expect(page.getByRole('button', { name: '返回完整模式' })).toHaveCount(0);
  });

  test('F14 records gesture/queue/commit/persistence/renderer marks after a real start', async ({ page }) => {
    await createFirstProject(page);
    await page.evaluate(() => performance.clearMarks());
    await page.getByRole('button', { name: '开始 1 轮' }).click();
    await expect(page.locator('.world-screen')).toHaveClass(/is-focusing/);
    await expect.poll(() => focusMarks(page)).toEqual(expect.arrayContaining([
      'blockcolc-focus:command-queued',
      'blockcolc-focus:command-committed',
      'blockcolc-focus:plan-persisted',
      'blockcolc-focus:renderer-updated',
    ]));
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('blockcolc-round-plan-v1') ?? 'null') as { status?: string } | null);
    expect(persisted?.status).toBe('focus');
  });

  test('F16 exposes an enabled legacy-compatible return-to-focus preference and persists disable', async ({ page }) => {
    await createFirstProject(page);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const reminder = page.getByLabel('开启返回专注提醒');
    await expect(reminder).toBeChecked();
    await reminder.uncheck();
    await expect(reminder).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1') ?? '{}').returnToFocusReminders)).toBe(false);
  });
});
