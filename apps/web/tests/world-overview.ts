import { expect, type Page } from '@playwright/test';
import { waitForPreparedWorld } from './world-ready';

/** Tests of the whole settlement enter it through the actual map control. */
export async function showWorldOverview(page: Page): Promise<void> {
  const canvas = await waitForPreparedWorld(page);
  // The cold reveal belongs to the first renderer, not every environment
  // replacement. Later generations deliberately clear the old reveal marker
  // and prepare real frames without replaying the opening animation.
  if (Number(await canvas.getAttribute('data-renderer-generation')) === 1
    || await canvas.getAttribute('data-opening-reveal-state') === 'active') {
    await expect(canvas).toHaveAttribute('data-opening-reveal-state', /^(completed|cancelled)$/, { timeout: 20_000 });
  }
  const map = page.getByRole('button', { name: '重置地图', exact: true });
  if (Number(await canvas.getAttribute('data-camera-minimum-distance-ratio')) >= .9) await expect(map).toBeVisible();
  if (await map.isVisible()) await map.click();
  await expect(map).toBeHidden();
  await expect(canvas).toHaveAttribute('data-camera-minimum-distance-ratio', '0.4500');
}
