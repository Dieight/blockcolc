import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'phone-small', width: 360, height: 800 },
  { name: 'phone', width: 412, height: 915 },
  { name: 'landscape', width: 915, height: 412 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function interruptFocus(page: import('@playwright/test').Page) {
  await revealFocusControls(page);
  await page.getByRole('button', { name: '结束本次专注' }).click();
  await page.getByRole('button', { name: '中断本轮' }).click();
  await page.getByRole('button', { name: '不记录' }).click();
}

async function revealFocusControls(page: import('@playwright/test').Page) {
  const endButton = page.getByRole('button', { name: '结束本次专注' });
  if (await endButton.isVisible().catch(() => false)) return;
  // Aim the double-tap at the hint paragraph, never at a fixed band offset:
  // a tap that lands on the end button would open the end dialog, and the
  // band moves between panel layouts, so pixel offsets can hit other controls.
  const hint = page.locator('.immersive-hint');
  const box = (await hint.boundingBox()) ?? (await page.locator('.focus-panel').boundingBox());
  if (!box) throw new Error('Focus panel has no layout box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // A mouse double-click fires two pointerup events in the same spot, which
    // the gesture detector reads as a double-tap; it also works on desktop
    // contexts where touchscreen emulation is unavailable.
    await page.mouse.dblclick(x, y);
    try {
      await expect(endButton).toBeVisible({ timeout: 1_500 });
      return;
    } catch {
      await page.waitForTimeout(300);
    }
  }
  throw new Error('Focus controls did not reveal after repeated double-taps');
}
test('keeps setup and the focus world usable across the target viewport matrix', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('大型任务').fill('完成一个包含非常长名称与 EnglishIdentifierWithoutSpaces1234567890 的重要大型任务');
  await page.getByRole('button', { name: '清空小任务' }).click();
  await page.getByLabel('新增小任务').fill('整理所有输入资料并逐项核对');
  await page.getByLabel('新增小任务').press('Enter');
  await page.getByLabel('新增小任务').fill('实现核心流程与异常恢复');
  await page.getByLabel('新增小任务').press('Enter');
  await page.getByLabel('新增小任务').fill('完成移动端、横屏、平板和桌面验证');
  await page.getByLabel('新增小任务').press('Enter');

  const preview = page.getByRole('img', { name: /完整建筑预览/ });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await preview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    const png = await preview.screenshot({ path: testInfo.outputPath(`setup-canvas-${viewport.name}.png`) });
    expect(png.byteLength).toBeGreaterThan(2_000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`setup-${viewport.name}.png`), fullPage: true });
  }

  await page.getByRole('button', { name: '开始建造' }).click();
  const world = page.getByLabel('项目建筑世界');
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(100);
    const png = await world.screenshot({ path: testInfo.outputPath(`world-canvas-${viewport.name}.png`) });
    expect(png.byteLength).toBeGreaterThan(2_000);
    const layout = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
      const action = document.querySelector('.focus-panel .primary')?.getBoundingClientRect();
      const worldRect = document.querySelector('.world-screen .world')?.getBoundingClientRect();
      const panelRect = document.querySelector('.world-screen .focus-panel')?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        actionClearOfNav: !nav || !action || action.bottom <= nav.top || action.top >= nav.bottom,
        actionInViewport: !action || (action.top >= 0 && action.bottom <= innerHeight),
        worldAndPanelShareRow: !worldRect || !panelRect || Math.abs(worldRect.top - panelRect.top) <= 1,
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(1);
    if (viewport.width < 700) {
      expect(layout.actionClearOfNav).toBe(true);
      expect(layout.actionInViewport).toBe(true);
    }
    if (viewport.width >= 700 && viewport.height <= 600) expect(layout.worldAndPanelShareRow).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`world-${viewport.name}.png`), fullPage: true });
  }

  await page.getByRole('button', { name: '开始 1 轮' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-immersive/);
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.getByText('本轮任务')).toBeVisible();
  await revealFocusControls(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(100);
    const layout = await page.evaluate(() => {
      const worldRect = document.querySelector('.is-focusing .world')?.getBoundingClientRect();
      const panelRect = document.querySelector('.is-focusing .focus-panel')?.getBoundingClientRect();
      const action = document.querySelector('.is-focusing .primary')?.getBoundingClientRect();
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        worldVisible: Boolean(worldRect && worldRect.width > 0 && worldRect.height >= 200),
        panelInViewport: Boolean(panelRect && panelRect.top >= 0 && panelRect.bottom <= innerHeight + 1),
        actionInViewport: Boolean(action && action.top >= 0 && action.bottom <= innerHeight + 1),
      };
    });
    expect(layout.overflowX).toBeLessThanOrEqual(1);
    expect(layout.overflowY).toBeLessThanOrEqual(1);
    expect(layout.worldVisible).toBe(true);
    expect(layout.panelInViewport).toBe(true);
    expect(layout.actionInViewport).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`focus-immersive-${viewport.name}.png`), fullPage: true });
  }

  await interruptFocus(page);
  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-immersive/);
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
});

