import { expect, test, type Page } from '@playwright/test';

async function selectBuilding(page: Page, title: string) {
  const before = await cameraState(page);
  const entry = page.getByRole('button', { name: `查看建筑记忆：${title}` });
  await entry.focus();
  await entry.press('Enter');
  const panel = page.getByRole('dialog', { name: title });
  await expect(panel).toBeVisible();
  await expect.poll(() => cameraState(page)).not.toEqual(before);
  return panel;
}

async function cameraState(page: Page) {
  return page.locator('canvas[aria-label="项目建筑世界"]').evaluate((canvas) => {
    const data = (canvas as HTMLCanvasElement).dataset;
    return {
      azimuth: data.cameraAzimuth,
      pitch: data.cameraPitchDegrees,
      distance: data.cameraDistance,
      targetX: data.cameraTargetX,
      targetY: data.cameraTargetY,
      targetZ: data.cameraTargetZ,
    };
  });
}

test('building memory shows derived history and returns to the current task', async ({ page }, testInfo) => {
  // The release runner exercises two viewport layouts, full-page screenshots,
  // and camera preservation through the software-WebGL world in one scenario.
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();

  const panel = await selectBuilding(page, '我的第一座工坊');
  expect(await panel.evaluate(element => element.closest('figure.world') === null)).toBe(true);
  await expect(panel).toContainText('建筑记忆');
  await expect(panel).toContainText('正在建造');
  await expect(panel).toContainText('0%');
  await expect(panel).toContainText('尚无记录');
  await expect(panel).toContainText('确定目标');
  const memoryMaterial = await panel.evaluate(element => ({
    backdropFilter: getComputedStyle(element).backdropFilter,
    backgroundImage: getComputedStyle(element).backgroundImage,
  }));
  expect(memoryMaterial.backdropFilter).toContain('blur(14px)');
  expect(memoryMaterial.backgroundImage).toContain('linear-gradient');
  const continueButton = panel.getByRole('button', { name: '继续专注' });
  await expect(continueButton).toBeVisible();
  expect((await continueButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const portraitBox = await panel.boundingBox();
  const portraitViewport = page.viewportSize();
  expect(portraitBox?.x).toBeGreaterThanOrEqual(0);
  expect(portraitBox?.y).toBeGreaterThanOrEqual(0);
  expect(portraitBox && portraitViewport ? portraitBox.x + portraitBox.width : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(portraitViewport?.width ?? 0);
  expect(portraitBox && portraitViewport ? portraitBox.y + portraitBox.height : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(portraitViewport?.height ?? 0);
  if (testInfo.project.name === 'mobile-chromium') {
    const navBox = await page.locator('.bottom-nav').boundingBox();
    expect(Math.abs((portraitBox!.y + portraitBox!.height) - navBox!.y)).toBeLessThanOrEqual(1.5);
  } else {
    const headerBox = await page.locator('.topbar').boundingBox();
    expect(Math.abs(portraitBox!.y - (headerBox!.y + headerBox!.height))).toBeLessThanOrEqual(1.5);
    expect(Math.abs((portraitBox!.x + portraitBox!.width) - portraitViewport!.width)).toBeLessThanOrEqual(1.5);
  }
  await page.screenshot({ path: testInfo.outputPath('building-memory.png'), fullPage: true });

  if (testInfo.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 915, height: 412 });
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox?.x).toBeGreaterThanOrEqual(0);
    expect(panelBox?.y).toBeGreaterThanOrEqual(0);
    expect(panelBox ? panelBox.x + panelBox.width : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(915);
    expect(panelBox ? panelBox.y + panelBox.height : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(412);
    expect(await panel.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    const headerBox = await page.locator('.topbar').boundingBox();
    expect(Math.abs(panelBox!.y - (headerBox!.y + headerBox!.height))).toBeLessThanOrEqual(1.5);
    expect(Math.abs((panelBox!.x + panelBox!.width) - 915)).toBeLessThanOrEqual(1.5);
    await page.screenshot({ path: testInfo.outputPath('building-memory-landscape.png'), fullPage: true });
  }

  const focusedCamera = await cameraState(page);
  await continueButton.click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('heading', { name: '我的第一座工坊' })).toBeVisible();
  await expect.poll(() => cameraState(page)).toEqual(focusedCamera);
});

test('a paused building can become the current task from its memory panel', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '新增任务' }).click();
  await page.getByLabel('大型任务').fill('第二项长期工作');
  await page.getByRole('button', { name: '开始建造' }).click();
  await expect(page.locator('#world-summary')).toContainText('我的第一座工坊，林边工坊，暂停建造');

  const panel = await selectBuilding(page, '我的第一座工坊');
  await expect(panel).toContainText('暂停建造');
  const focusedCamera = await cameraState(page);
  await panel.getByRole('button', { name: '继续这个任务' }).click();

  await expect(panel).toBeHidden();
  await expect(page.getByRole('heading', { name: '我的第一座工坊' })).toBeVisible();
  await expect(page.locator('#world-summary')).toContainText('我的第一座工坊，林边工坊，正在建造');
  await expect(page.locator('#world-summary')).toContainText('第二项长期工作，林边工坊，暂停建造');
  await expect.poll(() => cameraState(page)).toEqual(focusedCamera);
});
