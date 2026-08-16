import { expect, test } from '@playwright/test';

test('captures cinematic low-sun views and scans for bloom-white faces', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-07-26T06:30:00+08:00') });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-terrain-generation-version', '4');
  // Switch to the cinematic lighting preset (bloom enabled).
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('group', { name: '光影质量' }).getByRole('button', { name: '精致' }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-active-lighting-quality', 'cinematic');
  await page.waitForTimeout(600);
  await canvas.screenshot({ path: testInfo.outputPath('cine-0.png') });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no box');
  const y = box.y + box.height * 0.52;
  for (let step = 0; step < 8; step += 1) {
    await canvas.dispatchEvent('pointerdown', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.35, clientY: y, buttons: 1 });
    await canvas.dispatchEvent('pointermove', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: y, buttons: 1 });
    await canvas.dispatchEvent('pointerup', { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width * 0.65, clientY: y, buttons: 0 });
    await page.waitForTimeout(350);
    await canvas.screenshot({ path: testInfo.outputPath(`cine-${step + 1}.png`) });
  }
  console.log('CINE-CAPTURED');
});
