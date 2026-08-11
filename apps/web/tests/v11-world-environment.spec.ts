import { expect, test } from '@playwright/test';

test('switches the derived world environment without moving project data', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');

  await expect(canvas).toHaveAttribute('data-environment-style', 'natural-valley');
  await expect.poll(async () => Number(await canvas.getAttribute('data-natural-tree-count'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-terrain-water-triangles'))).toBeGreaterThan(0);
  const natural = await canvas.screenshot({ path: testInfo.outputPath('v11-natural-valley.png') });
  expect(natural.byteLength).toBeGreaterThan(2_000);

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const environment = page.getByRole('group', { name: '聚落环境' });
  await expect(environment.getByRole('button', { name: '自然山谷' })).toHaveAttribute('aria-pressed', 'true');
  await environment.getByRole('button', { name: '经典空岛' }).click();
  await expect(environment.getByRole('button', { name: '经典空岛' })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-environment-style', 'classic-island');
  await expect(canvas).toHaveAttribute('data-natural-tree-count', '0');
  await expect(page.getByText('林边聚落 · 1 栋')).toBeVisible();
});

test('selects a building with a light tap while retaining drag gestures', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Run deterministic pointer scanning once.');
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-environment-style', 'natural-valley');

  const box = await canvas.boundingBox();
  if (!box) throw new Error('World canvas has no layout box');
  for (const y of [0.36, 0.48, 0.6, 0.72]) {
    for (const x of [0.25, 0.38, 0.5, 0.62, 0.75]) {
      await canvas.click({ position: { x: box.width * x, y: box.height * y } });
      if (await page.locator('.world-building-details').count()) break;
    }
    if (await page.locator('.world-building-details').count()) break;
  }

  await expect(page.locator('.world-building-details')).toContainText('我的第一座工坊');
  await expect(page.locator('.world-building-details')).toContainText('0%');
  await expect(page.getByRole('button', { name: '返回完整聚落' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('v11-building-selected.png'), fullPage: true });

  const before = Number(await canvas.getAttribute('data-camera-azimuth'));
  await canvas.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.35, clientY: box.y + box.height * 0.5, buttons: 1 });
  await canvas.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: box.y + box.height * 0.5, buttons: 1 });
  await canvas.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: box.y + box.height * 0.5, buttons: 0 });
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-azimuth'))).not.toBe(before);
});
