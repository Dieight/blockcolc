import { expect, test } from '@playwright/test';
import { readPersistedDomainState } from './persisted-domain-state';

test('opted-in habit rounds automatically resume after rest without a duplicate on reload', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-23T08:00:00Z') });
  await page.goto('/');
  await page.getByRole('group', { name: '任务类型' }).getByRole('button', { name: '习惯任务' }).click();
  await page.getByRole('button', { name: '开始建造' }).click();

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('习惯任务专注分钟').fill('1');
  await page.getByLabel('习惯任务专注分钟').press('Enter');
  await page.getByLabel('每轮休息分钟').fill('1');
  await page.getByLabel('每轮休息分钟').press('Enter');
  await page.getByLabel('自动连续专注').check();
  await page.getByRole('button', { name: '计时', exact: true }).click();

  await page.getByRole('button', { name: '调整本次计划' }).click();
  const sheet = page.getByRole('dialog', { name: '安排习惯专注' });
  await sheet.getByRole('button', { name: '2 轮' }).click();
  await sheet.getByRole('button', { name: '确认计划' }).click();
  await page.getByRole('button', { name: '开始 2 轮' }).click();
  await expect(page.locator('.world-screen')).toHaveClass(/is-focusing/);
  expect((await readPersistedDomainState(page)).state.activeFocusSession).toBeTruthy();

  await page.clock.fastForward(61_000);
  await expect(page.locator('.timer-break')).toContainText('休息中');
  await page.clock.fastForward(60_000);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('blockcolc-round-plan-v1') ?? 'null')?.completedRounds)).toBe(1);
  const beforeReload = (await readPersistedDomainState(page)).state;
  const secondId = beforeReload.activeFocusSession?.id;
  expect(secondId).toBeTruthy();
  expect(beforeReload.focusHistory).toHaveLength(1);
  expect(Date.parse(beforeReload.activeFocusSession!.startedAt)).toBe(Date.parse(beforeReload.focusHistory[0]!.endsAt) + 60_000);

  await page.reload();
  await expect(page.locator('.world-screen')).toHaveClass(/is-focusing/);
  const afterReload = (await readPersistedDomainState(page)).state;
  expect(afterReload.activeFocusSession?.id).toBe(secondId);
  expect(afterReload.focusHistory).toHaveLength(1);
});
