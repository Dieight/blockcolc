import { expect, test, type Page } from '@playwright/test';
import { choosePlanEndTime } from './focus-plan-controls';
import { expandGlassSetting } from './expand-glass-setting';
import { readPersistedDomainState } from './persisted-domain-state';
import type * as THREE from 'three';

async function setup(page: Page, minimal = false) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-10-04T04:00:00Z'));
  await page.addInitScript(({ minimal }) => {
    if (!localStorage.getItem('blockcolc-focus-preferences-v1')) localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({
      minimalMode: minimal, focusMinutes: 1, breakMinutes: 0, autoContinueFocus: true,
      lightingQuality: 'performance', themeMode: 'light', focusGlassTransparency: 100,
    }));
  }, { minimal });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 25_000 });
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready', 'true');
}
async function finishEarly(page: Page) {
  const end = page.getByRole('button', { name: '结束本次专注', exact: true });
  if (!await end.isVisible()) await page.locator('.immersive-hint').dblclick();
  await end.click();
  await page.getByRole('button', { name: /提前完成本轮/ }).click();
}
async function startWatch(page: Page) {
  await page.evaluate(() => {
    const samples: { report: boolean; ordinary: boolean; label: string }[] = [];
    const sample = () => samples.push({
      report: Boolean(document.querySelector('.focus-report-surface')),
      ordinary: Boolean(document.querySelector('.app-shell:not(.focus-immersive) .world-screen')),
      label: document.querySelector('.focus-task-context')?.textContent ?? '',
    });
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    Object.assign(window, { __roundWatch: { samples, stop: () => observer.disconnect() } });
  });
}
async function endWatch(page: Page) {
  return await page.evaluate(() => {
    const watch = (window as typeof window & { __roundWatch: { samples: { report: boolean; ordinary: boolean; label: string }[]; stop(): void } }).__roundWatch;
    watch.stop(); return watch.samples;
  });
}

for (const minimal of [false, true]) test(`${minimal ? 'minimal' : 'ordinary marathon'} keeps every ordinal and never flashes a report or the workbench when starting the last round`, async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page, minimal);
  if (minimal) {
    await page.locator('.minimal-clock-gesture').press('ArrowUp');
    await expect(page.locator('.minimal-clock-gesture')).toContainText('12:05');
    await page.locator('.minimal-clock-gesture').press('Enter');
  } else {
    await page.getByRole('button', { name: '调整本次计划', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '安排下一轮' });
    await sheet.getByRole('button', { name: '按结束时间', exact: true }).click();
    await choosePlanEndTime(sheet, '12:05');
    await sheet.getByRole('button', { name: '确认计划', exact: true }).click();
    await expect(page.locator('.workbench-action-row').getByRole('button', { name: '调整本次计划', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '开始到 12:05', exact: true }).click();
  }
  for (let round = 1; round <= 4; round++) {
    await expect(page.locator('.focus-task-context')).toContainText(`专注中 第${round}/5轮`);
    await finishEarly(page);
    const ready = page.locator('.minimal-ready-clock'); await expect(ready).toBeVisible();
    await startWatch(page); await ready.press('Enter');
    await expect(page.locator('.focus-task-context')).toContainText(`专注中 第${round + 1}/5轮`);
    const samples = await endWatch(page);
    await info.attach(`resume-${round + 1}`, { body: JSON.stringify(samples), contentType: 'application/json' });
    expect(samples.some(sample => sample.report || sample.ordinary || sample.label.includes('第1/1轮'))).toBe(false);
  }
  const end = page.getByRole('button', { name: '结束本次专注', exact: true });
  if (!await end.isVisible()) await page.locator('.immersive-hint').dblclick();
  await end.click(); await page.getByRole('button', { name: /中断本轮/ }).click();
  await page.getByRole('button', { name: '不记录', exact: true }).click();
  const ready = page.locator('.minimal-ready-clock'); await expect(ready).toBeVisible();
  await startWatch(page); await ready.press('Enter');
  await expect(page.locator('.focus-task-context')).toContainText('专注中 第5/5轮');
  const samples = await endWatch(page);
  expect(samples.some(sample => sample.report || sample.ordinary || sample.label.includes('第1/1轮'))).toBe(false);
  await finishEarly(page);
  const report = page.locator('.focus-report-surface--minimal'); await expect(report).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeHidden();
  const colors = await report.evaluate(element => {
    const ink = getComputedStyle(element).color;
    return [...element.querySelectorAll('small,.minimal-report-help,.minimal-report-allocation,.marathon-report-copy p')]
      .map(child => ({ ink, color: getComputedStyle(child).color }));
  });
  expect(colors.every(color => color.color === color.ink)).toBe(true);
  expect((await readPersistedDomainState(page)).state.focusHistory.filter(session => session.status === 'completed' || session.status === 'completed-early')).toHaveLength(5);
  await page.screenshot({ path: info.outputPath(`${minimal ? 'minimal' : 'marathon'}-same-glass-report.png`) });
  expect(errors).toEqual([]);
});

