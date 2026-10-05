import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { deflateSync } from 'node:zlib';
import type { QualityLifecycleBrowserApi } from '../src/quality-lifecycle-performance';

type Preference = 'performance' | 'balanced' | 'cinematic';
type ProbePhase = {
  stage: string; actionIndex: number | null; requestedPreference?: string; rendererGeneration?: number; status?: string;
  atlasInstance?: number; worldIdentityFingerprint?: number; worldRebuildCount?: number;
  renderedWorldRebuildCount?: number; renderedTriangleCount?: number;
};
type ProbeSnapshot = { operations: Array<{ result: string; phases: ProbePhase[] }> };

test('keeps the resident world while quality projections reverse across day and night', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await configureQualityScene(page);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-requested-lighting-quality', 'performance');
  await expect(canvas).toHaveAttribute('data-quality-tier', 'low');
  await waitForStableWorld(canvas);
  const generation = Number(await canvas.getAttribute('data-renderer-generation'));
  const rebuilds = Number(await canvas.getAttribute('data-world-rebuild-count'));
  await setDebugScene(page, '12:00');
  await expect(canvas).toHaveAttribute('data-weather-kind', 'rain');
  await expect.poll(async () => Number(await canvas.getAttribute('data-rain-drop-count'))).toBeGreaterThan(0);
  const dayLow = await readQualityProjection(canvas);
  expect(dayLow.localLightCreatedCount).toBeGreaterThan(0);
  expect(dayLow.glowSpriteCount).toBeGreaterThan(0);
  expect(dayLow.naturalTreeCount).toBeGreaterThan(0);
  expect(dayLow.ambientDecorationCount).toBeGreaterThan(0);
  expect(dayLow.rainDropCount).toBeGreaterThan(0);
  await captureProjectionScreenshot(canvas, testInfo, 'day-performance-initial.png');

  await switchQuality(page, canvas, 'balanced', '均衡');
  const dayBalanced = await readQualityProjection(canvas);
  expect(dayBalanced.qualityTier).toBe('balanced');
  await captureProjectionScreenshot(canvas, testInfo, 'day-balanced.png');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await armOneShotQualityDatasetFailure(page);
  await page.getByRole('group', { name: '光影质量' }).getByRole('button', { name: '精致', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __qualityDatasetFaultTriggered?: boolean }).__qualityDatasetFaultTriggered)).toBe(true);
  await expect(canvas).toHaveAttribute('data-quality-tier', 'balanced');
  await expect(canvas).toHaveAttribute('data-requested-lighting-quality', 'balanced');
  await expect(page.getByRole('group', { name: '光影质量' }).getByRole('button', { name: '精致', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await switchQuality(page, canvas, 'performance', '流畅');
  await switchQuality(page, canvas, 'cinematic', '精致');
  const dayCinematic = await readQualityProjection(canvas);
  await captureProjectionScreenshot(canvas, testInfo, 'day-cinematic.png');
  expect(dayCinematic).toMatchObject({ qualityTier: 'high', bloomEnabled: true });
  expect(dayCinematic.visibleLocalLightCount).toBeGreaterThan(0);
  expect(dayCinematic.glowSpriteCount).toBeGreaterThan(0);
  expect(dayCinematic.naturalTreeCount).toBeGreaterThan(0);
  expect(dayCinematic.ambientDecorationCount).toBe(dayLow.ambientDecorationCount);
  expect(dayCinematic.rainDropCount).toBe(dayLow.rainDropCount);

  await switchQuality(page, canvas, 'balanced', '均衡');
  await switchQuality(page, canvas, 'performance', '流畅');
  await switchQuality(page, canvas, 'balanced', '均衡');
  await switchQuality(page, canvas, 'cinematic', '精致');
  const dayCinematicRestored = await readQualityProjection(canvas);
  expect(dayCinematicRestored).toEqual(dayCinematic);
  expect(Number(await canvas.getAttribute('data-renderer-generation'))).toBe(generation);
  expect(Number(await canvas.getAttribute('data-world-rebuild-count'))).toBe(rebuilds);
  expect(Number(await canvas.getAttribute('data-local-light-created-count'))).toBe(dayLow.localLightCreatedCount);
  expect(Number(await canvas.getAttribute('data-glow-sprite-count'))).toBe(dayLow.glowSpriteCount);
  expect(Number(await canvas.getAttribute('data-render-triangles'))).toBeGreaterThan(0);

  await switchQuality(page, canvas, 'performance', '流畅');
  await page.evaluate(() => sessionStorage.setItem('blockcolc-quality-night-document', '1'));
  await page.reload();
  const nightCanvas = page.getByLabel('项目建筑世界');
  await expect(nightCanvas).toHaveAttribute('data-requested-lighting-quality', 'performance');
  await waitForStableWorld(nightCanvas);
  await expect(nightCanvas).toHaveAttribute('data-day-phase', 'night');
  await setDebugScene(page, '23:00');
  await expect(nightCanvas).toHaveAttribute('data-weather-kind', 'rain');
  const nightPerformance = await readQualityProjection(nightCanvas);
  await captureProjectionScreenshot(nightCanvas, testInfo, 'night-performance.png');
  const nightGeneration = Number(await nightCanvas.getAttribute('data-renderer-generation'));
  const nightRebuilds = Number(await nightCanvas.getAttribute('data-world-rebuild-count'));
  await switchQuality(page, nightCanvas, 'balanced', '均衡');
  const nightBalanced = await readQualityProjection(nightCanvas);
  await captureProjectionScreenshot(nightCanvas, testInfo, 'night-balanced.png');
  expect(nightBalanced.qualityTier).toBe('balanced');
  await switchQuality(page, nightCanvas, 'performance', '流畅');
  await switchQuality(page, nightCanvas, 'balanced', '均衡');
  await switchQuality(page, nightCanvas, 'cinematic', '精致');
  const nightCinematic = await readQualityProjection(nightCanvas);
  await captureProjectionScreenshot(nightCanvas, testInfo, 'night-cinematic.png');
  expect(nightCinematic.qualityTier).toBe('high');
  expect(nightCinematic.visibleLocalLightCount).toBeGreaterThan(0);
  expect(nightCinematic.glowSpriteCount).toBeGreaterThan(0);
  expect(nightCinematic.visibleGlowSpriteCount).toBeGreaterThan(0);
  expect(nightCinematic.ambientDecorationCount).toBe(nightPerformance.ambientDecorationCount);
  expect(nightCinematic.rainDropCount).toBe(nightPerformance.rainDropCount);
  await switchQuality(page, nightCanvas, 'performance', '流畅');
  await switchQuality(page, nightCanvas, 'cinematic', '精致');
  expect(await readQualityProjection(nightCanvas)).toEqual(nightCinematic);
  expect(Number(await nightCanvas.getAttribute('data-renderer-generation'))).toBe(nightGeneration);
  expect(Number(await nightCanvas.getAttribute('data-world-rebuild-count'))).toBe(nightRebuilds);

  await switchQuality(page, nightCanvas, 'performance', '流畅');
});

test('preserves the hot-switched resident world across visibility and reduced motion within one bounded probe', async ({ page }) => {
  test.setTimeout(60_000);
  await configureQualityScene(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const nightCanvas = page.getByLabel('项目建筑世界');
  await waitForStableWorld(nightCanvas);
  await waitForInitialReveal(page, nightCanvas);
  await setDebugScene(page, '23:00');
  await expect(nightCanvas).toHaveAttribute('data-day-phase', 'night');
  await expect(nightCanvas).toHaveAttribute('data-weather-kind', 'rain');
  await switchQuality(page, nightCanvas, 'cinematic', '精致');
  await switchQuality(page, nightCanvas, 'performance', '流畅');
  const nightGeneration = Number(await nightCanvas.getAttribute('data-renderer-generation'));
  const nightRebuilds = Number(await nightCanvas.getAttribute('data-world-rebuild-count'));
  await beginPair(page);
  const readsBeforeResume = await qualityReadCounts(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => new Promise<void>(resolvePromise => requestAnimationFrame(() => resolvePromise())));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => new Promise<void>(resolvePromise => requestAnimationFrame(() => resolvePromise())));
  await expect(nightCanvas).toHaveAttribute('data-requested-lighting-quality', 'performance');
  const readsAfterResume = await qualityReadCounts(page);
  expect(readsAfterResume.metadata).toBeGreaterThan(readsBeforeResume.metadata);
  expect(readsAfterResume.full).toBe(readsBeforeResume.full);
  expect(Number(await nightCanvas.getAttribute('data-renderer-generation'))).toBe(nightGeneration);
  expect(Number(await nightCanvas.getAttribute('data-world-rebuild-count'))).toBe(nightRebuilds);
  await page.evaluate(() => (window as typeof window & { __blockcolcQualityLifecycle?: { endOperation(result: 'completed'): void } })
    .__blockcolcQualityLifecycle?.endOperation('completed'));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(nightCanvas).toHaveAttribute('data-continuous-rendering', 'false');
  await expect(nightCanvas).toHaveAttribute('data-ambient-motion-active', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(nightCanvas).toHaveAttribute('data-requested-lighting-quality', 'performance');
  expect(Number(await nightCanvas.getAttribute('data-renderer-generation'))).toBe(nightGeneration);
  expect(Number(await nightCanvas.getAttribute('data-world-rebuild-count'))).toBe(nightRebuilds);
});

test('reports a lost WebGL context as a failed quality request without publishing a new tier', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    (window as typeof window & { __blockcolcQualityLifecyclePageStartAt?: number }).__blockcolcQualityLifecyclePageStartAt = performance.now();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-quality-tier', /^(low|balanced|high)$/);
  await waitForInitialReveal(page, canvas);
  const previousTier = await canvas.getAttribute('data-quality-tier');
  const previousPreference = await canvas.getAttribute('data-requested-lighting-quality');
  const operation = await beginPair(page);
  const action = await page.evaluate(() => (window as typeof window & { __blockcolcQualityLifecycle?: QualityLifecycleBrowserApi })
    .__blockcolcQualityLifecycle?.beginAction('performance') ?? null);
  expect(action).toBe(0);
  await page.evaluate(async () => {
    const canvasElement = document.querySelector('canvas[aria-label="项目建筑世界"]') as HTMLCanvasElement;
    const gl = canvasElement.getContext('webgl2') ?? canvasElement.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!gl || !extension) throw new Error('WEBGL_lose_context is unavailable for the real renderer context.');
    await new Promise<void>(resolvePromise => {
      canvasElement.addEventListener('webglcontextlost', () => resolvePromise(), { once: true });
      extension.loseContext();
    });
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('group', { name: '光影质量' }).getByRole('button', { name: '流畅', exact: true }).click();
  await expect.poll(async () => {
    const phases = (await qualitySnapshot(page))?.operations[operation]?.phases ?? [];
    return phases.some(phase => phase.stage === 'quality-apply-end' && phase.actionIndex === 0 && phase.status === 'failed');
  }, { timeout: 60_000 }).toBe(true);
  const phases = (await qualitySnapshot(page))?.operations[operation]?.phases.filter(phase => phase.actionIndex === 0) ?? [];
  expect(phases.some(phase => phase.stage === 'quality-projection-complete')).toBe(false);
  expect(await canvas.getAttribute('data-quality-tier')).toBe(previousTier);
  expect(await canvas.getAttribute('data-requested-lighting-quality')).toBe(previousPreference);
  await page.evaluate(() => (window as typeof window & { __blockcolcQualityLifecycle?: QualityLifecycleBrowserApi })
    .__blockcolcQualityLifecycle?.endAction('completed'));
  await page.evaluate(() => (window as typeof window & { __blockcolcQualityLifecycle?: QualityLifecycleBrowserApi })
    .__blockcolcQualityLifecycle?.endOperation('completed'));
});

test('host refresh cancellation clears only its own loading state and explicit retry recovers strict-read failure', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const browserMessages: string[] = [];
  page.on('console', message => { if (message.type() === 'error') browserMessages.push(message.text()); });
  await page.addInitScript(() => {
    const scope = window as typeof window & {
      __qualityRefreshFault?: { holdNextRaf: boolean; heldRaf: Array<() => void>; failNextSelectedRecordRead: boolean; selectedRecordReads: number };
    };
    const fault = { holdNextRaf: false, heldRaf: [] as Array<() => void>, failNextSelectedRecordRead: false, selectedRecordReads: 0 };
    scope.__qualityRefreshFault = fault;
    const nativeRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      if (fault.holdNextRaf) {
        fault.holdNextRaf = false;
        fault.heldRaf.push(() => nativeRaf(callback));
        return 0;
      }
      return nativeRaf(callback);
    };
    const objectStore = IDBObjectStore.prototype;
    const originalGet = objectStore.get;
    objectStore.get = function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      const request = originalGet.call(this, key);
      if (this.name === 'resourcePacks') {
        fault.selectedRecordReads += 1;
        if (fault.failNextSelectedRecordRead) {
          fault.failNextSelectedRecordRead = false;
          queueMicrotask(() => { try { this.transaction.abort(); } catch { /* request already settled */ } });
        }
      }
      return request;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await waitForStableWorld(canvas);
  await expect(canvas).toHaveAttribute('data-active-resource-pack-id', '');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles({
    name: 'quality-refresh.zip', mimeType: 'application/zip', buffer: Buffer.from(makeQualityRefreshPack()),
  });
  await expect(page.locator('.resource-pack-panel .backup-notice')).toContainText('已导入并启用');

  await page.evaluate(() => {
    (window as typeof window & { __qualityRefreshFault?: { holdNextRaf: boolean } }).__qualityRefreshFault!.holdNextRaf = true;
  });
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(page.getByText('正在更新世界材质…')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByText('正在更新世界材质…')).toHaveCount(0);
  await page.locator('.resource-pack-original').getByRole('button', { name: '使用' }).click();
  const importedPack = page.locator('.resource-pack-list li').filter({ hasText: 'quality-refresh' });
  await importedPack.getByRole('button', { name: '设为基础' }).click();
  await page.evaluate(() => {
    const fault = (window as typeof window & { __qualityRefreshFault?: { heldRaf: Array<() => void> } }).__qualityRefreshFault!;
    for (const resume of fault.heldRaf.splice(0)) resume();
  });

  await page.evaluate(() => {
    (window as typeof window & { __qualityRefreshFault?: { failNextSelectedRecordRead: boolean } }).__qualityRefreshFault!.failNextSelectedRecordRead = true;
  });
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.waitForTimeout(700);
  const refreshDebug = await page.evaluate(() => {
    const fault = (window as typeof window & { __qualityRefreshFault?: { holdNextRaf: boolean; heldRaf: unknown[]; failNextSelectedRecordRead: boolean; selectedRecordReads: number } }).__qualityRefreshFault!;
    const canvas = document.querySelector('canvas[aria-label="项目建筑世界"]') as HTMLCanvasElement | null;
    return { fault: { ...fault, heldRaf: fault.heldRaf.length }, canvas: canvas ? {
      activePackId: canvas.dataset.activeResourcePackId, loading: document.body.textContent?.includes('正在更新世界材质…'),
    } : null, bodyHasError: document.body.textContent?.includes('材质包暂不可用') ?? false };
  });
  await testInfo.attach('host-refresh-debug.json', { body: Buffer.from(JSON.stringify({ ...refreshDebug, browserMessages })), contentType: 'application/json' });
  expect(refreshDebug.fault.failNextSelectedRecordRead).toBe(false);
  await expect(page.getByText('材质包暂不可用')).toBeVisible();
  const readsAtError = await page.evaluate(() => (window as typeof window & {
    __qualityRefreshFault?: { selectedRecordReads: number };
  }).__qualityRefreshFault!.selectedRecordReads);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as typeof window & {
    __qualityRefreshFault?: { selectedRecordReads: number };
  }).__qualityRefreshFault!.selectedRecordReads)).toBe(readsAtError);
  await expect(page.getByText('正在更新世界材质…')).toHaveCount(0);

  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('材质包暂不可用')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-active-resource-pack-id', /^sha256:/);
  await expect(page.getByText('正在更新世界材质…')).toHaveCount(0);
});

