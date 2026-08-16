import { expect, test } from '@playwright/test';

test('prints fog and camera diagnostics', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-07-26T12:00:00+08:00') });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-environment-style', 'natural-valley');
  await page.waitForTimeout(800);
  for (const attr of [
    'weather-kind', 'fog-near', 'fog-far',
    'camera-distance-ratio', 'camera-near', 'camera-far',
    'visibility-nearest-distance', 'visibility-farthest-distance',
    'terrain-far-extent', 'camera-pitch-degrees', 'sky-camera-world-offset',
    'day-phase', 'sun-visibility', 'moon-visibility', 'sun-in-view', 'moon-in-view',
  ]) {
    console.log(`DIAG ${attr}=${await canvas.getAttribute(`data-${attr}`)}`);
  }
  const pageTime = await page.evaluate(() => new Date().toString());
  console.log(`DIAG page-time=${pageTime}`);
  // Classic island must keep its old fog range (its terrain extent is smaller
  // than the settlement framing).
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('group', { name: '聚落环境' }).getByRole('button', { name: '经典空岛' }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-environment-style', 'classic-island');
  await page.waitForTimeout(800);
  console.log(`DIAG classic fog-near=${await canvas.getAttribute('data-fog-near')} fog-far=${await canvas.getAttribute('data-fog-far')}`);
  console.log('FOG-DIAG-DONE');
});