for (const minimal of [false, true]) test(`${minimal ? 'minimal' : 'ordinary'} cold load keeps one visible construction animation through storage and world warm-up`, async ({ page }, info) => {
  test.setTimeout(90_000); await setup(page, minimal); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const identities = new WeakMap<Element, number>(), samples: { identity: number; stage: string | undefined; active: boolean; bandVisible: boolean }[] = [];
    let sequence = 0;
    const sample = () => {
      for (const element of document.querySelectorAll<HTMLElement>('.boot-page')) {
        if (getComputedStyle(element).visibility === 'hidden' || !element.getBoundingClientRect().height) continue;
        if (!identities.has(element)) identities.set(element, ++sequence);
        const band = document.querySelector<HTMLElement>('.world-screen .focus-panel');
        samples.push({ identity: identities.get(element)!, stage: element.dataset.loadStage, active: document.documentElement.dataset.coldStartup === 'true',
          bandVisible: Boolean(band && getComputedStyle(band).visibility !== 'hidden' && band.getBoundingClientRect().height > 0) });
      }
    };
    new MutationObserver(sample).observe(document, { subtree: true, attributes: true, childList: true });
    Object.assign(window, { __loaderSamples: samples });
  });
  await page.reload();
  const canvas = page.getByLabel('项目建筑世界');
  await expect.poll(async()=>Number(await canvas.getAttribute('data-opening-prepared-frames')), { timeout: 35_000 }).toBeGreaterThanOrEqual(5);
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 20_000 });
  await expect(page.locator('.boot-page')).toHaveCount(0);
  const samples = await page.evaluate(() => (window as typeof window & { __loaderSamples: { identity: number; stage: string; active: boolean; bandVisible: boolean }[] }).__loaderSamples);
  expect(new Set(samples.filter(sample => sample.active).map(sample => sample.identity)).size).toBe(1);
  expect(samples.some(sample => sample.stage === 'storage')).toBe(true);
  expect(samples.some(sample => sample.stage === 'scene' || sample.stage === 'environment')).toBe(true);
  expect(samples.some(sample => sample.active && sample.bandVisible)).toBe(false);
  await info.attach('continuous-loader', { body: JSON.stringify(samples), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath(`${minimal ? 'minimal' : 'ordinary'}-opening.png`) });
});