async function configureQualityScene(page: Page, initialNight = false): Promise<void> {
  await page.addInitScript(({ initialNight }) => {
    const useNight = initialNight || sessionStorage.getItem('blockcolc-quality-night-document') === '1';
    const epoch = new Date(useNight ? '2026-09-28T23:00:00+08:00' : '2026-09-28T12:00:00+08:00').getTime();
    const scope = window as typeof window & { __qualityBusinessEpoch?: number };
    scope.__qualityBusinessEpoch = epoch;
    const NativeDate = Date;
    globalThis.Date = new Proxy(NativeDate, {
      construct(target, args, newTarget) {
        return Reflect.construct(target, args.length === 0 ? [scope.__qualityBusinessEpoch!] : args, newTarget);
      },
      apply() { return new NativeDate(scope.__qualityBusinessEpoch!).toString(); },
      get(target, property, receiver) {
        return property === 'now' ? () => scope.__qualityBusinessEpoch! : Reflect.get(target, property, receiver);
      },
    });
    let uuid = 0;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      uuid += 1;
      return `00000000-0000-4000-8000-${uuid.toString(16).padStart(12, '0')}`;
    } });
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({
      focusMinutes: 45, breakMinutes: 5, lightingQuality: 'performance', constructionOutlineVisibility: 'current',
      showWorldCoordinates: false, focusGlassTransparency: 50, themeMode: 'light', returnToFocusReminders: true,
      autoContinueFocus: false, realWeatherEnabled: false, minimalMode: false,
    }));
    (window as typeof window & { __blockcolcQualityLifecyclePageStartAt?: number }).__blockcolcQualityLifecyclePageStartAt = performance.now();
  }, { initialNight });
}

