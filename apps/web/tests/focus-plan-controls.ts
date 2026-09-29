import { expect, type Locator } from '@playwright/test';

/** Follow the product's required reason/note path, not the removed one-click cancel. */
export async function preparePlanCancellation(sheet: Locator) {
  const confirm = sheet.getByRole('button', { name: '确认取消整个计划', exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeDisabled();
  await sheet.getByLabel('取消原因', { exact: true }).selectOption('priority-changed');
  await sheet.getByLabel('补充说明', { exact: true }).fill('测试：重新安排后续轮次');
  await expect(confirm).toBeEnabled();
  return confirm;
}
