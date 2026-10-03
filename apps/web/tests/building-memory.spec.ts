import { expect, test, type Page } from '@playwright/test';

async function selectBuilding(page: Page, title: string) {
  const canvas = page.getByLabel('项目建筑世界');
  // Navigating to task creation may legitimately cancel the opening reveal.
  // Both terminal states are ready for selection; an active reveal is not.
  await expect(canvas).toHaveAttribute('data-opening-reveal-state', /^(completed|cancelled)$/, {timeout:20_000});
  const map = page.getByRole('button', {name:'重置地图',exact:true});
  // Opening commits the renderer focus before React mounts its map action.
  // Wait for that receipt when needed, then verify the renderer actually
  // adopted the overview limits before taking the comparison baseline.
  if (Number(await canvas.getAttribute('data-camera-minimum-distance-ratio')) >= .9) await expect(map).toBeVisible();
  if (await map.isVisible()) {
    await map.click();
    await expect(map).toBeHidden();
  }
  await expect(canvas).toHaveAttribute('data-camera-minimum-distance-ratio', '0.4500');
  const before = await cameraState(page);
  const entry = page.getByRole('button', { name: `查看建筑记忆：${title}` });
  await entry.focus();
  await entry.press('Enter');
  const panel = page.getByRole('region', { name: title, exact: true });
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
  expect(await panel.evaluate(element => element.closest('.focus-workbench-panel') !== null)).toBe(true);
  await expect(page.locator('.building-memory-layer')).toHaveCount(0);
  await expect(panel).not.toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('button', { name: '调整本次计划' })).toBeHidden();
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
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
    const workbenchBox = await page.locator('.focus-workbench-panel').boundingBox();
    expect(Math.abs((workbenchBox!.y + workbenchBox!.height) - navBox!.y)).toBeLessThanOrEqual(1.5);
  } else {
    const worldBox = await page.locator('figure.world').boundingBox();
    const workbenchBox = await page.locator('.focus-workbench-panel').boundingBox();
    // Wide layouts keep the existing workbench beside the world. Memory
    // replaces that content; it must neither overlap the canvas nor float
    // outside its host. Portrait already checks the original bottom band.
    expect(workbenchBox!.x).toBeGreaterThanOrEqual(worldBox!.x + worldBox!.width);
    expect(portraitBox!.x).toBeGreaterThanOrEqual(workbenchBox!.x);
    expect(portraitBox!.x + portraitBox!.width).toBeLessThanOrEqual(workbenchBox!.x + workbenchBox!.width);
  }
  await page.screenshot({ path: testInfo.outputPath('building-memory.png'), fullPage: true });

  if (testInfo.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 915, height: 412 });
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox?.x).toBeGreaterThanOrEqual(0);
    expect(panelBox?.y).toBeGreaterThanOrEqual(0);
    expect(panelBox ? panelBox.x + panelBox.width : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(915);
    const workbench = page.locator('.focus-workbench-panel');
    expect(await workbench.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
    const workbenchBox = await workbench.boundingBox();
    await testInfo.attach('landscape-layout', {
      body: JSON.stringify(await page.evaluate(() => Object.fromEntries(
        ['.world-screen', '.world-stage', 'figure.world', '.focus-workbench-panel', '.building-memory-panel'].map(selector => {
          const element = document.querySelector(selector)!;
          const box = element.getBoundingClientRect();
          const css = getComputedStyle(element);
          return [selector, { top: box.top, bottom: box.bottom, height: box.height, cssHeight: css.height,
            minHeight: css.minHeight, gridRows: css.gridTemplateRows, padding: css.padding,
            scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }];
        }),
      )), null, 2),
      contentType: 'application/json',
    });
    expect(workbenchBox ? workbenchBox.y + workbenchBox.height : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(412);
    await continueButton.scrollIntoViewIfNeeded();
    await expect(continueButton).toBeInViewport();
    await expect(panel.getByRole('button', { name: '关闭建筑记忆' })).toBeInViewport();
    const headerBox = await page.locator('.topbar').boundingBox();
    expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    await page.screenshot({ path: testInfo.outputPath('building-memory-landscape.png'), fullPage: true });
  }

  const focusedCamera = await cameraState(page);
  await continueButton.click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('heading', { name: '我的第一座工坊' })).toBeVisible();
  await expect.poll(() => cameraState(page)).toEqual(focusedCamera);
});

test('memory leaves the world interactive and Escape restores the existing workbench', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const panel = await selectBuilding(page, '我的第一座工坊');
  const canvas = page.getByLabel('项目建筑世界');
  const before = await cameraState(page);
  await canvas.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const dispatch = (type: string, x: number, buttons: number) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 83, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: rect.top + rect.height * .42, buttons,
    }));
    dispatch('pointerdown', rect.left + rect.width * .7, 1);
    dispatch('pointermove', rect.left + rect.width * .35, 1);
    dispatch('pointerup', rect.left + rect.width * .35, 0);
  });
  await expect.poll(async () => (await cameraState(page)).azimuth).not.toBe(before.azimuth);
  await expect(panel).toBeVisible();
  const rotated = await cameraState(page);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: '调整本次计划' })).toBeVisible();
  await expect.poll(() => cameraState(page)).toEqual(rotated);
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

test('closing building memory preserves focus until the user resets the map', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '新增任务' }).click();
  await page.getByLabel('大型任务').fill('第二项长期工作');
  await page.getByRole('button', { name: '开始建造' }).click();

  const panel = await selectBuilding(page, '我的第一座工坊');
  const focusedCamera = await cameraState(page);
  await panel.getByRole('button', { name: '关闭建筑记忆' }).click();
  await expect(panel).toBeHidden();
  await expect.poll(() => cameraState(page)).toEqual(focusedCamera);

  const resetMap = page.getByRole('button', { name: '重置地图' });
  await expect(resetMap).toBeVisible();
  await resetMap.click();
  await expect(resetMap).toBeHidden();
  await expect(page.locator('figure.world')).not.toHaveClass(/is-project-focused/);
  const settlementCamera = await cameraState(page);
  expect(settlementCamera).not.toEqual(focusedCamera);

  const canvas = page.locator('canvas[aria-label="项目建筑世界"]');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing world canvas bounds');
  const y = box.y + box.height * 0.5;
  // Dispatch the complete gesture in one browser task. Under a loaded
  // software-WebGL release run, separate Playwright mouse calls can be split
  // by a frame longer than the renderer's stale-pointer guard, so the move is
  // correctly ignored even though a physical drag would be continuous.
  await canvas.evaluate((node, gesture) => {
    const dispatch = (type: string, clientX: number, buttons: number) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 72, pointerType: 'touch', isPrimary: true,
      clientX, clientY: gesture.y, buttons,
    }));
    dispatch('pointerdown', gesture.startX, 1);
    dispatch('pointermove', gesture.endX, 1);
    dispatch('pointerup', gesture.endX, 0);
  }, { startX: box.x + box.width * 0.72, endX: box.x + box.width * 0.38, y });
  await expect.poll(async () => (await cameraState(page)).azimuth, { timeout: 15_000 }).not.toBe(settlementCamera.azimuth);
  const rotatedCamera = await cameraState(page);
  expect({ x: rotatedCamera.targetX, y: rotatedCamera.targetY, z: rotatedCamera.targetZ }).toEqual({
    x: settlementCamera.targetX,
    y: settlementCamera.targetY,
    z: settlementCamera.targetZ,
  });
});
