import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type * as THREE from 'three';
import type { VoxelRenderer } from '@blockcolc/voxel';
import { observeWorldDrawBudget, readWorldDrawBudget } from './world-draw-budget';

type ShadowProbe = {
  app: VoxelRenderer;
  scene?: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  lastDepth?: { matrix: number[]; position: number[] };
  casters?: THREE.Mesh[];
};
type ProbeWindow = typeof window & {
  __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
  __shadowCacheProbe: ShadowProbe;
};
const canvasName = '阴影缓存回归世界';

async function mountWorld(page: Page, reducedMotion = true): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as ProbeWindow).__blockcolcVoxelTest);
  await observeWorldDrawBudget(page, canvasName);
  await page.evaluate(async ({ reduced, label }) => {
    const scope = window as ProbeWindow;
    const voxel = scope.__blockcolcVoxelTest;
    // Obtain the resident Three prototype rather than importing a second Three
    // instance. This works in both the dev server and optimized test-mode build;
    // all observation lives in this synthetic canvas, not the user's world.
    const temporaryPost = new voxel.LightingPostProcessor({ capabilities: { maxSamples: 0 } } as THREE.WebGLRenderer);
    const temporaryScene = (temporaryPost as unknown as { quadScene: THREE.Scene }).quadScene;
    const objectPrototype = Object.getPrototypeOf(Object.getPrototypeOf(temporaryScene)) as THREE.Object3D;
    temporaryPost.dispose();
    const beforeRender = objectPrototype.onBeforeRender;
    const beforeShadow = objectPrototype.onBeforeShadow;
    objectPrototype.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      if (renderer.domElement.getAttribute('aria-label') === label && scene.getObjectByName('worldLightRig')) {
        scope.__shadowCacheProbe.renderer = renderer;
        scope.__shadowCacheProbe.scene = scene as THREE.Scene;
      }
      beforeRender.call(this, renderer, scene, camera, geometry, material, group);
    };
    objectPrototype.onBeforeShadow = function (renderer, object, camera, shadowCamera, geometry, material, group) {
      if (renderer.domElement.getAttribute('aria-label') === label) {
        let root: THREE.Object3D = object;
        while (root.parent) root = root.parent;
        const light = root.getObjectByProperty('isDirectionalLight', true) as THREE.DirectionalLight | undefined;
        if (light) scope.__shadowCacheProbe.lastDepth = {
          matrix: light.shadow.matrix.toArray(), position: light.position.toArray(),
        };
      }
      beforeShadow.call(this, renderer, object, camera, shadowCamera, geometry, material, group);
    };
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', label);
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';
    document.body.append(canvas);
    const app = voxel.createVoxelRenderer(canvas, {
      worldSeed: 'multi-shadow-fixed', environmentStyle: 'natural-valley',
      terrainGenerationVersion: 4, lightingQuality: 'cinematic',
    });
    scope.__shadowCacheProbe = { app };
    app.setReducedMotion(reduced);
    app.setVisible(false);
    app.setAstronomyContext({ coordinates: { latitude: 31.23, longitude: 121.47 },
      locationSource: 'fresh', schedule: null });
    await app.initializeWorlds(Array.from({ length: 13 }, (_, settlementIndex) => ({
      projectId: `shadow-cache-${settlementIndex}`,
      blueprintId: ['builtin-small-workshop', 'builtin-timber-house', 'builtin-village-chapel'][settlementIndex % 3]!,
      buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000,
      isMonument: false, settlementIndex,
    })), null);
    app.setEnvironmentDebugOverride({ date: Date.parse('2026-09-30T15:00:00+08:00'),
      weather: { kind: 'clear', precipitationIntensity: 0, cloudIntensity: 0.12 } });
    app.setVisible(true);
  }, { reduced: reducedMotion, label: canvasName });
  await expect(page.getByLabel(canvasName)).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
  await expect.poll(() => page.evaluate(() => !!(window as ProbeWindow).__shadowCacheProbe.lastDepth)).toBe(true);
}

