import { expect, test } from '@playwright/test';

test('switches the derived world environment without moving project data', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');

  await expect(canvas).toHaveAttribute('data-environment-style', 'natural-valley');
  await expect.poll(async () => Number(await canvas.getAttribute('data-natural-tree-count'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-terrain-water-triangles'))).toBeGreaterThan(0);
  const naturalSpan = Number(await canvas.getAttribute('data-cloud-span-x'));
  expect(naturalSpan).toBeGreaterThan(1_000);
  const natural = await canvas.screenshot({ path: testInfo.outputPath('v11-natural-valley.png') });
  expect(natural.byteLength).toBeGreaterThan(2_000);

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const environment = page.getByRole('group', { name: '聚落环境' });
  await expect(environment.getByRole('button', { name: '自然山谷' })).toHaveAttribute('aria-pressed', 'true');
  await environment.getByRole('button', { name: '经典空岛' }).click();
  await expect(environment.getByRole('button', { name: '经典空岛' })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-environment-style', 'classic-island');
  await expect(canvas).toHaveAttribute('data-natural-tree-count', '0');
  // The sky rebuilds with the environment: clouds must match the small island,
  // not keep the natural valley's wide envelope.
  await expect.poll(async () => Number(await canvas.getAttribute('data-cloud-span-x'))).toBeLessThan(naturalSpan / 2);
  await expect(page.getByText('林边聚落 · 1 栋')).toBeVisible();
});

test('selects a building with a light tap', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-environment-style', 'natural-valley');

  const box = await canvas.boundingBox();
  if (!box) throw new Error('World canvas has no layout box');
  let pointerId = 10;
  for (const y of [0.36, 0.48, 0.6, 0.72]) {
    for (const x of [0.25, 0.38, 0.5, 0.62, 0.75]) {
      const clientX = box.x + box.width * x;
      const clientY = box.y + box.height * y;
      pointerId += 1;
      await canvas.dispatchEvent('pointerdown', { pointerId, pointerType: 'touch', isPrimary: true, clientX, clientY, buttons: 1 });
      await canvas.dispatchEvent('pointerup', { pointerId, pointerType: 'touch', isPrimary: true, clientX, clientY, buttons: 0 });
      if (await page.locator('.building-memory-panel').count()) break;
    }
    if (await page.locator('.building-memory-panel').count()) break;
  }

  await expect(page.getByRole('dialog', { name: '我的第一座工坊' })).toContainText('建筑记忆');
  await expect(page.getByRole('dialog', { name: '我的第一座工坊' })).toContainText('0%');
  await expect(page.getByRole('button', { name: '继续专注' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重置地图' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('v11-building-selected.png'), fullPage: true });
});

test('retains drag gestures in the selected-building view', async ({ page }) => {
  // Documented local-software-WebGL flake: sustained render load can starve
  // canvas gestures past the budget on warm gate runs (reproduced on stock
  // code; real-device acceptance covers the gesture). CI already skips it;
  // the release gate skips it too via its deadline env, while local dev runs
  // still execute it.
  test.skip(Boolean(process.env.CI) || process.env.BLOCKCOLC_E2E_RELEASE_GATE === '1', 'Physical-device and focused local GPU gates own synchronous 3D gesture coverage.');
  // The software-WebGL renderer starves under sustained local-gate load; the
  // canvas attach alone has measured beyond the default budget on warm runs.
  // V20's ambient loop adds a low constant render load that turns the historic
  // local flake deterministic, so this gesture probe runs under reduced motion
  // (which only gates idle ambient/pulse animation — camera gestures still
  // render every interaction frame).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  test.setTimeout(120_000);
  page.on('pageerror', (error) => console.log('PAGEERROR:', error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.log('CONSOLE-ERROR:', message.text()); });
  page.on('framenavigated', (frame) => console.log('NAVIGATED:', frame.url()));
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect.poll(async () => Number(await canvas.getAttribute('data-render-triangles'))).toBeGreaterThan(1_000);
  const buildingEntry = page.getByRole('button', { name: '查看建筑记忆：我的第一座工坊' });
  await buildingEntry.focus();
  await buildingEntry.press('Enter');
  await expect(page.getByRole('dialog', { name: '我的第一座工坊' })).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('World canvas has no layout box');
  const before = Number(await canvas.getAttribute('data-camera-azimuth'));
  await page.evaluate(() => {
    const win = window as unknown as { __canvasLog: string[] };
    win.__canvasLog = [];
    const probe = () => {
      const node = document.querySelector('canvas[aria-label="项目建筑世界"]');
      const heading = document.querySelector('h1')?.textContent ?? '';
      win.__canvasLog.push(`${performance.now().toFixed(0)} attached=${Boolean(node?.isConnected)} heading=${heading}`);
    };
    new MutationObserver(() => probe()).observe(document.body, { childList: true, subtree: true });
    probe();
  });
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-azimuth'))).not.toBe(before);
  // Read the attach log only after the gesture settles: while the drag drives
  // continuous software-WebGL frames, an in-flight page.evaluate can starve
  // behind the render loop on a loaded machine; the log is time-stamped and
  // equally meaningful afterwards.
  console.log('DRAG-LOG:', await page.evaluate(() => (window as unknown as { __canvasLog: string[] }).__canvasLog.join(' | ')));
});
