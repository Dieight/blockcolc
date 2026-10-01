import { expect, type Page } from '@playwright/test';

/** Use the same visible disclosure as the user; never programmatically reveal the range. */
export async function expandGlassSetting(page: Page) {
  const setting = page.locator('.glass-transparency-setting');
  const range = page.getByLabel('液态玻璃通透程度', { exact: true });
  if (!await range.isVisible()) await setting.locator('summary').click();
  await expect(range).toBeVisible();
  return range;
}
