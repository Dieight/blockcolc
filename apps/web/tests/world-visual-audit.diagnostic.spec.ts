import { expect, test, type Page } from '@playwright/test';
import type { VoxelRenderer } from '@blockcolc/voxel';
import { fixBusinessDate } from './fixed-business-date';

type ViewportRect = { x: number; y: number; width: number; height: number };

async function assertTouchTargets(page: Page, canvasId: string, coordinates: { x: number; y: number }[]) {
  // Resolve the known fixture and its hit targets in one browser task. A traced
  // accessibility-locator lookup previously waited behind software-WebGL frames
  // until cleanup, so its late result described the underlying page, not input.
  // The actual canvas identity and all touch positions remain mandatory.
  await expect.poll(() => page.evaluate(({ canvasId, coordinates }) => {
    const element = document.getElementById(canvasId);
    return coordinates.map(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return { x, y, canvasHit: element instanceof HTMLCanvasElement && target === element,
        target: target?.tagName ?? null, className: target?.getAttribute('class') ?? null };
    });
  }, { canvasId, coordinates }).then(hits => hits.every(hit => hit.canvasHit)
    ? 'canvas' : JSON.stringify(hits)), { timeout: 20_000 }).toBe('canvas');
}

async function pinchZoom(page: Page, canvasId: string,
  bounds: ViewportRect, startDistance: number, endDistance: number) {
  const centerX = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height * 0.35;
  const points = (distance: number) => [
    { id: 41, x: centerX - distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
    { id: 42, x: centerX + distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
  ];
  const start = points(startDistance);
  const end = points(endDistance);
  await assertTouchTargets(page, canvasId, [...start, ...end]);
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

async function touchDrag(page: Page, canvasId: string, bounds: ViewportRect,
  from: { x: number; y: number }, to: { x: number; y: number }) {
  const point = (id: number, progress: number) => ({
    id, x: bounds.x + bounds.width * (from.x + (to.x - from.x) * progress),
    y: bounds.y + bounds.height * (from.y + (to.y - from.y) * progress),
    radiusX: 1, radiusY: 1, force: 1,
  });
  await assertTouchTargets(page, canvasId, [point(43, 0), point(43, 1)]);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(43, 0)] });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(43, step / 10)] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}

/** Record contrast, not an unreviewed pixel threshold masquerading as acceptance. */
async function sceneLuminance(page: Page, png: Buffer) {
  return page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const surface = document.createElement('canvas');
    surface.width = image.naturalWidth;
    surface.height = image.naturalHeight;
    const context = surface.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, surface.width, surface.height);
    const values: number[] = [];
    // Exclude HUD corners and the lower information band. Identical world ROI per tier.
    for (let y = Math.floor(height * 0.2); y < height * 0.8; y += 2) {
      for (let x = Math.floor(width * 0.15); x < width * 0.85; x += 2) {
        const offset = (y * width + x) * 4;
        values.push(0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!);
      }
    }
    values.sort((a, b) => a - b);
    return { mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      p10: values[Math.floor(values.length * 0.1)], p50: values[Math.floor(values.length * 0.5)],
      p90: values[Math.floor(values.length * 0.9)], samples: values.length };
  }, `data:image/png;base64,${png.toString('base64')}`);
}

