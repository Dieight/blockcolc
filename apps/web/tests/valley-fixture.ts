import { expect, type Page } from '@playwright/test';

/** Older renderer scenarios exercise the valley, not the new-install default. */
export async function selectValleyFixture(page: Page, options: { automaticLighting?: boolean } = {}): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('group', { name: '聚落环境' }).getByRole('button', { name: '自然山谷', exact: true }).click();
  if (options.automaticLighting) {
    await page.getByRole('group', { name: '光影质量' }).getByRole('button', { name: '自动', exact: true }).click();
  }
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-environment-style', 'natural-valley');
}
