import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { testNbt as nbt, writeJavaNbt } from '../../../packages/litematic/test/nbt-fixture';
import { readPersistedDomainState } from './persisted-domain-state';

function negativeHeightHouse(): Buffer {
  const point = (x: number, y: number, z: number) => nbt.compound({ x: nbt.int(x), y: nbt.int(y), z: nbt.int(z) });
  const states = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2];
  return gzipSync(writeJavaNbt(nbt.compound({
    Version: nbt.int(7), MinecraftDataVersion: nbt.int(4671),
    Metadata: nbt.compound({ Name: nbt.string('方向回归小屋') }),
    Regions: nbt.compound({ house: nbt.compound({
      Position: point(0, 2, 0), Size: point(2, -3, 2),
      BlockStatePalette: nbt.list(10, ['dirt', 'oak_planks', 'glass'].map(id => nbt.compound({ Name: nbt.string(`minecraft:${id}`) }))),
      BlockStates: nbt.longArray([states.reduce((packed, state, index) => packed | BigInt(state) << BigInt(index * 2), 0n)]),
    }) }),
  })));
}

test('negative-height import keeps its ground below its roof through preview, save and reload', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Local diagnosis can exercise a user's original file without publishing it as a fixture.
  const source = process.env.BLOCKCOLC_ORIENTATION_FIXTURE;
  const buffer = source ? readFileSync(source) : negativeHeightHouse();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  const setup = page.locator('.setup');
  await setup.getByLabel('导入 .litematic').setInputFiles({ name: 'orientation.litematic', mimeType: 'application/octet-stream', buffer });
  const preview = setup.locator('canvas[data-preview-blueprint-id$="-coords2"]');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(element => {
    const d = (element as HTMLCanvasElement).dataset;
    return Number(d.renderTriangles) > 0 && d.renderedWorldRebuildCount === d.worldRebuildCount;
  }), { timeout: 20_000 }).toBe(true);
  await preview.screenshot({ path: testInfo.outputPath('negative-height-preview.png') });
  await setup.getByLabel('大型任务').fill('方向回归');
  await setup.getByRole('button', { name: '开始建造' }).click();
  await expect(page.locator('#world-summary')).toContainText('方向回归');
  const { state } = await readPersistedDomainState(page);
  const blueprint = state.projects.find(project => project.id === state.activeProjectId)?.importedBlueprint;
  expect(blueprint?.id).toMatch(/-coords2$/);
  const dirt = blueprint!.voxels.filter(voxel => voxel.sourceBlockId === 'minecraft:dirt');
  expect(dirt.filter(voxel => voxel.y === 0).length).toBeGreaterThan(0);
  expect(dirt.some(voxel => voxel.y === blueprint!.bounds.maxY)).toBe(false);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await expect(page.getByLabel('项目建筑世界')).toBeVisible();
  const restored = (await readPersistedDomainState(page)).state;
  expect(restored.projects.find(project => project.id === restored.activeProjectId)?.importedBlueprint).toEqual(blueprint);
});
