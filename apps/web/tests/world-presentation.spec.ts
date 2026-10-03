import { expect, test, type Locator, type Page } from '@playwright/test';
import { readPersistedDomainState } from './persisted-domain-state';

async function pinchZoom(page: Page, canvas: Locator, startDistance: number, endDistance: number) {
  const bounds = (await canvas.boundingBox())!;
  const centerX = bounds.x + bounds.width / 2;
  // The upper-right 112x88 HUD reveal zone intentionally owns pointer input.
  // Keep both fingers below it, while retaining the actual hit-target check.
  const y = bounds.y + bounds.height * 0.65;
  const points = (distance: number) => [
    { id: 31, x: centerX - distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
    { id: 32, x: centerX + distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
  ];
  const start = points(startDistance);
  const end = points(endDistance);
  await expect.poll(() => canvas.evaluate((element, coordinates) => coordinates.every(({ x, y }) =>
    document.elementFromPoint(x, y) === element), [...start, ...end])).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: start });
    for (let step = 1; step <= 8; step += 1) {
      const distance = startDistance + (endDistance - startDistance) * step / 8;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}

async function createProject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
  return canvas;
}

test('temporary weather and time overrides restore normal sources without changing domain facts', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.clock.install({ time: new Date('2026-09-27T04:00:00Z') });
  const canvas = await createProject(page);
  const initial = await readPersistedDomainState(page);
  const rebuilds = await canvas.getAttribute('data-world-rebuild-count');
  const originalWeather = await canvas.getAttribute('data-weather-kind');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('临时调试世界', { exact: true }).check();
  await page.getByLabel('天气', { exact: true }).selectOption('rain');
  await page.getByLabel('指定时间', { exact: true }).check();
  await page.getByLabel('世界调试时间', { exact: true }).fill('00:00');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-weather-kind', 'rain');
  await expect.poll(async () => Number(await canvas.getAttribute('data-rain-drop-count'))).toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute('data-day-phase', 'night');
  await expect(canvas).toHaveAttribute('data-world-rebuild-count', rebuilds!);
  const during = await readPersistedDomainState(page);
  expect(during).toEqual(initial);
  await canvas.screenshot({ path: testInfo.outputPath('debug-night-drizzle.png') });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('临时调试世界', { exact: true }).uncheck();
  await expect(page.getByLabel('世界调试时间')).toHaveCount(0);
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-weather-kind', originalWeather!);
  await expect(canvas).toHaveAttribute('data-day-phase', 'day');
  await expect(canvas).toHaveAttribute('data-world-rebuild-count', rebuilds!);
  expect(await readPersistedDomainState(page)).toEqual(initial);
  await page.reload();
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-weather-kind', originalWeather!);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('临时调试世界', { exact: true })).not.toBeChecked();
});

test('weather and astronomy share one visible sky while storm reaches the glass panel', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date('2026-09-27T04:00:00Z') });
  const canvas = await createProject(page);
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 25_000 });
  await pinchZoom(page, canvas, 150, 40);
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance-ratio'))).toBeGreaterThan(1.04);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('临时调试世界', { exact: true }).check();
  await page.getByLabel('指定时间', { exact: true }).check();
  await page.getByLabel('世界调试时间', { exact: true }).fill('13:00');
  await page.getByLabel('天气', { exact: true }).selectOption('clear');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-day-phase', 'day');
  const clearClouds = Number(await canvas.getAttribute('data-cloud-block-count'));
  await canvas.screenshot({ path: testInfo.outputPath('weather-clear-day.png') });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('天气', { exact: true }).selectOption('cloudy');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-weather-kind', 'cloudy');
  const cloudyClouds = Number(await canvas.getAttribute('data-cloud-block-count'));
  expect(cloudyClouds).toBeGreaterThan(clearClouds);
  await canvas.screenshot({ path: testInfo.outputPath('weather-cloudy-day.png') });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('天气', { exact: true }).selectOption('mist');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-weather-kind', 'mist');
  const mistClouds = Number(await canvas.getAttribute('data-cloud-block-count'));
  expect(mistClouds).toBeLessThan(cloudyClouds);
  await canvas.screenshot({ path: testInfo.outputPath('weather-mist-day.png') });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('天气', { exact: true }).selectOption('storm');
  await page.getByRole('checkbox', { name: '开启极简模式' }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-weather-kind', 'rain');
  const overlay = page.locator('.minimal-panel-weather-overlay');
  await expect(overlay).toHaveAttribute('data-thunderstorm', 'true');
  await expect.poll(async () => Number(await overlay.getAttribute('data-lightning-strike-count')), { timeout: 12_000 }).toBeGreaterThan(0);
  expect(Number(await overlay.getAttribute('data-lightning-target-x'))).toBeGreaterThan(0.15);
  expect(Number(await overlay.getAttribute('data-lightning-target-y'))).toBeGreaterThan(0.37);
  await page.locator('.focus-panel').screenshot({ path: testInfo.outputPath('weather-storm-glass.png') });
  await expect.poll(async () => Number(await canvas.getAttribute('data-lightning-strike-count')), { timeout: 12_000 }).toBeGreaterThan(0);
  await canvas.screenshot({ path: testInfo.outputPath('weather-storm-day.png') });
});

