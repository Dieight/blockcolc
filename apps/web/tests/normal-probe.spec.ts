import { expect, test } from '@playwright/test';

test('captures normal-render natural valley at noon for fog comparison', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-07-26T12:00:00+08:00') });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-environment-style', 'natural-valley');
  await page.waitForTimeout(600);
  await canvas.screenshot({ path: testInfo.outputPath('normal-natural-noon-0.png') });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no box');
  const y = box.y + box.height * 0.52;
  for (let step = 0; step < 6; step += 1) {
    await canvas.dispatchEvent('pointerdown', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.35, clientY: y, buttons: 1 });
    await canvas.dispatchEvent('pointermove', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: y, buttons: 1 });
    await canvas.dispatchEvent('pointerup', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: y, buttons: 0 });
    await page.waitForTimeout(350);
    await canvas.screenshot({ path: testInfo.outputPath(`normal-natural-noon-${step + 1}.png`) });
  }
  console.log('NORMAL-CAPTURED');
});
