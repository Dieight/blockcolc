import { expect, test, type Page } from '@playwright/test';
import { readPersistedDomainState } from './persisted-domain-state';

const LOCAL_BUILDINGS = [
  { id: 'builtin-local-advanced-matchbox-plus', title: 'Dieight的高级火柴盒plus' },
  { id: 'builtin-local-advanced-matchbox-pro', title: 'Dieight的高级火柴盒pro' },
  { id: 'builtin-local-advanced-matchbox', title: 'Dieight的高级火柴盒' },
  { id: 'builtin-local-dieight-christmas-tree', title: 'Dieight的圣诞树' },
  { id: 'builtin-local-dieight-xilian-figurine', title: 'Dieight的昔涟Q版手办_byMC烤河马' },
  { id: 'builtin-local-gkr-mansion', title: 'karry_steven的豪宅' },
  { id: 'builtin-local-gyp-cherry-storage-furnace', title: 'GYPpro的樱花仓库熔炉' },
  { id: 'builtin-local-gyp-cherry-tree', title: 'GYPpro的樱花树' },
  { id: 'builtin-local-gyp-mansion-first-floor', title: 'GYPpro的豪宅（一层）' },
  { id: 'builtin-local-gyp-ritual-sword', title: 'GYPpro的昔涟-仪式剑' },
  { id: 'builtin-local-gyp-simple-warehouse', title: 'GYPpro的简易小仓库' },
  { id: 'builtin-local-momo-mysterious-house', title: 'm0m0kA_QWQ的神秘小房子' },
  { id: 'builtin-local-small-villa', title: 'Dieight的小别墅' },
  { id: 'builtin-local-togawa-iron-farm', title: 'Togawa15akiko的刷铁机' },
  { id: 'builtin-local-togawa-mansion', title: 'Togawa15akiko的豪宅' },
  { id: 'builtin-local-zdrcgubjo4-small-fountain', title: 'zdrcgubjo4的小喷泉' },
] as const;

const LOCAL_REWARDS = [
  { id: 'builtin-local-dieight-afk-pool', title: 'Dieight的挂机池' },
  { id: 'builtin-local-gyp-afk-spot', title: 'GYPpro的挂机点' },
  { id: 'builtin-local-mysterious-enchanting-table', title: 'Dieight的神秘附魔台' },
  { id: 'builtin-local-small-water-tank', title: 'Dieight的小水箱' },
  { id: 'builtin-local-wqh-yellow-duck', title: 'm0m0kA_QWQ的小黄鸭' },
  { id: 'builtin-local-zdrcgubjo4-iron-golem', title: 'zdrcgubjo4的铁傀儡' },
] as const;

const NEW_BUILDING_IDS = new Set([
  'builtin-local-dieight-christmas-tree', 'builtin-local-dieight-xilian-figurine',
  'builtin-local-gyp-cherry-storage-furnace', 'builtin-local-gyp-cherry-tree', 'builtin-local-gyp-ritual-sword',
  'builtin-local-momo-mysterious-house', 'builtin-local-togawa-iron-farm', 'builtin-local-togawa-mansion',
  'builtin-local-zdrcgubjo4-small-fountain',
]);

async function waitForVoxelTestModule(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const windowWithVoxel = window as typeof window & {
      __blockcolcVoxelTest?: unknown;
    };
    return windowWithVoxel.__blockcolcVoxelTest !== undefined;
  });
}

async function readRewardResources(page: Page): Promise<Array<{ id: string; title: string; importedAt: string }>> {
  const { state } = await readPersistedDomainState(page);
  return state.decorationBlueprintResources.map(resource => ({
    id: resource.id,
    title: resource.blueprint.title,
    importedAt: resource.importedAt,
  }));
}

