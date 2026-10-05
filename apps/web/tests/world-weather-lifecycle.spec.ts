import { expect, test, type Page } from '@playwright/test';

/** Synthetic native bridge: verifies the mounted hook and renderer seam, not Android HTTP. */
async function installWeatherBridge(page: Page, deferFirstAstronomy: boolean) {
  await page.addInitScript(({ deferFirst }) => {
    const calls: string[] = [];
    let astronomyCalls = 0;
    let resolveFirst: ((value: unknown) => void) | null = null;
    const calendar = () => {
      const now = Date.now();
      const start = Math.floor(now / 86_400_000) * 86_400_000;
      return { status: 'ok', coordinate: { latitude: 0, longitude: 0 }, locationSource: 'fresh',
        fetchedAtMs: now, attributions: ['Synthetic calendar fixture'],
        days: Array.from({ length: 7 }, (_, index) => ({
          intervalStartMs: start + index * 86_400_000,
          intervalEndMs: start + (index + 1) * 86_400_000,
          solar: { astronomicalDawnMs: null, nauticalDawnMs: null, civilDawnMs: null,
            sunriseMs: null, solarNoonMs: null, sunsetMs: null, civilDuskMs: null,
            nauticalDuskMs: null, astronomicalDuskMs: null, solarMidnightMs: null },
          lunar: { moonriseMs: null, moonsetMs: null, moonTransitMs: null,
            moonUnderfootMs: null, phase: 'first-quarter' },
        })) };
    };
    const methods = ['getCurrentWeather', 'getAstronomy', 'cancelAstronomy', 'clearLocationCache'];
    const nativePromise = async (_plugin: string, method: string) => {
      calls.push(method);
      if (method === 'getCurrentWeather') return { status: 'error', reason: 'network_unavailable' };
      if (method === 'getAstronomy') {
        astronomyCalls += 1;
        if (deferFirst && astronomyCalls === 1) return new Promise(resolve => { resolveFirst = resolve; });
        return calendar();
      }
      return { status: 'ok' };
    };
    const target = window as unknown as {
      CapacitorCustomPlatform: { name: string };
      Capacitor: unknown;
      weatherHarness: { calls: string[]; resolveFirst(): void };
    };
    target.CapacitorCustomPlatform = { name: 'android' };
    target.Capacitor = { PluginHeaders: [{ name: 'QWeatherNative',
      methods: methods.map(name => ({ name, rtype: 'promise' })) }], nativePromise };
    target.weatherHarness = { calls, resolveFirst: () => { resolveFirst?.(calendar()); resolveFirst = null; } };
  }, { deferFirst: deferFirstAstronomy });
}

test('ordinary opening ends in real building focus and keeps its target/limits through orbit, zoom and map reset',async({page},info)=>{
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button',{name:'开始建造',exact:true}).click();
  const canvas=page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count','1',{timeout:20_000});
  const map=page.getByRole('button',{name:'重置地图',exact:true});
  await expect(map).toBeVisible();
  await expect(page.getByRole('region',{name:'我的第一座工坊',exact:true})).toHaveCount(0);
  const framing=()=>canvas.evaluate(node=>({distance:Number(node.dataset.cameraDistance),target:[node.dataset.cameraTargetX,node.dataset.cameraTargetY,node.dataset.cameraTargetZ],
    minimum:Number(node.dataset.cameraMinimumDistanceRatio),maximum:Number(node.dataset.cameraMaximumDistanceRatio)}));
  const opened=await framing();
  expect(opened.minimum).toBe(.9);expect(opened.maximum).toBe(1.35);
  await canvas.dispatchEvent('wheel',{deltaY:20});
  const zoomed=await framing();
  expect(zoomed.target).toEqual(opened.target);
  expect(zoomed.distance/opened.distance).toBeCloseTo(Math.exp(20*.0012),2);
  await canvas.evaluate(node=>{
    node.dispatchEvent(new PointerEvent('pointerdown',{pointerId:5,clientX:100,clientY:100,bubbles:true}));
    node.dispatchEvent(new PointerEvent('pointermove',{pointerId:5,clientX:120,clientY:100,bubbles:true}));
    node.dispatchEvent(new PointerEvent('pointerup',{pointerId:5,clientX:120,clientY:100,bubbles:true}));
  });
  expect((await framing()).target).toEqual(opened.target);
  await map.click();
  await expect(map).toBeHidden();
  expect((await framing()).minimum).toBe(.45);
  const building=page.getByRole('button',{name:'查看建筑记忆：我的第一座工坊',exact:true});
  await building.focus();await building.press('Enter');
  const memory=page.getByRole('region',{name:'我的第一座工坊',exact:true});
  await expect(memory).toBeVisible();
  await memory.getByRole('button',{name:'关闭建筑记忆',exact:true}).click();
  await expect(memory).toBeHidden();
  expect(await framing()).toEqual(opened);
  await info.attach('opening-focus',{body:JSON.stringify({opened,zoomed,afterMemory:await framing()}),contentType:'application/json'});
});