async function waitForStableWorld(canvas: import('@playwright/test').Locator): Promise<void> {
  await expect.poll(async () => {
    const rebuilds = Number(await canvas.getAttribute('data-world-rebuild-count'));
    const rendered = Number(await canvas.getAttribute('data-rendered-world-rebuild-count'));
    const triangles = Number(await canvas.getAttribute('data-render-triangles'));
    return rebuilds > 0 && rendered === rebuilds && triangles > 20_000;
  }, { timeout: 60_000 }).toBe(true);
}

async function beginPair(page: Page): Promise<number> {
  const result = await page.evaluate(() => {
    const probe = (window as typeof window & { __blockcolcQualityLifecycle?: QualityLifecycleBrowserApi }).__blockcolcQualityLifecycle;
    return { index: probe?.beginOperation('quality-pair') ?? null, snapshot: probe?.read() ?? null };
  });
  expect(result.index, JSON.stringify(result.snapshot)).not.toBeNull();
  return result.index!;
}

async function waitForInitialReveal(page: Page, canvas: import('@playwright/test').Locator): Promise<void> {
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 20_000 });
  await expect.poll(async () => (await qualitySnapshot(page))?.operations[0]?.result, { timeout: 20_000 }).toBe('completed');
}

async function switchQuality(page: Page, canvas: import('@playwright/test').Locator, preference: Preference, label: string): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const group = page.getByRole('group', { name: '光影质量' });
  await group.getByRole('button', { name: label, exact: true }).click();
  await expect(group.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-requested-lighting-quality', preference);
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.evaluate(() => new Promise<void>(resolvePromise => requestAnimationFrame(() => resolvePromise())));
}

