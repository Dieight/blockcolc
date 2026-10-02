import { expect, test } from '@playwright/test';
import type { VoxelRenderer } from '@blockcolc/voxel';
import type * as THREE from 'three';
import { fixBusinessDate } from './fixed-business-date';

type WeatherScope = typeof window & {
  __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
  coverageRenderer: VoxelRenderer;
  lightningPixels?: number;
  projectedCloudBlocks?: number;
};

for (const quality of ['cinematic', 'balanced', 'performance'] as const) {
test(`${quality}: clouded skies hide celestial disks and reflection while wide rain/snow stay GPU-driven`, async ({ page }, info) => {
  test.setTimeout(120_000);
  const shaderErrors: string[] = [];
  page.on('console', message => { if (/THREE.WebGLProgram|Shader Error|GL_INVALID/.test(message.text())) shaderErrors.push(message.text()); });
  await fixBusinessDate(page, new Date('2026-10-01T15:00:00+08:00'));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as WeatherScope).__blockcolcVoxelTest);
  await page.evaluate(async () => {
    const scope = window as WeatherScope;
    // Observe real bolt draw output, not just a scheduled-strike counter. The
    // readback exists only in this test and samples a small direct-frame crop.
    const temporary = new scope.__blockcolcVoxelTest.LightingPostProcessor({ capabilities: { maxSamples: 0 } } as THREE.WebGLRenderer);
    const scene = (temporary as unknown as { quadScene: THREE.Scene }).quadScene;
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(scene)) as THREE.Object3D;
    const before = proto.onBeforeRender, after = proto.onAfterRender;
    const samples = new Map<THREE.Object3D, { bytes: Uint8Array; x: number; y: number }>();
    temporary.dispose();
    proto.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      if (this.name === 'world-clouds' && renderer.domElement.getAttribute('aria-label') === '天气覆盖预览'
        && renderer.domElement.dataset.weatherKind === 'cloudy' && scope.projectedCloudBlocks === undefined) {
        const mesh = this as THREE.InstancedMesh;
        const centers = geometry.getAttribute('cloudCenter'), velocities = geometry.getAttribute('cloudVelocity');
        const props = renderer.properties.get(material) as { uniforms?: Record<string, { value: unknown }> };
        const elapsed = Number(props.uniforms?.cloudElapsed?.value ?? 0);
        const spans = props.uniforms?.cloudSpan?.value as [number, number] | undefined;
        const matrix = mesh.matrix.clone(), point = mesh.position.clone();
        const wrap = (v: number, width: number) => ((v + width / 2) % width + width) % width - width / 2;
        let projected = 0;
        for (let index = 0; index < mesh.count; index++) {
          mesh.getMatrixAt(index, matrix); point.setFromMatrixPosition(matrix);
          if (spans) {
            point.x += wrap(centers.getX(index) + velocities.getX(index) * elapsed, spans[0]) - centers.getX(index);
            point.z += wrap(centers.getY(index) + velocities.getY(index) * elapsed, spans[1]) - centers.getY(index);
          }
          point.applyMatrix4(mesh.matrixWorld).project(camera);
          if (Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && point.z >= -1 && point.z <= 1) projected++;
        }
        scope.projectedCloudBlocks = projected;
      }
      if (this.name === 'world-lightning-segment' && renderer.domElement.getAttribute('aria-label') === '天气覆盖预览'
        && renderer.getRenderTarget() === null && !(scope.lightningPixels && scope.lightningPixels > 0)) {
        const gl = renderer.getContext();
        const point = this.getWorldPosition(this.position.clone()).project(camera);
        if (Math.abs(point.x) < .95 && Math.abs(point.y) < .95 && point.z > -1 && point.z < 1) {
          const x = Math.max(0, Math.min(gl.drawingBufferWidth - 16, Math.floor((point.x + 1) * gl.drawingBufferWidth / 2) - 8));
          const y = Math.max(0, Math.min(gl.drawingBufferHeight - 16, Math.floor((point.y + 1) * gl.drawingBufferHeight / 2) - 8));
          const bytes = new Uint8Array(16 * 16 * 4);
          gl.readPixels(x, y, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          samples.set(this, { bytes, x, y });
        }
      }
      before.call(this, renderer, scene, camera, geometry, material, group);
    };
    proto.onAfterRender = function (renderer, scene, camera, geometry, material, group) {
      const sample = samples.get(this);
      if (sample) {
        const gl = renderer.getContext(), bytes = new Uint8Array(sample.bytes.length);
        gl.readPixels(sample.x, sample.y, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        let changed = 0;
        for (let i = 0; i < bytes.length; i += 4) {
          if (bytes[i]! + bytes[i + 1]! + bytes[i + 2]! > 500
            && bytes[i]! + bytes[i + 1]! + bytes[i + 2]! > sample.bytes[i]! + sample.bytes[i + 1]! + sample.bytes[i + 2]! + 30) changed++;
        }
        scope.lightningPixels = (scope.lightningPixels ?? 0) + changed;
        samples.delete(this);
      }
      after.call(this, renderer, scene, camera, geometry, material, group);
    };
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', '天气覆盖预览');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;touch-action:none;z-index:99999';
    document.body.append(canvas);
    const app = scope.__blockcolcVoxelTest.createVoxelRenderer(canvas, {
      environmentStyle: 'ocean-island', worldSeed: 'scenery-review-fixed', terrainGenerationVersion: 4,
      lightingQuality: 'balanced', initialEnvironment: { weather: { kind: 'clear', cloudIntensity: 0 },
        astronomy: null, debug: { date: Date.parse('2026-10-01T15:00:00+08:00') } },
    });
    scope.coverageRenderer = app; app.setVisible(false);
    await app.initializeWorlds(Array.from({ length: 7 }, (_, settlementIndex) => ({
      projectId: `weather-${settlementIndex}`, settlementIndex, blueprintId: 'builtin-timber-house',
      buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false,
    })), null);
    app.setVisible(true); await app.prepareInitialPresentation();
  });
  const canvas = page.getByLabel('天气覆盖预览');
  await expect(canvas).toHaveAttribute('data-sun-disk-visible', 'true');
  const observations = [];
    await page.evaluate(value => (window as WeatherScope).coverageRenderer.setLightingQuality(value), quality);
    for (const kind of ['cloudy', 'mist', 'rain', 'snow'] as const) {
      await page.evaluate(value => (window as WeatherScope).coverageRenderer.setExternalWeatherOverride({
        kind: value, cloudIntensity: .6, precipitationIntensity: .35,
      }), kind);
      await expect(canvas).toHaveAttribute('data-weather-kind', kind);
      await expect(canvas).toHaveAttribute('data-sun-disk-visible', 'false');
      await expect(canvas).toHaveAttribute('data-water-reflection-strength', '0.000');
      await expect(canvas).toHaveAttribute('data-water-roughness', '1.000');
      expect(Number(await canvas.getAttribute('data-directional-light-intensity'))).toBeGreaterThan(0);
      if (kind === 'cloudy') {
        expect(Number(await canvas.getAttribute('data-cloud-near-group-count'))).toBeGreaterThan(10);
        expect(await page.evaluate(() => (window as WeatherScope).projectedCloudBlocks ?? 0)).toBeGreaterThan(10);
        await expect(canvas).toHaveAttribute('data-cloud-matrix-upload-count', '1');
        await canvas.screenshot({ path: info.outputPath('wide-cloudy.png') });
      }
      if (kind === 'rain' || kind === 'snow') {
        const span = await canvas.evaluate(node => Math.max(Number(node.dataset.precipitationFieldSpanX), Number(node.dataset.precipitationFieldSpanZ)));
        expect(span).toBeGreaterThan(180);
        const key = kind === 'rain' ? 'data-rain-matrix-upload-count' : 'data-snow-matrix-upload-count';
        const uploads = await canvas.getAttribute(key);
        expect(uploads).toBe('1');
        const rebuilds = await canvas.getAttribute('data-world-rebuild-count');
        const bounds = (await canvas.boundingBox())!;
        await page.mouse.move(bounds.width * .3, bounds.height * .5); await page.mouse.down();
        await page.mouse.move(bounds.width * .65, bounds.height * .53, { steps: 10 }); await page.mouse.up();
        await page.mouse.wheel(0, 400);
        await expect(canvas).toHaveAttribute(key, uploads!);
        await expect(canvas).toHaveAttribute('data-world-rebuild-count', rebuilds!);
        observations.push({ quality, kind, span, uploads });
      }
    }
  await page.evaluate(() => (window as WeatherScope).coverageRenderer.setExternalWeatherOverride({
    kind: 'rain', thunderstorm: true, cloudIntensity: 1, precipitationIntensity: .8,
  }));
  await expect.poll(async () => Number(await canvas.getAttribute('data-lightning-strike-count')), { timeout: 20_000 }).toBeGreaterThan(0);
  if (quality !== 'cinematic') await expect.poll(() => page.evaluate(() => (window as WeatherScope).lightningPixels ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
  await canvas.screenshot({ path: info.outputPath('wide-storm.png') });
  await page.evaluate(() => (window as WeatherScope).coverageRenderer.setExternalWeatherOverride({ kind: 'snow', cloudIntensity: .8, precipitationIntensity: .7 }));
  await expect(canvas).toHaveAttribute('data-weather-kind', 'snow');
  await canvas.screenshot({ path: info.outputPath('wide-snow.png') });
  await page.evaluate(() => (window as WeatherScope).coverageRenderer.setExternalWeatherOverride({ kind: 'clear', cloudIntensity: 0 }));
  await expect(canvas).toHaveAttribute('data-sun-disk-visible', 'true');
  await expect(canvas).toHaveAttribute('data-water-reflection-strength', '1.000');
  expect(shaderErrors).toEqual([]);
  await info.attach('weather-coverage', { body: JSON.stringify({ observations,
    projectedCloudBlocks: await page.evaluate(() => (window as WeatherScope).projectedCloudBlocks ?? 0),
    lightningPixels: await page.evaluate(() => (window as WeatherScope).lightningPixels ?? 0) }), contentType: 'application/json' });
  await page.evaluate(() => (window as WeatherScope).coverageRenderer.dispose());
});
}
