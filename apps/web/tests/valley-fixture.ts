import { expect, type Page } from '@playwright/test';
import { waitForPreparedWorld } from './world-ready';

/** Older renderer scenarios exercise the valley, not the new-install default. */
export async function selectValleyFixture(page: Page, options: { automaticLighting?: boolean } = {}): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('group', { name: '聚落环境' }).getByRole('button', { name: '自然山谷', exact: true }).click();
  if (options.automaticLighting) {
    await page.getByRole('group', { name: '光影质量' }).getByRole('button', { name: '自动', exact: true }).click();
  }
  await page.getByRole('button', { name: '计时', exact: true }).click();
  const canvas = await waitForPreparedWorld(page);
  await expect(canvas).toHaveAttribute('data-environment-style', 'natural-valley');
  await expect(canvas).toHaveAttribute('data-environment-transition-active', 'false');
}