async function qualitySnapshot(page: Page): Promise<ProbeSnapshot | null> {
  return page.evaluate(() => (window as typeof window & {
    __blockcolcQualityLifecycle?: { read(): ProbeSnapshot };
  }).__blockcolcQualityLifecycle?.read() ?? null);
}

async function qualityReadCounts(page: Page): Promise<{ metadata: number; full: number }> {
  const snapshot = await qualitySnapshot(page);
  const phases = snapshot?.operations.flatMap(operation => operation.phases) ?? [];
  return {
    metadata: phases.filter(phase => phase.stage === 'selection-metadata-read-end').length,
    full: phases.filter(phase => phase.stage === 'selection-read-end').length,
  };
}

async function setDebugScene(page: Page, time: string): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const enabled = page.getByLabel('临时调试世界');
  if (!(await enabled.isChecked())) await enabled.check();
  await page.locator('#world-debug-weather .choice-menu-trigger').click();
  await page.getByRole('listbox', { name: '调试天气' }).getByRole('option', { name: '小雨', exact: true }).click();
  const specifiedTime = page.getByLabel('指定时间');
  if (!(await specifiedTime.isChecked())) await specifiedTime.check();
  await page.getByLabel('世界调试时间').fill(time);
  await page.getByRole('button', { name: '计时', exact: true }).click();
}