test('records fixed night and low-drizzle frames for every requested lighting tier', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await fixBusinessDate(page, new Date('2026-09-27T04:00:00Z'));
  await page.addInitScript(() => {
    // The first project also seeds terrain. Keep UUIDs deterministic in this
    // isolated diagnostic context so separate runs compare the same world.
    let counter = 0;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 20_000 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('临时调试世界', { exact: true }).check();
  await page.getByLabel('指定时间', { exact: true }).check();
  await page.getByLabel('世界调试时间', { exact: true }).fill('00:00');
  await page.getByLabel('天气', { exact: true }).selectOption('clear');
  const records: unknown[] = [];
  for (const tier of [
    { value: 'performance', label: '流畅' },
    { value: 'balanced', label: '均衡' },
    { value: 'cinematic', label: '精致' },
  ]) {
    await page.getByRole('group', { name: '光影质量', exact: true })
      .getByRole('button', { name: tier.label, exact: true }).click();
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-requested-lighting-quality', tier.value);
    await expect(canvas).toHaveAttribute('data-day-phase', 'night');
    await expect(canvas).toHaveAttribute('data-environment-transition-active', 'false');
    const clear = await canvas.screenshot({ path: testInfo.outputPath(`night-${tier.value}.png`) });
    const active = await canvas.getAttribute('data-active-lighting-quality');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('天气', { exact: true }).selectOption('rain');
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-weather-kind', 'rain');
    await expect(canvas).toHaveAttribute('data-environment-transition-active', 'false');
    const rain = await canvas.screenshot({ path: testInfo.outputPath(`night-drizzle-${tier.value}.png`) });
    records.push({ requested: tier.value, active, clear: await sceneLuminance(page, clear),
      rain: await sceneLuminance(page, rain), rainDropCount: await canvas.getAttribute('data-rain-drop-count'),
      visualIntensity: await canvas.getAttribute('data-weather-visual-precipitation-intensity'),
      fixture: 'deterministic-uuid-world', browserOnly: true, visuallyReviewed: false });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('天气', { exact: true }).selectOption('clear');
  }
  await testInfo.attach('night-drizzle-tier-observations', {
    body: Buffer.from(JSON.stringify(records, null, 2)), contentType: 'application/json',
  });
});

test('exercises rapid reveal interruption, rebuild, hidden, reduced-motion and disposal on a rendered fixture', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const shaderErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && /THREE.WebGLProgram|shader error|INVALID_OPERATION/i.test(message.text())) {
      shaderErrors.push(message.text());
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
  await page.evaluate(() => {
    const target = window as typeof window & {
      __blockcolcVoxelTest?: typeof import('@blockcolc/voxel');
      __environmentAuditRenderer?: VoxelRenderer;
    };
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '世界过渡诊断');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';
    document.body.append(canvas);
    const blueprint = { schemaVersion: 1 as const, id: 'environment-audit', title: '过渡验证',
      bounds: { minX: -2, maxX: 2, minY: 0, maxY: 2, minZ: -2, maxZ: 2 },
      voxels: Array.from({ length: 25 }, (_, index) => ({ x: index % 5 - 2, y: 0,
        z: Math.floor(index / 5) - 2, materialId: 'stone' as const, buildOrder: index,
        sourceBlockId: 'minecraft:stone_bricks' })), };
    const renderer = target.__blockcolcVoxelTest!.createVoxelRenderer(canvas, { blueprint, lightingQuality: 'balanced' });
    renderer.setWorld({ projectId: 'audit', blueprintId: blueprint.id, buildingCompletionBasisPoints: 10_000,
      buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0 });
    target.__environmentAuditRenderer = renderer;
  });
  const canvas = page.getByLabel('世界过渡诊断');
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
  const observations = await page.evaluate(async () => {
    const renderer = (window as typeof window & { __environmentAuditRenderer: VoxelRenderer }).__environmentAuditRenderer;
    const observations: Record<string, unknown>[] = [];
    const record = (step: string) => observations.push({ step, ...renderer.getDiagnostics() });
    const renderFrames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const rain = { kind: 'rain' as const, cloudIntensity: 0.32, precipitationIntensity: 0.01 };
    const snow = { kind: 'snow' as const, cloudIntensity: 0.32, precipitationIntensity: 0.01 };
    renderer.setEnvironmentDebugOverride({ weather: rain, date: Date.parse('2026-09-27T00:00:00+08:00') });
    await renderFrames();
    renderer.setEnvironmentDebugOverride({ weather: snow, date: Date.parse('2026-09-27T12:00:00+08:00') });
    await renderFrames();
    record('rapid');
    renderer.setWorld({ projectId: 'audit', blueprintId: 'environment-audit', buildingCompletionBasisPoints: 10_000,
      buildingConditionBasisPoints: 8_000, isMonument: false, settlementIndex: 0 });
    await renderFrames();
    record('rebuild');
    renderer.setVisible(false);
    record('hidden');
    renderer.setVisible(true);
    renderer.setEnvironmentDebugOverride({ weather: rain });
    await renderFrames();
    renderer.setReducedMotion(true);
    record('reduced');
    renderer.setReducedMotion(false);
    renderer.setEnvironmentDebugOverride({ weather: snow });
    await renderFrames();
    record('before-dispose');
    renderer.dispose();
    await renderFrames();
    record('disposed');
    return observations;
  });
  for (const step of ['hidden', 'reduced', 'disposed']) {
    expect(observations.find(entry => entry.step === step)?.environmentTransitionActive, step).toBe(false);
  }
  expect(Number(observations.at(-1)?.environmentTransitionCancelledCount)).toBeGreaterThan(0);
  expect(shaderErrors).toEqual([]);
  await testInfo.attach('environment-lifecycle-diagnostics', {
    body: Buffer.from(JSON.stringify({ observations, shaderErrors,
      scope: 'Production renderer API on synthetic fixture, not app navigation, heap or OEM acceptance.' }, null, 2)),
    contentType: 'application/json',
  });
});

