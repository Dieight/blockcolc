import { expect, test } from '@playwright/test';

// A2-03: bidirectional and rapid-toggle contracts for the state-derived
// switches that replaced the event.target.checked pattern.

test('integrity switch settles on the last intent through rapid toggles and persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  const integrity = page.getByLabel('开启专注完整性');
  await expect(integrity).toBeChecked();
  // Rapid bidirectional toggles: the queued commands must settle on the last
  // click's intent, not on whichever response lands first.
  await integrity.click();
  await integrity.click();
  await expect(integrity).toBeChecked();
  await integrity.click();
  await expect(integrity).not.toBeChecked();
  // The disabled state survives a warm route switch (kept-mounted panes).
  await page.getByRole('button', { name: '计时' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(integrity).not.toBeChecked();
});

test('daily goal switch toggles both ways inside its sheet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '调整今日目标' }).click();
  const daily = page.locator('.daily-goal-sheet input[type="checkbox"]');
  const initial = await daily.isChecked();
  await daily.click();
  await expect(daily).toBeChecked({ checked: !initial });
  await daily.click();
  await expect(daily).toBeChecked({ checked: initial });
});