async function readQualityProjection(canvas: import('@playwright/test').Locator): Promise<Record<string, string | number | boolean>> {
  return canvas.evaluate(element => {
    const data = (element as HTMLCanvasElement).dataset;
    return {
      qualityTier: data.qualityTier ?? '',
      activeLightingQuality: data.activeLightingQuality ?? '',
      pixelRatio: data.pixelRatio ?? '',
      bloomEnabled: data.bloomEnabled === 'true',
      fullscreenPassCount: data.fullscreenPassCount ?? '',
      postProcessSampleCount: data.postProcessSampleCount ?? '',
      visibleStarCount: data.visibleStarCount ?? '',
      localLightCreatedCount: Number(data.localLightCreatedCount ?? 0),
      visibleLocalLightCount: Number(data.localLightCount ?? 0),
      glowSpriteCount: Number(data.glowSpriteCount ?? 0),
      visibleGlowSpriteCount: Number(data.visibleGlowSpriteCount ?? 0),
      naturalTreeCount: Number(data.naturalTreeCount ?? 0),
      ambientDecorationCount: Number(data.ambientDecorationCount ?? 0),
      ambientDecorationKindCount: Number(data.ambientDecorationKindCount ?? 0),
      ambientDecorationShadowCasters: Number(data.ambientDecorationShadowCasters ?? 0),
      weatherKind: data.weatherKind ?? '',
      rainDropCount: Number(data.rainDropCount ?? 0),
      continuousRendering: data.continuousRendering === 'true',
      ambientMotionActive: data.ambientMotionActive === 'true',
    };
  });
}