async function readProjection(page: Page) {
  return page.evaluate(() => {
    const probe = (window as ProbeWindow).__shadowCacheProbe;
    const light = probe.scene!.getObjectByProperty('isDirectionalLight', true) as THREE.DirectionalLight;
    return {
      map: [light.shadow.map!.width, light.shadow.map!.height],
      requestedMap: light.shadow.mapSize.toArray(), mapId: light.shadow.map!.texture.uuid,
      pendingRefresh: probe.renderer!.shadowMap.needsUpdate,
      currentMatrix: light.shadow.matrix.toArray(), lastDepthMatrix: probe.lastDepth!.matrix,
      position: light.position.toArray(), lastDepthPosition: probe.lastDepth!.position,
      rebuilds: probe.app.getDiagnostics().worldRebuildCount,
    };
  });
}

async function expectCurrentDepth(page: Page, size: number): Promise<void> {
  await expect.poll(async () => {
    const projection = await readProjection(page);
    return { map: projection.map, pending: projection.pendingRefresh };
  }).toEqual({ map: [size, size], pending: false });
  const projection = await readProjection(page);
  expect(projection.requestedMap).toEqual([size, size]);
  expect(projection.currentMatrix).toEqual(projection.lastDepthMatrix);
  projection.position.forEach((component, index) => expect(component).toBeCloseTo(projection.lastDepthPosition[index]!, 8));
}

async function pixelDelta(page: Page, left: Buffer, right: Buffer, buildingsOff?: Buffer) {
  return page.evaluate(async ([a, b, mask]) => {
    const pixels = async (source: string) => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const x = await pixels(a!), y = await pixels(b!), off = mask ? await pixels(mask) : undefined;
    let darkerPixels = 0, differentPixels = 0;
    for (let i = 0; i < x.length; i += 4) {
      const brightness = .2126 * (y[i]! - x[i]!) + .7152 * (y[i + 1]! - x[i + 1]!) + .0722 * (y[i + 2]! - x[i + 2]!);
      if (brightness > 5) darkerPixels++;
      // Animated tree poses are intentionally amortized by the shadow cache.
      // Compare only the building-shadow footprint, not unrelated swaying trees.
      const buildingPixel = !off || .2126 * (off[i]! - y[i]!) + .7152 * (off[i + 1]! - y[i + 1]!) + .0722 * (off[i + 2]! - y[i + 2]!) > 5;
      if (buildingPixel && Math.abs(x[i]! - y[i]!) + Math.abs(x[i + 1]! - y[i + 1]!) + Math.abs(x[i + 2]! - y[i + 2]!) > 6) differentPixels++;
    }
    return { darkerPixels, differentPixels };
  }, [left, right, buildingsOff].map(bytes => bytes ? `data:image/png;base64,${bytes.toString('base64')}` : undefined));
}

