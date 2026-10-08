import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseDebugWeather } from './world-debug-controls';
import { syntheticFlowerPack } from './synthetic-flower-pack';
import { readPersistedDomainState } from './persisted-domain-state';
import { fixBusinessDate } from './fixed-business-date';

async function pinch(page: Page, canvas: Locator, inward: boolean) {
  await canvas.scrollIntoViewIfNeeded();
  const bounds = (await canvas.boundingBox())!;
  const center = bounds.x + bounds.width / 2;
  // Ordinary mobile worlds are only 240px tall: the top-right 88px HUD tap
  // zone covers the outer finger at 35%. Use the clear middle strip instead.
  const y = bounds.y + bounds.height * 0.60;
  const points = (distance: number) => [
    { id: 61, x: center - distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
    { id: 62, x: center + distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
  ];
  const start = inward ? 40 : 250;
  const end = inward ? 250 : 20;
  // A renderer's first frame can precede the host commit that removes its loading
  // overlay. Wait for actual hit targets, without bypassing the overlay or input.
  await expect.poll(() => canvas.evaluate((element, coordinates) => coordinates.every(({ x, y }) =>
    document.elementFromPoint(x, y) === element), [...points(start), ...points(end)])).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(start) });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(start + (end - start) * step / 10) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}

async function routeSnapshot(canvas: Locator) {
  return canvas.evaluate(element => {
    const d = (element as HTMLCanvasElement).dataset;
    return { pack: Number(d.naturalFlowerPackPlacementCount), fallback: Number(d.naturalFlowerOriginalFallbackCount),
      visibleFlowerBatches: Number(d.naturalFlowerVisibleBatchCount), treeMushrooms: Number(d.treeSideMushroomCount),
      lods: JSON.parse(d.sceneryLods ?? '[]') as { id: string; lod: string; projectedWidth: number }[], rebuilds: Number(d.worldRebuildCount),
      requested: d.requestedLightingQuality, active: d.activeLightingQuality };
  });
}

async function expectProjectedLods(canvas: Locator) {
  await expect.poll(async () => {
    const { lods } = await routeSnapshot(canvas);
    return lods.length > 0 && lods.every(o => o.projectedWidth < 30 ? o.lod === 'distant'
      : o.projectedWidth > 42 ? o.lod === 'full' : true);
  }).toBe(true);
}

for (const environment of [
  { value: 'natural-valley', label: '山谷' },
  { value: 'ocean-island', label: '海岛' },
]) {
  test(`natural flowers in ${environment.value} adopt a pack, fall back atomically, and retain identity through real LOD gestures`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const shaderErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error' && /THREE.WebGLProgram|shader error|INVALID_OPERATION/i.test(message.text())) shaderErrors.push(message.text());
    });
    // Keep the intended business day deterministic without replacing RAF or
    // performance.now(), which the WebGL renderer and shader readiness use.
    await fixBusinessDate(page, new Date('2026-09-27T12:00:00+08:00'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      let counter = 0;
      Object.defineProperty(crypto, 'randomUUID', { configurable: true,
        value: () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}` });
    });
    await page.goto('/');
    await page.getByRole('button', { name: '开始建造', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('group', { name: '聚落环境', exact: true }).getByRole('button', { name: environment.label, exact: true }).click();
    await page.getByLabel('临时调试世界', { exact: true }).check();
    await page.getByLabel('指定时间', { exact: true }).check();
    await page.getByLabel('世界调试时间', { exact: true }).fill('12:00');
    await chooseDebugWeather(page, 'clear');
    await page.getByRole('button', { name: '计时', exact: true }).click();
    const canvas = page.getByLabel('项目建筑世界');
    await expect(canvas).toHaveAttribute('data-environment-style', environment.value);
    await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 20_000 });
    await pinch(page, canvas, true);
    await expectProjectedLods(canvas);
    await expect.poll(async () => (await routeSnapshot(canvas)).fallback).toBeGreaterThan(0);
    const initial = await routeSnapshot(canvas);
    const before = await readPersistedDomainState(page);
    await canvas.screenshot({ path: testInfo.outputPath('original-natural-full.png') });

    const observations: unknown[] = [{ stage: 'original', ...initial }];
    for (const partial of [false, true]) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles({
        name: partial ? 'synthetic-partial-flower.zip' : 'synthetic-full-flower.zip',
        mimeType: 'application/zip', buffer: syntheticFlowerPack(partial),
      });
      await expect(page.locator('.resource-pack-panel .backup-notice')).toContainText('已导入并启用');
      await page.getByRole('button', { name: '计时', exact: true }).click();
      await expect(canvas).toHaveAttribute('data-active-resource-pack-id', /^sha256:/);
      await expect.poll(async () => (await routeSnapshot(canvas)).pack, { timeout: 20_000 }).toBeGreaterThan(0);
      await pinch(page, canvas, true);
      await expectProjectedLods(canvas);
      const full = await routeSnapshot(canvas);
      expect(full.pack + full.fallback).toBe(initial.fallback);
      if (partial) expect(full.fallback).toBeGreaterThan(0);
      else expect(full.fallback).toBe(0);
      await canvas.screenshot({ path: testInfo.outputPath(partial ? 'partial-flower-full.png' : 'pack-flower-full.png') });
      observations.push({ stage: partial ? 'partial-full' : 'pack-full', ...full });
      const rebuilds = full.rebuilds;
      await pinch(page, canvas, false);
      await expectProjectedLods(canvas);
      const far = await routeSnapshot(canvas);
      // Mixed gardens retain actual low flower models, not one world-wide color blob.
      expect(far.visibleFlowerBatches).toBeGreaterThan(0);
      expect(far.lods.map(o => o.id)).toEqual(full.lods.map(o => o.id));
      expect(far.lods.some(o => o.projectedWidth < full.lods.find(n => n.id === o.id)!.projectedWidth)).toBe(true);
      expect(far.rebuilds).toBe(rebuilds);
      expect(far.pack).toBe(full.pack);
      expect(far.fallback).toBe(full.fallback);
      await canvas.screenshot({ path: testInfo.outputPath(partial ? 'partial-flower-far.png' : 'pack-flower-far.png') });
      observations.push({ stage: partial ? 'partial-far' : 'pack-far', ...far });
      await pinch(page, canvas, true);
      await expectProjectedLods(canvas);
      expect((await routeSnapshot(canvas)).rebuilds).toBe(rebuilds);
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('.resource-pack-original').getByRole('button', { name: '使用', exact: true }).click();
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect.poll(async () => (await routeSnapshot(canvas)).pack).toBe(0);
    await expect.poll(async () => (await routeSnapshot(canvas)).fallback).toBe(initial.fallback);
    await pinch(page, canvas, true);
    await canvas.screenshot({ path: testInfo.outputPath('restored-natural-full.png') });
    const after = await readPersistedDomainState(page);
    expect(after.state.projects).toEqual(before.state.projects);
    expect(after.state.worldSettings).toEqual(before.state.worldSettings);
    expect(shaderErrors).toEqual([]);
    observations.push({ stage: 'restored', ...await routeSnapshot(canvas) });
    await testInfo.attach('natural-flower-route-observations', { body: Buffer.from(JSON.stringify({ observations,
      environment: environment.value, shaderErrors, visuallyReviewed: false,
      scope: 'Synthetic cutout pack, real main-world UI import and touch LOD. Routing counts are not visual equivalence or GPU performance.' }, null, 2)), contentType: 'application/json' });
  });
}
