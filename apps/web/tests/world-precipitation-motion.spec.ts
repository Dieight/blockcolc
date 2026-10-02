import { expect, test } from '@playwright/test';
import { fixBusinessDate } from './fixed-business-date';
import { showWorldOverview } from './world-overview';
import type * as THREE from 'three';

type MotionWindow = typeof window & { __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
  __weatherMeshProbe?: Record<string, unknown> };
test.afterEach(async ({ page }, info) => {
  const observation = await page.evaluate(() => ({ canvas: { ...document.querySelector<HTMLCanvasElement>('[aria-label="项目建筑世界"]')?.dataset },
    mesh: (window as MotionWindow).__weatherMeshProbe }));
  await info.attach('actual-weather-frame', { body: JSON.stringify(observation), contentType: 'application/json' });
});

test('rain and layered snow keep falling during actual touch rotation and freeze only when hidden or reduced', async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error' && /shader|webglprogram|INVALID_OPERATION/i.test(m.text())) errors.push(m.text()); });
  await fixBusinessDate(page, new Date('2026-10-01T12:00:00+08:00'));
  await page.addInitScript(() => {
    let n = 0;
    Object.defineProperty(crypto, 'randomUUID', { configurable: true,
      value: () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}` });
  });
  await page.goto('/'); await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await page.evaluate(() => {
    const scope = window as MotionWindow, v = scope.__blockcolcVoxelTest;
    const temporary = new v.LightingPostProcessor({ capabilities: { maxSamples: 0 } } as THREE.WebGLRenderer);
    const scene = (temporary as unknown as { quadScene: THREE.Scene }).quadScene;
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(scene)) as THREE.Object3D, before = proto.onBeforeRender;
    temporary.dispose();
    proto.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      if (renderer.domElement.getAttribute('aria-label') === '项目建筑世界' && /^world-(rain|snow)$/.test(this.name)) {
        const props = renderer.properties.get(material) as { uniforms?: Record<string, { value: unknown }> };
        scope.__weatherMeshProbe = { name: this.name, count: (this as THREE.InstancedMesh).count,
          elapsed: props.uniforms?.weatherElapsed?.value, span: props.uniforms?.weatherSpan?.value,
          size: props.uniforms?.weatherSize?.value, visible: this.visible, worldPosition: this.matrixWorld.elements.slice(12, 15) };
      }
      before.call(this, renderer, scene, camera, geometry, material, group);
    };
  });
  const canvas = page.getByLabel('项目建筑世界');
  // Cold preparation + the actual 1.5s reveal can exceed the default locator
  // timeout on software WebGL. Wait for its completion, never force it.
  await expect(canvas).toHaveAttribute('data-initial-reveal-completed-count', '1', { timeout: 20_000 });
  await expect(canvas).toHaveAttribute('data-initial-reveal-cancelled-count', '0');
  for (const kind of ['rain', 'snow'] as const) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('临时调试世界', { exact: true }).check();
    await page.getByLabel('指定时间', { exact: true }).check();
    await page.getByLabel('世界调试时间', { exact: true }).fill('12:00');
    await page.getByLabel('天气', { exact: true }).selectOption(kind);
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-weather-kind', kind);
    await expect(canvas).toHaveAttribute('data-environment-transition-active', 'false');
    const bounds = (await canvas.boundingBox())!, cdp = await page.context().newCDPSession(page);
    const clock = `data-${kind}-elapsed-ms`;
    const rebuilds = await canvas.getAttribute('data-world-rebuild-count');
    const point = (x: number) => ({ id: 17, x, y: bounds.y + bounds.height * .64, radiusX: 1, radiusY: 1, force: 1 });
    try {
      const start = Number(await canvas.getAttribute(clock)), azimuth = Number(await canvas.getAttribute('data-camera-azimuth'));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(bounds.x + bounds.width * .25)] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(bounds.x + bounds.width * (.25 + i * .075))] });
        await page.waitForTimeout(70);
      }
      await expect(canvas).toHaveAttribute('data-precipitation-motion-paused', 'false');
      expect(Number(await canvas.getAttribute(clock))).toBeGreaterThan(start + 200);
      expect(Number(await canvas.getAttribute('data-camera-azimuth'))).not.toBe(azimuth);
      await canvas.screenshot({ path: info.outputPath(`${kind}-during-touch.png`) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
    await expect(canvas).toHaveAttribute('data-world-rebuild-count', rebuilds!);
    await expect.poll(async () => {
      const a = await canvas.getAttribute('data-camera-azimuth'); await page.waitForTimeout(120);
      return Math.abs(Number(await canvas.getAttribute('data-camera-azimuth')) - Number(a));
    }).toBeLessThan(.0002);
    // Keep the close-up touch/clock checks above. Pixel motion is observed from
    // the overview, not a building close-up whose foreground hillside can hide
    // all the sparse light-rain drops for several frames.
    await showWorldOverview(page);
    await expect.poll(async () => Number(await canvas.getAttribute(`data-${kind}-camera-frustum-count`))).toBeGreaterThan(0);
    const idleCadence = await canvas.evaluate(async element => {
      const surface = element as HTMLCanvasElement;
      const startedAt = performance.now();
      const before = Number(surface.dataset.renderFrameCount);
      const interval = Number(surface.dataset.precipitationFrameIntervalMs);
      await new Promise(resolve => setTimeout(resolve, 1_000));
      return { elapsedMs: performance.now() - startedAt, interval,
        frames: Number(surface.dataset.renderFrameCount) - before };
    });
    await info.attach(`${kind}-idle-cadence`, { body: JSON.stringify(idleCadence), contentType: 'application/json' });
    expect(idleCadence.interval).toBeGreaterThanOrEqual(32);
    expect(idleCadence.frames).toBeGreaterThan(0);
    // Two boundary/explicit-update frames are allowed; an unbounded dirty-flag
    // loop must not bypass the advertised weather cadence.
    expect(idleCadence.frames).toBeLessThanOrEqual(Math.ceil(idleCadence.elapsedMs / idleCadence.interval) + 2);
    const uploads = await canvas.getAttribute(`data-${kind}-matrix-upload-count`);
    expect(Number(uploads)).toBeGreaterThan(0);
    const frame = await canvas.screenshot({ path: info.outputPath(`${kind}-moving-1.png`) });
    const previousFrame = Number(await canvas.getAttribute('data-render-frame-count'));
    const beforeElapsed = Number(await canvas.getAttribute(clock));
    const motionSamples: { frame: number; elapsed: number; changed: boolean }[] = [];
    // The ordinary cold opening now ends in a genuine close-up. With light
    // rain, a single intervening frame need not contain any visible drop.
    // Require real pixel motion within a bounded window, not on every frame;
    // a frozen shader still fails even if the diagnostic clock keeps advancing.
    await expect.poll(async () => {
      const rendered = Number(await canvas.getAttribute('data-render-frame-count'));
      const elapsed = Number(await canvas.getAttribute(clock));
      if (rendered <= previousFrame || elapsed <= beforeElapsed) return false;
      const next = await canvas.screenshot({ path: info.outputPath(`${kind}-moving-2.png`) });
      const changed = !next.equals(frame);
      motionSamples.push({ frame: rendered, elapsed, changed });
      return changed;
    }, { timeout: 5_000 }).toBe(true);
    const drawnMesh = await page.evaluate(() => (window as MotionWindow).__weatherMeshProbe);
    expect(drawnMesh?.name).toBe(`world-${kind}`);
    expect(Number(drawnMesh?.elapsed)).toBeGreaterThan(beforeElapsed);
    await info.attach(`${kind}-pixel-motion-samples`, { body: JSON.stringify(motionSamples), contentType: 'application/json' });
    // Particle motion changes pixels/uniform time, without uploading every instance again.
    expect(await canvas.getAttribute(`data-${kind}-matrix-upload-count`)).toBe(uploads);
    await page.getByRole('button', { name: '任务', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-precipitation-motion-paused', 'true');
    const paused = await canvas.getAttribute(clock); await page.waitForTimeout(120);
    expect(await canvas.getAttribute(clock)).toBe(paused);
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect.poll(async () => Number(await canvas.getAttribute(clock))).toBeGreaterThan(Number(paused));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(canvas).toHaveAttribute('data-precipitation-motion-paused', 'true');
    const reduced = await canvas.getAttribute(clock); await page.waitForTimeout(120);
    expect(await canvas.getAttribute(clock)).toBe(reduced);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  expect(errors).toEqual([]);
});