async function expectVisibleCachedShadows(page: Page, info: TestInfo, name: string): Promise<void> {
  // Hide only moving atmosphere before the natural cached frame. Do NOT request
  // a depth update here: doing that hid this bug in the older shadow probes.
  await page.evaluate(() => {
    const probe = (window as ProbeWindow).__shadowCacheProbe;
    probe.scene!.getObjectByName('atmosphere')!.visible = false;
    probe.app.resize();
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const canvas = page.getByLabel(canvasName);
  const natural = await canvas.screenshot({ path: info.outputPath(`${name}-natural.png`) });
  await page.evaluate(() => {
    const probe = (window as ProbeWindow).__shadowCacheProbe;
    probe.renderer!.shadowMap.needsUpdate = true; probe.app.resize();
  });
  const refreshed = await canvas.screenshot({ path: info.outputPath(`${name}-refreshed.png`) });
  await page.evaluate(() => {
    const probe = (window as ProbeWindow).__shadowCacheProbe;
    const casters: THREE.Mesh[] = [];
    probe.scene!.getObjectByName('buildingsAndDecorations')!.traverse(object => {
      if ((object as THREE.Mesh).isMesh && object.castShadow) casters.push(object as THREE.Mesh);
    });
    probe.casters = casters;
    casters.forEach(mesh => { mesh.castShadow = false; });
    probe.renderer!.shadowMap.needsUpdate = true; probe.app.resize();
  });
  const off = await canvas.screenshot({ path: info.outputPath(`${name}-buildings-off.png`) });
  const refreshDelta = await pixelDelta(page, natural, refreshed, off);
  expect(refreshDelta.differentPixels, 'A forced redraw must not repair an incoherent cached building projection').toBeLessThan(50);
  expect((await pixelDelta(page, natural, off)).darkerPixels, 'Buildings must visibly darken receiving surfaces').toBeGreaterThan(500);
  await page.evaluate(() => {
    const probe = (window as ProbeWindow).__shadowCacheProbe;
    probe.casters!.forEach(mesh => { mesh.castShadow = true; });
    probe.renderer!.shadowMap.needsUpdate = true; probe.app.resize();
  });
}

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const diagnostics = await page.evaluate(() => (window as Partial<ProbeWindow>).__shadowCacheProbe?.app.getDiagnostics());
    await info.attach('shadow-renderer-diagnostics', { body: JSON.stringify(diagnostics), contentType: 'application/json' });
    await info.attach('actual-world-draw-list', { body: JSON.stringify(await readWorldDrawBudget(page)), contentType: 'application/json' });
  }
  await page.evaluate(() => (window as Partial<ProbeWindow>).__shadowCacheProbe?.app.dispose());
});

test('keeps unforced building shadows across real-astronomy time jumps and visibility', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mountWorld(page);
  await expectCurrentDepth(page, 1536);
  await expectVisibleCachedShadows(page, info, 'clear-15');
  for (const [name, time] of [['morning', '09:00'], ['afternoon', '15:00']] as const) {
    await page.evaluate(time => (window as ProbeWindow).__shadowCacheProbe.app.setEnvironmentDebugOverride({
      date: Date.parse(`2026-09-30T${time}:00+08:00`),
      weather: { kind: 'clear', precipitationIntensity: 0, cloudIntensity: 0.12 },
    }), time);
    await expectCurrentDepth(page, 1536);
    await expectVisibleCachedShadows(page, info, name);
  }
  await page.evaluate(() => {
    const probe = (window as ProbeWindow).__shadowCacheProbe;
    probe.app.setVisible(false);
    probe.app.setEnvironmentDebugOverride({ date: Date.parse('2026-09-30T09:00:00+08:00'),
      weather: { kind: 'clear', precipitationIntensity: 0, cloudIntensity: 0.12 } });
    probe.app.setVisible(true);
  });
  await expectCurrentDepth(page, 1536);
  await expectVisibleCachedShadows(page, info, 'visible-again');
});

test('resizes the actual depth target through every quality tier without rebuilding the world', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mountWorld(page);
  const initial = await readProjection(page);
  for (const [quality, size] of [['performance', 512], ['balanced', 1024], ['cinematic', 1536]] as const) {
    expect(await page.evaluate(quality => (window as ProbeWindow).__shadowCacheProbe.app.setLightingQuality(quality), quality)).toBe(true);
    await expectCurrentDepth(page, size);
    expect((await readProjection(page)).rebuilds).toBe(initial.rebuilds);
    await expectVisibleCachedShadows(page, info, quality);
  }
});

