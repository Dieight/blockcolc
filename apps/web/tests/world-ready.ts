import { expect, type Page } from '@playwright/test';

/** A mounted canvas is not ready: orbit/restore draws and queue preparation precede the cold reveal. */
export async function waitForPreparedWorld(page: Page) {
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready', 'true', { timeout: 30_000 });
  const canvas = page.getByLabel('项目建筑世界');
  await expect.poll(async()=>Number(await canvas.getAttribute('data-opening-prepared-frames'))).toBeGreaterThanOrEqual(5);
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
  await expect(page.locator('.boot-page')).toHaveCount(0);
  return canvas;
}
