import { expect, test } from '@playwright/test';
import { fixBusinessDate } from './fixed-business-date';

test('glass samples only current-world edges, leaves center and hit targets intact, and respects reduced transparency', async ({ page }, info) => {
  test.setTimeout(90_000);
  await fixBusinessDate(page, new Date('2026-10-01T12:00:00+08:00'));
  await page.goto('/'); await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('开启极简模式', { exact: true }).check();
  await page.getByLabel('临时调试世界', { exact: true }).check();
  await page.getByLabel('天气', { exact: true }).selectOption('clear');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  const edge = page.locator('.glass-edge-refraction');
  await expect.poll(async () => Number(await edge.getAttribute('data-glass-frame'))).toBeGreaterThan(0);
  const pixels = await edge.evaluate((c: HTMLCanvasElement) => {
    const context = c.getContext('2d')!, center = context.getImageData(c.width / 2, c.height / 2, 1, 1).data;
    const top = context.getImageData(0, 0, c.width, 16).data;
    return { centerAlpha: center[3], edgePixels: Array.from(top).filter((_, i) => i % 4 === 3 && top[i]! > 0).length };
  });
  expect(pixels.centerAlpha).toBe(0); expect(pixels.edgePixels).toBeGreaterThan(100);
  await expect(edge).toHaveCSS('pointer-events', 'none');
  const clock = page.locator('.minimal-clock-gesture'); await clock.press('ArrowUp'); await clock.press('Escape');
  await page.locator('.focus-panel').screenshot({ path: info.outputPath('glass-refracted-light.png') });
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1') ?? '{}');
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({ ...saved, themeMode: 'dark' }));
  });
  await page.reload();
  await expect.poll(async () => Number(await edge.getAttribute('data-glass-frame'))).toBeGreaterThan(0);
  await page.locator('.focus-panel').screenshot({ path: info.outputPath('glass-refracted-dark.png') });
  const height = (await page.locator('.focus-panel').boundingBox())!.height;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await expect(edge).toBeHidden();
  expect((await page.locator('.focus-panel').boundingBox())!.height).toBe(height);
  await page.locator('.focus-panel').screenshot({ path: info.outputPath('glass-solid-fallback.png') });
  await cdp.detach();
});

test('unsupported world-band copying falls back to the readable glass without losing keyboard input', async ({ page }, info) => {
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
  await expect(page.locator('.glass-edge-refraction')).toHaveAttribute('data-glass-fallback', 'true');
  const clock = page.locator('.minimal-clock-gesture'); await clock.press('ArrowUp');
  await expect(clock).toHaveAttribute('aria-label', /专注到.*双击或按 Enter 开始专注/);
  await clock.press('Escape');
  await expect(clock).toHaveAttribute('aria-label', /当前时间.*选择结束时间/);
  await page.locator('.focus-panel').screenshot({ path: info.outputPath('glass-copy-capability-fallback.png') });
});