for (const minimal of [false, true]) test(`${minimal ? 'minimal' : 'ordinary'} focus starts without changing world exposure or revealing a bright backdrop`, async ({ page }, info) => {
  test.setTimeout(90_000); await setup(page, minimal); await page.emulateMedia({ reducedMotion: 'no-preference' });
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1');
  await page.evaluate(() => {
    const w = window as typeof window & { __blockcolcVoxelTest: typeof import('@blockcolc/voxel'); __exposureSamples: number[] };
    const canvas = document.querySelector<HTMLCanvasElement>('[aria-label="项目建筑世界"]')!;
    const probe = new w.__blockcolcVoxelTest.LightingPostProcessor({ capabilities: { maxSamples: 0 } } as THREE.WebGLRenderer);
    const proto = Object.getPrototypeOf(Object.getPrototypeOf((probe as unknown as { quadScene: THREE.Scene }).quadScene)) as THREE.Object3D;
    const previous = proto.onBeforeRender; probe.dispose(); w.__exposureSamples = [];
    proto.onBeforeRender = function(renderer, scene, camera, geometry, material, group) {
      if (renderer.domElement === canvas && this.userData.terrainTriangles) w.__exposureSamples.push(renderer.toneMappingExposure);
      previous.call(this, renderer, scene, camera, geometry, material, group);
    };
  });
  await canvas.dispatchEvent('wheel', { deltaY: 0 });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __exposureSamples: number[] }).__exposureSamples.length)).toBeGreaterThan(0);
  const exposure = await page.evaluate(() => (window as typeof window & { __exposureSamples: number[] }).__exposureSamples.at(-1)!);
  const pulses = await canvas.getAttribute('data-construction-pulse-count');
  const environment = await canvas.getAttribute('data-environment-transition-started-count');
  await page.evaluate(() => {
    const w = window as typeof window & { __exposureSamples: number[]; __worldOpacities: number[] };
    w.__exposureSamples = []; w.__worldOpacities = [];
    const start = performance.now(); let lastDraw = -Infinity;
    const sample = () => { w.__worldOpacities.push(Number(getComputedStyle(document.querySelector('.world-stage')!).opacity));
      // A static minimal world legitimately stops drawing once its pulse is removed.
      // Request neutral frames throughout the old pulse interval without moving the camera.
      if (performance.now() - lastDraw > 120) { lastDraw = performance.now();
        document.querySelector('[aria-label="项目建筑世界"]')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 0 })); }
      if (performance.now() - start < 2000) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  if (minimal) {
    await page.locator('.minimal-clock-gesture').press('ArrowUp');
    await page.locator('.minimal-clock-gesture').press('Enter');
  } else await page.getByRole('button', { name: '开始 1 轮', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-immersive/);
  expect((await readPersistedDomainState(page)).state.activeFocusSession).not.toBeNull();
  await expect(page.locator('.focus-task-context')).toContainText(minimal ? '专注中' : '确定目标');
  // Observe the complete old 0.9-second pulse window using animation frames.
  await page.evaluate(() => new Promise<void>(resolve => {
    const start = performance.now(); const frame = () => performance.now() - start >= 1700 ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame);
  }));
  const observations = await page.evaluate(() => { const w = window as typeof window & { __exposureSamples: number[]; __worldOpacities: number[] };
    return { exposure: w.__exposureSamples, opacity: w.__worldOpacities }; });
  await info.attach('unchanged-focus-light', { body: JSON.stringify({ exposure, pulses, observations }), contentType: 'application/json' });
  expect(observations.exposure.length).toBeGreaterThan(0);
  expect(observations.exposure.every(value => Math.abs(value - exposure) < .001)).toBe(true);
  expect(observations.opacity.every(value => value === 1)).toBe(true);
  expect(await canvas.getAttribute('data-construction-pulse-count')).toBe(pulses);
  expect(await canvas.getAttribute('data-environment-transition-started-count')).toBe(environment);
});

