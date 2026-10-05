import { expect, type Page } from '@playwright/test';

/** A mounted canvas is not ready: shader preparation and both actual warm frames precede the cold reveal. */
export async function waitForPreparedWorld(page: Page) {
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready', 'true', { timeout: 30_000 });
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-opening-prepared-frames', '2');
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
  await expect(page.locator('.boot-page')).toHaveCount(0);
  return canvas;
}
