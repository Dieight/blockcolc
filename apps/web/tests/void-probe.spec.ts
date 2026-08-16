import { expect, test } from '@playwright/test';

async function captureRotations(page: import('@playwright/test').Page, testInfo: import('@playwright/test').TestInfo, prefix: string) {
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-terrain-generation-version', '4');
  await page.waitForTimeout(600);
  await canvas.screenshot({ path: testInfo.outputPath(`${prefix}-0.png`) });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no box');
  const y = box.y + box.height * 0.52;
  for (let step = 0; step < 6; step += 1) {
    await canvas.dispatchEvent('pointerdown', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.35, clientY: y, buttons: 1 });
    await canvas.dispatchEvent('pointermove', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: y, buttons: 1 });
    await canvas.dispatchEvent('pointerup', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: y, buttons: 0 });
    await page.waitForTimeout(350);
    await canvas.screenshot({ path: testInfo.outputPath(`${prefix}-${step + 1}.png`) });
  }
  console.log(`VOID-CAPTURED:${prefix}`);
}

test('void-scans natural valley at noon', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-07-26T12:00:00+08:00') });
  await page.goto('/?voidscan');
  await page.getByRole('button', { name: '开始建造' }).click();
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-environment-style', 'natural-valley');
  await captureRotations(page, testInfo, 'void-natural-noon');
});

test('void-scans natural valley at low sun', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-07-26T06:30:00+08:00') });
  await page.goto('/?voidscan');
  await page.getByRole('button', { name: '开始建造' }).click();
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-environment-style', 'natural-valley');
  await captureRotations(page, testInfo, 'void-natural-low');
});

test('void-scans classic island at noon', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-07-26T12:00:00+08:00') });
  await page.goto('/?voidscan');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('group', { name: '聚落环境' }).getByRole('button', { name: '经典空岛' }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-environment-style', 'classic-island');
  await captureRotations(page, testInfo, 'void-classic-noon');
});
