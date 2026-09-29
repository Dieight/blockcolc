import { expect, test } from '@playwright/test';
import type { BlueprintV1, BlueprintVoxel, VoxelRenderer } from '@blockcolc/voxel';
import { fixBusinessDate } from './fixed-business-date';
import { syntheticOriginalShapePack } from './original-shape-pack-fixture';

const dyes = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

function candleBoard(): { blueprint: BlueprintV1; candleCount: number } {
  const samples: BlueprintVoxel[] = [];
  const add = (x: number, z: number, id: string, candles: string, lit: string, emissiveLevel?: number) => samples.push({
    x, y: 1, z, materialId: 'accent', buildOrder: 10_000, sourceBlockId: id,
    sourceBlockState: { candles, lit, waterlogged: 'false' },
    ...(emissiveLevel === undefined ? {} : { emissiveLevel }),
  });
  add(0, 0, 'minecraft:candle', '1', 'false');
  dyes.forEach((dye, index) => add((index % 6) * 3, 3 + Math.floor(index / 6) * 3,
    `minecraft:${dye}_candle`, String(index % 4 + 1), index % 2 ? 'true' : 'false'));
  add(3, 0, 'minecraft:red_candle', '4', 'true');
  add(6, 0, 'minecraft:red_candle', '4', 'true', 0);
  add(9, 0, 'minecraft:blue_candle', '2', 'true');
  const floor: BlueprintVoxel[] = [];
  for (let z = -1; z <= 10; z += 1) for (let x = -1; x <= 16; x += 1) floor.push({
    x, y: 0, z, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone',
  });
  return { candleCount: samples.length, blueprint: { schemaVersion: 1, id: 'original-candle-board',
    title: '原创蜡烛诊断', bounds: { minX: -1, maxX: 16, minY: 0, maxY: 1, minZ: -1, maxZ: 10 },
    voxels: [...floor, ...samples] } };
}

test('candle family renders in the world and keeps valid pack models ahead of original fallback', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await fixBusinessDate(page, new Date('2026-09-27T12:00:00+08:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
  const { blueprint, candleCount } = candleBoard();
  await page.evaluate((value) => {
    const target = window as typeof window & { __blockcolcVoxelTest: typeof import('@blockcolc/voxel'); __candleAudit?: VoxelRenderer };
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '原创蜡烛诊断');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';
    document.body.append(canvas);
    const renderer = target.__blockcolcVoxelTest.createVoxelRenderer(canvas,
      { blueprint: value, previewMode: true, lightingQuality: 'performance', worldSeed: 'original-candle-board' });
    renderer.setReducedMotion(true);
    renderer.setWorld({ projectId: value.id, blueprintId: value.id, buildingCompletionBasisPoints: 10_000,
      buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0 });
    renderer.focusProject(value.id);
    renderer.setEnvironmentDebugOverride({ date: Date.parse('2026-09-27T12:00:00+08:00'),
      weather: { kind: 'clear', cloudIntensity: 0, precipitationIntensity: 0 } });
    target.__candleAudit = renderer;
  }, blueprint);
  const canvas = page.getByLabel('原创蜡烛诊断');
  try {
    await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(candleCount);
    const noPack = await page.evaluate(() => (window as typeof window & { __candleAudit: VoxelRenderer }).__candleAudit.getDiagnostics());
    expect(noPack.originalStaticShapeBudgetFallbackVoxelCount).toBe(0);
    expect(noPack.originalStaticShapeEmissiveMaterialGroupCount).toBeGreaterThan(0);
    await canvas.screenshot({ path: testInfo.outputPath('candles-no-pack.png') });
    const overviewDistance = Number(await canvas.getAttribute('data-camera-distance'));
    await canvas.hover();
    for (let step = 0; step < 5; step += 1) await page.mouse.wheel(0, -900);
    await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance'))).toBeLessThan(overviewDistance);
    await canvas.screenshot({ path: testInfo.outputPath('candles-close-no-pack.png') });

    const valid = syntheticOriginalShapePack('red_candle', 'candles=4,lit=true', false);
    await page.evaluate(async ({ id, manifest }) => (window as typeof window & { __candleAudit: VoxelRenderer })
      .__candleAudit.setResourcePack({ id, manifest }), valid);
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(candleCount - 2);
    const validPack = await page.evaluate(() => (window as typeof window & { __candleAudit: VoxelRenderer }).__candleAudit.getDiagnostics());
    expect(validPack.geometryVoxelCount).toBeGreaterThanOrEqual(2);
    await canvas.screenshot({ path: testInfo.outputPath('candles-valid-model.png') });

    const missing = syntheticOriginalShapePack('red_candle', 'candles=4,lit=true', true);
    await page.evaluate(async ({ id, manifest }) => (window as typeof window & { __candleAudit: VoxelRenderer })
      .__candleAudit.setResourcePack({ id, manifest }), missing);
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(candleCount);
    await canvas.screenshot({ path: testInfo.outputPath('candles-missing-model.png') });
  } finally {
    await page.evaluate(() => (window as typeof window & { __candleAudit?: VoxelRenderer }).__candleAudit?.dispose());
  }
});
