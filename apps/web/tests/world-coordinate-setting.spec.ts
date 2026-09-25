import { expect, test } from '@playwright/test';

test('world coordinates can be enabled for QA and disabled persistently without rebuilding', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByLabel('大型任务').fill('坐标开关验证');
  await page.getByRole('button', { name: '开始建造' }).click();

  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-coordinate-picking', 'false');
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
  const initialRebuildCount = await canvas.getAttribute('data-world-rebuild-count');
  expect(initialRebuildCount).toBe('1');
  await expect(canvas).toHaveAttribute('data-renderer-generation', '1');
  await page.getByRole('button', { name: '设置' }).click();
  const toggle = page.getByLabel('显示世界坐标');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole('button', { name: '计时' }).click();
  await expect(canvas).toHaveAttribute('data-coordinate-picking', 'true');
  await expect(canvas).toHaveAttribute('data-world-rebuild-count', initialRebuildCount!);

  const box = await canvas.boundingBox();
  if (!box) throw new Error('World canvas has no layout box');
  await page.mouse.click(box.x + box.width * 0.18, box.y + box.height * 0.68);
  await expect(page.getByTestId('world-pick')).toHaveText(/x -?\d+ · z -?\d+ · 高 -?\d+/);
  const memoryClose = page.getByRole('button', { name: '关闭建筑记忆' });
  if (await memoryClose.isVisible()) await memoryClose.click();

  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('显示世界坐标').uncheck();
  await page.getByRole('button', { name: '计时' }).click();
  await expect(canvas).toHaveAttribute('data-coordinate-picking', 'false');
  await expect(canvas).toHaveAttribute('data-world-rebuild-count', initialRebuildCount!);
  await expect(page.getByTestId('world-pick')).toBeHidden();
  await expect(canvas).toHaveAttribute('data-renderer-generation', '1');

  await page.reload();
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-coordinate-picking', 'false');
});
