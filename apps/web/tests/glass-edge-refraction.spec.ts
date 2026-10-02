import { expect, test } from '@playwright/test';
import { fixBusinessDate } from './fixed-business-date';

// Keep the suite filename so the release runner still covers the changed contract.
test('glass no longer warps orbiting terrain and keeps clock input and reduced-transparency layout', async ({ page }, info) => {
  test.setTimeout(90_000);
  await fixBusinessDate(page, new Date('2026-10-01T12:00:00+08:00'));
  await page.goto('/'); await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('开启极简模式', { exact: true }).check();
  await page.getByLabel('临时调试世界', { exact: true }).check();
  await page.getByLabel('天气', { exact: true }).selectOption('clear');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  const world = page.getByLabel('项目建筑世界', { exact: true });
  await expect.poll(async () => Number(await world.getAttribute('data-render-frame-count'))).toBeGreaterThan(0);
  await expect(page.locator('.glass-edge-refraction')).toHaveCount(0);
  const bounds = (await world.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .3, bounds.y + bounds.height * .25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .28, { steps: 12 });
  await page.mouse.up();
  const clock = page.locator('.minimal-clock-gesture'); await clock.press('ArrowUp'); await clock.press('Escape');
  await page.locator('.focus-panel').screenshot({ path: info.outputPath('glass-unwarped-light.png') });
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1') ?? '{}');
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({ ...saved, themeMode: 'dark' }));
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.glass-edge-refraction')).toHaveCount(0);
  await page.locator('.focus-panel').screenshot({ path: info.outputPath('glass-unwarped-dark.png') });
  const height = (await page.locator('.focus-panel').boundingBox())!.height;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  expect((await page.locator('.focus-panel').boundingBox())!.height).toBe(height);
  await clock.press('ArrowUp'); await clock.press('Escape');
  await page.locator('.focus-panel').screenshot({ path: info.outputPath('glass-solid-fallback.png') });
  await cdp.detach();
});

test('glass needs no GPU-to-2D background copies to retain a readable, operable panel', async ({ page }, info) => {
  await page.addInitScript(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D['drawImage']>) {
      if (args[0] instanceof HTMLCanvasElement && args[0].getAttribute('aria-label') === '项目建筑世界') {
        throw new DOMException('Synthetic unsupported WebGL copy', 'NotSupportedError');
      }
      return draw.apply(this, args);
    } as typeof CanvasRenderingContext2D.prototype.drawImage;
  });
  await page.goto('/'); await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('开启极简模式', { exact: true }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(page.locator('.glass-edge-refraction')).toHaveCount(0);
  const clock = page.locator('.minimal-clock-gesture'); await clock.press('ArrowUp');
  await expect(clock).toHaveAttribute('aria-label', /专注到.*双击或按 Enter 开始专注/);
  await clock.press('Escape');
  await expect(clock).toHaveAttribute('aria-label', /当前时间.*选择结束时间/);
  await page.locator('.focus-panel').screenshot({ path: info.outputPath('glass-no-copy.png') });
});
