import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

test('measures resource-pack panel button positions for device scaling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const sample = resolve(process.cwd(), '../../litematic/v17-stay-true-1.21.5.zip');
  test.skip(!existsSync(sample), 'Real pack fixture stays local.');
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles(sample);
  await expect(page.getByRole('status')).toContainText('已导入并启用');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const original = page.locator('.resource-pack-original');
  const importButton = page.getByLabel('导入 Java 资源包 ZIP');
  const packRow = page.locator('.resource-pack-list li').first();
  const useButton = packRow.getByRole('button', { name: '使用' });
  const deleteButton = packRow.getByRole('button', { name: /删除/ });
  const measure = async (locator: import('@playwright/test').Locator, label: string) => {
    const box = await locator.boundingBox();
    console.log('MEASURE', JSON.stringify({ label, ...(box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height), cx: Math.round(box.x + box.width / 2), cy: Math.round(box.y + box.height / 2) } : {}) }));
  };
  await measure(original, 'original-row');
  await measure(importButton, 'import-button');
  await measure(useButton, 'use-button');
  await measure(deleteButton, 'delete-button');
  expect(true).toBe(true);
});
