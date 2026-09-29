import { expect, test } from '@playwright/test';
import type { BlueprintV1, BlueprintVoxel, VoxelRenderer } from '@blockcolc/voxel';
import { fixBusinessDate } from './fixed-business-date';
import { syntheticOriginalShapePack } from './original-shape-pack-fixture';

const mossStates = [
  { bottom: 'true', north: 'none', east: 'none', south: 'none', west: 'none' },
  { bottom: 'false', north: 'none', east: 'none', south: 'none', west: 'none' },
  { bottom: 'false', north: 'low', east: 'none', south: 'none', west: 'none' },
  { bottom: 'true', north: 'tall', east: 'low', south: 'none', west: 'none' },
  { bottom: 'false', north: 'none', east: 'tall', south: 'low', west: 'tall' },
] as const;

function mossBoard(): BlueprintV1 {
  const floor: BlueprintVoxel[] = [];
  for (let z = -1; z <= 4; z += 1) for (let x = -1; x <= 21; x += 1) floor.push({
    x, y: 0, z, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone',
  });
  const moss: BlueprintVoxel[] = mossStates.map((sourceBlockState, index) => ({
    x: index * 4 + 1, y: 1, z: 2, materialId: 'accent', buildOrder: 10_000,
    sourceBlockId: 'minecraft:pale_moss_carpet', sourceBlockState,
  }));
  return { schemaVersion: 1, id: 'original-pale-moss-board', title: '原创苍白苔藓地毯诊断',
    bounds: { minX: -1, maxX: 21, minY: 0, maxY: 1, minZ: -1, maxZ: 4 }, voxels: [...floor, ...moss] };
}

test('pale moss low/tall sides use original silhouettes and valid pack model wins', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await fixBusinessDate(page, new Date('2026-09-27T12:00:00+08:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
  const blueprint = mossBoard();
  await page.evaluate((value) => {
    const target = window as typeof window & { __blockcolcVoxelTest: typeof import('@blockcolc/voxel'); __mossAudit?: VoxelRenderer };
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '原创苍白苔藓地毯诊断');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';
    document.body.append(canvas);
    const renderer = target.__blockcolcVoxelTest.createVoxelRenderer(canvas,
      { blueprint: value, previewMode: true, lightingQuality: 'performance', worldSeed: 'original-pale-moss-board' });
    renderer.setReducedMotion(true);
    renderer.setWorld({ projectId: value.id, blueprintId: value.id, buildingCompletionBasisPoints: 10_000,
      buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0 });
    renderer.focusProject(value.id);
    renderer.setEnvironmentDebugOverride({ date: Date.parse('2026-09-27T12:00:00+08:00'),
      weather: { kind: 'clear', cloudIntensity: 0, precipitationIntensity: 0 } });
    target.__mossAudit = renderer;
  }, blueprint);
  const canvas = page.getByLabel('原创苍白苔藓地毯诊断');
  try {
    await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(5);
    const original = await page.evaluate(() => (window as typeof window & { __mossAudit: VoxelRenderer }).__mossAudit.getDiagnostics());
    expect(original.originalStaticShapeBudgetFallbackVoxelCount).toBe(0);
    await canvas.hover();
    await page.mouse.wheel(0, -1400);
    await canvas.screenshot({ path: testInfo.outputPath('pale-moss-no-pack.png') });

    const variant = 'bottom=true,east=low,north=tall,south=none,west=none';
    const valid = syntheticOriginalShapePack('pale_moss_carpet', variant, false);
    await page.evaluate(async ({ id, manifest }) => (window as typeof window & { __mossAudit: VoxelRenderer })
      .__mossAudit.setResourcePack({ id, manifest }), valid);
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(4);
    const withPack = await page.evaluate(() => (window as typeof window & { __mossAudit: VoxelRenderer }).__mossAudit.getDiagnostics());
    expect(withPack.geometryVoxelCount).toBeGreaterThanOrEqual(1);
    await canvas.screenshot({ path: testInfo.outputPath('pale-moss-valid-model.png') });

    const missing = syntheticOriginalShapePack('pale_moss_carpet', variant, true);
    await page.evaluate(async ({ id, manifest }) => (window as typeof window & { __mossAudit: VoxelRenderer })
      .__mossAudit.setResourcePack({ id, manifest }), missing);
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(5);
  } finally {
    await page.evaluate(() => (window as typeof window & { __mossAudit?: VoxelRenderer }).__mossAudit?.dispose());
  }
});