test('snow settles on the minimal glass without covering the clock', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const canvas = await createProject(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('临时调试世界', { exact: true }).check();
  await page.getByLabel('天气', { exact: true }).selectOption('snow');
  await page.getByRole('checkbox', { name: '开启极简模式' }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-weather-kind', 'snow');
  const overlay = page.locator('.minimal-panel-weather-overlay');
  await expect(overlay).toHaveAttribute('data-weather-kind', 'snow');
  await expect(overlay).toHaveAttribute('data-weather-style', 'pixel-layered');
  await expect(overlay).toHaveAttribute('data-snow-tier', 'low');
  await expect.poll(async () => Number(await canvas.getAttribute('data-snow-flake-count'))).toBeGreaterThan(0);
  await page.locator('.focus-panel').screenshot({ path: testInfo.outputPath('weather-snow-glass.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(overlay).toBeVisible();
  await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
  // Measure the actual static snow pixels, not just the diagnostic tier.
  await expect.poll(() => overlay.locator('canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0;
    for (let x = 8; x < canvas.width - 8; x += 8) {
      let depth = 0;
      for (let y = canvas.height - 1; y >= Math.max(0, canvas.height - 30); y -= 1) {
        if (data[(y * canvas.width + x) * 4 + 3]! < 170) break;
        depth += 1;
      }
      total += depth;
    }
    return total / Math.ceil((canvas.width - 16) / 8);
  })).toBeGreaterThan(4);
  await expect(overlay.locator('canvas')).toHaveCSS('image-rendering', 'pixelated');
  await page.locator('.focus-panel').screenshot({ path: testInfo.outputPath('pixel-snow-static-glass.png') });
});

test('opening camera movement never opens memory and is not replayed by route changes', async ({ page }) => {
  test.setTimeout(60_000);
  const canvas = await createProject(page);
  await expect(canvas).toHaveAttribute('data-initial-reveal-started-count', '1');
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1');
  await expect(page.getByRole('button', { name: '关闭建筑记忆' })).toHaveCount(0);
  const generation = await canvas.getAttribute('data-renderer-generation');
  const rebuilds = await canvas.getAttribute('data-world-rebuild-count');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-initial-reveal-started-count', '1');
  await expect(canvas).toHaveAttribute('data-renderer-generation', generation!);
  await expect(canvas).toHaveAttribute('data-world-rebuild-count', rebuilds!);
});

for (const [environment, label, expectedMaximum] of [
  ['ocean-island', '海洋小岛', 1.14],
  ['natural-valley', '自然山谷', 0.9],
] as const) test(`minimal cold opening travels from the maximum to minimum settlement zoom (${environment})`, async ({ page }) => {
  test.setTimeout(90_000);
  await createProject(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const environmentChoice = page.getByRole('group', { name: '聚落环境' }).getByRole('button', { name: label, exact: true });
  if (environment === 'ocean-island') await expect(environmentChoice).toHaveAttribute('aria-pressed', 'true');
  else await environmentChoice.click();
  await expect(environmentChoice).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('checkbox', { name: '开启极简模式' }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
  await page.reload();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-initial-reveal-started-count', '1', { timeout: 45_000 });
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 15_000 });
  await expect(canvas).toHaveAttribute('data-environment-style', environment);
  await expect(canvas).toHaveAttribute('data-opening-reveal-project-target', 'settlement');
  const [start, end, minimum, maximum, current] = await Promise.all([
    canvas.getAttribute('data-opening-reveal-from-distance'), canvas.getAttribute('data-opening-reveal-to-distance'),
    canvas.getAttribute('data-camera-minimum-distance-ratio'), canvas.getAttribute('data-camera-maximum-distance-ratio'),
    canvas.getAttribute('data-camera-distance-ratio'),
  ]);
  expect(Number(minimum)).toBe(0.45);
  expect(Number(maximum)).toBe(expectedMaximum);
  expect(Number(start) / Number(end)).toBeCloseTo(expectedMaximum / 0.45, 2);
  expect(Number(current)).toBeCloseTo(Number(minimum), 2);
  expect(Number(start) / Number(end)).toBeCloseTo(Number(maximum) / Number(minimum), 2);
  expect(await page.getByRole('button', { name: '关闭建筑记忆' }).count()).toBe(0);
});

test('reduced motion skips decorative opening animation without blocking the usable world', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const canvas = await createProject(page);
  await expect(page.getByRole('button', { name: '开始 1 轮' })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-initial-reveal-started-count', '0');
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1');
  await expect(canvas).toHaveAttribute('data-opening-reveal-state', 'completed');
  await expect(canvas).toHaveAttribute('data-camera-minimum-distance-ratio', '0.9000');
  await expect(page.getByRole('button', { name: '重置地图', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭建筑记忆' })).toHaveCount(0);
});

test('round detents release when a live drag reverses before returning to its starting point', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install({ time: new Date('2026-09-27T04:00:00Z') });
  await createProject(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '开启极简模式' }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  const clock = page.locator('.minimal-clock-gesture');
  await expect(clock).toBeVisible();
  const box = (await clock.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const minutes = async () => {
    const label = (await clock.getAttribute('aria-label'))!;
    const match = /专注到今天 (\d{2}):(\d{2})/.exec(label);
    expect(match, label).not.toBeNull();
    return Number(match![1]) * 60 + Number(match![2]);
  };
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 120, { steps: 12 });
  const forward = await minutes();
  await page.mouse.move(x, y - 108);
  const reverse = await minutes();
  expect(reverse).toBeLessThan(forward);
  await page.mouse.move(x, y - 96);
  expect(await minutes()).toBeLessThan(reverse);
  await page.mouse.up();
  await clock.press('Escape');
  await expect(clock).toHaveAttribute('aria-label', /当前时间/);
  expect((await readPersistedDomainState(page)).state.activeFocusSession).toBeNull();
});

test('an exact five-minute selection starts a full round despite a sub-minute clock shortfall', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install({ time: new Date('2026-09-27T04:00:40Z') });
  await createProject(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('普通任务专注分钟', { exact: true }).fill('25');
  await page.getByLabel('普通任务专注分钟', { exact: true }).blur();
  await page.getByRole('checkbox', { name: '开启极简模式' }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  const clock = page.locator('.minimal-clock-gesture');
  await expect(clock).toBeVisible();
  for (let index = 0; index < 5; index += 1) await clock.press('ArrowUp');
  await expect(clock).toHaveAttribute('aria-label', /专注到今天 12:25/);
  await clock.press('Enter');
  await expect(page.locator('.focus-task-context')).toContainText('专注中 第1/1轮');
  const state = (await readPersistedDomainState(page)).state;
  expect(state.activeFocusSession).toMatchObject({ plannedDurationMs: 25 * 60_000,
    subtaskId: null, marathon: true, deferredSettlement: true });
  const topUpMs = Date.parse(state.activeFocusSession!.endsAt) - Date.parse('2026-09-27T04:25:00Z');
  expect(topUpMs).toBeGreaterThan(0);
  expect(topUpMs).toBeLessThanOrEqual(60_000);
});

test('temporary corruption rebuilds only presentation and disabling restores the saved world', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const canvas = await createProject(page);
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1');
  const saved = await readPersistedDomainState(page);
  const generation = await canvas.getAttribute('data-renderer-generation');
  const before = Number(await canvas.getAttribute('data-world-rebuild-count'));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('临时调试世界', { exact: true }).check();
  await page.getByLabel('指定程度', { exact: true }).check();
  await page.getByLabel('世界调试腐败程度', { exact: true }).press('End');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-world-rebuild-count'))).toBeGreaterThan(before);
  await expect(page.getByText('正在更新世界画面…', { exact: true })).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-environment-transition-active', 'false');
  await expect(canvas).toHaveAttribute('data-renderer-generation', generation!);
  expect(await readPersistedDomainState(page)).toEqual(saved);
  await canvas.screenshot({ path: testInfo.outputPath('temporary-corruption.png') });

  const corruptedRebuilds = Number(await canvas.getAttribute('data-world-rebuild-count'));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('临时调试世界', { exact: true }).uncheck();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-world-rebuild-count'))).toBeGreaterThan(corruptedRebuilds);
  await expect(canvas).toHaveAttribute('data-environment-transition-active', 'false');
  await expect(canvas).toHaveAttribute('data-renderer-generation', generation!);
  expect(await readPersistedDomainState(page)).toEqual(saved);
  await canvas.screenshot({ path: testInfo.outputPath('normal-corruption-restored.png') });
});

test('glass drizzle does not intercept either direction of an actual touch swipe', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await createProject(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('临时调试世界', { exact: true }).check();
  await page.getByLabel('天气', { exact: true }).selectOption('rain');
  await page.getByRole('checkbox', { name: '开启极简模式' }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  const panel = page.locator('.minimal-idle-carousel');
  const glass = page.locator('.focus-panel');
  const overlay = glass.locator('.minimal-panel-weather-overlay');
  await expect(panel).toHaveAttribute('data-page', 'clock');
  await expect(overlay).toHaveAttribute('data-weather-kind', 'rain');
  await expect(overlay).toHaveCSS('pointer-events', 'none');
  const bounds = (await panel.boundingBox())!;
  const saved = await readPersistedDomainState(page);
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (fromX: number, toX: number) => {
    const y = bounds.y + bounds.height * 0.5;
    const point = (x: number) => ({ id: 91, x, y, radiusX: 1, radiusY: 1, force: 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(fromX)] });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [point(fromX + (toX - fromX) * step / 8)] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  try {
    await swipe(bounds.x + bounds.width * 0.75, bounds.x + bounds.width * 0.25);
    await expect(panel).toHaveAttribute('data-page', 'today');
    await expect(page.getByRole('region', { name: '今日专注时间轴', exact: true })).toBeVisible();
    await swipe(bounds.x + bounds.width * 0.3, bounds.x + bounds.width + 8);
    await expect(panel).toHaveAttribute('data-page', 'clock');
    expect((await panel.boundingBox())!.height).toBe(bounds.height);
    expect(await readPersistedDomainState(page)).toEqual(saved);
    await glass.screenshot({ path: testInfo.outputPath('glass-drizzle-clock.png') });
  } finally { await cdp.detach(); }
});

test('per-object scenery LOD follows projected size in legal zoom without rebuilding', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const canvas = await createProject(page);
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 20_000 });
  await expect.poll(async () => Number(await canvas.getAttribute('data-natural-decoration-count'))).toBeGreaterThan(0);
  const count = await canvas.getAttribute('data-natural-decoration-count');
  const generation = await canvas.getAttribute('data-renderer-generation');
  const rebuilds = await canvas.getAttribute('data-world-rebuild-count');
  const saved = await readPersistedDomainState(page);
  const nearRatio = Number(await canvas.getAttribute('data-camera-distance-ratio'));
  const maximumRatio = Number(await canvas.getAttribute('data-camera-maximum-distance-ratio'));
  // This spec runs in mobile Chromium. Verify touch hit-testing and exercise
  // the supported pinch rather than synthesize a desktop-only wheel input.
  await pinchZoom(page, canvas, 240, 36);
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance-ratio')))
    .toBeGreaterThan(nearRatio + 0.05);
  const farRatio = Number(await canvas.getAttribute('data-camera-distance-ratio'));
  expect(farRatio).toBeGreaterThanOrEqual(maximumRatio * 0.94 - 0.001);
  expect(farRatio).toBeLessThanOrEqual(maximumRatio + 0.001);
  const farLods = JSON.parse((await canvas.getAttribute('data-scenery-lods'))!) as { id: string; lod: string; projectedWidth: number }[];
  expect(farLods.length).toBeGreaterThan(0);
  for (const object of farLods) if (object.projectedWidth < 30) expect(object.lod).toBe('distant');
  await canvas.screenshot({ path: testInfo.outputPath('natural-decorations-far.png') });
  await pinchZoom(page, canvas, 36, 240);
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance-ratio')))
    .toBeLessThan(farRatio - 0.05);
  const nearLods = JSON.parse((await canvas.getAttribute('data-scenery-lods'))!) as { id: string; lod: string; projectedWidth: number }[];
  expect(nearLods.map(o => o.id)).toEqual(farLods.map(o => o.id));
  for (const object of nearLods) if (object.projectedWidth > 42) expect(object.lod).toBe('full');
  expect(nearLods.some(o => o.projectedWidth > farLods.find(f => f.id === o.id)!.projectedWidth)).toBe(true);
  expect(Number(await canvas.getAttribute('data-camera-distance-ratio'))).toBeLessThan(farRatio);
  await canvas.screenshot({ path: testInfo.outputPath('natural-decorations-near.png') });
  await expect(canvas).toHaveAttribute('data-natural-decoration-count', count!);
  await expect(canvas).toHaveAttribute('data-renderer-generation', generation!);
  await expect(canvas).toHaveAttribute('data-world-rebuild-count', rebuilds!);
  expect(await readPersistedDomainState(page)).toEqual(saved);
});