async function bridgeCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { weatherHarness: { calls: string[] } }).weatherHarness.calls);
}

async function openWorld(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  const canvas = page.getByLabel('项目建筑世界');
  // This is a lifecycle precondition, not a five-second startup benchmark.
  // Resource preparation, the first frame and the reveal have separate stages.
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 20_000 });
  return canvas;
}

test('weather failure does not overwrite an independently successful astronomy context', async ({ page }) => {
  test.setTimeout(90_000);
  await installWeatherBridge(page, false);
  const canvas = await openWorld(page);
  const rebuilds = await canvas.getAttribute('data-world-rebuild-count');
  const generation = await canvas.getAttribute('data-renderer-generation');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('同步现实天气', { exact: true }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect.poll(async () => (await bridgeCalls(page)).includes('getCurrentWeather')).toBe(true);
  await expect.poll(async () => (await bridgeCalls(page)).includes('getAstronomy')).toBe(true);
  await expect(canvas).toHaveAttribute('data-astronomy-source', 'provider+ephemeris');
  await expect(canvas).toHaveAttribute('data-world-rebuild-count', rebuilds!);
  await expect(canvas).toHaveAttribute('data-renderer-generation', generation!);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('.weather-setting-status')).toContainText('网络不可用');
  await expect(page.locator('.weather-setting-status')).toContainText('Synthetic calendar fixture');
  await page.getByLabel('同步现实天气', { exact: true }).uncheck();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-astronomy-source', 'synthetic');
});

test('cold opening waits for opted-in astronomy and a real environment frame before removing its loader', async ({ page }, info) => {
  test.setTimeout(90_000);
  await installWeatherBridge(page, false);
  await openWorld(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('同步现实天气', { exact: true }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.reload();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-initial-environment-preparation', 'ready');
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 20_000 });
  await expect(canvas).toHaveAttribute('data-astronomy-source', 'provider+ephemeris');
  expect(Number(await canvas.getAttribute('data-first-nonempty-frame-ms'))).toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute('data-environment-transition-started-count', '0');
  await expect(page.locator('.boot-page')).toHaveCount(0);
  await info.attach('prepared-opening', { body: JSON.stringify(await canvas.evaluate(node => ({
    preparation: node.dataset.initialEnvironmentPreparation, firstFrameMs: node.dataset.firstNonemptyFrameMs,
    rebuildMs: node.dataset.worldRebuildLastMs, stagesMs: node.dataset.worldRebuildStagesMs,
    revealState: node.dataset.openingRevealState, source: node.dataset.astronomySource,
  }))), contentType: 'application/json' });
});

test('returning to the timer never requests location again before the existing sync interval',async({page})=>{
  test.setTimeout(90_000);await installWeatherBridge(page,false);await openWorld(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('同步现实天气',{exact:true}).check();
  await expect.poll(async()=>(await bridgeCalls(page)).filter(m=>m==='getAstronomy').length).toBe(1);
  await page.getByRole('button',{name:'计时',exact:true}).click();
  const before=(await bridgeCalls(page)).filter(m=>m==='getCurrentWeather'||m==='getAstronomy');
  for(const tab of ['任务','计时','统计','计时','设置','计时'])await page.getByRole('button',{name:tab,exact:true}).click();
  expect((await bridgeCalls(page)).filter(m=>m==='getCurrentWeather'||m==='getAstronomy')).toEqual(before);
});

test('an old astronomy response cannot restore opted-out coordinates or poison the next enabled interval', async ({ page }) => {
  test.setTimeout(90_000);
  await installWeatherBridge(page, true);
  const canvas = await openWorld(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('同步现实天气', { exact: true }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect.poll(async () => (await bridgeCalls(page)).filter(method => method === 'getAstronomy').length).toBe(1);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('同步现实天气', { exact: true }).uncheck();
  await expect.poll(async () => (await bridgeCalls(page)).filter(method => method === 'clearLocationCache').length)
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => (window as unknown as { weatherHarness: { resolveFirst(): void } }).weatherHarness.resolveFirst());
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-astronomy-source', 'synthetic');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('同步现实天气', { exact: true }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-astronomy-source', 'provider+ephemeris');
  await expect.poll(async () => (await bridgeCalls(page)).filter(method => method === 'getAstronomy').length)
    .toBeGreaterThanOrEqual(2);
});