test('restores the old depth target when a post-swap quality publication fails', async ({ page }, info) => {
  test.setTimeout(60_000);
  await mountWorld(page);
  const initial = await readProjection(page);
  await page.evaluate(() => {
    const canvas = (window as ProbeWindow).__shadowCacheProbe.renderer!.domElement;
    const original = canvas.dataset; let armed = true;
    Object.defineProperty(canvas, 'dataset', { configurable: true, get: () => new Proxy(original, {
      set(target, key, value) {
        if (key === 'qualityTier' && armed) { armed = false; throw new Error('Injected shadow quality publication failure'); }
        return Reflect.set(target, key, value);
      },
    }) });
  });
  expect(await page.evaluate(() => (window as ProbeWindow).__shadowCacheProbe.app.setLightingQuality('performance'))).toBe(false);
  await expectCurrentDepth(page, 1536);
  expect((await readProjection(page)).mapId).toBe(initial.mapId);
  expect((await readProjection(page)).rebuilds).toBe(initial.rebuilds);
  await expectVisibleCachedShadows(page, info, 'rollback');
});

test('commits the final animated light sample and redraws shadows after WebGL context recovery', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mountWorld(page, false);
  await page.evaluate(() => (window as ProbeWindow).__shadowCacheProbe.app.setEnvironmentDebugOverride({
    date: Date.parse('2026-09-30T09:00:00+08:00'),
    weather: { kind: 'clear', precipitationIntensity: 0, cloudIntensity: 0.12 },
  }));
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__shadowCacheProbe.app.getDiagnostics().environmentTransitionActive)).toBe(false);
  await expectCurrentDepth(page, 1536);
  await page.evaluate(() => (window as ProbeWindow).__shadowCacheProbe.app.setReducedMotion(true));
  await expectVisibleCachedShadows(page, info, 'animated-end');
  await page.evaluate(async () => {
    const canvas = (window as ProbeWindow).__shadowCacheProbe.renderer!.domElement;
    const gl = canvas.getContext('webgl2')!;
    const extension = gl.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Real context loss extension is unavailable');
    await new Promise<void>(resolve => { canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }); extension.loseContext(); });
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    await new Promise<void>(resolve => { canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }); extension.restoreContext(); });
  });
  await expectCurrentDepth(page, 1536);
  await expectVisibleCachedShadows(page, info, 'context-restored');
});

test('hands off writable depth state when environment changes recreate the renderer on a reused canvas', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mountWorld(page);
  for (const environmentStyle of ['classic-island', 'ocean-island'] as const) {
    const depthWritableAtCreation = await page.evaluate(async environmentStyle => {
      const scope = window as ProbeWindow;
      const previous = scope.__shadowCacheProbe;
      const canvas = previous.renderer!.domElement;
      const gl = previous.renderer!.getContext();
      // Reproduce the state left by a transparent final draw. The new renderer
      // shares this canvas/context, but must not inherit its read-only depth.
      gl.depthMask(false);
      previous.app.dispose();
      const app = scope.__blockcolcVoxelTest.createVoxelRenderer(canvas, {
        worldSeed: 'multi-shadow-fixed', environmentStyle, terrainGenerationVersion: 4, lightingQuality: 'balanced',
      });
      const writable = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
      scope.__shadowCacheProbe = { app };
      app.setReducedMotion(true); app.setVisible(false);
      app.setAstronomyContext({ coordinates: { latitude: 31.23, longitude: 121.47 }, locationSource: 'fresh', schedule: null });
      await app.initializeWorlds(Array.from({ length: 13 }, (_, settlementIndex) => ({
        projectId: `shadow-cache-${settlementIndex}`,
        blueprintId: ['builtin-small-workshop', 'builtin-timber-house', 'builtin-village-chapel'][settlementIndex % 3]!,
        buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex,
      })), null);
      app.setEnvironmentDebugOverride({ date: Date.parse('2026-09-30T15:00:00+08:00'),
        weather: { kind: 'clear', precipitationIntensity: 0, cloudIntensity: 0.12 } });
      app.setVisible(true);
      return writable;
    }, environmentStyle);
    await expect.poll(() => page.evaluate(() => !!(window as ProbeWindow).__shadowCacheProbe.lastDepth)).toBe(true);
    await expectCurrentDepth(page, 1024);
    await expectVisibleCachedShadows(page, info, `${environmentStyle}-recreated`);
    expect(depthWritableAtCreation).toBe(true);
  }
});
