import { expect, test } from '@playwright/test';

test('captures flat-render views for hole scanning', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-07-26T12:00:00+08:00') });
  await page.goto('/?flat');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-terrain-generation-version', '4');
  await page.waitForTimeout(600);
  await canvas.screenshot({ path: testInfo.outputPath('flat-0.png') });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no box');
  const y = box.y + box.height * 0.52;
  for (let step = 0; step < 10; step += 1) {
    await canvas.dispatchEvent('pointerdown', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.35, clientY: y, buttons: 1 });
    await canvas.dispatchEvent('pointermove', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: y, buttons: 1 });
    await canvas.dispatchEvent('pointerup', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: y, buttons: 0 });
    await page.waitForTimeout(350);
    await canvas.screenshot({ path: testInfo.outputPath(`flat-${step + 1}.png`) });
  }
  console.log('FLAT-CAPTURED');
});