async function captureProjectionScreenshot(
  canvas: import('@playwright/test').Locator,
  testInfo: import('@playwright/test').TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(name);
  await canvas.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function armOneShotQualityDatasetFailure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="项目建筑世界"]') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('Resident production world canvas is unavailable.');
    const originalDataset = canvas.dataset;
    let armed = true;
    Object.defineProperty(window, '__qualityDatasetFaultTriggered', { configurable: true, value: false, writable: true });
    Object.defineProperty(canvas, 'dataset', {
      configurable: true,
      get: () => new Proxy(originalDataset, {
        set(target, property, value) {
          if (armed && property === 'qualityTier') {
            armed = false;
            (window as typeof window & { __qualityDatasetFaultTriggered?: boolean }).__qualityDatasetFaultTriggered = true;
            throw new Error('Injected post-swap quality publication failure.');
          }
          return Reflect.set(target, property, value);
        },
      }),
    });
  });
}

function makeQualityRefreshPack(): Uint8Array {
  return zipSync({
    'pack.mcmeta': strToU8(JSON.stringify({ pack: { pack_format: 34, description: 'Quality refresh regression' } })),
    'assets/minecraft/textures/block/stone.png': tinyPng(),
    'assets/minecraft/blockstates/stone.json': strToU8(JSON.stringify({ variants: { '': { model: 'minecraft:block/stone' } } })),
    'assets/minecraft/models/block/stone.json': strToU8(JSON.stringify({ parent: 'block/cube_all', textures: { all: 'block/stone' } })),
  });
}

function tinyPng(): Uint8Array {
  const width = 16, height = 16;
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width, false);
  new DataView(header.buffer).setUint32(4, height, false);
  header.set([8, 6, 0, 0, 0], 8);
  const pixels = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) pixels.set([188, 72, 46, 255], row + 1 + x * 4);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const typeBytes = strToU8(type);
    const result = new Uint8Array(12 + data.length);
    new DataView(result.buffer).setUint32(0, data.length, false);
    result.set(typeBytes, 4); result.set(data, 8);
    new DataView(result.buffer).setUint32(8 + data.length, pngCrc32(concatBytes(typeBytes, data)), false);
    return result;
  };
  return concatBytes(Uint8Array.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(pixels))), chunk('IEND', new Uint8Array()));
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((length, array) => length + array.length, 0));
  let offset = 0;
  for (const array of arrays) { result.set(array, offset); offset += array.length; }
  return result;
}