test('serves install metadata and reusable app icons', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ name: '方块钟 Blockcolc', display: 'standalone' });
  for (const icon of ['/icons/blockcolc-192.png', '/icons/blockcolc-512.png']) {
    const response = await request.get(icon);
    expect(response.ok()).toBe(true);
    expect((await response.body()).byteLength).toBeGreaterThan(2_000);
  }
});

test('bleeds the focus world under a landscape cutout while keeping controls safe', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByLabel('调整本次计划').click();
  await page.getByRole('dialog', { name: '安排下一轮' }).getByRole('button', { name: '确认计划' }).click();
  await page.getByRole('button', { name: '开始 1 轮' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-immersive/);
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty('--native-safe-area-inset-left', '46px');
    style.setProperty('--native-safe-area-inset-top', '24px');
    style.setProperty('--native-safe-area-inset-right', '8px');
    style.setProperty('--native-safe-area-inset-bottom', '6px');
  });
  // Design A: the immersive world owns the whole screen and the HUD is gone;
  // the controls live in the floating band until the double-tap reveals them.
  await revealFocusControls(page);

  const layout = await page.evaluate(() => {
    const shell = document.querySelector('.focus-immersive')?.getBoundingClientRect();
    const world = document.querySelector('.is-focusing .world')?.getBoundingClientRect();
    const hud = document.querySelector('.is-focusing .world-hud')?.getBoundingClientRect();
    const panel = document.querySelector('.is-focusing .focus-panel')?.getBoundingClientRect();
    const action = document.querySelector('.is-focusing .primary')?.getBoundingClientRect();
    return { shell, world, hud, panel, action, width: innerWidth, height: innerHeight };
  });
  expect(layout.shell?.left).toBe(0);
  expect(layout.shell?.right).toBe(915);
  expect(layout.world?.left).toBe(0);
  expect(layout.world?.top).toBe(0);
  expect(layout.world?.right).toBeGreaterThanOrEqual(layout.width - 1);
  expect(layout.hud?.width).toBe(0);
  expect(layout.panel?.width).toBeLessThanOrEqual(330);
  expect(layout.panel?.right).toBeLessThanOrEqual(layout.width);
  expect(layout.action?.right).toBeLessThanOrEqual(layout.width - 8 + 1);
  expect(layout.action?.bottom).toBeLessThanOrEqual(layout.height - 6 + 1);
  const canvas = await page.getByLabel('项目建筑世界').screenshot({ path: testInfo.outputPath('focus-landscape-cutout-canvas.png') });
  expect(canvas.byteLength).toBeGreaterThan(2_000);
  await page.screenshot({ path: testInfo.outputPath('focus-landscape-cutout.png'), fullPage: true });
});