test('pointer feedback has no selection outlines, refresh rotates its own icon, and the update initial message is populated', async ({ page }, info) => {
  test.setTimeout(90_000); await setup(page); await page.emulateMedia({reducedMotion:'no-preference'});
  for (const tab of ['设置', '任务', '设置', '计时', '设置']) {
    const button = page.getByRole('button', { name: tab, exact: true }); await button.click();
    await expect(button).toHaveCSS('outline-style', 'none'); await expect(button).toHaveCSS('box-shadow', 'none');
  }
  await page.getByText('世界色彩', { exact: true }).click();
  const restore = page.getByRole('button', { name: '恢复默认', exact: true }); await restore.click();
  await expect(restore).toHaveCSS('outline-style', 'none'); await expect(restore).toHaveCSS('box-shadow', 'none');
  const refresh = page.getByRole('button', { name: '刷新可恢复备份', exact: true }); await refresh.click();
  await expect(refresh).toHaveAttribute('aria-busy', 'true');
  expect(await refresh.evaluate(element => getComputedStyle(element, '::after').display)).toBe('none');
  await expect(refresh.locator('.refresh-motion')).toHaveCSS('animation-name', 'control-spin');
  await expect(refresh).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '关于方块钟', exact: true }).click();
  await expect(page.locator('.update-result')).toContainText('等待手动检查更新');
  await page.screenshot({ path: info.outputPath('about-idle-update.png') });
});

test('slingshot preview and ball share pixel circles; first rebound follows the launch direction into its step', async ({ page }, info) => {
  test.setTimeout(90_000); await setup(page); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const input = await expandGlassSetting(page), physical = input.locator('..');
  for (const up of [false, true]) {
    await input.fill('50'); await physical.scrollIntoViewIfNeeded();
    const bounds = (await physical.locator('.physical-slider-rail').boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 3); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 - 24, bounds.y + 3 + (up ? -48 : 48), { steps: 6 });
    const predicted = Number((await page.locator('.glass-transparency-value').innerText()).match(/\d+/)![0]);
    await expect(physical.locator('output')).toHaveCount(0);
    expect(up ? predicted < 50 : predicted > 50).toBe(true);
    const ball = physical.locator('.physical-slider-ball:not(.is-predicted)'), marker = physical.locator('.is-predicted');
    expect(await marker.evaluate(e => getComputedStyle(e).clipPath)).toBe(await ball.evaluate(e => getComputedStyle(e).clipPath));
    await expect(physical.locator('.physical-slider-rail')).toHaveCSS('border-radius', '0px');
    await page.screenshot({ path: info.outputPath(up ? 'upward-sling-pixel-circle.png' : 'downward-sling-pixel-circle.png') });
    await physical.evaluate(element => {
      const samples: { x: number; y: number }[] = []; Object.assign(window, { __ballSamples: samples });
      const sample = () => {
        const ball = element.querySelector<HTMLElement>('.physical-slider-ball:not(.is-predicted)')!;
        const rail = element.querySelector('.physical-slider-rail')!.getBoundingClientRect(), rect = ball.getBoundingClientRect();
        samples.push({ x: rect.left + rect.width / 2 - rail.left, y: new DOMMatrix(getComputedStyle(ball).transform).m42 });
        if ((element as HTMLElement).dataset.flight !== 'idle') requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
    await page.mouse.up(); await expect(physical).toHaveAttribute('data-flight', 'idle'); await expect(input).toHaveValue(String(predicted));
    const samples = await page.evaluate(() => (window as typeof window & { __ballSamples: { x: number; y: number }[] }).__ballSamples);
    await info.attach(up ? 'upward-pull' : 'downward-pull', { body: JSON.stringify({ predicted, samples }), contentType: 'application/json' });
    // Measure actual pixels: the settled ball uses a percentage CSS left value.
    // After impact, every horizontal alignment step follows the same direction.
    const impact = samples.findIndex((sample, index) => index > 1 && samples[index - 1]!.y < 0 && sample.y > samples[index - 1]!.y && sample.y > -8);
    if (impact >= 0) for (let index = impact + 1; index < samples.length; index++)
      expect(up ? samples[index]!.x <= samples[index - 1]!.x + .05 : samples[index]!.x >= samples[index - 1]!.x - .05).toBe(true);
  }
});