test.describe('packaged local blueprint catalog', () => {
  test('renders every new ordinary blueprint with its credited description using the shared preview', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
    const preview = page.getByRole('img', { name: /完整建筑预览/ });
    await expect(preview).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 20_000 });
    const newBuildings = LOCAL_BUILDINGS.filter(entry => NEW_BUILDING_IDS.has(entry.id));
    expect(newBuildings).toHaveLength(9);
    for (const entry of newBuildings) {
      const previousRebuild = Number(await preview.getAttribute('data-world-rebuild-count'));
      await page.locator(`label.blueprint-option input[value="${entry.id}"]`).check();
      await expect(preview).toHaveAttribute('data-preview-blueprint-id', entry.id);
      await preview.scrollIntoViewIfNeeded();
      await expect.poll(() => preview.evaluate((element, previousRebuild) => {
        const d = (element as HTMLCanvasElement).dataset;
        return Number(d.worldRebuildCount) > previousRebuild
          && d.renderedWorldRebuildCount === d.worldRebuildCount;
      }, previousRebuild), { timeout: 20_000 }).toBe(true);
      await expect.poll(async () => Number(await preview.getAttribute('data-render-triangles'))).toBeGreaterThan(0);
      await expect(page.locator('.blueprint-description')).toContainText(entry.title.split('的')[0]!);
      await expect(page.locator('.blueprint-description')).toContainText('：');
      if (entry.id === 'builtin-local-dieight-xilian-figurine') {
        await expect(page.locator('.blueprint-description')).toContainText('MC烤河马');
      }
      const png = await preview.screenshot({ path: testInfo.outputPath(`${entry.id}.png`) });
      expect(png.byteLength).toBeGreaterThan(2_000);
    }
    expect(errors).toEqual([]);
  });

  test('shows sixteen supplemental building choices, excludes rewards, renders a large preview, and persists its full snapshot', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');

    const options = page.locator('label.blueprint-option');
    await expect(options).toHaveCount(3 + LOCAL_BUILDINGS.length);
    await expect.poll(async () => options.locator('strong').allTextContents()).toEqual([
      '林边工坊',
      '河岸木屋',
      '村庄礼拜堂',
      ...LOCAL_BUILDINGS.map(entry => entry.title),
    ]);
    for (const reward of LOCAL_REWARDS) {
      await expect(options.filter({ hasText: reward.title })).toHaveCount(0);
    }

    const large = LOCAL_BUILDINGS.find(entry => entry.id === 'builtin-local-gyp-mansion-first-floor')!;
    await options.filter({ hasText: large.title }).click();
    const preview = page.locator(`canvas[data-preview-blueprint-id="${large.id}"]`);
    await expect(preview).toBeVisible();
    await expect.poll(async () => Number(await preview.getAttribute('data-render-calls')), { timeout: 30_000 })
      .toBeGreaterThan(0);

    await page.getByLabel('大型任务').fill('本地补充蓝图保留验证');
    await page.getByRole('button', { name: '开始建造' }).click();
    await expect(page.locator('#world-summary')).toContainText('本地补充蓝图保留验证');

    const { state } = await readPersistedDomainState(page);
    const project = state.projects.find(entry => entry.id === state.activeProjectId);
    expect(project).toBeDefined();
    expect(project?.blueprintId).toBe(large.id);
    expect(project?.importedBlueprint?.id).toBe(large.id);
    expect(project?.importedBlueprint?.title).toBe(large.title);
    expect(project?.importedBlueprint?.voxels.length).toBeGreaterThan(8_000);
    expect(project?.importedBlueprint?.voxels.every(voxel => voxel.stage !== undefined)).toBe(true);

    // The project owns a serialized copy, so it remains renderable when the
    // optional catalog resolver no longer knows this local ID.  The renderer
    // rebuild is triggered by changing an ordinary world preference below;
    // importedRef is the production persistence fallback under test.
    await waitForVoxelTestModule(page);
    await page.evaluate((blueprintId) => {
      const windowWithVoxel = window as typeof window & {
        __blockcolcVoxelTest?: { BUILTIN_BLUEPRINTS?: Map<string, unknown> };
      };
      const catalog = windowWithVoxel.__blockcolcVoxelTest?.BUILTIN_BLUEPRINTS;
      if (!catalog || !catalog.delete(blueprintId)) throw new Error('Expected local blueprint resolver entry');
    }, large.id);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('group', { name: '聚落环境' }).getByRole('button', { name: '空岛' }).click();
    await page.getByRole('button', { name: '计时', exact: true }).click();
    const canvas = page.getByLabel('项目建筑世界');
    await expect(canvas).toBeVisible();
    await expect.poll(async () => Number(await canvas.getAttribute('data-world-rebuild-count')), { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect(page.locator('#world-summary')).toContainText(`${large.title}`);
  });

  test('registers all daily reward blueprints once and keeps them idempotent across reload', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');

    await expect.poll(async () => (await readRewardResources(page)).length, { timeout: 15_000 })
      .toBe(LOCAL_REWARDS.length);
    const first = await readRewardResources(page);
    expect(first).toHaveLength(LOCAL_REWARDS.length);
    expect(first.map(resource => resource.id).sort()).toEqual(LOCAL_REWARDS.map(entry => entry.id).sort());
    expect(first.map(resource => resource.title).sort()).toEqual(LOCAL_REWARDS.map(entry => entry.title).sort());
    expect(new Set(first.map(resource => resource.id)).size).toBe(LOCAL_REWARDS.length);

    await page.reload();
    await expect(page.locator('[data-bootstrap-state="ready"]')).toBeAttached();
    const second = await readRewardResources(page);
    expect(second).toEqual(first);
    expect(new Set(second.map(resource => resource.id)).size).toBe(LOCAL_REWARDS.length);
  });
});