test('records camera-local low rain and snow in main and preview worlds across real input and pause boundaries', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  // Full-screen software WebGL can defer an actual diagnostics query for more
  // than five seconds. Keep all resize/frustum/motion assertions, but allow a
  // completed query; do not force frames, stop precipitation or rebuild here.
  const weatherExpect = expect.configure({ timeout: 20_000 });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
  const observations: Record<string, unknown>[] = [];
  const canvasId = 'blockcolc-precipitation-audit';
  for (const preview of [false, true]) {
    await page.evaluate(({ previewMode, canvasId }) => {
      const target = window as typeof window & {
        __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
        __precipitationAuditRenderer?: VoxelRenderer;
      };
      const canvas = document.createElement('canvas');
      if (document.getElementById(canvasId)) throw new Error('Previous precipitation fixture was not disposed');
      canvas.id = canvasId;
      canvas.setAttribute('aria-label', '降水视野诊断');
      // Same host contract as the real main-world and blueprint-preview canvases.
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';
      document.body.append(canvas);
      const renderer = target.__blockcolcVoxelTest.createVoxelRenderer(canvas, {
        lightingQuality: 'performance', environmentStyle: 'natural-valley',
        worldSeed: 'precipitation-audit-fixed', previewMode,
      });
      renderer.setReducedMotion(false);
      renderer.setWorld({ projectId: 'precipitation-audit', blueprintId: 'builtin-small-workshop',
        buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000,
        isMonument: false, settlementIndex: 0 });
      renderer.setEnvironmentDebugOverride({ date: Date.parse('2026-09-27T12:00:00+08:00'),
        weather: { kind: 'clear', cloudIntensity: 0.12, precipitationIntensity: 0 } });
      target.__precipitationAuditRenderer = renderer;
    }, { previewMode: preview, canvasId });
    const canvas = page.locator(`#${canvasId}`);
    const mode = preview ? 'preview' : 'main-world';
    const read = () => page.evaluate(() =>
      (window as typeof window & { __precipitationAuditRenderer: VoxelRenderer })
        .__precipitationAuditRenderer.getDiagnostics() as unknown as Record<string, unknown>);
    try {
      await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
      await expect(canvas).toHaveAttribute('data-environment-transition-active', 'false');
      await canvas.screenshot({ path: testInfo.outputPath(`${mode}-clear.png`) });
      const initial = await read();
      await page.evaluate(() => (window as typeof window & { __precipitationAuditRenderer: VoxelRenderer })
        .__precipitationAuditRenderer.setEnvironmentDebugOverride({ date: Date.parse('2026-09-27T12:00:00+08:00'),
          weather: { kind: 'rain', cloudIntensity: 0.32, precipitationIntensity: 0.01 } }));
      await expect(canvas).toHaveAttribute('data-weather-kind', 'rain');
      await expect(canvas).toHaveAttribute('data-environment-transition-active', 'false');
      await weatherExpect.poll(async () => Number((await read()).rainCameraFrustumCount)).toBeGreaterThan(0);
      const rainy = await read();
      expect(rainy.precipitationFieldMode).toBe(mode);
      expect(rainy.precipitationMotionPaused).toBe(false);
      await weatherExpect.poll(async () => Number((await read()).rainElapsedMs)).toBeGreaterThan(Number(rainy.rainElapsedMs));
      for (const key of ['precipitationFieldSpanX', 'precipitationFieldSpanZ']) {
        expect(Number(rainy[key]), `${mode} ${key}`).toBeGreaterThan(0);
        expect(Number(rainy[key]), `${mode} ${key}`).toBeLessThan(1_000);
      }
      expect(rainy.worldRebuildCount).toBe(initial.worldRebuildCount);
      expect(Number(rainy.rainDropCount)).toBeLessThanOrEqual(600);
      await canvas.screenshot({ path: testInfo.outputPath(`${mode}-low-rain.png`) });
      const bounds = (await canvas.boundingBox())!;
      const cameraDistanceRatioBeforeZoom = Number(await canvas.getAttribute('data-camera-distance-ratio'));
      await pinchZoom(page, canvasId, bounds, 48, 240);
      await weatherExpect.poll(async () => Number(await canvas.getAttribute('data-camera-distance-ratio')))
        .toBeLessThan(cameraDistanceRatioBeforeZoom - 0.05);
      await weatherExpect.poll(async () => Number((await read()).precipitationFieldSyncCount))
        .toBeGreaterThan(Number(rainy.precipitationFieldSyncCount));
      const zoomed = await read();
      const cameraAzimuthBeforeDrag = Number(await canvas.getAttribute('data-camera-azimuth'));
      await touchDrag(page, canvasId, bounds, { x: 0.5, y: 0.35 }, { x: 0.72, y: 0.4 });
      await weatherExpect.poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')))
        .not.toBe(cameraAzimuthBeforeDrag);
      await weatherExpect.poll(async () => Number((await read()).precipitationFieldSyncCount))
        .toBeGreaterThan(Number(zoomed.precipitationFieldSyncCount));
      const rotated = await read();
      expect(rotated.worldRebuildCount).toBe(initial.worldRebuildCount);
      expect(rotated.rainDropCount).toBe(rainy.rainDropCount);
      await canvas.screenshot({ path: testInfo.outputPath(`${mode}-low-rain-close-rotated.png`) });

      const originalViewport = page.viewportSize()!;
      await page.setViewportSize({ width: originalViewport.height, height: originalViewport.width });
      await weatherExpect.poll(async () => Number((await read()).resizeCount))
        .toBeGreaterThan(Number(rotated.resizeCount));
      await weatherExpect.poll(async () => Number((await read()).precipitationFieldSyncCount))
        .toBeGreaterThan(Number(rotated.precipitationFieldSyncCount));
      await weatherExpect.poll(async () => Number((await read()).rainCameraFrustumCount)).toBeGreaterThan(0);
      const landscape = await read();
      expect(landscape.worldRebuildCount).toBe(initial.worldRebuildCount);
      expect(landscape.rainDropCount).toBe(rainy.rainDropCount);
      await canvas.screenshot({ path: testInfo.outputPath(`${mode}-low-rain-landscape.png`) });
      const landscapeResizeCount = Number((await read()).resizeCount);
      await page.setViewportSize(originalViewport);
      await weatherExpect.poll(async () => Number((await read()).resizeCount))
        .toBeGreaterThan(landscapeResizeCount);
      await weatherExpect.poll(() => canvas.evaluate(element => ({
        width: Math.round(element.getBoundingClientRect().width),
        height: Math.round(element.getBoundingClientRect().height),
      }))).toEqual(originalViewport);

      await page.evaluate(() => (window as typeof window & { __precipitationAuditRenderer: VoxelRenderer })
        .__precipitationAuditRenderer.setVisible(false));
      const hidden = await read();
      expect(hidden.precipitationMotionPaused).toBe(true);
      await page.waitForTimeout(350); // Deliberately exercise elapsed hidden time, not loading readiness.
      expect((await read()).rainElapsedMs).toBe(hidden.rainElapsedMs);
      await page.evaluate(() => (window as typeof window & { __precipitationAuditRenderer: VoxelRenderer })
        .__precipitationAuditRenderer.setVisible(true));
      await weatherExpect.poll(async () => Number((await read()).rainElapsedMs)).toBeGreaterThan(Number(hidden.rainElapsedMs));
      await page.evaluate(() => (window as typeof window & { __precipitationAuditRenderer: VoxelRenderer })
        .__precipitationAuditRenderer.setReducedMotion(true));
      const reduced = await read();
      expect(reduced.precipitationMotionPaused).toBe(true);
      await page.waitForTimeout(350);
      expect((await read()).rainElapsedMs).toBe(reduced.rainElapsedMs);
      await page.evaluate(() => {
        const renderer = (window as typeof window & { __precipitationAuditRenderer: VoxelRenderer }).__precipitationAuditRenderer;
        renderer.setReducedMotion(false);
        renderer.setEnvironmentDebugOverride({ date: Date.parse('2026-09-27T12:00:00+08:00'),
          weather: { kind: 'snow', cloudIntensity: 0.32, precipitationIntensity: 0.01 } });
      });
      await weatherExpect.poll(async () => Number((await read()).snowCameraFrustumCount)).toBeGreaterThan(0);
      await expect(canvas).toHaveAttribute('data-environment-transition-active', 'false');
      await canvas.screenshot({ path: testInfo.outputPath(`${mode}-low-snow.png`) });
      const snow = await read();
      expect(snow.precipitationMotionPaused).toBe(false);
      await weatherExpect.poll(async () => Number((await read()).snowElapsedMs)).toBeGreaterThan(Number(snow.snowElapsedMs));
      expect(snow.worldRebuildCount).toBe(initial.worldRebuildCount);
      expect(Number(snow.snowFlakeCount)).toBeLessThanOrEqual(800);
      observations.push({ mode, rainy, rotated, landscape, hidden, reduced, snow,
        scope: 'Synthetic debug weather, real renderer and pointer input; frustum count is not pixel/OEM acceptance.' });
    } finally {
      await page.evaluate(canvasId => {
        const target = window as typeof window & { __precipitationAuditRenderer?: VoxelRenderer };
        target.__precipitationAuditRenderer?.dispose();
        delete target.__precipitationAuditRenderer;
        document.getElementById(canvasId)?.remove();
      }, canvasId);
    }
  }
  await testInfo.attach('precipitation-field-observations', {
    body: Buffer.from(JSON.stringify(observations, null, 2)), contentType: 'application/json',
  });
});
