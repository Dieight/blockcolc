import { expect, test } from '@playwright/test';

test('reports terrain cell coordinates on a light tap', async ({ page }) => {
  // V19 diagnostic cell picking is opt-in behind ?pick.
  await page.goto('/?pick');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-terrain-generation-version', '4');
  await page.waitForTimeout(600);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no box');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
  const chip = page.getByTestId('world-pick');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/x -?\d+ · z -?\d+ · 高 -?\d+/);
  console.log('PICK-DIAG:', await chip.textContent());
});
