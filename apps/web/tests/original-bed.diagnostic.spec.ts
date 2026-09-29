import { expect, test } from '@playwright/test';
import type { BlueprintV1, BlueprintVoxel, VoxelRenderer } from '@blockcolc/voxel';
import { fixBusinessDate } from './fixed-business-date';
import { syntheticOriginalShapePack } from './original-shape-pack-fixture';

const ids = [...['black', 'blue', 'brown', 'cyan', 'gray', 'green', 'light_blue', 'light_gray',
  'lime', 'magenta', 'orange', 'pink', 'purple', 'red', 'white', 'yellow'].map((dye) => `minecraft:${dye}_bed`),
  'minecraft:straw_bed'];
const facingDeltas = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;

function bedBoard(): { blueprint: BlueprintV1; bedVoxelCount: number } {
  const beds: BlueprintVoxel[] = [];
  ids.forEach((id, index) => {
    const facing = (['north', 'east', 'south', 'west'] as const)[index % 4]!;
    const footX = (index % 5) * 4 + 1;
    const footZ = Math.floor(index / 5) * 4 + 2;
    const [dx, dz] = facingDeltas[facing];
    for (const part of ['foot', 'head'] as const) beds.push({
      x: footX + (part === 'head' ? dx : 0), y: 1,
      z: footZ + (part === 'head' ? dz : 0), materialId: 'accent', buildOrder: 10_000,
      sourceBlockId: id, sourceBlockState: { facing, occupied: index % 2 ? 'true' : 'false', part },
    });
  });
  const floor: BlueprintVoxel[] = [];
  for (let z = -1; z <= 16; z += 1) for (let x = -1; x <= 18; x += 1) floor.push({
    x, y: 0, z, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone',
  });
  return { bedVoxelCount: beds.length, blueprint: { schemaVersion: 1, id: 'original-bed-board',
    title: '原创床诊断', bounds: { minX: -1, maxX: 18, minY: 0, maxY: 1, minZ: -1, maxZ: 16 },
    voxels: [...floor, ...beds] } };
}

test('paired bed parts and straw mat use their own geometry while a valid pack model stays first', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await fixBusinessDate(page, new Date('2026-09-27T12:00:00+08:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
  const { blueprint, bedVoxelCount } = bedBoard();
  await page.evaluate((value) => {
    const target = window as typeof window & { __blockcolcVoxelTest: typeof import('@blockcolc/voxel'); __bedAudit?: VoxelRenderer };
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '原创床诊断');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';
    document.body.append(canvas);
    const renderer = target.__blockcolcVoxelTest.createVoxelRenderer(canvas,
      { blueprint: value, previewMode: true, lightingQuality: 'performance', worldSeed: 'original-bed-board' });
    renderer.setReducedMotion(true);
    renderer.setWorld({ projectId: value.id, blueprintId: value.id, buildingCompletionBasisPoints: 10_000,
      buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0 });
    renderer.focusProject(value.id);
    renderer.setEnvironmentDebugOverride({ date: Date.parse('2026-09-27T12:00:00+08:00'),
      weather: { kind: 'clear', cloudIntensity: 0, precipitationIntensity: 0 } });
    target.__bedAudit = renderer;
  }, blueprint);
  const canvas = page.getByLabel('原创床诊断');
  try {
    await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(bedVoxelCount);
    const noPack = await page.evaluate(() => (window as typeof window & { __bedAudit: VoxelRenderer }).__bedAudit.getDiagnostics());
    expect(noPack.originalStaticShapeBudgetFallbackVoxelCount).toBe(0);
    expect(noPack.originalStaticShapeMaterialGroupCount).toBeLessThanOrEqual(64);
    await canvas.screenshot({ path: testInfo.outputPath('beds-no-pack.png') });

    // The red sample has index 13, so its source state is east/head.
    const valid = syntheticOriginalShapePack('red_bed', 'facing=east,part=head', false);
    await page.evaluate(async ({ id, manifest }) => (window as typeof window & { __bedAudit: VoxelRenderer })
      .__bedAudit.setResourcePack({ id, manifest }), valid);
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(bedVoxelCount - 1);
    const withPack = await page.evaluate(() => (window as typeof window & { __bedAudit: VoxelRenderer }).__bedAudit.getDiagnostics());
    expect(withPack.geometryVoxelCount).toBeGreaterThanOrEqual(1);
    await canvas.screenshot({ path: testInfo.outputPath('beds-valid-model.png') });

    const missing = syntheticOriginalShapePack('red_bed', 'facing=east,part=head', true);
    await page.evaluate(async ({ id, manifest }) => (window as typeof window & { __bedAudit: VoxelRenderer })
      .__bedAudit.setResourcePack({ id, manifest }), missing);
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(bedVoxelCount);
    await canvas.screenshot({ path: testInfo.outputPath('beds-missing-model.png') });
  } finally {
    await page.evaluate(() => (window as typeof window & { __bedAudit?: VoxelRenderer }).__bedAudit?.dispose());
  }
});
